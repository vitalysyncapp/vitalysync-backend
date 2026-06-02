ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS daily_detachment_level SMALLINT CHECK (
    daily_detachment_level IS NULL
    OR daily_detachment_level BETWEEN 1 AND 5
  ),
  ADD COLUMN IF NOT EXISTS daily_focus_level SMALLINT CHECK (
    daily_focus_level IS NULL
    OR daily_focus_level BETWEEN 1 AND 5
  ),
  ADD COLUMN IF NOT EXISTS daily_accomplishment_level SMALLINT CHECK (
    daily_accomplishment_level IS NULL
    OR daily_accomplishment_level BETWEEN 1 AND 5
  );
