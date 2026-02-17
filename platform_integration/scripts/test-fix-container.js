
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

async function testFix() {
    console.log('🧪 Testing container fix (HOST=0.0.0.0 PORT=3000)...');
    try {
        const image = 'ghcr.io/openclaw/openclaw:latest';

        // Create test container
        const container = await docker.createContainer({
            Image: image,
            name: 'test-fix-container',
            Env: [
                'HOST=0.0.0.0',
                'PORT=3000',
                'NODE_ENV=production'
            ],
            HostConfig: {
                NetworkMode: 'caddy',
                AutoRemove: true
            }
        });

        console.log('Starting test container...');
        await container.start();

        // Wait a few seconds for startup
        await new Promise(r => setTimeout(r, 5000));

        // Get logs
        const logs = await container.logs({ stdout: true, stderr: true });
        console.log('📜 Logs:');
        console.log(logs.toString('utf8'));

        // Cleanup
        console.log('Stopping test container...');
        await container.stop();

    } catch (err) {
        console.error('❌ Error testing fix:', err);
    }
}

testFix();
