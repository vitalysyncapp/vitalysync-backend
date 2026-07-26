import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCheckInDate,
  normalizeDailyCheckIn,
  normalizeWeeklyCheckIn
} from '../src/services/checkInValidation.service.js';

function validDailyPayload() {
  return {
    daily: {
      sleep_hours: 7,
      sleep_quality: 3,
      mood_index: 2,
      energy_level: 4,
      hydration_liters: 2,
      workload_hours_band: '3-4 hours',
      exercise_names: ['Walking'],
      symptom_names: ['None'],
      habit_names: ['Quiet break']
    }
  };
}

test('daily check-in normalizes the nine required inputs', () => {
  const daily = normalizeDailyCheckIn(validDailyPayload());

  assert.equal(daily.sleep_hours, 7);
  assert.equal(daily.energy_level, 4);
  assert.deepEqual(daily.exercise_names, ['Walking']);
  assert.deepEqual(daily.habit_names, ['Quiet break']);
});

test('daily check-in requires an explicit recovery habit selection', () => {
  const payload = validDailyPayload();
  payload.daily.habit_names = [];

  assert.throws(
    () => normalizeDailyCheckIn(payload),
    /At least one recovery habit selection is required/
  );
});

test('daily check-in treats zero hydration as incomplete', () => {
  const payload = validDailyPayload();
  payload.daily.hydration_liters = 0;

  assert.throws(
    () => normalizeDailyCheckIn(payload),
    /Valid hydration_liters is required/
  );
});

test('None cannot be combined with another selection', () => {
  const payload = validDailyPayload();
  payload.daily.symptom_names = ['None', 'Headache'];

  assert.throws(
    () => normalizeDailyCheckIn(payload),
    /None cannot be combined with another symptom selection/
  );
});

test('weekly check-in requires all five moved dimension inputs', () => {
  const weekly = normalizeWeeklyCheckIn({
    weekly: {
      perceived_pressure_level: 3,
      recovery_rest_level: 4,
      detachment_level: 2,
      productivity_focus_level: 4,
      accomplishment_level: 5
    }
  });

  assert.equal(weekly.perceived_pressure_level, 3);
  assert.equal(weekly.accomplishment_level, 5);
});

test('weekly pressure must use the 1 to 5 Likert scale', () => {
  assert.throws(
    () => normalizeWeeklyCheckIn({
      weekly: {
        perceived_pressure_level: 0,
        recovery_rest_level: 4,
        detachment_level: 2,
        productivity_focus_level: 4,
        accomplishment_level: 5
      }
    }),
    /Valid perceived_pressure_level is required/
  );
});

test('check-in date validation rejects impossible dates', () => {
  assert.equal(normalizeCheckInDate('2026-02-28'), '2026-02-28');
  assert.throws(() => normalizeCheckInDate('2026-02-30'), /Valid log_date/);
});
