const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) {
        let v = match[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        v = v.replace(/\\n/g, '\n');
        env[match[1].trim()] = v;
    }
});

const docker = new Docker({
    host: env.DOCKER_HOST_IP,
    port: 2376,
    ca: env.DOCKER_TLS_CA,
    cert: env.DOCKER_TLS_CERT,
    key: env.DOCKER_TLS_KEY,
});

async function cleanup() {
    const containers = await docker.listContainers({ all: true });

    // Remove sidecar
    const sidecar = containers.find(c => c.Names[0].includes('sidecar'));
    if (sidecar) {
        console.log('Removing sidecar:', sidecar.Names[0]);
        await docker.getContainer(sidecar.Id).remove({ force: true });
    }

    // Remove openclaw container (will be recreated with correct config)
    const openclaw = containers.find(c => c.Image.includes('openclaw'));
    if (openclaw) {
        console.log('Removing old openclaw:', openclaw.Names[0]);
        await docker.getContainer(openclaw.Id).remove({ force: true });
    }

    // Remove orphan exited containers (alpine, busybox from debug sessions)
    const orphans = containers.filter(c =>
        (c.Image === 'alpine:latest' || c.Image === 'busybox' || c.Image.includes('busybox')) &&
        c.State === 'exited'
    );
    for (const o of orphans) {
        console.log('Removing orphan:', o.Names[0], o.Image);
        await docker.getContainer(o.Id).remove({ force: true });
    }

    // Remove orphan c4g-isolated-* networks
    const networks = await docker.listNetworks();
    const orphanNets = networks.filter(n => n.Name.startsWith('c4g-isolated-'));
    for (const n of orphanNets) {
        console.log('Removing orphan network:', n.Name);
        try { await docker.getNetwork(n.Id).remove(); } catch (e) { console.log('  skip:', e.message); }
    }

    console.log('\nCleanup done. Remaining containers:');
    const remaining = await docker.listContainers({ all: true });
    remaining.forEach(c => console.log(' ', c.Names[0], '|', c.Image, '|', c.State));
    if (remaining.length === 0) console.log('  (none)');
}

cleanup().catch(e => console.error('Error:', e.message));
