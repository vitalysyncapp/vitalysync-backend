import assert from 'node:assert/strict';
import test from 'node:test';

import {
  burnoutQuestionKeys,
  calculateBurnoutBaselineScore,
  calculateDailyBurnoutSnapshot,
  getWeekStartDate,
} from '../src/services/burnoutScoringEngine.js';

function completeBaselineAnswers(value) {
  return [
    ...burnoutQuestionKeys.emotional_exhaustion,
    ...burnoutQuestionKeys.depersonalization,
    ...burnoutQuestionKeys.personal_accomplishment,
  ].reduce((answers, key) => {
    answers[key] = value;
    return answers;
  }, {});
}

test('burnout baseline scoring classifies complete low-risk answers', () => {
  const score = calculateBurnoutBaselineScore({
    ...completeBaselineAnswers(1),
    pa_01: 5,
    pa_02: 5,
    pa_03: 5,
    pa_04: 5,
    pa_05: 5,
  });

  assert.equal(score.initial_burnout_level, 'Low');
  assert.equal(score.initial_burnout_score, 20);
  assert.equal(score.emotional_exhaustion_score, 1);
});

test('daily burnout scoring uses logs, pulse, activity, profile, and habits', () => {
  const snapshot = calculateDailyBurnoutSnapshot({
    userId: 3,
    scoreDate: '2026-05-18',
    weekStartDate: '2026-05-18',
    dailyLog: {
      sleep_hours: 5.5,
      sleep_quality: 1,
      mood_index: 1,
      energy_level: 0,
      hydration_liters: 0.8,
      workload_hours_band: '8-9 hours',
      perceived_stress_level: 5,
      break_quality_level: 1,
      symptom_names: ['Fatigue', 'Anxiety'],
      habit_names: ['None'],
    },
    weeklyPulse: {
      productivity_focus_level: 2,
      recovery_rest_level: 2,
      detachment_level: 4,
      accomplishment_level: 2,
    },
    activityLog: {
      active_minutes: 5,
      goal_completed: false,
    },
    profile: {
      workload_level: 4,
      initial_burnout_score: 40,
    },
  });

  assert.ok(snapshot);
  assert.equal(snapshot.user_id, 3);
  assert.equal(snapshot.scoring_version, 'phase2_v2');
  assert.ok(snapshot.overall_score > 50);
  assert.ok(snapshot.contributing_factors.length > 0);
  assert.ok(
    snapshot.missing_fields.every((field) => typeof field === 'string')
  );
});

test('burnout scoring exposes week start normalization for score refreshes', () => {
  assert.equal(getWeekStartDate('2026-05-18'), '2026-05-18');
  assert.equal(getWeekStartDate('2026-05-24'), '2026-05-18');
});
