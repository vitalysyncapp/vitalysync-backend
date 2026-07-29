ALTER TABLE user_baseline_epochs
  ADD COLUMN IF NOT EXISTS client_refresh_id VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_baseline_epochs_client_refresh
  ON user_baseline_epochs (user_id, client_refresh_id)
  WHERE client_refresh_id IS NOT NULL;
