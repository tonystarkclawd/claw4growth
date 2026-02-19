# Claw4Growth — PRD (Current State)
**Last update:** 2026-02-19 (UTC)
**Owner:** Luca
**Execution:** Tony + Pieter
**Status:** MVP functional — end-to-end flow live

---

## 1) Product Goal
Claw4Growth is a **managed AI marketing operator** for non-technical marketers.

Core promise:
- Buy in minutes
- Get an operator deployed automatically
- Start working via Telegram + connected marketing apps

---

## 2) Non-Negotiable Decisions

1. **Onboarding order (final):**
   Login → Name → Brand → Tone → Payment → Deploy → Telegram setup

2. **Deploy should be automatic after payment** (no manual deploy step for users).

3. **Telegram bot flow (launch): Platform bot**
   - User receives pairing code after deploy
   - User clicks "Open on Telegram" → deep link to @Claw4GrowthBot
   - Bot links Telegram account to their instance
   - BYOB (custom bot token) available as optional feature in dashboard

4. **Integrations use full redirect OAuth** (no popups).

5. **Meta Ads is covered by Facebook integration** (no separate Meta Ads app card).

6. **Single launch offer:** €34.90/mo (Early Bird).

7. **Wrapper is used for reverse-engineering only**; source of truth must be C4G repo.

---

## 3) Tech Architecture

### Frontend
- Landing page: `www.claw4growth.com` (static, Vercel)
- Onboarding + Dashboard: `app.claw4growth.com` (Next.js, Vercel)

### Backend (Vercel API routes)
- Deploy/provisioning: `POST /api/deploy` → Fly Machines API (push-based)
- Telegram webhook: `POST /api/telegram/webhook`
- Google OAuth: `/api/google-connect` + `/api/google-callback`
- Stripe webhook: `POST /api/stripe-webhook`
- Server Actions: start/stop/restart/delete instances

### Infrastructure (Fly.io)
- **c4g-workers** Fly app — Per-user Fly Machines (OpenClaw gateway)
  - Each user: dedicated machine (shared CPU, 2GB+ RAM) + 1GB encrypted volume
  - OpenClaw gateway (port 18789, `--bind lan`)
  - TLS auto via Fly Proxy (`*.fly.dev`)

### LLM (OpenRouter per-user provisioned keys)
- Each user gets their own OpenRouter API key via Management API
- Budget cap: $22/month per key (enforced by OpenRouter)
- Model: `openrouter/google/gemini-2.5-flash` (native OpenRouter support in OpenClaw)
- Usage tracking via OpenRouter key usage API
- No custom LLM proxy needed

### Database (Supabase)
- Auth, persistence, billing, token storage
- Tables: `c4g_instances`, `c4g_instance_configs`, `c4g_subscriptions`, `c4g_telegram_pairings`, `c4g_google_tokens`

---

## 4) Repository Strategy

### Primary working repo (source of truth)
`/Users/lucavizzielli/claw4growth/c4g-fly/`
GitHub: `https://github.com/viluca94/c4g-fly` (private)
Deploy: Vercel auto-deploy on push to main

### Deprecated
- `platform_integration/` — DEPRECATED, do not use
- `ClawWrapper-custom` / `ClawWrapper` — reference only

---

## 5) Current State (As-Is)

### ✅ Done

#### Infra & Provisioning
- Fly.io infra live (c4g-workers app, fra region)
- Per-user Fly Machines with encrypted volumes
- Push-based deploy via Machines API (no polling)
- Cold start ~50s (image pull + boot), grace period 60s

#### LLM & Usage
- OpenRouter per-user provisioned keys (Management API)
- $22/month budget cap per user (enforced by OpenRouter)
- Usage tracking via OpenRouter key API
- Model: `openrouter/openai/gpt-4o-mini` (native OpenClaw support)

#### Deploy Flow
- POST /api/deploy: validate → create instance → create OpenRouter key → create volume → create machine
- Stripe checkout → automatic deploy trigger (idempotent)
- Status polling in dashboard (provisioning → running)

#### Dashboard
- Instance status (provisioning/running/stopped/error)
- Start/stop/restart/delete actions
- Integration grid (Google Suite direct OAuth + Composio for others)
- API usage bar (from OpenRouter key API)
- Subscription info with Stripe management

#### Telegram
- Platform bot pairing (deep link with code)
- Webhook routing: telegram_id → instance → Fly machine
- `fly-force-instance-id` header for routing to specific machines

#### UX / Onboarding
- Full onboarding flow: Login → Name → Brand → Tone → Payment → Deploy → Telegram
- Deploy animation with mascot
- Post-deploy: warmup notice + dashboard CTA
- Google OAuth redirect back to dashboard (not login page)

#### Integrations
- Google direct OAuth: Ads, Gmail, Calendar, Drive, Docs, Sheets, Analytics
- Composio: Meta/Facebook, Instagram, LinkedIn, Reddit, Stripe, Shopify, HubSpot, Notion, Meta Ads
- Connect/disconnect from dashboard
- MCP Bridge (MCPorter): agent → mcp-bridge.js → /api/bridge → Google/Composio executors

#### Agent Integration Testing (Ralph Loop — 2026-02-19)
- **Google services tested**: Gmail, Calendar, Drive, Docs, Sheets, GA4 — all PASS
- **Composio services tested**: Stripe, Instagram, Reddit, Notion, Facebook — all PASS
- **Partial**: HubSpot (scope 403), LinkedIn (rate limit 429), Meta Ads (no discovery tool)
- **Blocked**: Google Ads (account disabled)
- **Multi-step cross-service**: Reddit→Sheets PASS, IG→Notion PARTIAL, Gmail→Docs PASS, GA4→Sheets PASS
- **Auto-correction**: agent self-corrects JSON errors, tool failures, and API retries

### ⚠️ Partially Done / TODO
- Telegram BYOB flow (custom bot token) — save/restart works, needs polish
- Dashboard "Your Operator" section — too technical for non-tech users, simplify to status badge
- Auto-stop / scale-to-zero for user machines (cost optimization)
- Custom domain `*.claw4growth.com` → Fly (currently using `*.fly.dev`)
- Error recovery + retry for transient provisioning failures
- HubSpot: re-auth OAuth con scope `marketing.campaigns.read` per campagne
- LinkedIn: rate limit 429 giornaliero — serve piano API superiore
- Meta Ads: nessun discovery tool in default toolkit — agent chiede `act_` ID manualmente
- Google Ads: serve account attivo per completare training
- Calendar: data/ora corrente nel system prompt per query relative ("prossimo meeting")
- Agent: leak "THOUGHT..." occasionale — investigare se bug OpenClaw o config

---

## 6) MVP Scope (What must work)

A paying user must be able to:
1. ✅ Complete onboarding + payment
2. ✅ Be auto-provisioned to a running instance
3. ✅ Open dashboard URL
4. ⚠️ Add personal Telegram bot token (BYOB) — works but needs UX polish
5. ✅ Pair Telegram account successfully (via platform bot)
6. ✅ Connect at least 2 OAuth apps (e.g. Google + Facebook)
7. ✅ Send first Telegram command and receive valid response from own isolated instance

---

## 7) Delivery Plan (Execution Order)

### ✅ Phase A — Infra Backbone (COMPLETE)
1. ~~Provision dedicated VPS~~ → Migrated to Fly.io
2. Per-user Fly Machines with encrypted volumes
3. Push-based deploy via Machines API
4. Health checks + grace period for cold start

### ✅ Phase B — Data + Deploy Reliability (COMPLETE)
1. Supabase migrations applied
2. Idempotent Stripe webhook handling
3. State transitions (provisioning/running/error) with error messages
4. OpenRouter per-user keys with budget caps

### ✅ Phase C — Dashboard Live Wiring (COMPLETE)
1. Instance actions (start/stop/restart/delete) in dashboard
2. Status polling with auto-refresh
3. Integration grid with connect/disconnect
4. Usage tracking from OpenRouter API

### ✅ Phase D — Telegram + Integrations E2E (COMPLETE)
1. Platform bot pairing flow
2. Webhook routing to user machines
3. Google direct OAuth (9 services)
4. Composio OAuth for non-Google services

### ✅ Phase E — Agent Integration Training (COMPLETE)
1. MCP Bridge via MCPorter (mcp-bridge.js → /api/bridge)
2. Google services: Gmail, Calendar, Drive, Docs, Sheets, GA4 — all tested PASS
3. Composio toolkit versioning fix (default vs latest — critical)
4. Composio services: Stripe, Instagram, Reddit, Notion, Facebook — tested PASS
5. Multi-step cross-service tasks (fetch A → write B) — tested PASS
6. SKILL.md agent with full cookbook per service (workspace version 24)

### 🔄 Phase F — Hardening (IN PROGRESS)
1. Auto-stop / scale-to-zero for cost optimization
2. Dashboard UX simplification (remove infra jargon)
3. Custom domain setup (`*.claw4growth.com`)
4. Error recovery + retry mechanisms
5. HubSpot re-auth with wider OAuth scopes
6. LinkedIn higher API tier for rate limits
7. Calendar date/time injection in system prompt
8. Investigate THOUGHT leaking in agent responses

---

## 8) Brand/UI Requirements for Dashboard
Must be fully C4G, not wrapper-generic:

- Color system aligned to C4G brand
- Copy in C4G tone (marketer-friendly, non-technical)
- KPI-first layout (campaign utility, not infra jargon)
- Clear state labels: setup complete / action needed
- Mobile-first dashboard behavior
- **No infrastructure jargon** — status should be simple green/red badge, not machine controls

---

## 9) Environment Variables

- Supabase:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

- Stripe:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `C4G_STRIPE_PRICE_ID`

- Fly.io:
  - `FLY_API_TOKEN`
  - `FLY_WORKERS_APP` (`c4g-workers`)
  - `FLY_REGION` (`fra`)
  - `C4G_GATEWAY_TOKEN`

- OpenRouter:
  - `OPENROUTER_MANAGEMENT_KEY` (Management API key for provisioning per-user keys)
  - `OPENROUTER_MONTHLY_BUDGET_USD` ($22)

- Google:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_ADS_DEVELOPER_TOKEN`
  - `ENCRYPTION_KEY` (AES-256-GCM for token storage)

- Telegram:
  - `PLATFORM_TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_WEBHOOK_SECRET`

- Integrations:
  - `COMPOSIO_API_KEY`

- App:
  - `NEXT_PUBLIC_APP_URL` (`https://app.claw4growth.com`)

---

## 10) Current Priorities

1. **Integration improvements** — fix HubSpot scopes, LinkedIn rate limits, Meta Ads discovery
2. **Calendar context** — inject current date/time in system prompt for relative queries
3. **Auto-stop** — scale-to-zero for cost optimization (currently machines run 24/7)
4. **Dashboard simplification** — remove "Your Operator" section, add simple status badge
5. **Custom domain** — `*.claw4growth.com` instead of `*.fly.dev`
6. **THOUGHT leaking** — investigate and fix agent printing internal thoughts

---

## 11) Definition of Done (MVP)

| Criteria | Status |
|----------|--------|
| Payment triggers auto-deploy reliably | ✅ Done |
| Instance is reachable and healthy | ✅ Done |
| Telegram setup works without manual engineering intervention | ✅ Done (platform bot) |
| User can use operator from Telegram on first day | ✅ Done |
| No cross-user data leakage (isolated containers + isolated memory) | ✅ Done |

**MVP is functionally complete.** Remaining work is hardening and UX polish.

---

**Single source of execution:** `c4g-fly` repo (`/Users/lucavizzielli/claw4growth/c4g-fly/`).
