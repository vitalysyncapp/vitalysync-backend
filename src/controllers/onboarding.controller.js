import pool from '../config/db.js';
import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';
import {
  OnboardingServiceError,
  getOnboardingStatus as fetchRequiredOnboardingStatus,
  getOnboardingSummaryBundle,
  normalizeBodyMetrics,
  submitRequiredOnboarding,
  updateUserBurnoutBaseline,
  updateUserWellnessProfile
} from '../services/onboarding.service.js';
import { recordProductEventSafely } from '../services/productEventService.js';

const allowedActivityLevels = new Set([
  'Sedentary',
  'Lightly Active',
  'Balanced',
  'Moderately Active',
  'Active',
  'Very Active'
]);
const allowedMealRegularness = new Set([
  'Very Irregular',
  'Irregular',
  'Mostly Regular',
  'Very Regular'
]);
const allowedNudgeStyles = new Set([
  'Gentle',
  'Direct',
  'Motivational',
  'Data-Driven'
]);
const wellnessGoalOptions = [
  'Reduce stress',
  'Improve sleep',
  'Be more active',
  'Improve focus',
  'Build healthier habits',
  'Manage burnout'
];
const allowedGoals = new Set([
  ...wellnessGoalOptions,
  'Build consistency',
  'Eat better',
  'Move more'
]);
const allowedGoalByKey = new Map(
  [...allowedGoals].map((goal) => [goal.toLowerCase(), goal])
);

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseBoundedNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function normalizeText(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)
    ? normalized
    : null;
}

function normalizeBusyDays(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((item) => parsePositiveInt(item))
      .filter((item) => item !== null && item >= 0 && item <= 6)
  )];
}

function normalizePrimaryGoal(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return { value: null, wellnessGoals: [] };
  }

  const goals = [];
  for (const part of normalized.split(',')) {
    const goal = normalizeText(part);
    if (!goal) {
      continue;
    }

    const canonical = allowedGoalByKey.get(goal.toLowerCase());
    if (!canonical) {
      return { error: 'Invalid primary_goal value' };
    }

    if (!goals.includes(canonical)) {
      goals.push(canonical);
    }
  }

  return {
    value: goals.join(', '),
    wellnessGoals: goals.filter((goal) => wellnessGoalOptions.includes(goal))
  };
}

async function userExists(userId) {
  const result = await pool.query(
    'SELECT user_id FROM users WHERE user_id = $1',
    [userId]
  );

  return result.rowCount > 0;
}

async function upsertBusyDays(client, userId, busyDays) {
  await client.query('DELETE FROM user_busy_days WHERE user_id = $1', [userId]);

  for (const dayOfWeek of busyDays) {
    await client.query(
      `INSERT INTO user_busy_days (user_id, day_of_week)
       VALUES ($1, $2)
       ON CONFLICT (user_id, day_of_week) DO NOTHING`,
      [userId, dayOfWeek]
    );
  }
}

async function markOnboardingCompleted(client, userId) {
  await client.query(
    `UPDATE users
     SET onboarding_completed = TRUE,
         onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
     WHERE user_id = $1`,
    [userId]
  );
}

async function fetchOnboardingBundle(userId) {
  const onboardingResult = await pool.query(
    `SELECT
       user_id,
       role_type,
       work_hours_per_day,
       sleep_hours,
       activity_level,
       exercise_days_per_week,
       meal_regularness,
       stress_level,
       height_cm,
       weight_kg,
       bmi,
       mental_drain_level,
       focus_difficulty_level,
       overwhelm_level,
       recovery_level,
       motivation_level,
       skipped,
       created_at,
       updated_at
     FROM user_onboarding
     WHERE user_id = $1`,
    [userId]
  );

  const preferencesResult = await pool.query(
    `SELECT
       user_id,
       preferred_log_time,
       default_wake_time,
       default_sleep_time,
       default_work_start,
       default_work_end,
       prefers_daily_reminder,
       reminder_time,
       prefers_hydration_reminder,
       prefers_exercise_reminder,
       prefers_sleep_reminder,
       preferred_nudge_style,
       primary_goal,
       wellness_goals,
       created_at,
       updated_at
     FROM user_preferences
     WHERE user_id = $1`,
    [userId]
  );

  const busyDaysResult = await pool.query(
    `SELECT day_of_week
     FROM user_busy_days
     WHERE user_id = $1
     ORDER BY day_of_week ASC`,
    [userId]
  );

  const userResult = await pool.query(
    `SELECT onboarding_completed, onboarding_completed_at
     FROM users
     WHERE user_id = $1`,
    [userId]
  );

  return {
    onboarding: onboardingResult.rows[0] ?? null,
    preferences: preferencesResult.rows[0] ?? null,
    busy_days: busyDaysResult.rows.map((row) => row.day_of_week),
    onboarding_completed:
      (userResult.rows[0]?.onboarding_completed ?? false) &&
      preferencesResult.rowCount > 0,
    onboarding_completed_at: userResult.rows[0]?.onboarding_completed_at ?? null
  };
}

export async function getOnboardingSummary(req, res) {
  const userId = getAuthenticatedUserId(req) ?? Number(req.params.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  try {
    if (!(await userExists(userId))) {
      return res.status(404).json({ message: 'User not found' });
    }

    const legacyPayload = await fetchOnboardingBundle(userId);
    const requiredPayload = await getOnboardingSummaryBundle(userId);

    return res.status(200).json({
      ...legacyPayload,
      ...requiredPayload,
      onboarding: legacyPayload.onboarding,
      preferences: legacyPayload.preferences,
      busy_days: legacyPayload.busy_days
    });
  } catch (error) {
    console.error('Get onboarding summary error:', error);
    return res.status(500).json({ message: 'Failed to fetch onboarding summary' });
  }
}

export async function getRequiredOnboardingStatus(req, res) {
  const userId = getAuthenticatedUserId(req) ?? Number(req.params.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  try {
    const status = await fetchRequiredOnboardingStatus(userId);

    if (!status) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json(status);
  } catch (error) {
    console.error('Get onboarding status error:', error);
    return res.status(500).json({ message: 'Failed to fetch onboarding status' });
  }
}

export async function submitOnboarding(req, res) {
  try {
    const payload = await submitRequiredOnboarding(req.body);
    return res.status(201).json(payload);
  } catch (error) {
    if (error instanceof OnboardingServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error('Submit onboarding error:', error);
    return res.status(500).json({ message: 'Failed to submit onboarding' });
  }
}

export async function updateWellnessProfile(req, res) {
  try {
    const userId = getAuthenticatedUserId(req) ?? req.params.userId;
    const payload = await updateUserWellnessProfile(userId, req.body);
    return res.status(200).json({
      message: 'Wellness profile updated successfully',
      ...payload
    });
  } catch (error) {
    if (error instanceof OnboardingServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error('Update wellness profile error:', error);
    return res.status(500).json({ message: 'Failed to update wellness profile' });
  }
}

export async function updateBurnoutBaseline(req, res) {
  try {
    const userId = getAuthenticatedUserId(req) ?? req.params.userId;
    const payload = await updateUserBurnoutBaseline(userId, req.body);
    await recordProductEventSafely(pool, userId, {
      eventName: 'baseline_refresh_completed',
      eventKey: payload.client_refresh_id ?? `epoch:${payload.baseline_epoch_id}`,
      dimensions: {
        reason: payload.baseline_refresh_reason ?? 'manual_baseline_refresh'
      }
    });
    return res.status(200).json(payload);
  } catch (error) {
    if (error instanceof OnboardingServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error('Update burnout baseline error:', error);
    return res.status(500).json({ message: 'Failed to update burnout baseline' });
  }
}

export async function createOnboarding(req, res) {
  const {
    user_id: rawUserId,
    role_type,
    work_hours_per_day,
    sleep_hours,
    activity_level,
    exercise_days_per_week,
    meal_regularness,
    stress_level,
    mental_drain_level,
    focus_difficulty_level,
    overwhelm_level,
    recovery_level,
    motivation_level,
    skipped = false
  } = req.body;

  const userId = getAuthenticatedUserId(req) ?? Number(rawUserId);
  const normalizedRoleType = normalizeText(role_type);
  const normalizedActivityLevel = normalizeText(activity_level);
  const normalizedMealRegularness = normalizeText(meal_regularness);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (normalizedActivityLevel && !allowedActivityLevels.has(normalizedActivityLevel)) {
    return res.status(400).json({ message: 'Invalid activity_level value' });
  }

  if (normalizedMealRegularness && !allowedMealRegularness.has(normalizedMealRegularness)) {
    return res.status(400).json({ message: 'Invalid meal_regularness value' });
  }

  try {
    const bodyMetrics = normalizeBodyMetrics(req.body, { required: false });

    if (!(await userExists(userId))) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `INSERT INTO user_onboarding (
         user_id,
         role_type,
         work_hours_per_day,
         sleep_hours,
         activity_level,
         exercise_days_per_week,
         meal_regularness,
         stress_level,
         mental_drain_level,
         focus_difficulty_level,
         overwhelm_level,
         recovery_level,
         motivation_level,
         height_cm,
         weight_kg,
         bmi,
         skipped
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17
       )
       RETURNING *`,
      [
        userId,
        normalizedRoleType,
        parsePositiveInt(work_hours_per_day),
        parseBoundedNumber(sleep_hours, 0, 24),
        normalizedActivityLevel,
        parsePositiveInt(exercise_days_per_week),
        normalizedMealRegularness,
        parseBoundedNumber(stress_level, 1, 5),
        parseBoundedNumber(mental_drain_level, 1, 5),
        parseBoundedNumber(focus_difficulty_level, 1, 5),
        parseBoundedNumber(overwhelm_level, 1, 5),
        parseBoundedNumber(recovery_level, 1, 5),
        parseBoundedNumber(motivation_level, 1, 5),
        bodyMetrics.height_cm,
        bodyMetrics.weight_kg,
        bodyMetrics.bmi,
        Boolean(skipped)
      ]
    );

    return res.status(201).json({
      message: 'Onboarding created successfully',
      onboarding: result.rows[0]
    });
  } catch (error) {
    if (error instanceof OnboardingServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    if (error.code === '23505') {
      return res.status(409).json({ message: 'Onboarding already exists for this user' });
    }

    console.error('Create onboarding error:', error);
    return res.status(500).json({ message: 'Failed to create onboarding data' });
  }
}

export async function updateOnboarding(req, res) {
  const userId = getAuthenticatedUserId(req) ?? Number(req.params.userId);
  const {
    role_type,
    work_hours_per_day,
    sleep_hours,
    activity_level,
    exercise_days_per_week,
    meal_regularness,
    stress_level,
    mental_drain_level,
    focus_difficulty_level,
    overwhelm_level,
    recovery_level,
    motivation_level,
    skipped = false
  } = req.body;

  const normalizedRoleType = normalizeText(role_type);
  const normalizedActivityLevel = normalizeText(activity_level);
  const normalizedMealRegularness = normalizeText(meal_regularness);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (normalizedActivityLevel && !allowedActivityLevels.has(normalizedActivityLevel)) {
    return res.status(400).json({ message: 'Invalid activity_level value' });
  }

  if (normalizedMealRegularness && !allowedMealRegularness.has(normalizedMealRegularness)) {
    return res.status(400).json({ message: 'Invalid meal_regularness value' });
  }

  try {
    const bodyMetrics = normalizeBodyMetrics(req.body, { required: false });

    if (!(await userExists(userId))) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `INSERT INTO user_onboarding (
         user_id,
         role_type,
         work_hours_per_day,
         sleep_hours,
         activity_level,
         exercise_days_per_week,
         meal_regularness,
         stress_level,
         mental_drain_level,
         focus_difficulty_level,
         overwhelm_level,
         recovery_level,
         motivation_level,
         height_cm,
         weight_kg,
         bmi,
         skipped
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17
       )
       ON CONFLICT (user_id) DO UPDATE SET
         role_type = EXCLUDED.role_type,
         work_hours_per_day = EXCLUDED.work_hours_per_day,
         sleep_hours = EXCLUDED.sleep_hours,
         activity_level = EXCLUDED.activity_level,
         exercise_days_per_week = EXCLUDED.exercise_days_per_week,
         meal_regularness = EXCLUDED.meal_regularness,
         stress_level = EXCLUDED.stress_level,
         mental_drain_level = EXCLUDED.mental_drain_level,
         focus_difficulty_level = EXCLUDED.focus_difficulty_level,
         overwhelm_level = EXCLUDED.overwhelm_level,
         recovery_level = EXCLUDED.recovery_level,
         motivation_level = EXCLUDED.motivation_level,
         height_cm = COALESCE(EXCLUDED.height_cm, user_onboarding.height_cm),
         weight_kg = COALESCE(EXCLUDED.weight_kg, user_onboarding.weight_kg),
         bmi = COALESCE(EXCLUDED.bmi, user_onboarding.bmi),
         skipped = EXCLUDED.skipped,
         updated_at = NOW()
       RETURNING *`,
      [
        userId,
        normalizedRoleType,
        parsePositiveInt(work_hours_per_day),
        parseBoundedNumber(sleep_hours, 0, 24),
        normalizedActivityLevel,
        parsePositiveInt(exercise_days_per_week),
        normalizedMealRegularness,
        parseBoundedNumber(stress_level, 1, 5),
        parseBoundedNumber(mental_drain_level, 1, 5),
        parseBoundedNumber(focus_difficulty_level, 1, 5),
        parseBoundedNumber(overwhelm_level, 1, 5),
        parseBoundedNumber(recovery_level, 1, 5),
        parseBoundedNumber(motivation_level, 1, 5),
        bodyMetrics.height_cm,
        bodyMetrics.weight_kg,
        bodyMetrics.bmi,
        Boolean(skipped)
      ]
    );

    return res.status(200).json({
      message: 'Onboarding updated successfully',
      onboarding: result.rows[0]
    });
  } catch (error) {
    if (error instanceof OnboardingServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    console.error('Update onboarding error:', error);
    return res.status(500).json({ message: 'Failed to update onboarding data' });
  }
}

export async function createPreferences(req, res) {
  const {
    user_id: rawUserId,
    preferred_log_time,
    default_wake_time,
    default_sleep_time,
    default_work_start,
    default_work_end,
    prefers_daily_reminder = true,
    reminder_time,
    prefers_hydration_reminder = true,
    prefers_exercise_reminder = true,
    prefers_sleep_reminder = true,
    preferred_nudge_style,
    primary_goal,
    busy_days = []
  } = req.body;

  const userId = getAuthenticatedUserId(req) ?? Number(rawUserId);
  const normalizedNudgeStyle = normalizeText(preferred_nudge_style);
  const normalizedGoal = normalizePrimaryGoal(primary_goal);
  const normalizedBusyDays = normalizeBusyDays(busy_days);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (normalizedNudgeStyle && !allowedNudgeStyles.has(normalizedNudgeStyle)) {
    return res.status(400).json({ message: 'Invalid preferred_nudge_style value' });
  }

  if (normalizedGoal.error) {
    return res.status(400).json({ message: normalizedGoal.error });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const exists = await client.query(
      'SELECT user_id FROM users WHERE user_id = $1',
      [userId]
    );

    if (exists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await client.query(
      `INSERT INTO user_preferences (
         user_id,
         preferred_log_time,
         default_wake_time,
         default_sleep_time,
         default_work_start,
         default_work_end,
         prefers_daily_reminder,
         reminder_time,
         prefers_hydration_reminder,
         prefers_exercise_reminder,
         prefers_sleep_reminder,
         preferred_nudge_style,
         primary_goal,
         wellness_goals
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       )
       RETURNING *`,
      [
        userId,
        normalizeTime(preferred_log_time),
        normalizeTime(default_wake_time),
        normalizeTime(default_sleep_time),
        normalizeTime(default_work_start),
        normalizeTime(default_work_end),
        Boolean(prefers_daily_reminder),
        normalizeTime(reminder_time),
        Boolean(prefers_hydration_reminder),
        Boolean(prefers_exercise_reminder),
        Boolean(prefers_sleep_reminder),
        normalizedNudgeStyle,
        normalizedGoal.value,
        normalizedGoal.wellnessGoals
      ]
    );

    await upsertBusyDays(client, userId, normalizedBusyDays);
    await markOnboardingCompleted(client, userId);
    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Preferences created successfully',
      preferences: result.rows[0],
      busy_days: normalizedBusyDays,
      onboarding_completed: true
    });
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      return res.status(409).json({ message: 'Preferences already exist for this user' });
    }

    console.error('Create preferences error:', error);
    return res.status(500).json({ message: 'Failed to create user preferences' });
  } finally {
    client.release();
  }
}

export async function updatePreferences(req, res) {
  const userId = getAuthenticatedUserId(req) ?? Number(req.params.userId);
  const {
    preferred_log_time,
    default_wake_time,
    default_sleep_time,
    default_work_start,
    default_work_end,
    prefers_daily_reminder = true,
    reminder_time,
    prefers_hydration_reminder = true,
    prefers_exercise_reminder = true,
    prefers_sleep_reminder = true,
    preferred_nudge_style,
    primary_goal,
    busy_days = []
  } = req.body;

  const normalizedNudgeStyle = normalizeText(preferred_nudge_style);
  const normalizedGoal = normalizePrimaryGoal(primary_goal);
  const normalizedBusyDays = normalizeBusyDays(busy_days);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (normalizedNudgeStyle && !allowedNudgeStyles.has(normalizedNudgeStyle)) {
    return res.status(400).json({ message: 'Invalid preferred_nudge_style value' });
  }

  if (normalizedGoal.error) {
    return res.status(400).json({ message: normalizedGoal.error });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const exists = await client.query(
      'SELECT user_id FROM users WHERE user_id = $1',
      [userId]
    );

    if (exists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await client.query(
      `INSERT INTO user_preferences (
         user_id,
         preferred_log_time,
         default_wake_time,
         default_sleep_time,
         default_work_start,
         default_work_end,
         prefers_daily_reminder,
         reminder_time,
         prefers_hydration_reminder,
         prefers_exercise_reminder,
         prefers_sleep_reminder,
         preferred_nudge_style,
         primary_goal,
         wellness_goals
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       )
       ON CONFLICT (user_id) DO UPDATE SET
         preferred_log_time = EXCLUDED.preferred_log_time,
         default_wake_time = EXCLUDED.default_wake_time,
         default_sleep_time = EXCLUDED.default_sleep_time,
         default_work_start = EXCLUDED.default_work_start,
         default_work_end = EXCLUDED.default_work_end,
         prefers_daily_reminder = EXCLUDED.prefers_daily_reminder,
         reminder_time = EXCLUDED.reminder_time,
         prefers_hydration_reminder = EXCLUDED.prefers_hydration_reminder,
         prefers_exercise_reminder = EXCLUDED.prefers_exercise_reminder,
         prefers_sleep_reminder = EXCLUDED.prefers_sleep_reminder,
         preferred_nudge_style = EXCLUDED.preferred_nudge_style,
         primary_goal = EXCLUDED.primary_goal,
         wellness_goals = EXCLUDED.wellness_goals,
         updated_at = NOW()
       RETURNING *`,
      [
        userId,
        normalizeTime(preferred_log_time),
        normalizeTime(default_wake_time),
        normalizeTime(default_sleep_time),
        normalizeTime(default_work_start),
        normalizeTime(default_work_end),
        Boolean(prefers_daily_reminder),
        normalizeTime(reminder_time),
        Boolean(prefers_hydration_reminder),
        Boolean(prefers_exercise_reminder),
        Boolean(prefers_sleep_reminder),
        normalizedNudgeStyle,
        normalizedGoal.value,
        normalizedGoal.wellnessGoals
      ]
    );

    await upsertBusyDays(client, userId, normalizedBusyDays);
    await markOnboardingCompleted(client, userId);
    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Preferences updated successfully',
      preferences: result.rows[0],
      busy_days: normalizedBusyDays,
      onboarding_completed: true
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update preferences error:', error);
    return res.status(500).json({ message: 'Failed to update user preferences' });
  } finally {
    client.release();
  }
}
