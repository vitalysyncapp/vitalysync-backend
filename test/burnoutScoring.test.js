import assert from 'node:assert/strict';
import test from 'node:test';

import {
  burnoutQuestionKeys,
  calculateBurnoutBaselineScore,
  calculateDailyBurnoutSnapshot,
  getWeekStartDate,
} from '../src/services/burnoutScoringEngine.js';

function repeated(value) {
  return Array.from({ length: 5 }, () => value);
}

function answersForKeys(keys, values) {
  return keys.reduce((answers, key, index) => {
    answers[key] = values[index];
    return answers;
  }, {});
}

function baselineAnswers({
  emotionalExhaustion,
  depersonalization,
  personalAccomplishment,
}) {
  return {
    ...answersForKeys(
      burnoutQuestionKeys.emotional_exhaustion,
      emotionalExhaustion
    ),
    ...answersForKeys(
      burnoutQuestionKeys.depersonalization,
      depersonalization
    ),
    ...answersForKeys(
      burnoutQuestionKeys.personal_accomplishment,
      personalAccomplishment
    ),
  };
}

test('burnout baseline scoring classifies five-band results', () => {
  const scenarios = [
    {
      level: 'Very Low',
      displayScore: 10,
      answers: baselineAnswers({
        emotionalExhaustion: repeated(1),
        depersonalization: repeated(1),
        personalAccomplishment: repeated(5),
      }),
    },
    {
      level: 'Low',
      displayScore: 25,
      answers: baselineAnswers({
        emotionalExhaustion: repeated(2),
        depersonalization: repeated(2),
        personalAccomplishment: repeated(4),
      }),
    },
    {
      level: 'Moderate',
      displayScore: 35,
      answers: baselineAnswers({
        emotionalExhaustion: repeated(3),
        depersonalization: repeated(3),
        personalAccomplishment: repeated(3),
      }),
    },
    {
      level: 'High',
      displayScore: 45,
      answers: baselineAnswers({
        emotionalExhaustion: repeated(4),
        depersonalization: repeated(4),
        personalAccomplishment: repeated(2),
      }),
    },
    {
      level: 'Very High',
      displayScore: 60,
      answers: baselineAnswers({
        emotionalExhaustion: repeated(5),
        depersonalization: repeated(5),
        personalAccomplishment: repeated(1),
      }),
    },
  ];

  for (const scenario of scenarios) {
    const score = calculateBurnoutBaselineScore(scenario.answers);

    assert.equal(score.initial_burnout_level, scenario.level);
    assert.equal(score.initial_burnout_score, scenario.displayScore);
  }
});

test('burnout baseline scoring handles values near five-band cutoffs', () => {
  const scenarios = [
    {
      level: 'Very Low',
      displayScore: 10,
      answers: baselineAnswers({
        emotionalExhaustion: [1, 1, 1, 2, 2],
        depersonalization: [1, 1, 1, 2, 2],
        personalAccomplishment: [4, 4, 5, 5, 4],
      }),
    },
    {
      level: 'Low',
      displayScore: 25,
      answers: baselineAnswers({
        emotionalExhaustion: [1, 2, 2, 1, 2],
        depersonalization: [1, 2, 2, 1, 2],
        personalAccomplishment: [5, 5, 5, 4, 4],
      }),
    },
    {
      level: 'Low',
      displayScore: 25,
      answers: baselineAnswers({
        emotionalExhaustion: [2, 2, 2, 3, 3],
        depersonalization: [2, 2, 2, 3, 3],
        personalAccomplishment: [3, 3, 3, 4, 4],
      }),
    },
    {
      level: 'Moderate',
      displayScore: 35,
      answers: baselineAnswers({
        emotionalExhaustion: [2, 3, 3, 2, 3],
        depersonalization: [2, 3, 3, 2, 3],
        personalAccomplishment: [4, 4, 4, 3, 3],
      }),
    },
    {
      level: 'Moderate',
      displayScore: 35,
      answers: baselineAnswers({
        emotionalExhaustion: [3, 3, 3, 4, 4],
        depersonalization: [3, 3, 3, 4, 4],
        personalAccomplishment: [2, 2, 2, 3, 3],
      }),
    },
    {
      level: 'High',
      displayScore: 45,
      answers: baselineAnswers({
        emotionalExhaustion: [4, 4, 4, 3, 3],
        depersonalization: [4, 4, 4, 3, 3],
        personalAccomplishment: [3, 3, 3, 2, 2],
      }),
    },
    {
      level: 'High',
      displayScore: 45,
      answers: baselineAnswers({
        emotionalExhaustion: [4, 4, 4, 5, 5],
        depersonalization: [4, 4, 4, 5, 5],
        personalAccomplishment: [1, 1, 1, 2, 2],
      }),
    },
    {
      level: 'Very High',
      displayScore: 60,
      answers: baselineAnswers({
        emotionalExhaustion: [5, 5, 5, 4, 4],
        depersonalization: [5, 5, 5, 4, 4],
        personalAccomplishment: [2, 2, 2, 1, 1],
      }),
    },
  ];

  for (const scenario of scenarios) {
    const score = calculateBurnoutBaselineScore(scenario.answers);

    assert.equal(score.initial_burnout_level, scenario.level);
    assert.equal(score.initial_burnout_score, scenario.displayScore);
  }
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
      energy_level: 1,
      hydration_liters: 0.8,
      workload_hours_band: '8-9 hours',
      perceived_stress_level: 5,
      break_quality_level: 1,
      daily_detachment_level: 5,
      daily_focus_level: 1,
      daily_accomplishment_level: 1,
      exercise_names: ['Walking'],
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
  assert.equal(snapshot.scoring_version, 'phase2_v4');
  assert.ok(snapshot.overall_score > 50);
  assert.deepEqual(snapshot.source_snapshot.daily_log.exercise_names, [
    'Walking',
  ]);
  assert.equal(snapshot.source_snapshot.normalized_risks.movementRisk, 45);
  assert.ok(snapshot.contributing_factors.length > 0);
  assert.ok(
    snapshot.missing_fields.every((field) => typeof field === 'string')
  );
});

test('daily burnout scoring treats higher Likert energy as lower risk', () => {
  const buildSnapshot = (energyLevel) => calculateDailyBurnoutSnapshot({
    userId: 3,
    scoreDate: '2026-05-18',
    weekStartDate: '2026-05-18',
    dailyLog: {
      sleep_hours: 7,
      sleep_quality: 3,
      mood_index: 3,
      energy_level: energyLevel,
      hydration_liters: 2,
      workload_hours_band: '3-4 hours',
      perceived_stress_level: 3,
      break_quality_level: 3,
      daily_detachment_level: 3,
      daily_focus_level: 3,
      daily_accomplishment_level: 3,
      exercise_names: ['Walking'],
      symptom_names: ['None'],
      habit_names: ['Quiet break'],
    },
    weeklyPulse: null,
    activityLog: null,
    profile: null,
  });

  const lowEnergy = buildSnapshot(1);
  const highEnergy = buildSnapshot(5);

  assert.ok(lowEnergy);
  assert.ok(highEnergy);
  assert.ok(lowEnergy.overall_score > highEnergy.overall_score);
});

test('daily burnout scoring uses new daily dimension Likert fields', () => {
  const buildSnapshot = ({
    dailyDetachmentLevel,
    dailyFocusLevel,
    dailyAccomplishmentLevel,
  }) => calculateDailyBurnoutSnapshot({
    userId: 3,
    scoreDate: '2026-05-18',
    weekStartDate: '2026-05-18',
    dailyLog: {
      sleep_hours: 7,
      sleep_quality: 3,
      mood_index: 3,
      energy_level: 3,
      hydration_liters: 2,
      workload_hours_band: '3-4 hours',
      perceived_stress_level: 3,
      break_quality_level: 3,
      daily_detachment_level: dailyDetachmentLevel,
      daily_focus_level: dailyFocusLevel,
      daily_accomplishment_level: dailyAccomplishmentLevel,
      exercise_names: ['Walking'],
      symptom_names: ['None'],
      habit_names: ['Quiet break'],
    },
    weeklyPulse: {
      productivity_focus_level: 3,
      recovery_rest_level: 3,
      detachment_level: 3,
      accomplishment_level: 3,
    },
    activityLog: null,
    profile: null,
  });

  const steady = buildSnapshot({
    dailyDetachmentLevel: 1,
    dailyFocusLevel: 5,
    dailyAccomplishmentLevel: 5,
  });
  const strained = buildSnapshot({
    dailyDetachmentLevel: 5,
    dailyFocusLevel: 1,
    dailyAccomplishmentLevel: 1,
  });

  assert.ok(steady);
  assert.ok(strained);
  assert.ok(strained.detachment_score > steady.detachment_score);
  assert.ok(
    strained.reduced_accomplishment_score >
      steady.reduced_accomplishment_score
  );
  assert.equal(steady.source_snapshot.normalized_risks.movementRisk, 20);
});

test('daily burnout scoring handles old logs missing new daily dimension fields', () => {
  const snapshot = calculateDailyBurnoutSnapshot({
    userId: 3,
    scoreDate: '2026-05-18',
    weekStartDate: '2026-05-18',
    dailyLog: {
      sleep_hours: 7,
      sleep_quality: 3,
      mood_index: 3,
      energy_level: 3,
      hydration_liters: 2,
      workload_hours_band: '3-4 hours',
      perceived_stress_level: 3,
      break_quality_level: 3,
      symptom_names: ['None'],
      habit_names: ['Quiet break'],
    },
    weeklyPulse: null,
    activityLog: null,
    profile: null,
  });

  assert.ok(snapshot);
  assert.ok(snapshot.completeness_score < 100);
  assert.ok(
    snapshot.missing_fields.includes('daily_logs.daily_detachment_level')
  );
  assert.ok(snapshot.missing_fields.includes('daily_logs.daily_focus_level'));
  assert.ok(
    snapshot.missing_fields.includes('daily_logs.daily_accomplishment_level')
  );
  assert.ok(snapshot.missing_fields.includes('daily_logs.exercise_names'));
});

test('burnout scoring exposes week start normalization for score refreshes', () => {
  assert.equal(getWeekStartDate('2026-05-18'), '2026-05-18');
  assert.equal(getWeekStartDate('2026-05-24'), '2026-05-18');
});
