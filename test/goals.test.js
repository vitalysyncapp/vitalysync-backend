import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GoalsServiceError,
  getUserGoals,
  normalizeGoalsPayload,
} from '../src/services/goals.service.js';
import pool from '../src/config/db.js';

test('goals reject invalid user ids before database work', async () => {
  await assert.rejects(
    () => getUserGoals(0),
    (error) =>
      error instanceof GoalsServiceError &&
      error.message === 'Valid user_id is required'
  );
});

test('goals reject unsupported goal types', () => {
  assert.throws(
    () =>
      normalizeGoalsPayload({
        goals: {
          unknown_goal: { target_value: 10 },
        },
      }),
    (error) =>
      error instanceof GoalsServiceError &&
      error.message === 'Unsupported goal_type: unknown_goal'
  );
});

test('goals validate numeric ranges', () => {
  assert.throws(
    () =>
      normalizeGoalsPayload({
        goals: {
          daily_steps: { target_value: 999 },
        },
      }),
    (error) =>
      error instanceof GoalsServiceError &&
      error.message === 'daily_steps must be between 1000 and 50000'
  );
});

test('goals normalize all supported goal payload values', () => {
  const goals = normalizeGoalsPayload({
    goals: {
      wellness: { target_text: 'Improve sleep' },
      sleep_hours: { target_value: 8 },
      hydration_liters: { target_value: 2.5 },
      activity_days_per_week: { target_value: 4 },
      daily_steps: { target_value: 7000 },
      nutrition_calories: { target_value: 2200 },
    },
  });

  assert.deepEqual(
    goals.map((goal) => goal.goal_type),
    [
      'wellness',
      'sleep_hours',
      'hydration_liters',
      'activity_days_per_week',
      'daily_steps',
      'nutrition_calories',
    ]
  );
  assert.equal(goals.find((goal) => goal.goal_type === 'wellness').target_text, 'Improve sleep');
  assert.equal(goals.find((goal) => goal.goal_type === 'sleep_hours').unit, 'hours');
  assert.equal(goals.find((goal) => goal.goal_type === 'daily_steps').target_value, 7000);
});

test('goals normalize structured wellness goal selections', () => {
  const goals = normalizeGoalsPayload({
    goals: {
      wellness: {
        metadata: {
          selected_goals: ['Manage burnout', 'Improve sleep'],
        },
      },
    },
  });
  const wellness = goals[0];

  assert.equal(wellness.target_text, 'Improve sleep, Manage burnout');
  assert.deepEqual(wellness.metadata.selected_goals, [
    'Improve sleep',
    'Manage burnout',
  ]);
});

test('goals reserve system-generated provenance for backend writes', () => {
  const goals = normalizeGoalsPayload({
    goals: {
      nutrition_calories: {
        target_value: 2100,
        source: 'system_default',
      },
    },
  });

  assert.equal(goals[0].source, 'user');
});

test('goals derive fallback nutrition calories from stored BMI', async () => {
  const originalConnect = pool.connect;
  const fakeClient = {
    async query(text) {
      if (text.includes('SELECT user_id FROM users')) {
        return { rowCount: 1, rows: [{ user_id: 1 }] };
      }

      if (text.includes('FROM user_onboarding_profiles')) {
        return {
          rowCount: 1,
          rows: [
            {
              wellness_goal: 'Improve sleep',
              wellness_goals: ['Improve sleep'],
              lifestyle_type: 'Sedentary',
              exercise_goal_days: '3-4 days',
              bmi: '31.3',
              usual_sleep_time: '22:00',
              usual_wake_time: '06:00',
            },
          ],
        };
      }

      if (text.includes('FROM user_onboarding')) {
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('FROM user_preferences')) {
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('FROM daily_activity_logs')) {
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('FROM user_goals')) {
        return { rowCount: 0, rows: [] };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };

  pool.connect = async () => fakeClient;

  try {
    const result = await getUserGoals(1);
    const nutritionGoal = result.goals.nutrition_calories;

    assert.equal(nutritionGoal.target_value, 1800);
    assert.equal(nutritionGoal.source, 'system_default');
    assert.equal(nutritionGoal.display_value, '1,800 kcal');
  } finally {
    pool.connect = originalConnect;
  }
});

test('goals keep manually saved nutrition calories over BMI fallback', async () => {
  const originalConnect = pool.connect;
  const fakeClient = {
    async query(text) {
      if (text.includes('SELECT user_id FROM users')) {
        return { rowCount: 1, rows: [{ user_id: 1 }] };
      }

      if (text.includes('FROM user_onboarding_profiles')) {
        return {
          rowCount: 1,
          rows: [
            {
              wellness_goal: 'Improve sleep',
              wellness_goals: ['Improve sleep'],
              lifestyle_type: 'Sedentary',
              exercise_goal_days: '3-4 days',
              bmi: '31.3',
              usual_sleep_time: '22:00',
              usual_wake_time: '06:00',
            },
          ],
        };
      }

      if (text.includes('FROM user_onboarding')) {
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('FROM user_preferences')) {
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('FROM daily_activity_logs')) {
        return { rowCount: 0, rows: [] };
      }

      if (text.includes('FROM user_goals')) {
        return {
          rowCount: 1,
          rows: [
            {
              goal_type: 'nutrition_calories',
              target_value: 2400,
              target_text: null,
              unit: 'kcal',
              source: 'user',
              metadata: {},
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    release() {},
  };

  pool.connect = async () => fakeClient;

  try {
    const result = await getUserGoals(1);
    const nutritionGoal = result.goals.nutrition_calories;

    assert.equal(nutritionGoal.target_value, 2400);
    assert.equal(nutritionGoal.source, 'user');
  } finally {
    pool.connect = originalConnect;
  }
});
