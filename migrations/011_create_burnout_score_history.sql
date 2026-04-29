CREATE TABLE IF NOT EXISTS burnout_score_history (
  burnout_score_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  score_date DATE NOT NULL,
  overall_score NUMERIC(5, 2) NOT NULL CHECK (
    overall_score >= 0
    AND overall_score <= 100
  ),
  risk_level VARCHAR(20) NOT NULL CHECK (
    risk_level IN ('low', 'moderate', 'high', 'critical')
  ),
  emotional_exhaustion_score NUMERIC(5, 2) CHECK (
    emotional_exhaustion_score IS NULL
    OR (
      emotional_exhaustion_score >= 0
      AND emotional_exhaustion_score <= 100
    )
  ),
  detachment_score NUMERIC(5, 2) CHECK (
    detachment_score IS NULL
    OR (
      detachment_score >= 0
      AND detachment_score <= 100
    )
  ),
  reduced_accomplishment_score NUMERIC(5, 2) CHECK (
    reduced_accomplishment_score IS NULL
    OR (
      reduced_accomplishment_score >= 0
      AND reduced_accomplishment_score <= 100
    )
  ),
  workload_strain_score NUMERIC(5, 2) CHECK (
    workload_strain_score IS NULL
    OR (
      workload_strain_score >= 0
      AND workload_strain_score <= 100
    )
  ),
  recovery_deficit_score NUMERIC(5, 2) CHECK (
    recovery_deficit_score IS NULL
    OR (
      recovery_deficit_score >= 0
      AND recovery_deficit_score <= 100
    )
  ),
  confidence_score NUMERIC(5, 2) NOT NULL CHECK (
    confidence_score >= 0
    AND confidence_score <= 100
  ),
  completeness_score NUMERIC(5, 2) NOT NULL CHECK (
    completeness_score >= 0
    AND completeness_score <= 100
  ),
  data_points_count SMALLINT NOT NULL DEFAULT 0 CHECK (data_points_count >= 0),
  missing_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  contributing_factors JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  scoring_version VARCHAR(30) NOT NULL DEFAULT 'phase2_v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT burnout_score_history_user_date_unique
    UNIQUE (user_id, score_date)
);

CREATE INDEX IF NOT EXISTS idx_burnout_score_history_user_date_desc
  ON burnout_score_history (user_id, score_date DESC);

CREATE INDEX IF NOT EXISTS idx_burnout_score_history_user_risk
  ON burnout_score_history (user_id, risk_level);
