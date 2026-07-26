const DAY_MS = 24 * 60 * 60 * 1000;

const PERIODS = {
  week: { startDay: 0, endDay: 6, expectedDays: 7 },
  month: { startDay: 0, endDay: 29, expectedDays: 30 },
  previousMonth: { startDay: 30, endDay: 59, expectedDays: 30 },
  year: { startDay: 0, endDay: 364, expectedDays: 365 },
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

function average(rows, field, digits = 1) {
  const values = rows
    .map((row) => row[field])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite);

  if (values.length === 0) return null;

  const result = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(result.toFixed(digits));
}

function wellnessAverages(rows, expectedDays) {
  return {
    sleep: average(rows, 'sleep_hours'),
    mood: average(rows, 'mood_index'),
    energy: average(rows, 'energy_level'),
    stress: average(rows, 'perceived_stress_level'),
    count: rows.length,
    expectedDays,
  };
}

function activityAverages(rows, expectedDays) {
  return {
    steps: average(rows, 'steps', 0),
    activeMinutes: average(rows, 'active_minutes', 0),
    calories: average(rows, 'calories_burned', 0),
    count: rows.length,
    expectedDays,
  };
}

export function buildReportMetrics({
  logs = [],
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
  const activity = {};

  for (const [key, period] of Object.entries(PERIODS)) {
    wellness[key] = wellnessAverages(
      filterPeriod(logs, 'log_date', period, todayUtc),
      period.expectedDays,
    );
    activity[key] = activityAverages(
      filterPeriod(exercises, 'log_date', period, todayUtc),
      period.expectedDays,
    );
  }

  return {
    wellness,
    activity,
    latestBurnout: burnoutHistory[0] ?? null,
  };
}
