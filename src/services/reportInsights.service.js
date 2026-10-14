const LEVEL_ORDER = {
  unknown: -1,
  good: 0,
  okay: 1,
  warning: 2,
  high: 3,
};

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function status(level) {
  const labels = {
    good: 'Good',
    okay: 'Okay',
    warning: 'Warning',
    high: 'High risk',
    unknown: 'No data',
  };

  return { level, label: labels[level] };
}

export function classifyReportMetric(metric, value) {
  if (metric === 'burnoutRisk') {
    const risk = String(value ?? '').trim().toLowerCase();
    if (risk === 'low') return status('good');
    if (risk === 'moderate') return status('okay');
    if (risk === 'high') return status('high');
    if (risk === 'critical') return status('high');
    return status('unknown');
  }

  const number = numeric(value);
  if (number == null) return status('unknown');

  if (metric === 'burnoutScore') {
    if (number < 34) return status('good');
    if (number < 60) return status('okay');
    return status('high');
  }

  if (metric === 'burnoutDimension') {
    if (number < 34) return status('good');
    if (number < 60) return status('okay');
    if (number < 80) return status('warning');
    return status('high');
  }

  if (metric === 'sleep') {
    if (number >= 7 && number <= 9) return status('good');
    if ((number >= 6 && number < 7) || (number > 9 && number <= 10)) {
      return status('okay');
    }
    if ((number >= 5 && number < 6) || (number > 10 && number <= 11)) {
      return status('warning');
    }
    return status('high');
  }

  if (metric === 'mood') {
    if (number >= 4) return status('good');
    if (number >= 3) return status('okay');
    if (number >= 2) return status('warning');
    return status('high');
  }

  if (metric === 'energy') {
    if (number >= 4) return status('good');
    if (number >= 3) return status('okay');
    if (number >= 2) return status('warning');
    return status('high');
  }

  if (metric === 'stress') {
    if (number <= 2) return status('good');
    if (number <= 3) return status('okay');
    if (number <= 4) return status('warning');
    return status('high');
  }

  if (metric === 'likertHighGood') {
    if (number >= 4) return status('good');
    if (number >= 3) return status('okay');
    if (number >= 2) return status('warning');
    return status('high');
  }

  if (metric === 'steps') {
    if (number >= 8000) return status('good');
    if (number >= 5000) return status('okay');
    if (number >= 2500) return status('warning');
    return status('high');
  }

  if (metric === 'activeMinutes') {
    if (number >= 30) return status('good');
    if (number >= 20) return status('okay');
    if (number >= 10) return status('warning');
    return status('high');
  }

  if (metric === 'coverage') {
    if (number >= 0.8) return { ...status('good'), label: 'Good coverage' };
    if (number >= 0.5) return { ...status('okay'), label: 'Okay coverage' };
    if (number >= 0.25) return { ...status('warning'), label: 'Limited data' };
    return { ...status('high'), label: 'Very limited data' };
  }

  return status('unknown');
}

function format(value, suffix = '') {
  return value == null ? 'N/A' : `${value}${suffix}`;
}

function changeSentence(current, previous, label, { lowerIsBetter = false, suffix = '' } = {}) {
  if (current == null || previous == null) return null;

  const delta = Number((current - previous).toFixed(1));
  if (Math.abs(delta) < 0.1) {
    return `${label} was stable compared with the previous 30 days.`;
  }

  const direction = delta > 0 ? 'increased' : 'decreased';
  const favorable = lowerIsBetter ? delta < 0 : delta > 0;
  return `${label} ${direction} by ${Math.abs(delta)}${suffix} compared with the previous 30 days, a ${favorable ? 'favorable' : 'less favorable'} shift.`;
}

function signal(metric, text, value) {
  return {
    ...classifyReportMetric(metric, value),
    text,
  };
}

function highestLevel(signals) {
  return signals.reduce((highest, item) => {
    return LEVEL_ORDER[item.level] > LEVEL_ORDER[highest] ? item.level : highest;
  }, 'unknown');
}

function burnoutSection(latestBurnout) {
  if (!latestBurnout) {
    return {
      level: 'unknown',
      insight: 'No burnout score is available for the selected reporting period, so a current risk pattern cannot be summarized.',
      signals: [signal('burnoutScore', 'No recent burnout score is available.', null)],
    };
  }

  const overall = numeric(latestBurnout.burnout_score);
  const risk = latestBurnout.status_category ?? 'unknown';
  const dimensions = [
    ['Emotional exhaustion', numeric(latestBurnout.emotional_exhaustion_score)],
    ['Detachment', numeric(latestBurnout.detachment_score)],
    ['Reduced accomplishment', numeric(latestBurnout.reduced_accomplishment_score)],
  ].filter(([, value]) => value != null);
  const highestDimension = [...dimensions].sort((a, b) => b[1] - a[1])[0];
  const signals = [
    signal(
      'burnoutRisk',
      `Latest overall burnout status is ${String(risk).toLowerCase()}${overall == null ? '' : ` at ${overall}/100`}.`,
      risk,
    ),
  ];

  for (const [label, value] of dimensions) {
    signals.push(signal('burnoutDimension', `${label} is ${value}/100.`, value));
  }

  const highestText = highestDimension
    ? ` ${highestDimension[0]} is the highest dimension at ${highestDimension[1]}/100.`
    : '';

  return {
    level: highestLevel(signals),
    insight: `The latest burnout result is ${format(overall, '/100')} with a ${String(risk).toLowerCase()} status.${highestText}`,
    signals,
  };
}

function wellnessSection(wellness) {
  const current = wellness.month;
  const previous = wellness.previousMonth;

  if (!current || current.count === 0) {
    return {
      level: 'unknown',
      insight: 'No short daily logs were recorded in the last 30 days, so recent sleep, mood, and energy patterns cannot be compared.',
      signals: [signal('coverage', 'No wellness logs were recorded in the last 30 days.', null)],
    };
  }

  const signals = [
    signal('sleep', `Sleep averaged ${format(current.sleep, ' hours')} across the last 30 days.`, current.sleep),
    signal('mood', `Mood averaged ${format(current.mood, '/5')} across the last 30 days.`, current.mood),
    signal('energy', `Energy averaged ${format(current.energy, '/5')} across the last 30 days.`, current.energy),
    signal(
      'coverage',
      `${current.count} of ${current.expectedDays} days include a wellness log.`,
      current.count / current.expectedDays,
    ),
  ];
  const comparisons = [
    changeSentence(current.sleep, previous?.sleep, 'Sleep', { suffix: ' hours' }),
  ].filter(Boolean);
  const comparisonText = comparisons.length > 0 ? ` ${comparisons.join(' ')}` : '';

  return {
    level: highestLevel(signals.slice(0, 3)),
    insight: `Across ${current.count} short daily logs, the 30-day averages are ${format(current.sleep, ' hours')} of sleep, ${format(current.mood, '/5')} mood, and ${format(current.energy, '/5')} energy.${comparisonText}`,
    signals,
  };
}

function pulseSection(pulse) {
  const current = pulse.month;
  if (!current || current.count === 0) {
    return {
      level: 'unknown',
      insight: 'No weekly pulse was recorded in the last 30 days, so pressure, recovery, detachment, focus, and accomplishment context is unavailable.',
      signals: [signal('coverage', 'No weekly pulse was recorded in the last 30 days.', null)],
    };
  }

  const signals = [
    signal('stress', `Pressure averaged ${format(current.pressure, '/5')} across recent weekly pulses.`, current.pressure),
    signal('likertHighGood', `Recovery and rest averaged ${format(current.recoveryRest, '/5')}.`, current.recoveryRest),
    signal('stress', `Detachment averaged ${format(current.detachment, '/5')}.`, current.detachment),
    signal('likertHighGood', `Focus averaged ${format(current.productivityFocus, '/5')}.`, current.productivityFocus),
    signal('likertHighGood', `Accomplishment averaged ${format(current.accomplishment, '/5')}.`, current.accomplishment),
    signal(
      'coverage',
      `${current.count} of ${current.expectedPulses} expected weekly pulses are available.`,
      current.count / current.expectedPulses,
    ),
  ];

  return {
    level: highestLevel(signals.slice(0, 5)),
    insight: `Across ${current.count} weekly pulse${current.count === 1 ? '' : 's'}, pressure averaged ${format(current.pressure, '/5')}, recovery ${format(current.recoveryRest, '/5')}, detachment ${format(current.detachment, '/5')}, focus ${format(current.productivityFocus, '/5')}, and accomplishment ${format(current.accomplishment, '/5')}.`,
    signals,
  };
}

function activitySection(activity) {
  const current = activity.month;
  const previous = activity.previousMonth;

  if (!current || current.count === 0) {
    return {
      level: 'unknown',
      insight: 'No activity logs were recorded in the last 30 days, so recent movement patterns cannot be compared.',
      signals: [signal('coverage', 'No activity logs were recorded in the last 30 days.', null)],
    };
  }

  const signals = [
    signal('steps', `Daily steps averaged ${format(current.steps)} in the last 30 days.`, current.steps),
    signal('activeMinutes', `Active time averaged ${format(current.activeMinutes, ' minutes per day')}.`, current.activeMinutes),
    signal(
      'coverage',
      `${current.count} of ${current.expectedDays} days include an activity log.`,
      current.count / current.expectedDays,
    ),
  ];
  const comparisons = [
    changeSentence(current.steps, previous?.steps, 'Daily steps'),
    changeSentence(current.activeMinutes, previous?.activeMinutes, 'Active time', { suffix: ' minutes' }),
  ].filter(Boolean);
  const comparisonText = comparisons.length > 0 ? ` ${comparisons.join(' ')}` : '';

  return {
    level: highestLevel(signals.slice(0, 2)),
    insight: `Across ${current.count} logged days, activity averaged ${format(current.steps, ' steps')}, ${format(current.activeMinutes, ' active minutes')}, and ${format(current.calories, ' calories')} per day.${comparisonText}`,
    signals,
  };
}

function recommendationsFor(sections, metrics) {
  const recommendations = [];
  const month = metrics.wellness.month;
  const pulseMonth = metrics.pulse.month;
  const activityMonth = metrics.activity.month;

  if (sections.burnout.level === 'high' || sections.burnout.level === 'warning') {
    recommendations.push('Protect recovery time this week by reducing nonessential load, adding regular breaks, and checking in with a trusted person or qualified professional if concerns persist.');
  }
  if (classifyReportMetric('sleep', month?.sleep).level === 'warning' || classifyReportMetric('sleep', month?.sleep).level === 'high') {
    recommendations.push('Choose one realistic sleep routine to repeat consistently, such as a regular wind-down time or a steadier wake time.');
  }
  if (classifyReportMetric('stress', pulseMonth?.pressure).level === 'warning' || classifyReportMetric('stress', pulseMonth?.pressure).level === 'high') {
    recommendations.push('Plan short recovery pauses around the most demanding part of the week and compare pressure at the next weekly pulse.');
  }
  if (classifyReportMetric('activeMinutes', activityMonth?.activeMinutes).level === 'warning' || classifyReportMetric('activeMinutes', activityMonth?.activeMinutes).level === 'high') {
    recommendations.push('Add a manageable block of movement to a routine you already have, then increase it gradually if it feels sustainable.');
  }
  if ((month?.count ?? 0) < 8 || (activityMonth?.count ?? 0) < 8 || (pulseMonth?.count ?? 0) < 2) {
    recommendations.push('Keep short daily logs and weekly pulses consistent so future comparisons are based on a clearer pattern.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Keep the routines that support your current pattern and continue logging so changes are easier to notice early.');
    recommendations.push('Review the next 30-day report for meaningful shifts in daily signals, weekly context, and activity rather than reacting to one entry.');
  }

  return recommendations.slice(0, 3);
}

export function buildReportInsights(metrics) {
  const sections = {
    burnout: burnoutSection(metrics.latestBurnout),
    wellness: wellnessSection(metrics.wellness),
    pulse: pulseSection(metrics.pulse),
    activity: activitySection(metrics.activity),
  };
  const overallLevel = highestLevel(Object.values(sections));
  const summaries = {
    good: 'mostly supportive signals',
    okay: 'generally steady signals',
    warning: 'some warning signals worth watching',
    high: 'high-risk signals that deserve prompt attention',
  };
  const overview = overallLevel === 'unknown'
    ? 'There is not enough recent data to summarize a reliable wellness pattern.'
    : `The current report contains ${summaries[overallLevel]}. Review the section-level indicators for the specific values behind this summary.`;

  return {
    overview,
    overallLevel,
    sections,
    recommendations: recommendationsFor(sections, metrics),
  };
}
