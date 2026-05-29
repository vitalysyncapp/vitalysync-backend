ALTER TABLE users
  ALTER COLUMN wellness_goal TYPE TEXT,
  ADD COLUMN IF NOT EXISTS wellness_goals TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE user_onboarding_profiles
  ALTER COLUMN wellness_goal TYPE TEXT,
  ADD COLUMN IF NOT EXISTS wellness_goals TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS wellness_goals TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

UPDATE users
SET wellness_goals = regexp_split_to_array(wellness_goal, '\s*,\s*')
WHERE wellness_goal IS NOT NULL
  AND TRIM(wellness_goal) <> ''
  AND wellness_goals = '{}'::TEXT[];

UPDATE user_onboarding_profiles
SET wellness_goals = regexp_split_to_array(wellness_goal, '\s*,\s*')
WHERE wellness_goal IS NOT NULL
  AND TRIM(wellness_goal) <> ''
  AND wellness_goals = '{}'::TEXT[];

UPDATE user_preferences
SET wellness_goals = regexp_split_to_array(primary_goal, '\s*,\s*')
WHERE primary_goal IS NOT NULL
  AND TRIM(primary_goal) <> ''
  AND wellness_goals = '{}'::TEXT[];

CREATE INDEX IF NOT EXISTS idx_users_wellness_goals
  ON users USING GIN (wellness_goals);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_profiles_wellness_goals
  ON user_onboarding_profiles USING GIN (wellness_goals);

CREATE INDEX IF NOT EXISTS idx_user_preferences_wellness_goals
  ON user_preferences USING GIN (wellness_goals);
