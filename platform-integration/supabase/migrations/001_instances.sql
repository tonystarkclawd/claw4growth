-- Enable pgcrypto extension for encryption functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create instances table
CREATE TABLE instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  container_id TEXT,
  subdomain TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'running', 'stopped', 'error')) DEFAULT 'provisioning',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT one_instance_per_user UNIQUE (user_id)
);

-- Enable RLS on instances
ALTER TABLE instances ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for instances
CREATE POLICY "Users can view own instance"
  ON instances
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own instance"
  ON instances
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own instance"
  ON instances
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own instance"
  ON instances
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create instance_configs table
CREATE TABLE instance_configs (
  instance_id UUID PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
  anthropic_key_encrypted TEXT,
  openai_key_encrypted TEXT,
  telegram_bot_token_encrypted TEXT,
  model_preference TEXT DEFAULT 'claude-sonnet-4-20250514',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on instance_configs
ALTER TABLE instance_configs ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for instance_configs
CREATE POLICY "Users can manage own config"
  ON instance_configs
  FOR ALL
  USING (instance_id IN (SELECT id FROM instances WHERE user_id = auth.uid()));

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to instances table
CREATE TRIGGER update_instances_updated_at
  BEFORE UPDATE ON instances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply updated_at trigger to instance_configs table
CREATE TRIGGER update_instance_configs_updated_at
  BEFORE UPDATE ON instance_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
