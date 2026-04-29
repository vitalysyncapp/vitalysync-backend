CREATE TABLE IF NOT EXISTS ai_nudge_generations (
  ai_nudge_generation_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  nudge_event_id BIGINT REFERENCES nudge_events(nudge_event_id) ON DELETE SET NULL,
  nudge_type VARCHAR(60) NOT NULL,
  model VARCHAR(80) NOT NULL,
  prompt_version VARCHAR(40) NOT NULL,
  context_hash VARCHAR(80) NOT NULL,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_status VARCHAR(20) NOT NULL DEFAULT 'valid' CHECK (
    validation_status IN ('valid', 'fallback', 'invalid', 'error')
  ),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_nudge_generations_user_created_desc
  ON ai_nudge_generations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_nudge_generations_nudge_event
  ON ai_nudge_generations (nudge_event_id);
