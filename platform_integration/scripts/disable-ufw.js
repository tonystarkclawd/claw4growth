
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

async function disableUFW() {
    console.log('🛡️ Disabling UFW on VPS (relying on Cloud Firewall)...');
    try {
        // 1. Pull alpine if needed
        await docker.pull('alpine:latest');

        // 2. Run ufw disable via privileged container
        await docker.run(
            'alpine:latest',
            ['sh', '-c', 'apk add --no-cache ufw; ufw disable; echo "UFW Disabled"'],
            process.stdout,
            {
                HostConfig: {
                    NetworkMode: 'host',
                    Privileged: true
                },
                AutoRemove: true
            }
        );
    } catch (err) {
        console.error('❌ Error disabling UFW:', err);
    }
}

disableUFW();
