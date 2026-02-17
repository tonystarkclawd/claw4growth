import Docker from 'dockerode';

/**
 * Creates a Docker client connected to the Hetzner VPS via TLS.
 *
 * Required env vars:
 *   DOCKER_HOST_IP - IP of the Hetzner VPS (e.g. 168.119.156.2)
 *   DOCKER_TLS_CA - CA certificate (PEM string)
 *   DOCKER_TLS_CERT - Client certificate (PEM string)
 *   DOCKER_TLS_KEY - Client private key (PEM string)
 */
export function getDockerClient(): Docker {
    const host = process.env.DOCKER_HOST_IP;
    const ca = process.env.DOCKER_TLS_CA;
    const cert = process.env.DOCKER_TLS_CERT;
    const key = process.env.DOCKER_TLS_KEY;

    if (!host || !ca || !cert || !key) {
        console.warn(
            'Docker TLS credentials not configured. Container operations will fail.',
            { host: !!host, ca: !!ca, cert: !!cert, key: !!key }
        );
        // Return a client that will fail on use — better than crashing at import time
        return new Docker();
    }

    return new Docker({
        host,
        port: 2376,
        ca,
        cert,
        key,
    });
}
