# Wrapper → C4G transfer map

This folder contains the essential pieces extracted from `ClawWrapper-custom` to make C4G fully portable from this repo.

## Included
- `lib/docker/containers.ts` → real container provisioning lifecycle
- `lib/instance-actions.ts` → deploy/start/stop/restart actions
- `lib/supabase/instance-db.ts` → instance + config persistence
- `lib/telegram/pairing.ts` → pairing code generation/approval
- `supabase/migrations/001_instances.sql` + `003_telegram.sql` (+ `005_c4g_schema.sql` draft)
- `app/api/telegram/webhook/route.ts` + `generate-code/route.ts`
- `app/dashboard/telegram/page.tsx`
- `components/TelegramBotTokenForm.tsx`

## Still to wire in main app runtime
1. Hook Stripe `checkout.session.completed` to call `/api/deploy`
2. Wire `instance-actions.ts` into C4G dashboard routes
3. Add `TELEGRAM_BOT_TOKEN` / BYOB token update flow in dashboard
4. Configure Docker host + Caddy routing on VPS
5. Apply migrations in Supabase

## Why this folder
Keeps all extracted wrapper logic inside C4G repo so development from your PC can happen from one repository.
