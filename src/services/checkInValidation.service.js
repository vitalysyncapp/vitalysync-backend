const ALLOWED_WORKLOAD_HOURS_BANDS = new Set([
  'None',
  '1-2 hours',
  '3-4 hours',
  '5-6 hours',
  '6-7 hours',
  '8-9 hours',
  '10-12 hours'
]);

function validationError(message, code = 'INVALID_CHECK_IN') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function normalizeInteger(value, minimum, maximum, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw validationError(`Valid ${fieldName} is required`);
  }
  return parsed;
}

function normalizeNumber(value, minimum, maximum, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw validationError(`Valid ${fieldName} is required`);
  }
  return parsed;
}

function normalizeSelections(value, fieldName) {
  if (!Array.isArray(value)) {
    throw validationError(`At least one ${fieldName} selection is required`);
  }

  const selections = [...new Set(
    value.map((item) => String(item).trim()).filter((item) => item.length > 0)
  )];
  if (selections.length === 0) {
    throw validationError(`At least one ${fieldName} selection is required`);
  }
  if (selections.includes('None') && selections.length > 1) {
    throw validationError(
      `None cannot be combined with another ${fieldName} selection`
    );
  }
  return selections;
}

function normalizeNullableText(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalBoolean(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw validationError('Valid exercise_goal_completed is required');
}

export function normalizeCheckInDate(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw validationError('Valid log_date is required', 'INVALID_LOG_DATE');
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw validationError('Valid log_date is required', 'INVALID_LOG_DATE');
  }
  return normalized;
}

export function normalizeDailyCheckIn(payload) {
  const daily = payload?.daily;
  if (!daily || typeof daily !== 'object' || Array.isArray(daily)) {
    throw validationError('Daily check-in answers are required');
  }

  const workloadHoursBand = String(daily.workload_hours_band ?? '').trim();
  if (!ALLOWED_WORKLOAD_HOURS_BANDS.has(workloadHoursBand)) {
    throw validationError('Valid workload_hours_band is required');
  }

  return {
    sleep_hours: normalizeNumber(daily.sleep_hours, 0, 24, 'sleep_hours'),
    sleep_quality: normalizeInteger(daily.sleep_quality, 0, 4, 'sleep_quality'),
    mood_index: normalizeInteger(daily.mood_index, 0, 4, 'mood_index'),
    energy_level: normalizeInteger(daily.energy_level, 1, 5, 'energy_level'),
    hydration_liters: normalizeNumber(
      daily.hydration_liters,
      0.01,
      20,
      'hydration_liters'
    ),
    workload_hours_band: workloadHoursBand,
    exercise_names: normalizeSelections(daily.exercise_names, 'exercise'),
    symptom_names: normalizeSelections(daily.symptom_names, 'symptom'),
    habit_names: normalizeSelections(daily.habit_names, 'recovery habit'),
    exercise_goal_name: normalizeNullableText(daily.exercise_goal_name),
    exercise_goal_completed: normalizeOptionalBoolean(
      daily.exercise_goal_completed
    ),
    exercise_goal_source: normalizeNullableText(daily.exercise_goal_source),
    exercise_goal_status: normalizeNullableText(daily.exercise_goal_status)
  };
}

export function normalizeWeeklyCheckIn(payload) {
  const weekly = payload?.weekly;
  if (!weekly || typeof weekly !== 'object' || Array.isArray(weekly)) {
    throw validationError('Weekly pulse answers are required', 'WEEKLY_PULSE_REQUIRED');
  }

  return {
    perceived_pressure_level: normalizeInteger(
      weekly.perceived_pressure_level,
      1,
      5,
      'perceived_pressure_level'
    ),
    recovery_rest_level: normalizeInteger(
      weekly.recovery_rest_level,
      1,
      5,
      'recovery_rest_level'
    ),
    detachment_level: normalizeInteger(
      weekly.detachment_level,
      1,
      5,
      'detachment_level'
    ),
    productivity_focus_level: normalizeInteger(
      weekly.productivity_focus_level,
      1,
      5,
      'productivity_focus_level'
    ),
    accomplishment_level: normalizeInteger(
      weekly.accomplishment_level,
      1,
      5,
      'accomplishment_level'
    )
  };
}
