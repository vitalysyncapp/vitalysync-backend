-- Preserve all legacy records and distinguish the restored daily questionnaire.
ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS questionnaire_version TEXT NOT NULL DEFAULT 'daily_legacy_v1';

ALTER TABLE user_onboarding_profiles
  ADD COLUMN IF NOT EXISTS burnout_questionnaire_version TEXT NOT NULL DEFAULT 'baseline_15_v1';

-- Weekly self-report dimensions are independent of the daily wellness index.
CREATE TABLE IF NOT EXISTS weekly_burnout_assessments (
  assessment_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  response_date DATE NOT NULL,
  questionnaire_version TEXT NOT NULL,
  answers JSONB NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  scores JSONB NOT NULL CHECK (jsonb_typeof(scores) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, due_date)
);

CREATE INDEX IF NOT EXISTS idx_weekly_burnout_assessments_user_response_date
  ON weekly_burnout_assessments (user_id, response_date DESC);
