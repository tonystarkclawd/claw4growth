
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

async function debugOpenClaw() {
    console.log('🔍 Inspecting OpenClaw Container Logs...');
    try {
        const containers = await docker.listContainers({ all: true });

        // Find containers to inspect
        const target = containers.find(c => c.Image.includes('openclaw'));

        if (!target) {
            console.log('⚠️ No OpenClaw container found.');
            return;
        }

        const container = docker.getContainer(target.Id);
        console.log(`📦 Container: ${target.Names[0]} (${target.Status})`);

        const logs = await container.logs({ stdout: true, stderr: true, tail: 50 });
        console.log('📜 Logs:');
        console.log(logs.toString('utf8'));

    } catch (err) {
        console.error('❌ Error inspecting logs:', err);
    }
}

debugOpenClaw();
