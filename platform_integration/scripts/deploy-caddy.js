
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

async function deployCaddy() {
    console.log('🚀 Deploying Caddy to VPS...');
    try {
        // 1. Ensure caddy network exists
        const networks = await docker.listNetworks();
        let network = networks.find(n => n.Name === 'caddy');
        if (!network) {
            console.log('Creating caddy network...');
            network = await docker.createNetwork({ Name: 'caddy', Driver: 'bridge' });
        }

        // 2. Ensure image exists (and wait for pull)
        const image = 'lucaslorentz/caddy-docker-proxy:alpine';
        console.log(`Pulling image: ${image}...`);
        const stream = await docker.pull(image);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
        console.log('Image pulled successfully.');

        // 3. Remove existing caddy if any
        const containers = await docker.listContainers({ all: true });
        const existing = containers.find(c => c.Names.some(n => n.includes('caddy')));
        if (existing) {
            console.log('Removing existing caddy container...');
            await docker.getContainer(existing.Id).remove({ force: true });
        }

        // 4. Create and start Caddy
        console.log('Starting Caddy...');
        const container = await docker.createContainer({
            Image: image,
            name: 'caddy',
            RestartPolicy: { Name: 'unless-stopped' },
            HostConfig: {
                NetworkMode: 'caddy',
                PortBindings: {
                    '80/tcp': [{ HostPort: '80' }],
                    '443/tcp': [{ HostPort: '443' }]
                },
                Binds: [
                    '/var/run/docker.sock:/var/run/docker.sock',
                    'caddy_data:/data'
                ]
            },
            Env: [
                'CADDY_INGRESS_NETWORKS=caddy'
            ],
            Dns: ['8.8.8.8', '8.8.4.4']
        });

        await container.start();
        console.log('✅ Caddy deployed successfully!');

    } catch (err) {
        console.error('❌ Error deploying Caddy:', err);
    }
}

deployCaddy();
