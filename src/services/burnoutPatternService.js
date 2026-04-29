import {
  formatBurnoutScoreRow,
  upsertBurnoutScoresForRange
} from './burnoutScoringService.js';

const PATTERN_WINDOWS = [3, 7, 14, 28];
const MAX_WINDOW_DAYS = Math.max(...PATTERN_WINDOWS);

const DIMENSIONS = [
  {
    key: 'emotional_exhaustion_score',
    label: 'Emotional exhaustion',
    focus: 'exhaustion'
  },
  {
    key: 'detachment_score',
    label: 'Detachment',
    focus: 'connection'
  },
  {
    key: 'reduced_accomplishment_score',
    label: 'Reduced accomplishment',
    focus: 'progress'
  },
  {
    key: 'workload_strain_score',
    label: 'Workload strain',
    focus: 'workload'
  },
  {
    key: 'recovery_deficit_score',
    label: 'Recovery deficit',
    focus: 'recovery'
  }
];

function roundTwo(value) {
  return Math.round(value * 100) / 100;
}

function formatDateOnly(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value ?? '').slice(0, 10);
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

function daysBetween(startDate, endDate) {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

function toNumberOrNull(value) {
  if (value == null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values) {
  const validValues = values.filter((value) => Number.isFinite(value));
  if (validValues.length === 0) {
    return null;
  }

  return roundTwo(
    validValues.reduce((sum, value) => sum + value, 0) / validValues.length
  );
}

function min(values) {
  const validValues = values.filter((value) => Number.isFinite(value));
  return validValues.length === 0 ? null : Math.min(...validValues);
}

function max(values) {
  const validValues = values.filter((value) => Number.isFinite(value));
  return validValues.length === 0 ? null : Math.max(...validValues);
}

function slope(points) {
  if (points.length < 2) {
    return null;
  }

  const meanX = average(points.map((point) => point.x));
  const meanY = average(points.map((point) => point.y));
  const numerator = points.reduce(
    (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
    0
  );
  const denominator = points.reduce(
    (sum, point) => sum + ((point.x - meanX) ** 2),
    0
  );

  if (denominator === 0) {
    return null;
  }

  return roundTwo(numerator / denominator);
}

function averageAbsoluteDelta(scores) {
  if (scores.length < 2) {
    return 0;
  }

  const deltas = [];
  for (let index = 1; index < scores.length; index += 1) {
    deltas.push(
      Math.abs(scores[index].overall_score - scores[index - 1].overall_score)
    );
  }

  return average(deltas) ?? 0;
}

function trendDirection(delta, slopePerDay) {
  if (!Number.isFinite(delta) || !Number.isFinite(slopePerDay)) {
    return 'insufficient_data';
  }

  if (delta >= 6 || slopePerDay >= 1) {
    return 'rising';
  }

  if (delta <= -6 || slopePerDay <= -1) {
    return 'falling';
  }

  return 'stable';
}

function riskLevelForScore(score) {
  if (!Number.isFinite(score)) {
    return 'unknown';
  }
  if (score < 34) {
    return 'low';
  }
  if (score < 60) {
    return 'moderate';
  }
  if (score < 80) {
    return 'high';
  }

  return 'critical';
}

function summarizeDimensions(scores) {
  const averages = {};
  const deltas = {};

  for (const dimension of DIMENSIONS) {
    const values = scores
      .map((score) => toNumberOrNull(score[dimension.key]))
      .filter((value) => Number.isFinite(value));
    averages[dimension.key] = average(values);

    if (scores.length >= 2) {
      const first = toNumberOrNull(scores[0][dimension.key]);
      const latest = toNumberOrNull(scores[scores.length - 1][dimension.key]);
      deltas[dimension.key] = Number.isFinite(first) && Number.isFinite(latest)
        ? roundTwo(latest - first)
        : null;
    } else {
      deltas[dimension.key] = null;
    }
  }

  const dominant = DIMENSIONS
    .map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      focus: dimension.focus,
      average_score: averages[dimension.key]
    }))
    .filter((dimension) => Number.isFinite(dimension.average_score))
    .sort((a, b) => b.average_score - a.average_score)[0] ?? null;

  return {
    averages,
    deltas,
    dominant
  };
}

function scoreDateInRange(score, startDate, endDate) {
  return score.score_date >= startDate && score.score_date <= endDate;
}

function summarizeWindow(scores, days, endDate) {
  const startDate = addDays(endDate, -(days - 1));
  const previousStartDate = addDays(startDate, -days);
  const previousEndDate = addDays(startDate, -1);
  const currentScores = scores
    .filter((score) => scoreDateInRange(score, startDate, endDate))
    .sort((a, b) => a.score_date.localeCompare(b.score_date));
  const previousScores = scores
    .filter((score) => scoreDateInRange(score, previousStartDate, previousEndDate))
    .sort((a, b) => a.score_date.localeCompare(b.score_date));
  const overallScores = currentScores.map((score) => score.overall_score);
  const latest = currentScores[currentScores.length - 1] ?? null;
  const first = currentScores[0] ?? null;
  const averageScore = average(overallScores);
  const previousAverageScore = average(
    previousScores.map((score) => score.overall_score)
  );
  const deltaFromStart = latest && first
    ? roundTwo(latest.overall_score - first.overall_score)
    : null;
  const slopePerDay = slope(
    currentScores.map((score) => ({
      x: daysBetween(startDate, score.score_date),
      y: score.overall_score
    }))
  );
  const dimensionSummary = summarizeDimensions(currentScores);

  return {
    window_days: days,
    start_date: startDate,
    end_date: endDate,
    available_days: currentScores.length,
    expected_days: days,
    coverage_percent: roundTwo((currentScores.length / days) * 100),
    average_score: averageScore,
    latest_score: latest?.overall_score ?? null,
    min_score: min(overallScores),
    max_score: max(overallScores),
    delta_from_start: deltaFromStart,
    slope_per_day: slopePerDay,
    trend_direction: trendDirection(deltaFromStart, slopePerDay),
    volatility_score: roundTwo(averageAbsoluteDelta(currentScores)),
    previous_window_average_score: previousAverageScore,
    change_from_previous_window:
      averageScore != null && previousAverageScore != null
        ? roundTwo(averageScore - previousAverageScore)
        : null,
    average_confidence_score: average(
      currentScores.map((score) => score.confidence_score)
    ),
    average_completeness_score: average(
      currentScores.map((score) => score.completeness_score)
    ),
    dimension_averages: dimensionSummary.averages,
    dimension_deltas: dimensionSummary.deltas,
    dominant_dimension: dimensionSummary.dominant,
    risk_level: riskLevelForScore(averageScore),
    points: currentScores.map((score) => ({
      score_date: score.score_date,
      overall_score: score.overall_score,
      risk_level: score.risk_level,
      confidence_score: score.confidence_score
    }))
  };
}

function patternSeverity(score, fallback = 'moderate') {
  if (!Number.isFinite(score)) {
    return fallback;
  }
  if (score >= 80) {
    return 'critical';
  }
  if (score >= 65) {
    return 'high';
  }
  if (score >= 45) {
    return 'moderate';
  }

  return 'low';
}

function buildPattern(type, severity, title, message, evidence, focus) {
  return {
    type,
    severity,
    title,
    message,
    evidence,
    recommended_focus: focus
  };
}

function buildPatterns(windows, latestScore) {
  const patterns = [];
  const window3 = windows['3_day'];
  const window7 = windows['7_day'];
  const window14 = windows['14_day'];
  const window28 = windows['28_day'];

  if (!latestScore || window7.available_days < 3) {
    patterns.push(buildPattern(
      'insufficient_recent_data',
      'low',
      'More recent check-ins needed',
      'VitalySync needs more recent score snapshots before making a strong pattern call.',
      {
        recent_available_days: window7.available_days,
        recent_expected_days: window7.expected_days,
        coverage_percent: window7.coverage_percent
      },
      'data_completion'
    ));
    return patterns;
  }

  if (
    window7.trend_direction === 'rising' &&
    (window7.delta_from_start >= 8 || window7.slope_per_day >= 1.25)
  ) {
    patterns.push(buildPattern(
      'rising_recent_risk',
      patternSeverity(window7.latest_score),
      'Burnout risk is rising',
      'The recent score trend is moving upward fast enough to treat it as a short-term signal.',
      {
        window_days: 7,
        delta_from_start: window7.delta_from_start,
        slope_per_day: window7.slope_per_day,
        latest_score: window7.latest_score
      },
      'early_recovery'
    ));
  }

  if (
    (window14.available_days >= 7 && window14.average_score >= 60) ||
    (window28.available_days >= 10 && window28.average_score >= 60)
  ) {
    patterns.push(buildPattern(
      'sustained_elevated_risk',
      patternSeverity(Math.max(
        window14.average_score ?? 0,
        window28.average_score ?? 0
      )),
      'Risk has stayed elevated',
      'The medium-range average is high, which is more important than a single difficult day.',
      {
        fourteen_day_average: window14.average_score,
        twenty_eight_day_average: window28.average_score,
        fourteen_day_coverage: window14.coverage_percent,
        twenty_eight_day_coverage: window28.coverage_percent
      },
      'load_reduction'
    ));
  }

  if (
    window7.trend_direction === 'falling' &&
    window7.delta_from_start <= -6
  ) {
    patterns.push(buildPattern(
      'improving_recent_recovery',
      'low',
      'Recent recovery is improving',
      'The recent score trend is moving down, which suggests the current routine may be helping.',
      {
        window_days: 7,
        delta_from_start: window7.delta_from_start,
        slope_per_day: window7.slope_per_day
      },
      'maintain_recovery'
    ));
  }

  if (window7.volatility_score >= 12 && window7.available_days >= 4) {
    patterns.push(buildPattern(
      'volatile_recent_pattern',
      'moderate',
      'Risk is fluctuating',
      'Recent scores are moving sharply between days, so the app should avoid overreacting to one entry.',
      {
        window_days: 7,
        volatility_score: window7.volatility_score
      },
      'stabilize_routine'
    ));
  }

  const dominantDimension = window14.dominant_dimension ??
    window7.dominant_dimension;
  if (dominantDimension?.average_score >= 55) {
    patterns.push(buildPattern(
      `dominant_${dominantDimension.focus}`,
      patternSeverity(dominantDimension.average_score),
      `${dominantDimension.label} is the strongest signal`,
      'Among the tracked dimensions, this area is contributing the most to the current pattern.',
      {
        dimension_key: dominantDimension.key,
        dimension_average_score: dominantDimension.average_score,
        window_days: window14.dominant_dimension ? 14 : 7
      },
      dominantDimension.focus
    ));
  }

  if (
    window7.dimension_averages.workload_strain_score >= 55 &&
    window7.dimension_averages.recovery_deficit_score >= 55
  ) {
    patterns.push(buildPattern(
      'workload_recovery_mismatch',
      'high',
      'High load with weak recovery',
      'Workload strain and recovery deficit are both high, which is a strong adaptive nudge trigger.',
      {
        workload_strain_score:
          window7.dimension_averages.workload_strain_score,
        recovery_deficit_score:
          window7.dimension_averages.recovery_deficit_score,
        window_days: 7
      },
      'recovery'
    ));
  }

  if (
    window7.average_confidence_score != null &&
    window7.average_confidence_score < 55
  ) {
    patterns.push(buildPattern(
      'low_confidence_score',
      'low',
      'Score confidence is limited',
      'Several expected fields are missing, so recommendations should stay gentle until more data is available.',
      {
        average_confidence_score: window7.average_confidence_score,
        average_completeness_score: window7.average_completeness_score
      },
      'data_completion'
    ));
  }

  if (patterns.length === 0) {
    patterns.push(buildPattern(
      'stable_current_pattern',
      patternSeverity(window7.average_score, 'low'),
      'Pattern is currently stable',
      'Recent scores are not showing a sharp rise or sustained high-risk pattern.',
      {
        seven_day_average: window7.average_score,
        seven_day_trend: window7.trend_direction,
        latest_score: latestScore.overall_score
      },
      'maintenance'
    ));
  }

  return patterns.slice(0, 5);
}

function buildAdaptiveState(windows, patterns, latestScore) {
  const primaryPattern = patterns[0] ?? null;
  const window7 = windows['7_day'];
  const window14 = windows['14_day'];

  if (!latestScore || primaryPattern?.type === 'insufficient_recent_data') {
    return {
      state: 'insufficient_data',
      label: 'More data needed',
      priority: 'low',
      recommended_focus: 'data_completion',
      confidence_score: window7.average_confidence_score ?? 0,
      reason: 'Recent score coverage is too low for adaptive decisions.'
    };
  }

  if (
    latestScore.risk_level === 'critical' ||
    patterns.some((pattern) => pattern.severity === 'critical')
  ) {
    return {
      state: 'critical',
      label: 'Critical pattern',
      priority: 'urgent',
      recommended_focus: primaryPattern.recommended_focus,
      confidence_score: window7.average_confidence_score ?? 0,
      reason: primaryPattern.title
    };
  }

  if (
    latestScore.risk_level === 'high' ||
    patterns.some((pattern) => pattern.type === 'sustained_elevated_risk')
  ) {
    return {
      state: 'high_risk',
      label: 'High risk pattern',
      priority: 'high',
      recommended_focus: primaryPattern.recommended_focus,
      confidence_score: window7.average_confidence_score ?? 0,
      reason: primaryPattern.title
    };
  }

  if (
    patterns.some((pattern) => pattern.type === 'rising_recent_risk') ||
    window14.average_score >= 50
  ) {
    return {
      state: 'watch',
      label: 'Watch trend',
      priority: 'medium',
      recommended_focus: primaryPattern.recommended_focus,
      confidence_score: window7.average_confidence_score ?? 0,
      reason: primaryPattern.title
    };
  }

  if (patterns.some((pattern) => pattern.type === 'improving_recent_recovery')) {
    return {
      state: 'improving',
      label: 'Improving',
      priority: 'low',
      recommended_focus: 'maintain_recovery',
      confidence_score: window7.average_confidence_score ?? 0,
      reason: 'Recent risk is trending down.'
    };
  }

  return {
    state: 'steady',
    label: 'Stable',
    priority: 'low',
    recommended_focus: 'maintenance',
    confidence_score: window7.average_confidence_score ?? 0,
    reason: 'No escalating pattern detected.'
  };
}

async function loadScoresForPattern(client, userId, endDate) {
  const startDate = addDays(endDate, -(MAX_WINDOW_DAYS * 2 - 1));
  const result = await client.query(
    `SELECT
       burnout_score_id,
       user_id,
       score_date,
       overall_score,
       risk_level,
       emotional_exhaustion_score,
       detachment_score,
       reduced_accomplishment_score,
       workload_strain_score,
       recovery_deficit_score,
       confidence_score,
       completeness_score,
       data_points_count,
       missing_fields,
       contributing_factors,
       source_snapshot,
       scoring_version,
       created_at,
       updated_at
     FROM burnout_score_history
     WHERE user_id = $1
       AND score_date BETWEEN $2 AND $3
     ORDER BY score_date ASC`,
    [userId, startDate, endDate]
  );

  return result.rows.map(formatBurnoutScoreRow);
}

export function analyzeBurnoutPatterns(scores, endDate) {
  const sortedScores = [...scores].sort((a, b) =>
    a.score_date.localeCompare(b.score_date)
  );
  const currentScores = sortedScores.filter((score) =>
    score.score_date <= endDate &&
    score.score_date >= addDays(endDate, -(MAX_WINDOW_DAYS - 1))
  );
  const latestScore = currentScores[currentScores.length - 1] ?? null;
  const windows = {};

  for (const days of PATTERN_WINDOWS) {
    windows[`${days}_day`] = summarizeWindow(sortedScores, days, endDate);
  }

  const patterns = buildPatterns(windows, latestScore);

  return {
    generated_at: new Date().toISOString(),
    end_date: endDate,
    latest_score: latestScore,
    adaptive_state: buildAdaptiveState(windows, patterns, latestScore),
    windows,
    patterns,
    timeline: currentScores.map((score) => ({
      score_date: score.score_date,
      overall_score: score.overall_score,
      risk_level: score.risk_level,
      confidence_score: score.confidence_score
    }))
  };
}

export async function getBurnoutPatternSummary(
  client,
  userId,
  { endDate, refreshScores = true } = {}
) {
  const normalizedEndDate = formatDateOnly(endDate ?? new Date());
  const refreshStartDate = addDays(normalizedEndDate, -(MAX_WINDOW_DAYS - 1));

  if (refreshScores) {
    await upsertBurnoutScoresForRange(
      client,
      userId,
      refreshStartDate,
      normalizedEndDate
    );
  }

  const scores = await loadScoresForPattern(client, userId, normalizedEndDate);
  return analyzeBurnoutPatterns(scores, normalizedEndDate);
}
