/**
 * POST /api/telegram/webhook
 * 
 * Platform bot webhook handler.
 * Routes messages from the single @Claw4GrowthBot to user containers.
 * Handles /start for pairing and all other messages for routing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { approvePairing } from '@/lib/telegram/pairing';
import {
  findContainerForTelegramUser,
  forwardToContainer,
  sendTelegramResponse,
  sendTypingAction,
} from '@/lib/telegram/router';
import { createClient } from '@supabase/supabase-js';

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const PLATFORM_BOT_TOKEN = process.env.PLATFORM_TELEGRAM_BOT_TOKEN!;


const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(request: NextRequest) {
  // Verify webhook secret if configured
  if (WEBHOOK_SECRET) {
    const secretHeader = request.headers.get('x-telegram-bot-api-secret-token');
    if (secretHeader !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = await request.json();
    const message = body.message;

    if (!message?.text || !message?.from?.id || !message?.chat?.id) {
      // Ignore non-text messages (stickers, photos, etc.) for now
      return NextResponse.json({ ok: true });
    }

    const telegramId = message.from.id;
    const chatId = message.chat.id;
    const text = message.text.trim();

    // ─── Handle /start command (pairing flow) ───────────────────────
    if (text.startsWith('/start')) {
      return await handleStartCommand(text, telegramId, chatId, message.from.first_name);
    }

    // ─── Handle /help command ───────────────────────────────────────
    if (text === '/help') {
      await sendTelegramResponse(chatId,
        `🤖 *Claw4Growth Bot*\n\n` +
        `I'm your AI marketing operator. Here's how it works:\n\n` +
        `1️⃣ Complete onboarding at claw4growth.com\n` +
        `2️⃣ Pair your account with /start <code>\n` +
        `3️⃣ Send me any marketing task!\n\n` +
        `*Commands:*\n` +
        `/start <code> — Pair your account\n` +
        `/status — Check your operator status\n` +
        `/help — Show this message`
      );
      return NextResponse.json({ ok: true });
    }

    // ─── Handle /status command ─────────────────────────────────────
    if (text === '/status') {
      const container = await findContainerForTelegramUser(telegramId);
      if (!container) {
        await sendTelegramResponse(chatId,
          `❌ No paired account found.\n\n` +
          `Complete onboarding at claw4growth.com and use the pairing code to connect.`
        );
      } else {
        const statusEmoji = container.status === 'running' ? '🟢' : container.status === 'provisioning' ? '🟡' : '🔴';
        await sendTelegramResponse(chatId,
          `${statusEmoji} *Operator Status:* ${container.status}\n` +
          `🌐 Dashboard: https://app.claw4growth.com/dashboard`
        );
      }
      return NextResponse.json({ ok: true });
    }

    // ─── Route message to user's container ──────────────────────────
    const container = await findContainerForTelegramUser(telegramId);

    if (!container) {
      await sendTelegramResponse(chatId,
        `👋 Welcome to Claw4Growth!\n\n` +
        `I don't see a paired account for your Telegram. To get started:\n\n` +
        `1. Go to claw4growth.com and complete the onboarding\n` +
        `2. After deployment, you'll receive a pairing code\n` +
        `3. Send me: /start YOUR_CODE\n\n` +
        `Already have a code? Send it now: /start YOUR_CODE`
      );
      return NextResponse.json({ ok: true });
    }

    if (container.status !== 'running') {
      await sendTelegramResponse(chatId,
        `⏳ Your operator is currently *${container.status}*.\n\n` +
        `It should be ready soon. Try again in a minute!`
      );
      return NextResponse.json({ ok: true });
    }

    // Send typing indicator while processing
    await sendTypingAction(chatId);

    // Forward message to the user's OpenClaw container
    const response = await forwardToContainer(container.containerUrl, text, telegramId);

    // Send the response back to the user
    await sendTelegramResponse(chatId, response);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[webhook] Error processing update:', error);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

/**
 * Handles the /start command for pairing.
 * /start <pairing_code> — pairs the Telegram account with a C4G user.
 * /start (no code) — shows welcome/help message.
 */
async function handleStartCommand(
  text: string,
  telegramId: number,
  chatId: number,
  firstName: string
) {
  const parts = text.split(' ');
  const pairingCode = parts[1];

  if (!pairingCode) {
    // No code provided, check if already paired
    const container = await findContainerForTelegramUser(telegramId);
    if (container) {
      await sendTelegramResponse(chatId,
        `👋 Welcome back, ${firstName}!\n\n` +
        `Your operator is *${container.status}*. Just send me any marketing task and I'll handle it!`
      );
    } else {
      await sendTelegramResponse(chatId,
        `👋 Hey ${firstName}! Welcome to *Claw4Growth*.\n\n` +
        `To connect your AI marketing operator:\n\n` +
        `1. Complete onboarding at claw4growth.com\n` +
        `2. After deployment, you'll receive a pairing code\n` +
        `3. Come back here and send: /start YOUR_CODE\n\n` +
        `Already have a code? Send it now: /start YOUR_CODE`
      );
    }
    return NextResponse.json({ ok: true });
  }

  // Attempt to approve the pairing
  try {
    const result = await approvePairing(pairingCode, telegramId);

    if (result.success && result.instanceId) {
      // Dashboard URL points to the C4G platform dashboard (Composio integrations etc.),
      // NOT the per-container OpenClaw dashboard.
      const dashboardUrl = 'https://app.claw4growth.com/dashboard';

      // 2. Get operator name
      let operatorName = 'Your Operator';
      try {
        const { data: config } = await supabaseAdmin
          .from('c4g_instance_configs')
          .select('onboarding_data')
          .eq('instance_id', result.instanceId)
          .single();

        if (config?.onboarding_data?.operatorName) {
          operatorName = config.onboarding_data.operatorName;
        }
      } catch (err) {
        console.error('Error fetching operator name:', err);
      }

      // 3. Send welcome message
      await sendTelegramResponse(chatId,
        `✅ *Connected Successfully!*\n\n` +
        `👋 Hi ${firstName}, I'm *${operatorName}*.\n` +
        `I'm your new AI marketing team member.\n\n` +
        `🚀 *Unlock my full potential:*\n` +
        `I work best when connected to your tools (LinkedIn, Meta, Google, etc).\n\n` +
        `👉 [Connect your apps here](${dashboardUrl})\n\n` +
        `Once you're ready, just ask me to start working!`
      );
    } else {
      await sendTelegramResponse(chatId,
        `❌ Invalid or expired pairing code.\n\n` +
        `Please check your code and try again, or generate a new one from your dashboard.`
      );
    }
  } catch (error) {
    console.error('[webhook] Pairing error:', error);
    await sendTelegramResponse(chatId,
      `⚠️ Something went wrong during pairing. Please try again.`
    );
  }

  return NextResponse.json({ ok: true });
}
