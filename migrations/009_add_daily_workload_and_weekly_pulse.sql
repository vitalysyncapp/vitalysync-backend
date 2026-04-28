ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS workload_hours_band VARCHAR(20),
  ADD COLUMN IF NOT EXISTS perceived_stress_level SMALLINT CHECK (
    perceived_stress_level IS NULL
    OR perceived_stress_level BETWEEN 1 AND 5
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_logs_workload_hours_band_check'
  ) THEN
    ALTER TABLE daily_logs
      ADD CONSTRAINT daily_logs_workload_hours_band_check
      CHECK (
        workload_hours_band IS NULL
        OR workload_hours_band IN (
          'None',
          '1-2 hours',
          '3-4 hours',
          '5-6 hours',
          '6-7 hours',
          '8-9 hours',
          '10-12 hours'
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS weekly_pulse_responses (
  pulse_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  productivity_focus_level SMALLINT NOT NULL CHECK (
    productivity_focus_level BETWEEN 1 AND 5
  ),
  recovery_rest_level SMALLINT NOT NULL CHECK (
    recovery_rest_level BETWEEN 1 AND 5
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT weekly_pulse_responses_user_week_unique
    UNIQUE (user_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_weekly_pulse_responses_user_week_desc
  ON weekly_pulse_responses (user_id, week_start_date DESC);
