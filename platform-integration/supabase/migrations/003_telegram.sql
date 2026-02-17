-- ============================================================================
-- Migration 003: Telegram Pairings
-- ============================================================================
-- Creates the telegram_pairings table for pairing Telegram accounts
-- with platform users via one-time codes.
--
-- Requires: 001_instances.sql (auth.users reference)
-- Feature flag: NEXT_PUBLIC_ENABLE_TELEGRAM=true
-- ============================================================================

-- Telegram pairing codes table
CREATE TABLE IF NOT EXISTS telegram_pairings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_id BIGINT,
  code VARCHAR(8) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE telegram_pairings ENABLE ROW LEVEL SECURITY;

-- Users can read their own pairings
CREATE POLICY "Users can read own pairings"
  ON telegram_pairings FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own pairings
CREATE POLICY "Users can insert own pairings"
  ON telegram_pairings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role has full access (needed for webhook handlers)
CREATE POLICY "Service role full access"
  ON telegram_pairings FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for fast code lookups during pairing approval
CREATE INDEX IF NOT EXISTS idx_telegram_pairings_code
  ON telegram_pairings (code)
  WHERE status = 'pending';

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_telegram_pairings_user_id
  ON telegram_pairings (user_id);
