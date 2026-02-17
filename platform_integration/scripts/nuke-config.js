
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

async function nukeConfig() {
    console.log('🗑️ Nuking OpenClaw config...');
    try {
        const containers = await docker.listContainers({ all: true });

        // Find OpenClaw container
        const target = containers.find(c => c.Image.includes('openclaw'));
        if (!target) {
            console.log('❌ No OpenClaw container found.');
            return;
        }

        const containerInfo = await docker.getContainer(target.Id).inspect();
        const configMount = containerInfo.Mounts.find(m => m.Destination === '/home/node/.openclaw');

        if (!configMount) {
            console.log('❌ Config mount not found.');
            return;
        }

        // Use busybox to remove the file
        // Running as 0 (root) should be able to remove files owned by any user if volume permissions allow
        // If not, try 1000:1000
        await docker.run(
            'busybox',
            ['rm', '-f', '/data/openclaw.json'],
            process.stdout,
            {
                User: '0',
                HostConfig: {
                    Binds: [`${configMount.Source}:/data`],
                    AutoRemove: true
                }
            }
        );

        console.log('✅ Config nuked.');

    } catch (err) {
        console.error('❌ Error nuking config:', err);
    }
}

nukeConfig();
