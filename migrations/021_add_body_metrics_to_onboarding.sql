ALTER TABLE user_onboarding_profiles
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS bmi NUMERIC(4, 1);

ALTER TABLE user_onboarding
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS bmi NUMERIC(4, 1);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_onboarding_profiles_height_cm_reasonable_check'
      AND conrelid = 'user_onboarding_profiles'::regclass
  ) THEN
    ALTER TABLE user_onboarding_profiles
      ADD CONSTRAINT user_onboarding_profiles_height_cm_reasonable_check
      CHECK (height_cm IS NULL OR height_cm BETWEEN 100 AND 250);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_onboarding_profiles_weight_kg_reasonable_check'
      AND conrelid = 'user_onboarding_profiles'::regclass
  ) THEN
    ALTER TABLE user_onboarding_profiles
      ADD CONSTRAINT user_onboarding_profiles_weight_kg_reasonable_check
      CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_onboarding_profiles_bmi_reasonable_check'
      AND conrelid = 'user_onboarding_profiles'::regclass
  ) THEN
    ALTER TABLE user_onboarding_profiles
      ADD CONSTRAINT user_onboarding_profiles_bmi_reasonable_check
      CHECK (bmi IS NULL OR bmi BETWEEN 1 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_onboarding_height_cm_reasonable_check'
      AND conrelid = 'user_onboarding'::regclass
  ) THEN
    ALTER TABLE user_onboarding
      ADD CONSTRAINT user_onboarding_height_cm_reasonable_check
      CHECK (height_cm IS NULL OR height_cm BETWEEN 100 AND 250);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_onboarding_weight_kg_reasonable_check'
      AND conrelid = 'user_onboarding'::regclass
  ) THEN
    ALTER TABLE user_onboarding
      ADD CONSTRAINT user_onboarding_weight_kg_reasonable_check
      CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_onboarding_bmi_reasonable_check'
      AND conrelid = 'user_onboarding'::regclass
  ) THEN
    ALTER TABLE user_onboarding
      ADD CONSTRAINT user_onboarding_bmi_reasonable_check
      CHECK (bmi IS NULL OR bmi BETWEEN 1 AND 500);
  END IF;
END $$;
