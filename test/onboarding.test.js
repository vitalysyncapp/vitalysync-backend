import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OnboardingServiceError,
  submitRequiredOnboarding,
} from '../src/services/onboarding.service.js';

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
