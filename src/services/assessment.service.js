import { createHash } from 'node:crypto';
import pool from '../config/db.js';
import {
  ASSESSMENT_IDENTITY, AssessmentError, CBI_DEFINITION,
  getAssessmentDefinition, requireAssessmentEnabled, validateAssessmentIdentity,
} from './assessmentDefinition.js';
import { scorePersonalBurnout, validateAssessmentAnswers } from './assessmentScoring.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assessmentFingerprint(value) {
  const canonicalize = (input) => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]));
    }
    return input;
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function completionTime(value) {
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
    : null;
  const invalid = () => { throw new AssessmentError('INVALID_COMPLETION_TIME', 'Use a valid completion timestamp with a timezone.', 422); };
  if (!match) return invalid();
  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year);
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1];
  if (y < 1 || Number(month) < 1 || Number(month) > 12 || Number(day) < 1
    || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4)) > 59
      || (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0)))) return invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return invalid();
  return date.toISOString();
}

export function prepareAssessment(payload) {
  const allowed = [...Object.keys(ASSESSMENT_IDENTITY), 'submission_id', 'completed_at', 'answers'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some((key) => !allowed.includes(key))
    || typeof payload.submission_id !== 'string' || !UUID.test(payload.submission_id)) {
    throw new AssessmentError('INVALID_ASSESSMENT_PAYLOAD', 'Invalid assessment payload or submission identifier.');
  }
  validateAssessmentIdentity(payload);
  const canonical = {
    ...ASSESSMENT_IDENTITY,
    completed_at: completionTime(payload.completed_at),
    answers: validateAssessmentAnswers(payload.answers, { requireComplete: true }),
  };
  return {
    ...canonical,
    submission_id: payload.submission_id.toLowerCase(),
    request_fingerprint: assessmentFingerprint(canonical),
    result: scorePersonalBurnout(canonical.answers),
  };
}

function validateUserId(userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new AssessmentError('UNAUTHENTICATED', 'Authenticated user is required.', 401);
  }
}

async function serializeAssessment(db, row) {
  if (!row) return null;
  const answers = await db.query(
    `SELECT question_id, question_type, response FROM user_assessment_answers
     WHERE assessment_id = $1 ORDER BY question_id`, [row.assessment_id],
  );
  return {
    assessment_id: String(row.assessment_id),
    ...Object.fromEntries(Object.keys(ASSESSMENT_IDENTITY).map((key) => [key, row[key]])),
    submission_id: row.submission_id,
    completed_at: new Date(row.completed_at).toISOString(),
    received_at: new Date(row.created_at).toISOString(),
    completion_status: row.completion_status,
    answers: answers.rows,
    result: {
      score: Number(row.cbi_score), display_score: Number(row.cbi_score).toFixed(1),
      mapped_total: Number(row.cbi_mapped_total), answered_items: Number(row.cbi_answer_count),
      required_items: 6, scale_min: 0, scale_max: 100,
    },
  };
}

// Called inside a transaction, also shared by onboarding. Locking the owner
// serializes concurrent retries before checking their unique submission ID.
export async function saveAssessmentWithClient(client, userId, prepared, {
  now = new Date(), onboardingFingerprint = null,
} = {}) {
  requireAssessmentEnabled();
  validateUserId(userId);
  const owner = await client.query('SELECT user_id, age, deactivated_at FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
  if (!owner.rows[0] || owner.rows[0].deactivated_at) {
    throw new AssessmentError('UNAUTHENTICATED', 'Active authenticated user is required.', 401);
  }
  const existing = await client.query(
    'SELECT * FROM user_assessments WHERE user_id = $1 AND submission_id = $2',
    [userId, prepared.submission_id],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.request_fingerprint !== prepared.request_fingerprint
      || (onboardingFingerprint !== null && row.onboarding_request_fingerprint !== onboardingFingerprint)) {
      throw new AssessmentError('ASSESSMENT_SUBMISSION_CONFLICT', 'This submission identifier was already used for different content.', 409);
    }
    return { assessment: await serializeAssessment(client, row), idempotent_replay: true };
  }
  if (!Number.isInteger(owner.rows[0].age) || owner.rows[0].age < 18) {
    throw new AssessmentError('ASSESSMENT_ADULT_REQUIRED', 'This assessment requires an adult profile with age 18 or older.', 422);
  }
  if (new Date(prepared.completed_at).getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new AssessmentError('INVALID_COMPLETION_TIME', 'Completion time is in the future. Check your device clock.', 422);
  }
  const identity = Object.values(ASSESSMENT_IDENTITY);
  const inserted = await client.query(
    `INSERT INTO user_assessments (
       user_id, instrument, instrument_version, definition_version, scoring_version,
       context_version, language, submission_id, request_fingerprint,
       onboarding_request_fingerprint, completed_at, cbi_answer_count, cbi_mapped_total, cbi_score
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,6,$12,$13) RETURNING *`,
    [userId, ...identity, prepared.submission_id, prepared.request_fingerprint,
      onboardingFingerprint, prepared.completed_at, prepared.result.mapped_total, prepared.result.score],
  );
  for (const answer of prepared.answers) {
    const item = CBI_DEFINITION.items.find((item) => item.question_id === answer.question_id);
    await client.query(
      `INSERT INTO user_assessment_answers (assessment_id, question_id, question_type, response)
       VALUES ($1,$2,$3,$4)`,
      [inserted.rows[0].assessment_id, answer.question_id, item.type, answer.response],
    );
  }
  return { assessment: await serializeAssessment(client, inserted.rows[0]), idempotent_replay: false };
}

export async function submitAssessment(userId, payload, { db = pool, now = new Date() } = {}) {
  requireAssessmentEnabled();
  validateUserId(userId);
  const prepared = prepareAssessment(payload);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await saveAssessmentWithClient(client, userId, prepared, { now });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function latestAssessment(userId, { instrument, db = pool } = {}) {
  validateUserId(userId);
  getAssessmentDefinition({ instrument });
  const rows = await db.query(
    `SELECT * FROM user_assessments WHERE user_id = $1 AND instrument = $2
     ORDER BY completed_at DESC, submission_id DESC LIMIT 1`, [userId, ASSESSMENT_IDENTITY.instrument],
  );
  return { assessment: await serializeAssessment(db, rows.rows[0]) };
}

export async function assessmentHistory(userId, { instrument, limit = '20', cursor, db = pool } = {}) {
  validateUserId(userId);
  getAssessmentDefinition({ instrument });
  if (!/^\d+$/.test(String(limit)) || Number(limit) < 1 || Number(limit) > 100) {
    throw new AssessmentError('INVALID_ASSESSMENT_PAYLOAD', 'History limit must be from 1 to 100.');
  }
  let after = null;
  if (cursor !== undefined) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 1000 || !/^[\w-]+$/.test(cursor)) throw new Error();
      after = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (after.user_id !== userId || after.instrument !== ASSESSMENT_IDENTITY.instrument
        || typeof after.submission_id !== 'string' || !UUID.test(after.submission_id)) throw new Error();
      after.completed_at = completionTime(after.completed_at);
    } catch (_) {
      throw new AssessmentError('INVALID_ASSESSMENT_PAYLOAD', 'Invalid assessment history cursor.');
    }
  }
  const result = await db.query(
    `SELECT * FROM user_assessments WHERE user_id = $1 AND instrument = $2
     ${after ? 'AND (completed_at, submission_id) < ($4::timestamptz, $5::uuid)' : ''}
     ORDER BY completed_at DESC, submission_id DESC LIMIT $3`,
    [userId, ASSESSMENT_IDENTITY.instrument, Number(limit) + 1,
      ...(after ? [after.completed_at, after.submission_id] : [])],
  );
  const page = result.rows.slice(0, Number(limit));
  const last = page.at(-1);
  const next = result.rows.length > Number(limit) && last ? Buffer.from(JSON.stringify({
    user_id: userId, instrument: last.instrument,
    completed_at: new Date(last.completed_at).toISOString(), submission_id: last.submission_id,
  })).toString('base64url') : null;
  return { assessments: await Promise.all(page.map((row) => serializeAssessment(db, row))), next_cursor: next };
}
