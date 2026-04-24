CREATE TABLE IF NOT EXISTS nutrition_logs (
  nutrition_log_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  meal_type VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  total_calories NUMERIC(8, 2) DEFAULT 0,
  total_protein_g NUMERIC(8, 2) DEFAULT 0,
  total_carbs_g NUMERIC(8, 2) DEFAULT 0,
  total_fat_g NUMERIC(8, 2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, log_date, meal_type)
);

CREATE TABLE IF NOT EXISTS nutrition_log_items (
  item_id SERIAL PRIMARY KEY,
  nutrition_log_id INTEGER NOT NULL REFERENCES nutrition_logs(nutrition_log_id) ON DELETE CASCADE,
  food_name VARCHAR(150) NOT NULL,
  usda_fdc_id INTEGER,
  serving_qty NUMERIC(8, 2),
  serving_unit VARCHAR(50),
  calories NUMERIC(8, 2) DEFAULT 0,
  protein_g NUMERIC(8, 2) DEFAULT 0,
  carbs_g NUMERIC(8, 2) DEFAULT 0,
  fat_g NUMERIC(8, 2) DEFAULT 0,
  confidence NUMERIC(5, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nutrition_attempts (
  attempt_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  meal_type VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  image_url TEXT,
  ai_detected_foods JSONB,
  usda_results JSONB,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'discarded')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nutrition_logs_user_date
  ON nutrition_logs (user_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_nutrition_attempts_user_date
  ON nutrition_attempts (user_id, log_date DESC);
