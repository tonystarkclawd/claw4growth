#!/usr/bin/env node
/**
 * C4G Google Bridge — Full Google API integration
 *
 * CLI that OpenClaw agents call via Bash to execute Google API tools directly.
 * Same interface as composio-bridge.js. Tokens stored encrypted in Supabase.
 *
 * Supported services: Google Ads, Gmail, Calendar, Drive, Docs, Sheets, Analytics
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
  if (!row) throw new Error(`No Google tokens found for user ${userId}. Ask the user to connect Google from the dashboard.`);

  const expiresAt = new Date(row.expires_at);
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);

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
    if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

    const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    await sbPatch('c4g_google_tokens', `user_id=eq.${userId}`, {
      access_token_enc: encryptToken(data.access_token),
      expires_at: newExpiresAt,
    });

    return { accessToken: data.access_token, customerId: row.google_ads_customer_id };
  }

  return { accessToken: decryptToken(row.access_token_enc), customerId: row.google_ads_customer_id };
}

// ─── Generic Google API helpers ──────────────────────────
async function gapi(accessToken, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google API error (${res.status}): ${errText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function gapiGet(accessToken, url) {
  return gapi(accessToken, url);
}

async function gapiPost(accessToken, url, body) {
  return gapi(accessToken, url, { method: 'POST', body: JSON.stringify(body) });
}

async function gapiPut(accessToken, url, body) {
  return gapi(accessToken, url, { method: 'PUT', body: JSON.stringify(body) });
}

async function gapiPatch(accessToken, url, body) {
  return gapi(accessToken, url, { method: 'PATCH', body: JSON.stringify(body) });
}

async function gapiDelete(accessToken, url) {
  return gapi(accessToken, url, { method: 'DELETE' });
}

// ─── Google Ads GAQL ─────────────────────────────────────
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
  const results = [];
  for (const batch of data) {
    if (batch.results) results.push(...batch.results);
  }
  return results;
}

// ─── Helpers ─────────────────────────────────────────────
function getToday() { return new Date().toISOString().split('T')[0]; }
function getDefaultStartDate() { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; }

// ═══════════════════════════════════════════════════════════
// TOOL DEFINITIONS — organized by service
// ═══════════════════════════════════════════════════════════

const TOOLS = {

  // ─── GOOGLE ADS ──────────────────────────────────────────
  GOOGLEADS_GET_ACCOUNT_INFO: {
    description: 'Get Google Ads account info (name, currency, ID)',
    service: 'googleads',
    execute: async (t, ctx) => adsQuery(t, ctx.customerId, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1'),
  },
  GOOGLEADS_LIST_CAMPAIGNS: {
    description: 'List all campaigns with metrics. Optional: {"limit":10}',
    service: 'googleads',
    execute: async (t, ctx, args) => {
      let gaql = 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign ORDER BY campaign.id';
      if (args.limit) gaql += ` LIMIT ${parseInt(args.limit)}`;
      return adsQuery(t, ctx.customerId, gaql);
    },
  },
  GOOGLEADS_GET_CAMPAIGN: {
    description: 'Get campaign details. Args: {"campaign_id":"123"}',
    service: 'googleads',
    execute: async (t, ctx, args) => {
      if (!args.campaign_id) throw new Error('campaign_id is required');
      return adsQuery(t, ctx.customerId, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.id = ${args.campaign_id}`);
    },
  },
  GOOGLEADS_LIST_AD_GROUPS: {
    description: 'List ad groups for a campaign. Args: {"campaign_id":"123"}',
    service: 'googleads',
    execute: async (t, ctx, args) => {
      if (!args.campaign_id) throw new Error('campaign_id is required');
      return adsQuery(t, ctx.customerId, `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, metrics.impressions, metrics.clicks, metrics.cost_micros FROM ad_group WHERE campaign.id = ${args.campaign_id} ORDER BY ad_group.id`);
    },
  },
  GOOGLEADS_LIST_ADS: {
    description: 'List ads in an ad group. Args: {"ad_group_id":"456"}',
    service: 'googleads',
    execute: async (t, ctx, args) => {
      if (!args.ad_group_id) throw new Error('ad_group_id is required');
      return adsQuery(t, ctx.customerId, `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status, metrics.impressions, metrics.clicks, metrics.cost_micros FROM ad_group_ad WHERE ad_group.id = ${args.ad_group_id} ORDER BY ad_group_ad.ad.id`);
    },
  },
  GOOGLEADS_GET_METRICS: {
    description: 'Campaign metrics by date. Args: {"campaign_id":"123","start_date":"2025-01-01","end_date":"2025-01-31"}',
    service: 'googleads',
    execute: async (t, ctx, args) => {
      if (!args.campaign_id) throw new Error('campaign_id is required');
      const s = args.start_date || getDefaultStartDate();
      const e = args.end_date || getToday();
      return adsQuery(t, ctx.customerId, `SELECT campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM campaign WHERE campaign.id = ${args.campaign_id} AND segments.date BETWEEN '${s}' AND '${e}' ORDER BY segments.date`);
    },
  },
  GOOGLEADS_GET_BUDGETS: {
    description: 'List all campaign budgets',
    service: 'googleads',
    execute: async (t, ctx) => adsQuery(t, ctx.customerId, 'SELECT campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.status, campaign_budget.delivery_method FROM campaign_budget ORDER BY campaign_budget.id'),
  },
  GOOGLEADS_LIST_KEYWORDS: {
    description: 'List keywords in an ad group. Args: {"ad_group_id":"456"}',
    service: 'googleads',
    execute: async (t, ctx, args) => {
      if (!args.ad_group_id) throw new Error('ad_group_id is required');
      return adsQuery(t, ctx.customerId, `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, metrics.impressions, metrics.clicks, metrics.cost_micros FROM ad_group_criterion WHERE ad_group.id = ${args.ad_group_id} AND ad_group_criterion.type = 'KEYWORD' ORDER BY ad_group_criterion.criterion_id`);
    },
  },

  // ─── GMAIL ───────────────────────────────────────────────
  GMAIL_GET_PROFILE: {
    description: 'Get Gmail profile (email, messages total, threads total)',
    service: 'gmail',
    execute: async (t) => gapiGet(t, 'https://gmail.googleapis.com/gmail/v1/users/me/profile'),
  },
  GMAIL_FETCH_EMAILS: {
    description: 'Fetch emails. Args: {"max_results":5,"q":"from:someone subject:test"}',
    service: 'gmail',
    execute: async (t, ctx, args) => {
      const max = args.max_results || 10;
      const q = args.q || '';
      const list = await gapiGet(t, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}${q ? '&q=' + encodeURIComponent(q) : ''}`);
      if (!list.messages || list.messages.length === 0) return { messages: [] };
      const messages = [];
      for (const m of list.messages.slice(0, max)) {
        const msg = await gapiGet(t, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
        const headers = {};
        for (const h of msg.payload?.headers || []) headers[h.name] = h.value;
        messages.push({ id: msg.id, threadId: msg.threadId, snippet: msg.snippet, from: headers.From, to: headers.To, subject: headers.Subject, date: headers.Date, labelIds: msg.labelIds });
      }
      return { messages };
    },
  },
  GMAIL_SEND_EMAIL: {
    description: 'Send email. Args: {"to":"a@b.com","subject":"Hi","body":"Hello","cc":"","bcc":""}',
    service: 'gmail',
    execute: async (t, ctx, args) => {
      if (!args.to || !args.subject) throw new Error('to and subject are required');
      let mime = `To: ${args.to}\r\n`;
      if (args.cc) mime += `Cc: ${args.cc}\r\n`;
      if (args.bcc) mime += `Bcc: ${args.bcc}\r\n`;
      mime += `Subject: ${args.subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${args.body || ''}`;
      const raw = Buffer.from(mime).toString('base64url');
      return gapiPost(t, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw });
    },
  },
  GMAIL_CREATE_EMAIL_DRAFT: {
    description: 'Create draft. Args: {"to":"a@b.com","subject":"Hi","body":"Hello"}',
    service: 'gmail',
    execute: async (t, ctx, args) => {
      if (!args.to || !args.subject) throw new Error('to and subject are required');
      const mime = `To: ${args.to}\r\nSubject: ${args.subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${args.body || ''}`;
      const raw = Buffer.from(mime).toString('base64url');
      return gapiPost(t, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { message: { raw } });
    },
  },
  GMAIL_SEND_DRAFT: {
    description: 'Send an existing draft. Args: {"draft_id":"r123"}',
    service: 'gmail',
    execute: async (t, ctx, args) => {
      if (!args.draft_id) throw new Error('draft_id is required');
      return gapiPost(t, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', { id: args.draft_id });
    },
  },
  GMAIL_LIST_THREADS: {
    description: 'List email threads. Args: {"max_results":10,"q":""}',
    service: 'gmail',
    execute: async (t, ctx, args) => {
      const max = args.max_results || 10;
      const q = args.q || '';
      return gapiGet(t, `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${max}${q ? '&q=' + encodeURIComponent(q) : ''}`);
    },
  },
  GMAIL_FETCH_MESSAGE_BY_THREAD_ID: {
    description: 'Get full thread. Args: {"thread_id":"abc"}',
    service: 'gmail',
    execute: async (t, ctx, args) => {
      if (!args.thread_id) throw new Error('thread_id is required');
      return gapiGet(t, `https://gmail.googleapis.com/gmail/v1/users/me/threads/${args.thread_id}?format=full`);
    },
  },
  GMAIL_REPLY_TO_THREAD: {
    description: 'Reply to a thread. Args: {"thread_id":"abc","to":"a@b.com","subject":"Re: Hi","body":"Thanks"}',
    service: 'gmail',
    execute: async (t, ctx, args) => {
      if (!args.thread_id || !args.to) throw new Error('thread_id and to are required');
      const thread = await gapiGet(t, `https://gmail.googleapis.com/gmail/v1/users/me/threads/${args.thread_id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject`);
      const lastMsg = thread.messages?.[thread.messages.length - 1];
      const msgId = lastMsg?.payload?.headers?.find(h => h.name === 'Message-ID')?.value || '';
      const subject = args.subject || `Re: ${lastMsg?.payload?.headers?.find(h => h.name === 'Subject')?.value || ''}`;
      let mime = `To: ${args.to}\r\nSubject: ${subject}\r\nIn-Reply-To: ${msgId}\r\nReferences: ${msgId}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${args.body || ''}`;
      const raw = Buffer.from(mime).toString('base64url');
      return gapiPost(t, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw, threadId: args.thread_id });
    },
  },
  GMAIL_LIST_LABELS: {
    description: 'List all Gmail labels/folders',
    service: 'gmail',
    execute: async (t) => gapiGet(t, 'https://gmail.googleapis.com/gmail/v1/users/me/labels'),
  },
  GMAIL_CREATE_LABEL: {
    description: 'Create a label. Args: {"name":"Campaign Replies"}',
    service: 'gmail',
    execute: async (t, ctx, args) => {
      if (!args.name) throw new Error('name is required');
      return gapiPost(t, 'https://gmail.googleapis.com/gmail/v1/users/me/labels', { name: args.name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
    },
  },
  GMAIL_MODIFY_LABELS: {
    description: 'Add/remove labels on messages. Args: {"message_ids":["id1","id2"],"add_labels":["Label_1"],"remove_labels":["INBOX"]}',
    service: 'gmail',
    execute: async (t, ctx, args) => {
      if (!args.message_ids) throw new Error('message_ids is required');
      return gapiPost(t, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', {
        ids: args.message_ids,
        addLabelIds: args.add_labels || [],
        removeLabelIds: args.remove_labels || [],
      });
    },
  },
  GMAIL_TRASH_MESSAGE: {
    description: 'Trash a message. Args: {"message_id":"abc"}',
    service: 'gmail',
    execute: async (t, ctx, args) => {
      if (!args.message_id) throw new Error('message_id is required');
      return gapiPost(t, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.message_id}/trash`, {});
    },
  },

  // ─── GOOGLE CALENDAR ─────────────────────────────────────
  GOOGLECALENDAR_LIST_CALENDARS: {
    description: 'List all calendars the user has access to',
    service: 'googlecalendar',
    execute: async (t) => gapiGet(t, 'https://www.googleapis.com/calendar/v3/users/me/calendarList'),
  },
  GOOGLECALENDAR_GET_CALENDAR: {
    description: 'Get calendar info. Args: {"calendarId":"primary"}',
    service: 'googlecalendar',
    execute: async (t, ctx, args) => gapiGet(t, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId || 'primary')}`),
  },
  GOOGLECALENDAR_EVENTS_LIST: {
    description: 'List events. Args: {"calendarId":"primary","timeMin":"2025-01-01T00:00:00Z","timeMax":"2025-02-01T00:00:00Z","maxResults":20}',
    service: 'googlecalendar',
    execute: async (t, ctx, args) => {
      const calId = encodeURIComponent(args.calendarId || 'primary');
      const params = new URLSearchParams({ maxResults: String(args.maxResults || 20), singleEvents: 'true', orderBy: 'startTime' });
      if (args.timeMin) params.set('timeMin', args.timeMin);
      else params.set('timeMin', new Date().toISOString());
      if (args.timeMax) params.set('timeMax', args.timeMax);
      if (args.q) params.set('q', args.q);
      return gapiGet(t, `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?${params}`);
    },
  },
  GOOGLECALENDAR_CREATE_EVENT: {
    description: 'Create event. Args: {"summary":"Meeting","start":{"dateTime":"2025-01-15T10:00:00","timeZone":"Europe/Rome"},"end":{"dateTime":"2025-01-15T11:00:00","timeZone":"Europe/Rome"},"description":"","location":"","attendees":[{"email":"a@b.com"}]}',
    service: 'googlecalendar',
    execute: async (t, ctx, args) => {
      if (!args.summary || !args.start || !args.end) throw new Error('summary, start, and end are required');
      const calId = encodeURIComponent(args.calendarId || 'primary');
      return gapiPost(t, `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`, {
        summary: args.summary, description: args.description, location: args.location,
        start: args.start, end: args.end, attendees: args.attendees,
      });
    },
  },
  GOOGLECALENDAR_UPDATE_EVENT: {
    description: 'Update event. Args: {"eventId":"abc","calendarId":"primary","summary":"New Title",...}',
    service: 'googlecalendar',
    execute: async (t, ctx, args) => {
      if (!args.eventId) throw new Error('eventId is required');
      const calId = encodeURIComponent(args.calendarId || 'primary');
      const { eventId, calendarId, ...body } = args;
      return gapiPatch(t, `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}`, body);
    },
  },
  GOOGLECALENDAR_DELETE_EVENT: {
    description: 'Delete event. Args: {"eventId":"abc","calendarId":"primary"}',
    service: 'googlecalendar',
    execute: async (t, ctx, args) => {
      if (!args.eventId) throw new Error('eventId is required');
      const calId = encodeURIComponent(args.calendarId || 'primary');
      await gapiDelete(t, `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${args.eventId}`);
      return { deleted: true };
    },
  },
  GOOGLECALENDAR_QUICK_ADD: {
    description: 'Quick-add event from text. Args: {"text":"Meeting with John tomorrow at 3pm","calendarId":"primary"}',
    service: 'googlecalendar',
    execute: async (t, ctx, args) => {
      if (!args.text) throw new Error('text is required');
      const calId = encodeURIComponent(args.calendarId || 'primary');
      return gapiPost(t, `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/quickAdd?text=${encodeURIComponent(args.text)}`, {});
    },
  },
  GOOGLECALENDAR_FREEBUSY: {
    description: 'Check availability. Args: {"timeMin":"2025-01-15T00:00:00Z","timeMax":"2025-01-16T00:00:00Z","items":[{"id":"primary"}]}',
    service: 'googlecalendar',
    execute: async (t, ctx, args) => {
      if (!args.timeMin || !args.timeMax) throw new Error('timeMin and timeMax are required');
      return gapiPost(t, 'https://www.googleapis.com/calendar/v3/freeBusy', {
        timeMin: args.timeMin, timeMax: args.timeMax, items: args.items || [{ id: 'primary' }],
      });
    },
  },

  // ─── GOOGLE DRIVE ────────────────────────────────────────
  GOOGLEDRIVE_LIST_FILES: {
    description: 'List files. Args: {"page_size":20,"q":"mimeType=\\"application/pdf\\""}',
    service: 'googledrive',
    execute: async (t, ctx, args) => {
      const params = new URLSearchParams({ pageSize: String(args.page_size || 20), fields: 'files(id,name,mimeType,modifiedTime,size,parents,webViewLink)' });
      if (args.q) params.set('q', args.q);
      return gapiGet(t, `https://www.googleapis.com/drive/v3/files?${params}`);
    },
  },
  GOOGLEDRIVE_FIND_FILE: {
    description: 'Search files by name. Args: {"query":"report","page_size":10}',
    service: 'googledrive',
    execute: async (t, ctx, args) => {
      if (!args.query) throw new Error('query is required');
      const q = `name contains '${args.query.replace(/'/g, "\\'")}'`;
      const params = new URLSearchParams({ q, pageSize: String(args.page_size || 10), fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)' });
      return gapiGet(t, `https://www.googleapis.com/drive/v3/files?${params}`);
    },
  },
  GOOGLEDRIVE_CREATE_FOLDER: {
    description: 'Create folder. Args: {"name":"Campaign Assets","parent_id":"optional"}',
    service: 'googledrive',
    execute: async (t, ctx, args) => {
      if (!args.name) throw new Error('name is required');
      const body = { name: args.name, mimeType: 'application/vnd.google-apps.folder' };
      if (args.parent_id) body.parents = [args.parent_id];
      return gapiPost(t, 'https://www.googleapis.com/drive/v3/files', body);
    },
  },
  GOOGLEDRIVE_CREATE_FILE_FROM_TEXT: {
    description: 'Create text file. Args: {"name":"notes.txt","content":"Hello world","parent_id":"optional","mime_type":"text/plain"}',
    service: 'googledrive',
    execute: async (t, ctx, args) => {
      if (!args.name || !args.content) throw new Error('name and content are required');
      const metadata = { name: args.name };
      if (args.parent_id) metadata.parents = [args.parent_id];
      const boundary = 'c4g_boundary';
      const mimeType = args.mime_type || 'text/plain';
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${args.content}\r\n--${boundary}--`;
      return gapi(t, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST', body,
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      });
    },
  },
  GOOGLEDRIVE_COPY_FILE: {
    description: 'Copy file. Args: {"file_id":"abc","name":"Copy of report"}',
    service: 'googledrive',
    execute: async (t, ctx, args) => {
      if (!args.file_id) throw new Error('file_id is required');
      const body = {};
      if (args.name) body.name = args.name;
      if (args.parent_id) body.parents = [args.parent_id];
      return gapiPost(t, `https://www.googleapis.com/drive/v3/files/${args.file_id}/copy`, body);
    },
  },
  GOOGLEDRIVE_DELETE_FILE: {
    description: 'Delete file. Args: {"file_id":"abc"}',
    service: 'googledrive',
    execute: async (t, ctx, args) => {
      if (!args.file_id) throw new Error('file_id is required');
      await gapiDelete(t, `https://www.googleapis.com/drive/v3/files/${args.file_id}`);
      return { deleted: true };
    },
  },
  GOOGLEDRIVE_EXPORT: {
    description: 'Export Google Workspace file as PDF/CSV/etc. Args: {"file_id":"abc","mime_type":"application/pdf"}',
    service: 'googledrive',
    execute: async (t, ctx, args) => {
      if (!args.file_id || !args.mime_type) throw new Error('file_id and mime_type are required');
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${args.file_id}/export?mimeType=${encodeURIComponent(args.mime_type)}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) throw new Error(`Export error (${res.status}): ${await res.text()}`);
      const text = await res.text();
      return { content: text.substring(0, 50000), truncated: text.length > 50000 };
    },
  },
  GOOGLEDRIVE_SHARE: {
    description: 'Share file. Args: {"file_id":"abc","email":"a@b.com","role":"reader"}  Roles: reader, writer, commenter',
    service: 'googledrive',
    execute: async (t, ctx, args) => {
      if (!args.file_id || !args.email) throw new Error('file_id and email are required');
      return gapiPost(t, `https://www.googleapis.com/drive/v3/files/${args.file_id}/permissions`, {
        type: 'user', role: args.role || 'reader', emailAddress: args.email,
      });
    },
  },

  // ─── GOOGLE DOCS ─────────────────────────────────────────
  GOOGLEDOCS_CREATE_DOCUMENT: {
    description: 'Create new doc. Args: {"title":"Campaign Brief"}',
    service: 'googledocs',
    execute: async (t, ctx, args) => gapiPost(t, 'https://docs.googleapis.com/v1/documents', { title: args.title || 'Untitled' }),
  },
  GOOGLEDOCS_GET_DOCUMENT_BY_ID: {
    description: 'Get doc content. Args: {"document_id":"abc"}',
    service: 'googledocs',
    execute: async (t, ctx, args) => {
      if (!args.document_id) throw new Error('document_id is required');
      return gapiGet(t, `https://docs.googleapis.com/v1/documents/${args.document_id}`);
    },
  },
  GOOGLEDOCS_BATCH_UPDATE: {
    description: 'Write/edit doc content. Args: {"document_id":"abc","requests":[{"insertText":{"location":{"index":1},"text":"Hello World"}}]}. Supports insertText, replaceAllText, deleteContentRange, insertInlineImage, updateTextStyle, insertTable',
    service: 'googledocs',
    execute: async (t, ctx, args) => {
      if (!args.document_id || !args.requests) throw new Error('document_id and requests are required');
      return gapiPost(t, `https://docs.googleapis.com/v1/documents/${args.document_id}:batchUpdate`, { requests: args.requests });
    },
  },
  GOOGLEDOCS_REPLACE_TEXT: {
    description: 'Find-and-replace in doc (template variables). Args: {"document_id":"abc","replacements":{"{{NAME}}":"Acme Corp","{{DATE}}":"Jan 2025"}}',
    service: 'googledocs',
    execute: async (t, ctx, args) => {
      if (!args.document_id || !args.replacements) throw new Error('document_id and replacements are required');
      const requests = Object.entries(args.replacements).map(([find, replace]) => ({
        replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replace },
      }));
      return gapiPost(t, `https://docs.googleapis.com/v1/documents/${args.document_id}:batchUpdate`, { requests });
    },
  },

  // ─── GOOGLE SHEETS ───────────────────────────────────────
  GOOGLESHEETS_CREATE_SPREADSHEET: {
    description: 'Create spreadsheet. Args: {"title":"Campaign Tracker"}',
    service: 'googlesheets',
    execute: async (t, ctx, args) => gapiPost(t, 'https://sheets.googleapis.com/v4/spreadsheets', { properties: { title: args.title || 'Untitled' } }),
  },
  GOOGLESHEETS_GET_SPREADSHEET_INFO: {
    description: 'Get spreadsheet metadata. Args: {"spreadsheet_id":"abc"}',
    service: 'googlesheets',
    execute: async (t, ctx, args) => {
      if (!args.spreadsheet_id) throw new Error('spreadsheet_id is required');
      return gapiGet(t, `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheet_id}?fields=spreadsheetId,properties,sheets.properties`);
    },
  },
  GOOGLESHEETS_BATCH_GET: {
    description: 'Read values. Args: {"spreadsheet_id":"abc","ranges":["Sheet1!A1:Z100"]}',
    service: 'googlesheets',
    execute: async (t, ctx, args) => {
      if (!args.spreadsheet_id || !args.ranges) throw new Error('spreadsheet_id and ranges are required');
      const ranges = args.ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
      return gapiGet(t, `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheet_id}/values:batchGet?${ranges}`);
    },
  },
  GOOGLESHEETS_BATCH_UPDATE: {
    description: 'Write values. Args: {"spreadsheet_id":"abc","data":[{"range":"Sheet1!A1","values":[["Name","Score"],["Alice","95"]]}]}',
    service: 'googlesheets',
    execute: async (t, ctx, args) => {
      if (!args.spreadsheet_id || !args.data) throw new Error('spreadsheet_id and data are required');
      return gapiPost(t, `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheet_id}/values:batchUpdate`, {
        valueInputOption: args.value_input_option || 'USER_ENTERED', data: args.data,
      });
    },
  },
  GOOGLESHEETS_APPEND: {
    description: 'Append rows (no overwrite). Args: {"spreadsheet_id":"abc","range":"Sheet1!A1","values":[["New Lead","john@example.com","2025-01-15"]]}',
    service: 'googlesheets',
    execute: async (t, ctx, args) => {
      if (!args.spreadsheet_id || !args.range || !args.values) throw new Error('spreadsheet_id, range, and values are required');
      const range = encodeURIComponent(args.range);
      return gapiPost(t, `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheet_id}/values/${range}:append?valueInputOption=${args.value_input_option || 'USER_ENTERED'}&insertDataOption=INSERT_ROWS`, { values: args.values });
    },
  },
  GOOGLESHEETS_CLEAR_VALUES: {
    description: 'Clear cell values. Args: {"spreadsheet_id":"abc","range":"Sheet1!A1:Z100"}',
    service: 'googlesheets',
    execute: async (t, ctx, args) => {
      if (!args.spreadsheet_id || !args.range) throw new Error('spreadsheet_id and range are required');
      return gapiPost(t, `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheet_id}/values/${encodeURIComponent(args.range)}:clear`, {});
    },
  },
  GOOGLESHEETS_CREATE_FROM_JSON: {
    description: 'Create spreadsheet from JSON data. Args: {"title":"Report","headers":["Name","Email","Score"],"rows":[["Alice","a@b.com","95"],["Bob","b@c.com","87"]]}',
    service: 'googlesheets',
    execute: async (t, ctx, args) => {
      if (!args.headers || !args.rows) throw new Error('headers and rows are required');
      const ss = await gapiPost(t, 'https://sheets.googleapis.com/v4/spreadsheets', { properties: { title: args.title || 'Data Export' } });
      const values = [args.headers, ...args.rows];
      await gapiPost(t, `https://sheets.googleapis.com/v4/spreadsheets/${ss.spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`, { values });
      return { spreadsheetId: ss.spreadsheetId, url: ss.spreadsheetUrl, rowsWritten: values.length };
    },
  },
  GOOGLESHEETS_LOOKUP_ROW: {
    description: 'Search for a row by value. Args: {"spreadsheet_id":"abc","range":"Sheet1!A:Z","search_column":0,"search_value":"john@example.com"}',
    service: 'googlesheets',
    execute: async (t, ctx, args) => {
      if (!args.spreadsheet_id || !args.range || args.search_value === undefined) throw new Error('spreadsheet_id, range, and search_value are required');
      const data = await gapiGet(t, `https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheet_id}/values/${encodeURIComponent(args.range)}`);
      const col = args.search_column || 0;
      const matches = [];
      for (let i = 0; i < (data.values || []).length; i++) {
        if (data.values[i][col] === String(args.search_value)) {
          matches.push({ row: i + 1, values: data.values[i] });
        }
      }
      return { matches, total: matches.length };
    },
  },

  // ─── GOOGLE ANALYTICS ────────────────────────────────────
  GOOGLE_ANALYTICS_LIST_ACCOUNTS: {
    description: 'List all GA4 accounts',
    service: 'google_analytics',
    execute: async (t) => gapiGet(t, 'https://analyticsadmin.googleapis.com/v1beta/accounts'),
  },
  GOOGLE_ANALYTICS_LIST_PROPERTIES: {
    description: 'List GA4 properties. Args: {"account_id":"123456"}',
    service: 'google_analytics',
    execute: async (t, ctx, args) => {
      if (!args.account_id) throw new Error('account_id is required');
      return gapiGet(t, `https://analyticsadmin.googleapis.com/v1beta/properties?filter=parent:accounts/${args.account_id}`);
    },
  },
  GOOGLE_ANALYTICS_RUN_REPORT: {
    description: 'Run GA4 report. Args: {"property_id":"123456","date_ranges":[{"startDate":"30daysAgo","endDate":"today"}],"dimensions":[{"name":"date"}],"metrics":[{"name":"sessions"},{"name":"totalUsers"},{"name":"screenPageViews"}]}',
    service: 'google_analytics',
    execute: async (t, ctx, args) => {
      if (!args.property_id) throw new Error('property_id is required');
      return gapiPost(t, `https://analyticsdata.googleapis.com/v1beta/properties/${args.property_id}:runReport`, {
        dateRanges: args.date_ranges || [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: args.dimensions || [{ name: 'date' }],
        metrics: args.metrics || [{ name: 'sessions' }, { name: 'totalUsers' }],
        limit: args.limit || 100,
        orderBys: args.order_bys,
      });
    },
  },
  GOOGLE_ANALYTICS_REALTIME_REPORT: {
    description: 'Run GA4 realtime report. Args: {"property_id":"123456","dimensions":[{"name":"country"}],"metrics":[{"name":"activeUsers"}]}',
    service: 'google_analytics',
    execute: async (t, ctx, args) => {
      if (!args.property_id) throw new Error('property_id is required');
      return gapiPost(t, `https://analyticsdata.googleapis.com/v1beta/properties/${args.property_id}:runRealtimeReport`, {
        dimensions: args.dimensions || [{ name: 'country' }],
        metrics: args.metrics || [{ name: 'activeUsers' }],
        limit: args.limit || 50,
      });
    },
  },
};

// ─── Scope → app mapping ────────────────────────────────
const SCOPE_TO_APP = {
  'https://www.googleapis.com/auth/adwords': 'googleads',
  'https://www.googleapis.com/auth/gmail.modify': 'gmail',
  'https://www.googleapis.com/auth/calendar': 'googlecalendar',
  'https://www.googleapis.com/auth/drive': 'googledrive',
  'https://www.googleapis.com/auth/documents': 'googledocs',
  'https://www.googleapis.com/auth/spreadsheets': 'googlesheets',
  'https://www.googleapis.com/auth/analytics.readonly': 'google_analytics',
};

function scopesToApps(scopes) {
  const apps = new Set();
  for (const scope of scopes || []) {
    const app = SCOPE_TO_APP[scope];
    if (app) apps.add(app);
  }
  // Drive scope also enables Docs and Sheets access
  if (apps.has('googledrive')) {
    apps.add('googledocs');
    apps.add('googlesheets');
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
            ...(app === 'googleads' ? { customer_id: row.google_ads_customer_id || '' } : {}),
          })),
        }, null, 2));
        break;
      }

      case 'list-tools': {
        const appFilter = rest[0];
        const tools = Object.entries(TOOLS)
          .filter(([, def]) => !appFilter || def.service === appFilter.toLowerCase())
          .map(([slug, def]) => ({ slug, description: def.description }));
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
          console.log(JSON.stringify({ error: `Unknown tool: ${toolSlug}. Run list-tools to see available tools.` }));
          process.exit(1);
        }

        let args;
        try { args = JSON.parse(argsJson); } catch {
          console.log(JSON.stringify({ error: 'Invalid JSON arguments' }));
          process.exit(1);
        }

        const { accessToken, customerId } = await getAccessToken(userId);

        // Google Ads tools require customer ID
        if (toolDef.service === 'googleads' && !customerId) {
          console.log(JSON.stringify({ error: 'No Google Ads Customer ID found. Please reconnect Google Ads from the dashboard.' }));
          process.exit(1);
        }

        const ctx = { customerId };
        const result = await toolDef.execute(accessToken, ctx, args);
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
