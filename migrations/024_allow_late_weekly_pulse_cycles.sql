ALTER TABLE weekly_pulse_responses
  DROP CONSTRAINT IF EXISTS weekly_pulse_responses_user_week_unique;

-- A late response and the next scheduled pulse can occur in the same calendar
-- week. The unique due-date index from migration 023 is the cycle identity;
-- week_start_date remains available for grouping and legacy reads.
CREATE INDEX IF NOT EXISTS idx_weekly_pulse_responses_user_week_desc
  ON weekly_pulse_responses (user_id, week_start_date DESC);
