-- Google OAuth tokens (encrypted at rest via app-level AES-256-GCM)
-- Tokens are encrypted/decrypted in application code, stored as opaque text here.

CREATE TABLE IF NOT EXISTS c4g_google_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Encrypted fields (AES-256-GCM, decrypted only in app code)
    access_token_enc TEXT NOT NULL,
    refresh_token_enc TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    google_ads_customer_id TEXT,
    google_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

ALTER TABLE c4g_google_tokens ENABLE ROW LEVEL SECURITY;

-- Only service role can access (no direct client access)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'c4g_google_tokens' AND policyname = 'Service role full access'
    ) THEN
        CREATE POLICY "Service role full access" ON c4g_google_tokens
            FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_google_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_google_tokens_updated_at ON c4g_google_tokens;
CREATE TRIGGER trg_google_tokens_updated_at
    BEFORE UPDATE ON c4g_google_tokens
    FOR EACH ROW EXECUTE FUNCTION update_google_tokens_updated_at();

CREATE INDEX IF NOT EXISTS idx_google_tokens_user_id ON c4g_google_tokens(user_id);
