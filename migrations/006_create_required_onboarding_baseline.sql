ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS role VARCHAR(50),
  ADD COLUMN IF NOT EXISTS lifestyle_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS wellness_goal VARCHAR(100);

CREATE TABLE IF NOT EXISTS user_onboarding_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role VARCHAR(50),
  lifestyle_type VARCHAR(50),
  wellness_goal VARCHAR(100),
  usual_sleep_time TIME,
  usual_wake_time TIME,
  exercise_goal_days VARCHAR(20),
  workload_level INTEGER CHECK (workload_level BETWEEN 1 AND 5),
  has_extra_responsibilities BOOLEAN DEFAULT FALSE,
  extra_responsibility_level INTEGER NULL CHECK (
    extra_responsibility_level IS NULL
    OR extra_responsibility_level BETWEEN 1 AND 5
  ),
  emotional_exhaustion_score NUMERIC(4, 2),
  depersonalization_score NUMERIC(4, 2),
  personal_accomplishment_score NUMERIC(4, 2),
  initial_burnout_score NUMERIC(4, 2),
  initial_burnout_level VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_onboarding_profiles_user_id_unique
  ON user_onboarding_profiles (user_id);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_profiles_level
  ON user_onboarding_profiles (initial_burnout_level);

CREATE TABLE IF NOT EXISTS user_onboarding_answers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_key VARCHAR(50) NOT NULL,
  question_text TEXT,
  category VARCHAR(80),
  answer_value TEXT,
  numeric_value INTEGER NULL CHECK (
    numeric_value IS NULL
    OR numeric_value BETWEEN 1 AND 5
  ),
  is_reverse_scored BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_onboarding_answers_user_question_unique
  ON user_onboarding_answers (user_id, question_key);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_answers_user_category
  ON user_onboarding_answers (user_id, category);
