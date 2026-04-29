import pool from '../config/db.js';
import { upsertBurnoutScoreForDate } from '../services/burnoutScoringService.js';

const DEFAULT_GOAL_STEPS = 5000;
const DEFAULT_STEP_LENGTH_METERS = 0.75;
const DEFAULT_EXERCISE_TYPE = 'walking';
const DEFAULT_SOURCE = 'phone_sensor';

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function toInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value, fallback) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeActivityPayload(body) {
  const steps = Math.max(0, toInteger(body?.steps, 0));
  const distanceMeters = Math.max(
    0,
    toNumber(body?.distance_meters, steps * DEFAULT_STEP_LENGTH_METERS)
  );
  const goalSteps = Math.max(0, toInteger(body?.goal_steps, DEFAULT_GOAL_STEPS));
  const goalDistanceMeters = Math.max(
    0,
    toNumber(body?.goal_distance_meters, goalSteps * DEFAULT_STEP_LENGTH_METERS)
  );
  const providedGoalCompleted = body?.goal_completed;
  const goalCompleted = typeof providedGoalCompleted === 'boolean'
    ? providedGoalCompleted
    : steps >= goalSteps || distanceMeters >= goalDistanceMeters;

  return {
    logDate: String(body?.log_date ?? todayKey()).trim(),
    steps,
    distanceMeters,
    activeMinutes: Math.max(0, toInteger(body?.active_minutes, 0)),
    caloriesBurned: Math.max(0, toNumber(body?.calories_burned, 0)),
    exerciseType: normalizeText(body?.exercise_type, DEFAULT_EXERCISE_TYPE),
    goalSteps,
    goalDistanceMeters,
    goalCompleted,
    source: normalizeText(body?.source, DEFAULT_SOURCE),
  };
}

function formatActivityPayload(row) {
  if (!row) {
    return null;
  }

  return {
    activity_log_id: row.activity_log_id,
    user_id: row.user_id,
    log_date: row.log_date,
    steps: Number(row.steps ?? 0),
    distance_meters: Number(row.distance_meters ?? 0),
    active_minutes: Number(row.active_minutes ?? 0),
    calories_burned: Number(row.calories_burned ?? 0),
    exercise_type: row.exercise_type,
    goal_steps: Number(row.goal_steps ?? 0),
    goal_distance_meters: Number(row.goal_distance_meters ?? 0),
    goal_completed: row.goal_completed == true,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensureUserExists(client, userId) {
  const result = await client.query(
    'SELECT user_id FROM users WHERE user_id = $1',
    [userId]
  );

  return result.rowCount > 0;
}

async function upsertActivityLog(req, res, successMessage) {
  const userId = Number(req.body?.user_id);
  const payload = normalizeActivityPayload(req.body);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(payload.logDate)) {
    return res.status(400).json({ message: 'Valid log_date is required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userExists = await ensureUserExists(client, userId);
    if (!userExists) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await client.query(
      `INSERT INTO daily_activity_logs (
         user_id,
         log_date,
         steps,
         distance_meters,
         active_minutes,
         calories_burned,
         exercise_type,
         goal_steps,
         goal_distance_meters,
         goal_completed,
         source
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id, log_date)
       DO UPDATE SET
         steps = EXCLUDED.steps,
         distance_meters = EXCLUDED.distance_meters,
         active_minutes = EXCLUDED.active_minutes,
         calories_burned = EXCLUDED.calories_burned,
         exercise_type = EXCLUDED.exercise_type,
         goal_steps = EXCLUDED.goal_steps,
         goal_distance_meters = EXCLUDED.goal_distance_meters,
         goal_completed = EXCLUDED.goal_completed,
         source = EXCLUDED.source,
         updated_at = NOW()
       RETURNING
         activity_log_id,
         user_id,
         log_date,
         steps,
         distance_meters,
         active_minutes,
         calories_burned,
         exercise_type,
         goal_steps,
         goal_distance_meters,
         goal_completed,
         source,
         created_at,
         updated_at`,
      [
        userId,
        payload.logDate,
        payload.steps,
        payload.distanceMeters,
        payload.activeMinutes,
        payload.caloriesBurned,
        payload.exerciseType,
        payload.goalSteps,
        payload.goalDistanceMeters,
        payload.goalCompleted,
        payload.source,
      ]
    );

    await client.query('COMMIT');

    let burnoutScore = null;
    try {
      burnoutScore = await upsertBurnoutScoreForDate(
        pool,
        userId,
        payload.logDate
      );
    } catch (scoreError) {
      console.error('Activity burnout score refresh error:', scoreError);
    }

    return res.status(200).json({
      message: successMessage,
      log: formatActivityPayload(result.rows[0]),
      burnout_score: burnoutScore,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Save activity log error:', error);
    return res.status(500).json({ message: 'Failed to save activity log' });
  } finally {
    client.release();
  }
}

export async function getTodayActivity(req, res) {
  const userId = Number(req.params.userId);
  const logDate = String(req.query?.date ?? todayKey()).trim();

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(logDate)) {
    return res.status(400).json({ message: 'Valid date is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `SELECT
         activity_log_id,
         user_id,
         log_date,
         steps,
         distance_meters,
         active_minutes,
         calories_burned,
         exercise_type,
         goal_steps,
         goal_distance_meters,
         goal_completed,
         source,
         created_at,
         updated_at
       FROM daily_activity_logs
       WHERE user_id = $1 AND log_date = $2`,
      [userId, logDate]
    );

    return res.status(200).json({
      has_log: result.rowCount > 0,
      log: formatActivityPayload(result.rows[0]),
    });
  } catch (error) {
    console.error('Get today activity error:', error);
    return res.status(500).json({ message: 'Failed to fetch activity log' });
  }
}

export async function getActivityHistory(req, res) {
  const userId = Number(req.params.userId);
  const endDate = String(req.query?.end ?? todayKey()).trim();
  const startDate = String(
    req.query?.start ??
      new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  ).trim();

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return res.status(400).json({ message: 'Valid start and end dates are required' });
  }

  if (startDate > endDate) {
    return res.status(400).json({ message: 'start must be before or equal to end' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `SELECT
         activity_log_id,
         user_id,
         log_date,
         steps,
         distance_meters,
         active_minutes,
         calories_burned,
         exercise_type,
         goal_steps,
         goal_distance_meters,
         goal_completed,
         source,
         created_at,
         updated_at
       FROM daily_activity_logs
       WHERE user_id = $1
         AND log_date BETWEEN $2 AND $3
       ORDER BY log_date ASC`,
      [userId, startDate, endDate]
    );

    return res.status(200).json({
      start_date: startDate,
      end_date: endDate,
      logs: result.rows.map(formatActivityPayload),
    });
  } catch (error) {
    console.error('Get activity history error:', error);
    return res.status(500).json({ message: 'Failed to fetch activity history' });
  }
}

export async function saveActivityLog(req, res) {
  return upsertActivityLog(req, res, 'Activity log saved successfully');
}

export async function updateActivityLog(req, res) {
  return upsertActivityLog(req, res, 'Activity log updated successfully');
}
