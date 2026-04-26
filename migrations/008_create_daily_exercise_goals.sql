CREATE TABLE IF NOT EXISTS daily_exercise_goals (
  goal_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  recommended_by VARCHAR(80) NOT NULL DEFAULT 'vitalysync_assistant',
  exercise_name VARCHAR(120) NOT NULL,
  exercise_category VARCHAR(60) NOT NULL DEFAULT 'general',
  target_distance_meters NUMERIC(10, 2),
  target_minutes INTEGER,
  target_reps INTEGER,
  completion_method VARCHAR(40) NOT NULL DEFAULT 'manual',
  status VARCHAR(30) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'canceled', 'none')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_exercise_goals_user_date_unique UNIQUE (user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_exercise_goals_user_date_desc
  ON daily_exercise_goals (user_id, log_date DESC);

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS exercise_goal_name TEXT,
  ADD COLUMN IF NOT EXISTS exercise_goal_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exercise_goal_source TEXT,
  ADD COLUMN IF NOT EXISTS exercise_goal_status TEXT;
