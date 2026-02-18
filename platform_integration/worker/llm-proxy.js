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
const PORT = parseInt(envVars.LLM_PROXY_PORT || '19000', 10);

if (!LLM_PROVIDER_BASE_URL || !LLM_PROVIDER_API_KEY) {
  console.error('[llm-proxy] Missing LLM_PROVIDER_BASE_URL or LLM_PROVIDER_API_KEY');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[llm-proxy] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ─── Default model ──────────────────────────────────────
const DEFAULT_MODEL = envVars.DEFAULT_MODEL || 'openai/gpt-4o-mini';

// ─── Token pricing (EUR per 1 token) ───────────────────
// Prices from OpenRouter, converted USD→EUR at ~0.92
const TOKEN_PRICES = {
  'openai/gpt-4o-mini':            { input: 0.000000138, output: 0.000000552 },
  'openai/gpt-4o':                 { input: 0.0000023,   output: 0.0000092  },
  'google/gemini-2.0-flash':       { input: 0.0000001,   output: 0.0000004  },
  'google/gemini-2.5-pro-preview': { input: 0.00000115,  output: 0.0000046  },
  'anthropic/claude-sonnet-4':     { input: 0.00000276,  output: 0.0000138  },
  'anthropic/claude-haiku-4':      { input: 0.00000073,  output: 0.00000368 },
  'default':                       { input: 0.000001,    output: 0.000004   },
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

  // Log all requests for debugging
  console.log(`[llm-proxy] ${req.method} ${req.url}`);

  // Forward any /v1/* request (chat/completions, responses, models, etc.)
  if (!req.url.startsWith('/v1/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /v1/* endpoints.' }));
    return;
  }

  // GET /v1/models — return available models (no budget check needed)
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    const models = Object.keys(TOKEN_PRICES)
      .filter(k => k !== 'default')
      .map(id => ({ id, object: 'model', owned_by: 'openrouter' }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: models }));
    return;
  }

  // Only budget-check and forward POST requests
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
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

    // 2. Read request, ensure model is set, and forward to OpenRouter
    const body = await readBody(req);
    let forwardBody = body;
    let requestModel = DEFAULT_MODEL;
    try {
      const parsed = JSON.parse(body.toString());
      // If no model or generic model name, inject default
      if (!parsed.model || parsed.model === 'gpt-4o-mini' || parsed.model === 'default') {
        parsed.model = DEFAULT_MODEL;
      }
      requestModel = parsed.model;
      forwardBody = JSON.stringify(parsed);
    } catch {}

    // Forward to OpenRouter (same path structure: /v1/chat/completions → /chat/completions)
    const forwardPath = req.url.replace(/^\/v1/, '');
    const providerUrl = `${LLM_PROVIDER_BASE_URL}${forwardPath}`;

    const providerRes = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_PROVIDER_API_KEY}`,
        'HTTP-Referer': 'https://claw4growth.com',
        'X-Title': 'Claw4Growth',
      },
      body: forwardBody,
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
  console.log(`[llm-proxy] Default model: ${DEFAULT_MODEL}`);
  console.log(`[llm-proxy] Monthly budget: €${MONTHLY_BUDGET_EUR}`);
});

process.on('SIGTERM', () => { console.log('[llm-proxy] SIGTERM'); server.close(); process.exit(0); });
process.on('SIGINT', () => { console.log('[llm-proxy] SIGINT'); server.close(); process.exit(0); });
