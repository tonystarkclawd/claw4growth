/**
 * POST /api/telegram/webhook
 *
 * Telegram webhook handler for bot updates.
 * Validates webhook secret and handles /start command with pairing code.
 *
 * Note: Uses direct Telegram Bot API calls via fetch instead of Telegraf library.
 * Telegraf is designed for long-polling mode, not serverless webhook handlers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { approvePairing } from '@/lib/telegram/pairing';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
  };
}

/**
 * Send a message via Telegram Bot API
 */
async function sendTelegramMessage(
  chatId: number,
  text: string
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN not configured');
    return;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });
}

export async function POST(request: NextRequest) {
  // Validate webhook secret
  const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expectedSecret || secretToken !== expectedSecret) {
    console.error('Invalid webhook secret token');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Parse update
    const update: TelegramUpdate = await request.json();

    // Handle /start command
    if (update.message?.text?.startsWith('/start')) {
      const chatId = update.message.chat.id;
      const telegramId = update.message.from?.id;

      if (!telegramId) {
        return NextResponse.json({ ok: true });
      }

      // Extract code from /start parameter
      const parts = update.message.text.split(' ');
      if (parts.length < 2) {
        await sendTelegramMessage(
          chatId,
          'Welcome! To pair your account, generate a pairing code from your dashboard.'
        );
        return NextResponse.json({ ok: true });
      }

      const code = parts[1];

      // Attempt to approve pairing
      const success = await approvePairing(code, telegramId);

      if (success) {
        await sendTelegramMessage(
          chatId,
          '✅ *Account paired successfully!*\n\nYour Telegram account is now connected.'
        );
      } else {
        await sendTelegramMessage(
          chatId,
          '❌ *Pairing failed*\n\nThe code is invalid or has expired. Please generate a new code from your dashboard.'
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ ok: true }); // Return 200 to prevent retries
  }
}
