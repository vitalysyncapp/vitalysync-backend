import pool from '../config/db.js';

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
         exercise_names,
         symptom_names,
         created_at,
         updated_at
       FROM daily_logs
       WHERE user_id = $1 AND log_date = $2`,
      [userId, logDate]
    );

    const streakRow = await readUserStreak(pool, userId);

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

    return res.status(200).json({
      streak: formatStreakPayload(streakRow)
    });
  } catch (error) {
    console.error('Get streak error:', error);
    return res.status(500).json({ message: 'Failed to fetch streak' });
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
    exercise_names: exerciseNames,
    symptom_names: symptomNames
  } = req.body;

  const userId = Number(rawUserId);
  const normalizedExercises = normalizeStringArray(exerciseNames);
  const normalizedSymptoms = normalizeStringArray(symptomNames);

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
             exercise_names = $8,
             symptom_names = $9,
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
          normalizedExercises,
          normalizedSymptoms
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
           exercise_names,
           symptom_names
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userId,
          logDate,
          Number(sleepHours),
          Number(sleepQuality),
          Number(moodIndex),
          Number(energyLevel),
          Number(hydrationLiters),
          normalizedExercises,
          normalizedSymptoms
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
         exercise_names,
         symptom_names,
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

    return res.status(isRedo ? 200 : 201).json({
      message: isRedo
        ? 'Daily log updated successfully'
        : 'Daily log saved successfully',
      is_redo: isRedo,
      log: savedLogResult.rows[0],
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
