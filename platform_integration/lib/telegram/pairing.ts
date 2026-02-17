/**
 * Telegram Pairing Library
 *
 * Handles pairing code generation, validation, and user pairing status.
 * Uses admin client for all operations since webhook handlers run outside user context.
 *
 * Table: c4g_telegram_pairings (see supabase/migrations/005_c4g_schema.sql)
 */

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const TABLE = 'c4g_telegram_pairings';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * Generate a random 6-character alphanumeric pairing code
 */
function generateRandomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Generate a pairing code for a user.
 * Expires any existing pending codes first.
 *
 * @param userId - The authenticated user's ID
 * @param instanceId - The user's instance ID (for faster routing lookups)
 * @returns The 6-character pairing code
 */
export async function generatePairingCode(
  userId: string,
  instanceId?: string
): Promise<string> {
  // Expire any existing pending codes for this user
  await supabaseAdmin
    .from(TABLE)
    .update({ status: 'expired' })
    .eq('user_id', userId)
    .eq('status', 'pending');

  // Generate new code
  const code = generateRandomCode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15 minute expiry

  // Insert new pairing
  const insertData: Record<string, unknown> = {
    user_id: userId,
    code,
    expires_at: expiresAt.toISOString(),
    status: 'pending',
  };

  if (instanceId) {
    insertData.instance_id = instanceId;
  }

  const { error } = await supabaseAdmin.from(TABLE).insert(insertData);

  if (error) {
    throw new Error(`Failed to create pairing code: ${error.message}`);
  }

  return code;
}

/**
 * Approve a pairing by code.
 * Called when user sends /start CODE to the platform bot.
 *
 * @param code - The pairing code from the deep link
 * @param telegramId - The Telegram user ID
 * @returns true if pairing was approved, false if invalid/expired
 */
export async function approvePairing(
  code: string,
  telegramId: number
): Promise<{ success: boolean; instanceId?: string; userId?: string }> {
  // Find pending, non-expired pairing with this code
  const { data: pairing } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('status', 'pending')
    .single();

  if (!pairing) {
    return { success: false };
  }

  // Check if expired
  const now = new Date();
  const expiresAt = new Date(pairing.expires_at);
  if (now > expiresAt) {
    // Mark as expired
    await supabaseAdmin
      .from(TABLE)
      .update({ status: 'expired' })
      .eq('id', pairing.id);
    return { success: false };
  }

  // Approve pairing
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({
      status: 'approved',
      telegram_id: telegramId,
    })
    .eq('id', pairing.id);

  if (error) {
    return { success: false };
  }

  return {
    success: true,
    instanceId: pairing.instance_id,
    userId: pairing.user_id
  };
}

/**
 * Get user's approved pairing status.
 *
 * @param userId - The authenticated user's ID
 * @returns The pairing info or null if not paired
 */
export async function getUserPairing(
  userId: string
): Promise<{ telegram_id: number; status: string; instance_id: string } | null> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select('telegram_id, status, instance_id')
    .eq('user_id', userId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return data || null;
}
