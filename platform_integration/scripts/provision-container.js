/**
 * Manually provisions an OpenClaw container on the VPS via SSH + Docker TLS.
 * Use this when Vercel serverless timeout prevents async provisioning.
 *
 * NOTE: The VPS provisioner (worker/provisioner.js) is the primary provisioning
 * method. This script is for manual/emergency use only.
 *
 * Usage: node scripts/provision-container.js
 */
const Docker = require('dockerode');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) {
        let v = match[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        v = v.replace(/\\n/g, '\n');
        env[match[1].trim()] = v;
    }
});

const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const docker = new Docker({
    host: env.DOCKER_HOST_IP,
    port: 2376,
    ca: env.DOCKER_TLS_CA,
    cert: env.DOCKER_TLS_CERT,
    key: env.DOCKER_TLS_KEY,
});

const OPENCLAW_IMAGE = 'ghcr.io/openclaw/openclaw:latest';
const DOCKER_NETWORK = 'caddy';
const OPENCLAW_INTERNAL_PORT = 18789;
const SIDECAR_EXTERNAL_PORT = 18790;
const CONTAINER_STATE_BASE = '/opt/c4g/containers';
const OPENCLAW_MODEL = 'minimax/MiniMax-M2.5';
const VPS_SSH = `ssh -i ~/.ssh/id_ed25519 root@${env.DOCKER_HOST_IP}`;

async function supabaseGet(table, query) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    });
    return res.json();
}

async function supabaseUpdate(table, query, data) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
        method: 'PATCH',
        headers: {
            'apikey': SB_KEY,
            'Authorization': `Bearer ${SB_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(data)
    });
    return res.json();
}

function sshExec(cmd) {
    return execSync(`${VPS_SSH} "${cmd.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

async function provision() {
    // 1. Get the instance that needs provisioning
    const instances = await supabaseGet('c4g_instances', 'status=eq.provisioning&select=*');
    if (instances.length === 0) {
        console.log('No instances in provisioning state.');
        return;
    }

    const instance = instances[0];
    console.log(`Provisioning instance: ${instance.id}`);
    console.log(`  Subdomain: ${instance.subdomain}`);
    console.log(`  User: ${instance.user_id}`);

    // 2. Get config
    const configs = await supabaseGet('c4g_instance_configs', `instance_id=eq.${instance.id}&select=*`);
    const config = configs[0] || {};
    const onboarding = config.onboarding_data || {};

    // 3. Ensure image exists
    console.log('\nChecking image...');
    try {
        await docker.getImage(OPENCLAW_IMAGE).inspect();
        console.log('  Image exists locally.');
    } catch {
        console.log('  Pulling image (this may take a while)...');
        const stream = await docker.pull(OPENCLAW_IMAGE);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve());
        });
        console.log('  Image pulled.');
    }

    // 4. Create host directories and write config via SSH
    const containerName = `openclaw-${instance.user_id}`;
    const sidecarName = `${containerName}-sidecar`;
    const stateDir = `${CONTAINER_STATE_BASE}/${instance.subdomain}/state`;
    const workspaceDir = `${CONTAINER_STATE_BASE}/${instance.subdomain}/workspace`;

    console.log('\nCreating host directories via SSH...');
    sshExec(`mkdir -p ${stateDir} ${workspaceDir} && chown -R 1000:1000 ${CONTAINER_STATE_BASE}/${instance.subdomain}`);

    // 5. Write openclaw.json config
    const gatewayToken = env.C4G_GATEWAY_TOKEN || 'c4g-gw-default-token';
    const openclawConfig = JSON.stringify({
        agents: { defaults: { model: { primary: OPENCLAW_MODEL } } },
        gateway: {
            port: OPENCLAW_INTERNAL_PORT,
            auth: { mode: 'token' },
            controlUi: { dangerouslyDisableDeviceAuth: true },
            http: { endpoints: { chatCompletions: { enabled: true } } },
        },
    }, null, 2);
    const cfgB64 = Buffer.from(openclawConfig).toString('base64');
    console.log('Writing openclaw.json...');
    sshExec(`echo '${cfgB64}' | base64 -d > ${stateDir}/openclaw.json && chown 1000:1000 ${stateDir}/openclaw.json`);

    // 6. Write memory files if onboarding data exists
    if (onboarding.brand) {
        console.log('Writing memory files...');
        const brand = onboarding.brand;
        const brandMd = `# Brand: ${brand.name}\n## Industry: ${brand.industry}\n## Description: ${brand.description || 'N/A'}\n## Tone: ${onboarding.tone || 'professional'}\n## Website: ${brand.website || 'N/A'}`;
        const sysPrompt = `You are ${onboarding.operatorName || 'an AI operator'}, a marketing operator for ${brand.name}. Your tone is ${onboarding.tone || 'professional'}. You help with digital marketing tasks.`;
        const brandB64 = Buffer.from(brandMd).toString('base64');
        const promptB64 = Buffer.from(sysPrompt).toString('base64');
        sshExec(`mkdir -p ${stateDir}/memory && echo '${brandB64}' | base64 -d > ${stateDir}/memory/brand.md && echo '${promptB64}' | base64 -d > ${stateDir}/system-prompt.md && chown -R 1000:1000 ${stateDir}`);
    }

    // 7. Remove existing containers if any
    for (const name of [sidecarName, containerName]) {
        try { await docker.getContainer(name).remove({ force: true }); console.log(`  Removed ${name}`); } catch {}
    }

    // 8. Create the container
    console.log('\nCreating container...');
    const container = await docker.createContainer({
        Image: OPENCLAW_IMAGE,
        name: containerName,
        User: '1000:1000',
        Env: [
            'HOST=0.0.0.0',
            `PORT=${OPENCLAW_INTERNAL_PORT}`,
            'OPENCLAW_STATE_DIR=/data/openclaw-state',
            `OPENCLAW_GATEWAY_TOKEN=${gatewayToken}`,
            `MINIMAX_API_KEY=${env.MINIMAX_API_KEY || ''}`,
            `COMPOSIO_API_KEY=${env.COMPOSIO_API_KEY || ''}`,
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
            ],
            Tmpfs: {
                '/tmp': 'rw,nosuid,size=500m',
                '/var/tmp': 'rw,nosuid,size=200m',
                '/run': 'rw,nosuid,size=50m',
            },
        },
    });

    // 9. Start
    console.log('Starting container...');
    await container.start();
    console.log(`  Container ID: ${container.id.substring(0, 12)}`);

    // 10. Deploy socat sidecar
    console.log('Creating sidecar...');
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
    console.log('  Sidecar started.');

    // 11. Update Supabase
    await supabaseUpdate('c4g_instances', `id=eq.${instance.id}`, {
        container_id: container.id,
        status: 'running',
        updated_at: new Date().toISOString(),
    });
    console.log(`\n✅ Instance ${instance.id} is now RUNNING`);
    console.log(`   URL: https://${instance.subdomain}.claw4growth.com`);
}

provision().catch(e => {
    console.error('❌ Provisioning failed:', e.message || e);
    process.exit(1);
});
