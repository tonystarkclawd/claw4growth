import { createServerClient } from '@/lib/supabase/server';
import { Instance, InstanceConfig, InstanceWithConfig, InstanceStatus } from '@/types/instance';
import { encrypt, decrypt } from '@/lib/crypto';
import { getModelById } from '@/lib/models/available-models';

/**
 * Fetches the authenticated user's instance with config.
 *
 * Since v1 enforces one instance per user, this returns a single record or null.
 * Uses RLS via server Supabase client (user context from cookies).
 *
 * @returns The user's instance with config, or null if none exists
 * @throws {Error} If Supabase query fails
 */
export async function getUserInstance(): Promise<InstanceWithConfig | null> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('instances')
    .select(`
      *,
      config:instance_configs(*)
    `)
    .single();

  if (error) {
    // If no instance exists, return null (not an error)
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch user instance: ${error.message}`);
  }

  return data as InstanceWithConfig;
}

/**
 * Creates a new instance for the authenticated user.
 *
 * Initial status is 'provisioning'. The one_instance_per_user constraint
 * at the database level will prevent creating multiple instances.
 *
 * @param subdomain - Unique subdomain for the instance
 * @returns The created instance record
 * @throws {Error} If user already has an instance or Supabase query fails
 */
export async function createInstance(subdomain: string): Promise<Instance> {
  const supabase = createServerClient();

  // Get the authenticated user ID
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('User must be authenticated to create an instance');
  }

  const { data, error } = await supabase
    .from('instances')
    .insert({
      user_id: user.id,
      subdomain,
      status: 'provisioning' as InstanceStatus,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') { // Unique constraint violation
      throw new Error('User already has an instance');
    }
    throw new Error(`Failed to create instance: ${error.message}`);
  }

  return data;
}

/**
 * Updates the status of an instance.
 *
 * @param instanceId - ID of the instance to update
 * @param status - New status value
 * @param containerId - Optional container ID to set
 * @param errorMessage - Optional error message to set
 * @throws {Error} If Supabase query fails
 */
export async function updateInstanceStatus(
  instanceId: string,
  status: InstanceStatus,
  containerId?: string,
  errorMessage?: string
): Promise<void> {
  const supabase = createServerClient();

  const updates: Partial<Instance> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (containerId !== undefined) {
    updates.container_id = containerId;
  }

  if (errorMessage !== undefined) {
    updates.error_message = errorMessage;
  }

  const { error } = await supabase
    .from('instances')
    .update(updates)
    .eq('id', instanceId);

  if (error) {
    throw new Error(`Failed to update instance status: ${error.message}`);
  }
}

/**
 * Deletes an instance and its config (cascade delete).
 *
 * @param instanceId - ID of the instance to delete
 * @throws {Error} If Supabase query fails
 */
export async function deleteInstance(instanceId: string): Promise<void> {
  const supabase = createServerClient();

  const { error } = await supabase
    .from('instances')
    .delete()
    .eq('id', instanceId);

  if (error) {
    throw new Error(`Failed to delete instance: ${error.message}`);
  }
}

/**
 * Upserts instance configuration with encrypted API keys.
 *
 * API keys are encrypted before storage. Only non-empty keys are encrypted.
 * Empty or undefined keys are stored as null.
 *
 * @param instanceId - ID of the instance
 * @param config - Configuration object with optional API keys and model preference
 * @throws {Error} If Supabase query fails or encryption fails
 */
export async function upsertInstanceConfig(
  instanceId: string,
  config: {
    anthropicKey?: string;
    openaiKey?: string;
    telegramBotToken?: string;
    modelPreference?: string;
  }
): Promise<void> {
  const supabase = createServerClient();

  const configData: Partial<InstanceConfig> = {
    instance_id: instanceId,
  };

  // Encrypt API keys if provided and non-empty
  if (config.anthropicKey && config.anthropicKey.trim() !== '') {
    configData.anthropic_key_encrypted = encrypt(config.anthropicKey);
  } else if (config.anthropicKey === '') {
    configData.anthropic_key_encrypted = null;
  }

  if (config.openaiKey && config.openaiKey.trim() !== '') {
    configData.openai_key_encrypted = encrypt(config.openaiKey);
  } else if (config.openaiKey === '') {
    configData.openai_key_encrypted = null;
  }

  if (config.telegramBotToken && config.telegramBotToken.trim() !== '') {
    configData.telegram_bot_token_encrypted = encrypt(config.telegramBotToken);
  } else if (config.telegramBotToken === '') {
    configData.telegram_bot_token_encrypted = null;
  }

  if (config.modelPreference) {
    configData.model_preference = config.modelPreference;
  }

  const { error } = await supabase
    .from('instance_configs')
    .upsert(configData, { onConflict: 'instance_id' });

  if (error) {
    throw new Error(`Failed to upsert instance config: ${error.message}`);
  }
}

/**
 * Fetches and decrypts instance configuration.
 *
 * @param instanceId - ID of the instance
 * @returns Decrypted configuration with API keys and model preference
 * @throws {Error} If Supabase query fails or decryption fails
 */
export async function getInstanceConfig(
  instanceId: string
): Promise<{
  anthropicKey: string | null;
  openaiKey: string | null;
  telegramBotToken: string | null;
  modelPreference: string;
}> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('instance_configs')
    .select('*')
    .eq('instance_id', instanceId)
    .single();

  if (error) {
    // If no config exists, return defaults
    if (error.code === 'PGRST116') {
      return {
        anthropicKey: null,
        openaiKey: null,
        telegramBotToken: null,
        modelPreference: 'claude',
      };
    }
    throw new Error(`Failed to fetch instance config: ${error.message}`);
  }

  // Decrypt API keys if they exist
  const anthropicKey = data.anthropic_key_encrypted
    ? decrypt(data.anthropic_key_encrypted)
    : null;

  const openaiKey = data.openai_key_encrypted
    ? decrypt(data.openai_key_encrypted)
    : null;

  const telegramBotToken = data.telegram_bot_token_encrypted
    ? decrypt(data.telegram_bot_token_encrypted)
    : null;

  return {
    anthropicKey,
    openaiKey,
    telegramBotToken,
    modelPreference: data.model_preference || 'claude',
  };
}

/**
 * Updates the model preference for the authenticated user's instance.
 *
 * Validates that the modelId exists in AVAILABLE_MODELS before updating.
 * Uses RLS-aware server client to ensure user can only update their own instance.
 *
 * @param modelId - The model ID to set as preference
 * @returns Success boolean
 * @throws {Error} If modelId is invalid or Supabase query fails
 */
export async function updateModelPreference(modelId: string): Promise<boolean> {
  // Validate model ID
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Invalid model ID: ${modelId}`);
  }

  const supabase = createServerClient();

  // Get the authenticated user's instance
  const instance = await getUserInstance();
  if (!instance) {
    throw new Error('No instance found for user');
  }

  // Update the model preference
  const { error } = await supabase
    .from('instance_configs')
    .upsert({
      instance_id: instance.id,
      model_preference: modelId,
    }, { onConflict: 'instance_id' });

  if (error) {
    throw new Error(`Failed to update model preference: ${error.message}`);
  }

  return true;
}
