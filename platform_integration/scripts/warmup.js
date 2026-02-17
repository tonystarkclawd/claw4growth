
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
            // Remove quotes if present
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            // Handle multiline keys (PEM files) - simple heuristic for now
            // Actually, .env.local usually has newlines encoded as \n or is single line. 
            // If it's single line "---BEGIN... \n ... END---", we need to unescape \n
            value = value.replace(/\\n/g, '\n');
            env[key] = value;
        }
    });
} catch (err) {
    console.error('Error reading .env.local:', err);
    process.exit(1);
}

const host = env.DOCKER_HOST_IP;
const ca = env.DOCKER_TLS_CA;
const cert = env.DOCKER_TLS_CERT;
const key = env.DOCKER_TLS_KEY;

if (!host || !ca || !cert || !key) {
    console.error('Missing Docker TLS credentials in .env.local');
    process.exit(1);
}

console.log(`🔌 Connecting to Docker Host: ${host}:2376...`);

const docker = new Docker({
    host,
    port: 2376,
    ca,
    cert,
    key,
});

async function warmup() {
    const image = 'ghcr.io/openclaw/openclaw:latest';
    console.log(`⬇️  Pulling image: ${image}... (This may take a while)`);

    try {
        const stream = await docker.pull(image);

        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err, res) => {
                if (err) return reject(err);
                resolve(res);
            }, (event) => {
                if (event.status) {
                    process.stdout.write(`\r${event.status} ${event.progress || ''}`);
                }
            });
        });

        console.log('\n✅ Image pulled successfully!');

        // Check if network 'caddy' exists
        const networks = await docker.listNetworks();
        const caddyNet = networks.find(n => n.Name === 'caddy');
        if (!caddyNet) {
            console.log('🌐 Creating network: caddy');
            await docker.createNetwork({ Name: 'caddy', Driver: 'bridge' });
        } else {
            console.log('🌐 Network caddy already exists.');
        }

    } catch (err) {
        console.error('\n❌ Error during warmup:', err);
    }
}

warmup();
