
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

async function inspectEnv() {
    console.log('🔍 Inspecting OpenClaw Container Env...');
    try {
        const containers = await docker.listContainers({ all: true });

        // Find containers to inspect
        const target = containers.find(c => c.Image.includes('openclaw') && c.State === 'running');

        if (!target) {
            console.log('⚠️ No running OpenClaw container found.');
            return;
        }

        const container = docker.getContainer(target.Id);
        const info = await container.inspect();

        console.log(`📦 Container: ${info.Name}`);
        console.log('🔑 Environment Variables (HOST/PORT):');
        const envVars = info.Config.Env.filter(e => e.startsWith('HOST') || e.startsWith('PORT'));
        console.log(envVars);

    } catch (err) {
        console.error('❌ Error inspecting env:', err);
    }
}

inspectEnv();
