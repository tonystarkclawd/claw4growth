# Wrapper → C4G transfer map

This folder contains the essential pieces extracted from `ClawWrapper-custom` to make C4G fully portable from this repo.

## Included
- `lib/docker/containers.ts` → real container provisioning lifecycle
- `lib/instance-actions.ts` → deploy/start/stop/restart actions
- `lib/supabase/instance-db.ts` → instance + config persistence
- `lib/telegram/pairing.ts` → pairing code generation/approval
- `supabase/migrations/001_instances.sql` + `003_telegram.sql` (+ `005_c4g_schema.sql` draft)
- `supabase/migrations/20260218_create_api_usage.sql` → API usage tracking table
- `app/api/telegram/webhook/route.ts` + `generate-code/route.ts`
- `app/dashboard/telegram/page.tsx`
- `components/TelegramBotTokenForm.tsx`
- `worker/provisioner.js` → systemd service, polls Supabase, provisions Docker containers
- `worker/llm-proxy.js` → provider-agnostic LLM proxy with budget cap & usage logging
- `worker/c4g-llm-proxy.service` → systemd unit file for the proxy

## Live on VPS (168.119.156.2)
- [x] Docker + Caddy routing configured
- [x] Supabase migrations applied (instances, configs, api_usage)
- [x] `c4g-provisioner` systemd service running
- [x] `c4g-llm-proxy` systemd service running (:18800)
- [x] Containers route LLM calls through proxy (OPENAI_BASE_URL)

## Still to wire in main app runtime
1. Hook Stripe `checkout.session.completed` to call `/api/deploy`
2. Wire `instance-actions.ts` into C4G dashboard routes (start/stop/restart)
3. Add `TELEGRAM_BOT_TOKEN` / BYOB token update flow in dashboard

## Why this folder
Keeps all extracted wrapper logic inside C4G repo so development from your PC can happen from one repository.
