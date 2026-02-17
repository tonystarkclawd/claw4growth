
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

async function killPort80() {
    console.log('🔪 Attempting to kill process on port 80...');
    try {
        // 1. Pull alpine
        console.log('Pulling alpine:latest...');
        const stream = await docker.pull('alpine:latest');
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
        });
        console.log('Image pulled.');

        // 2. Run alpine with host PID and Networking to kill process
        // Using fuser to kill process on port 80
        await docker.run(
            'alpine:latest',
            ['sh', '-c', 'apk add --no-cache psmisc; fuser -k 80/tcp; echo "Killed process on port 80"'],
            process.stdout,
            {
                HostConfig: {
                    NetworkMode: 'host',
                    PidMode: 'host',
                    Privileged: true
                },
                AutoRemove: true
            }
        );
    } catch (err) {
        console.error('❌ Error killing port 80:', err);
    }
}

killPort80();
