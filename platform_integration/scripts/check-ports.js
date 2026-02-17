
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

async function checkPorts() {
    console.log('🕵️‍♀️ Checking VPS ports via temporary container...');
    try {
        // Run busybox with host networking to check ports
        await docker.run(
            'busybox',
            ['netstat', '-tulpn'],
            process.stdout,
            {
                HostConfig: { NetworkMode: 'host' },
                AutoRemove: true
            }
        );
    } catch (err) {
        console.error('❌ Error checking ports:', err);
    }
}

checkPorts();
