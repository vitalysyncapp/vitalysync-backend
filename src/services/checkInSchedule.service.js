import {
  calculateFirstPulseDueDate,
  calculateMostRecentPulseDate,
  calculateNextPulseDueDate,
  calculateUpcomingPulseDate
} from './checkInCadence.js';
import { detectReturnState } from './burnoutEvidencePolicy.js';

function formatDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function compareDates(left, right) {
  return String(left).localeCompare(String(right));
}

async function readUserContext(client, userId) {
  const result = await client.query(
     `SELECT
       users.user_id,
       COALESCE(preferences.weekly_pulse_reminder_day, 1) AS pulse_weekday,
       (
         SELECT MAX(log_date)
         FROM daily_logs
         WHERE daily_logs.user_id = users.user_id
       ) AS last_logged_date,
       (
         SELECT started_at
         FROM user_baseline_epochs epoch
         WHERE epoch.user_id = users.user_id AND epoch.ended_at IS NULL
         ORDER BY epoch.started_at DESC, epoch.baseline_epoch_id DESC
         LIMIT 1
       ) AS baseline_epoch_started_at
     FROM users
     LEFT JOIN user_reminder_preferences preferences
       ON preferences.user_id = users.user_id
     WHERE users.user_id = $1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

async function ensureScheduleRow(client, userId, pulseWeekday) {
  await client.query(
    `INSERT INTO user_check_in_schedules (user_id, pulse_weekday)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, pulseWeekday]
  );
}

async function initializeNextDueDate(client, userId, pulseWeekday) {
  const [latestPulseResult, firstLogResult] = await Promise.all([
    client.query(
      `SELECT due_date, response_date
       FROM weekly_pulse_responses
       WHERE user_id = $1
       ORDER BY due_date DESC, response_date DESC
       LIMIT 1`,
      [userId]
    ),
    client.query(
      `SELECT MIN(log_date) AS first_log_date
       FROM daily_logs
       WHERE user_id = $1`,
      [userId]
    )
  ]);

  const latestPulse = latestPulseResult.rows[0] ?? null;
  const firstLogDate = formatDateOnly(firstLogResult.rows[0]?.first_log_date);
  const nextDueDate = latestPulse
    ? calculateNextPulseDueDate(
        formatDateOnly(latestPulse.response_date),
        pulseWeekday
      )
    : calculateFirstPulseDueDate(firstLogDate, pulseWeekday);

  if (nextDueDate) {
    await client.query(
      `UPDATE user_check_in_schedules
       SET next_pulse_due_date = $2,
           pulse_weekday = $3,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, nextDueDate, pulseWeekday]
    );
  }

  return nextDueDate;
}

export async function getCheckInScheduleStatus(
  client,
  { userId, localDate, forUpdate = false }
) {
  const user = await readUserContext(client, userId);
  if (!user) {
    return null;
  }

  const pulseWeekday = Number(user.pulse_weekday);
  await ensureScheduleRow(client, userId, pulseWeekday);

  let scheduleResult = await client.query(
    `SELECT
       user_id,
       pulse_weekday,
       next_pulse_due_date,
       last_completed_due_date,
       last_completed_at
     FROM user_check_in_schedules
     WHERE user_id = $1
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [userId]
  );
  let schedule = scheduleResult.rows[0];
  let nextDueDate = formatDateOnly(schedule.next_pulse_due_date);

  if (!nextDueDate) {
    nextDueDate = await initializeNextDueDate(client, userId, pulseWeekday);
  }

  if (nextDueDate && compareDates(nextDueDate, localDate) < 0) {
    const latestMissedDueDate = calculateMostRecentPulseDate(
      localDate,
      Number(schedule.pulse_weekday)
    );
    if (compareDates(latestMissedDueDate, nextDueDate) > 0) {
      nextDueDate = latestMissedDueDate;
      await client.query(
        `UPDATE user_check_in_schedules
         SET next_pulse_due_date = $2,
             pulse_weekday = $3,
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId, nextDueDate, Number(schedule.pulse_weekday)]
      );
    }
  } else if (
    Number(schedule.pulse_weekday) !== pulseWeekday &&
    compareDates(nextDueDate, localDate) > 0
  ) {
    nextDueDate = calculateUpcomingPulseDate(localDate, pulseWeekday);
    await client.query(
      `UPDATE user_check_in_schedules
       SET next_pulse_due_date = $2,
           pulse_weekday = $3,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, nextDueDate, pulseWeekday]
    );
  }

  scheduleResult = await client.query(
    `SELECT
       user_id,
       pulse_weekday,
       next_pulse_due_date,
       last_completed_due_date,
       last_completed_at
     FROM user_check_in_schedules
     WHERE user_id = $1`,
    [userId]
  );
  schedule = scheduleResult.rows[0];
  nextDueDate = formatDateOnly(schedule.next_pulse_due_date);

  const todayPulseResult = await client.query(
    `SELECT
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
       updated_at
     FROM weekly_pulse_responses
     WHERE user_id = $1 AND response_date = $2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, localDate]
  );
  const todayPulse = todayPulseResult.rows[0] ?? null;
  const completedToday = todayPulse != null;
  const isDue = !completedToday && nextDueDate === localDate;
  const isOverdue = !completedToday && nextDueDate != null &&
    compareDates(nextDueDate, localDate) < 0;
  const requiredMode = completedToday || isDue || isOverdue
    ? 'weekly'
    : 'daily';
  const returnState = detectReturnState({
    lastLoggedDate: user.last_logged_date,
    localDate,
    baselineEpochStartedAt: user.baseline_epoch_started_at
  });

  return {
    requiredMode,
    isDue,
    isOverdue,
    completedToday,
    dueDate: completedToday
      ? formatDateOnly(todayPulse.due_date)
      : nextDueDate,
    nextDueDate,
    lastCompletedDueDate: formatDateOnly(schedule.last_completed_due_date),
    lastCompletedAt: schedule.last_completed_at ?? null,
    pulseWeekday,
    todayPulse,
    ...returnState
  };
}

export async function advanceCheckInSchedule(
  client,
  { userId, mode, logDate, dueDate, pulseWeekday }
) {
  if (mode === 'weekly') {
    const nextDueDate = calculateNextPulseDueDate(logDate, pulseWeekday);
    await client.query(
      `UPDATE user_check_in_schedules
       SET next_pulse_due_date = $2,
           last_completed_due_date = $3,
           last_completed_at = NOW(),
           pulse_weekday = $4,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, nextDueDate, dueDate, pulseWeekday]
    );
    return nextDueDate;
  }

  const result = await client.query(
    `SELECT next_pulse_due_date
     FROM user_check_in_schedules
     WHERE user_id = $1`,
    [userId]
  );
  const existingDueDate = formatDateOnly(result.rows[0]?.next_pulse_due_date);
  if (existingDueDate) {
    return existingDueDate;
  }

  const nextDueDate = calculateFirstPulseDueDate(logDate, pulseWeekday);
  await client.query(
    `UPDATE user_check_in_schedules
     SET next_pulse_due_date = $2,
         pulse_weekday = $3,
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId, nextDueDate, pulseWeekday]
  );
  return nextDueDate;
}
