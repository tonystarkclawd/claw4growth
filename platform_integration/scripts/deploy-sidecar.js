
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

async function deploySidecar() {
    console.log('🚀 Deploying Socat Sidecar (Alpine)...');
    try {
        const containers = await docker.listContainers({ all: true });

        // Find OpenClaw
        const target = containers.find(c => c.Image.includes('openclaw'));
        if (!target) {
            console.log('❌ No OpenClaw container found.');
            return;
        }

        // Remove existing sidecar
        const sidecarName = `${target.Names[0].replace(/^\//, '')}-sidecar`;
        const existingSidecar = containers.find(c => c.Names.includes(`/${sidecarName}`));
        if (existingSidecar) {
            console.log('Removing existing sidecar...');
            await docker.getContainer(existingSidecar.Id).remove({ force: true });
        }

        const image = 'alpine:latest';

        // Pull image with progress tracking
        console.log(`Pulling ${image}...`);
        const stream = await docker.pull(image);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
        console.log('Image pulled.');

        // Create sidecar
        console.log(`Attaching sidecar to ${target.Id.substring(0, 12)}...`);
        const sidecar = await docker.createContainer({
            Image: image,
            name: sidecarName,
            // Install socat and run it
            Cmd: ['sh', '-c', 'apk add --no-cache socat && socat TCP-LISTEN:3000,fork,bind=0.0.0.0 TCP:127.0.0.1:18789'],
            HostConfig: {
                NetworkMode: `container:${target.Id}`, // Share network namespace
                RestartPolicy: { Name: 'always' }
            }
        });

        await sidecar.start();
        console.log(`✅ Sidecar started: ${sidecar.id.substring(0, 12)}`);

    } catch (err) {
        console.error('❌ Error deploying sidecar:', err);
    }
}

deploySidecar();
