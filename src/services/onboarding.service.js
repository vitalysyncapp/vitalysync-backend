import pool from '../config/db.js';
import {
  calculateBurnoutBaselineScore,
  getLatestBurnoutScore,
  upsertBurnoutScoresForRange
} from './burnoutScoringService.js';
import { addDays, formatDateOnly } from './burnoutScoringEngine.js';
import {
  ensureBaselineEpochForDate,
  startBaselineEpoch
} from './baselineEpochService.js';
import { detectReturnState } from './burnoutEvidencePolicy.js';
import { ensureDefaultNutritionCalorieGoal } from './nutrition.service.js';

const ROLE_OPTIONS = new Set([
  'Student',
  'Working Professional',
  'Freelancer',
  'Unemployed',
  'Other'
]);

const LIFESTYLE_OPTIONS = new Set([
  'Sedentary',
  'Lightly Active',
  'Moderately Active',
  'Active',
  'Very Active'
]);

const WELLNESS_GOAL_OPTIONS = [
  'Reduce stress',
  'Improve sleep',
  'Be more active',
  'Improve focus',
  'Build healthier habits',
  'Manage burnout'
];

const WELLNESS_GOAL_OPTION_BY_KEY = new Map(
  WELLNESS_GOAL_OPTIONS.map((goal) => [goal.toLowerCase(), goal])
);

const EXERCISE_GOAL_OPTIONS = new Set([
  '0 days',
  '1-2 days',
  '1–2 days',
  '3-4 days',
  '3–4 days',
  '5+ days'
]);

const HEIGHT_CM_MIN = 100;
const HEIGHT_CM_MAX = 250;
const WEIGHT_KG_MIN = 20;
const WEIGHT_KG_MAX = 500;

const BURNOUT_QUESTIONS = [
  {
    question_key: 'ee_01',
    question_text: 'I feel emotionally drained by my daily responsibilities.',
    category: 'emotional_exhaustion',
    is_reverse_scored: false
  },
  {
    question_key: 'ee_02',
    question_text: 'I feel tired even before starting my day.',
    category: 'emotional_exhaustion',
    is_reverse_scored: false
  },
  {
    question_key: 'ee_03',
    question_text: 'I feel overwhelmed by my tasks.',
    category: 'emotional_exhaustion',
    is_reverse_scored: false
  },
  {
    question_key: 'ee_04',
    question_text: 'I feel fatigued most of the time.',
    category: 'emotional_exhaustion',
    is_reverse_scored: false
  },
  {
    question_key: 'ee_05',
    question_text: 'I feel I have no energy left at the end of the day.',
    category: 'emotional_exhaustion',
    is_reverse_scored: false
  },
  {
    question_key: 'dp_01',
    question_text: 'I feel detached from my responsibilities.',
    category: 'depersonalization',
    is_reverse_scored: false
  },
  {
    question_key: 'dp_02',
    question_text: 'I have become less interested in things I used to enjoy.',
    category: 'depersonalization',
    is_reverse_scored: false
  },
  {
    question_key: 'dp_03',
    question_text: 'I feel indifferent toward my tasks.',
    category: 'depersonalization',
    is_reverse_scored: false
  },
  {
    question_key: 'dp_04',
    question_text: 'I feel less emotionally connected to others.',
    category: 'depersonalization',
    is_reverse_scored: false
  },
  {
    question_key: 'dp_05',
    question_text: 'I sometimes feel like I’m just going through the motions.',
    category: 'depersonalization',
    is_reverse_scored: false
  },
  {
    question_key: 'pa_01',
    question_text: 'I feel productive in my daily life.',
    category: 'personal_accomplishment',
    is_reverse_scored: true
  },
  {
    question_key: 'pa_02',
    question_text: 'I feel I am achieving meaningful results.',
    category: 'personal_accomplishment',
    is_reverse_scored: true
  },
  {
    question_key: 'pa_03',
    question_text: 'I feel confident handling my responsibilities.',
    category: 'personal_accomplishment',
    is_reverse_scored: true
  },
  {
    question_key: 'pa_04',
    question_text: 'I feel motivated to accomplish my goals.',
    category: 'personal_accomplishment',
    is_reverse_scored: true
  },
  {
    question_key: 'pa_05',
    question_text: 'I feel satisfied with what I achieve each day.',
    category: 'personal_accomplishment',
    is_reverse_scored: true
  }
];

export class OnboardingServiceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'OnboardingServiceError';
    this.statusCode = statusCode;
  }
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

function normalizeWellnessGoals(value) {
  const selected = new Set();

  for (const goal of normalizeStringList(value)) {
    const canonical = WELLNESS_GOAL_OPTION_BY_KEY.get(goal.toLowerCase());
    if (!canonical) {
      throw new OnboardingServiceError('Invalid wellness_goal value');
    }
    selected.add(canonical);
  }

  return WELLNESS_GOAL_OPTIONS.filter((goal) => selected.has(goal));
}

function displayWellnessGoals(goals) {
  return goals.join(', ');
}

function normalizeExerciseGoalDays(value) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  if (normalized === '1-2 days') {
    return '1–2 days';
  }

  if (normalized === '3-4 days') {
    return '3–4 days';
  }

  return normalized;
}

function normalizeTime(value) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(normalized);
  if (!match) {
    return null;
  }

  return `${match[1]}:${match[2]}`;
}

function parseUserId(value) {
  const userId = Number(value);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new OnboardingServiceError('Valid user_id is required');
  }

  return userId;
}

function parseLikert(value, fieldName, { required = true } = {}) {
  if ((value == null || value === '') && !required) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new OnboardingServiceError(`${fieldName} must be from 1 to 5`);
  }

  return parsed;
}

function normalizeDateOnly(value, fieldName) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new OnboardingServiceError(`Valid ${fieldName} is required`);
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new OnboardingServiceError(`Valid ${fieldName} is required`);
  }

  return normalized;
}

function hasMetricValue(value) {
  return value != null && String(value).trim() !== '';
}

function parseBodyMetric(value, fieldName, min, max, { required = true } = {}) {
  if (!hasMetricValue(value)) {
    if (!required) {
      return null;
    }

    throw new OnboardingServiceError(`Valid ${fieldName} is required`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new OnboardingServiceError(`${fieldName} must be numeric`);
  }

  if (parsed < min || parsed > max) {
    throw new OnboardingServiceError(
      `${fieldName} must be between ${min} and ${max}`
    );
  }

  return Math.round(parsed * 100) / 100;
}

export function calculateBmi(heightCm, weightKg) {
  const heightM = Number(heightCm) / 100;
  const bmi = Number(weightKg) / (heightM * heightM);
  return Math.round((bmi + Number.EPSILON * bmi) * 10) / 10;
}

export function normalizeBodyMetrics(source = {}, { required = false } = {}) {
  const hasHeight = hasMetricValue(source?.height_cm);
  const hasWeight = hasMetricValue(source?.weight_kg);

  if (!required && !hasHeight && !hasWeight) {
    return {
      height_cm: null,
      weight_kg: null,
      bmi: null,
      provided: false
    };
  }

  const heightCm = parseBodyMetric(
    source?.height_cm,
    'height_cm',
    HEIGHT_CM_MIN,
    HEIGHT_CM_MAX
  );
  const weightKg = parseBodyMetric(
    source?.weight_kg,
    'weight_kg',
    WEIGHT_KG_MIN,
    WEIGHT_KG_MAX
  );

  return {
    height_cm: heightCm,
    weight_kg: weightKg,
    bmi: calculateBmi(heightCm, weightKg),
    provided: true
  };
}

function parseBoolean(value, fieldName) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new OnboardingServiceError(`${fieldName} must be true or false`);
}

function normalizeProfile(profile = {}) {
  const role = normalizeText(profile.role);
  const lifestyleType = normalizeText(profile.lifestyle_type);
  const structuredWellnessValue =
    profile.wellness_goals ?? profile.wellnessGoals;
  const structuredWellnessGoals =
    structuredWellnessValue == null
      ? []
      : normalizeWellnessGoals(structuredWellnessValue);
  const wellnessGoals = structuredWellnessGoals.length > 0
    ? structuredWellnessGoals
    : normalizeWellnessGoals(profile.wellness_goal);
  const wellnessGoal = displayWellnessGoals(wellnessGoals);
  const usualSleepTime = normalizeTime(profile.usual_sleep_time);
  const usualWakeTime = normalizeTime(profile.usual_wake_time);
  const exerciseGoalDays = normalizeExerciseGoalDays(profile.exercise_goal_days);
  const hasExtraResponsibilities = parseBoolean(
    profile.has_extra_responsibilities,
    'has_extra_responsibilities'
  );
  const extraResponsibilityLevel = hasExtraResponsibilities
    ? parseLikert(profile.extra_responsibility_level, 'extra_responsibility_level')
    : null;
  const { provided: _metricsProvided, ...bodyMetrics } = normalizeBodyMetrics(
    profile,
    { required: true }
  );

  if (!ROLE_OPTIONS.has(role)) {
    throw new OnboardingServiceError('Invalid role value');
  }

  if (!LIFESTYLE_OPTIONS.has(lifestyleType)) {
    throw new OnboardingServiceError('Invalid lifestyle_type value');
  }

  if (wellnessGoals.length === 0) {
    throw new OnboardingServiceError('Invalid wellness_goal value');
  }

  if (!usualSleepTime) {
    throw new OnboardingServiceError('Valid usual_sleep_time is required');
  }

  if (!usualWakeTime) {
    throw new OnboardingServiceError('Valid usual_wake_time is required');
  }

  if (!EXERCISE_GOAL_OPTIONS.has(exerciseGoalDays)) {
    throw new OnboardingServiceError('Invalid exercise_goal_days value');
  }

  return {
    role,
    lifestyle_type: lifestyleType,
    wellness_goal: wellnessGoal,
    wellness_goals: wellnessGoals,
    usual_sleep_time: usualSleepTime,
    usual_wake_time: usualWakeTime,
    exercise_goal_days: exerciseGoalDays,
    workload_level: parseLikert(profile.workload_level, 'workload_level'),
    has_extra_responsibilities: hasExtraResponsibilities,
    extra_responsibility_level: extraResponsibilityLevel,
    ...bodyMetrics
  };
}

function buildBurnoutAnswerRecords(burnoutAnswers) {
  const answerMap = new Map(
    (Array.isArray(burnoutAnswers) ? burnoutAnswers : []).map((answer) => [
      String(answer?.question_key ?? answer?.key ?? '').trim(),
      answer
    ])
  );

  return BURNOUT_QUESTIONS.map((question) => {
    const submittedAnswer = answerMap.get(question.question_key);
    const numericValue = parseLikert(
      submittedAnswer?.numeric_value ?? submittedAnswer?.value,
      question.question_key
    );

    return {
      ...question,
      answer_value: String(numericValue),
      numeric_value: numericValue
    };
  });
}

function buildBodyMetricAnswerRecords(profile) {
  return [
    {
      question_key: 'height_cm',
      question_text: 'What is your height in centimeters?',
      category: 'user_context',
      answer_value: String(profile.height_cm),
      numeric_value: null,
      is_reverse_scored: false
    },
    {
      question_key: 'weight_kg',
      question_text: 'What is your weight in kilograms?',
      category: 'user_context',
      answer_value: String(profile.weight_kg),
      numeric_value: null,
      is_reverse_scored: false
    }
  ];
}

function hasCompleteBodyMetrics(profile) {
  return (
    hasMetricValue(profile?.height_cm) &&
    hasMetricValue(profile?.weight_kg)
  );
}

function buildProfileAnswerRecords(profile) {
  return [
    {
      question_key: 'role',
      question_text: 'What best describes you?',
      category: 'user_context',
      answer_value: profile.role,
      numeric_value: null,
      is_reverse_scored: false
    },
    {
      question_key: 'lifestyle_type',
      question_text: 'How would you describe your lifestyle?',
      category: 'user_context',
      answer_value: profile.lifestyle_type,
      numeric_value: null,
      is_reverse_scored: false
    },
    {
      question_key: 'wellness_goal',
      question_text: 'Which wellness goals matter most to you?',
      category: 'user_context',
      answer_value: profile.wellness_goal,
      numeric_value: null,
      is_reverse_scored: false
    },
    ...buildBodyMetricAnswerRecords(profile),
    {
      question_key: 'usual_sleep_time',
      question_text: 'What time do you usually sleep?',
      category: 'routine_defaults',
      answer_value: profile.usual_sleep_time,
      numeric_value: null,
      is_reverse_scored: false
    },
    {
      question_key: 'usual_wake_time',
      question_text: 'What time do you usually wake up?',
      category: 'routine_defaults',
      answer_value: profile.usual_wake_time,
      numeric_value: null,
      is_reverse_scored: false
    },
    {
      question_key: 'exercise_goal_days',
      question_text: 'How many days per week do you want to exercise?',
      category: 'routine_defaults',
      answer_value: profile.exercise_goal_days,
      numeric_value: null,
      is_reverse_scored: false
    },
    {
      question_key: 'workload_level',
      question_text: 'How heavy is your usual workload?',
      category: 'routine_defaults',
      answer_value: String(profile.workload_level),
      numeric_value: profile.workload_level,
      is_reverse_scored: false
    },
    {
      question_key: 'has_extra_responsibilities',
      question_text:
        'Do you usually have extra responsibilities outside your main role?',
      category: 'routine_defaults',
      answer_value: String(profile.has_extra_responsibilities),
      numeric_value: null,
      is_reverse_scored: false
    },
    {
      question_key: 'extra_responsibility_level',
      question_text: 'How demanding are those extra responsibilities?',
      category: 'routine_defaults',
      answer_value: profile.extra_responsibility_level == null
        ? null
        : String(profile.extra_responsibility_level),
      numeric_value: profile.extra_responsibility_level,
      is_reverse_scored: false
    }
  ];
}

function sleepHoursBetween(sleepTime, wakeTime) {
  const [sleepHour, sleepMinute] = sleepTime.split(':').map(Number);
  const [wakeHour, wakeMinute] = wakeTime.split(':').map(Number);
  const sleepTotal = sleepHour * 60 + sleepMinute;
  let wakeTotal = wakeHour * 60 + wakeMinute;

  if (wakeTotal <= sleepTotal) {
    wakeTotal += 24 * 60;
  }

  return Math.round(((wakeTotal - sleepTotal) / 60) * 10) / 10;
}

function exerciseDaysForLegacy(value) {
  switch (value) {
    case '0 days':
      return 0;
    case '1–2 days':
    case '1-2 days':
      return 2;
    case '3–4 days':
    case '3-4 days':
      return 4;
    case '5+ days':
      return 5;
    default:
      return null;
  }
}

function workloadLevelFromIntensity(value) {
  switch (normalizeText(value)) {
    case 'Low':
      return 2;
    case 'High':
      return 4;
    case 'Medium':
      return 3;
    default:
      return null;
  }
}

function activityLevelForLegacy(lifestyleType) {
  if (lifestyleType === 'Sedentary') {
    return 'Sedentary';
  }

  if (lifestyleType === 'Active' || lifestyleType === 'Very Active') {
    return 'Active';
  }

  return 'Balanced';
}

function toNumberOrNull(value) {
  if (value == null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildAiBaseline(profile) {
  if (!profile) {
    return null;
  }

  return {
    user_context: {
      role: profile.role,
      lifestyle_type: profile.lifestyle_type,
      wellness_goal: profile.wellness_goal,
      wellness_goals: normalizeStringList(profile.wellness_goals),
      usual_sleep_time: profile.usual_sleep_time,
      usual_wake_time: profile.usual_wake_time,
      exercise_goal_days: profile.exercise_goal_days,
      workload_level: profile.workload_level
    },
    burnout_baseline: {
      emotional_exhaustion: toNumberOrNull(profile.emotional_exhaustion_score),
      depersonalization: toNumberOrNull(profile.depersonalization_score),
      personal_accomplishment: toNumberOrNull(profile.personal_accomplishment_score),
      initial_burnout_score: toNumberOrNull(profile.initial_burnout_score),
      initial_burnout_level: profile.initial_burnout_level
    }
  };
}

async function insertAnswerRecords(client, userId, answerRecords) {
  for (const answer of answerRecords) {
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
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, question_key)
       DO UPDATE SET
         question_text = EXCLUDED.question_text,
         category = EXCLUDED.category,
         answer_value = EXCLUDED.answer_value,
         numeric_value = EXCLUDED.numeric_value,
         is_reverse_scored = EXCLUDED.is_reverse_scored`,
      [
        userId,
        answer.question_key,
        answer.question_text,
        answer.category,
        answer.answer_value,
        answer.numeric_value,
        answer.is_reverse_scored
      ]
    );
  }
}

export async function submitRequiredOnboarding(payload) {
  const userId = parseUserId(payload?.user_id);
  const profile = normalizeProfile(payload?.profile);
  const burnoutAnswers = buildBurnoutAnswerRecords(payload?.burnout_answers);
  const scores = calculateBurnoutBaselineScore(burnoutAnswers);
  const answerRecords = [
    ...buildProfileAnswerRecords(profile),
    ...burnoutAnswers
  ];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT user_id, age, gender FROM users WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw new OnboardingServiceError('User not found', 404);
    }

    const profileResult = await client.query(
      `INSERT INTO user_onboarding_profiles (
         user_id,
         role,
         lifestyle_type,
         wellness_goal,
         usual_sleep_time,
         usual_wake_time,
         exercise_goal_days,
         workload_level,
         has_extra_responsibilities,
         extra_responsibility_level,
         emotional_exhaustion_score,
         depersonalization_score,
         personal_accomplishment_score,
         initial_burnout_score,
         initial_burnout_level,
         wellness_goals,
         height_cm,
         weight_kg,
         bmi
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19
       )
       ON CONFLICT (user_id)
       DO UPDATE SET
         role = EXCLUDED.role,
         lifestyle_type = EXCLUDED.lifestyle_type,
         wellness_goal = EXCLUDED.wellness_goal,
         wellness_goals = EXCLUDED.wellness_goals,
         height_cm = EXCLUDED.height_cm,
         weight_kg = EXCLUDED.weight_kg,
         bmi = EXCLUDED.bmi,
         usual_sleep_time = EXCLUDED.usual_sleep_time,
         usual_wake_time = EXCLUDED.usual_wake_time,
         exercise_goal_days = EXCLUDED.exercise_goal_days,
         workload_level = EXCLUDED.workload_level,
         has_extra_responsibilities = EXCLUDED.has_extra_responsibilities,
         extra_responsibility_level = EXCLUDED.extra_responsibility_level,
         emotional_exhaustion_score = EXCLUDED.emotional_exhaustion_score,
         depersonalization_score = EXCLUDED.depersonalization_score,
         personal_accomplishment_score = EXCLUDED.personal_accomplishment_score,
         initial_burnout_score = EXCLUDED.initial_burnout_score,
         initial_burnout_level = EXCLUDED.initial_burnout_level,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        userId,
        profile.role,
        profile.lifestyle_type,
        profile.wellness_goal,
        profile.usual_sleep_time,
        profile.usual_wake_time,
        profile.exercise_goal_days,
        profile.workload_level,
        profile.has_extra_responsibilities,
        profile.extra_responsibility_level,
        scores.emotional_exhaustion_score,
        scores.depersonalization_score,
        scores.personal_accomplishment_score,
        scores.initial_burnout_score,
        scores.initial_burnout_level,
        profile.wellness_goals,
        profile.height_cm,
        profile.weight_kg,
        profile.bmi
      ]
    );

    const savedProfile = profileResult.rows[0];
    const user = userResult.rows[0];

    await ensureBaselineEpochForDate(client, userId, formatDateOnly(new Date()));

    await ensureDefaultNutritionCalorieGoal({
      client,
      userId,
      profile: {
        age: user.age,
        gender: user.gender,
        height_cm: savedProfile.height_cm,
        weight_kg: savedProfile.weight_kg,
        bmi: savedProfile.bmi,
        lifestyle_type: savedProfile.lifestyle_type
      }
    });

    await insertAnswerRecords(client, userId, answerRecords);

    await client.query(
      `UPDATE users
       SET onboarding_completed = TRUE,
           onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()),
           role = $2,
           lifestyle_type = $3,
           wellness_goal = $4,
           wellness_goals = $5
       WHERE user_id = $1`,
      [
        userId,
        profile.role,
        profile.lifestyle_type,
        profile.wellness_goal,
        profile.wellness_goals
      ]
    );

    await client.query(
      `INSERT INTO user_preferences (
         user_id,
         default_wake_time,
         default_sleep_time,
         prefers_daily_reminder,
         prefers_hydration_reminder,
         prefers_exercise_reminder,
         prefers_sleep_reminder,
         primary_goal,
         wellness_goals
       )
       VALUES ($1, $2, $3, TRUE, TRUE, TRUE, TRUE, $4, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET
         default_wake_time = EXCLUDED.default_wake_time,
         default_sleep_time = EXCLUDED.default_sleep_time,
         primary_goal = EXCLUDED.primary_goal,
         wellness_goals = EXCLUDED.wellness_goals,
         updated_at = NOW()`,
      [
        userId,
        profile.usual_wake_time,
        profile.usual_sleep_time,
        profile.wellness_goal,
        profile.wellness_goals
      ]
    );

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
       VALUES ($1, 'wellness', NULL, $2, NULL, 'onboarding', $3::jsonb)
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
        profile.wellness_goal,
        JSON.stringify({ selected_goals: profile.wellness_goals })
      ]
    );

    await client.query(
      `INSERT INTO user_onboarding (
         user_id,
         role_type,
         sleep_hours,
         activity_level,
         exercise_days_per_week,
         stress_level,
         height_cm,
         weight_kg,
         bmi,
         skipped
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
       ON CONFLICT (user_id)
       DO UPDATE SET
         role_type = EXCLUDED.role_type,
         sleep_hours = EXCLUDED.sleep_hours,
         activity_level = EXCLUDED.activity_level,
         exercise_days_per_week = EXCLUDED.exercise_days_per_week,
         stress_level = EXCLUDED.stress_level,
         height_cm = EXCLUDED.height_cm,
         weight_kg = EXCLUDED.weight_kg,
         bmi = EXCLUDED.bmi,
         skipped = FALSE,
         updated_at = NOW()`,
      [
        userId,
        profile.role,
        sleepHoursBetween(profile.usual_sleep_time, profile.usual_wake_time),
        activityLevelForLegacy(profile.lifestyle_type),
        exerciseDaysForLegacy(profile.exercise_goal_days),
        profile.workload_level,
        profile.height_cm,
        profile.weight_kg,
        profile.bmi
      ]
    );

    await client.query('COMMIT');

    return {
      message: 'Onboarding submitted successfully',
      onboarding_completed: true,
      profile: savedProfile,
      scores,
      baseline_for_ai: buildAiBaseline(savedProfile)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUserBurnoutBaseline(userIdValue, payload = {}) {
  const userId = parseUserId(userIdValue);
  const burnoutAnswers = buildBurnoutAnswerRecords(payload?.burnout_answers);
  const scores = calculateBurnoutBaselineScore(burnoutAnswers);
  const clientRefreshId = normalizeText(payload?.client_refresh_id);
  if (
    clientRefreshId != null &&
    (clientRefreshId.length > 100 ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(clientRefreshId))
  ) {
    throw new OnboardingServiceError('Valid client_refresh_id is required');
  }
  const today = payload?.baseline_date == null
    ? formatDateOnly(new Date())
    : normalizeDateOnly(payload.baseline_date, 'baseline_date');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT user_id FROM users WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw new OnboardingServiceError('User not found', 404);
    }

    const profileResult = await client.query(
      `UPDATE user_onboarding_profiles
       SET emotional_exhaustion_score = $2,
           depersonalization_score = $3,
           personal_accomplishment_score = $4,
           initial_burnout_score = $5,
           initial_burnout_level = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
       RETURNING
         id,
         user_id,
         role,
         lifestyle_type,
         wellness_goal,
         wellness_goals,
         height_cm,
         weight_kg,
         bmi,
         to_char(usual_sleep_time, 'HH24:MI') AS usual_sleep_time,
         to_char(usual_wake_time, 'HH24:MI') AS usual_wake_time,
         exercise_goal_days,
         workload_level,
         has_extra_responsibilities,
         extra_responsibility_level,
         emotional_exhaustion_score,
         depersonalization_score,
         personal_accomplishment_score,
         initial_burnout_score,
         initial_burnout_level,
         created_at,
         updated_at`,
      [
        userId,
        scores.emotional_exhaustion_score,
        scores.depersonalization_score,
        scores.personal_accomplishment_score,
        scores.initial_burnout_score,
        scores.initial_burnout_level
      ]
    );

    if (profileResult.rowCount === 0) {
      throw new OnboardingServiceError('Onboarding profile not found', 404);
    }

    const returnContextResult = await client.query(
      `SELECT
         (SELECT MAX(log_date) FROM daily_logs WHERE user_id = $1)
           AS last_logged_date,
         (
           SELECT started_at
           FROM user_baseline_epochs
           WHERE user_id = $1 AND ended_at IS NULL
           ORDER BY started_at DESC, baseline_epoch_id DESC
           LIMIT 1
         ) AS baseline_epoch_started_at`,
      [userId]
    );
    const returnContext = returnContextResult.rows[0] ?? {};
    const returnState = detectReturnState({
      lastLoggedDate: returnContext.last_logged_date,
      localDate: today,
      baselineEpochStartedAt: returnContext.baseline_epoch_started_at
    });

    await insertAnswerRecords(client, userId, burnoutAnswers);

    const baselineEpoch = await startBaselineEpoch(client, userId, {
      startedAt: today,
      resetReason: returnState.requires_baseline_refresh
        ? 'thirty_day_return'
        : 'manual_baseline_refresh',
      clientRefreshId
    });
    const refreshStartDate = baselineEpoch.startedAt > addDays(today, -27)
      ? baselineEpoch.startedAt
      : addDays(today, -27);

    const refreshedScores = await upsertBurnoutScoresForRange(
      client,
      userId,
      refreshStartDate,
      today
    );
    const latestScore = await getLatestBurnoutScore(client, userId);

    await client.query('COMMIT');

    const savedProfile = profileResult.rows[0];

    return {
      message: 'Burnout baseline updated successfully',
      profile: savedProfile,
      scores,
      baseline_epoch_id: baselineEpoch.baselineEpochId,
      client_refresh_id: baselineEpoch.clientRefreshId,
      baseline_refresh_reason: baselineEpoch.resetReason,
      baseline_for_ai: buildAiBaseline(savedProfile),
      latest_score: latestScore,
      refreshed_scores_count: refreshedScores.length
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getOnboardingStatus(userIdValue) {
  const userId = parseUserId(userIdValue);
  const result = await pool.query(
    `SELECT
       users.user_id,
       users.email_verified,
       users.onboarding_completed,
       users.onboarding_completed_at,
       EXISTS (
         SELECT 1
         FROM user_onboarding_profiles profile
         WHERE profile.user_id = users.user_id
       ) AS has_onboarding_profile
     FROM users
     WHERE users.user_id = $1`,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    user_id: row.user_id,
    email_verified: row.email_verified == true,
    onboarding_completed:
      row.onboarding_completed == true && row.has_onboarding_profile == true,
    onboarding_completed_at: row.onboarding_completed_at,
    has_onboarding_profile: row.has_onboarding_profile == true
  };
}

export async function getOnboardingSummaryBundle(userIdValue) {
  const status = await getOnboardingStatus(userIdValue);

  if (!status) {
    return null;
  }

  const profileResult = await pool.query(
    `SELECT
       id,
       user_id,
       role,
       lifestyle_type,
       wellness_goal,
       wellness_goals,
       height_cm,
       weight_kg,
       bmi,
       to_char(usual_sleep_time, 'HH24:MI') AS usual_sleep_time,
       to_char(usual_wake_time, 'HH24:MI') AS usual_wake_time,
       exercise_goal_days,
       workload_level,
       has_extra_responsibilities,
       extra_responsibility_level,
       emotional_exhaustion_score,
       depersonalization_score,
       personal_accomplishment_score,
       initial_burnout_score,
       initial_burnout_level,
       created_at,
       updated_at
     FROM user_onboarding_profiles
     WHERE user_id = $1`,
    [status.user_id]
  );

  const answersResult = await pool.query(
    `SELECT
       question_key,
       question_text,
       category,
       answer_value,
       numeric_value,
       is_reverse_scored,
       created_at
     FROM user_onboarding_answers
     WHERE user_id = $1
     ORDER BY id ASC`,
    [status.user_id]
  );

  const profile = profileResult.rows[0] ?? null;

  return {
    ...status,
    profile,
    onboarding_profile: profile,
    answers: answersResult.rows,
    baseline_for_ai: buildAiBaseline(profile)
  };
}

export async function getUserBaselineForAI(userIdValue) {
  const summary = await getOnboardingSummaryBundle(userIdValue);

  if (!summary) {
    return null;
  }

  return summary.baseline_for_ai;
}

export async function getUserProfileSummary(userIdValue) {
  const userId = parseUserId(userIdValue);
  const result = await pool.query(
    `SELECT
       users.user_id,
       users.username,
       users.email,
       users.age,
       users.gender,
       users.email_verified,
       COALESCE(profile.role, users.role) AS role,
       COALESCE(profile.lifestyle_type, users.lifestyle_type) AS lifestyle_type,
       COALESCE(profile.wellness_goal, users.wellness_goal) AS wellness_goal,
       CASE
         WHEN cardinality(profile.wellness_goals) > 0 THEN profile.wellness_goals
         ELSE users.wellness_goals
       END AS wellness_goals,
       users.onboarding_completed,
       users.onboarding_completed_at,
       profile.id AS onboarding_profile_id,
       profile.height_cm,
       profile.weight_kg,
       profile.bmi,
       to_char(profile.usual_sleep_time, 'HH24:MI') AS usual_sleep_time,
       to_char(profile.usual_wake_time, 'HH24:MI') AS usual_wake_time,
       profile.exercise_goal_days,
       profile.workload_level,
       profile.has_extra_responsibilities,
       profile.extra_responsibility_level,
       profile.emotional_exhaustion_score,
       profile.depersonalization_score,
       profile.personal_accomplishment_score,
       profile.initial_burnout_score,
       profile.initial_burnout_level,
       profile.created_at AS onboarding_created_at,
       profile.updated_at AS onboarding_updated_at
     FROM users
     LEFT JOIN user_onboarding_profiles profile
       ON profile.user_id = users.user_id
     WHERE users.user_id = $1`,
    [userId]
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const onboardingProfile = row.onboarding_profile_id == null
    ? null
    : {
        id: row.onboarding_profile_id,
        user_id: row.user_id,
        role: row.role,
        lifestyle_type: row.lifestyle_type,
        wellness_goal: row.wellness_goal,
        wellness_goals: normalizeStringList(row.wellness_goals),
        height_cm: row.height_cm,
        weight_kg: row.weight_kg,
        bmi: row.bmi,
        usual_sleep_time: row.usual_sleep_time,
        usual_wake_time: row.usual_wake_time,
        exercise_goal_days: row.exercise_goal_days,
        workload_level: row.workload_level,
        has_extra_responsibilities: row.has_extra_responsibilities,
        extra_responsibility_level: row.extra_responsibility_level,
        emotional_exhaustion_score: row.emotional_exhaustion_score,
        depersonalization_score: row.depersonalization_score,
        personal_accomplishment_score: row.personal_accomplishment_score,
        initial_burnout_score: row.initial_burnout_score,
        initial_burnout_level: row.initial_burnout_level,
        created_at: row.onboarding_created_at,
        updated_at: row.onboarding_updated_at
      };

  return {
    user: {
      user_id: row.user_id,
      username: row.username,
      email: row.email,
      email_verified: row.email_verified == true,
      age: row.age,
      gender: row.gender,
      role: row.role,
      lifestyle_type: row.lifestyle_type,
      wellness_goal: row.wellness_goal,
      wellness_goals: normalizeStringList(row.wellness_goals),
      onboarding_completed:
        row.onboarding_completed == true && onboardingProfile != null,
      onboarding_completed_at: row.onboarding_completed_at
    },
    onboarding_profile: onboardingProfile,
    baseline_for_ai: buildAiBaseline(onboardingProfile)
  };
}

export async function updateUserWellnessProfile(userIdValue, payload = {}) {
  const userId = parseUserId(userIdValue);
  const role = normalizeText(payload.role);
  const lifestyleType = normalizeText(payload.lifestyle_type);
  const usualSleepTime = normalizeTime(payload.usual_sleep_time);
  const usualWakeTime = normalizeTime(payload.usual_wake_time);
  const workloadLevel =
    payload.workload_level == null || payload.workload_level === ''
      ? workloadLevelFromIntensity(payload.work_intensity)
      : parseLikert(payload.workload_level, 'workload_level');
  const hasHeightUpdate = hasMetricValue(payload.height_cm);
  const hasWeightUpdate = hasMetricValue(payload.weight_kg);
  const hasBodyMetricsUpdate = hasHeightUpdate || hasWeightUpdate;

  if (!ROLE_OPTIONS.has(role)) {
    throw new OnboardingServiceError('Invalid role value');
  }

  if (!LIFESTYLE_OPTIONS.has(lifestyleType)) {
    throw new OnboardingServiceError('Invalid lifestyle_type value');
  }

  if (!usualSleepTime) {
    throw new OnboardingServiceError('Valid usual_sleep_time is required');
  }

  if (!usualWakeTime) {
    throw new OnboardingServiceError('Valid usual_wake_time is required');
  }

  if (workloadLevel == null) {
    throw new OnboardingServiceError('Valid workload_level is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT user_id, age, gender, wellness_goal, wellness_goals
       FROM users
       WHERE user_id = $1
       FOR UPDATE`,
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw new OnboardingServiceError('User not found', 404);
    }

    const existingProfileResult = await client.query(
      `SELECT
         wellness_goal,
         wellness_goals,
         height_cm,
         weight_kg,
         bmi,
         exercise_goal_days,
         has_extra_responsibilities,
         extra_responsibility_level,
         emotional_exhaustion_score,
         depersonalization_score,
         personal_accomplishment_score,
         initial_burnout_score,
         initial_burnout_level
       FROM user_onboarding_profiles
       WHERE user_id = $1
       FOR UPDATE`,
      [userId]
    );
    const existingProfile = existingProfileResult.rows[0] ?? {};
    const existingWellnessGoals = normalizeStringList(
      existingProfile.wellness_goals
    );
    const userWellnessGoals = normalizeStringList(
      userResult.rows[0]?.wellness_goals
    );
    const wellnessGoal =
      normalizeText(existingProfile.wellness_goal) ??
      normalizeText(userResult.rows[0]?.wellness_goal);
    const wellnessGoals =
      existingWellnessGoals.length > 0
        ? existingWellnessGoals
        : userWellnessGoals.length > 0
        ? userWellnessGoals
        : normalizeStringList(wellnessGoal);
    const existingBodyMetrics = {
      height_cm: existingProfile.height_cm ?? null,
      weight_kg: existingProfile.weight_kg ?? null,
      bmi: existingProfile.bmi ?? null
    };
    let bodyMetricsChanged = false;
    let profileBodyMetrics = existingBodyMetrics;

    if (hasBodyMetricsUpdate) {
      const nextHeightCm = parseBodyMetric(
        hasHeightUpdate ? payload.height_cm : existingBodyMetrics.height_cm,
        'height_cm',
        HEIGHT_CM_MIN,
        HEIGHT_CM_MAX
      );
      const nextWeightKg = parseBodyMetric(
        hasWeightUpdate ? payload.weight_kg : existingBodyMetrics.weight_kg,
        'weight_kg',
        WEIGHT_KG_MIN,
        WEIGHT_KG_MAX
      );
      bodyMetricsChanged =
        nextHeightCm !== Number(existingBodyMetrics.height_cm) ||
        nextWeightKg !== Number(existingBodyMetrics.weight_kg) ||
        !hasMetricValue(existingBodyMetrics.bmi);

      if (bodyMetricsChanged) {
        profileBodyMetrics = {
          height_cm: nextHeightCm,
          weight_kg: nextWeightKg,
          bmi: calculateBmi(nextHeightCm, nextWeightKg)
        };
      }
    }

    const profileResult = await client.query(
      `INSERT INTO user_onboarding_profiles (
         user_id,
         role,
         lifestyle_type,
         wellness_goal,
         usual_sleep_time,
         usual_wake_time,
         exercise_goal_days,
         workload_level,
         has_extra_responsibilities,
         extra_responsibility_level,
         emotional_exhaustion_score,
         depersonalization_score,
         personal_accomplishment_score,
         initial_burnout_score,
         initial_burnout_level,
         wellness_goals,
         height_cm,
         weight_kg,
         bmi
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (user_id)
       DO UPDATE SET
         role = EXCLUDED.role,
         lifestyle_type = EXCLUDED.lifestyle_type,
         wellness_goal = EXCLUDED.wellness_goal,
         wellness_goals = EXCLUDED.wellness_goals,
         height_cm = EXCLUDED.height_cm,
         weight_kg = EXCLUDED.weight_kg,
         bmi = EXCLUDED.bmi,
         usual_sleep_time = EXCLUDED.usual_sleep_time,
         usual_wake_time = EXCLUDED.usual_wake_time,
         workload_level = EXCLUDED.workload_level,
         updated_at = CURRENT_TIMESTAMP
       RETURNING
         id,
         user_id,
         role,
         lifestyle_type,
         wellness_goal,
         wellness_goals,
         height_cm,
         weight_kg,
         bmi,
         to_char(usual_sleep_time, 'HH24:MI') AS usual_sleep_time,
         to_char(usual_wake_time, 'HH24:MI') AS usual_wake_time,
         exercise_goal_days,
         workload_level,
         has_extra_responsibilities,
         extra_responsibility_level,
         emotional_exhaustion_score,
         depersonalization_score,
         personal_accomplishment_score,
         initial_burnout_score,
         initial_burnout_level,
         created_at,
         updated_at`,
      [
        userId,
        role,
        lifestyleType,
        wellnessGoal,
        usualSleepTime,
        usualWakeTime,
        existingProfile.exercise_goal_days ?? null,
        workloadLevel,
        existingProfile.has_extra_responsibilities ?? false,
        existingProfile.extra_responsibility_level ?? null,
        existingProfile.emotional_exhaustion_score ?? null,
        existingProfile.depersonalization_score ?? null,
        existingProfile.personal_accomplishment_score ?? null,
        existingProfile.initial_burnout_score ?? null,
        existingProfile.initial_burnout_level ?? null,
        wellnessGoals,
        profileBodyMetrics.height_cm,
        profileBodyMetrics.weight_kg,
        profileBodyMetrics.bmi
      ]
    );

    const savedProfile = profileResult.rows[0];

    if (bodyMetricsChanged && savedProfile.bmi != null) {
      const user = userResult.rows[0];
      await ensureDefaultNutritionCalorieGoal({
        client,
        userId,
        profile: {
          age: user.age,
          gender: user.gender,
          height_cm: savedProfile.height_cm,
          weight_kg: savedProfile.weight_kg,
          bmi: savedProfile.bmi,
          lifestyle_type: savedProfile.lifestyle_type ?? lifestyleType
        }
      });
    }

    await client.query(
      `UPDATE users
       SET role = $2,
           lifestyle_type = $3,
           wellness_goal = COALESCE($4, wellness_goal),
           wellness_goals = $5,
           onboarding_completed = TRUE,
           onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
       WHERE user_id = $1`,
      [userId, role, lifestyleType, wellnessGoal, wellnessGoals]
    );

    await client.query(
      `INSERT INTO user_preferences (
         user_id,
         default_wake_time,
         default_sleep_time,
         primary_goal,
         wellness_goals
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET
         default_wake_time = EXCLUDED.default_wake_time,
         default_sleep_time = EXCLUDED.default_sleep_time,
         primary_goal = COALESCE(EXCLUDED.primary_goal, user_preferences.primary_goal),
         wellness_goals = EXCLUDED.wellness_goals,
         updated_at = NOW()`,
      [userId, usualWakeTime, usualSleepTime, wellnessGoal, wellnessGoals]
    );

    await client.query(
      `INSERT INTO user_onboarding (
         user_id,
         role_type,
         sleep_hours,
         activity_level,
         work_hours_per_day,
         stress_level,
         height_cm,
         weight_kg,
         bmi,
         skipped
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
       ON CONFLICT (user_id)
       DO UPDATE SET
         role_type = EXCLUDED.role_type,
         sleep_hours = EXCLUDED.sleep_hours,
         activity_level = EXCLUDED.activity_level,
         work_hours_per_day = EXCLUDED.work_hours_per_day,
         stress_level = EXCLUDED.stress_level,
         height_cm = COALESCE(EXCLUDED.height_cm, user_onboarding.height_cm),
         weight_kg = COALESCE(EXCLUDED.weight_kg, user_onboarding.weight_kg),
         bmi = COALESCE(EXCLUDED.bmi, user_onboarding.bmi),
         skipped = FALSE,
         updated_at = NOW()`,
      [
        userId,
        role,
        sleepHoursBetween(usualSleepTime, usualWakeTime),
        activityLevelForLegacy(lifestyleType),
        workloadLevel >= 4 ? 10 : workloadLevel <= 2 ? 6 : 8,
        workloadLevel,
        profileBodyMetrics.height_cm,
        profileBodyMetrics.weight_kg,
        profileBodyMetrics.bmi
      ]
    );

    await insertAnswerRecords(client, userId, [
      {
        question_key: 'role',
        question_text: 'What best describes you?',
        category: 'user_context',
        answer_value: role,
        numeric_value: null,
        is_reverse_scored: false
      },
      {
        question_key: 'lifestyle_type',
        question_text: 'How would you describe your lifestyle?',
        category: 'user_context',
        answer_value: lifestyleType,
        numeric_value: null,
        is_reverse_scored: false
      },
      {
        question_key: 'usual_sleep_time',
        question_text: 'What time do you usually sleep?',
        category: 'routine_defaults',
        answer_value: usualSleepTime,
        numeric_value: null,
        is_reverse_scored: false
      },
      {
        question_key: 'usual_wake_time',
        question_text: 'What time do you usually wake up?',
        category: 'routine_defaults',
        answer_value: usualWakeTime,
        numeric_value: null,
        is_reverse_scored: false
      },
      {
        question_key: 'workload_level',
        question_text: 'How heavy is your usual workload?',
        category: 'routine_defaults',
        answer_value: String(workloadLevel),
        numeric_value: workloadLevel,
        is_reverse_scored: false
      },
      ...(hasCompleteBodyMetrics(savedProfile)
        ? buildBodyMetricAnswerRecords(savedProfile)
        : [])
    ]);

    await client.query('COMMIT');

    return {
      profile: savedProfile,
      baseline_for_ai: buildAiBaseline(savedProfile)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
