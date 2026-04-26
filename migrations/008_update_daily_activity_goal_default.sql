ALTER TABLE daily_activity_logs
  ALTER COLUMN goal_steps SET DEFAULT 5000;

ALTER TABLE daily_activity_logs
  ALTER COLUMN goal_distance_meters SET DEFAULT 3750;
