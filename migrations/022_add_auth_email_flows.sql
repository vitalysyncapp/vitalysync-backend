ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS auth_email_tokens (
  token_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  token_type TEXT NOT NULL CHECK (
    token_type IN ('email_verification', 'password_reset')
  ),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_user_type_active
  ON auth_email_tokens (user_id, token_type, expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_hash_type_active
  ON auth_email_tokens (token_hash, token_type)
  WHERE consumed_at IS NULL;
