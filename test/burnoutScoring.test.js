import assert from 'node:assert/strict';
import test from 'node:test';

import {
  burnoutQuestionKeys,
  calculateBurnoutBaselineScore,
  calculateDailyBurnoutSnapshot,
  getWeekStartDate,
} from '../src/services/burnoutScoringEngine.js';
import { analyzeBurnoutPatterns } from '../src/services/burnoutPatternService.js';

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

function completeDailyLog(overrides = {}) {
  return {
    sleep_hours: 7,
    sleep_quality: 3,
    mood_index: 3,
    energy_level: 3,
    hydration_liters: 2,
    workload_hours_band: '3-4 hours',
    exercise_names: ['Walking'],
    symptom_names: ['None'],
    habit_names: ['Quiet break'],
    ...overrides,
  };
}

function completeWeeklyPulse(overrides = {}) {
  return {
    week_start_date: '2026-05-18',
    due_date: '2026-05-18',
    response_date: '2026-05-18',
    perceived_pressure_level: 3,
    productivity_focus_level: 3,
    recovery_rest_level: 3,
    detachment_level: 3,
    accomplishment_level: 3,
    schema_version: 2,
    ...overrides,
  };
}

test('phase 3 burnout scoring uses daily signals and weekly pulse context', () => {
  const snapshot = calculateDailyBurnoutSnapshot({
    userId: 3,
    scoreDate: '2026-05-18',
    weekStartDate: '2026-05-18',
    dailyLog: completeDailyLog({
      sleep_hours: 5.5,
      sleep_quality: 1,
      mood_index: 1,
      energy_level: 1,
      hydration_liters: 0.8,
      workload_hours_band: '8-9 hours',
      symptom_names: ['Fatigue', 'Anxiety'],
      habit_names: ['None'],
    }),
    weeklyPulse: completeWeeklyPulse({
      perceived_pressure_level: 5,
      productivity_focus_level: 2,
      recovery_rest_level: 2,
      detachment_level: 4,
      accomplishment_level: 2,
    }),
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
  assert.equal(snapshot.scoring_version, 'phase3_v1');
  assert.ok(snapshot.overall_score > 50);
  assert.deepEqual(snapshot.source_snapshot.daily_log.exercise_names, [
    'Walking',
  ]);
  assert.equal(snapshot.source_snapshot.normalized_risks.movementRisk, 45);
  assert.equal(snapshot.source_snapshot.weekly_pulse.freshness, 'current');
  assert.equal(snapshot.source_snapshot.weekly_pulse.age_days, 0);
  assert.equal(snapshot.completeness_score, 100);
  assert.equal(snapshot.confidence_score, 100);
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

test('weekly pulse fields drive moved burnout dimensions', () => {
  const buildSnapshot = ({
    detachmentLevel,
    focusLevel,
    accomplishmentLevel,
  }) => calculateDailyBurnoutSnapshot({
    userId: 3,
    scoreDate: '2026-05-18',
    weekStartDate: '2026-05-18',
    dailyLog: completeDailyLog({
      // These legacy values must not override an available weekly pulse.
      daily_detachment_level: 5,
      daily_focus_level: 1,
      daily_accomplishment_level: 1,
    }),
    weeklyPulse: completeWeeklyPulse({
      productivity_focus_level: focusLevel,
      recovery_rest_level: 3,
      detachment_level: detachmentLevel,
      accomplishment_level: accomplishmentLevel,
    }),
    activityLog: null,
    profile: null,
  });

  const steady = buildSnapshot({
    detachmentLevel: 1,
    focusLevel: 5,
    accomplishmentLevel: 5,
  });
  const strained = buildSnapshot({
    detachmentLevel: 5,
    focusLevel: 1,
    accomplishmentLevel: 1,
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

test('retired daily dimension fields are excluded from completeness', () => {
  const snapshot = calculateDailyBurnoutSnapshot({
    userId: 3,
    scoreDate: '2026-05-18',
    weekStartDate: '2026-05-18',
    dailyLog: completeDailyLog(),
    weeklyPulse: null,
    activityLog: null,
    profile: null,
  });

  assert.ok(snapshot);
  assert.equal(snapshot.completeness_score, 100);
  assert.equal(snapshot.confidence_score, 90);
  assert.deepEqual(snapshot.missing_fields, []);
  assert.equal(snapshot.source_snapshot.weekly_pulse, null);
});

test('weekly pulse age reduces confidence without changing completeness', () => {
  const snapshot = calculateDailyBurnoutSnapshot({
    userId: 3,
    scoreDate: '2026-05-30',
    weekStartDate: '2026-05-25',
    dailyLog: completeDailyLog(),
    weeklyPulse: completeWeeklyPulse({ response_date: '2026-05-18' }),
    activityLog: null,
    profile: null,
  });

  assert.ok(snapshot);
  assert.equal(snapshot.completeness_score, 100);
  assert.equal(snapshot.confidence_score, 94);
  assert.equal(snapshot.source_snapshot.weekly_pulse.age_days, 12);
  assert.equal(snapshot.source_snapshot.weekly_pulse.freshness, 'aging');
});

test('burnout scoring exposes week start normalization for score refreshes', () => {
  assert.equal(getWeekStartDate('2026-05-18'), '2026-05-18');
  assert.equal(getWeekStartDate('2026-05-24'), '2026-05-18');
});

test('pattern summaries expose weekly context and soften low-confidence states', () => {
  const scores = ['2026-05-20', '2026-05-21', '2026-05-22'].map(
    (scoreDate, index) => ({
      score_date: scoreDate,
      overall_score: 82 + index,
      risk_level: 'critical',
      emotional_exhaustion_score: 85,
      detachment_score: 75,
      reduced_accomplishment_score: 70,
      workload_strain_score: 80,
      recovery_deficit_score: 78,
      confidence_score: 40,
      completeness_score: 50,
      source_snapshot: {
        weekly_pulse: {
          response_date: '2026-05-20',
          due_date: '2026-05-18',
          age_days: index,
          freshness: 'current',
        },
      },
    })
  );

  const summary = analyzeBurnoutPatterns(scores, '2026-05-22');

  assert.equal(summary.windows['7_day'].weekly_context.scores_with_context, 3);
  assert.equal(
    summary.windows['7_day'].weekly_context.latest.response_date,
    '2026-05-20'
  );
  assert.equal(summary.adaptive_state.state, 'limited_confidence');
  assert.equal(summary.adaptive_state.priority, 'low');
});
