
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

async function debugCaddy() {
    console.log('🔍 Connecting to VPS Docker (Caddy Logs)...');
    try {
        const containers = await docker.listContainers({ all: true });

        // Find Caddy container
        const caddy = containers.find(c => c.Names.some(n => n.includes('caddy')));

        if (!caddy) {
            console.log('❌ Caddy container not found!');
            return;
        }

        console.log(`\n📋 Inspecting Caddy: ${caddy.Names[0]} (${caddy.Id.substring(0, 12)})`);
        console.log(`Status: ${caddy.Status}`);

        const container = docker.getContainer(caddy.Id);

        // Get logs
        const logs = await container.logs({
            stdout: true,
            stderr: true,
            tail: 100, // Get more logs for SSL debugging
            timestamps: true
        });

        console.log('\n📜 Last 100 log lines:');
        console.log(logs.toString('utf8'));

    } catch (err) {
        console.error('❌ Error debugging Caddy:', err);
    }
}

debugCaddy();
