
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env vars (hacky way since dotenv isn't installed)
const envLocalPath = path.resolve(__dirname, '../.env.local');
let SUPABASE_URL = '';
let SUPABASE_SERVICE_ROLE_KEY = '';

try {
    const envContent = fs.readFileSync(envLocalPath, 'utf8');
    envContent.split('\n').forEach(line => {
        if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
            SUPABASE_URL = line.split('=')[1].trim();
        }
        if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
            SUPABASE_SERVICE_ROLE_KEY = line.split('=')[1].trim();
        }
    });
} catch (err) {
    console.error('Error reading .env.local:', err);
    process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function clearData() {
    console.log('🧹 Clearing test data form Supabase...');

    const tables = ['c4g_telegram_pairing', 'c4g_minimax_usage', 'c4g_instances'];

    for (const table of tables) {
        try {
            const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows where ID is distinct from dummy UUID
            if (error) throw error;
            console.log(`✅ Cleared table: ${table}`);
        } catch (err) {
            console.error(`❌ Error clearing table ${table}:`, err.message);
        }
    }

    console.log('🎉 Done! Database is clean.');
}

clearData();
