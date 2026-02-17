/**
 * Instance types for C4G platform.
 */

export type InstanceStatus = 'provisioning' | 'running' | 'stopped' | 'error' | 'deleted';

export interface Instance {
    id: string;
    user_id: string;
    status: InstanceStatus;
    subdomain: string;
    container_id: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * InstanceConfig matches the Supabase `instance_configs` table.
 * API keys are stored encrypted; use encrypt()/decrypt() helpers.
 */
export interface InstanceConfig {
    instance_id: string;
    anthropic_key_encrypted?: string | null;
    openai_key_encrypted?: string | null;
    telegram_bot_token_encrypted?: string | null;
    model_preference?: string;
    onboarding_data?: Record<string, unknown>;
}

export interface InstanceWithConfig extends Instance {
    config?: InstanceConfig;
}
