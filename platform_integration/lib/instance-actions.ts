'use server';

import { createServerClient } from '@/lib/supabase/server';
import {
  getUserInstance,
  createInstance,
  updateInstanceStatus,
  deleteInstance as deleteInstanceFromDb,
  upsertInstanceConfig,
  getInstanceConfig,
} from '@/lib/supabase/instance-db';
import {
  createAndStartContainer,
  stopContainer,
  startContainer,
  restartContainer,
  removeContainer,
  getContainerStatus,
} from '@/lib/docker/containers';
import { InstanceStatus } from '@/types/instance';
import { brandConfig } from '@/lib/config/brand';
import { getModelById, getOpenClawModelId, DEFAULT_MODEL_ID } from '@/lib/models/available-models';
import { getSubscriptionStatusByUserId, getSubscriptionTierByUserId } from '@/lib/supabase/billing-db';
import { shouldProvisionAccess } from '@/types/billing';
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'crypto';

const isDevMode = brandConfig.features.enableDevMode;

/**
 * Type for server action responses
 */
type ActionResponse = {
  success: boolean;
  error?: string;
};

/**
 * Authenticates the current user and returns user object
 */
async function authenticateUser() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

/**
 * Checks if the user has an active subscription.
 * Dev mode bypasses this check (no Stripe in dev).
 */
async function requireActiveSubscription(userId: string): Promise<boolean> {
  if (isDevMode) return true;
  const status = await getSubscriptionStatusByUserId(userId);
  return shouldProvisionAccess(status);
}

/**
 * Generates a random 8-character alphanumeric subdomain
 */
function generateSubdomain(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(8);
  let subdomain = '';

  for (let i = 0; i < 8; i++) {
    subdomain += chars[bytes[i] % chars.length];
  }

  return subdomain;
}

/**
 * Deploys a new instance for the authenticated user.
 *
 * Creates database record, encrypts and stores API keys, creates Docker container,
 * and updates status to 'running'. If any step fails, status is set to 'error'.
 *
 * @param formData - Form data containing anthropicKey and openaiKey
 * @returns Success/error response
 */
export async function deployInstance(formData: FormData): Promise<ActionResponse> {
  const user = await authenticateUser();
  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  if (!await requireActiveSubscription(user.id)) {
    return { success: false, error: 'Active subscription required' };
  }

  try {
    // Determine model and provider
    const modelPreference = formData.get('modelPreference')?.toString() || DEFAULT_MODEL_ID;
    const model = getModelById(modelPreference);
    const provider = model?.provider || 'anthropic';

    // Validate the single API key based on selected model's provider
    const anthropicKey = formData.get('anthropicKey')?.toString() || '';
    const openaiKey = formData.get('openaiKey')?.toString() || '';

    if (provider === 'anthropic') {
      if (!anthropicKey || anthropicKey.length < 10) {
        return { success: false, error: 'Anthropic API key is required (min 10 characters)' };
      }
    } else {
      if (!openaiKey || openaiKey.length < 10) {
        return { success: false, error: 'OpenAI API key is required (min 10 characters)' };
      }
    }

    // Check if user already has an instance
    const existingInstance = await getUserInstance();
    if (existingInstance) {
      return { success: false, error: 'You already have an instance. Delete it first to create a new one.' };
    }

    // Generate random subdomain
    const subdomain = generateSubdomain();

    // Create instance record with status 'provisioning'
    const instance = await createInstance(subdomain);

    // Store encrypted API key (only the relevant one)
    await upsertInstanceConfig(instance.id, {
      ...(provider === 'anthropic' ? { anthropicKey } : { openaiKey }),
      modelPreference,
    });

    // Get decrypted keys for container deployment
    const config = await getInstanceConfig(instance.id);

    if (isDevMode) {
      const fakeContainerId = `dev-${instance.id.slice(0, 8)}`;
      await updateInstanceStatus(instance.id, 'running', fakeContainerId);
    } else {
      // Create and start Docker container
      try {
        const containerEnv: Record<string, string> = {};

        if (config.anthropicKey) {
          containerEnv.ANTHROPIC_API_KEY = config.anthropicKey;
        }
        if (config.openaiKey) {
          containerEnv.OPENAI_API_KEY = config.openaiKey;
        }

        if (config.telegramBotToken) {
          containerEnv.TELEGRAM_BOT_TOKEN = config.telegramBotToken;
        } else if (process.env.PLATFORM_TELEGRAM_BOT_TOKEN) {
          containerEnv.TELEGRAM_BOT_TOKEN = process.env.PLATFORM_TELEGRAM_BOT_TOKEN;
        }

        if (config.modelPreference) {
          containerEnv.MODEL_PREFERENCE = config.modelPreference;
        }

        // Resolve OpenClaw model ID and subscription tier for container creation
        const selectedModel = getModelById(config.modelPreference || DEFAULT_MODEL_ID);
        const openclawModelId = selectedModel ? getOpenClawModelId(selectedModel.id) : undefined;
        const tier = (await getSubscriptionTierByUserId(user.id) ?? undefined) as import('@/types/billing').SubscriptionTier | undefined;

        const containerId = await createAndStartContainer(user.id, subdomain, containerEnv, {
          openclawModelId,
          tier,
        });

        // Update status to 'running' with container ID
        await updateInstanceStatus(instance.id, 'running', containerId);
      } catch (dockerError) {
        // If Docker fails, set status to 'error' with error message
        const errorMessage = dockerError instanceof Error ? dockerError.message : String(dockerError);
        await updateInstanceStatus(instance.id, 'error', undefined, errorMessage);
        return { success: false, error: `Failed to deploy container: ${errorMessage}` };
      }
    }

    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Starts a stopped instance.
 *
 * @returns Success/error response
 */
export async function startInstanceAction(): Promise<ActionResponse> {
  const user = await authenticateUser();
  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  if (!await requireActiveSubscription(user.id)) {
    return { success: false, error: 'Active subscription required' };
  }

  try {
    const instance = await getUserInstance();

    if (!instance) {
      return { success: false, error: 'No instance found' };
    }

    if (!isDevMode && !instance.container_id) {
      return { success: false, error: 'Instance has no container ID' };
    }

    if (!isDevMode) {
      await startContainer(instance.container_id!);
    }
    await updateInstanceStatus(instance.id, 'running');

    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Stops a running instance.
 *
 * @returns Success/error response
 */
export async function stopInstanceAction(): Promise<ActionResponse> {
  const user = await authenticateUser();
  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const instance = await getUserInstance();

    if (!instance) {
      return { success: false, error: 'No instance found' };
    }

    if (!isDevMode && !instance.container_id) {
      return { success: false, error: 'Instance has no container ID' };
    }

    if (!isDevMode) {
      await stopContainer(instance.container_id!);
    }
    await updateInstanceStatus(instance.id, 'stopped');

    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Restarts a running instance.
 *
 * @returns Success/error response
 */
export async function restartInstanceAction(): Promise<ActionResponse> {
  const user = await authenticateUser();
  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  if (!await requireActiveSubscription(user.id)) {
    return { success: false, error: 'Active subscription required' };
  }

  try {
    const instance = await getUserInstance();

    if (!instance) {
      return { success: false, error: 'No instance found' };
    }

    if (!isDevMode && !instance.container_id) {
      return { success: false, error: 'Instance has no container ID' };
    }

    if (!isDevMode) {
      await restartContainer(instance.container_id!);
    }
    // Keep status as 'running'

    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Deletes an instance and its container.
 *
 * Removes the Docker container first, then deletes the database record
 * (which cascade deletes the config).
 *
 * @returns Success/error response
 */
export async function deleteInstanceAction(): Promise<ActionResponse> {
  const user = await authenticateUser();
  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const instance = await getUserInstance();

    if (!instance) {
      return { success: false, error: 'No instance found' };
    }

    // Remove Docker container if it exists (skip in dev mode)
    if (!isDevMode && instance.container_id) {
      try {
        await removeContainer(instance.container_id);
      } catch (dockerError) {
        // Only ignore "container not found" errors (already removed)
        const errMsg = (dockerError instanceof Error ? dockerError.message : String(dockerError)).toLowerCase();
        const alreadyGone = errMsg.includes('no such container');
        if (!alreadyGone) {
          return { success: false, error: `Failed to remove container: ${errMsg}` };
        }
        console.warn('[deleteInstance] Container already removed:', instance.container_id);
      }
    }

    // Delete instance from database (cascade deletes config)
    await deleteInstanceFromDb(instance.id);

    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Updates API keys for an instance.
 *
 * If the instance is running, removes the old container and creates a new one
 * with the updated environment variables.
 *
 * @param formData - Form data containing new anthropicKey and openaiKey
 * @returns Success/error response
 */
export async function updateApiKeysAction(formData: FormData): Promise<ActionResponse> {
  const user = await authenticateUser();
  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  if (!await requireActiveSubscription(user.id)) {
    return { success: false, error: 'Active subscription required' };
  }

  try {
    const instance = await getUserInstance();

    if (!instance) {
      return { success: false, error: 'No instance found' };
    }

    // Determine which provider key to validate based on current model
    const currentConfig = await getInstanceConfig(instance.id);
    const model = getModelById(currentConfig.modelPreference);
    const provider = model?.provider || 'anthropic';

    const anthropicKey = formData.get('anthropicKey')?.toString() || '';
    const openaiKey = formData.get('openaiKey')?.toString() || '';

    if (provider === 'anthropic') {
      if (!anthropicKey || anthropicKey.length < 10) {
        return { success: false, error: 'Anthropic API key is required (min 10 characters)' };
      }
    } else {
      if (!openaiKey || openaiKey.length < 10) {
        return { success: false, error: 'OpenAI API key is required (min 10 characters)' };
      }
    }

    // Update encrypted key in database (only the relevant one)
    await upsertInstanceConfig(instance.id, {
      ...(provider === 'anthropic' ? { anthropicKey } : { openaiKey }),
    });

    // If instance is running, restart container with new environment (skip in dev mode)
    if (!isDevMode && instance.status === 'running' && instance.container_id) {
      try {
        // Remove old container
        await removeContainer(instance.container_id);

        // Get new decrypted keys
        const config = await getInstanceConfig(instance.id);

        // Build container env vars
        const containerEnv: Record<string, string> = {};

        if (config.anthropicKey) {
          containerEnv.ANTHROPIC_API_KEY = config.anthropicKey;
        }
        if (config.openaiKey) {
          containerEnv.OPENAI_API_KEY = config.openaiKey;
        }
        if (config.telegramBotToken) {
          containerEnv.TELEGRAM_BOT_TOKEN = config.telegramBotToken;
        }
        if (config.modelPreference) {
          containerEnv.MODEL_PREFERENCE = config.modelPreference;
        }

        // Create new container with updated keys
        const selectedModel = getModelById(config.modelPreference || DEFAULT_MODEL_ID);
        const openclawModelId = selectedModel ? getOpenClawModelId(selectedModel.id) : undefined;
        const tier = (await getSubscriptionTierByUserId(user.id) ?? undefined) as import('@/types/billing').SubscriptionTier | undefined;

        const containerId = await createAndStartContainer(user.id, instance.subdomain, containerEnv, {
          openclawModelId,
          tier,
        });

        // Update container ID
        await updateInstanceStatus(instance.id, 'running', containerId);
      } catch (dockerError) {
        const errorMessage = dockerError instanceof Error ? dockerError.message : String(dockerError);
        await updateInstanceStatus(instance.id, 'error', undefined, errorMessage);
        return { success: false, error: `Failed to restart container with new keys: ${errorMessage}` };
      }
    }

    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Updates the Telegram bot token for an instance.
 *
 * Encrypts and stores the token. If the instance is running, removes the old
 * container and creates a new one with the updated TELEGRAM_BOT_TOKEN env var.
 *
 * @param formData - Form data containing telegramBotToken
 * @returns Success/error response
 */
export async function updateTelegramBotTokenAction(formData: FormData): Promise<ActionResponse> {
  const user = await authenticateUser();
  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  if (!await requireActiveSubscription(user.id)) {
    return { success: false, error: 'Active subscription required' };
  }

  try {
    const instance = await getUserInstance();

    if (!instance) {
      return { success: false, error: 'No instance found' };
    }

    const telegramBotToken = formData.get('telegramBotToken')?.toString() || '';

    if (!telegramBotToken || telegramBotToken.length < 10) {
      return { success: false, error: 'Bot token is required (min 10 characters)' };
    }

    // Update encrypted token in database
    await upsertInstanceConfig(instance.id, { telegramBotToken });

    // If instance is running, restart container with new environment (skip in dev mode)
    if (!isDevMode && instance.status === 'running' && instance.container_id) {
      try {
        await removeContainer(instance.container_id);

        const config = await getInstanceConfig(instance.id);

        const containerEnv: Record<string, string> = {};

        if (config.anthropicKey) {
          containerEnv.ANTHROPIC_API_KEY = config.anthropicKey;
        }
        if (config.openaiKey) {
          containerEnv.OPENAI_API_KEY = config.openaiKey;
        }
        if (config.telegramBotToken) {
          containerEnv.TELEGRAM_BOT_TOKEN = config.telegramBotToken;
        }
        if (config.modelPreference) {
          containerEnv.MODEL_PREFERENCE = config.modelPreference;
        }

        const selectedModel = getModelById(config.modelPreference || DEFAULT_MODEL_ID);
        const openclawModelId = selectedModel ? getOpenClawModelId(selectedModel.id) : undefined;
        const tier = (await getSubscriptionTierByUserId(user.id) ?? undefined) as import('@/types/billing').SubscriptionTier | undefined;

        const containerId = await createAndStartContainer(user.id, instance.subdomain, containerEnv, {
          openclawModelId,
          tier,
        });
        await updateInstanceStatus(instance.id, 'running', containerId);
      } catch (dockerError) {
        const errorMessage = dockerError instanceof Error ? dockerError.message : String(dockerError);
        await updateInstanceStatus(instance.id, 'error', undefined, errorMessage);
        return { success: false, error: `Failed to restart container with new token: ${errorMessage}` };
      }
    }

    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Refreshes instance status from Docker.
 *
 * Queries the actual Docker container status and updates the database to match.
 *
 * @returns Current status or error
 */
export async function refreshInstanceStatus(): Promise<{
  status?: InstanceStatus;
  error?: string;
}> {
  const user = await authenticateUser();
  if (!user) {
    return { error: 'Unauthorized' };
  }

  try {
    const instance = await getUserInstance();

    if (!instance) {
      return { error: 'No instance found' };
    }

    // In dev mode, just return current DB status
    if (isDevMode) {
      return { status: instance.status };
    }

    // If instance has a container ID, check actual Docker status
    if (instance.container_id) {
      try {
        const containerStatus = await getContainerStatus(instance.container_id);

        // Update database to match actual status
        await updateInstanceStatus(instance.id, containerStatus);

        return { status: containerStatus };
      } catch (dockerError) {
        // Container might not exist anymore
        await updateInstanceStatus(instance.id, 'error', undefined, 'Container not found');
        return { status: 'error' };
      }
    }

    return { status: instance.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}
