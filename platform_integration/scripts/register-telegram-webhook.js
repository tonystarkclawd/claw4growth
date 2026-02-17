/**
 * Registers the Telegram webhook for @Claw4GrowthBot
 * pointing to app.claw4growth.com/api/telegram/webhook
 *
 * Usage: node scripts/register-telegram-webhook.js
 */
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) {
        let v = match[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        env[match[1].trim()] = v;
    }
});

const BOT_TOKEN = env.PLATFORM_TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = 'https://app.claw4growth.com/api/telegram/webhook';
const SECRET = env.TELEGRAM_WEBHOOK_SECRET || '';

async function register() {
    console.log('Registering Telegram webhook...');
    console.log('Bot token:', BOT_TOKEN.slice(0, 10) + '...');
    console.log('Webhook URL:', WEBHOOK_URL);

    // First, check current webhook
    const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const info = await infoRes.json();
    console.log('\nCurrent webhook:', JSON.stringify(info.result, null, 2));

    // Set the webhook
    const params = new URLSearchParams({
        url: WEBHOOK_URL,
        allowed_updates: JSON.stringify(['message', 'callback_query']),
    });
    if (SECRET && SECRET !== 'change_me_to_a_random_string') {
        params.append('secret_token', SECRET);
    }

    const setRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?${params}`);
    const result = await setRes.json();
    console.log('\nSet webhook result:', JSON.stringify(result, null, 2));

    // Verify
    const verifyRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const verify = await verifyRes.json();
    console.log('\nVerified webhook:', JSON.stringify(verify.result, null, 2));
}

register().catch(e => console.error('Error:', e.message));
