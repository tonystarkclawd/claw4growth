-- ============================================================================
-- C4G Migration 001: Instances & Configs (IDEMPOTENT — safe to re-run)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Instances ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS c4g_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  container_id TEXT,
  subdomain TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'running', 'stopped', 'error')) DEFAULT 'provisioning',
  error_message TEXT,
  composio_entity_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraint only if it doesn't exist
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'one_instance_per_user') THEN
    ALTER TABLE c4g_instances ADD CONSTRAINT one_instance_per_user UNIQUE (user_id);
  END IF;
END $$;

ALTER TABLE c4g_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own instance" ON c4g_instances;
CREATE POLICY "Users can view own instance"
  ON c4g_instances FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access" ON c4g_instances;
CREATE POLICY "Service role full access"
  ON c4g_instances FOR ALL
  USING (true) WITH CHECK (true);

-- ─── Instance Configs ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS c4g_instance_configs (
  instance_id UUID PRIMARY KEY REFERENCES c4g_instances(id) ON DELETE CASCADE,
  telegram_bot_token_encrypted TEXT,
  telegram_bot_username TEXT,
  minimax_key_encrypted TEXT,
  composio_keys_encrypted JSONB DEFAULT '{}',
  model_preference TEXT DEFAULT 'minimax',
  onboarding_data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE c4g_instance_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access configs" ON c4g_instance_configs;
CREATE POLICY "Service role full access configs"
  ON c4g_instance_configs FOR ALL
  USING (true) WITH CHECK (true);

-- ─── Subscriptions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS c4g_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  status TEXT CHECK (status IN ('active', 'canceled', 'past_due', 'unpaid')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE c4g_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access subs" ON c4g_subscriptions;
CREATE POLICY "Service role full access subs"
  ON c4g_subscriptions FOR ALL
  USING (true) WITH CHECK (true);

-- ─── Telegram Pairings ────────────────────────────────────
CREATE TABLE IF NOT EXISTS c4g_telegram_pairings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES c4g_instances(id) ON DELETE CASCADE,
  telegram_id BIGINT,
  code VARCHAR(8) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE c4g_telegram_pairings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access pairings" ON c4g_telegram_pairings;
CREATE POLICY "Service role full access pairings"
  ON c4g_telegram_pairings FOR ALL
  USING (true) WITH CHECK (true);

-- ─── Indexes (idempotent) ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_c4g_instances_user ON c4g_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_c4g_instances_status ON c4g_instances(status);
CREATE INDEX IF NOT EXISTS idx_c4g_subscriptions_user ON c4g_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_c4g_subscriptions_stripe ON c4g_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_c4g_pairings_code ON c4g_telegram_pairings(code) WHERE status = 'pending';

-- ─── Triggers ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION c4g_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_c4g_instances ON c4g_instances;
CREATE TRIGGER update_c4g_instances
  BEFORE UPDATE ON c4g_instances
  FOR EACH ROW EXECUTE FUNCTION c4g_update_updated_at();

DROP TRIGGER IF EXISTS update_c4g_subscriptions ON c4g_subscriptions;
CREATE TRIGGER update_c4g_subscriptions
  BEFORE UPDATE ON c4g_subscriptions
  FOR EACH ROW EXECUTE FUNCTION c4g_update_updated_at();
