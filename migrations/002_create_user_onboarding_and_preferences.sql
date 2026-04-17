ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  role_type TEXT,
  work_hours_per_day SMALLINT CHECK (work_hours_per_day BETWEEN 0 AND 24),
  sleep_hours NUMERIC(4, 1) CHECK (sleep_hours BETWEEN 0 AND 24),
  activity_level TEXT,
  exercise_days_per_week SMALLINT CHECK (exercise_days_per_week BETWEEN 0 AND 7),
  meal_regularness TEXT,
  stress_level SMALLINT CHECK (stress_level BETWEEN 1 AND 5),
  mental_drain_level SMALLINT CHECK (mental_drain_level BETWEEN 1 AND 5),
  focus_difficulty_level SMALLINT CHECK (focus_difficulty_level BETWEEN 1 AND 5),
  overwhelm_level SMALLINT CHECK (overwhelm_level BETWEEN 1 AND 5),
  recovery_level SMALLINT CHECK (recovery_level BETWEEN 1 AND 5),
  motivation_level SMALLINT CHECK (motivation_level BETWEEN 1 AND 5),
  skipped BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  preferred_log_time TIME,
  default_wake_time TIME,
  default_sleep_time TIME,
  default_work_start TIME,
  default_work_end TIME,
  prefers_daily_reminder BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_time TIME,
  prefers_hydration_reminder BOOLEAN NOT NULL DEFAULT TRUE,
  prefers_exercise_reminder BOOLEAN NOT NULL DEFAULT TRUE,
  prefers_sleep_reminder BOOLEAN NOT NULL DEFAULT TRUE,
  preferred_nudge_style TEXT,
  primary_goal TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_busy_days (
  busy_day_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_busy_days_user_day_unique UNIQUE (user_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_user_busy_days_user_id
  ON user_busy_days (user_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'user_type'
  ) THEN
    INSERT INTO user_onboarding (
      user_id,
      role_type,
      skipped
    )
    SELECT
      user_id,
      NULLIF(TRIM(COALESCE(user_type, '')), ''),
      FALSE
    FROM users
    WHERE (
      NULLIF(TRIM(COALESCE(user_type, '')), '') IS NOT NULL
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;

UPDATE users
SET onboarding_completed = TRUE,
    onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
WHERE onboarding_completed = FALSE
  AND EXISTS (
    SELECT 1
    FROM user_preferences preferences
    WHERE preferences.user_id = users.user_id
  );

ALTER TABLE users DROP COLUMN IF EXISTS age;
ALTER TABLE users DROP COLUMN IF EXISTS gender;
ALTER TABLE users DROP COLUMN IF EXISTS user_type;
