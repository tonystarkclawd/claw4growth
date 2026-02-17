
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

async function inspectPackage() {
    console.log('🔍 Inspecting package.json...');
    try {
        const containers = await docker.listContainers({ all: true });

        // Find OpenClaw container
        const target = containers.find(c => c.Image.includes('openclaw'));
        if (!target) {
            console.log('❌ No OpenClaw container found.');
            return;
        }

        const container = docker.getContainer(target.Id);

        // Read package.json via exec
        const exec = await container.exec({
            Cmd: ['cat', 'package.json'],
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start();
        let output = '';
        await new Promise((resolve, reject) => {
            docker.modem.demuxStream(stream.output, {
                write: (chunk) => output += chunk.toString()
            }, process.stderr);
            stream.output.on('end', resolve);
        });

        console.log('📦 Content match:', output.includes('scripts') ? 'Found scripts' : 'No scripts');
        const pkg = JSON.parse(output);
        console.log('Scripts:', pkg.scripts);

        // Also delete the bad config file while we are at it
        console.log('🗑️ Deleting bad openclaw.json...');
        const execRm = await container.exec({
            Cmd: ['rm', '/home/node/.openclaw/openclaw.json'],
            AttachStdout: true,
            AttachStderr: true
        });
        await execRm.start();
        console.log('✅ Config deleted.');

    } catch (err) {
        console.error('❌ Error:', err);
    }
}

inspectPackage();
