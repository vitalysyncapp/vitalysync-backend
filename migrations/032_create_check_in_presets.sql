CREATE TABLE IF NOT EXISTS check_in_presets (
  preset_id       BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name            VARCHAR(40) NOT NULL,
  check_in_type   VARCHAR(6) NOT NULL,
  avatar_id       VARCHAR(32) NOT NULL,
  daily_answers   JSONB NOT NULL,
  weekly_answers  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT check_in_presets_name_check
    CHECK (char_length(BTRIM(name)) BETWEEN 1 AND 40),
  CONSTRAINT check_in_presets_type_check
    CHECK (check_in_type IN ('daily', 'weekly')),
  CONSTRAINT check_in_presets_avatar_check
    CHECK (char_length(BTRIM(avatar_id)) BETWEEN 1 AND 32),
  CONSTRAINT check_in_presets_daily_answers_check
    CHECK (jsonb_typeof(daily_answers) = 'object'),
  CONSTRAINT check_in_presets_weekly_answers_check
    CHECK (
      (check_in_type = 'daily' AND weekly_answers IS NULL)
      OR
      (check_in_type = 'weekly' AND jsonb_typeof(weekly_answers) = 'object')
    )
);

CREATE INDEX IF NOT EXISTS idx_check_in_presets_user_order
  ON check_in_presets (user_id, preset_id);
