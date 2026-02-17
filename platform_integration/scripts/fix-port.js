
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

async function fixPort() {
    console.log('🔧 Fixing container port configuration (3000 -> 18789)...');
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
        const newLabels = { ...info.Config.Labels };
        // Update caddy label 
        newLabels['caddy.reverse_proxy'] = '{{upstreams 18789}}';

        const newConfig = {
            name: oldName,
            Image: info.Config.Image,
            User: info.Config.User,
            Labels: newLabels,
            Env: info.Config.Env,
            HostConfig: info.HostConfig,
            ExposedPorts: { '18789/tcp': {} }, // Expose the correct port
            Healthcheck: info.Config.Healthcheck
        };

        // Stop and remove old container
        console.log('Stopping and removing old container...');
        await container.stop().catch(() => { });
        await container.remove();

        // Create new container
        console.log('Creating new container pointing to 18789...');
        const newContainer = await docker.createContainer(newConfig);

        // Start it
        console.log('Starting new container...');
        await newContainer.start();
        console.log(`✅ Container recreated with ID: ${newContainer.id.substring(0, 12)}`);

        // Connect to secondary networks
        const networks = info.NetworkSettings.Networks;
        for (const netName of Object.keys(networks)) {
            if (netName !== info.HostConfig.NetworkMode) {
                console.log(`Connecting to secondary network: ${netName}`);
                const net = docker.getNetwork(netName);
                await net.connect({ Container: newContainer.id });
            }
        }

    } catch (err) {
        console.error('❌ Error fixing port:', err);
    }
}

fixPort();
