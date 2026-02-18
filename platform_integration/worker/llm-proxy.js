#!/usr/bin/env node
/**
 * C4G LLM Proxy
 *
 * OpenAI-compatible proxy that sits between containers and the real LLM provider.
 * - Authenticates via Bearer token (= Supabase user UUID)
 * - Checks monthly budget before forwarding
 * - Forwards to the real provider with the real API key
 * - Logs token usage + estimated cost to Supabase
 *
 * Usage:
 *   node llm-proxy.js                          # run with .env in same dir
 *   C4G_ENV=/path/to/.env node llm-proxy.js    # custom env path
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── Load env ────────────────────────────────────────────
const envPath = process.env.C4G_ENV || path.resolve(__dirname, '.env');
let envVars = {};
try {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) {
      let v = match[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      v = v.replace(/\\n/g, '\n');
      envVars[match[1].trim()] = v;
    }
  });
} catch (err) {
  console.error(`[llm-proxy] Cannot read env file ${envPath}:`, err.message);
  process.exit(1);
}

const LLM_PROVIDER_BASE_URL = envVars.LLM_PROVIDER_BASE_URL;
const LLM_PROVIDER_API_KEY = envVars.LLM_PROVIDER_API_KEY;
const MONTHLY_BUDGET_EUR = parseFloat(envVars.MONTHLY_BUDGET_EUR || '20');
const SUPABASE_URL = envVars.SUPABASE_URL || envVars.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;
const PORT = parseInt(envVars.LLM_PROXY_PORT || '18800', 10);

if (!LLM_PROVIDER_BASE_URL || !LLM_PROVIDER_API_KEY) {
  console.error('[llm-proxy] Missing LLM_PROVIDER_BASE_URL or LLM_PROVIDER_API_KEY');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[llm-proxy] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ─── Token pricing (EUR per token) ──────────────────────
const TOKEN_PRICES = {
  'MiniMax-M2.5': { input: 0.0000008, output: 0.0000032 },
  'default':      { input: 0.000001,  output: 0.000004  },
};

function getPrice(model) {
  return TOKEN_PRICES[model] || TOKEN_PRICES['default'];
}

// ─── Supabase helpers ────────────────────────────────────
const sbHeaders = {
  'apikey': SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function getMonthlySpend(userId) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/get_monthly_spend`;
  const res = await fetch(url, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify({ p_user_id: userId }),
  });
  if (res.ok) {
    const data = await res.json();
    return parseFloat(data) || 0;
  }
  // Fallback: direct query
  const qUrl = `${SUPABASE_URL}/rest/v1/c4g_api_usage?select=estimated_cost_eur&user_id=eq.${userId}&created_at=gte.${getMonthStart()}`;
  const qRes = await fetch(qUrl, { headers: sbHeaders });
  if (!qRes.ok) throw new Error(`Supabase query failed: ${qRes.status}`);
  const rows = await qRes.json();
  return rows.reduce((sum, r) => sum + parseFloat(r.estimated_cost_eur || 0), 0);
}

function getMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

async function logUsage(userId, model, promptTokens, completionTokens, costEur) {
  const url = `${SUPABASE_URL}/rest/v1/c4g_api_usage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      estimated_cost_eur: costEur,
    }),
  });
  if (!res.ok) {
    console.error(`[llm-proxy] Failed to log usage: ${res.status} ${await res.text()}`);
  }
}

// ─── Extract user ID from Authorization header ──────────
function extractUserId(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return req.headers['x-user-id'] || null;
}

// ─── Read request body ──────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── HTTP Server ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Only handle POST /v1/chat/completions
  if (req.method !== 'POST' || !req.url.startsWith('/v1/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Only POST /v1/chat/completions is supported.' }));
    return;
  }

  const userId = extractUserId(req);
  if (!userId) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing user identification (Authorization Bearer or X-User-Id header).' }));
    return;
  }

  try {
    // 1. Budget pre-check
    const currentSpend = await getMonthlySpend(userId);
    if (currentSpend >= MONTHLY_BUDGET_EUR) {
      console.log(`[llm-proxy] Budget exceeded for user ${userId}: €${currentSpend.toFixed(2)} / €${MONTHLY_BUDGET_EUR}`);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          message: `Monthly budget exceeded (€${currentSpend.toFixed(2)} / €${MONTHLY_BUDGET_EUR}). Resets next month.`,
          type: 'budget_exceeded',
          code: 'budget_exceeded',
        },
      }));
      return;
    }

    // 2. Read and forward request
    const body = await readBody(req);
    const providerUrl = `${LLM_PROVIDER_BASE_URL}/chat/completions`;

    const providerRes = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_PROVIDER_API_KEY}`,
      },
      body,
    });

    const providerBody = await providerRes.text();

    // 3. Forward response to client
    res.writeHead(providerRes.status, {
      'Content-Type': providerRes.headers.get('content-type') || 'application/json',
    });
    res.end(providerBody);

    // 4. Log usage (async, don't block response)
    try {
      const parsed = JSON.parse(providerBody);
      if (parsed.usage) {
        const model = parsed.model || 'unknown';
        const promptTokens = parsed.usage.prompt_tokens || 0;
        const completionTokens = parsed.usage.completion_tokens || 0;
        const price = getPrice(model);
        const costEur = (promptTokens * price.input) + (completionTokens * price.output);

        logUsage(userId, model, promptTokens, completionTokens, costEur).catch(err => {
          console.error('[llm-proxy] Async log error:', err.message);
        });

        console.log(`[llm-proxy] ${userId.substring(0, 8)}… | ${model} | ${promptTokens}+${completionTokens} tokens | €${costEur.toFixed(6)}`);
      }
    } catch {
      // Non-JSON or no usage data — skip logging
    }

  } catch (err) {
    console.error(`[llm-proxy] Error:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Proxy error: ' + err.message, type: 'proxy_error' } }));
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[llm-proxy] LLM Proxy listening on 0.0.0.0:${PORT}`);
  console.log(`[llm-proxy] Provider: ${LLM_PROVIDER_BASE_URL}`);
  console.log(`[llm-proxy] Monthly budget: €${MONTHLY_BUDGET_EUR}`);
});

process.on('SIGTERM', () => { console.log('[llm-proxy] SIGTERM'); server.close(); process.exit(0); });
process.on('SIGINT', () => { console.log('[llm-proxy] SIGINT'); server.close(); process.exit(0); });
