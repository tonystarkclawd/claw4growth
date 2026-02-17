/**
 * POST /api/telegram/generate-code
 *
 * Generate a pairing code for the authenticated user.
 * Returns the code and a deep link to open the Telegram bot.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generatePairingCode } from '@/lib/telegram/pairing';

export async function POST() {
  // Check authentication
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // Generate pairing code
    const code = await generatePairingCode(user.id);

    // Build deep link
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    if (!botUsername) {
      return NextResponse.json(
        { error: 'Telegram bot not configured' },
        { status: 500 }
      );
    }

    const deepLink = `https://t.me/${botUsername}?start=${code}`;

    return NextResponse.json({
      code,
      deepLink,
    });
  } catch (error) {
    console.error('Failed to generate pairing code:', error);
    return NextResponse.json(
      { error: 'Failed to generate pairing code' },
      { status: 500 }
    );
  }
}
