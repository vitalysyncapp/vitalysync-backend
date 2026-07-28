CREATE TABLE IF NOT EXISTS user_baseline_epochs (
  baseline_epoch_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  reset_reason VARCHAR(40) NOT NULL CHECK (
    reset_reason IN (
      'initial_onboarding',
      'thirty_day_return',
      'manual_baseline_refresh'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_baseline_epochs_one_active
  ON user_baseline_epochs (user_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_baseline_epochs_user_started_desc
  ON user_baseline_epochs (user_id, started_at DESC);

INSERT INTO user_baseline_epochs (user_id, started_at, reset_reason)
SELECT
  profile.user_id,
  COALESCE(profile.created_at, NOW()),
  'initial_onboarding'
FROM user_onboarding_profiles profile
WHERE NOT EXISTS (
  SELECT 1
  FROM user_baseline_epochs epoch
  WHERE epoch.user_id = profile.user_id
);

ALTER TABLE burnout_score_history
  ADD COLUMN IF NOT EXISTS baseline_epoch_id BIGINT;

UPDATE burnout_score_history history
SET baseline_epoch_id = (
  SELECT candidate.baseline_epoch_id
  FROM user_baseline_epochs candidate
  WHERE candidate.user_id = history.user_id
  ORDER BY candidate.started_at ASC, candidate.baseline_epoch_id ASC
  LIMIT 1
)
WHERE history.baseline_epoch_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM user_baseline_epochs candidate
    WHERE candidate.user_id = history.user_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'burnout_score_history_baseline_epoch_fk'
      AND conrelid = 'burnout_score_history'::regclass
  ) THEN
    ALTER TABLE burnout_score_history
      ADD CONSTRAINT burnout_score_history_baseline_epoch_fk
      FOREIGN KEY (baseline_epoch_id)
      REFERENCES user_baseline_epochs(baseline_epoch_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_burnout_score_history_user_epoch_date
  ON burnout_score_history (user_id, baseline_epoch_id, score_date DESC);
