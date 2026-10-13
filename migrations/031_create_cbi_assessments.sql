-- CBI assessment history. Additive migration promoted from the Phase 1 review.
-- See docs/cbi-assessment-phase-1-design.md for the storage and API contracts.
-- The migration runner supplies the transaction. No legacy backfill or changes.
-- Service writes a complete parent and all answers atomically; no server drafts.

CREATE TABLE IF NOT EXISTS user_assessments (
  assessment_id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  instrument VARCHAR(50) NOT NULL,
  instrument_version VARCHAR(30) NOT NULL,
  definition_version VARCHAR(80) NOT NULL,
  scoring_version VARCHAR(50) NOT NULL,
  context_version VARCHAR(50) NOT NULL,
  language VARCHAR(10) NOT NULL,
  completion_status VARCHAR(20) NOT NULL DEFAULT 'complete'
    CHECK (completion_status = 'complete'),
  submission_id UUID NOT NULL,
  request_fingerprint VARCHAR(64) NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  onboarding_request_fingerprint VARCHAR(64)
    CHECK (onboarding_request_fingerprint IS NULL
      OR onboarding_request_fingerprint ~ '^[0-9a-f]{64}$'),
  completed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cbi_answer_count SMALLINT NOT NULL CHECK (cbi_answer_count = 6),
  cbi_mapped_total SMALLINT NOT NULL
    CHECK (cbi_mapped_total BETWEEN 0 AND 600 AND cbi_mapped_total % 25 = 0),
  cbi_score NUMERIC(5, 1) NOT NULL
    CHECK (cbi_score BETWEEN 0 AND 100),
  CONSTRAINT user_assessments_user_submission_unique UNIQUE (user_id, submission_id),
  CONSTRAINT user_assessments_score_matches_total CHECK (
    cbi_score = ROUND(cbi_mapped_total::NUMERIC / cbi_answer_count, 1)
  ),
  -- Adding a supported future version requires an explicit additive migration.
  CONSTRAINT user_assessments_supported_definition CHECK (
    instrument = 'cbi_personal_burnout'
    AND instrument_version = '1.0.0'
    AND definition_version = 'cbi-pb-context-en-1.0.0'
    AND scoring_version = 'cbi-pb-mean-1.0.0'
    AND context_version = 'vitalysync-context-1.0.0'
    AND language = 'en'
  )
);

CREATE INDEX IF NOT EXISTS idx_user_assessments_history
  ON user_assessments (user_id, instrument, completed_at DESC, submission_id DESC);

CREATE TABLE IF NOT EXISTS user_assessment_answers (
  assessment_id BIGINT NOT NULL
    REFERENCES user_assessments(assessment_id) ON DELETE CASCADE,
  question_id VARCHAR(30) NOT NULL,
  question_type VARCHAR(20) NOT NULL CHECK (question_type IN ('cbi', 'context')),
  response SMALLINT NOT NULL CHECK (response BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assessment_id, question_id),
  CONSTRAINT user_assessment_answers_membership CHECK (
    (question_type = 'cbi' AND question_id IN ('PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6'))
    OR
    (question_type = 'context' AND question_id IN ('context1', 'context2', 'context3', 'context4'))
  )
);

-- No updated_at: ordinary saved assessment/answer rows are never updated.
-- Account clearing/retention may DELETE parent rows and cascade to children.
CREATE OR REPLACE FUNCTION reject_cbi_assessment_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saved CBI assessments and answers cannot be updated'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER user_assessments_no_update
  BEFORE UPDATE ON user_assessments
  FOR EACH ROW EXECUTE FUNCTION reject_cbi_assessment_update();

CREATE TRIGGER user_assessment_answers_no_update
  BEFORE UPDATE ON user_assessment_answers
  FOR EACH ROW EXECUTE FUNCTION reject_cbi_assessment_update();

-- Deferred until commit so the service can insert parent then answer rows.
-- CBI row count + ID constraints imply exactly one response to each required ID.
CREATE OR REPLACE FUNCTION check_cbi_assessment_aggregate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_id BIGINT;
  saved user_assessments%ROWTYPE;
  actual_count INTEGER;
  actual_total INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.assessment_id;
  ELSE
    target_id := NEW.assessment_id;
  END IF;

  SELECT * INTO saved FROM user_assessments WHERE assessment_id = target_id;
  IF NOT FOUND THEN
    -- Parent was removed through account clearing or retention in this transaction.
    RETURN NULL;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(25 * (response - 1)), 0)
    INTO actual_count, actual_total
    FROM user_assessment_answers
    WHERE assessment_id = target_id AND question_type = 'cbi';

  IF actual_count <> saved.cbi_answer_count OR actual_total <> saved.cbi_mapped_total THEN
    RAISE EXCEPTION 'CBI assessment answers do not match the complete saved result'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER user_assessments_complete_at_commit
  AFTER INSERT ON user_assessments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_cbi_assessment_aggregate();

CREATE CONSTRAINT TRIGGER user_assessment_answers_match_at_commit
  AFTER INSERT OR DELETE ON user_assessment_answers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_cbi_assessment_aggregate();

-- The application has no answer-update/delete/append endpoint after completion.
-- Account clearing includes user_assessments in USER_OWNED_TABLES.
-- Do not re-run this file directly: the existing runner tracks migration filenames.
