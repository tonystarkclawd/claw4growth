
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

async function restartContainers() {
    console.log('🔄 Restarting Caddy and OpenClaw containers...');
    try {
        const containers = await docker.listContainers({ all: true });

        // Find containers to restart
        const targets = containers.filter(c =>
            c.Names.some(n => n.includes('caddy') || n.includes('openclaw'))
        );

        if (targets.length === 0) {
            console.log('⚠️ No relevant containers found to restart.');
            return;
        }

        for (const c of targets) {
            console.log(`🚀 Starting ${c.Names[0]} (${c.Status})...`);
            try {
                await docker.getContainer(c.Id).start();
                console.log('   ✅ Started');
            } catch (err) {
                console.error(`   ❌ Failed: ${err.message}`);
            }
        }
        console.log('Done.');

    } catch (err) {
        console.error('❌ Error restarting containers:', err);
    }
}

restartContainers();
