#!/usr/bin/env node
/**
 * C4G Google Bridge
 *
 * CLI that OpenClaw agents call via Bash to execute Google API tools directly.
 * Same interface as composio-bridge.js. Tokens stored encrypted in Supabase.
 *
 * Usage:
 *   node google-bridge.js list-apps <user_id>
 *   node google-bridge.js list-tools <user_id> [app]
 *   node google-bridge.js execute <user_id> <TOOL_SLUG> [json_args]
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY,
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN
 */

const crypto = require('crypto');

// ─── Config ──────────────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENC_KEY = process.env.ENCRYPTION_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_ADS_DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

if (!SB_URL || !SB_KEY) {
  console.log(JSON.stringify({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set' }));
  process.exit(1);
}
if (!ENC_KEY) {
  console.log(JSON.stringify({ error: 'ENCRYPTION_KEY must be set' }));
  process.exit(1);
}

// ─── AES-256-GCM crypto (matches lib/google-crypto.ts) ───
function deriveKey() {
  return crypto.createHash('sha256').update(ENC_KEY).digest();
}

function decryptToken(encrypted) {
  if (!encrypted || !encrypted.startsWith('aes:')) {
    throw new Error('Invalid encrypted token format');
  }
  const parts = encrypted.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted token format');
  const key = deriveKey();
  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');
  const ciphertext = Buffer.from(parts[3], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}

function encryptToken(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `aes:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// ─── Supabase helpers ────────────────────────────────────
const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
};

async function sbGet(table, query) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPatch(table, query, data) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Token management ────────────────────────────────────
async function getTokens(userId) {
  const rows = await sbGet('c4g_google_tokens', `user_id=eq.${userId}&select=*`);
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

async function getAccessToken(userId) {
  const row = await getTokens(userId);
  if (!row) throw new Error(`No Google tokens found for user ${userId}`);

  const expiresAt = new Date(row.expires_at);
  const now = new Date();
  const fiveMinFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  // Refresh if expiring within 5 minutes
  if (expiresAt <= fiveMinFromNow) {
    const refreshToken = decryptToken(row.refresh_token_enc);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = await res.json();
    if (!data.access_token) {
      throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    }

    // Update in Supabase
    const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    await sbPatch('c4g_google_tokens', `user_id=eq.${userId}`, {
      access_token_enc: encryptToken(data.access_token),
      expires_at: newExpiresAt,
    });

    return { accessToken: data.access_token, customerId: row.google_ads_customer_id };
  }

  return { accessToken: decryptToken(row.access_token_enc), customerId: row.google_ads_customer_id };
}

// ─── Google Ads GAQL query ───────────────────────────────
async function adsQuery(accessToken, customerId, gaql) {
  const url = `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': GOOGLE_ADS_DEV_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: gaql }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Ads API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  // searchStream returns an array of batches; flatten results
  const results = [];
  for (const batch of data) {
    if (batch.results) results.push(...batch.results);
  }
  return results;
}

// ─── Tool definitions ────────────────────────────────────
const TOOLS = {
  GOOGLEADS_GET_ACCOUNT_INFO: {
    description: 'Get Google Ads account info (name, currency, ID)',
    args: [],
    execute: async (accessToken, customerId) => {
      const gaql = 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1';
      return adsQuery(accessToken, customerId, gaql);
    },
  },

  GOOGLEADS_LIST_CAMPAIGNS: {
    description: 'List all campaigns with metrics',
    args: [],
    execute: async (accessToken, customerId, args) => {
      let gaql = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign ORDER BY campaign.id`;
      if (args.limit) gaql += ` LIMIT ${parseInt(args.limit)}`;
      return adsQuery(accessToken, customerId, gaql);
    },
  },

  GOOGLEADS_GET_CAMPAIGN: {
    description: 'Get details for a specific campaign',
    args: ['campaign_id'],
    execute: async (accessToken, customerId, args) => {
      if (!args.campaign_id) throw new Error('campaign_id is required');
      const gaql = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.id = ${args.campaign_id}`;
      return adsQuery(accessToken, customerId, gaql);
    },
  },

  GOOGLEADS_LIST_AD_GROUPS: {
    description: 'List ad groups for a campaign',
    args: ['campaign_id'],
    execute: async (accessToken, customerId, args) => {
      if (!args.campaign_id) throw new Error('campaign_id is required');
      const gaql = `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, metrics.impressions, metrics.clicks, metrics.cost_micros FROM ad_group WHERE campaign.id = ${args.campaign_id} ORDER BY ad_group.id`;
      return adsQuery(accessToken, customerId, gaql);
    },
  },

  GOOGLEADS_LIST_ADS: {
    description: 'List ads in an ad group',
    args: ['ad_group_id'],
    execute: async (accessToken, customerId, args) => {
      if (!args.ad_group_id) throw new Error('ad_group_id is required');
      const gaql = `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status, metrics.impressions, metrics.clicks, metrics.cost_micros FROM ad_group_ad WHERE ad_group.id = ${args.ad_group_id} ORDER BY ad_group_ad.ad.id`;
      return adsQuery(accessToken, customerId, gaql);
    },
  },

  GOOGLEADS_GET_METRICS: {
    description: 'Get campaign metrics for a date range',
    args: ['campaign_id', 'start_date', 'end_date'],
    execute: async (accessToken, customerId, args) => {
      if (!args.campaign_id) throw new Error('campaign_id is required');
      const startDate = args.start_date || getDefaultStartDate();
      const endDate = args.end_date || getToday();
      const gaql = `SELECT campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM campaign WHERE campaign.id = ${args.campaign_id} AND segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY segments.date`;
      return adsQuery(accessToken, customerId, gaql);
    },
  },

  GOOGLEADS_GET_BUDGETS: {
    description: 'List all campaign budgets',
    args: [],
    execute: async (accessToken, customerId) => {
      const gaql = 'SELECT campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.status, campaign_budget.delivery_method FROM campaign_budget ORDER BY campaign_budget.id';
      return adsQuery(accessToken, customerId, gaql);
    },
  },

  GOOGLEADS_LIST_KEYWORDS: {
    description: 'List keywords in an ad group',
    args: ['ad_group_id'],
    execute: async (accessToken, customerId, args) => {
      if (!args.ad_group_id) throw new Error('ad_group_id is required');
      const gaql = `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, metrics.impressions, metrics.clicks, metrics.cost_micros FROM ad_group_criterion WHERE ad_group.id = ${args.ad_group_id} AND ad_group_criterion.type = 'KEYWORD' ORDER BY ad_group_criterion.criterion_id`;
      return adsQuery(accessToken, customerId, gaql);
    },
  },
};

// ─── Helpers ─────────────────────────────────────────────
function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getDefaultStartDate() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}

// ─── Scope → app mapping ────────────────────────────────
const SCOPE_TO_APP = {
  'https://www.googleapis.com/auth/adwords': 'googleads',
};

function scopesToApps(scopes) {
  const apps = new Set();
  for (const scope of scopes || []) {
    const app = SCOPE_TO_APP[scope];
    if (app) apps.add(app);
  }
  return [...apps];
}

// ─── CLI ─────────────────────────────────────────────────
const [,, command, userId, ...rest] = process.argv;

if (!command || !userId) {
  console.log(JSON.stringify({ error: 'Usage: google-bridge.js <command> <user_id> [args...]' }));
  process.exit(1);
}

(async () => {
  try {
    switch (command) {
      case 'list-apps': {
        const row = await getTokens(userId);
        if (!row) {
          console.log(JSON.stringify({ apps: [] }));
          break;
        }
        const connectedApps = scopesToApps(row.scopes);
        console.log(JSON.stringify({
          apps: connectedApps.map(app => ({
            app,
            status: 'ACTIVE',
            email: row.google_email || '',
            customer_id: row.google_ads_customer_id || '',
          })),
        }, null, 2));
        break;
      }

      case 'list-tools': {
        const appFilter = rest[0];
        const tools = Object.entries(TOOLS)
          .filter(([slug]) => !appFilter || slug.toLowerCase().startsWith(appFilter.toLowerCase()))
          .map(([slug, def]) => ({
            slug,
            description: def.description,
            args: def.args,
          }));
        console.log(JSON.stringify({ tools }, null, 2));
        break;
      }

      case 'execute': {
        const toolSlug = rest[0];
        const argsJson = rest[1] || '{}';
        if (!toolSlug) {
          console.log(JSON.stringify({ error: 'Usage: execute <user_id> <tool_slug> [json_args]' }));
          process.exit(1);
        }

        const toolDef = TOOLS[toolSlug];
        if (!toolDef) {
          console.log(JSON.stringify({ error: `Unknown tool: ${toolSlug}. Available: ${Object.keys(TOOLS).join(', ')}` }));
          process.exit(1);
        }

        let args;
        try {
          args = JSON.parse(argsJson);
        } catch {
          console.log(JSON.stringify({ error: 'Invalid JSON arguments' }));
          process.exit(1);
        }

        const { accessToken, customerId } = await getAccessToken(userId);
        if (!customerId) {
          console.log(JSON.stringify({ error: 'No Google Ads Customer ID found. Please reconnect Google Ads from the dashboard.' }));
          process.exit(1);
        }

        const result = await toolDef.execute(accessToken, customerId, args);
        console.log(JSON.stringify({ success: true, data: result }, null, 2));
        break;
      }

      default:
        console.log(JSON.stringify({ error: `Unknown command: ${command}. Use: list-apps, list-tools, execute` }));
        process.exit(1);
    }
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
})();
