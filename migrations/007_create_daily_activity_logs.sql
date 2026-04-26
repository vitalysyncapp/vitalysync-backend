CREATE TABLE IF NOT EXISTS daily_activity_logs (
  activity_log_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  steps INTEGER NOT NULL DEFAULT 0 CHECK (steps >= 0),
  distance_meters NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (distance_meters >= 0),
  active_minutes INTEGER NOT NULL DEFAULT 0 CHECK (active_minutes >= 0),
  calories_burned NUMERIC(8, 2) NOT NULL DEFAULT 0 CHECK (calories_burned >= 0),
  exercise_type VARCHAR(40) NOT NULL DEFAULT 'walking',
  goal_steps INTEGER NOT NULL DEFAULT 8000 CHECK (goal_steps >= 0),
  goal_distance_meters NUMERIC(10, 2) NOT NULL DEFAULT 6000 CHECK (goal_distance_meters >= 0),
  goal_completed BOOLEAN NOT NULL DEFAULT FALSE,
  source VARCHAR(40) NOT NULL DEFAULT 'phone_sensor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_activity_logs_user_date_unique UNIQUE (user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_activity_logs_user_date_desc
  ON daily_activity_logs (user_id, log_date DESC);
