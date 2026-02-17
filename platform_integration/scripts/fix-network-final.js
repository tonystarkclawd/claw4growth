
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');

// Load env vars
const envLocalPath = path.resolve(__dirname, '../.env.local');
const env = {};

try {
    const envContent = fs.readFileSync(envLocalPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            value = value.replace(/\\n/g, '\n');
            env[key] = value;
        }
    });
} catch (err) {
    console.error('Error reading .env.local:', err);
    process.exit(1);
}

const docker = new Docker({
    host: env.DOCKER_HOST_IP,
    port: 2376,
    ca: env.DOCKER_TLS_CA,
    cert: env.DOCKER_TLS_CERT,
    key: env.DOCKER_TLS_KEY,
});

async function fixNetworkFinal() {
    console.log('🔧 Applying Shotgun Network Fix (All Env Vars, DELETE NODE_OPTIONS)...');
    try {
        const containers = await docker.listContainers({ all: true });

        // Find the user's openclaw container
        const target = containers.find(c => c.Image.includes('openclaw'));

        if (!target) {
            console.log('❌ No OpenClaw container found.');
            return;
        }

        const container = docker.getContainer(target.Id);
        const info = await container.inspect();
        const oldName = info.Name.replace(/^\//, '');

        console.log(`found container: ${oldName} (${target.Id.substring(0, 12)})`);

        // Prepare new config based on old one
        // We keep existing Env and Add/Overwrite our list
        const envMap = new Map();
        info.Config.Env.forEach(e => {
            const parts = e.split('=');
            const k = parts[0];
            const v = parts.slice(1).join('='); // Handle values with =
            envMap.set(k, v);
        });

        // SHOTGUN ENV VARS
        envMap.set('HOST', '0.0.0.0');
        envMap.set('HOSTNAME', '0.0.0.0');
        envMap.set('IP', '0.0.0.0');
        envMap.set('BIND', '0.0.0.0');
        envMap.set('SERVER_HOST', '0.0.0.0');
        envMap.set('GATEWAY_HOST', '0.0.0.0');
        envMap.set('PORT', '18789'); // Ensure it matches exposed port

        // DELETE NODE_OPTIONS TO FIX CRASH
        envMap.delete('NODE_OPTIONS');

        const newEnv = Array.from(envMap.entries()).map(([k, v]) => `${k}=${v}`);

        // Ensure Caddy label points to 18789
        const newLabels = { ...info.Config.Labels };
        newLabels['caddy.reverse_proxy'] = '{{upstreams 18789}}';

        const newConfig = {
            name: oldName,
            Image: info.Config.Image,
            User: info.Config.User,
            Labels: newLabels,
            Env: newEnv,
            HostConfig: {
                ...info.HostConfig,
                NetworkMode: 'caddy'
            },
            ExposedPorts: { '18789/tcp': {} },
            Healthcheck: info.Config.Healthcheck
        };

        // Stop and remove old container
        console.log('Stopping and removing old container...');
        await container.stop().catch(() => { });
        await container.remove();

        // Create new container
        console.log('Creating new container with ALL env vars...');
        const newContainer = await docker.createContainer(newConfig);

        // Start it
        console.log('Starting new container...');
        await newContainer.start();
        console.log(`✅ Container recreated with ID: ${newContainer.id.substring(0, 12)}`);

    } catch (err) {
        console.error('❌ Error fixing network:', err);
    }
}

fixNetworkFinal();
