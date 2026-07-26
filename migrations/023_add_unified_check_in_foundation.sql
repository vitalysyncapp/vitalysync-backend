ALTER TABLE weekly_pulse_responses
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS response_date DATE,
  ADD COLUMN IF NOT EXISTS perceived_pressure_level SMALLINT CHECK (
    perceived_pressure_level IS NULL
    OR perceived_pressure_level BETWEEN 1 AND 5
  ),
  ADD COLUMN IF NOT EXISTS schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (
    schema_version >= 1
  );

UPDATE weekly_pulse_responses
SET due_date = COALESCE(due_date, week_start_date),
    response_date = COALESCE(
      response_date,
      updated_at::DATE,
      created_at::DATE,
      week_start_date
    );

ALTER TABLE weekly_pulse_responses
  ALTER COLUMN due_date SET NOT NULL,
  ALTER COLUMN response_date SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_weekly_pulse_responses_user_due_date_unique
  ON weekly_pulse_responses (user_id, due_date);

CREATE INDEX IF NOT EXISTS idx_weekly_pulse_responses_user_response_date_desc
  ON weekly_pulse_responses (user_id, response_date DESC);

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS check_in_idempotency_key VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_logs_user_check_in_idempotency
  ON daily_logs (user_id, check_in_idempotency_key)
  WHERE check_in_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_check_in_schedules (
  user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  pulse_weekday SMALLINT NOT NULL DEFAULT 1 CHECK (
    pulse_weekday BETWEEN 0 AND 6
  ),
  next_pulse_due_date DATE,
  last_completed_due_date DATE,
  last_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO user_check_in_schedules (
  user_id,
  pulse_weekday,
  last_completed_due_date,
  last_completed_at
)
SELECT
  users.user_id,
  COALESCE(preferences.weekly_pulse_reminder_day, 1),
  latest_pulse.due_date,
  latest_pulse.updated_at
FROM users
LEFT JOIN user_reminder_preferences preferences
  ON preferences.user_id = users.user_id
LEFT JOIN LATERAL (
  SELECT due_date, updated_at
  FROM weekly_pulse_responses
  WHERE weekly_pulse_responses.user_id = users.user_id
  ORDER BY due_date DESC, updated_at DESC
  LIMIT 1
) latest_pulse ON TRUE
ON CONFLICT (user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_user_check_in_schedules_next_due
  ON user_check_in_schedules (next_pulse_due_date)
  WHERE next_pulse_due_date IS NOT NULL;
