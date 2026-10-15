import pool from '../config/db.js';
import { normalizeCheckInDate } from './checkInValidation.service.js';
import { getCheckInScheduleStatus, advanceCheckInSchedule } from './checkInSchedule.service.js';
import { calculateNextPulseDueDate } from './checkInCadence.js';
import {
  BURNOUT_QUESTIONNAIRE_VERSION,
  WEEKLY_QUESTIONNAIRE_VERSION,
  normalizeBurnoutAnswers,
  calculateQuestionnaireDimensions
} from './burnoutQuestionnaire.js';

function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function userIdValue(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) throw invalid('Valid user_id is required');
  return userId;
}

function dateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function publicAssessment(row) {
  return row ? { ...row, due_date: dateOnly(row.due_date), response_date: dateOnly(row.response_date) } : null;
}

export async function getWeeklyAssessmentStatus({ userId: rawUserId, logDate, database = pool }) {
  const userId = userIdValue(rawUserId);
  const localDate = normalizeCheckInDate(logDate);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const schedule = await getCheckInScheduleStatus(client, { userId, localDate, forUpdate: true });
    if (!schedule) throw invalid('User not found', 404);
    const result = await client.query(
      `SELECT * FROM weekly_burnout_assessments
       WHERE user_id = $1 ORDER BY response_date DESC, updated_at DESC LIMIT 52`, [userId]
    );
    const history = result.rows.map(publicAssessment);
    const today = history.find((row) => row.response_date === localDate);
    const dueDate = today?.due_date ?? schedule.nextDueDate;
    await client.query('COMMIT');
    return {
      questionnaire_version: WEEKLY_QUESTIONNAIRE_VERSION,
      is_due: !today && dueDate != null && dueDate <= localDate,
      is_overdue: !today && dueDate != null && dueDate < localDate,
      completed_today: today != null,
      due_date: dueDate,
      next_due_date: schedule.nextDueDate,
      latest: history[0] ?? null,
      today: today ?? null,
      history
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function submitWeeklyAssessment({ userId: rawUserId, payload, database = pool, scheduleReader = getCheckInScheduleStatus, scheduleAdvancer = advanceCheckInSchedule }) {
  const userId = userIdValue(rawUserId);
  const responseDate = normalizeCheckInDate(payload?.response_date);
  const dueDate = normalizeCheckInDate(payload?.due_date);
  if (dueDate > responseDate) throw invalid('The weekly log is not due yet', 409);
  const version = payload?.questionnaire_version;
  if (![WEEKLY_QUESTIONNAIRE_VERSION, BURNOUT_QUESTIONNAIRE_VERSION].includes(version)) {
    throw invalid('Unsupported weekly questionnaire version');
  }
  const answers = normalizeBurnoutAnswers(payload.answers, version);
  const scores = calculateQuestionnaireDimensions(answers, version);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const schedule = await scheduleReader(client, {
      userId, localDate: responseDate, forUpdate: true
    });
    if (!schedule) throw invalid('User not found', 404);
    if (!schedule.nextDueDate || dueDate > schedule.nextDueDate) {
      throw invalid('The weekly log is not due yet', 409);
    }
    // The due date identifies the cycle. Offline retries update the same row.
    const result = await client.query(
      `INSERT INTO weekly_burnout_assessments
         (user_id, due_date, response_date, questionnaire_version, answers, scores)
       VALUES ($1, $2, $3, $4, $5::JSONB, $6::JSONB)
       ON CONFLICT (user_id, due_date) DO UPDATE SET
         answers = EXCLUDED.answers, scores = EXCLUDED.scores,
         questionnaire_version = EXCLUDED.questionnaire_version,
         response_date = EXCLUDED.response_date, updated_at = NOW()
       WHERE weekly_burnout_assessments.response_date <= EXCLUDED.response_date
       RETURNING *`,
      [userId, dueDate, responseDate, version,
        JSON.stringify(answers), JSON.stringify(scores)]
    );
    const nextDueDate = calculateNextPulseDueDate(responseDate, schedule.pulseWeekday);
    if ((!schedule.lastCompletedDueDate || dueDate > schedule.lastCompletedDueDate) &&
        nextDueDate >= schedule.nextDueDate) {
      await scheduleAdvancer(client, {
        userId, mode: 'weekly', logDate: responseDate, dueDate, pulseWeekday: schedule.pulseWeekday
      });
    }
    await client.query('COMMIT');
    return { message: 'Weekly log saved successfully', assessment: publicAssessment(result.rows[0]) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
