
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

async function debug() {
    console.log('🔍 Connecting to VPS Docker...');
    try {
        const containers = await docker.listContainers({ all: true });
        console.log(`Found ${containers.length} containers (running & stopped).`);

        // Find the relevant container (most recent or matching claw4growth)
        // Assuming the image name contains 'openclaw'
        const containerInfo = containers.find(c => c.Image.includes('openclaw')) || containers[0];

        if (!containerInfo) {
            console.log('❌ No containers found.');
            return;
        }

        console.log(`\n📋 Inspecting Container: ${containerInfo.Names[0]} (${containerInfo.Id.substring(0, 12)})`);
        console.log(`Status: ${containerInfo.Status}`);
        console.log(`State: ${containerInfo.State}`);

        const container = docker.getContainer(containerInfo.Id);

        // Get logs
        const logs = await container.logs({
            stdout: true,
            stderr: true,
            tail: 50,
            timestamps: true
        });

        console.log('\n📜 Last 50 log lines:');
        console.log(logs.toString('utf8'));

    } catch (err) {
        console.error('❌ Error debugging VPS:', err);
    }
}

debug();
