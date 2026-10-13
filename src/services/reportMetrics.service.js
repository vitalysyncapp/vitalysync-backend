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

function observationCount(rows, field) {
  return rows.filter((row) => row[field] != null && row[field] !== '' && Number.isFinite(Number(row[field]))).length;
}

function wellnessAverages(rows, expectedDays) {
  return {
    sleep: average(rows, 'sleep_hours'),
    sleepDays: observationCount(rows, 'sleep_hours'),
    moodDays: observationCount(rows, 'mood_index'),
    energyDays: observationCount(rows, 'energy_level'),
    mood: average(rows, 'mood_index', 1, (value) => value + 1),
    energy: average(rows, 'energy_level'),
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
    stepsDays: observationCount(rows, 'steps'),
    activeMinutesDays: observationCount(rows, 'active_minutes'),
    caloriesDays: observationCount(rows, 'calories_burned'),
    activeMinutes: average(rows, 'active_minutes', 0),
    calories: average(rows, 'calories_burned', 0),
    count: rows.length,
    expectedDays,
  };
}

export function buildReportMetrics({
  logs = [],
  weeklyPulses = [],
  exercises = [],
  burnoutHistory = [],
  assessments = [],
  wellnessSummary = null,
  now = new Date(),
}) {
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  const wellness = {};
  const pulse = {};
  const activity = {};

  for (const [key, period] of Object.entries(PERIODS)) {
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
    activity,
    assessments,
    legacyHistory: burnoutHistory,
    wellnessSummary,
    latestBurnout: null,
  };
}
