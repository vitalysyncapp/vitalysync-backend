ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_token_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE auth_email_tokens
  ALTER COLUMN token_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS code_hash VARCHAR(60),
  ADD COLUMN IF NOT EXISTS failed_attempts SMALLINT NOT NULL DEFAULT 0;

UPDATE auth_email_tokens
SET consumed_at = NOW()
WHERE consumed_at IS NULL;

ALTER TABLE auth_email_tokens
  DROP CONSTRAINT IF EXISTS auth_email_tokens_credential_check;

ALTER TABLE auth_email_tokens
  ADD CONSTRAINT auth_email_tokens_credential_check CHECK (
    token_hash IS NOT NULL OR code_hash IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_email_type_active
  ON auth_email_tokens (LOWER(email), token_type, created_at DESC)
  WHERE consumed_at IS NULL;

DROP INDEX IF EXISTS idx_auth_email_tokens_user_type_active;

CREATE UNIQUE INDEX idx_auth_email_tokens_user_type_active
  ON auth_email_tokens (user_id, token_type)
  WHERE consumed_at IS NULL;
