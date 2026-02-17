
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

async function catLogs() {
    console.log('🔍 Reading internal OpenClaw logs...');
    try {
        const containers = await docker.listContainers({ all: true });
        const target = containers.find(c => c.Image.includes('openclaw'));
        if (!target) {
            console.log('❌ No OpenClaw container found.');
            return;
        }

        const container = docker.getContainer(target.Id);

        // Find log file
        const lsCmd = await container.exec({
            Cmd: ['sh', '-c', 'ls /tmp/openclaw/*.log'],
            AttachStdout: true,
            AttachStderr: true
        });

        // Helper to run exec and get output
        async function runExec(execCmd) {
            const stream = await execCmd.start();
            let out = '';
            await new Promise((resolve, reject) => {
                docker.modem.demuxStream(stream.output, {
                    write: (chunk) => out += chunk.toString()
                }, process.stderr);
                stream.output.on('end', resolve);
            });
            return out.trim();
        }

        // NOTE: demuxStream might fail in my local env due to docker-modem version?
        // I'll use raw stream reading to be safe like in patch-openclaw-config.js

        const exec = await container.exec({
            Cmd: ['sh', '-c', 'cat /tmp/openclaw/*.log'],
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start();
        // Raw output capture
        let output = '';
        stream.output.on('data', (chunk) => output += chunk.toString()); // Might contain header bytes

        // Wait for end
        await new Promise(r => stream.output.on('end', r));

        // The raw stream from exec usually contains 8-byte headers for stdout/stderr demuxing
        // But since I can't strip them easily without the library working, I'll just print it raw (garbage chars might appear)
        console.log('📜 Logs content:');
        console.log(output.replace(/[^\x20-\x7E\n\r]/g, '')); // Strip non-printable

    } catch (err) {
        console.error('❌ Error reading logs:', err);
    }
}

catLogs();
