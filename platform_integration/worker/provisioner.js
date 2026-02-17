#!/usr/bin/env node
/**
 * C4G Provisioner Worker
 *
 * Runs on the Hetzner VPS as a systemd service.
 * Polls Supabase every 5s for instances in "provisioning" state
 * and provisions them locally via Docker unix socket.
 *
 * Usage:
 *   node provisioner.js                     # run with .env in same dir
 *   C4G_ENV=/path/to/.env node provisioner.js  # custom env path
 */

const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────
const POLL_INTERVAL_MS = 5_000;
const OPENCLAW_IMAGE = 'ghcr.io/openclaw/openclaw:latest';
const DOCKER_NETWORK = 'caddy';
const OPENCLAW_INTERNAL_PORT = 18789;
const SIDECAR_EXTERNAL_PORT = 18790;

// ─── Load env ────────────────────────────────────────────
const envPath = process.env.C4G_ENV || path.resolve(__dirname, '.env');
let envVars = {};
try {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) {
      let v = match[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      v = v.replace(/\\n/g, '\n');
      envVars[match[1].trim()] = v;
    }
  });
} catch (err) {
  console.error(`[provisioner] Cannot read env file ${envPath}:`, err.message);
  process.exit(1);
}

const SB_URL = envVars.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!SB_URL || !SB_KEY) {
  console.error('[provisioner] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Docker via local unix socket (we're on the VPS)
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ─── Supabase helpers ────────────────────────────────────
const headers = {
  'apikey': SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
};

async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPatch(table, query, data) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Docker helpers ──────────────────────────────────────
async function ensureImage(image) {
  try {
    await docker.getImage(image).inspect();
  } catch {
    console.log(`[provisioner] Pulling ${image}...`);
    const stream = await docker.pull(image);
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, err => err ? reject(err) : resolve());
    });
    console.log(`[provisioner] Pulled ${image}`);
  }
}

async function writeToVolume(volumeName, commands) {
  await ensureImage('busybox:latest');
  const tmp = await docker.createContainer({
    Image: 'busybox:latest',
    Cmd: ['sh', '-c', commands],
    HostConfig: { Binds: [`${volumeName}:/data`] },
  });
  await tmp.start();
  await tmp.wait();
  try { await tmp.remove(); } catch {}
}

// ─── Provision one instance ──────────────────────────────
async function provisionInstance(instance) {
  const startTime = Date.now();
  console.log(`[provisioner] Provisioning ${instance.id} (subdomain: ${instance.subdomain})`);

  try {
    // Fetch config
    const configs = await sbGet('c4g_instance_configs', `instance_id=eq.${instance.id}&select=*`);
    const config = configs[0] || {};
    const onboarding = config.onboarding_data || {};

    // Container naming
    const containerName = `openclaw-${instance.user_id}`;
    const configVolume = `${containerName}-config`;
    const workspaceVolume = `${containerName}-workspace`;
    const sidecarName = `${containerName}-sidecar`;
    const isolatedNetName = `c4g-isolated-${containerName}`;

    // 1. Ensure image
    await ensureImage(OPENCLAW_IMAGE);

    // 2. Create volumes
    for (const vol of [configVolume, workspaceVolume]) {
      try { await docker.createVolume({ Name: vol, Driver: 'local' }); }
      catch (e) { if (!e.message?.includes('already exists')) throw e; }
    }

    // 3. Write openclaw.json
    const openclawConfig = JSON.stringify({
      agent: { model: config.model_preference === 'minimax' ? 'minimax/minimax-latest' : 'anthropic/claude-opus-4-6' },
      gateway: { host: '0.0.0.0', port: OPENCLAW_INTERNAL_PORT },
    });
    const cfgB64 = Buffer.from(openclawConfig).toString('base64');
    await writeToVolume(configVolume,
      `mkdir -p /data && echo '${cfgB64}' | base64 -d > /data/openclaw.json && chown -R 1000:1000 /data`
    );

    // 4. Write memory files
    if (onboarding.brand) {
      const brand = onboarding.brand;
      const brandMd = `# Brand: ${brand.name}\n## Industry: ${brand.industry}\n## Description: ${brand.description || 'N/A'}\n## Tone: ${onboarding.tone || 'professional'}\n## Website: ${brand.website || 'N/A'}`;
      const sysPrompt = `You are ${onboarding.operatorName || 'an AI operator'}, a marketing operator for ${brand.name}. Your tone is ${onboarding.tone || 'professional'}. You help with digital marketing tasks.`;
      const brandB64 = Buffer.from(brandMd).toString('base64');
      const promptB64 = Buffer.from(sysPrompt).toString('base64');
      await writeToVolume(configVolume,
        `mkdir -p /data/memory && echo '${brandB64}' | base64 -d > /data/memory/brand.md && echo '${promptB64}' | base64 -d > /data/system-prompt.md && chown -R 1000:1000 /data`
      );
    }

    // 5. Create isolated network
    try { await docker.createNetwork({ Name: isolatedNetName, Driver: 'bridge', Internal: true }); }
    catch (e) { if (!e.message?.includes('already exists')) throw e; }

    // 6. Remove old containers if any
    for (const name of [sidecarName, containerName]) {
      try { await docker.getContainer(name).remove({ force: true }); } catch {}
    }

    // 7. Create and start OpenClaw container
    const container = await docker.createContainer({
      Image: OPENCLAW_IMAGE,
      name: containerName,
      User: '1000:1000',
      Env: [
        'HOST=0.0.0.0',
        `PORT=${OPENCLAW_INTERNAL_PORT}`,
        `MINIMAX_API_KEY=${envVars.MINIMAX_API_KEY || ''}`,
        `COMPOSIO_API_KEY=${envVars.COMPOSIO_API_KEY || ''}`,
        `USER_ID=${instance.user_id}`,
        `INSTANCE_ID=${instance.id}`,
      ],
      Labels: {
        'caddy': `${instance.subdomain}.claw4growth.com`,
        'caddy.reverse_proxy': `{{upstreams ${SIDECAR_EXTERNAL_PORT}}}`,
        'managed-by': 'claw4growth',
        'c4g.subdomain': instance.subdomain,
      },
      ExposedPorts: { [`${SIDECAR_EXTERNAL_PORT}/tcp`]: {} },
      Healthcheck: {
        Test: ['CMD', 'node', 'dist/index.js', 'health'],
        Interval: 30_000_000_000,
        Timeout: 10_000_000_000,
        Retries: 3,
        StartPeriod: 60_000_000_000,
      },
      HostConfig: {
        Memory: 2048 * 1024 * 1024,
        NanoCpus: 2_000_000_000,
        PidsLimit: 500,
        NetworkMode: DOCKER_NETWORK,
        Binds: [
          `${configVolume}:/home/node/.openclaw`,
          `${workspaceVolume}:/home/node/.openclaw/workspace`,
        ],
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        ReadonlyRootfs: true,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=100m',
          '/var/tmp': 'rw,noexec,nosuid,size=100m',
          '/run': 'rw,noexec,nosuid,size=50m',
        },
      },
    });

    // Connect to isolated network
    try {
      const nets = await docker.listNetworks({ filters: { name: [isolatedNetName] } });
      if (nets.length > 0) await docker.getNetwork(nets[0].Id).connect({ Container: container.id });
    } catch {}

    await container.start();
    console.log(`[provisioner] Container ${containerName} started (${container.id.substring(0, 12)})`);

    // 8. Deploy socat sidecar
    await ensureImage('alpine:latest');
    const sidecar = await docker.createContainer({
      Image: 'alpine:latest',
      name: sidecarName,
      Cmd: ['sh', '-c', `apk add --no-cache socat && exec socat TCP-LISTEN:${SIDECAR_EXTERNAL_PORT},fork,bind=0.0.0.0,reuseaddr TCP:127.0.0.1:${OPENCLAW_INTERNAL_PORT}`],
      HostConfig: {
        NetworkMode: `container:${container.id}`,
        RestartPolicy: { Name: 'unless-stopped' },
      },
      Labels: { 'managed-by': 'claw4growth', 'c4g.role': 'sidecar', 'c4g.parent': containerName },
    });
    await sidecar.start();
    console.log(`[provisioner] Sidecar ${sidecarName} started`);

    // 9. Update Supabase → running
    await sbPatch('c4g_instances', `id=eq.${instance.id}`, {
      container_id: container.id,
      status: 'running',
      error_message: null,
      updated_at: new Date().toISOString(),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[provisioner] ✅ Instance ${instance.id} is RUNNING (${elapsed}s) → https://${instance.subdomain}.claw4growth.com`);

  } catch (err) {
    console.error(`[provisioner] ❌ Failed for ${instance.id}:`, err.message || err);
    // Mark as error in Supabase
    try {
      await sbPatch('c4g_instances', `id=eq.${instance.id}`, {
        status: 'error',
        error_message: err.message || String(err),
        updated_at: new Date().toISOString(),
      });
    } catch (sbErr) {
      console.error(`[provisioner] Failed to update error status:`, sbErr.message);
    }
  }
}

// ─── Poll loop ───────────────────────────────────────────
let isProcessing = false;

async function poll() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const pending = await sbGet('c4g_instances', 'status=eq.provisioning&select=*&order=created_at.asc&limit=1');
    if (pending.length > 0) {
      await provisionInstance(pending[0]);
    }
  } catch (err) {
    console.error('[provisioner] Poll error:', err.message);
  } finally {
    isProcessing = false;
  }
}

// ─── Startup ─────────────────────────────────────────────
console.log('[provisioner] C4G Provisioner Worker started');
console.log(`[provisioner] Polling Supabase every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`[provisioner] Docker: local unix socket`);

// Initial poll immediately
poll();

// Then every 5 seconds
setInterval(poll, POLL_INTERVAL_MS);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[provisioner] SIGTERM received, shutting down...');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[provisioner] SIGINT received, shutting down...');
  process.exit(0);
});
