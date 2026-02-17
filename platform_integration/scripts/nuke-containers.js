
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

async function nuke() {
    console.log('☢️  Connecting to VPS Docker for cleanup...');
    try {
        const containers = await docker.listContainers({ all: true });

        // Filter for containers created by our system (openclaw or clawwrapper managed)
        const targets = containers.filter(c =>
            (c.Names && c.Names.some(n => n.includes('openclaw') || n.includes('claw4growth'))) ||
            (c.Image && c.Image.includes('openclaw'))
        );

        console.log(`Found ${targets.length} containers to remove.`);

        for (const c of targets) {
            console.log(`💥 Removing container: ${c.Names[0]} (${c.Id.substring(0, 12)})`);
            const container = docker.getContainer(c.Id);
            try {
                await container.remove({ force: true, v: true }); // force stop + remove volumes
                console.log('   ✅ Removed');
            } catch (err) {
                console.error(`   ❌ Failed: ${err.message}`);
            }
        }

        // Prune networks if needed (optional)

    } catch (err) {
        console.error('❌ Error during nuke:', err);
    }
}

nuke();
