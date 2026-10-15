import { BURNOUT_QUESTIONNAIRE_VERSION, WEEKLY_QUESTIONNAIRE_VERSION } from './burnoutQuestionnaire.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const PERIODS = {
  week: { startDay: 0, endDay: 6, expectedDays: 7, expectedPulses: 1 },
  month: { startDay: 0, endDay: 29, expectedDays: 30, expectedPulses: 4 },
  previousMonth: { startDay: 30, endDay: 59, expectedDays: 30, expectedPulses: 4 },
  year: { startDay: 0, endDay: 364, expectedDays: 365, expectedPulses: 52 },
};

function dateOnlyUtc(value) {
  if (value instanceof Date) {
    return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }

  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function filterPeriod(rows, dateField, period, todayUtc) {
  return rows.filter((row) => {
    const rowDate = dateOnlyUtc(row[dateField]);
    if (rowDate == null) return false;

    const daysAgo = Math.floor((todayUtc - rowDate) / DAY_MS);
    return daysAgo >= period.startDay && daysAgo <= period.endDay;
  });
}

function average(rows, field, digits = 1, transform = (value) => value) {
  const values = rows
    .map((row) => row[field])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite)
    .map(transform);

  if (values.length === 0) return null;

  const result = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(result.toFixed(digits));
}

function averageAcrossLoggedDays(rows, field, digits = 0) {
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, row) => {
    const value = Number(row[field]);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  return Number((total / rows.length).toFixed(digits));
}

function wellnessAverages(rows, expectedDays) {
  const reflectionRows = rows.filter((row) => row.questionnaire_version !== 'daily_core9_v3');
  return {
    sleep: average(rows, 'sleep_hours'),
    mood: average(rows, 'mood_index', 1, (value) => value + 1),
    energy: average(rows, 'energy_level'),
    pressure: average(reflectionRows, 'perceived_stress_level'),
    recoveryRest: average(reflectionRows, 'break_quality_level'),
    detachment: average(reflectionRows, 'daily_detachment_level'),
    focus: average(reflectionRows, 'daily_focus_level'),
    accomplishment: average(reflectionRows, 'daily_accomplishment_level'),
    count: rows.length,
    expectedDays,
  };
}

function pulseAverages(rows, expectedPulses) {
  return {
    pressure: average(rows, 'perceived_pressure_level'),
    recoveryRest: average(rows, 'recovery_rest_level'),
    detachment: average(rows, 'detachment_level'),
    productivityFocus: average(rows, 'productivity_focus_level'),
    accomplishment: average(rows, 'accomplishment_level'),
    count: rows.length,
    expectedPulses,
  };
}

function activityAverages(rows, expectedDays) {
  return {
    steps: average(rows, 'steps', 0),
    activeMinutes: average(rows, 'active_minutes', 0),
    calories: averageAcrossLoggedDays(rows, 'calories_burned'),
    count: rows.length,
    expectedDays,
  };
}

export function buildReportMetrics({
  logs = [],
  weeklyPulses = [],
  weeklyAssessments = [],
  exercises = [],
  burnoutHistory = [],
  now = new Date(),
}) {
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  const wellness = {};
  const pulse = {};
  const questionnaire = {};
  const legacyQuestionnaire = {};
  const activity = {};

  for (const [key, period] of Object.entries(PERIODS)) {
    const assessmentRows = filterPeriod(weeklyAssessments, 'response_date', period, todayUtc);
    for (const [version, target] of [[WEEKLY_QUESTIONNAIRE_VERSION, questionnaire],
      [BURNOUT_QUESTIONNAIRE_VERSION, legacyQuestionnaire]]) {
      const versionRows = assessmentRows.filter((row) => row.questionnaire_version === version);
      target[key] = {
        questionnaire_version: version,
        count: versionRows.length,
        expectedPulses: period.expectedPulses,
        ...Object.fromEntries(['emotional_exhaustion', 'depersonalization', 'personal_accomplishment'].map((dimension) => [
          dimension, average(versionRows.map((row) => ({ value: row.scores?.[dimension]?.mean })), 'value', 2)
        ]))
      };
    }
    wellness[key] = wellnessAverages(
      filterPeriod(logs, 'log_date', period, todayUtc),
      period.expectedDays,
    );
    pulse[key] = pulseAverages(
      filterPeriod(weeklyPulses, 'response_date', period, todayUtc),
      period.expectedPulses,
    );
    activity[key] = activityAverages(
      filterPeriod(exercises, 'log_date', period, todayUtc),
      period.expectedDays,
    );
  }

  return {
    wellness,
    pulse,
    questionnaire,
    legacyQuestionnaire,
    latestWeeklyAssessment: weeklyAssessments[0] ?? null,
    activity,
    latestBurnout: burnoutHistory[0] ?? null,
  };
}
