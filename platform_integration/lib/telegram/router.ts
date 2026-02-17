/**
 * Telegram Router
 * 
 * Routes incoming Telegram messages from the platform bot
 * to the correct user container based on telegram_id → pairing → instance mapping.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

const PLATFORM_BOT_TOKEN = process.env.PLATFORM_TELEGRAM_BOT_TOKEN!;

export interface ContainerInfo {
    instanceId: string;
    userId: string;
    subdomain: string;
    containerUrl: string;
    status: string;
}

export interface TelegramMessage {
    message_id: number;
    from: {
        id: number;
        first_name: string;
        username?: string;
    };
    chat: {
        id: number;
        type: string;
    };
    text?: string;
    date: number;
}

/**
 * Finds the container associated with a Telegram user ID.
 * Lookup chain: c4g_telegram_pairings → c4g_instances
 * 
 * @returns ContainerInfo or null if user is not paired/has no running instance
 */
export async function findContainerForTelegramUser(
    telegramId: number
): Promise<ContainerInfo | null> {
    // Find approved pairing for this telegram_id
    const { data: pairing, error: pairingError } = await supabaseAdmin
        .from('c4g_telegram_pairings')
        .select('user_id, instance_id')
        .eq('telegram_id', telegramId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (pairingError || !pairing) {
        return null;
    }

    // Get instance details
    const { data: instance, error: instanceError } = await supabaseAdmin
        .from('c4g_instances')
        .select('id, user_id, subdomain, status')
        .eq('id', pairing.instance_id)
        .single();

    if (instanceError || !instance) {
        return null;
    }

    return {
        instanceId: instance.id,
        userId: instance.user_id,
        subdomain: instance.subdomain,
        containerUrl: `https://${instance.subdomain}.claw4growth.com`,
        status: instance.status,
    };
}

/**
 * Forwards a user message to their OpenClaw container and returns the response.
 * 
 * @param containerUrl - Base URL of the user's container (e.g. https://abc123.claw4growth.com)
 * @param message - The text message from the user
 * @param telegramId - The sender's Telegram ID for context
 * @returns The agent's text response, or an error message
 */
export async function forwardToContainer(
    containerUrl: string,
    message: string,
    telegramId: number
): Promise<string> {
    try {
        const response = await fetch(`${containerUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Source': 'telegram',
                'X-Telegram-Id': String(telegramId),
            },
            body: JSON.stringify({
                message,
                source: 'telegram',
            }),
            signal: AbortSignal.timeout(30_000), // 30s timeout
        });

        if (!response.ok) {
            console.error(`[router] Container responded with ${response.status}: ${await response.text()}`);
            return '⚠️ Your operator is having trouble processing that request. Please try again in a moment.';
        }

        const data = await response.json();
        return data.response || data.message || '(no response)';
    } catch (error) {
        console.error('[router] Failed to forward to container:', error);

        if (error instanceof Error && error.name === 'TimeoutError') {
            return '⏳ Your operator is taking longer than expected. Please try again.';
        }

        return '⚠️ Could not reach your operator. It may be starting up — try again in a minute.';
    }
}

/**
 * Sends a text message back to a Telegram chat via the platform bot.
 */
export async function sendTelegramResponse(
    chatId: number,
    text: string
): Promise<void> {
    // Split long messages (Telegram limit is 4096 chars)
    const MAX_LENGTH = 4096;
    const chunks = [];

    for (let i = 0; i < text.length; i += MAX_LENGTH) {
        chunks.push(text.substring(i, i + MAX_LENGTH));
    }

    for (const chunk of chunks) {
        const response = await fetch(
            `https://api.telegram.org/bot${PLATFORM_BOT_TOKEN}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: chunk,
                    parse_mode: 'Markdown',
                }),
            }
        );

        if (!response.ok) {
            // Retry without Markdown if parsing fails
            const errorData = await response.json();
            if (errorData?.description?.includes('parse')) {
                await fetch(
                    `https://api.telegram.org/bot${PLATFORM_BOT_TOKEN}/sendMessage`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            text: chunk,
                        }),
                    }
                );
            } else {
                console.error('[router] Failed to send Telegram message:', errorData);
            }
        }
    }
}

/**
 * Sends a "typing" indicator to the chat while the container processes.
 */
export async function sendTypingAction(chatId: number): Promise<void> {
    await fetch(
        `https://api.telegram.org/bot${PLATFORM_BOT_TOKEN}/sendChatAction`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                action: 'typing',
            }),
        }
    ).catch(() => { }); // Non-critical, ignore errors
}
