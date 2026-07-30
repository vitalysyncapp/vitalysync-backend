ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reactivation_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_lifecycle_dates_check;

ALTER TABLE users
  ADD CONSTRAINT users_account_lifecycle_dates_check CHECK (
    (
      deactivated_at IS NULL
      AND reactivation_deadline IS NULL
      AND retention_expires_at IS NULL
    )
    OR (
      deactivated_at IS NOT NULL
      AND reactivation_deadline > deactivated_at
      AND retention_expires_at > reactivation_deadline
    )
  );

CREATE INDEX IF NOT EXISTS idx_users_active_account
  ON users (user_id)
  WHERE deactivated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_retention_expiry
  ON users (retention_expires_at)
  WHERE deactivated_at IS NOT NULL;
