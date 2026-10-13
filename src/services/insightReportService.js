import { loadWellnessSummary } from './wellnessSummary.service.js';
import { WELLNESS_POLICY_VERSION, summarizeObservations } from './wellnessEvidencePolicy.js';
import {
  addDays,
  formatDateOnly,
  getWeekStartDate
} from './burnoutScoringEngine.js';

const REPORT_FIELDS = `
  insight_report_id,
  user_id,
  report_type,
  period_start,
  period_end,
  title,
  summary,
  priority,
  metrics,
  source_snapshot,
  created_at,
  updated_at
`;

export function previousUtcDateKey(now = new Date()) {
  return addDays(now.toISOString().slice(0, 10), -1);
}

function isSundayDate(value) {
  const [year, month, day] = formatDateOnly(value).split('-').map(Number);
  if (![year, month, day].every(Number.isInteger)) {
    return false;
  }

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

function formatReportRow(row) {
  return {
    methodology: row.metrics?.policy_version === WELLNESS_POLICY_VERSION ? 'CBI and recorded wellness' : 'Legacy methodology - archived report',
    insight_report_id: row.insight_report_id,
    user_id: row.user_id,
    report_type: row.report_type,
    period_start: formatDateOnly(row.period_start),
    period_end: formatDateOnly(row.period_end),
    title: row.title,
    summary: row.summary,
    priority: row.priority,
    metrics: row.metrics ?? {},
    source_snapshot: row.source_snapshot ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function listInsightReports(
  client,
  userId,
  { limit = 30, locale = 'en' } = {}
) {
  const result = await client.query(
    `SELECT ${REPORT_FIELDS}
     FROM user_insight_reports
     WHERE user_id = $1
     ORDER BY updated_at DESC, period_end DESC, insight_report_id DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows
    .map(formatReportRow)
    .map((report) => ({ ...report, locale: 'en' }));
}

export async function refreshInsightReports(
  client,
  userId,
  { date = previousUtcDateKey(), locale = 'en' } = {}
) {
  const normalizedDate = formatDateOnly(date);
  const reports = [];
  let persistedDailyReport = await findInsightReport(
    client,
    userId,
    'daily',
    normalizedDate,
    normalizedDate
  );
  if (!persistedDailyReport) {
    const dailyReport = await buildDailyReport(client, userId, normalizedDate);
    if (dailyReport) {
      persistedDailyReport = await insertInsightReportOnce(
        client,
        userId,
        dailyReport
      );
    }
  }
  if (persistedDailyReport) {
    reports.push(persistedDailyReport);
  }

  if (isSundayDate(normalizedDate)) {
    const weekStart = getWeekStartDate(normalizedDate);
    if (weekStart) {
      const existing = await findInsightReport(client, userId, 'weekly', weekStart, normalizedDate);
      if (existing) { reports.push(existing); return reports.map((report) => ({ ...report, locale: 'en' })); }
      const weeklyReport = await buildWeeklyReport(client, userId, weekStart);
      if (weeklyReport) {
        reports.push(await insertInsightReportOnce(client, userId, weeklyReport));
      }
    }
  }

  return reports.map((report) => ({ ...report, locale: 'en' }));
}

async function buildDailyReport(client, userId, date) {
  return buildRecordedReport(client, userId, 'daily', date, date);
}

async function buildWeeklyReport(client, userId, weekStart) {
  return buildRecordedReport(client, userId, 'weekly', weekStart, addDays(weekStart, 6));
}

async function buildRecordedReport(client, userId, type, start, end) {
  const [summary, logs, activity, pulses, nutrition, goals] = await Promise.all([
    loadWellnessSummary(client, userId, { endDate: end }),
    client.query('SELECT * FROM daily_logs WHERE user_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date', [userId, start, end]),
    client.query('SELECT * FROM daily_activity_logs WHERE user_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date', [userId, start, end]),
    client.query('SELECT * FROM weekly_pulse_responses WHERE user_id = $1 AND response_date BETWEEN $2 AND $3 ORDER BY response_date', [userId, start, end]),
    client.query(`SELECT log_date, COUNT(*)::int AS meal_count FROM nutrition_logs
      WHERE user_id = $1 AND log_date BETWEEN $2 AND $3 GROUP BY log_date`, [userId, start, end]),
    client.query('SELECT * FROM daily_exercise_goals WHERE user_id = $1 AND log_date BETWEEN $2 AND $3', [userId, start, end])
  ]);
  if (![logs, activity, pulses, nutrition, goals].some((result) => result.rows.length)) return null;
  const observations = Object.fromEntries(['sleep_hours', 'sleep_quality', 'mood_index', 'energy_level', 'hydration_liters']
    .map((field) => [field, summarizeObservations(logs.rows.map((row) => ({ ...row, log_date: formatDateOnly(row.log_date) })), field)]));
  const assessment = summary.assessment ? { ...summary.assessment } : null;
  if (assessment) delete assessment.context;
  const scoreText = assessment
    ? `Latest completed CBI Personal Burnout assessment: ${assessment.display_score} / 100 on ${assessment.completed_at.slice(0, 10)}.`
    : 'No completed CBI assessment is available.';
  const observationText = Object.entries(observations).filter(([, value]) => value.mean != null)
    .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value.mean} across ${value.recorded_days} recorded day(s)`).join('; ');
  return {
    reportType: type, periodStart: start, periodEnd: end,
    title: type === 'daily' ? 'Daily wellness report' : 'Weekly wellness report',
    summary: `${scoreText} ${logs.rows.length} daily log(s) from ${start} to ${end}. ${observationText || 'No daily wellness fields recorded.'} Daily logs do not change the assessment.`,
    priority: 'low',
    metrics: { policy_version: WELLNESS_POLICY_VERSION, assessment, recorded_days: logs.rows.length,
      observations, activity_recorded_days: activity.rows.length,
      steps: summarizeObservations(activity.rows.map((row) => ({ ...row, log_date: formatDateOnly(row.log_date) })), 'steps'),
      weekly_reflection_count: pulses.rows.length, nutrition_recorded_days: nutrition.rows.length,
      recommendation: summary.recommendations[0] ?? null,
      ...(type === 'weekly' ? { wellness_comparisons: summary.wellness } : {}) },
    sourceSnapshot: { policy_version: WELLNESS_POLICY_VERSION, daily_logs: logs.rows,
      activity_logs: activity.rows, weekly_reflections: pulses.rows,
      nutrition_records: nutrition.rows, exercise_goals: goals.rows, assessment }
  };
}

async function findInsightReport(
  client,
  userId,
  reportType,
  periodStart,
  periodEnd
) {
  const result = await client.query(
    `SELECT ${REPORT_FIELDS}
     FROM user_insight_reports
     WHERE user_id = $1
       AND report_type = $2
       AND period_start = $3
       AND period_end = $4
     LIMIT 1`,
    [userId, reportType, periodStart, periodEnd]
  );

  const row = result.rows[0];
  return row ? formatReportRow(row) : null;
}

async function insertInsightReportOnce(client, userId, report) {
  const result = await client.query(
    `INSERT INTO user_insight_reports (
       user_id,
       report_type,
       period_start,
       period_end,
       title,
       summary,
       priority,
       metrics,
       source_snapshot
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
     ON CONFLICT (user_id, report_type, period_start, period_end)
     DO NOTHING
     RETURNING ${REPORT_FIELDS}`,
    [
      userId,
      report.reportType,
      report.periodStart,
      report.periodEnd,
      report.title,
      report.summary,
      report.priority,
      JSON.stringify(report.metrics),
      JSON.stringify(report.sourceSnapshot)
    ]
  );

  const insertedRow = result.rows[0];
  if (insertedRow) {
    return formatReportRow(insertedRow);
  }

  return findInsightReport(
    client,
    userId,
    report.reportType,
    report.periodStart,
    report.periodEnd
  );
}
