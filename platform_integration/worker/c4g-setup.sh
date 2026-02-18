#!/usr/bin/env bash
#
# C4G Infrastructure Setup — idempotent
#
# Deploys LLM proxy, provisioner, and composio-bridge on the VPS.
# Safe to re-run after openclaw onboard / gateway install --force.
#
# Usage:
#   ssh root@VPS 'bash -s' < c4g-setup.sh          # pipe from local
#   bash /opt/c4g/c4g-setup.sh                      # run on VPS directly
#
set -euo pipefail

C4G_DIR="/opt/c4g"
PROXY_DIR="$C4G_DIR/proxy"
PROVISIONER_DIR="$C4G_DIR/provisioner"
BRIDGE_DIR="$C4G_DIR/composio-bridge"

echo "[c4g-setup] Starting C4G infrastructure setup..."

# ─── Create directories ───────────────────────────────────
mkdir -p "$PROXY_DIR" "$PROVISIONER_DIR" "$BRIDGE_DIR"

# ─── Check required files exist ───────────────────────────
for f in "$PROXY_DIR/llm-proxy.js" "$PROXY_DIR/.env"; do
  if [ ! -f "$f" ]; then
    echo "[c4g-setup] WARNING: $f not found — copy it manually before starting services"
  fi
done

# ─── Install composio-bridge dependencies ─────────────────
if [ -f "$BRIDGE_DIR/package.json" ] || [ -f "$BRIDGE_DIR/composio-bridge.js" ]; then
  if [ ! -d "$BRIDGE_DIR/node_modules/@composio" ]; then
    echo "[c4g-setup] Installing composio-bridge dependencies..."
    cd "$BRIDGE_DIR"
    npm init -y 2>/dev/null || true
    npm install @composio/core 2>&1 | tail -3
  else
    echo "[c4g-setup] composio-bridge dependencies already installed"
  fi
fi

# ─── Systemd: LLM Proxy (port 19000) ─────────────────────
cat > /etc/systemd/system/c4g-llm-proxy.service <<'UNIT'
[Unit]
Description=C4G LLM Proxy
After=network.target
# Do NOT conflict with openclaw-gateway — they use different ports

[Service]
Type=simple
WorkingDirectory=/opt/c4g/proxy
ExecStart=/usr/bin/node /opt/c4g/proxy/llm-proxy.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

# ─── Systemd: Provisioner ────────────────────────────────
cat > /etc/systemd/system/c4g-provisioner.service <<'UNIT'
[Unit]
Description=C4G Container Provisioner
After=network.target docker.service c4g-llm-proxy.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/c4g/provisioner
ExecStart=/usr/bin/node /opt/c4g/provisioner/provisioner.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

# ─── Reload and enable ───────────────────────────────────
systemctl daemon-reload

# Only start services if their main files exist
if [ -f "$PROXY_DIR/llm-proxy.js" ] && [ -f "$PROXY_DIR/.env" ]; then
  systemctl enable c4g-llm-proxy
  systemctl restart c4g-llm-proxy
  echo "[c4g-setup] c4g-llm-proxy: $(systemctl is-active c4g-llm-proxy)"
else
  echo "[c4g-setup] Skipping proxy start — files missing"
fi

if [ -f "$PROVISIONER_DIR/provisioner.js" ]; then
  systemctl enable c4g-provisioner
  systemctl restart c4g-provisioner
  echo "[c4g-setup] c4g-provisioner: $(systemctl is-active c4g-provisioner)"
else
  echo "[c4g-setup] Skipping provisioner start — files missing"
fi

echo "[c4g-setup] Done. Services:"
systemctl list-units --type=service --state=running | grep c4g || true
echo ""
echo "[c4g-setup] Ports in use:"
ss -tlnp | grep -E '19000' || true
