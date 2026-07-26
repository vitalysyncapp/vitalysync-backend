import pool from '../config/db.js';
import { getWeekStartDate } from './burnoutScoringEngine.js';
import { upsertBurnoutScoreForDate } from './burnoutScoringService.js';
import {
  awardStreakRewardsForLog,
  ensureUserStreak,
  formatStreakPayload,
  normalizeRestoreDecision,
  prepareStreakForNewLog
} from './streak.service.js';
import {
  advanceCheckInSchedule,
  getCheckInScheduleStatus
} from './checkInSchedule.service.js';
import {
  normalizeCheckInDate,
  normalizeDailyCheckIn,
  normalizeWeeklyCheckIn
} from './checkInValidation.service.js';

function serviceError(message, statusCode, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw serviceError('Valid user_id is required', 400, 'INVALID_USER_ID');
  }
  return userId;
}

function normalizeRequestedMode(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized !== 'daily' && normalized !== 'weekly') {
    throw serviceError(
      'Valid check_in_type is required',
      400,
      'INVALID_CHECK_IN_TYPE'
    );
  }
  return normalized;
}

function normalizeIdempotencyKey(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (normalized.length > 120) {
    throw serviceError(
      'Idempotency key must be 120 characters or fewer',
      400,
      'INVALID_IDEMPOTENCY_KEY'
    );
  }
  return normalized;
}

function formatDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function readTodayLog(client, userId, logDate) {
  const result = await client.query(
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
       daily_detachment_level,
       daily_focus_level,
       daily_accomplishment_level,
       exercise_names,
       symptom_names,
       habit_names,
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
  return result.rows[0] ?? null;
}

function publicSchedule(status, nextDueDate = status.nextDueDate) {
  return {
    is_due: status.isDue,
    is_overdue: status.isOverdue,
    completed_today: status.completedToday,
    due_date: status.dueDate,
    next_due_date: nextDueDate,
    last_completed_due_date: status.lastCompletedDueDate,
    last_completed_at: status.lastCompletedAt,
    pulse_weekday: status.pulseWeekday
  };
}

async function persistDailyLog(
  client,
  { userId, logDate, daily, idempotencyKey, restoreDecision }
) {
  const streakRow = await ensureUserStreak(client, userId, { forUpdate: true });
  const existingLogResult = await client.query(
    `SELECT log_id
     FROM daily_logs
     WHERE user_id = $1 AND log_date = $2
     FOR UPDATE`,
    [userId, logDate]
  );
  const isRedo = existingLogResult.rowCount > 0;
  let updatedStreak = Number(streakRow.current_streak ?? 0);
  let longestStreak = Number(streakRow.longest_streak ?? 0);
  let streakRestore = {
    required: false,
    decision: restoreDecision,
    missing_dates: [],
    savers_used: 0
  };
  let streakRewards = [];

  if (isRedo) {
    await client.query(
      `UPDATE daily_logs
       SET sleep_hours = $3,
           sleep_quality = $4,
           mood_index = $5,
           energy_level = $6,
           hydration_liters = $7,
           workload_hours_band = $8,
           perceived_stress_level = NULL,
           break_quality_level = NULL,
           daily_detachment_level = NULL,
           daily_focus_level = NULL,
           daily_accomplishment_level = NULL,
           exercise_names = $9,
           symptom_names = $10,
           exercise_goal_name = COALESCE($11, exercise_goal_name),
           exercise_goal_completed = COALESCE($12, exercise_goal_completed),
           exercise_goal_source = COALESCE($13, exercise_goal_source),
           exercise_goal_status = COALESCE($14, exercise_goal_status),
           habit_names = $15::TEXT[],
           check_in_idempotency_key = COALESCE(
             check_in_idempotency_key,
             $16
           ),
           updated_at = NOW()
       WHERE user_id = $1 AND log_date = $2`,
      [
        userId,
        logDate,
        daily.sleep_hours,
        daily.sleep_quality,
        daily.mood_index,
        daily.energy_level,
        daily.hydration_liters,
        daily.workload_hours_band,
        daily.exercise_names,
        daily.symptom_names,
        daily.exercise_goal_name,
        daily.exercise_goal_completed,
        daily.exercise_goal_source,
        daily.exercise_goal_status,
        daily.habit_names,
        idempotencyKey
      ]
    );
  } else {
    const streakUpdate = await prepareStreakForNewLog(client, {
      userId,
      logDate,
      streakRow,
      restoreDecision
    });
    updatedStreak = streakUpdate.updatedStreak;
    longestStreak = streakUpdate.longestStreak;
    streakRestore = streakUpdate.restore;

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
         daily_detachment_level,
         daily_focus_level,
         daily_accomplishment_level,
         exercise_names,
         symptom_names,
         exercise_goal_name,
         exercise_goal_completed,
         exercise_goal_source,
         exercise_goal_status,
         habit_names,
         check_in_idempotency_key
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         NULL, NULL, NULL, NULL, NULL,
         $9, $10, $11, COALESCE($12, FALSE), $13, $14, $15::TEXT[], $16
       )`,
      [
        userId,
        logDate,
        daily.sleep_hours,
        daily.sleep_quality,
        daily.mood_index,
        daily.energy_level,
        daily.hydration_liters,
        daily.workload_hours_band,
        daily.exercise_names,
        daily.symptom_names,
        daily.exercise_goal_name,
        daily.exercise_goal_completed,
        daily.exercise_goal_source,
        daily.exercise_goal_status,
        daily.habit_names,
        idempotencyKey
      ]
    );

    await client.query(
      `UPDATE user_streaks
       SET current_streak = $2,
           longest_streak = $3,
           last_logged_date = $4,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, updatedStreak, longestStreak, logDate]
    );

    streakRewards = await awardStreakRewardsForLog(client, {
      userId,
      logDate,
      currentStreak: updatedStreak
    });
  }

  const [savedLog, currentStreakResult] = await Promise.all([
    readTodayLog(client, userId, logDate),
    client.query(
      `SELECT current_streak, longest_streak, last_logged_date
       FROM user_streaks
       WHERE user_id = $1`,
      [userId]
    )
  ]);

  return {
    isRedo,
    savedLog,
    streak: formatStreakPayload(currentStreakResult.rows[0]),
    streakRestore,
    streakRewards
  };
}

async function persistWeeklyPulse(
  client,
  { userId, dueDate, responseDate, weekly }
) {
  const weekStartDate = getWeekStartDate(responseDate);
  const result = await client.query(
    `INSERT INTO weekly_pulse_responses (
       user_id,
       week_start_date,
       due_date,
       response_date,
       perceived_pressure_level,
       productivity_focus_level,
       recovery_rest_level,
       detachment_level,
       accomplishment_level,
       schema_version
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 2)
     ON CONFLICT (user_id, due_date)
     DO UPDATE SET
       due_date = EXCLUDED.due_date,
       response_date = EXCLUDED.response_date,
       perceived_pressure_level = EXCLUDED.perceived_pressure_level,
       productivity_focus_level = EXCLUDED.productivity_focus_level,
       recovery_rest_level = EXCLUDED.recovery_rest_level,
       detachment_level = EXCLUDED.detachment_level,
       accomplishment_level = EXCLUDED.accomplishment_level,
       schema_version = 2,
       updated_at = NOW()
     RETURNING
       pulse_id,
       user_id,
       week_start_date,
       due_date,
       response_date,
       perceived_pressure_level,
       productivity_focus_level,
       recovery_rest_level,
       detachment_level,
       accomplishment_level,
       schema_version,
       created_at,
       updated_at`,
    [
      userId,
      weekStartDate,
      dueDate,
      responseDate,
      weekly.perceived_pressure_level,
      weekly.productivity_focus_level,
      weekly.recovery_rest_level,
      weekly.detachment_level,
      weekly.accomplishment_level
    ]
  );
  return result.rows[0];
}

export async function getCheckInStatus({ userId: rawUserId, logDate, database = pool }) {
  const userId = normalizeUserId(rawUserId);
  const normalizedLogDate = normalizeCheckInDate(logDate);
  const client = await database.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const schedule = await getCheckInScheduleStatus(client, {
      userId,
      localDate: normalizedLogDate,
      forUpdate: true
    });
    if (!schedule) {
      throw serviceError('User not found', 404, 'USER_NOT_FOUND');
    }

    const dailyLog = await readTodayLog(client, userId, normalizedLogDate);
    await client.query('COMMIT');
    transactionOpen = false;

    return {
      required_mode: schedule.requiredMode,
      has_today_log: dailyLog != null,
      schedule: publicSchedule(schedule),
      existing_check_in: {
        daily: dailyLog,
        weekly: schedule.todayPulse
      }
    };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function submitCheckIn({
  userId: rawUserId,
  payload,
  idempotencyKey: rawIdempotencyKey,
  database = pool,
  scoreUpdater = upsertBurnoutScoreForDate
}) {
  const userId = normalizeUserId(rawUserId);
  const logDate = normalizeCheckInDate(payload?.log_date);
  const daily = normalizeDailyCheckIn(payload);
  const requestedMode = normalizeRequestedMode(
    payload?.check_in_type ?? payload?.mode
  );
  const idempotencyKey = normalizeIdempotencyKey(
    rawIdempotencyKey ?? payload?.idempotency_key
  );
  const restoreDecision = normalizeRestoreDecision(
    payload?.streak_restore_decision
  );
  const client = await database.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const schedule = await getCheckInScheduleStatus(client, {
      userId,
      localDate: logDate,
      forUpdate: true
    });
    if (!schedule) {
      throw serviceError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (schedule.requiredMode === 'weekly' && requestedMode === 'daily') {
      throw serviceError(
        'Weekly pulse is required before a short daily check-in can be saved',
        409,
        'WEEKLY_PULSE_REQUIRED',
        { schedule: publicSchedule(schedule) }
      );
    }
    if (schedule.requiredMode === 'daily' && requestedMode === 'weekly') {
      throw serviceError(
        'Weekly pulse is not due for this date',
        409,
        'WEEKLY_PULSE_NOT_DUE',
        { schedule: publicSchedule(schedule) }
      );
    }

    const mode = schedule.requiredMode;
    if (mode === 'weekly' && !payload?.weekly) {
      throw serviceError(
        'Weekly pulse is required before a short daily check-in can be saved',
        409,
        'WEEKLY_PULSE_REQUIRED',
        { schedule: publicSchedule(schedule) }
      );
    }
    if (mode === 'daily' && payload?.weekly) {
      throw serviceError(
        'Weekly pulse is not due for this date',
        409,
        'WEEKLY_PULSE_NOT_DUE',
        { schedule: publicSchedule(schedule) }
      );
    }
    if (idempotencyKey) {
      const idempotencyResult = await client.query(
        `SELECT log_date
         FROM daily_logs
         WHERE user_id = $1 AND check_in_idempotency_key = $2`,
        [userId, idempotencyKey]
      );
      const existingIdempotencyDate = idempotencyResult.rows[0]?.log_date;
      if (
        existingIdempotencyDate &&
        formatDateOnly(existingIdempotencyDate) !== logDate
      ) {
        throw serviceError(
          'Idempotency key has already been used for another check-in date',
          409,
          'IDEMPOTENCY_KEY_REUSED'
        );
      }
    }

    const weekly = mode === 'weekly' ? normalizeWeeklyCheckIn(payload) : null;
    const dailyResult = await persistDailyLog(client, {
      userId,
      logDate,
      daily,
      idempotencyKey,
      restoreDecision
    });
    const weeklyPulse = weekly
      ? await persistWeeklyPulse(client, {
          userId,
          dueDate: schedule.dueDate,
          responseDate: logDate,
          weekly
        })
      : null;
    const nextDueDate = await advanceCheckInSchedule(client, {
      userId,
      mode,
      logDate,
      dueDate: schedule.dueDate,
      pulseWeekday: schedule.pulseWeekday
    });

    await client.query('COMMIT');
    transactionOpen = false;

    let burnoutScore = null;
    try {
      burnoutScore = await scoreUpdater(database, userId, logDate);
    } catch (scoreError) {
      console.error('Unified check-in burnout score refresh error:', scoreError);
    }

    return {
      message: mode === 'weekly'
        ? 'Weekly pulse and daily log saved successfully'
        : 'Daily log saved successfully',
      check_in_type: mode,
      is_redo: dailyResult.isRedo,
      log: dailyResult.savedLog,
      weekly_pulse: weeklyPulse,
      schedule: {
        ...publicSchedule(schedule, nextDueDate),
        is_due: false,
        is_overdue: false,
        completed_today: mode === 'weekly',
        next_due_date: nextDueDate,
        last_completed_due_date: mode === 'weekly'
          ? schedule.dueDate
          : schedule.lastCompletedDueDate,
        last_completed_at: mode === 'weekly'
          ? new Date().toISOString()
          : schedule.lastCompletedAt
      },
      burnout_score: burnoutScore,
      streak: dailyResult.streak,
      streak_restore: dailyResult.streakRestore,
      streak_rewards: dailyResult.streakRewards
    };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
