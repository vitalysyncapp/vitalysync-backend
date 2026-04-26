import pool from '../config/db.js';

const DEFAULT_RECOMMENDED_BY = 'vitalysync_assistant';
const DEFAULT_SOURCE = 'assistant';
const DISTANCE_METHODS = new Set(['distance', 'steps']);

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
}

function toNumber(value, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeText(value, fallback) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeStatus(value, fallback = 'active') {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['active', 'completed', 'canceled', 'none'].includes(normalized)
    ? normalized
    : fallback;
}

function normalizeChoicePayload(body) {
  const exerciseName = normalizeText(body?.exercise_name, 'None today');
  const status = exerciseName.toLowerCase() === 'none today'
    ? 'none'
    : normalizeStatus(body?.status, 'active');

  return {
    logDate: normalizeText(body?.log_date, todayKey()),
    recommendedBy: normalizeText(body?.recommended_by, DEFAULT_RECOMMENDED_BY),
    exerciseName,
    exerciseCategory: normalizeText(
      body?.exercise_category,
      status === 'none' ? 'none' : 'general'
    ),
    targetDistanceMeters: toNumber(body?.target_distance_meters),
    targetMinutes: toInteger(body?.target_minutes),
    targetReps: toInteger(body?.target_reps),
    completionMethod: normalizeText(
      body?.completion_method,
      status === 'none' ? 'none' : 'manual'
    ),
    status,
  };
}

function formatGoal(row) {
  if (!row) {
    return null;
  }

  return {
    goal_id: row.goal_id,
    user_id: row.user_id,
    log_date: row.log_date,
    recommended_by: row.recommended_by,
    exercise_name: row.exercise_name,
    exercise_category: row.exercise_category,
    target_distance_meters:
      row.target_distance_meters == null
        ? null
        : Number(row.target_distance_meters),
    target_minutes:
      row.target_minutes == null ? null : Number(row.target_minutes),
    target_reps: row.target_reps == null ? null : Number(row.target_reps),
    completion_method: row.completion_method,
    status: row.status,
    completed_at: row.completed_at,
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

async function updateDailyLogExerciseFields(client, userId, logDate, goal) {
  await client.query(
    `UPDATE daily_logs
     SET exercise_goal_name = $3,
         exercise_goal_completed = $4,
         exercise_goal_source = $5,
         exercise_goal_status = $6,
         updated_at = NOW()
     WHERE user_id = $1 AND log_date = $2`,
    [
      userId,
      logDate,
      goal.exerciseName,
      goal.status === 'completed',
      DEFAULT_SOURCE,
      goal.status,
    ]
  );
}

async function readTodayGoal(client, userId, logDate) {
  const result = await client.query(
    `SELECT
       goal_id,
       user_id,
       log_date,
       recommended_by,
       exercise_name,
       exercise_category,
       target_distance_meters,
       target_minutes,
       target_reps,
       completion_method,
       status,
       completed_at,
       created_at,
       updated_at
     FROM daily_exercise_goals
     WHERE user_id = $1 AND log_date = $2`,
    [userId, logDate]
  );

  return result.rows[0] ?? null;
}

export async function getTodayExerciseGoal(req, res) {
  const userId = Number(req.params.userId);
  const logDate = normalizeText(req.query?.date, todayKey());

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

    const goal = await readTodayGoal(pool, userId, logDate);

    return res.status(200).json({
      has_goal: goal != null,
      goal: formatGoal(goal),
    });
  } catch (error) {
    console.error('Get today exercise goal error:', error);
    return res.status(500).json({ message: 'Failed to fetch exercise goal' });
  }
}

export async function chooseExerciseGoal(req, res) {
  const userId = Number(req.body?.user_id);
  const payload = normalizeChoicePayload(req.body);

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
      `INSERT INTO daily_exercise_goals (
         user_id,
         log_date,
         recommended_by,
         exercise_name,
         exercise_category,
         target_distance_meters,
         target_minutes,
         target_reps,
         completion_method,
         status,
         completed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         CASE WHEN $10 = 'completed' THEN NOW() ELSE NULL END)
       ON CONFLICT (user_id, log_date)
       DO UPDATE SET
         recommended_by = EXCLUDED.recommended_by,
         exercise_name = EXCLUDED.exercise_name,
         exercise_category = EXCLUDED.exercise_category,
         target_distance_meters = EXCLUDED.target_distance_meters,
         target_minutes = EXCLUDED.target_minutes,
         target_reps = EXCLUDED.target_reps,
         completion_method = EXCLUDED.completion_method,
         status = EXCLUDED.status,
         completed_at = EXCLUDED.completed_at,
         updated_at = NOW()
       RETURNING *`,
      [
        userId,
        payload.logDate,
        payload.recommendedBy,
        payload.exerciseName,
        payload.exerciseCategory,
        payload.targetDistanceMeters,
        payload.targetMinutes,
        payload.targetReps,
        payload.completionMethod,
        payload.status,
      ]
    );

    await updateDailyLogExerciseFields(client, userId, payload.logDate, payload);
    await client.query('COMMIT');

    return res.status(200).json({
      message:
        payload.status === 'none'
          ? 'Exercise goal saved as none today'
          : 'Exercise goal saved successfully',
      goal: formatGoal(result.rows[0]),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Choose exercise goal error:', error);
    return res.status(500).json({ message: 'Failed to save exercise goal' });
  } finally {
    client.release();
  }
}

export async function updateExerciseGoalProgress(req, res) {
  const userId = Number(req.body?.user_id);
  const logDate = normalizeText(req.body?.log_date, todayKey());
  const distanceMeters = Math.max(0, toNumber(req.body?.distance_meters, 0));

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(logDate)) {
    return res.status(400).json({ message: 'Valid log_date is required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const goal = await readTodayGoal(client, userId, logDate);
    if (!goal) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Exercise goal not found' });
    }

    const targetDistance = Number(goal.target_distance_meters ?? 0);
    const shouldComplete =
      goal.status === 'active' &&
      DISTANCE_METHODS.has(String(goal.completion_method ?? '')) &&
      targetDistance > 0 &&
      distanceMeters >= targetDistance;

    let updatedGoal = goal;
    if (shouldComplete) {
      const result = await client.query(
        `UPDATE daily_exercise_goals
         SET status = 'completed',
             completed_at = COALESCE(completed_at, NOW()),
             updated_at = NOW()
         WHERE user_id = $1 AND log_date = $2
         RETURNING *`,
        [userId, logDate]
      );
      updatedGoal = result.rows[0];
      await updateDailyLogExerciseFields(client, userId, logDate, {
        exerciseName: updatedGoal.exercise_name,
        status: 'completed',
      });
    }

    await client.query('COMMIT');

    return res.status(200).json({
      message: shouldComplete
        ? 'Exercise goal completed'
        : 'Exercise progress recorded',
      goal: formatGoal(updatedGoal),
      progress: {
        distance_meters: distanceMeters,
        target_distance_meters: targetDistance || null,
        completed: shouldComplete || updatedGoal.status === 'completed',
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update exercise progress error:', error);
    return res
      .status(500)
      .json({ message: 'Failed to update exercise progress' });
  } finally {
    client.release();
  }
}

export async function completeExerciseGoal(req, res) {
  return updateExerciseGoalStatus(req, res, 'completed');
}

export async function cancelExerciseGoal(req, res) {
  return updateExerciseGoalStatus(req, res, 'canceled');
}

async function updateExerciseGoalStatus(req, res, status) {
  const userId = Number(req.body?.user_id);
  const logDate = normalizeText(req.body?.log_date, todayKey());

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(logDate)) {
    return res.status(400).json({ message: 'Valid log_date is required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE daily_exercise_goals
       SET status = $3,
           completed_at = CASE WHEN $3 = 'completed'
             THEN COALESCE(completed_at, NOW())
             ELSE NULL
           END,
           updated_at = NOW()
       WHERE user_id = $1 AND log_date = $2
       RETURNING *`,
      [userId, logDate, status]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Exercise goal not found' });
    }

    const goal = result.rows[0];
    await updateDailyLogExerciseFields(client, userId, logDate, {
      exerciseName: goal.exercise_name,
      status,
    });

    await client.query('COMMIT');

    return res.status(200).json({
      message:
        status === 'completed'
          ? 'Exercise goal completed'
          : 'Exercise goal canceled',
      goal: formatGoal(goal),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update exercise goal status error:', error);
    return res.status(500).json({ message: 'Failed to update exercise goal' });
  } finally {
    client.release();
  }
}
