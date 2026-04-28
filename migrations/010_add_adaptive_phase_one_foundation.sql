ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS break_quality_level SMALLINT CHECK (
    break_quality_level IS NULL
    OR break_quality_level BETWEEN 1 AND 5
  );

ALTER TABLE weekly_pulse_responses
  ADD COLUMN IF NOT EXISTS detachment_level SMALLINT CHECK (
    detachment_level IS NULL
    OR detachment_level BETWEEN 1 AND 5
  ),
  ADD COLUMN IF NOT EXISTS accomplishment_level SMALLINT CHECK (
    accomplishment_level IS NULL
    OR accomplishment_level BETWEEN 1 AND 5
  );

CREATE TABLE IF NOT EXISTS nudge_events (
  nudge_event_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  nudge_type VARCHAR(60) NOT NULL,
  trigger_reason TEXT,
  message TEXT NOT NULL,
  action_label VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'shown' CHECK (
    status IN ('shown', 'accepted', 'dismissed', 'completed', 'snoozed')
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nudge_events_user_created_desc
  ON nudge_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nudge_events_user_status
  ON nudge_events (user_id, status);

CREATE TABLE IF NOT EXISTS user_reminder_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  daily_log_reminder_time TIME,
  weekly_pulse_reminder_day SMALLINT CHECK (
    weekly_pulse_reminder_day IS NULL
    OR weekly_pulse_reminder_day BETWEEN 0 AND 6
  ),
  weekly_pulse_reminder_time TIME,
  hydration_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  recovery_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sleep_wind_down_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_events (
  notification_event_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  notification_type VARCHAR(60) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled', 'sent', 'dismissed', 'failed')
  ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_events_user_created_desc
  ON notification_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_events_user_status
  ON notification_events (user_id, status);
