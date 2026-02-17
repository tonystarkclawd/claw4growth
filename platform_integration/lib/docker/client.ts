/**
 * Docker client for managing containers on the VPS.
 * Uses Dockerode to connect to the Docker daemon.
 * 
 * In production, DOCKER_HOST should point to the VPS Docker socket.
 * For Vercel deployment (no Docker), calls will fail gracefully at runtime.
 */

import Docker from 'dockerode';

let _client: Docker | null = null;

export function getDockerClient(): Docker {
    if (!_client) {
        const socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
        const host = process.env.DOCKER_HOST;
        const port = process.env.DOCKER_PORT ? parseInt(process.env.DOCKER_PORT) : undefined;

        if (host) {
            _client = new Docker({ host, port: port || 2376 });
        } else {
            _client = new Docker({ socketPath });
        }
    }
    return _client;
}

export async function listContainers(): Promise<Docker.ContainerInfo[]> {
    const docker = getDockerClient();
    return docker.listContainers({ all: true });
}
