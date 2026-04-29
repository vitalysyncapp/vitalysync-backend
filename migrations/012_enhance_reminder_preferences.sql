ALTER TABLE user_reminder_preferences
  ADD COLUMN IF NOT EXISTS hydration_start_time TIME NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS hydration_end_time TIME NOT NULL DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS hydration_interval_minutes SMALLINT NOT NULL DEFAULT 120 CHECK (
    hydration_interval_minutes BETWEEN 30 AND 360
  ),
  ADD COLUMN IF NOT EXISTS sleep_wind_down_time TIME NOT NULL DEFAULT '21:30',
  ADD COLUMN IF NOT EXISTS nudge_cooldown_hours SMALLINT NOT NULL DEFAULT 6 CHECK (
    nudge_cooldown_hours BETWEEN 1 AND 48
  ),
  ADD COLUMN IF NOT EXISTS max_daily_nudges SMALLINT NOT NULL DEFAULT 3 CHECK (
    max_daily_nudges BETWEEN 1 AND 10
  );

UPDATE user_reminder_preferences
SET daily_log_reminder_time = COALESCE(daily_log_reminder_time, '20:00'),
    weekly_pulse_reminder_day = COALESCE(weekly_pulse_reminder_day, 1),
    weekly_pulse_reminder_time = COALESCE(weekly_pulse_reminder_time, '18:00'),
    hydration_start_time = COALESCE(hydration_start_time, '07:00'),
    hydration_end_time = COALESCE(hydration_end_time, '21:00'),
    hydration_interval_minutes = COALESCE(hydration_interval_minutes, 120),
    sleep_wind_down_time = COALESCE(sleep_wind_down_time, '21:30'),
    nudge_cooldown_hours = COALESCE(nudge_cooldown_hours, 6),
    max_daily_nudges = COALESCE(max_daily_nudges, 3);
