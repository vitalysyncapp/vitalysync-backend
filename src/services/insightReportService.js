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

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function toNullableInteger(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function average(values) {
  const valid = values
    .map((value) => toNumber(value, null))
    .filter((value) => value != null);
  if (valid.length === 0) {
    return 0;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function averagePresent(values) {
  const presentValues = values.filter((value) => value != null);
  return presentValues.length === 0 ? null : average(presentValues);
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function roundNullable(value, digits = 1) {
  return value == null ? null : round(value, digits);
}

function nonNoneList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0 && item.toLowerCase() !== 'none');
}

function formatReportRow(row) {
  return {
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

export async function listInsightReports(client, userId, { limit = 30 } = {}) {
  const result = await client.query(
    `SELECT ${REPORT_FIELDS}
     FROM user_insight_reports
     WHERE user_id = $1
     ORDER BY updated_at DESC, period_end DESC, insight_report_id DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map(formatReportRow);
}

export async function refreshInsightReports(
  client,
  userId,
  { date = previousUtcDateKey() } = {}
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
      const weeklyReport = await buildWeeklyReport(client, userId, weekStart);
      if (weeklyReport) {
        reports.push(await upsertInsightReport(client, userId, weeklyReport));
      }
    }
  }

  return reports;
}

async function buildDailyReport(client, userId, date) {
  const [
    logResult,
    activityResult,
    goalResult,
    nutritionResult,
    burnoutResult
  ] = await Promise.all([
    client.query(
      `SELECT
         log_id,
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
         exercise_goal_status,
         updated_at
       FROM daily_logs
       WHERE user_id = $1 AND log_date = $2`,
      [userId, date]
    ),
    client.query(
      `SELECT
         log_date,
         steps,
         active_minutes,
         calories_burned,
         goal_steps,
         goal_completed,
         updated_at
       FROM daily_activity_logs
       WHERE user_id = $1 AND log_date = $2`,
      [userId, date]
    ),
    client.query(
      `SELECT
         log_date,
         exercise_name,
         exercise_category,
         status,
         completed_at,
         updated_at
       FROM daily_exercise_goals
       WHERE user_id = $1 AND log_date = $2`,
      [userId, date]
    ),
    client.query(
      `SELECT
         log_date,
         COALESCE(SUM(total_calories), 0) AS total_calories,
         COALESCE(SUM(total_protein_g), 0) AS total_protein_g,
         COALESCE(SUM(total_carbs_g), 0) AS total_carbs_g,
         COALESCE(SUM(total_fat_g), 0) AS total_fat_g,
         COUNT(*)::INTEGER AS meal_count
       FROM nutrition_logs
       WHERE user_id = $1 AND log_date = $2
       GROUP BY log_date`,
      [userId, date]
    ),
    client.query(
      `SELECT
         score_date,
         overall_score,
         risk_level,
         confidence_score,
         updated_at
       FROM burnout_score_history
       WHERE user_id = $1 AND score_date = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, date]
    )
  ]);

  const log = logResult.rows[0] ?? null;
  const activity = activityResult.rows[0] ?? null;
  const goal = goalResult.rows[0] ?? null;
  const nutrition = nutritionResult.rows[0] ?? null;
  const burnout = burnoutResult.rows[0] ?? null;

  if (!log && !activity && !goal && !nutrition && !burnout) {
    return null;
  }

  const sleepHours = log ? toNumber(log.sleep_hours) : 0;
  const hydrationLiters = log ? toNumber(log.hydration_liters) : 0;
  const stressLevel = log ? toInteger(log.perceived_stress_level, 0) : 0;
  const dailyDetachmentLevel = log
    ? toNullableInteger(log.daily_detachment_level)
    : null;
  const dailyFocusLevel = log ? toNullableInteger(log.daily_focus_level) : null;
  const dailyAccomplishmentLevel = log
    ? toNullableInteger(log.daily_accomplishment_level)
    : null;
  const steps = activity ? toInteger(activity.steps) : 0;
  const mealCount = nutrition ? toInteger(nutrition.meal_count) : 0;
  const burnoutScore = burnout ? round(burnout.overall_score, 0) : null;
  const riskLevel = burnout?.risk_level ?? null;
  const symptoms = nonNoneList(log?.symptom_names);
  const habits = nonNoneList(log?.habit_names);

  const metrics = {
    date,
    sleep_hours: sleepHours,
    hydration_liters: hydrationLiters,
    mood_index: log ? toInteger(log.mood_index) : null,
    energy_level: log ? toInteger(log.energy_level) : null,
    perceived_stress_level: stressLevel || null,
    break_quality_level: log ? toInteger(log.break_quality_level) : null,
    daily_detachment_level: dailyDetachmentLevel,
    daily_focus_level: dailyFocusLevel,
    daily_accomplishment_level: dailyAccomplishmentLevel,
    steps,
    goal_steps: activity ? toInteger(activity.goal_steps) : null,
    activity_goal_completed: activity?.goal_completed == true,
    meal_count: mealCount,
    total_calories: nutrition ? round(nutrition.total_calories, 0) : null,
    burnout_score: burnoutScore,
    burnout_risk_level: riskLevel,
    symptom_count: symptoms.length,
    recovery_habit_count: habits.length,
    exercise_goal_name: goal?.exercise_name ?? log?.exercise_goal_name ?? null,
    exercise_goal_status: goal?.status ?? log?.exercise_goal_status ?? null,
    exercise_goal_completed:
      goal?.status === 'completed' || log?.exercise_goal_completed == true
  };

  const priority = dailyPriority({
    sleepHours,
    hydrationLiters,
    stressLevel,
    dailyDetachmentLevel,
    dailyFocusLevel,
    dailyAccomplishmentLevel,
    burnoutScore,
    riskLevel,
    symptoms
  });

  return {
    reportType: 'daily',
    periodStart: date,
    periodEnd: date,
    title: 'Daily wellness report',
    summary: dailySummary({
      log,
      activity,
      nutrition,
      burnout,
      sleepHours,
      hydrationLiters,
      stressLevel,
      dailyDetachmentLevel,
      dailyFocusLevel,
      dailyAccomplishmentLevel,
      steps,
      mealCount,
      symptoms,
      habits,
      burnoutScore,
      riskLevel
    }),
    priority,
    metrics,
    sourceSnapshot: {
      daily_log: log,
      activity_log: activity,
      exercise_goal: goal,
      nutrition_summary: nutrition,
      burnout_score: burnout
    }
  };
}

async function buildWeeklyReport(client, userId, weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const [
    logsResult,
    activityResult,
    nutritionResult,
    weeklyPulseResult,
    burnoutResult
  ] = await Promise.all([
    client.query(
      `SELECT
         log_date,
         sleep_hours,
         mood_index,
         energy_level,
         hydration_liters,
         perceived_stress_level,
         break_quality_level,
         daily_detachment_level,
         daily_focus_level,
         daily_accomplishment_level,
         exercise_names,
         symptom_names,
         habit_names,
         exercise_goal_completed
       FROM daily_logs
       WHERE user_id = $1
         AND log_date BETWEEN $2 AND $3
       ORDER BY log_date ASC`,
      [userId, weekStart, weekEnd]
    ),
    client.query(
      `SELECT
         log_date,
         steps,
         active_minutes,
         goal_completed
       FROM daily_activity_logs
       WHERE user_id = $1
         AND log_date BETWEEN $2 AND $3
       ORDER BY log_date ASC`,
      [userId, weekStart, weekEnd]
    ),
    client.query(
      `SELECT
         log_date,
         COALESCE(SUM(total_calories), 0) AS total_calories,
         COUNT(*)::INTEGER AS meal_count
       FROM nutrition_logs
       WHERE user_id = $1
         AND log_date BETWEEN $2 AND $3
       GROUP BY log_date
       ORDER BY log_date ASC`,
      [userId, weekStart, weekEnd]
    ),
    client.query(
      `SELECT
         week_start_date,
         productivity_focus_level,
         recovery_rest_level,
         detachment_level,
         accomplishment_level,
         updated_at
       FROM weekly_pulse_responses
       WHERE user_id = $1 AND week_start_date = $2`,
      [userId, weekStart]
    ),
    client.query(
      `SELECT
         score_date,
         overall_score,
         risk_level,
         confidence_score
       FROM burnout_score_history
       WHERE user_id = $1
         AND score_date BETWEEN $2 AND $3
       ORDER BY score_date ASC`,
      [userId, weekStart, weekEnd]
    )
  ]);

  const logs = logsResult.rows;
  const activityLogs = activityResult.rows;
  const nutritionDays = nutritionResult.rows;
  const weeklyPulse = weeklyPulseResult.rows[0] ?? null;
  const burnoutScores = burnoutResult.rows;

  if (
    logs.length === 0 &&
    activityLogs.length === 0 &&
    nutritionDays.length === 0 &&
    !weeklyPulse &&
    burnoutScores.length === 0
  ) {
    return null;
  }

  const loggedDays = logs.length;
  const averageSleep = round(average(logs.map((log) => log.sleep_hours)));
  const averageHydration = round(average(logs.map((log) => log.hydration_liters)));
  const averageMood = round(average(logs.map((log) => log.mood_index)));
  const averageStress = round(
    average(logs.map((log) => log.perceived_stress_level))
  );
  const averageDailyDetachment = roundNullable(
    averagePresent(logs.map((log) => toNullableInteger(log.daily_detachment_level)))
  );
  const averageDailyFocus = roundNullable(
    averagePresent(logs.map((log) => toNullableInteger(log.daily_focus_level)))
  );
  const averageDailyAccomplishment = roundNullable(
    averagePresent(
      logs.map((log) => toNullableInteger(log.daily_accomplishment_level))
    )
  );
  const exerciseDays = logs.filter((log) => {
    if (log.exercise_goal_completed == true) {
      return true;
    }
    return nonNoneList(log.exercise_names).length > 0;
  }).length;
  const symptomDays = logs.filter(
    (log) => nonNoneList(log.symptom_names).length > 0
  ).length;
  const recoveryHabitDays = logs.filter(
    (log) => nonNoneList(log.habit_names).length > 0
  ).length;
  const totalSteps = activityLogs.reduce(
    (sum, log) => sum + toInteger(log.steps),
    0
  );
  const activityGoalDays = activityLogs.filter(
    (log) => log.goal_completed == true
  ).length;
  const mealLoggedDays = nutritionDays.length;
  const totalMeals = nutritionDays.reduce(
    (sum, day) => sum + toInteger(day.meal_count),
    0
  );
  const latestBurnout = burnoutScores[burnoutScores.length - 1] ?? null;
  const averageBurnout = burnoutScores.length === 0
    ? null
    : round(average(burnoutScores.map((score) => score.overall_score)), 0);
  const latestBurnoutScore = latestBurnout
    ? round(latestBurnout.overall_score, 0)
    : null;

  const metrics = {
    week_start: weekStart,
    week_end: weekEnd,
    logged_days: loggedDays,
    average_sleep_hours: averageSleep,
    average_hydration_liters: averageHydration,
    average_mood_index: averageMood,
    average_stress_level: averageStress,
    average_daily_detachment_level: averageDailyDetachment,
    average_daily_focus_level: averageDailyFocus,
    average_daily_accomplishment_level: averageDailyAccomplishment,
    weekly_productivity_focus_level:
      toNullableInteger(weeklyPulse?.productivity_focus_level),
    weekly_recovery_rest_level:
      toNullableInteger(weeklyPulse?.recovery_rest_level),
    weekly_detachment_level: toNullableInteger(weeklyPulse?.detachment_level),
    weekly_accomplishment_level:
      toNullableInteger(weeklyPulse?.accomplishment_level),
    exercise_days: exerciseDays,
    symptom_days: symptomDays,
    recovery_habit_days: recoveryHabitDays,
    total_steps: totalSteps,
    activity_goal_days: activityGoalDays,
    meal_logged_days: mealLoggedDays,
    total_meals: totalMeals,
    average_burnout_score: averageBurnout,
    latest_burnout_score: latestBurnoutScore,
    latest_burnout_risk_level: latestBurnout?.risk_level ?? null,
    weekly_pulse_completed: weeklyPulse != null
  };

  return {
    reportType: 'weekly',
    periodStart: weekStart,
    periodEnd: weekEnd,
    title: 'Weekly wellness report',
    summary: weeklySummary({
      loggedDays,
      averageSleep,
      averageHydration,
      averageStress,
      averageDailyDetachment,
      averageDailyFocus,
      averageDailyAccomplishment,
      exerciseDays,
      totalSteps,
      mealLoggedDays,
      latestBurnoutScore,
      latestBurnoutRisk: latestBurnout?.risk_level ?? null,
      weeklyPulse
    }),
    priority: weeklyPriority({
      loggedDays,
      averageSleep,
      averageStress,
      averageDailyDetachment,
      averageDailyFocus,
      averageDailyAccomplishment,
      weeklyPulse,
      latestBurnoutScore,
      latestBurnoutRisk: latestBurnout?.risk_level ?? null
    }),
    metrics,
    sourceSnapshot: {
      daily_logs: logs,
      activity_logs: activityLogs,
      nutrition_days: nutritionDays,
      weekly_pulse: weeklyPulse,
      burnout_scores: burnoutScores
    }
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

async function upsertInsightReport(client, userId, report) {
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
     DO UPDATE SET
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       priority = EXCLUDED.priority,
       metrics = EXCLUDED.metrics,
       source_snapshot = EXCLUDED.source_snapshot,
       updated_at = NOW()
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

  return formatReportRow(result.rows[0]);
}

function dailyPriority({
  sleepHours,
  hydrationLiters,
  stressLevel,
  dailyDetachmentLevel,
  dailyFocusLevel,
  dailyAccomplishmentLevel,
  burnoutScore,
  riskLevel,
  symptoms
}) {
  if (
    burnoutScore >= 70 ||
    ['high', 'severe'].includes(String(riskLevel ?? '').toLowerCase()) ||
    stressLevel >= 5 ||
    dailyDetachmentLevel >= 5 ||
    (dailyFocusLevel != null && dailyFocusLevel <= 1) ||
    (dailyAccomplishmentLevel != null && dailyAccomplishmentLevel <= 1) ||
    symptoms.length >= 3
  ) {
    return 'high';
  }

  if (sleepHours > 0 && sleepHours < 6) {
    return 'medium';
  }
  if (hydrationLiters > 0 && hydrationLiters < 1.5) {
    return 'medium';
  }
  if (stressLevel >= 4) {
    return 'medium';
  }
  if (
    dailyDetachmentLevel >= 4 ||
    (dailyFocusLevel != null && dailyFocusLevel <= 2) ||
    (dailyAccomplishmentLevel != null && dailyAccomplishmentLevel <= 2)
  ) {
    return 'medium';
  }

  return 'low';
}

function weeklyPriority({
  loggedDays,
  averageSleep,
  averageStress,
  averageDailyDetachment,
  averageDailyFocus,
  averageDailyAccomplishment,
  weeklyPulse,
  latestBurnoutScore,
  latestBurnoutRisk
}) {
  const weeklyDetachment = toNullableInteger(weeklyPulse?.detachment_level);
  const weeklyFocus = toNullableInteger(weeklyPulse?.productivity_focus_level);
  const weeklyAccomplishment =
    toNullableInteger(weeklyPulse?.accomplishment_level);

  if (
    latestBurnoutScore >= 70 ||
    ['high', 'severe'].includes(String(latestBurnoutRisk ?? '').toLowerCase()) ||
    averageStress >= 4.5 ||
    averageDailyDetachment >= 4.5 ||
    weeklyDetachment >= 5 ||
    (averageDailyFocus > 0 && averageDailyFocus <= 1.5) ||
    (averageDailyAccomplishment > 0 && averageDailyAccomplishment <= 1.5) ||
    (weeklyFocus != null && weeklyFocus <= 1) ||
    (weeklyAccomplishment != null && weeklyAccomplishment <= 1)
  ) {
    return 'high';
  }

  if (
    (averageSleep > 0 && averageSleep < 6) ||
    averageStress >= 4 ||
    averageDailyDetachment >= 4 ||
    weeklyDetachment >= 4 ||
    (averageDailyFocus > 0 && averageDailyFocus <= 2) ||
    (averageDailyAccomplishment > 0 && averageDailyAccomplishment <= 2) ||
    (weeklyFocus != null && weeklyFocus <= 2) ||
    (weeklyAccomplishment != null && weeklyAccomplishment <= 2)
  ) {
    return 'medium';
  }
  if (loggedDays > 0 && loggedDays < 3) {
    return 'medium';
  }

  return 'low';
}

function likertText(value) {
  return value == null || value === 0 ? '--' : value;
}

function dailySummary({
  log,
  activity,
  nutrition,
  burnout,
  sleepHours,
  hydrationLiters,
  stressLevel,
  dailyDetachmentLevel,
  dailyFocusLevel,
  dailyAccomplishmentLevel,
  steps,
  mealCount,
  symptoms,
  habits,
  burnoutScore,
  riskLevel
}) {
  if (burnout) {
    return `Burnout risk is ${riskLevel} at ${burnoutScore}/100. Yesterday's check-in shows sleep ${sleepHours || '--'}h, stress ${stressLevel || '--'}/5, detachment ${likertText(dailyDetachmentLevel)}/5, focus ${likertText(dailyFocusLevel)}/5, and accomplishment ${likertText(dailyAccomplishmentLevel)}/5.`;
  }

  if (log) {
    const symptomText = symptoms.length > 0
      ? `${symptoms.length} symptom signal${symptoms.length === 1 ? '' : 's'}`
      : 'no symptom signals';
    const habitText = habits.length > 0
      ? `${habits.length} recovery habit${habits.length === 1 ? '' : 's'}`
      : 'no recovery habits logged';
    return `Yesterday's log shows ${sleepHours}h sleep, stress ${stressLevel || '--'}/5, detachment ${likertText(dailyDetachmentLevel)}/5, focus ${likertText(dailyFocusLevel)}/5, ${symptomText}, and ${habitText}.`;
  }

  if (activity || nutrition) {
    return `Yesterday's tracked data shows ${steps.toLocaleString()} steps and ${mealCount} logged meal${mealCount === 1 ? '' : 's'}. Add a daily check-in to complete the burnout report.`;
  }

  return 'A daily wellness snapshot is available from yesterday\'s tracked data.';
}

function weeklySummary({
  loggedDays,
  averageSleep,
  averageHydration,
  averageStress,
  averageDailyDetachment,
  averageDailyFocus,
  averageDailyAccomplishment,
  exerciseDays,
  totalSteps,
  mealLoggedDays,
  latestBurnoutScore,
  latestBurnoutRisk,
  weeklyPulse
}) {
  const burnoutText = latestBurnoutScore == null
    ? 'No burnout score trend is available yet'
    : `Latest burnout risk is ${latestBurnoutRisk} at ${latestBurnoutScore}/100`;
  const pulseText = weeklyPulse
    ? 'weekly pulse is complete'
    : 'weekly pulse is still pending';

  return `${burnoutText}. This week has ${loggedDays}/7 daily logs, ${averageSleep || '--'}h average sleep, stress ${averageStress || '--'}/5, daily detachment ${likertText(averageDailyDetachment)}/5, focus ${likertText(averageDailyFocus)}/5, accomplishment ${likertText(averageDailyAccomplishment)}/5, ${exerciseDays} movement day${exerciseDays === 1 ? '' : 's'}, and ${pulseText}.`;
}
