CREATE TABLE IF NOT EXISTS user_insight_reports (
  insight_report_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  report_type VARCHAR(20) NOT NULL CHECK (
    report_type IN ('daily', 'weekly')
  ),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  title VARCHAR(160) NOT NULL,
  summary TEXT NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'low' CHECK (
    priority IN ('low', 'medium', 'high')
  ),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_insight_reports_user_type_period_unique
    UNIQUE (user_id, report_type, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_user_insight_reports_user_updated_desc
  ON user_insight_reports (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_insight_reports_user_type_period_desc
  ON user_insight_reports (user_id, report_type, period_start DESC);
