#!/usr/bin/env node
/**
 * C4G Hot Update — Push file updates to all running containers
 *
 * Usage:
 *   node c4g-update-containers.js --docs       # COMPOSIO.md + MODELS.md
 *   node c4g-update-containers.js --identity   # IDENTITY.md + USER.md (from onboarding data)
 *   node c4g-update-containers.js --all        # everything
 *   node c4g-update-containers.js --file COMPOSIO.md   # single file from c4g-content
 *   node c4g-update-containers.js --reindex    # also reindex memory after writing
 *
 *   C4G_ENV=/path/to/.env node c4g-update-containers.js --docs
 */

const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const {
  generateIdentityMd,
  generateUserMd,
  generateBootstrapMd,
  generateModelsMd,
  generateComposioMd,
} = require('./c4g-content');

// ─── Config ──────────────────────────────────────────────
const CONTAINER_STATE_BASE = '/opt/c4g/containers';
const WS_PATH = '/home/node/.openclaw/workspace';

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
  console.error(`[update] Cannot read env file ${envPath}:`, err.message);
  process.exit(1);
}

const SB_URL = envVars.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!SB_URL || !SB_KEY) {
  console.error('[update] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

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

// ─── Docker file writer ──────────────────────────────────
async function writeFile(container, filePath, content) {
  const b64 = Buffer.from(content).toString('base64');
  const exec = await container.exec({
    Cmd: ['sh', '-c', `echo '${b64}' | base64 -d > ${filePath}`],
    User: '1000:1000',
  });
  await exec.start();
}

// ─── Parse args ──────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
  docs: args.includes('--docs'),
  identity: args.includes('--identity'),
  all: args.includes('--all'),
  reindex: args.includes('--reindex'),
  file: null,
};

const fileIdx = args.indexOf('--file');
if (fileIdx !== -1 && args[fileIdx + 1]) {
  flags.file = args[fileIdx + 1];
}

if (!flags.docs && !flags.identity && !flags.all && !flags.file) {
  console.error('Usage: node c4g-update-containers.js [--docs] [--identity] [--all] [--file <name>] [--reindex]');
  console.error('');
  console.error('  --docs       Update COMPOSIO.md + MODELS.md');
  console.error('  --identity   Update IDENTITY.md + USER.md + BOOTSTRAP.md + memory/brand.md');
  console.error('  --all        Update all files');
  console.error('  --file NAME  Update a single file (COMPOSIO.md, MODELS.md, IDENTITY.md, USER.md, BOOTSTRAP.md)');
  console.error('  --reindex    Reindex memory after writing files');
  process.exit(1);
}

const wantDocs = flags.all || flags.docs;
const wantIdentity = flags.all || flags.identity;

// ─── Main ────────────────────────────────────────────────
async function main() {
  console.log('[update] Fetching running instances from Supabase...');
  const instances = await sbGet('c4g_instances', 'status=eq.running&select=*');

  if (instances.length === 0) {
    console.log('[update] No running instances found.');
    return;
  }

  console.log(`[update] Found ${instances.length} running instance(s)`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const instance of instances) {
    const containerName = `openclaw-${instance.user_id}`;

    try {
      // Verify container exists and is running
      const container = docker.getContainer(containerName);
      const info = await container.inspect();

      if (!info.State.Running) {
        console.warn(`[update] ⚠ ${containerName}: container not running, skipping`);
        skipped++;
        continue;
      }

      const filesWritten = [];

      // ── Docs mode: COMPOSIO.md + MODELS.md ──
      if (wantDocs || flags.file === 'COMPOSIO.md') {
        await writeFile(container, `${WS_PATH}/COMPOSIO.md`, generateComposioMd());
        filesWritten.push('COMPOSIO.md');
      }
      if (wantDocs || flags.file === 'MODELS.md') {
        await writeFile(container, `${WS_PATH}/MODELS.md`, generateModelsMd());
        filesWritten.push('MODELS.md');
      }

      // ── Identity mode: needs onboarding data ──
      if (wantIdentity || ['IDENTITY.md', 'USER.md', 'BOOTSTRAP.md'].includes(flags.file)) {
        const configs = await sbGet('c4g_instance_configs', `instance_id=eq.${instance.id}&select=*`);
        const config = configs[0] || {};
        const onboarding = config.onboarding_data || {};

        if (!onboarding.brand) {
          console.warn(`[update] ⚠ ${containerName}: no onboarding data, skipping identity files`);
        } else {
          const brand = onboarding.brand;
          const opName = onboarding.operatorName || 'AI Operator';
          const tone = onboarding.tone || 'professional';

          if (wantIdentity || flags.file === 'IDENTITY.md') {
            await writeFile(container, `${WS_PATH}/IDENTITY.md`, generateIdentityMd(opName, brand, tone));
            filesWritten.push('IDENTITY.md');
          }
          if (wantIdentity || flags.file === 'USER.md') {
            await writeFile(container, `${WS_PATH}/USER.md`, generateUserMd(brand, tone));
            filesWritten.push('USER.md');
          }
          if (wantIdentity || flags.file === 'BOOTSTRAP.md') {
            await writeFile(container, `${WS_PATH}/BOOTSTRAP.md`, generateBootstrapMd(opName, brand, tone));
            filesWritten.push('BOOTSTRAP.md');
          }
          // NOTE: memory/brand.md is NOT updated here — it's only seeded at provisioning.
          // The agent/user may have enriched it with new info during conversations.
          // memory/* is the agent's domain, we never overwrite it.
        }
      }

      // ── Reindex memory ──
      if (flags.reindex || flags.all) {
        try {
          const exec = await container.exec({
            Cmd: ['node', 'openclaw.mjs', 'memory', 'index', '--force'],
            User: '1000:1000',
          });
          await exec.start();
          filesWritten.push('(reindexed)');
        } catch (e) {
          console.warn(`[update] ⚠ ${containerName}: memory reindex failed: ${e.message}`);
        }
      }

      if (filesWritten.length > 0) {
        console.log(`[update] ✅ ${containerName}: ${filesWritten.join(', ')}`);
        updated++;
      } else {
        console.log(`[update] ⏭ ${containerName}: no files to write`);
        skipped++;
      }

    } catch (err) {
      if (err.statusCode === 404) {
        console.warn(`[update] ⚠ ${containerName}: container not found, skipping`);
        skipped++;
      } else {
        console.error(`[update] ❌ ${containerName}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log('');
  console.log(`[update] Done. Updated ${updated}/${instances.length} containers (${skipped} skipped, ${failed} failed)`);
}

main().catch(err => {
  console.error('[update] Fatal error:', err.message);
  process.exit(1);
});
