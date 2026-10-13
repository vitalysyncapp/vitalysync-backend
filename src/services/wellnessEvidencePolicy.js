// Sources support the actions, not the app's personalized trigger thresholds.
export const WELLNESS_POLICY_VERSION = 'cbi-wellness-1.0.0';
export const EVIDENCE_REGISTER = Object.freeze({
  REC01: { source: 'SLEEP01', url: 'https://aasm.org/resources/pdf/adultsleepdurationconsensus.pdf',
    population: 'Adults 18–60', inputs: ['age', 'sleep_hours', 'log_date', 'goals'],
    trigger: 'At least 3 sleep observations in 7 days and mean below 7 hours, or an explicit sleep goal.',
    limitations: 'No sleep-disorder inference or upper-duration penalty. Missing days are absent.',
    fallback: 'Choose one manageable adjustment to make time for sleep tonight.' },
  REC02: { source: 'MOVE01', url: 'https://www.who.int/publications/i/item/9789240015128',
    population: 'Adults; adapted to ability and recovery', inputs: ['goals', 'steps', 'energy_level', 'sleep_hours', 'sleep_quality'],
    trigger: 'Current recorded steps below a positive user-selected step goal; apply recovery safeguards first.',
    limitations: 'Steps are not intensity minutes. A missing record is not inactivity. No strenuous suggestion without recovery evidence.',
    fallback: 'If comfortable, try a short, easy movement break.' },
  REC03: { source: 'STRESS01', url: 'https://www.who.int/publications/i/item/9789240003927',
    population: 'Adults', inputs: ['context1', 'context2', 'completed_at', 'goals'],
    trigger: 'Individual context1 >= 4 or context2 <= 2 within 30 days, or explicit stress-management goal.',
    limitations: 'Operational selection rule, not a clinical threshold or treatment claim.',
    fallback: 'Try a brief grounding pause, noticing your surroundings before your next task.' },
  REC04: { source: 'STRESS01', url: 'https://www.who.int/publications/i/item/9789240003927',
    population: 'Adults', inputs: ['context4', 'completed_at'],
    trigger: 'Individual context4 <= 2 within 30 days.',
    limitations: 'Practical-support wording is a project choice for professional review. Never assume support is safe or available.',
    fallback: 'If there is someone you trust, consider asking for help with one specific responsibility.' },
  REC05: { source: 'USER_RECORD_AND_GOAL', url: null,
    population: 'Adults', inputs: ['hydration_liters', 'log_date', 'goals'],
    trigger: 'Current hydration record and explicit hydration goal.',
    limitations: 'Describes records only; no dehydration inference or prescribed intake.',
    fallback: 'Review your hydration record against the goal you chose.' }
});

export function numericObservation(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function summarizeObservations(rows, field) {
  const byDate = new Map();
  for (const row of rows) {
    const value = numericObservation(row[field]);
    if (value != null) byDate.set(String(row.log_date).slice(0, 10), value);
  }
  const values = [...byDate.values()];
  return {
    mean: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : null,
    recorded_days: values.length
  };
}

export function compareRecordedWeeks(current, previous) {
  return {
    current, previous,
    delta: current.recorded_days >= 3 && previous.recorded_days >= 3
      ? Number((current.mean - previous.mean).toFixed(1)) : null,
    rule: 'At least 3 observations in each 7-day window; operational display rule.'
  };
}

const anchors = ['Never/almost never', 'Seldom', 'Sometimes', 'Often', 'Always'];
export function selectWellnessRecommendations({ age, goals = [], logs = [], activity = [], assessment, endDate }) {
  if (numericObservation(age) == null || Number(age) < 18) return [];
  const explicit = goals.filter((goal) => goal.source === 'user' || goal.source === 'onboarding');
  const goalText = explicit.map((goal) => goal.target_text ?? '').join(' ').toLowerCase();
  const hasGoal = (type) => explicit.some((goal) => goal.goal_type === type);
  const sleepGoal = hasGoal('sleep_hours') || /sleep/.test(goalText);
  const stressGoal = /stress|burnout/.test(goalText);
  const today = logs.find((row) => row.log_date === endDate);
  const movement = activity.find((row) => row.log_date === endDate);
  const sleep = summarizeObservations(logs, 'sleep_hours');
  const ageDays = assessment ? (Date.parse(endDate + 'T23:59:59Z') - Date.parse(assessment.completed_at)) / 86400000 : Infinity;
  const context = ageDays >= 0 && ageDays < 31 ? assessment?.context ?? {} : {};
  const assessmentDate = assessment?.completed_at?.slice(0, 10);
  const candidates = [];
  function add(id, focus, title, observation, action, rank) {
    const evidence = EVIDENCE_REGISTER[id];
    candidates.push({
      nudge_type: `${WELLNESS_POLICY_VERSION}:${id}`, priority: 'low', title,
      message: action, action_label: 'View suggestion', trigger_reason: observation,
      recommended_focus: focus, severity: 'wellness', nudge_event_id: null,
      metadata: { policy_version: WELLNESS_POLICY_VERSION, recommendation_id: id,
        source_ids: [evidence.source], evidence, observation, approved_action: action,
        approved_messages: [action], selection_rank: rank, recommended_focus: focus,
        ai_enhanced: false }
    });
  }
  if ((age <= 60 && sleep.recorded_days >= 3 && sleep.mean < 7) || sleepGoal) {
    const observation = age <= 60 && sleep.recorded_days >= 3 && sleep.mean < 7
      ? `You recorded an average of ${sleep.mean} hours of sleep across ${sleep.recorded_days} days in the 7 days ending ${endDate}.`
      : 'You chose sleep as a goal.';
    add('REC01', 'sleep', 'Make time for sleep', observation, EVIDENCE_REGISTER.REC01.fallback, sleepGoal ? 0 : 2);
  }
  const stepGoal = numericObservation(explicit.find((goal) => goal.goal_type === 'daily_steps')?.target_value);
  const steps = numericObservation(movement?.steps);
  if (stepGoal > 0 && steps != null && steps < stepGoal) {
    const energy = numericObservation(today?.energy_level);
    const hours = numericObservation(today?.sleep_hours);
    const quality = numericObservation(today?.sleep_quality);
    const poorOrUnknownRecovery = energy == null || hours == null || quality == null || energy <= 2 || hours < 6 || quality <= 1;
    add('REC02', 'movement', 'Choose comfortable movement',
      `Your record shows ${steps} steps toward your chosen goal of ${stepGoal} on ${endDate}.${poorOrUnknownRecovery ? ' Recovery is low or not fully recorded.' : ''}`,
      poorOrUnknownRecovery ? 'Choose rest or comfortable gentle movement, according to how you feel.' : EVIDENCE_REGISTER.REC02.fallback, 0);
  }
  if (context.context1 >= 4 || context.context2 <= 2 || stressGoal) {
    const observation = context.context1 >= 4
      ? `On ${assessmentDate}, you answered “${anchors[context.context1 - 1]}” to daily responsibilities feeling unmanageable.`
      : context.context2 <= 2
        ? `On ${assessmentDate}, you answered “${anchors[context.context2 - 1]}” to having time to rest after demanding activities.`
        : 'You chose stress management as a goal.';
    add('REC03', 'stress_management', 'Take a grounding pause', observation, EVIDENCE_REGISTER.REC03.fallback, stressGoal ? 0 : 1);
  }
  if (context.context4 <= 2) {
    add('REC04', 'support', 'Ask for practical support',
      `On ${assessmentDate}, you answered “${anchors[context.context4 - 1]}” to getting support when responsibilities feel difficult.`,
      EVIDENCE_REGISTER.REC04.fallback, 1);
  }
  const hydration = numericObservation(today?.hydration_liters);
  const hydrationGoal = numericObservation(explicit.find((goal) => goal.goal_type === 'hydration_liters')?.target_value);
  if (hydration != null && hydrationGoal > 0) {
    add('REC05', 'hydration', 'Review your hydration record',
      `You logged ${hydration} L on ${endDate}; your chosen goal is ${hydrationGoal} L.`, EVIDENCE_REGISTER.REC05.fallback, 0);
  }
  return candidates.sort((a, b) => a.metadata.selection_rank - b.metadata.selection_rank || a.nudge_type.localeCompare(b.nudge_type));
}
