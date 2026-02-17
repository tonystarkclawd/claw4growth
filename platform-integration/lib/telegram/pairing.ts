/**
 * Telegram Pairing Library
 *
 * Handles pairing code generation, validation, and user pairing status.
 * Uses admin client for all operations since webhook handlers run outside user context.
 *
 * Required database schema - Run in Supabase SQL Editor:
 *
 * ```sql
 * -- Run in Supabase SQL Editor
 * CREATE TABLE telegram_pairings (
 *   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *   telegram_id BIGINT,
 *   code VARCHAR(8) NOT NULL UNIQUE,
 *   status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'expired')),
 *   expires_at TIMESTAMPTZ NOT NULL,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * ALTER TABLE telegram_pairings ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "Users can read own pairings" ON telegram_pairings FOR SELECT USING (auth.uid() = user_id);
 * CREATE POLICY "Users can insert own pairings" ON telegram_pairings FOR INSERT WITH CHECK (auth.uid() = user_id);
 * CREATE POLICY "Service role full access" ON telegram_pairings FOR ALL USING (true) WITH CHECK (true);
 * ```
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { randomBytes } from 'crypto';

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
 * Generate a pairing code for a user
 *
 * @param userId - The authenticated user's ID
 * @returns The 6-character pairing code
 */
export async function generatePairingCode(userId: string): Promise<string> {
  const admin = createAdminClient();

  // Expire any existing pending codes for this user
  await admin
    .from('telegram_pairings')
    .update({ status: 'expired' })
    .eq('user_id', userId)
    .eq('status', 'pending');

  // Generate new code
  const code = generateRandomCode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15 minute expiry

  // Insert new pairing
  const { error } = await admin.from('telegram_pairings').insert({
    user_id: userId,
    code,
    expires_at: expiresAt.toISOString(),
    status: 'pending',
  });

  if (error) {
    throw new Error(`Failed to create pairing code: ${error.message}`);
  }

  return code;
}

/**
 * Approve a pairing by code
 *
 * @param code - The pairing code from the deep link
 * @param telegramId - The Telegram user ID
 * @returns true if pairing was approved, false otherwise
 */
export async function approvePairing(
  code: string,
  telegramId: number
): Promise<boolean> {
  const admin = createAdminClient();

  // Find pending, non-expired pairing with this code
  const { data: pairing } = await admin
    .from('telegram_pairings')
    .select('*')
    .eq('code', code)
    .eq('status', 'pending')
    .single();

  if (!pairing) {
    return false;
  }

  // Check if expired
  const now = new Date();
  const expiresAt = new Date(pairing.expires_at);
  if (now > expiresAt) {
    // Mark as expired
    await admin
      .from('telegram_pairings')
      .update({ status: 'expired' })
      .eq('id', pairing.id);
    return false;
  }

  // Approve pairing
  const { error } = await admin
    .from('telegram_pairings')
    .update({
      status: 'approved',
      telegram_id: telegramId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pairing.id);

  return !error;
}

/**
 * Get user's pairing status
 *
 * @param userId - The authenticated user's ID
 * @returns The pairing info or null if not paired
 */
export async function getUserPairing(
  userId: string
): Promise<{ telegram_id: number; status: string } | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('telegram_pairings')
    .select('telegram_id, status')
    .eq('user_id', userId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return data || null;
}
