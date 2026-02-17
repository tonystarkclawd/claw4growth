#!/bin/bash
# ─────────────────────────────────────────────────────────
# C4G Provisioner Worker — VPS Setup Script
#
# Run this on the Hetzner VPS to install and start the worker.
#
# Usage:
#   scp -r worker/ root@168.119.156.2:/opt/c4g/
#   ssh root@168.119.156.2 'bash /opt/c4g/worker/setup-vps.sh'
#
# Prerequisites:
#   - Node.js 18+ installed on VPS
#   - Docker running
#   - .env file at /opt/c4g/worker/.env with Supabase + API keys
# ─────────────────────────────────────────────────────────

set -e

WORKER_DIR="/opt/c4g/worker"
SERVICE_NAME="c4g-provisioner"

echo "=== C4G Provisioner Setup ==="

# 1. Check prerequisites
echo "Checking prerequisites..."
command -v node >/dev/null 2>&1 || { echo "❌ Node.js not found. Install with: curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker not found."; exit 1; }
test -f "$WORKER_DIR/.env" || { echo "❌ Missing $WORKER_DIR/.env — copy your env vars there first."; exit 1; }

echo "  Node: $(node --version)"
echo "  Docker: $(docker --version | head -1)"

# 2. Install dependencies
echo "Installing dependencies..."
cd "$WORKER_DIR"
if [ ! -f package.json ]; then
  npm init -y > /dev/null 2>&1
fi
npm install dockerode --save > /dev/null 2>&1
echo "  Dependencies installed."

# 3. Create systemd service
echo "Creating systemd service..."
cat > /etc/systemd/system/${SERVICE_NAME}.service << 'UNIT'
[Unit]
Description=C4G Provisioner Worker
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/c4g/worker
ExecStart=/usr/bin/node /opt/c4g/worker/provisioner.js
Environment=C4G_ENV=/opt/c4g/worker/.env
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=c4g-provisioner

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/c4g/worker
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

# 4. Enable and start
echo "Starting service..."
systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}

# 5. Verify
sleep 2
if systemctl is-active --quiet ${SERVICE_NAME}; then
  echo ""
  echo "✅ Provisioner is running!"
  echo ""
  echo "Useful commands:"
  echo "  journalctl -u ${SERVICE_NAME} -f     # follow logs"
  echo "  systemctl status ${SERVICE_NAME}      # check status"
  echo "  systemctl restart ${SERVICE_NAME}     # restart"
  echo "  systemctl stop ${SERVICE_NAME}        # stop"
else
  echo "❌ Service failed to start. Check logs:"
  echo "  journalctl -u ${SERVICE_NAME} -n 20"
  exit 1
fi
