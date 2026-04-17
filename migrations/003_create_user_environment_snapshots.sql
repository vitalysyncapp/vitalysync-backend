CREATE TABLE IF NOT EXISTS user_environment_snapshots (
  snapshot_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  day_period TEXT NOT NULL CHECK (day_period IN ('morning', 'noon', 'night')),
  location_name TEXT,
  latitude NUMERIC(9, 6) NOT NULL,
  longitude NUMERIC(9, 6) NOT NULL,
  weather_main TEXT,
  weather_description TEXT,
  weather_icon TEXT,
  temperature_c NUMERIC(5, 2),
  feels_like_c NUMERIC(5, 2),
  humidity SMALLINT CHECK (humidity BETWEEN 0 AND 100),
  pressure INTEGER,
  wind_speed NUMERIC(6, 2),
  aqi SMALLINT CHECK (aqi BETWEEN 1 AND 5),
  aqi_label TEXT,
  pm2_5 NUMERIC(8, 2),
  pm10 NUMERIC(8, 2),
  o3 NUMERIC(8, 2),
  no2 NUMERIC(8, 2),
  so2 NUMERIC(8, 2),
  co NUMERIC(10, 2),
  fetched_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_environment_snapshots_user_date_period_unique
    UNIQUE (user_id, snapshot_date, day_period)
);

CREATE INDEX IF NOT EXISTS idx_user_environment_snapshots_user_date_desc
  ON user_environment_snapshots (user_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_user_environment_snapshots_user_period_date
  ON user_environment_snapshots (user_id, day_period, snapshot_date DESC);
