CREATE TABLE IF NOT EXISTS streak_saver_periods (
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  base_savers INTEGER NOT NULL DEFAULT 3 CHECK (base_savers >= 0),
  earned_savers INTEGER NOT NULL DEFAULT 0 CHECK (earned_savers >= 0),
  used_savers INTEGER NOT NULL DEFAULT 0 CHECK (used_savers >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, period_month),
  CHECK (used_savers <= base_savers + earned_savers)
);

CREATE TABLE IF NOT EXISTS streak_saver_events (
  event_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('grant', 'spend')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason VARCHAR(80) NOT NULL,
  protected_date DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS streak_protected_days (
  protected_day_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  protected_date DATE NOT NULL,
  period_month DATE NOT NULL,
  saver_event_id BIGINT REFERENCES streak_saver_events(event_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT streak_protected_days_user_date_unique UNIQUE (user_id, protected_date)
);

CREATE TABLE IF NOT EXISTS streak_reward_claims (
  claim_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  reward_key VARCHAR(80) NOT NULL,
  period_key VARCHAR(40) NOT NULL,
  period_month DATE NOT NULL,
  awarded_savers INTEGER NOT NULL DEFAULT 0 CHECK (awarded_savers >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT streak_reward_claims_user_reward_period_unique
    UNIQUE (user_id, reward_key, period_key)
);

CREATE INDEX IF NOT EXISTS idx_streak_saver_events_user_created
  ON streak_saver_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_streak_protected_days_user_date
  ON streak_protected_days (user_id, protected_date DESC);

CREATE INDEX IF NOT EXISTS idx_streak_reward_claims_user_key
  ON streak_reward_claims (user_id, reward_key);
