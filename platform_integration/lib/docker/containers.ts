import Docker from 'dockerode';
import { getDockerClient } from '@/lib/docker/client';
import {
  getCaddyLabels,
  getContainerResourceLimits,
  OPENCLAW_IMAGE,
  DOCKER_NETWORK,
  ISOLATED_NETWORK_PREFIX,
} from '@/lib/docker/labels';
import { brandConfig } from '@/lib/config/brand';
import type { SubscriptionTier } from '@/types/billing';
import {
  generateBrandMemory,
  generateSystemPrompt,
  generateOpenClawConfigWithMemory,
  type OnboardingData,
} from '@/lib/memory/memory-generator';

/** Image pull timeout: 5 minutes */
const IMAGE_PULL_TIMEOUT_MS = 300_000;

/**
 * Generates the OpenClaw configuration JSON.
 * OpenClaw reads config from ~/.openclaw/openclaw.json.
 *
 * @param openclawModelId - Model ID in OpenClaw format (e.g., "anthropic/claude-opus-4-6")
 * @returns JSON string for openclaw.json
 */
export function generateOpenClawConfig(openclawModelId: string): string {
  return JSON.stringify({ agent: { model: openclawModelId } });
}

const BUSYBOX_IMAGE = 'busybox:latest';

/**
 * Writes the openclaw.json config file into the container's mounted config volume.
 * Uses a temporary busybox container to write the file since the data path is on the VPS.
 */
async function writeOpenClawConfig(
  docker: Docker,
  configVolumeName: string,
  configJson: string
): Promise<void> {
  await ensureImageExists(docker, BUSYBOX_IMAGE);

  // Use base64 encoding to avoid any shell interpolation issues
  const b64 = Buffer.from(configJson).toString('base64');
  const tmpContainer = await docker.createContainer({
    Image: BUSYBOX_IMAGE,
    Cmd: ['sh', '-c', `mkdir -p /data && echo '${b64}' | base64 -d > /data/openclaw.json && chown -R 1000:1000 /data`],
    HostConfig: {
      Binds: [`${configVolumeName}:/data`],
    },
  });
  await tmpContainer.start();
  await tmpContainer.wait();
  // Clean up the temporary container (don't use AutoRemove to avoid race with wait)
  try { await tmpContainer.remove(); } catch { /* already gone */ }
}

/**
 * Writes brand memory and system prompt files into the container's config volume.
 * Creates:
 *   /data/memory/brand.md — brand context, industry, tone
 *   /data/system-prompt.md — agent personality and operational rules
 *
 * Uses a temporary busybox container to write files into the Docker volume.
 */
export async function writeMemoryFiles(
  docker: Docker,
  configVolumeName: string,
  onboardingData: OnboardingData
): Promise<void> {
  await ensureImageExists(docker, BUSYBOX_IMAGE);

  const brandMemory = generateBrandMemory(onboardingData);
  const systemPrompt = generateSystemPrompt(onboardingData);

  // Base64 encode both files to avoid shell interpolation issues
  const brandB64 = Buffer.from(brandMemory).toString('base64');
  const promptB64 = Buffer.from(systemPrompt).toString('base64');

  const cmd = [
    'sh', '-c',
    `mkdir -p /data/memory && ` +
    `echo '${brandB64}' | base64 -d > /data/memory/brand.md && ` +
    `echo '${promptB64}' | base64 -d > /data/system-prompt.md && ` +
    `chown -R 1000:1000 /data`,
  ];

  const tmpContainer = await docker.createContainer({
    Image: BUSYBOX_IMAGE,
    Cmd: cmd,
    HostConfig: {
      Binds: [`${configVolumeName}:/data`],
    },
  });
  await tmpContainer.start();
  await tmpContainer.wait();
  try { await tmpContainer.remove(); } catch { /* already gone */ }

  console.log(`[docker] Memory files written to volume ${configVolumeName}`);
}

/**
 * Ensures the deployed product Docker image exists on the VPS.
 * Pulls the image if not found locally, with a 5-minute timeout.
 *
 * @param docker - Dockerode client instance
 * @param image - Docker image name with tag (e.g., "ghcr.io/openclaw/openclaw:latest")
 * @throws {Error} If image pull fails or times out
 */
async function ensureImageExists(docker: Docker, image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
  } catch {
    // Image not found locally — pull it
    console.log(`[docker] Image ${image} not found locally, pulling...`);
    const stream = await docker.pull(image);
    const pullPromise = new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Image pull timed out after ${IMAGE_PULL_TIMEOUT_MS / 1000}s`)), IMAGE_PULL_TIMEOUT_MS);
    });
    try {
      await Promise.race([pullPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
    console.log(`[docker] Image ${image} pulled successfully.`);
  }
}

/**
 * Creates and starts a deployed product container for a user.
 *
 * @param userId - User ID for container naming and data volumes
 * @param subdomain - Subdomain for Caddy routing
 * @param env - Environment variables to pass to the container (e.g., API keys)
 * @param options - Optional settings for container creation
 * @param options.openclawModelId - OpenClaw model ID (e.g., "anthropic/claude-opus-4-6") for config file
 * @param options.onboardingData - Onboarding data to generate memory/soul files
 * @param options.tier - Subscription tier for resource limits (defaults to base limits)
 * @returns Container ID
 * @throws {Error} If container creation or start fails
 */
export async function createAndStartContainer(
  userId: string,
  subdomain: string,
  env: Record<string, string>,
  options?: { openclawModelId?: string; onboardingData?: OnboardingData; tier?: SubscriptionTier }
): Promise<string> {
  try {
    const docker = getDockerClient();

    // Ensure the image exists on the VPS (pulls if missing)
    await ensureImageExists(docker, OPENCLAW_IMAGE);

    // Convert env object to Docker format: ["KEY=VALUE", ...]
    const envArray = Object.entries(env).map(([key, value]) => `${key}=${value}`);

    // Force binding to all interfaces for Docker networking
    envArray.push('HOST=0.0.0.0');
    envArray.push(`PORT=${brandConfig.app.deployedProductPort}`);

    // Generate container name from brandConfig
    const productSlug = brandConfig.app.deployedProduct.toLowerCase().replace(/\s+/g, '-');
    const containerName = `${productSlug}-${userId}`;

    // NOTE: Do NOT set NODE_OPTIONS here. OpenClaw manages its own memory
    // internally and injecting --max-old-space-size causes startup crashes.

    // Create Docker volumes with size limits (tmpfs-backed, 1GB each)
    const configVolumeName = `${containerName}-config`;
    const workspaceVolumeName = `${containerName}-workspace`;

    for (const volName of [configVolumeName, workspaceVolumeName]) {
      try {
        await docker.createVolume({
          Name: volName,
          Driver: 'local',
          Labels: { 'managed-by': 'clawwrapper', 'container': containerName },
          DriverOpts: { 'o': 'size=1g', 'device': 'tmpfs', 'type': 'tmpfs' },
        });
      } catch (volErr) {
        // Volume may already exist
        const msg = volErr instanceof Error ? volErr.message : String(volErr);
        if (!msg.includes('already exists')) throw volErr;
      }
    }

    // Write openclaw.json config (with memory paths if onboarding data provided)
    if (options?.openclawModelId) {
      const hasMemory = !!options.onboardingData;
      const configJson = hasMemory
        ? generateOpenClawConfigWithMemory(options.openclawModelId, true)
        : generateOpenClawConfig(options.openclawModelId);
      await writeOpenClawConfig(docker, configVolumeName, configJson);
    }

    // Write memory and soul files from onboarding data
    if (options?.onboardingData) {
      await writeMemoryFiles(docker, configVolumeName, options.onboardingData);
    }

    // Create per-container isolated network to prevent inter-container communication
    const isolatedNetworkName = `${ISOLATED_NETWORK_PREFIX}${containerName}`;
    let isolatedNetwork: Docker.Network | null = null;
    try {
      isolatedNetwork = await docker.createNetwork({
        Name: isolatedNetworkName,
        Driver: 'bridge',
        Internal: true, // No outbound internet — only for isolation
        Labels: { 'managed-by': 'clawwrapper', 'container': containerName },
      });
    } catch (netErr) {
      // Network may already exist from a previous failed attempt
      const nets = await docker.listNetworks({ filters: { name: [isolatedNetworkName] } });
      if (nets.length > 0) {
        isolatedNetwork = docker.getNetwork(nets[0].Id);
      } else {
        throw netErr;
      }
    }

    // Create the container with security hardening
    const container = await docker.createContainer({
      Image: OPENCLAW_IMAGE,
      name: containerName,
      User: '1000:1000',
      Env: envArray,
      Labels: getCaddyLabels(subdomain),
      ExposedPorts: {
        [`${brandConfig.app.deployedProductPort}/tcp`]: {},
      },
      Healthcheck: {
        Test: ['CMD', 'node', 'dist/index.js', 'health'],
        Interval: 30_000_000_000,   // 30s in nanoseconds
        Timeout: 10_000_000_000,    // 10s
        Retries: 3,
        StartPeriod: 60_000_000_000, // 60s startup grace
      },
      HostConfig: {
        ...getContainerResourceLimits(options?.tier),
        NetworkMode: DOCKER_NETWORK,
        Binds: [
          `${configVolumeName}:/home/node/.openclaw`,
          `${workspaceVolumeName}:/home/node/.openclaw/workspace`,
        ],
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        ReadonlyRootfs: true,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=100m',
          '/var/tmp': 'rw,noexec,nosuid,size=100m',
          '/run': 'rw,noexec,nosuid,size=50m',
        },
      },
    });

    // Also connect to the isolated network (container is already on caddy network via NetworkMode)
    if (isolatedNetwork) {
      await isolatedNetwork.connect({ Container: container.id });
    }

    // Start the container
    await container.start();

    return container.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create and start container: ${message}`);
  }
}

/**
 * Checks if a Docker error indicates the container was not found.
 */
function isContainerNotFound(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return msg.includes('no such container') || msg.includes('is not running');
}

/**
 * Stops a running container.
 *
 * @param containerId - ID of the container to stop
 * @throws {Error} If container stop fails
 */
export async function stopContainer(containerId: string): Promise<void> {
  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerId);
    await container.stop({ t: 10 }); // 10 second timeout before force kill
  } catch (error) {
    if (isContainerNotFound(error)) {
      throw new Error(`Container ${containerId} not found — it may have been removed`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to stop container: ${message}`);
  }
}

/**
 * Starts a stopped container.
 *
 * @param containerId - ID of the container to start
 * @throws {Error} If container start fails
 */
export async function startContainer(containerId: string): Promise<void> {
  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerId);
    await container.start();
  } catch (error) {
    if (isContainerNotFound(error)) {
      throw new Error(`Container ${containerId} not found — it may have been removed`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start container: ${message}`);
  }
}

/**
 * Restarts a container.
 *
 * @param containerId - ID of the container to restart
 * @throws {Error} If container restart fails
 */
export async function restartContainer(containerId: string): Promise<void> {
  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerId);
    await container.restart({ t: 10 }); // 10 second timeout before force kill
  } catch (error) {
    if (isContainerNotFound(error)) {
      throw new Error(`Container ${containerId} not found — it may have been removed`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to restart container: ${message}`);
  }
}

/**
 * Removes a container (stops it first if running).
 *
 * @param containerId - ID of the container to remove
 * @throws {Error} If container removal fails
 */
export async function removeContainer(containerId: string): Promise<void> {
  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerId);

    // Try to stop the container first (ignore 'not running' errors)
    try {
      await container.stop({ t: 10 });
    } catch (stopError) {
      // Ignore errors if container is already stopped
      const message = stopError instanceof Error ? stopError.message : String(stopError);
      if (!message.includes('not running') && !message.includes('already stopped')) {
        throw stopError;
      }
    }

    // Inspect before removing to get container name for network cleanup
    const info = await container.inspect().catch(() => null);
    const containerName = info?.Name?.replace(/^\//, '') || containerId;

    // Remove the container and its volumes
    await container.remove({ v: true });

    // Clean up isolated network
    const isolatedNetworkName = `${ISOLATED_NETWORK_PREFIX}${containerName}`;
    try {
      const net = docker.getNetwork(isolatedNetworkName);
      await net.remove();
    } catch { /* network may not exist or already removed */ }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to remove container: ${message}`);
  }
}

/**
 * Gets the current status of a container.
 *
 * @param containerId - ID of the container to inspect
 * @returns Container status: 'running', 'stopped', or 'error'
 * @throws {Error} If container inspection fails
 */
export async function getContainerStatus(
  containerId: string
): Promise<'running' | 'stopped' | 'error'> {
  try {
    const docker = getDockerClient();
    const container = docker.getContainer(containerId);
    const info = await container.inspect();

    // Check if container is running
    if (!info.State.Running) {
      return 'stopped';
    }

    // Check health status if healthcheck is defined
    const healthStatus = info.State.Health?.Status;
    if (healthStatus === 'unhealthy') {
      return 'error';
    }

    // Container is running and healthy (or no healthcheck defined)
    return 'running';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get container status: ${message}`);
  }
}
