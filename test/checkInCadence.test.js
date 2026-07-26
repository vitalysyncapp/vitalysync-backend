import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateFirstPulseDueDate,
  calculateMostRecentPulseDate,
  calculateNextPulseDueDate,
  calculateUpcomingPulseDate
} from '../src/services/checkInCadence.js';

test('first pulse waits seven days and then uses the configured weekday', () => {
  assert.equal(calculateFirstPulseDueDate('2026-05-18', 1), '2026-05-25');
  assert.equal(calculateFirstPulseDueDate('2026-05-19', 1), '2026-06-01');
  assert.equal(calculateFirstPulseDueDate('2026-05-18', 5), '2026-05-29');
});

test('next pulse resumes on the next configured weekday without a backlog', () => {
  assert.equal(calculateNextPulseDueDate('2026-05-25', 1), '2026-06-01');
  assert.equal(calculateNextPulseDueDate('2026-05-27', 1), '2026-06-01');
  assert.equal(calculateNextPulseDueDate('2026-06-10', 5), '2026-06-12');
});

test('upcoming pulse date includes today when reminder weekday changes', () => {
  assert.equal(calculateUpcomingPulseDate('2026-05-22', 5), '2026-05-22');
  assert.equal(calculateUpcomingPulseDate('2026-05-23', 5), '2026-05-29');
});

test('latest missed pulse collapses older weekly cycles', () => {
  assert.equal(calculateMostRecentPulseDate('2026-06-10', 1), '2026-06-08');
  assert.equal(calculateMostRecentPulseDate('2026-06-12', 5), '2026-06-12');
});

test('cadence helpers reject invalid calendar dates', () => {
  assert.equal(calculateFirstPulseDueDate('2026-02-30', 1), null);
  assert.equal(calculateNextPulseDueDate('not-a-date', 1), null);
});
