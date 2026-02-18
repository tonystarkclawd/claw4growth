-- API Usage Tracking table
-- Tracks token usage and estimated cost per user per LLM call
CREATE TABLE c4g_api_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  model text NOT NULL,
  prompt_tokens int NOT NULL DEFAULT 0,
  completion_tokens int NOT NULL DEFAULT 0,
  estimated_cost_eur numeric(10,6) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_usage_user_month ON c4g_api_usage (user_id, created_at);
