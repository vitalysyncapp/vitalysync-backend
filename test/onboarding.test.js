import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OnboardingServiceError,
  submitRequiredOnboarding,
  updateUserBurnoutBaseline,
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
