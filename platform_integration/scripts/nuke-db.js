
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env vars
const envLocalPath = path.resolve(__dirname, '../.env.local');
const env = {};

try {
    const envContent = fs.readFileSync(envLocalPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            value = value.replace(/\\n/g, '\n');
            env[key] = value;
        }
    });
} catch (err) {
    console.error('Error reading .env.local:', err);
    process.exit(1);
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function nukeDB() {
    console.log('☢️  Nuking Database Records...');

    // 1. Delete instances (cascades to nothing usually, but good to be explicit)
    const { error: err1 } = await supabase.from('c4g_instances').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (err1) console.error('❌ Error deleting instances:', err1);
    else console.log('✅ Instances deleted.');

    // 2. Delete telegram pairings
    const { error: err2 } = await supabase.from('c4g_telegram_pairings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (err2) console.error('❌ Error deleting pairings:', err2);
    else console.log('✅ Telegram pairings deleted.');

    // 3. Delete subscriptions
    const { error: err3 } = await supabase.from('c4g_subscriptions').delete().neq('stripe_subscription_id', 'xxx');
    if (err3) console.error('❌ Error deleting subscriptions:', err3);
    else console.log('✅ Subscriptions deleted.');

    console.log('🎉 Database Cleaned.');
}

nukeDB();
