
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

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

async function patchConfig() {
    console.log('🔧 Patching OpenClaw config to bind 0.0.0.0...');
    try {
        const containers = await docker.listContainers({ all: true });

        // Find OpenClaw container
        const target = containers.find(c => c.Image.includes('openclaw'));
        if (!target) {
            console.log('❌ No OpenClaw container found.');
            return;
        }

        const containerInfo = await docker.getContainer(target.Id).inspect();
        const configMount = containerInfo.Mounts.find(m => m.Destination === '/home/node/.openclaw');

        if (!configMount) {
            console.log('❌ Config mount not found.');
            return;
        }

        console.log(`Found config volume: ${configMount.Name || configMount.Source}`);

        // READ using busybox and PassThrough stream
        // Run as 1000:1000 to ensure we can read/write the same way owner does
        console.log('Reading openclaw.json...');
        let jsonContent = '';
        const logStream = new PassThrough();
        logStream.on('data', (chunk) => jsonContent += chunk.toString());

        await docker.run(
            'busybox',
            ['cat', '/data/openclaw.json'],
            logStream, // Capture Output
            {
                User: '1000:1000',
                HostConfig: {
                    Binds: [`${configMount.Source}:/data`],
                    AutoRemove: true
                }
            }
        );

        console.log('Current Config Length:', jsonContent.length);

        let config = {};
        try {
            config = JSON.parse(jsonContent);
        } catch (e) {
            console.log('⚠️ Failed to parse JSON, starting fresh or content is empty');
        }

        // MODIFY
        if (!config.gateway) config.gateway = {};
        config.gateway.host = '0.0.0.0';
        config.gateway.port = 18789;

        config.server = {
            host: '0.0.0.0',
            port: 18789
        };

        const newJson = JSON.stringify(config, null, 2);
        console.log('New Config:', newJson);

        // WRITE
        const escaped = newJson.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");

        await docker.run(
            'busybox',
            ['sh', '-c', `echo '${escaped}' > /data/openclaw.json`],
            process.stdout,
            {
                User: '1000:1000', // Run as owner
                HostConfig: {
                    Binds: [`${configMount.Source}:/data`],
                    AutoRemove: true
                }
            }
        );

        console.log('✅ Config patched.');

        // RESTART
        console.log('Restarting OpenClaw...');
        const container = docker.getContainer(target.Id);
        await container.restart();
        console.log('✅ Container restarted.');

    } catch (err) {
        console.error('❌ Error patching config:', err);
    }
}

patchConfig();
