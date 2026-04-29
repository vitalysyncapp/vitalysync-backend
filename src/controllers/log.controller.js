import pool from '../config/db.js';
import {
  upsertBurnoutScoreForDate,
  upsertBurnoutScoresForWeek
} from '../services/burnoutScoringService.js';

const ALLOWED_WORKLOAD_HOURS_BANDS = new Set([
  'None',
  '1-2 hours',
  '3-4 hours',
  '5-6 hours',
  '6-7 hours',
  '8-9 hours',
  '10-12 hours'
]);

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);

  return [...new Set(normalized)];
}

function normalizeNullableText(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkloadHoursBand(value) {
  const normalized = normalizeNullableText(value);
  return normalized && ALLOWED_WORKLOAD_HOURS_BANDS.has(normalized)
    ? normalized
    : null;
}

function parseLikert(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5
    ? parsed
    : null;
}

function normalizeOptionalBoolean(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return null;
}

function parseDateOnly(value) {
  if (!value) {
    return null;
  }

  const rawValue = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
  const [year, month, day] = rawValue.split('-').map(Number);

  return Date.UTC(year, month - 1, day);
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function getWeekStartDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const utcDate = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  const day = utcDate.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  utcDate.setUTCDate(utcDate.getUTCDate() + mondayOffset);

  return formatDateOnly(utcDate);
}

async function ensureUserStreak(client, userId) {
  await client.query(
    `INSERT INTO user_streaks (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const streakResult = await client.query(
    `SELECT user_id, current_streak, longest_streak, last_logged_date
     FROM user_streaks
     WHERE user_id = $1
     FOR UPDATE`,
    [userId]
  );

  return streakResult.rows[0];
}

async function readUserStreak(client, userId) {
  const userResult = await client.query(
    'SELECT user_id FROM users WHERE user_id = $1',
    [userId]
  );

  if (userResult.rowCount === 0) {
    return null;
  }

  await client.query(
    `INSERT INTO user_streaks (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const result = await client.query(
    `SELECT current_streak, longest_streak, last_logged_date
     FROM user_streaks
     WHERE user_id = $1`,
    [userId]
  );

  return result.rows[0];
}

function formatStreakPayload(streakRow) {
  return {
    current_streak: streakRow?.current_streak ?? 0,
    longest_streak: streakRow?.longest_streak ?? 0,
    last_logged_date: streakRow?.last_logged_date ?? null
  };
}

export async function getTodayLog(req, res) {
  const userId = Number(req.query.user_id);
  const logDate = String(req.query.log_date ?? '').trim();

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(logDate)) {
    return res.status(400).json({ message: 'Valid log_date is required' });
  }

  try {
    const streakRow = await readUserStreak(pool, userId);

    if (!streakRow) {
      return res.status(404).json({ message: 'User not found' });
    }

    const logResult = await pool.query(
      `SELECT
         log_id,
         user_id,
         log_date,
         sleep_hours,
         sleep_quality,
         mood_index,
         energy_level,
         hydration_liters,
         workload_hours_band,
         perceived_stress_level,
         break_quality_level,
         exercise_names,
         symptom_names,
         exercise_goal_name,
         exercise_goal_completed,
         exercise_goal_source,
         exercise_goal_status,
         created_at,
         updated_at
       FROM daily_logs
       WHERE user_id = $1 AND log_date = $2`,
      [userId, logDate]
    );

    return res.status(200).json({
      has_log: logResult.rowCount > 0,
      log: logResult.rows[0] ?? null,
      streak: formatStreakPayload(streakRow)
    });
  } catch (error) {
    console.error('Get today log error:', error);
    return res.status(500).json({ message: 'Failed to fetch today log' });
  }
}

export async function getCurrentStreak(req, res) {
  const userId = Number(req.query.user_id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  try {
    const streakRow = await readUserStreak(pool, userId);

    if (!streakRow) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      streak: formatStreakPayload(streakRow)
    });
  } catch (error) {
    console.error('Get streak error:', error);
    return res.status(500).json({ message: 'Failed to fetch streak' });
  }
}

export async function getLatestLog(req, res) {
  const userId = Number(req.query.user_id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  try {
    const streakRow = await readUserStreak(pool, userId);

    if (!streakRow) {
      return res.status(404).json({ message: 'User not found' });
    }

    const latestLogResult = await pool.query(
      `SELECT
         log_id,
         user_id,
         log_date,
         sleep_hours,
         sleep_quality,
         mood_index,
         energy_level,
         hydration_liters,
         workload_hours_band,
         perceived_stress_level,
         break_quality_level,
         exercise_names,
         symptom_names,
         exercise_goal_name,
         exercise_goal_completed,
         exercise_goal_source,
         exercise_goal_status,
         created_at,
         updated_at
       FROM daily_logs
       WHERE user_id = $1
       ORDER BY log_date DESC
       LIMIT 1`,
      [userId]
    );

    return res.status(200).json({
      has_log: latestLogResult.rowCount > 0,
      log: latestLogResult.rows[0] ?? null,
      streak: formatStreakPayload(streakRow)
    });
  } catch (error) {
    console.error('Get latest log error:', error);
    return res.status(500).json({ message: 'Failed to fetch latest log' });
  }
}

export async function getLogHistory(req, res) {
  const userId = Number(req.query.user_id);
  const startDate = String(req.query.start ?? '').trim();
  const endDate = String(req.query.end ?? '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 90);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (startDate && !isValidDateString(startDate)) {
    return res.status(400).json({ message: 'Valid start date is required' });
  }

  if (endDate && !isValidDateString(endDate)) {
    return res.status(400).json({ message: 'Valid end date is required' });
  }

  try {
    const params = [userId];
    const filters = ['user_id = $1'];

    if (startDate) {
      params.push(startDate);
      filters.push(`log_date >= $${params.length}`);
    }

    if (endDate) {
      params.push(endDate);
      filters.push(`log_date <= $${params.length}`);
    }

    params.push(limit);

    const historyResult = await pool.query(
      `SELECT
         log_id,
         user_id,
         log_date,
         sleep_hours,
         sleep_quality,
         mood_index,
         energy_level,
         hydration_liters,
         workload_hours_band,
         perceived_stress_level,
         break_quality_level,
         exercise_names,
         symptom_names,
         exercise_goal_name,
         exercise_goal_completed,
         exercise_goal_source,
         exercise_goal_status,
         created_at,
         updated_at
       FROM daily_logs
       WHERE ${filters.join(' AND ')}
       ORDER BY log_date DESC
       LIMIT $${params.length}`,
      params
    );

    return res.status(200).json({
      logs: historyResult.rows.reverse()
    });
  } catch (error) {
    console.error('Get log history error:', error);
    return res.status(500).json({ message: 'Failed to fetch log history' });
  }
}

export async function saveDailyLog(req, res) {
  const {
    user_id: rawUserId,
    log_date: logDate,
    sleep_hours: sleepHours,
    sleep_quality: sleepQuality,
    mood_index: moodIndex,
    energy_level: energyLevel,
    hydration_liters: hydrationLiters,
    workload_hours_band: workloadHoursBand,
    perceived_stress_level: perceivedStressLevel,
    break_quality_level: breakQualityLevel,
    exercise_names: exerciseNames,
    symptom_names: symptomNames,
    exercise_goal_name: exerciseGoalName,
    exercise_goal_completed: exerciseGoalCompleted,
    exercise_goal_source: exerciseGoalSource,
    exercise_goal_status: exerciseGoalStatus
  } = req.body;

  const userId = Number(rawUserId);
  const normalizedExercises = normalizeStringArray(exerciseNames);
  const normalizedSymptoms = normalizeStringArray(symptomNames);
  const rawWorkloadHoursBand = normalizeNullableText(workloadHoursBand);
  const normalizedWorkloadHoursBand = normalizeWorkloadHoursBand(workloadHoursBand);
  const normalizedPerceivedStressLevel = parseLikert(perceivedStressLevel);
  const normalizedBreakQualityLevel = parseLikert(breakQualityLevel);
  const normalizedExerciseGoalName = normalizeNullableText(exerciseGoalName);
  const normalizedExerciseGoalCompleted = normalizeOptionalBoolean(exerciseGoalCompleted);
  const normalizedExerciseGoalSource = normalizeNullableText(exerciseGoalSource);
  const normalizedExerciseGoalStatus = normalizeNullableText(exerciseGoalStatus);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!isValidDateString(String(logDate ?? '').trim())) {
    return res.status(400).json({ message: 'Valid log_date is required' });
  }

  if (!Number.isFinite(Number(sleepHours))) {
    return res.status(400).json({ message: 'Valid sleep_hours is required' });
  }

  if (!Number.isInteger(Number(sleepQuality)) || Number(sleepQuality) < 0 || Number(sleepQuality) > 4) {
    return res.status(400).json({ message: 'Valid sleep_quality is required' });
  }

  if (!Number.isInteger(Number(moodIndex)) || Number(moodIndex) < 0 || Number(moodIndex) > 4) {
    return res.status(400).json({ message: 'Valid mood_index is required' });
  }

  if (!Number.isInteger(Number(energyLevel)) || Number(energyLevel) < 0 || Number(energyLevel) > 2) {
    return res.status(400).json({ message: 'Valid energy_level is required' });
  }

  if (!Number.isFinite(Number(hydrationLiters)) || Number(hydrationLiters) < 0) {
    return res.status(400).json({ message: 'Valid hydration_liters is required' });
  }

  if (rawWorkloadHoursBand && !normalizedWorkloadHoursBand) {
    return res.status(400).json({ message: 'Valid workload_hours_band is required' });
  }

  if (perceivedStressLevel != null && normalizedPerceivedStressLevel == null) {
    return res.status(400).json({ message: 'Valid perceived_stress_level is required' });
  }

  if (breakQualityLevel != null && normalizedBreakQualityLevel == null) {
    return res.status(400).json({ message: 'Valid break_quality_level is required' });
  }

  if (normalizedExercises.length === 0) {
    return res.status(400).json({ message: 'At least one exercise selection is required' });
  }

  if (normalizedSymptoms.length === 0) {
    return res.status(400).json({ message: 'At least one symptom selection is required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT user_id FROM users WHERE user_id = $1',
      [userId]
    );

    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    const streakRow = await ensureUserStreak(client, userId);

    const existingLogResult = await client.query(
      `SELECT log_id
       FROM daily_logs
       WHERE user_id = $1 AND log_date = $2
       FOR UPDATE`,
      [userId, logDate]
    );

    const isRedo = existingLogResult.rowCount > 0;
    let updatedStreak = streakRow.current_streak;
    let longestStreak = streakRow.longest_streak;
    const previousLogDate = parseDateOnly(streakRow.last_logged_date);
    const currentLogDate = parseDateOnly(logDate);

    if (isRedo) {
      await client.query(
        `UPDATE daily_logs
         SET sleep_hours = $3,
             sleep_quality = $4,
             mood_index = $5,
             energy_level = $6,
             hydration_liters = $7,
             workload_hours_band = COALESCE($8, workload_hours_band),
             perceived_stress_level = COALESCE($9, perceived_stress_level),
             break_quality_level = COALESCE($10, break_quality_level),
             exercise_names = $11,
             symptom_names = $12,
             exercise_goal_name = COALESCE($13, exercise_goal_name),
             exercise_goal_completed = COALESCE($14, exercise_goal_completed),
             exercise_goal_source = COALESCE($15, exercise_goal_source),
             exercise_goal_status = COALESCE($16, exercise_goal_status),
             updated_at = NOW()
         WHERE user_id = $1 AND log_date = $2`,
        [
          userId,
          logDate,
          Number(sleepHours),
          Number(sleepQuality),
          Number(moodIndex),
          Number(energyLevel),
          Number(hydrationLiters),
          normalizedWorkloadHoursBand,
          normalizedPerceivedStressLevel,
          normalizedBreakQualityLevel,
          normalizedExercises,
          normalizedSymptoms,
          normalizedExerciseGoalName,
          normalizedExerciseGoalCompleted,
          normalizedExerciseGoalSource,
          normalizedExerciseGoalStatus
        ]
      );
    } else {
      await client.query(
        `INSERT INTO daily_logs (
           user_id,
           log_date,
           sleep_hours,
           sleep_quality,
           mood_index,
           energy_level,
           hydration_liters,
           workload_hours_band,
           perceived_stress_level,
           break_quality_level,
           exercise_names,
           symptom_names,
           exercise_goal_name,
           exercise_goal_completed,
           exercise_goal_source,
           exercise_goal_status
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, COALESCE($14, FALSE), $15, $16
         )`,
        [
          userId,
          logDate,
          Number(sleepHours),
          Number(sleepQuality),
          Number(moodIndex),
          Number(energyLevel),
          Number(hydrationLiters),
          normalizedWorkloadHoursBand,
          normalizedPerceivedStressLevel,
          normalizedBreakQualityLevel,
          normalizedExercises,
          normalizedSymptoms,
          normalizedExerciseGoalName,
          normalizedExerciseGoalCompleted,
          normalizedExerciseGoalSource,
          normalizedExerciseGoalStatus
        ]
      );

      if (!previousLogDate) {
        updatedStreak = 1;
      } else {
        const dayDifference = Math.round(
          (currentLogDate - previousLogDate) / (1000 * 60 * 60 * 24)
        );

        if (dayDifference === 1) {
          updatedStreak = streakRow.current_streak + 1;
        } else if (dayDifference > 1) {
          updatedStreak = 1;
        }
      }

      longestStreak = Math.max(longestStreak, updatedStreak);

      await client.query(
        `UPDATE user_streaks
         SET current_streak = $2,
             longest_streak = $3,
             last_logged_date = $4,
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId, updatedStreak, longestStreak, logDate]
      );
    }

    const savedLogResult = await client.query(
      `SELECT
         log_id,
         user_id,
         log_date,
         sleep_hours,
         sleep_quality,
         mood_index,
         energy_level,
         hydration_liters,
         workload_hours_band,
         perceived_stress_level,
         break_quality_level,
         exercise_names,
         symptom_names,
         exercise_goal_name,
         exercise_goal_completed,
         exercise_goal_source,
         exercise_goal_status,
         created_at,
         updated_at
       FROM daily_logs
       WHERE user_id = $1 AND log_date = $2`,
      [userId, logDate]
    );

    const currentStreakRow = await client.query(
      `SELECT current_streak, longest_streak, last_logged_date
       FROM user_streaks
       WHERE user_id = $1`,
      [userId]
    );

    await client.query('COMMIT');

    let burnoutScore = null;
    try {
      burnoutScore = await upsertBurnoutScoreForDate(pool, userId, logDate);
    } catch (scoreError) {
      console.error('Daily burnout score refresh error:', scoreError);
    }

    return res.status(isRedo ? 200 : 201).json({
      message: isRedo
        ? 'Daily log updated successfully'
        : 'Daily log saved successfully',
      is_redo: isRedo,
      log: savedLogResult.rows[0],
      burnout_score: burnoutScore,
      streak: formatStreakPayload(currentStreakRow.rows[0])
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Save daily log error:', error);
    return res.status(500).json({ message: 'Failed to save daily log' });
  } finally {
    client.release();
  }
}

export async function getWeeklyPulseStatus(req, res) {
  const userId = Number(req.query.user_id);
  const weekStartDate = getWeekStartDate(req.query.date ?? new Date());

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!weekStartDate) {
    return res.status(400).json({ message: 'Valid date is required' });
  }

  try {
    const userResult = await pool.query(
      'SELECT user_id FROM users WHERE user_id = $1',
      [userId]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `SELECT
         pulse_id,
         user_id,
         week_start_date,
         productivity_focus_level,
         recovery_rest_level,
         detachment_level,
         accomplishment_level,
         created_at,
         updated_at
       FROM weekly_pulse_responses
       WHERE user_id = $1 AND week_start_date = $2`,
      [userId, weekStartDate]
    );

    return res.status(200).json({
      week_start_date: weekStartDate,
      has_response: result.rowCount > 0,
      response: result.rows[0] ?? null
    });
  } catch (error) {
    console.error('Get weekly pulse status error:', error);
    return res.status(500).json({ message: 'Failed to fetch weekly pulse status' });
  }
}

export async function saveWeeklyPulse(req, res) {
  const {
    user_id: rawUserId,
    response_date: responseDate,
    productivity_focus_level: productivityFocusLevel,
    recovery_rest_level: recoveryRestLevel,
    detachment_level: detachmentLevel,
    accomplishment_level: accomplishmentLevel
  } = req.body;
  const userId = Number(rawUserId);
  const weekStartDate = getWeekStartDate(responseDate ?? new Date());
  const normalizedProductivityFocus = parseLikert(productivityFocusLevel);
  const normalizedRecoveryRest = parseLikert(recoveryRestLevel);
  const normalizedDetachment = parseLikert(detachmentLevel);
  const normalizedAccomplishment = parseLikert(accomplishmentLevel);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!weekStartDate) {
    return res.status(400).json({ message: 'Valid response_date is required' });
  }

  if (normalizedProductivityFocus == null) {
    return res.status(400).json({ message: 'Valid productivity_focus_level is required' });
  }

  if (normalizedRecoveryRest == null) {
    return res.status(400).json({ message: 'Valid recovery_rest_level is required' });
  }

  if (normalizedDetachment == null) {
    return res.status(400).json({ message: 'Valid detachment_level is required' });
  }

  if (normalizedAccomplishment == null) {
    return res.status(400).json({ message: 'Valid accomplishment_level is required' });
  }

  try {
    const userResult = await pool.query(
      'SELECT user_id FROM users WHERE user_id = $1',
      [userId]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `INSERT INTO weekly_pulse_responses (
         user_id,
         week_start_date,
         productivity_focus_level,
         recovery_rest_level,
         detachment_level,
         accomplishment_level
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, week_start_date)
       DO UPDATE SET
         productivity_focus_level = EXCLUDED.productivity_focus_level,
         recovery_rest_level = EXCLUDED.recovery_rest_level,
         detachment_level = EXCLUDED.detachment_level,
         accomplishment_level = EXCLUDED.accomplishment_level,
         updated_at = NOW()
       RETURNING
         pulse_id,
         user_id,
         week_start_date,
         productivity_focus_level,
         recovery_rest_level,
         detachment_level,
         accomplishment_level,
         created_at,
         updated_at`,
      [
        userId,
        weekStartDate,
        normalizedProductivityFocus,
        normalizedRecoveryRest,
        normalizedDetachment,
        normalizedAccomplishment
      ]
    );

    let burnoutScoresUpdated = 0;
    try {
      const updatedScores = await upsertBurnoutScoresForWeek(
        pool,
        userId,
        weekStartDate
      );
      burnoutScoresUpdated = updatedScores.length;
    } catch (scoreError) {
      console.error('Weekly pulse burnout score refresh error:', scoreError);
    }

    return res.status(200).json({
      message: 'Weekly pulse saved successfully',
      week_start_date: weekStartDate,
      burnout_scores_updated: burnoutScoresUpdated,
      response: result.rows[0]
    });
  } catch (error) {
    console.error('Save weekly pulse error:', error);
    return res.status(500).json({ message: 'Failed to save weekly pulse' });
  }
}
