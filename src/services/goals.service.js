import pool from '../config/db.js';
import {
  calorieGoalMetadata,
  defaultCalorieGoalForProfile,
} from './nutrition.service.js';

export const GOAL_TYPES = [
  'wellness',
  'sleep_hours',
  'hydration_liters',
  'activity_days_per_week',
  'daily_steps',
  'nutrition_calories',
];

const GOAL_TYPE_SET = new Set(GOAL_TYPES);
const RESERVED_GOAL_SOURCES = new Set(['system_default']);

const WELLNESS_GOAL_OPTIONS = [
  'Reduce stress',
  'Improve sleep',
  'Be more active',
  'Improve focus',
  'Build healthier habits',
  'Manage burnout',
];

const WELLNESS_GOAL_OPTION_BY_KEY = new Map(
  WELLNESS_GOAL_OPTIONS.map((goal) => [goal.toLowerCase(), goal])
);

const GOAL_DEFAULTS = {
  wellness: {
    target_value: null,
    target_text: 'Not set',
    unit: null,
  },
  sleep_hours: {
    target_value: 8,
    target_text: null,
    unit: 'hours',
  },
  hydration_liters: {
    target_value: 2.5,
    target_text: null,
    unit: 'L',
  },
  activity_days_per_week: {
    target_value: 3,
    target_text: null,
    unit: 'days/week',
  },
  daily_steps: {
    target_value: 5000,
    target_text: null,
    unit: 'steps',
  },
  nutrition_calories: {
    target_value: 2000,
    target_text: null,
    unit: 'kcal',
  },
};

const GOAL_RANGES = {
  sleep_hours: { min: 1, max: 24 },
  hydration_liters: { min: 0.25, max: 20 },
  activity_days_per_week: { min: 0, max: 7 },
  daily_steps: { min: 1000, max: 50000 },
  nutrition_calories: { min: 800, max: 6000 },
};

export class GoalsServiceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'GoalsServiceError';
    this.statusCode = statusCode;
  }
}

function parseUserId(value) {
  const userId = Number(value);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new GoalsServiceError('Valid user_id is required');
  }

  return userId;
}

function normalizeText(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean);
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  return normalized.split(',').map(normalizeText).filter(Boolean);
}

function normalizeWellnessGoals(value, { rejectInvalid = false } = {}) {
  const selected = new Set();

  for (const goal of normalizeStringList(value)) {
    const canonical = WELLNESS_GOAL_OPTION_BY_KEY.get(goal.toLowerCase());
    if (!canonical) {
      if (rejectInvalid) {
        throw new GoalsServiceError('Invalid wellness goal selection');
      }
      continue;
    }
    selected.add(canonical);
  }

  return WELLNESS_GOAL_OPTIONS.filter((goal) => selected.has(goal));
}

function displayWellnessGoals(goals) {
  return goals.join(', ');
}

function parseNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new GoalsServiceError(`${fieldName} must be a valid number`);
  }

  return parsed;
}

function roundGoalValue(value) {
  return Math.round(value * 100) / 100;
}

function sleepHoursBetween(sleepTime, wakeTime) {
  if (!sleepTime || !wakeTime) {
    return null;
  }

  const sleepParts = String(sleepTime).slice(0, 5).split(':').map(Number);
  const wakeParts = String(wakeTime).slice(0, 5).split(':').map(Number);

  if (
    sleepParts.length !== 2 ||
    wakeParts.length !== 2 ||
    sleepParts.some((part) => !Number.isFinite(part)) ||
    wakeParts.some((part) => !Number.isFinite(part))
  ) {
    return null;
  }

  const sleepTotal = sleepParts[0] * 60 + sleepParts[1];
  let wakeTotal = wakeParts[0] * 60 + wakeParts[1];
  if (wakeTotal <= sleepTotal) {
    wakeTotal += 24 * 60;
  }

  return Math.round(((wakeTotal - sleepTotal) / 60) * 10) / 10;
}

function exerciseGoalDaysToNumber(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  if (text.includes('5+')) {
    return 5;
  }

  const matches = text.match(/\d+/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  return Number(matches[matches.length - 1]);
}

function hydrationGoalFromActivity(activity) {
  const normalized = String(activity ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'sedentary') {
    return 2.0;
  }

  if (normalized.includes('active')) {
    return 3.0;
  }

  return 2.5;
}

function defaultNutritionCaloriesFromProfile(profile, legacyOnboarding) {
  try {
    return defaultCalorieGoalForProfile({
      age: profile?.age,
      gender: profile?.gender,
      height_cm: profile?.height_cm ?? legacyOnboarding?.height_cm,
      weight_kg: profile?.weight_kg ?? legacyOnboarding?.weight_kg,
      bmi: profile?.bmi ?? legacyOnboarding?.bmi,
      lifestyle_type: profile?.lifestyle_type ?? legacyOnboarding?.activity_level,
    });
  } catch {
    return null;
  }
}

function normalizeMetadata(value) {
  if (value == null) {
    return {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new GoalsServiceError('metadata must be an object');
  }

  return value;
}

function normalizeGoal(goalType, rawGoal) {
  if (!GOAL_TYPE_SET.has(goalType)) {
    throw new GoalsServiceError(`Unsupported goal_type: ${goalType}`);
  }

  const requestedSource = normalizeText(rawGoal?.source);
  const source = RESERVED_GOAL_SOURCES.has(requestedSource)
    ? 'user'
    : requestedSource ?? 'user';
  const metadata = { ...normalizeMetadata(rawGoal?.metadata) };

  if (goalType === 'wellness') {
    const explicitText = normalizeText(
      rawGoal?.target_text ?? rawGoal?.targetText ?? rawGoal?.value
    );
    const selectedGoals = normalizeWellnessGoals(
      rawGoal?.wellness_goals ??
        rawGoal?.wellnessGoals ??
        rawGoal?.selected_goals ??
        metadata.selected_goals ??
        explicitText,
      {
        rejectInvalid:
          rawGoal?.wellness_goals != null ||
          rawGoal?.wellnessGoals != null ||
          rawGoal?.selected_goals != null ||
          metadata.selected_goals != null,
      }
    );
    const targetText = selectedGoals.length > 0
      ? displayWellnessGoals(selectedGoals)
      : explicitText;

    if (!targetText) {
      throw new GoalsServiceError('wellness goal text is required');
    }

    if (selectedGoals.length > 0) {
      metadata.selected_goals = selectedGoals;
    }

    return {
      goal_type: goalType,
      target_value: null,
      target_text: targetText,
      unit: normalizeText(rawGoal?.unit),
      source,
      metadata,
    };
  }

  const range = GOAL_RANGES[goalType];
  const targetValue = parseNumber(
    rawGoal?.target_value ?? rawGoal?.targetValue ?? rawGoal?.value,
    goalType
  );

  if (targetValue < range.min || targetValue > range.max) {
    throw new GoalsServiceError(
      `${goalType} must be between ${range.min} and ${range.max}`
    );
  }

  return {
    goal_type: goalType,
    target_value: roundGoalValue(targetValue),
    target_text: normalizeText(rawGoal?.target_text ?? rawGoal?.targetText),
    unit: normalizeText(rawGoal?.unit) ?? GOAL_DEFAULTS[goalType].unit,
    source,
    metadata,
  };
}

export function normalizeGoalsPayload(payload = {}) {
  const rawGoals = payload.goals && typeof payload.goals === 'object'
    ? payload.goals
    : payload;
  const normalized = [];

  for (const [goalType, rawGoal] of Object.entries(rawGoals)) {
    if (['user_id', 'userId'].includes(goalType)) {
      continue;
    }

    if (!GOAL_TYPE_SET.has(goalType)) {
      throw new GoalsServiceError(`Unsupported goal_type: ${goalType}`);
    }

    if (rawGoal == null || rawGoal === '') {
      continue;
    }

    const goal = typeof rawGoal === 'object'
      ? rawGoal
      : { value: rawGoal };
    normalized.push(normalizeGoal(goalType, goal));
  }

  if (normalized.length === 0) {
    throw new GoalsServiceError('At least one goal is required');
  }

  return normalized;
}

function formatGoal(row, fallback) {
  const goalType = row?.goal_type ?? fallback.goal_type;
  const useProfileNutritionDefault =
    goalType === 'nutrition_calories' &&
    row?.source === 'system_default' &&
    fallback.source === 'system_default';
  const targetValue =
    useProfileNutritionDefault || row?.target_value == null
      ? fallback.target_value
      : Number(row.target_value);
  const targetText = useProfileNutritionDefault
    ? fallback.target_text
    : row?.target_text ?? fallback.target_text;
  const unit = useProfileNutritionDefault
    ? fallback.unit
    : row?.unit ?? fallback.unit;
  const metadata = goalType === 'nutrition_calories'
    ? { ...(row?.metadata ?? {}), ...(fallback.metadata ?? {}) }
    : row?.metadata ?? fallback.metadata ?? {};
  const source = useProfileNutritionDefault
    ? fallback.source
    : row?.source ?? fallback.source;

  return {
    goal_type: goalType,
    target_value: targetValue,
    target_text: targetText,
    unit,
    source,
    metadata,
    display_value: displayGoalValue(goalType, targetValue, targetText, unit),
    created_at: row?.created_at ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

function displayGoalValue(goalType, targetValue, targetText, unit) {
  if (goalType === 'wellness') {
    return targetText ?? 'Not set';
  }

  if (targetValue == null) {
    return 'Not set';
  }

  const numeric = Number(targetValue);
  const valueText = Number.isInteger(numeric)
    ? numeric.toLocaleString('en-US')
    : numeric.toLocaleString('en-US', {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      });

  return unit ? `${valueText} ${unit}` : valueText;
}

function buildFallbackGoals({ profile, legacyOnboarding, preferences, latestActivity }) {
  const sleepHours =
    sleepHoursBetween(profile?.usual_sleep_time, profile?.usual_wake_time) ??
    (legacyOnboarding?.sleep_hours == null
      ? GOAL_DEFAULTS.sleep_hours.target_value
      : Number(legacyOnboarding.sleep_hours));
  const hydrationLiters =
    hydrationGoalFromActivity(profile?.lifestyle_type ?? legacyOnboarding?.activity_level) ??
    GOAL_DEFAULTS.hydration_liters.target_value;
  const activityDays =
    exerciseGoalDaysToNumber(profile?.exercise_goal_days) ??
    (legacyOnboarding?.exercise_days_per_week == null
      ? GOAL_DEFAULTS.activity_days_per_week.target_value
      : Number(legacyOnboarding.exercise_days_per_week));
  const dailySteps =
    latestActivity?.goal_steps == null
      ? GOAL_DEFAULTS.daily_steps.target_value
      : Number(latestActivity.goal_steps);
  const profileWellnessGoals = normalizeWellnessGoals(profile?.wellness_goals);
  const preferenceWellnessGoals = normalizeWellnessGoals(
    preferences?.wellness_goals
  );
  const selectedWellnessGoals = profileWellnessGoals.length > 0
    ? profileWellnessGoals
    : preferenceWellnessGoals.length > 0
    ? preferenceWellnessGoals
    : normalizeWellnessGoals(profile?.wellness_goal ?? preferences?.primary_goal);
  const wellnessGoalText = selectedWellnessGoals.length > 0
    ? displayWellnessGoals(selectedWellnessGoals)
    : normalizeText(profile?.wellness_goal) ??
      normalizeText(preferences?.primary_goal) ??
      GOAL_DEFAULTS.wellness.target_text;
  const defaultNutritionCalories = defaultNutritionCaloriesFromProfile(
    profile,
    legacyOnboarding
  );
  const nutritionMetadata = defaultNutritionCalories == null
    ? {}
    : calorieGoalMetadata(defaultNutritionCalories);

  return {
    wellness: {
      goal_type: 'wellness',
      ...GOAL_DEFAULTS.wellness,
      target_text: wellnessGoalText,
      source: 'derived',
      metadata: { selected_goals: selectedWellnessGoals },
    },
    sleep_hours: {
      goal_type: 'sleep_hours',
      ...GOAL_DEFAULTS.sleep_hours,
      target_value: sleepHours,
      source: 'derived',
      metadata: {},
    },
    hydration_liters: {
      goal_type: 'hydration_liters',
      ...GOAL_DEFAULTS.hydration_liters,
      target_value: hydrationLiters,
      source: 'derived',
      metadata: {},
    },
    activity_days_per_week: {
      goal_type: 'activity_days_per_week',
      ...GOAL_DEFAULTS.activity_days_per_week,
      target_value: activityDays,
      source: 'derived',
      metadata: {},
    },
    daily_steps: {
      goal_type: 'daily_steps',
      ...GOAL_DEFAULTS.daily_steps,
      target_value: dailySteps,
      source: 'derived',
      metadata: {},
    },
    nutrition_calories: {
      goal_type: 'nutrition_calories',
      ...GOAL_DEFAULTS.nutrition_calories,
      target_value:
        defaultNutritionCalories ?? GOAL_DEFAULTS.nutrition_calories.target_value,
      source: defaultNutritionCalories == null ? 'default' : 'system_default',
      metadata: nutritionMetadata,
    },
  };
}

async function ensureUserExists(client, userId) {
  const result = await client.query(
    'SELECT user_id FROM users WHERE user_id = $1',
    [userId]
  );

  return result.rowCount > 0;
}

async function readGoalContext(client, userId) {
  const profileResult = await client.query(
    `SELECT
       users.age,
       users.gender,
       profile.wellness_goal,
       profile.wellness_goals,
       profile.lifestyle_type,
       profile.exercise_goal_days,
       profile.height_cm,
       profile.weight_kg,
       profile.bmi,
       to_char(profile.usual_sleep_time, 'HH24:MI') AS usual_sleep_time,
       to_char(profile.usual_wake_time, 'HH24:MI') AS usual_wake_time
     FROM users
     LEFT JOIN user_onboarding_profiles profile
       ON profile.user_id = users.user_id
     WHERE users.user_id = $1`,
    [userId]
  );
  const legacyOnboardingResult = await client.query(
    `SELECT
       sleep_hours,
       exercise_days_per_week,
       activity_level,
       height_cm,
       weight_kg,
       bmi
     FROM user_onboarding
     WHERE user_id = $1`,
    [userId]
  );
  const preferencesResult = await client.query(
    `SELECT primary_goal, wellness_goals
     FROM user_preferences
     WHERE user_id = $1`,
    [userId]
  );
  const latestActivityResult = await client.query(
    `SELECT goal_steps
     FROM daily_activity_logs
     WHERE user_id = $1
     ORDER BY log_date DESC
     LIMIT 1`,
    [userId]
  );

  return {
    profile: profileResult.rows[0] ?? null,
    legacyOnboarding: legacyOnboardingResult.rows[0] ?? null,
    preferences: preferencesResult.rows[0] ?? null,
    latestActivity: latestActivityResult.rows[0] ?? null,
  };
}

export async function getUserGoals(userIdValue) {
  const userId = parseUserId(userIdValue);

  const client = await pool.connect();
  try {
    if (!(await ensureUserExists(client, userId))) {
      return null;
    }

    const context = await readGoalContext(client, userId);
    const fallbackGoals = buildFallbackGoals(context);
    const goalsResult = await client.query(
      `SELECT
         goal_id,
         user_id,
         goal_type,
         target_value,
         target_text,
         unit,
         source,
         metadata,
         created_at,
         updated_at
       FROM user_goals
       WHERE user_id = $1`,
      [userId]
    );
    const savedGoals = new Map(
      goalsResult.rows.map((row) => [row.goal_type, row])
    );
    const goals = {};

    for (const goalType of GOAL_TYPES) {
      goals[goalType] = formatGoal(
        savedGoals.get(goalType),
        fallbackGoals[goalType]
      );
    }

    return {
      user_id: userId,
      goals,
    };
  } finally {
    client.release();
  }
}

function wellnessGoalsForGoal(goal) {
  const metadataGoals = normalizeWellnessGoals(goal.metadata?.selected_goals);
  if (metadataGoals.length > 0) {
    return metadataGoals;
  }

  return normalizeWellnessGoals(goal.target_text);
}

async function syncWellnessGoalContext(client, userId, goal) {
  const selectedGoals = wellnessGoalsForGoal(goal);
  const wellnessGoal = selectedGoals.length > 0
    ? displayWellnessGoals(selectedGoals)
    : goal.target_text;

  await client.query(
    `UPDATE users
     SET wellness_goal = $2,
         wellness_goals = $3
     WHERE user_id = $1`,
    [userId, wellnessGoal, selectedGoals]
  );

  await client.query(
    `UPDATE user_onboarding_profiles
     SET wellness_goal = $2,
         wellness_goals = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1`,
    [userId, wellnessGoal, selectedGoals]
  );

  await client.query(
    `INSERT INTO user_preferences (
       user_id,
       primary_goal,
       wellness_goals
     )
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id)
     DO UPDATE SET
       primary_goal = EXCLUDED.primary_goal,
       wellness_goals = EXCLUDED.wellness_goals,
       updated_at = NOW()`,
    [userId, wellnessGoal, selectedGoals]
  );

  await client.query(
    `INSERT INTO user_onboarding_answers (
       user_id,
       question_key,
       question_text,
       category,
       answer_value,
       numeric_value,
       is_reverse_scored
     )
     VALUES (
       $1,
       'wellness_goal',
       'Which wellness goals matter most to you?',
       'user_context',
       $2,
       NULL,
       FALSE
     )
     ON CONFLICT (user_id, question_key)
     DO UPDATE SET
       question_text = EXCLUDED.question_text,
       category = EXCLUDED.category,
       answer_value = EXCLUDED.answer_value,
       numeric_value = EXCLUDED.numeric_value,
       is_reverse_scored = EXCLUDED.is_reverse_scored`,
    [userId, wellnessGoal]
  );
}

export async function upsertUserGoals(userIdValue, payload) {
  const userId = parseUserId(userIdValue);
  const goals = normalizeGoalsPayload(payload);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!(await ensureUserExists(client, userId))) {
      throw new GoalsServiceError('User not found', 404);
    }

    for (const goal of goals) {
      await client.query(
        `INSERT INTO user_goals (
           user_id,
           goal_type,
           target_value,
           target_text,
           unit,
           source,
           metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (user_id, goal_type)
         DO UPDATE SET
           target_value = EXCLUDED.target_value,
           target_text = EXCLUDED.target_text,
           unit = EXCLUDED.unit,
           source = EXCLUDED.source,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [
          userId,
          goal.goal_type,
          goal.target_value,
          goal.target_text,
          goal.unit,
          goal.source,
          JSON.stringify(goal.metadata),
        ]
      );

      if (goal.goal_type === 'wellness') {
        await syncWellnessGoalContext(client, userId, goal);
      }
    }

    await client.query('COMMIT');
    return getUserGoals(userId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
