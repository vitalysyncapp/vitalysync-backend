const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const BURNOUT_SCORING_VERSION = 'burnout_engine_v4_decay_v1';
export const EXTREME_VOLATILITY_THRESHOLD = 20;
export const BASELINE_REFRESH_GAP_DAYS = 30;

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const normalized = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function daysBetween(startValue, endValue) {
  const start = dateOnly(startValue);
  const end = dateOnly(endValue);
  if (!start || !end) return null;

  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, Math.floor((endMs - startMs) / MS_PER_DAY));
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function selectScoringWindow(loggedDayCount) {
  const count = numberOrZero(loggedDayCount);
  if (count <= 1) return '1_day';
  if (count === 2) return '2_day';
  if (count <= 6) return '3_day';
  if (count <= 13) return '7_day';
  if (count <= 27) return '14_day';
  return '28_day';
}

export function detectStablePattern(evidence = {}) {
  const daysSinceEpochStart = numberOrZero(evidence.daysSinceEpochStart);
  const logsLast14Days = numberOrZero(evidence.logsLast14Days);
  const logsLast28Days = numberOrZero(evidence.logsLast28Days);
  const averageConfidence = Number(evidence.averageConfidence7Day);
  const averageCompleteness = Number(evidence.averageCompleteness7Day);
  const volatility = Number(evidence.volatility7Day);

  return daysSinceEpochStart >= 14 &&
    (logsLast14Days >= 10 || logsLast28Days >= 20) &&
    Number.isFinite(averageConfidence) && averageConfidence >= 70 &&
    Number.isFinite(averageCompleteness) && averageCompleteness >= 70 &&
    Number.isFinite(volatility) && volatility < EXTREME_VOLATILITY_THRESHOLD &&
    evidence.hasAdditionalBehavioralSource === true;
}

export function calculateBaselinePolicy(evidence = {}) {
  const loggedDayCount = Math.max(1, numberOrZero(evidence.loggedDayCount));
  const weeklyPulseCount = numberOrZero(evidence.weeklyPulseCount);
  const stablePatternDetected = detectStablePattern(evidence);
  let baselineWeight;

  if (stablePatternDetected || weeklyPulseCount >= 2) {
    baselineWeight = 0;
  } else if (weeklyPulseCount === 1) {
    baselineWeight = 0.08;
  } else if (loggedDayCount === 1) {
    baselineWeight = 0.35;
  } else if (loggedDayCount === 2) {
    baselineWeight = 0.30;
  } else if (loggedDayCount === 3) {
    baselineWeight = 0.25;
  } else if (loggedDayCount <= 6) {
    baselineWeight = 0.18;
  } else {
    baselineWeight = 0.12;
  }

  return {
    epochStartedAt: dateOnly(evidence.epochStartedAt),
    daysSinceEpochStart: numberOrZero(evidence.daysSinceEpochStart),
    loggedDayCount,
    weeklyPulseCount,
    stablePatternDetected,
    baselineWeight,
    windowUsed: selectScoringWindow(loggedDayCount)
  };
}

export function detectReturnState({
  lastLoggedDate,
  localDate,
  baselineEpochStartedAt
} = {}) {
  const normalizedLastLog = dateOnly(lastLoggedDate);
  const normalizedLocalDate = dateOnly(localDate);
  const normalizedEpochStart = dateOnly(baselineEpochStartedAt);
  const daysSinceLastLog = normalizedLastLog && normalizedLocalDate
    ? daysBetween(normalizedLastLog, normalizedLocalDate)
    : null;
  const refreshedAfterLastLog = normalizedLastLog && normalizedEpochStart
    ? normalizedEpochStart > normalizedLastLog
    : false;
  const daysSinceEpochStart = normalizedEpochStart && normalizedLocalDate
    ? daysBetween(normalizedEpochStart, normalizedLocalDate)
    : null;
  const refreshedBaselineIsCurrent = refreshedAfterLastLog &&
    daysSinceEpochStart != null &&
    daysSinceEpochStart < BASELINE_REFRESH_GAP_DAYS;
  const requiresBaselineRefresh = daysSinceLastLog != null &&
    daysSinceLastLog >= BASELINE_REFRESH_GAP_DAYS &&
    !refreshedBaselineIsCurrent;

  return {
    requires_baseline_refresh: requiresBaselineRefresh,
    baseline_refresh_reason: requiresBaselineRefresh
      ? 'thirty_day_return'
      : null,
    last_logged_date: normalizedLastLog,
    days_since_last_log: daysSinceLastLog
  };
}
