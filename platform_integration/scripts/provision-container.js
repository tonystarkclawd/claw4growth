/**
 * Manually provisions an OpenClaw container on the VPS.
 * Use this when Vercel serverless timeout prevents async provisioning.
 *
 * Usage: node scripts/provision-container.js
 */
const Docker = require('dockerode');
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
const DEPLOYED_PORT = 18789;

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
    console.log(`  Model: ${config.model_preference || 'minimax'}`);

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

    // 4. Create volumes
    const containerName = `openclaw-${instance.user_id}`;
    const configVolName = `${containerName}-config`;
    const workspaceVolName = `${containerName}-workspace`;

    for (const volName of [configVolName, workspaceVolName]) {
        try {
            await docker.createVolume({ Name: volName, Driver: 'local' });
            console.log(`  Volume ${volName} created.`);
        } catch (e) {
            if (e.message && e.message.includes('already exists')) {
                console.log(`  Volume ${volName} already exists.`);
            } else throw e;
        }
    }

    // 5. Write openclaw.json config via busybox
    const openclawConfig = JSON.stringify({
        agent: { model: 'minimax/minimax-latest' }
    });
    const b64 = Buffer.from(openclawConfig).toString('base64');

    console.log('\nWriting openclaw.json...');
    await docker.getImage('busybox:latest').inspect().catch(async () => {
        const stream = await docker.pull('busybox:latest');
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve());
        });
    });

    const tmpContainer = await docker.createContainer({
        Image: 'busybox:latest',
        Cmd: ['sh', '-c', `mkdir -p /data && echo '${b64}' | base64 -d > /data/openclaw.json && chown -R 1000:1000 /data`],
        HostConfig: { Binds: [`${configVolName}:/data`] },
    });
    await tmpContainer.start();
    await tmpContainer.wait();
    try { await tmpContainer.remove(); } catch {}

    // 6. Write memory files if onboarding data exists
    if (config.onboarding_data && config.onboarding_data.brand) {
        console.log('Writing memory files...');
        const od = config.onboarding_data;
        const brandMemory = `# Brand: ${od.brand.name}\n## Industry: ${od.brand.industry}\n## Description: ${od.brand.description || 'N/A'}\n## Tone: ${od.tone || 'professional'}\n## Website: ${od.brand.website || 'N/A'}`;
        const systemPrompt = `You are ${od.operatorName || 'an AI operator'}, a marketing operator for ${od.brand.name}. Your tone is ${od.tone || 'professional'}. You help with digital marketing tasks.`;

        const brandB64 = Buffer.from(brandMemory).toString('base64');
        const promptB64 = Buffer.from(systemPrompt).toString('base64');

        const memContainer = await docker.createContainer({
            Image: 'busybox:latest',
            Cmd: ['sh', '-c',
                `mkdir -p /data/memory && echo '${brandB64}' | base64 -d > /data/memory/brand.md && echo '${promptB64}' | base64 -d > /data/system-prompt.md && chown -R 1000:1000 /data`
            ],
            HostConfig: { Binds: [`${configVolName}:/data`] },
        });
        await memContainer.start();
        await memContainer.wait();
        try { await memContainer.remove(); } catch {}
    }

    // 7. Create isolated network
    const isolatedNetName = `c4g-isolated-${containerName}`;
    try {
        await docker.createNetwork({ Name: isolatedNetName, Driver: 'bridge', Internal: true });
        console.log(`  Network ${isolatedNetName} created.`);
    } catch (e) {
        if (e.message && e.message.includes('already exists')) {
            console.log(`  Network ${isolatedNetName} already exists.`);
        }
    }

    // 8. Remove existing container if any
    try {
        const existing = docker.getContainer(containerName);
        await existing.remove({ force: true });
        console.log('  Removed existing container.');
    } catch {}

    // 9. Create the container
    console.log('\nCreating container...');
    const container = await docker.createContainer({
        Image: OPENCLAW_IMAGE,
        name: containerName,
        User: '1000:1000',
        Env: [
            'HOST=0.0.0.0',
            `PORT=${DEPLOYED_PORT}`,
            `MINIMAX_API_KEY=${env.MINIMAX_API_KEY || ''}`,
            `COMPOSIO_API_KEY=${env.COMPOSIO_API_KEY || ''}`,
            `USER_ID=${instance.user_id}`,
            `INSTANCE_ID=${instance.id}`,
        ],
        Labels: {
            'caddy': `${instance.subdomain}.claw4growth.com`,
            'caddy.reverse_proxy': `{{upstreams ${DEPLOYED_PORT}}}`,
            'managed-by': 'claw4growth',
            'c4g.subdomain': instance.subdomain,
        },
        ExposedPorts: { [`${DEPLOYED_PORT}/tcp`]: {} },
        Healthcheck: {
            Test: ['CMD', 'node', 'dist/index.js', 'health'],
            Interval: 30000000000,
            Timeout: 10000000000,
            Retries: 3,
            StartPeriod: 60000000000,
        },
        HostConfig: {
            Memory: 2048 * 1024 * 1024,
            NanoCpus: 2000000000,
            PidsLimit: 500,
            NetworkMode: DOCKER_NETWORK,
            Binds: [
                `${configVolName}:/home/node/.openclaw`,
                `${workspaceVolName}:/home/node/.openclaw/workspace`,
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
        if (nets.length > 0) {
            await docker.getNetwork(nets[0].Id).connect({ Container: container.id });
        }
    } catch {}

    // 10. Start
    console.log('Starting container...');
    await container.start();
    console.log(`  Container ID: ${container.id.substring(0, 12)}`);

    // 11. Update Supabase
    const result = await supabaseUpdate('c4g_instances', `id=eq.${instance.id}`, {
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
