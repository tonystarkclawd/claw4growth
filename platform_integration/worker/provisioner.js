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
const CONTAINER_STATE_BASE = '/opt/c4g/containers';
const COMPOSIO_BRIDGE_DIR = '/opt/c4g/composio-bridge';
const OPENCLAW_MODEL = 'c4g/openai/gpt-4o-mini';
const LLM_PROXY_HOST = '172.18.0.1';  // Caddy network gateway — reachable from containers
const LLM_PROXY_PORT = 19000;

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
    const sidecarName = `${containerName}-sidecar`;

    // Host paths for persistent state (bind mounts — OpenClaw overwrites Docker volumes with tmpfs)
    const stateDir = `${CONTAINER_STATE_BASE}/${instance.subdomain}/state`;
    const workspaceDir = `${CONTAINER_STATE_BASE}/${instance.subdomain}/workspace`;

    // 1. Ensure image
    await ensureImage(OPENCLAW_IMAGE);

    // 2. Create host directories and write openclaw.json
    const { execSync } = require('child_process');
    execSync(`mkdir -p "${stateDir}" "${workspaceDir}" && chown -R 1000:1000 "${CONTAINER_STATE_BASE}/${instance.subdomain}"`);

    const gatewayToken = envVars.C4G_GATEWAY_TOKEN || 'c4g-gw-default-token';
    const openclawConfig = JSON.stringify({
      agents: { defaults: { model: { primary: OPENCLAW_MODEL } } },
      models: {
        mode: 'merge',
        providers: {
          c4g: {
            baseUrl: `http://${LLM_PROXY_HOST}:${LLM_PROXY_PORT}/v1`,
            apiKey: `\${OPENAI_API_KEY}`,
            api: 'openai-completions',
            models: [
              { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (default)' },
              { id: 'openai/gpt-4o', name: 'GPT-4o' },
              { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
              { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro' },
              { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
              { id: 'anthropic/claude-haiku-4', name: 'Claude Haiku 4' },
            ],
          },
        },
      },
      gateway: {
        port: OPENCLAW_INTERNAL_PORT,
        auth: { mode: 'token' },
        controlUi: { dangerouslyDisableDeviceAuth: true },
        http: { endpoints: { chatCompletions: { enabled: true } } },
      },
    }, null, 2);
    fs.writeFileSync(path.join(stateDir, 'openclaw.json'), openclawConfig);
    execSync(`chown 1000:1000 "${path.join(stateDir, 'openclaw.json')}"`);
    console.log(`[provisioner] Config written to ${stateDir}/openclaw.json`);

    // 3. Remove old containers if any
    for (const name of [sidecarName, containerName]) {
      try { await docker.getContainer(name).remove({ force: true }); } catch {}
    }

    // 5. Create and start OpenClaw container
    const container = await docker.createContainer({
      Image: OPENCLAW_IMAGE,
      name: containerName,
      User: '1000:1000',
      Env: [
        'HOST=0.0.0.0',
        `PORT=${OPENCLAW_INTERNAL_PORT}`,
        'OPENCLAW_STATE_DIR=/data/openclaw-state',
        `OPENCLAW_GATEWAY_TOKEN=${gatewayToken}`,
        `OPENAI_BASE_URL=http://${LLM_PROXY_HOST}:${LLM_PROXY_PORT}/v1`,
        `OPENAI_API_KEY=${instance.user_id}`,
        `COMPOSIO_API_KEY=${envVars.COMPOSIO_API_KEY || ''}`,
        `COMPOSIO_ENTITY_ID=${instance.user_id}`,
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
      HostConfig: {
        Memory: 4096 * 1024 * 1024,
        NanoCpus: 2_000_000_000,
        PidsLimit: 500,
        NetworkMode: DOCKER_NETWORK,
        Binds: [
          `${stateDir}:/data/openclaw-state`,
          `${workspaceDir}:/data/openclaw-state/workspace`,
          `${COMPOSIO_BRIDGE_DIR}:/opt/composio-bridge:ro`,
        ],
        Tmpfs: {
          '/tmp': 'rw,nosuid,size=500m',
          '/var/tmp': 'rw,nosuid,size=200m',
          '/run': 'rw,nosuid,size=50m',
        },
      },
    });

    await container.start();
    console.log(`[provisioner] Container ${containerName} started (${container.id.substring(0, 12)})`);

    // 6. Deploy socat sidecar (bridges external port to internal loopback)
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

    // 7. Write identity + memory files into the workspace (tmpfs, written after boot)
    if (onboarding.brand) {
      const brand = onboarding.brand;
      const opName = onboarding.operatorName || 'AI Operator';
      const tone = onboarding.tone || 'professional';
      const wsPath = '/home/node/.openclaw/workspace';

      // Wait for gateway to initialize workspace
      await new Promise(r => setTimeout(r, 10_000));

      const writeFile = async (filePath, content) => {
        const b64 = Buffer.from(content).toString('base64');
        await container.exec({
          Cmd: ['sh', '-c', `echo '${b64}' | base64 -d > ${filePath}`],
          User: '1000:1000',
        }).then(exec => exec.start());
      };

      // IDENTITY.md — who the agent is
      await writeFile(`${wsPath}/IDENTITY.md`, [
        '# IDENTITY.md - Who Am I?',
        '',
        `- **Name:** ${opName}`,
        `- **Creature:** AI marketing operator`,
        `- **Vibe:** ${tone}, helpful, proactive`,
        `- **Emoji:** 🚀`,
        '',
        `I am ${opName}, the dedicated marketing operator for ${brand.name}.`,
        `I help with digital marketing tasks: content creation, campaign management, analytics, and more.`,
      ].join('\n'));

      // USER.md — info about the human
      await writeFile(`${wsPath}/USER.md`, [
        '# USER.md - About Your Human',
        '',
        `- **Brand:** ${brand.name}`,
        `- **Industry:** ${brand.industry}`,
        `- **Description:** ${brand.description || 'N/A'}`,
        `- **Website:** ${brand.website || 'N/A'}`,
        `- **Preferred tone:** ${tone}`,
        '',
        '## Context',
        '',
        `This user runs ${brand.name} in the ${brand.industry} space.`,
        `They use Claw4Growth to automate their digital marketing.`,
        `Always communicate in a ${tone} tone.`,
      ].join('\n'));

      // memory/brand.md
      await container.exec({
        Cmd: ['sh', '-c', `mkdir -p ${wsPath}/memory`],
        User: '1000:1000',
      }).then(exec => exec.start());

      await writeFile(`${wsPath}/memory/brand.md`, [
        `# Brand: ${brand.name}`,
        `## Industry: ${brand.industry}`,
        `## Description: ${brand.description || 'N/A'}`,
        `## Tone: ${tone}`,
        `## Website: ${brand.website || 'N/A'}`,
      ].join('\n'));

      // BOOTSTRAP.md — custom first-message replacing the generic one
      await writeFile(`${wsPath}/BOOTSTRAP.md`, [
        `# Welcome!`,
        ``,
        `You are **${opName}**, the marketing operator for **${brand.name}**.`,
        `Your tone is **${tone}**. You help with digital marketing tasks.`,
        ``,
        `## First Message`,
        ``,
        `Introduce yourself briefly. Something like:`,
        ``,
        `> "Hey! I'm ${opName}, your marketing operator for ${brand.name}. 🚀`,
        `> I can help with content creation, campaign management, analytics, and more.`,
        `> What would you like to work on?"`,
        ``,
        `Also mention that they can manage their integrations and subscription at:`,
        `**https://claw4growth.com/dashboard/**`,
        ``,
        `## After the first conversation`,
        ``,
        `Delete this file — you don't need it anymore.`,
      ].join('\n'));

      // MODELS.md — instructions for model switching
      await writeFile(`${wsPath}/MODELS.md`, [
        '# Available AI Models',
        '',
        'You are currently using **GPT-4o Mini** — fast and cost-effective for most tasks.',
        '',
        '## When to suggest a model upgrade',
        '',
        'For particularly complex tasks, you can suggest using a more capable model.',
        'ONLY suggest this when the task genuinely requires it:',
        '',
        '- **Deep data analysis** with large datasets or complex reasoning',
        '- **Long-form strategy documents** requiring nuanced business insight',
        '- **Complex multi-step campaigns** with many variables',
        '- **Code generation** for advanced automations or integrations',
        '',
        '## How to suggest',
        '',
        'When you think a stronger model would help, ask the user:',
        '',
        '> "This task is quite complex. I can handle it with my current model (GPT-4o Mini),',
        '> but for best results I\'d suggest switching to a more powerful model for this specific task.',
        '> It will cost a bit more from your monthly budget. Would you like to upgrade for this task?"',
        '',
        '## Available models (by cost)',
        '',
        '| Model | Best for | Relative cost |',
        '|-------|----------|---------------|',
        '| GPT-4o Mini | General tasks, quick responses | $ (default) |',
        '| Gemini 2.0 Flash | Fast tasks, similar to Mini | $ |',
        '| Claude Haiku 4 | Quick analytical tasks | $$ |',
        '| GPT-4o | Complex reasoning, analysis | $$$ |',
        '| Gemini 2.5 Pro | Deep analysis, long context | $$$ |',
        '| Claude Sonnet 4 | Best quality writing & reasoning | $$$$ |',
        '',
        '## Important',
        '',
        '- NEVER switch model without asking the user first',
        '- NEVER mention model names proactively — only when the user asks or the task warrants it',
        '- After the complex task is done, switch back to GPT-4o Mini',
        '- The user has a monthly budget cap — be mindful of costs',
      ].join('\n'));

      // COMPOSIO.md — instructions for using connected app integrations
      await writeFile(`${wsPath}/COMPOSIO.md`, [
        '# App Integrations (Composio)',
        '',
        'You have access to connected apps via the Composio bridge.',
        'The user connected these apps through the Claw4Growth dashboard.',
        '',
        '## How to Use',
        '',
        'Run commands via Bash using the bridge script:',
        '',
        '### List connected apps',
        '```bash',
        'node /opt/composio-bridge/composio-bridge.js list-apps $USER_ID',
        '```',
        '',
        '### List available tools for an app',
        '```bash',
        'node /opt/composio-bridge/composio-bridge.js list-tools $USER_ID gmail',
        '```',
        '',
        '### Execute a tool',
        '```bash',
        `node /opt/composio-bridge/composio-bridge.js execute $USER_ID TOOL_SLUG '{"param":"value"}'`,
        '```',
        '',
        '## Common Tools',
        '',
        '### Gmail',
        '- `GMAIL_SEND_EMAIL` — args: `{"to":"email","subject":"...","body":"..."}`',
        '- `GMAIL_FETCH_EMAILS` — args: `{"max_results":5}`',
        '- `GMAIL_GET_PROFILE` — no args needed',
        '- `GMAIL_CREATE_EMAIL_DRAFT` — args: `{"to":"email","subject":"...","body":"..."}`',
        '',
        '### Google Calendar',
        '- `GOOGLECALENDAR_CREATE_EVENT` — args: `{"summary":"...","start":{"dateTime":"..."},"end":{"dateTime":"..."}}`',
        '- `GOOGLECALENDAR_EVENTS_LIST` — args: `{"calendarId":"primary"}`',
        '- `GOOGLECALENDAR_FIND_FREE_SLOTS` — find available time slots',
        '',
        '### Facebook',
        '- `FACEBOOK_GET_USER_PAGES` — no args needed. Lists pages the user manages',
        '- `FACEBOOK_CREATE_PAGE_POST` — args: `{"page_id":"...","message":"..."}`',
        '- `FACEBOOK_GET_PAGE_INSIGHTS` — args: `{"page_id":"..."}`',
        '',
        '### Instagram',
        '- `INSTAGRAM_GET_USER_INFO` — no args needed. Returns profile info, followers, media count',
        '- `INSTAGRAM_GET_MEDIA` — get recent posts',
        '- `INSTAGRAM_CREATE_MEDIA` — create a post',
        '',
        '### Meta Ads',
        '- `METAADS_GET_AD_ACCOUNTS` — no args needed. Returns all ad accounts the user has access to',
        '- `METAADS_GET_INSIGHTS` — args: `{"ad_account_id":"act_123456","date_preset":"last_30d"}` — campaign performance',
        '- `METAADS_READ_ADSETS` — args: `{"ad_account_id":"act_123456"}` — list ad sets',
        '- `METAADS_CREATE_CAMPAIGN` — args: `{"ad_account_id":"act_123456","name":"...","objective":"OUTCOME_TRAFFIC","status":"PAUSED"}`',
        '- `METAADS_CREATE_AD_SET` — create an ad set within a campaign',
        '- `METAADS_CREATE_AD` — create an ad within an ad set',
        '- `METAADS_CREATE_AD_CREATIVE` — create ad creative (text, images, links)',
        '- `METAADS_PAUSE_CAMPAIGN` / `METAADS_RESUME_CAMPAIGN` — pause/resume campaigns',
        '- `METAADS_UPDATE_CAMPAIGN` / `METAADS_DELETE_CAMPAIGN` — update/delete campaigns',
        '',
        '**Meta Ads workflow:** Always start with `METAADS_GET_AD_ACCOUNTS` to get the ad account ID, then use that ID for all other operations.',
        '',
        '### LinkedIn',
        '- `LINKEDIN_GET_MY_INFO` — no args needed. Returns user profile',
        '- `LINKEDIN_CREATE_LINKED_IN_POST` — args: `{"text":"..."}`',
        '',
        '### Reddit',
        '- `REDDIT_GET_ME_PREFS` — no args needed. Returns user info',
        '- `REDDIT_SUBMIT_A_LINK_POST` — args: `{"sr":"subreddit","title":"...","url":"..."}`',
        '- `REDDIT_SUBMIT_A_SELF_POST` — args: `{"sr":"subreddit","title":"...","text":"..."}`',
        '- `REDDIT_SEARCH_REDDIT` — args: `{"q":"query"}`',
        '',
        '### Notion',
        '- `NOTION_GET_ABOUT_ME` — no args needed. Returns workspace info',
        '- `NOTION_SEARCH_NOTION_PAGE` — args: `{"search_query":"..."}`',
        '- `NOTION_CREATE_NOTION_PAGE` — create a new page',
        '',
        '### Stripe',
        '- `STRIPE_LIST_PRODUCTS` — args: `{"limit":10}` — list products',
        '- `STRIPE_LIST_ALL_CUSTOMERS` — list customers',
        '- `STRIPE_LIST_ALL_CHARGES` — list payments/charges',
        '',
        '## Important',
        '',
        '- Always run `list-apps` first to see what the user has connected',
        '- If a tool fails, check if the app is connected',
        '- The bridge output is JSON — parse and present results clearly to the user',
        '- NEVER show raw JSON to the user — summarize the results in a friendly way',
      ].join('\n'));

      // Reindex memory
      try {
        await container.exec({
          Cmd: ['node', 'openclaw.mjs', 'memory', 'index', '--force'],
          User: '1000:1000',
        }).then(exec => exec.start());
      } catch {}

      console.log(`[provisioner] Identity + memory + Composio files written for ${opName} / ${brand.name}`);
    }

    // 8. Update Supabase → running
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
