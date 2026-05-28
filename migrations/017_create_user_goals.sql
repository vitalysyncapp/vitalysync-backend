CREATE TABLE IF NOT EXISTS user_goals (
  goal_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  goal_type VARCHAR(40) NOT NULL CHECK (
    goal_type IN (
      'wellness',
      'sleep_hours',
      'hydration_liters',
      'activity_days_per_week',
      'daily_steps',
      'nutrition_calories'
    )
  ),
  target_value NUMERIC(10, 2),
  target_text TEXT,
  unit VARCHAR(40),
  source VARCHAR(80) NOT NULL DEFAULT 'user',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_goals_user_type_unique UNIQUE (user_id, goal_type)
);

CREATE INDEX IF NOT EXISTS idx_user_goals_user_id
  ON user_goals (user_id);

CREATE INDEX IF NOT EXISTS idx_user_goals_type
  ON user_goals (goal_type);
