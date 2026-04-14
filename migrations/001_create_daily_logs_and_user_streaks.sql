CREATE TABLE IF NOT EXISTS user_streaks (
  user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_logged_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_logs (
  log_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  sleep_hours NUMERIC(4, 1) NOT NULL CHECK (sleep_hours >= 0 AND sleep_hours <= 24),
  sleep_quality SMALLINT NOT NULL CHECK (sleep_quality BETWEEN 0 AND 4),
  mood_index SMALLINT NOT NULL CHECK (mood_index BETWEEN 0 AND 4),
  energy_level SMALLINT NOT NULL CHECK (energy_level BETWEEN 0 AND 2),
  hydration_liters NUMERIC(4, 2) NOT NULL CHECK (hydration_liters >= 0 AND hydration_liters <= 20),
  exercise_names TEXT[] NOT NULL CHECK (cardinality(exercise_names) > 0),
  symptom_names TEXT[] NOT NULL CHECK (cardinality(symptom_names) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_logs_user_date_unique UNIQUE (user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_logs_user_date_desc
  ON daily_logs (user_id, log_date DESC);

INSERT INTO user_streaks (user_id)
SELECT user_id
FROM users
ON CONFLICT (user_id) DO NOTHING;
