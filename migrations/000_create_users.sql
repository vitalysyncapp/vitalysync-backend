CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_completed_at TIMESTAMPTZ,
  age SMALLINT CHECK (age IS NULL OR age BETWEEN 1 AND 120),
  role VARCHAR(50),
  lifestyle_type VARCHAR(50),
  wellness_goal VARCHAR(100),
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  gender TEXT CHECK (gender IS NULL OR gender IN ('Male', 'Female', 'Other'))
);

CREATE INDEX IF NOT EXISTS idx_users_email
  ON users (email);

CREATE INDEX IF NOT EXISTS idx_users_onboarding_completed
  ON users (onboarding_completed);
