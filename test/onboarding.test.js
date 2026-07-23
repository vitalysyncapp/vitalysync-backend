import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OnboardingServiceError,
  calculateBmi,
  getOnboardingSummaryBundle,
  normalizeBodyMetrics,
  submitRequiredOnboarding,
  updateUserBurnoutBaseline,
  updateUserWellnessProfile,
} from '../src/services/onboarding.service.js';
import pool from '../src/config/db.js';

const burnoutQuestionKeys = [
  'ee_01',
  'ee_02',
  'ee_03',
  'ee_04',
  'ee_05',
  'dp_01',
  'dp_02',
  'dp_03',
  'dp_04',
  'dp_05',
  'pa_01',
  'pa_02',
  'pa_03',
  'pa_04',
  'pa_05',
];

function baselineAnswers(value = 3) {
  return burnoutQuestionKeys.map((questionKey) => ({
    question_key: questionKey,
    numeric_value: value,
  }));
}

test('onboarding rejects invalid user ids before database work', async () => {
  await assert.rejects(
    () => submitRequiredOnboarding({ user_id: 0 }),
    (error) =>
      error instanceof OnboardingServiceError &&
      error.message === 'Valid user_id is required'
  );
});

test('onboarding rejects incomplete profile values before database work', async () => {
  await assert.rejects(
    () =>
      submitRequiredOnboarding({
        user_id: 1,
        profile: {
          role: 'Invalid role',
          lifestyle_type: 'Sedentary',
          wellness_goal: 'Improve sleep',
          height_cm: 170,
          weight_kg: 70,
          usual_sleep_time: '22:00',
          usual_wake_time: '06:00',
          exercise_goal_days: '3-4 days',
          has_extra_responsibilities: false,
        },
        burnout_answers: [],
      }),
    (error) =>
      error instanceof OnboardingServiceError &&
      error.message === 'Invalid role value'
  );
});

test('onboarding rejects unsupported wellness goal selections before database work', async () => {
  await assert.rejects(
    () =>
      submitRequiredOnboarding({
        user_id: 1,
        profile: {
          role: 'Student',
          lifestyle_type: 'Sedentary',
          wellness_goals: ['Improve sleep', 'Unsupported goal'],
          height_cm: 170,
          weight_kg: 70,
          usual_sleep_time: '22:00',
          usual_wake_time: '06:00',
          exercise_goal_days: '3-4 days',
          workload_level: 3,
          has_extra_responsibilities: false,
        },
        burnout_answers: [],
      }),
    (error) =>
      error instanceof OnboardingServiceError &&
      error.message === 'Invalid wellness_goal value'
  );
});

test('onboarding requires body metrics before database work', async () => {
  await assert.rejects(
    () =>
      submitRequiredOnboarding({
        user_id: 1,
        profile: {
          role: 'Student',
          lifestyle_type: 'Sedentary',
          wellness_goal: 'Improve sleep',
          usual_sleep_time: '22:00',
          usual_wake_time: '06:00',
          exercise_goal_days: '3-4 days',
          workload_level: 3,
          has_extra_responsibilities: false,
        },
        burnout_answers: [],
      }),
    (error) =>
      error instanceof OnboardingServiceError &&
      error.message === 'Valid height_cm is required'
  );
});

test('onboarding rejects unreasonable body metrics before database work', async () => {
  await assert.rejects(
    () =>
      submitRequiredOnboarding({
        user_id: 1,
        profile: {
          role: 'Student',
          lifestyle_type: 'Sedentary',
          wellness_goal: 'Improve sleep',
          height_cm: 80,
          weight_kg: 70,
          usual_sleep_time: '22:00',
          usual_wake_time: '06:00',
          exercise_goal_days: '3-4 days',
          workload_level: 3,
          has_extra_responsibilities: false,
        },
        burnout_answers: [],
      }),
    (error) =>
      error instanceof OnboardingServiceError &&
      error.message === 'height_cm must be between 100 and 250'
  );
});

test('body metrics calculate BMI on the backend and ignore submitted BMI', () => {
  assert.equal(calculateBmi(180, 80), 24.7);
  assert.equal(calculateBmi(160, 80), 31.3);

  assert.deepEqual(
    normalizeBodyMetrics({
      height_cm: '180',
      weight_kg: '80',
      bmi: 10,
    }, { required: true }),
    {
      height_cm: 180,
      weight_kg: 80,
      bmi: 24.7,
      provided: true,
    }
  );
});

test('onboarding summary exposes email verification state', async () => {
  const originalQuery = pool.query;
  const queries = [];

  pool.query = async (text, values = []) => {
    queries.push({ text, values });

    if (text.includes('FROM users')) {
      return {
        rowCount: 1,
        rows: [
          {
            user_id: 1,
            email_verified: true,
            onboarding_completed: true,
            onboarding_completed_at: new Date('2026-07-23T00:00:00.000Z'),
            has_onboarding_profile: true,
          },
        ],
      };
    }

    if (
      text.includes('FROM user_onboarding_profiles') ||
      text.includes('FROM user_onboarding_answers')
    ) {
      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  try {
    const summary = await getOnboardingSummaryBundle(1);

    assert.equal(summary.email_verified, true);
    assert.ok(queries[0].text.includes('users.email_verified'));
  } finally {
    pool.query = originalQuery;
  }
});

test('onboarding persists server-calculated body metrics', async () => {
  const originalConnect = pool.connect;
  const queries = [];
  const fakeClient = {
    async query(text, values = []) {
      queries.push({ text, values });

      if (text === 'BEGIN' || text === 'COMMIT') {
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('FROM users') && text.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{ user_id: 1, age: 30, gender: 'Other' }],
        };
      }

      if (text.includes('INSERT INTO user_onboarding_profiles')) {
        return {
          rowCount: 1,
          rows: [
            {
              user_id: 1,
              role: 'Student',
              lifestyle_type: 'Sedentary',
              wellness_goal: 'Improve sleep',
              wellness_goals: ['Improve sleep'],
              height_cm: 180,
              weight_kg: 80,
              bmi: 24.7,
            },
          ],
        };
      }

      if (
        text.includes('INSERT INTO user_onboarding_answers') ||
        text.includes('UPDATE users') ||
        text.includes('INSERT INTO user_preferences') ||
        text.includes('INSERT INTO user_goals') ||
        text.includes('INSERT INTO user_onboarding (')
      ) {
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };

  pool.connect = async () => fakeClient;

  try {
    const response = await submitRequiredOnboarding({
      user_id: 1,
      profile: {
        role: 'Student',
        lifestyle_type: 'Sedentary',
        wellness_goal: 'Improve sleep',
        height_cm: 180,
        weight_kg: 80,
        bmi: 10,
        usual_sleep_time: '22:00',
        usual_wake_time: '06:00',
        exercise_goal_days: '3-4 days',
        workload_level: 3,
        has_extra_responsibilities: false,
      },
      burnout_answers: baselineAnswers(),
    });

    const profileInsert = queries.find((query) =>
      query.text.includes('INSERT INTO user_onboarding_profiles')
    );
    const legacyInsert = queries.find((query) =>
      query.text.includes('INSERT INTO user_onboarding (')
    );
    const nutritionGoalInsert = queries.find(
      (query) =>
        query.text.includes('INSERT INTO user_goals') &&
        query.values[1] === 'nutrition_calories'
    );

    assert.deepEqual(profileInsert.values.slice(-3), [180, 80, 24.7]);
    assert.deepEqual(legacyInsert.values.slice(-3), [180, 80, 24.7]);
    assert.deepEqual(nutritionGoalInsert.values.slice(0, 5), [
      1,
      'nutrition_calories',
      2300,
      'kcal',
      'system_default',
    ]);
    assert.deepEqual(JSON.parse(nutritionGoalInsert.values[5]), {
      balanced_kcal: 2300,
      balanced_kcal_source: 'wellness_profile',
      calculation_basis: 'age_height_weight_bmi_lifestyle',
    });
    assert.equal(response.profile.bmi, 24.7);
  } finally {
    pool.connect = originalConnect;
  }
});

test('wellness profile metric updates merge stored values and refresh the system goal', async () => {
  const originalConnect = pool.connect;
  const queries = [];
  const fakeClient = {
    async query(text, values = []) {
      queries.push({ text, values });

      if (text === 'BEGIN' || text === 'COMMIT') {
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('FROM users') && text.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [
            {
              user_id: 1,
              age: 30,
              gender: 'Other',
              wellness_goal: 'Improve sleep',
              wellness_goals: ['Improve sleep'],
            },
          ],
        };
      }

      if (
        text.includes('FROM user_onboarding_profiles') &&
        text.includes('FOR UPDATE')
      ) {
        return {
          rowCount: 1,
          rows: [
            {
              wellness_goal: 'Improve sleep',
              wellness_goals: ['Improve sleep'],
              height_cm: '180',
              weight_kg: '80',
              bmi: '24.7',
              exercise_goal_days: '3-4 days',
              has_extra_responsibilities: false,
            },
          ],
        };
      }

      if (text.includes('INSERT INTO user_onboarding_profiles')) {
        return {
          rowCount: 1,
          rows: [
            {
              user_id: 1,
              role: 'Student',
              lifestyle_type: 'Sedentary',
              wellness_goal: 'Improve sleep',
              wellness_goals: ['Improve sleep'],
              height_cm: values.at(-3),
              weight_kg: values.at(-2),
              bmi: values.at(-1),
              usual_sleep_time: '22:00',
              usual_wake_time: '06:00',
              workload_level: 3,
            },
          ],
        };
      }

      if (
        text.includes('INSERT INTO user_goals') ||
        text.includes('UPDATE users') ||
        text.includes('INSERT INTO user_preferences') ||
        text.includes('INSERT INTO user_onboarding (') ||
        text.includes('INSERT INTO user_onboarding_answers')
      ) {
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };

  pool.connect = async () => fakeClient;

  try {
    const response = await updateUserWellnessProfile(1, {
      role: 'Student',
      lifestyle_type: 'Sedentary',
      usual_sleep_time: '22:00',
      usual_wake_time: '06:00',
      workload_level: 3,
      height_cm: 160,
    });

    const profileInsert = queries.find((query) =>
      query.text.includes('INSERT INTO user_onboarding_profiles')
    );
    const nutritionGoalUpsert = queries.find(
      (query) =>
        query.text.includes('INSERT INTO user_goals') &&
        query.values[1] === 'nutrition_calories'
    );
    const answerUpdates = queries.filter((query) =>
      query.text.includes('INSERT INTO user_onboarding_answers')
    );

    assert.deepEqual(profileInsert.values.slice(-3), [160, 80, 31.3]);
    assert.deepEqual(nutritionGoalUpsert.values.slice(0, 5), [
      1,
      'nutrition_calories',
      2150,
      'kcal',
      'system_default',
    ]);
    assert.deepEqual(JSON.parse(nutritionGoalUpsert.values[5]), {
      balanced_kcal: 2150,
      balanced_kcal_source: 'wellness_profile',
      calculation_basis: 'age_height_weight_bmi_lifestyle',
    });
    assert.ok(
      answerUpdates.some(
        (query) => query.values[1] === 'height_cm' && query.values[4] === '160'
      )
    );
    assert.ok(
      answerUpdates.some(
        (query) => query.values[1] === 'weight_kg' && query.values[4] === '80'
      )
    );
    assert.equal(response.profile.bmi, 31.3);
  } finally {
    pool.connect = originalConnect;
  }
});

test('burnout baseline retake rejects invalid user ids before database work', async () => {
  await assert.rejects(
    () => updateUserBurnoutBaseline(0, { burnout_answers: baselineAnswers() }),
    (error) =>
      error instanceof OnboardingServiceError &&
      error.message === 'Valid user_id is required'
  );
});

test('burnout baseline retake requires all dimension answers', async () => {
  await assert.rejects(
    () => updateUserBurnoutBaseline(1, { burnout_answers: [] }),
    (error) =>
      error instanceof OnboardingServiceError &&
      error.message === 'ee_01 must be from 1 to 5'
  );
});

test('burnout baseline retake rejects invalid Likert values', async () => {
  const answers = baselineAnswers();
  answers[0] = { question_key: 'ee_01', numeric_value: 6 };

  await assert.rejects(
    () =>
      updateUserBurnoutBaseline(1, {
        burnout_answers: answers,
      }),
    (error) =>
      error instanceof OnboardingServiceError &&
      error.message === 'ee_01 must be from 1 to 5'
  );
});

test('burnout baseline retake rejects users without onboarding profiles', async () => {
  const originalConnect = pool.connect;
  const queries = [];
  const fakeClient = {
    async query(text) {
      queries.push(text);

      if (text === 'BEGIN' || text === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('SELECT user_id FROM users')) {
        return { rowCount: 1, rows: [{ user_id: 1 }] };
      }

      if (text.includes('UPDATE user_onboarding_profiles')) {
        return { rowCount: 0, rows: [] };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };

  pool.connect = async () => fakeClient;

  try {
    await assert.rejects(
      () =>
        updateUserBurnoutBaseline(1, {
          burnout_answers: baselineAnswers(),
        }),
      (error) =>
        error instanceof OnboardingServiceError &&
        error.message === 'Onboarding profile not found' &&
        error.statusCode === 404
    );
  } finally {
    pool.connect = originalConnect;
  }

  assert.ok(queries.includes('ROLLBACK'));
});
