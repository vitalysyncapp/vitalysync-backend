import assert from 'node:assert/strict';
import test from 'node:test';
import { BURNOUT_QUESTIONS, BURNOUT_QUESTIONNAIRE_VERSION, WEEKLY_BURNOUT_QUESTIONS, WEEKLY_QUESTIONNAIRE_VERSION, calculateQuestionnaireDimensions, normalizeBurnoutAnswers } from '../../src/services/burnoutQuestionnaire.js';
import { calculateBurnoutBaselineScore, calculateDailyBurnoutSnapshot } from '../../src/services/burnoutScoringEngine.js';
import { normalizeDailyCheckIn } from '../../src/services/checkInValidation.service.js';
import { submitWeeklyAssessment } from '../../src/services/weeklyAssessment.service.js';
import { buildReportMetrics } from '../../src/services/reportMetrics.service.js';

const answers = (value) => Object.fromEntries(BURNOUT_QUESTIONS.map((item) => [item.question_key, value]));
const weeklyAnswers = (value) => Object.fromEntries(WEEKLY_BURNOUT_QUESTIONS.map((item) => [item.question_key, value]));
const daily = {
  questionnaire_version: 'daily_14_v2', sleep_hours: 7, sleep_quality: 3,
  mood_index: 3, energy_level: 4, hydration_liters: 2, workload_hours_band: '3-4 hours',
  exercise_names: ['Walking'], symptom_names: ['None'], habit_names: ['Quiet break'],
  perceived_stress_level: 3, break_quality_level: 4, daily_detachment_level: 2,
  daily_focus_level: 4, daily_accomplishment_level: 4
};

test('22-item adaptation scores nine, five, and eight items separately on 1-5', () => {
  assert.equal(BURNOUT_QUESTIONS.length, 22);
  for (const value of [1, 3, 5]) {
    const scores = calculateQuestionnaireDimensions(answers(value));
    assert.equal(scores.emotional_exhaustion.total, value * 9);
    assert.equal(scores.depersonalization.total, value * 5);
    assert.equal(scores.personal_accomplishment.total, value * 8);
    assert.equal(scores.personal_accomplishment.mean, value);
    assert.equal(scores.personal_accomplishment.higher_is, 'more_accomplishment');
  }
  const mixed = { ...answers(3), ee_01: 5, pa_08: 1 };
  assert.equal(calculateQuestionnaireDimensions(mixed).emotional_exhaustion.mean, 3.22);
  assert.equal(calculateQuestionnaireDimensions(mixed).personal_accomplishment.mean, 2.75);
});

test('questionnaire rejects missing, duplicate, unknown, non-integer and unsupported answers', () => {
  for (const value of [null, '', false, '3', 0, 6, 1.5]) {
    assert.throws(() => normalizeBurnoutAnswers({ ...answers(3), ee_01: value }));
  }
  const missing = answers(3); delete missing.pa_08;
  assert.throws(() => normalizeBurnoutAnswers(missing));
  assert.throws(() => normalizeBurnoutAnswers({ ...answers(3), extra: 1 }));
  assert.throws(() => normalizeBurnoutAnswers(answers(3), 'unknown'));
  assert.throws(() => normalizeBurnoutAnswers([
    ...BURNOUT_QUESTIONS.map((item) => ({ question_key: item.question_key, numeric_value: 3 })),
    { question_key: 'ee_01', numeric_value: 3 }
  ]));
});

test('weekly form requires eleven answers and scores five, three, and three items', () => {
  assert.equal(WEEKLY_BURNOUT_QUESTIONS.length, 11);
  for (const value of [1, 3, 5]) {
    const scores = calculateQuestionnaireDimensions(weeklyAnswers(value), WEEKLY_QUESTIONNAIRE_VERSION);
    assert.equal(scores.emotional_exhaustion.total, 5 * value);
    assert.equal(scores.depersonalization.total, 3 * value);
    assert.equal(scores.personal_accomplishment.total, 3 * value);
    assert.equal(scores.personal_accomplishment.mean, value);
    assert.equal(scores.personal_accomplishment.maximum, 15);
  }
  const missing = weeklyAnswers(3); delete missing.pa_03;
  assert.throws(() => normalizeBurnoutAnswers(missing, WEEKLY_QUESTIONNAIRE_VERSION));
  assert.throws(() => normalizeBurnoutAnswers(answers(3), WEEKLY_QUESTIONNAIRE_VERSION));
  assert.throws(() => normalizeBurnoutAnswers(weeklyAnswers(3), BURNOUT_QUESTIONNAIRE_VERSION));
  const mixed = calculateQuestionnaireDimensions({ ...weeklyAnswers(1), ee_05: 5, dp_03: 4, pa_03: 4 }, WEEKLY_QUESTIONNAIRE_VERSION);
  assert.equal(mixed.emotional_exhaustion.mean, 1.8);
  assert.equal(mixed.depersonalization.mean, 2);
  assert.equal(mixed.personal_accomplishment.mean, 2);
});

test('baseline still uses all twenty-two answers, including items omitted from weekly form', () => {
  const result = calculateBurnoutBaselineScore({ ...answers(1), ee_09: 5, dp_05: 5, pa_08: 5 }, BURNOUT_QUESTIONNAIRE_VERSION);
  assert.equal(result.emotional_exhaustion_score, 1.44);
  assert.equal(result.depersonalization_score, 1.8);
  assert.equal(result.personal_accomplishment_score, 1.5);
});

test('weekly-day daily scoring excludes omitted reflections and keeps full nine-input coverage', () => {
  const core = { ...daily, questionnaire_version: 'daily_core9_v3' };
  for (const field of ['perceived_stress_level', 'break_quality_level', 'daily_detachment_level', 'daily_focus_level', 'daily_accomplishment_level']) delete core[field];
  const normalized = normalizeDailyCheckIn({ schema_version: 3, daily: core });
  assert.equal(normalized.questionnaire_version, 'daily_core9_v3');
  assert.equal(normalized.perceived_stress_level, null);
  assert.throws(() => normalizeDailyCheckIn({ schema_version: 3, daily: { ...core, perceived_stress_level: 5 } }));
  assert.throws(() => normalizeDailyCheckIn({ schema_version: 3, daily: { ...core, energy_level: null } }));
  const inputs = { userId: 1, scoreDate: '2026-10-14', dailyLog: core, profile: { initial_burnout_score: 25 } };
  const score = calculateDailyBurnoutSnapshot(inputs);
  const retainedOldAnswers = calculateDailyBurnoutSnapshot({ ...inputs, dailyLog: { ...daily, questionnaire_version: 'daily_core9_v3' }, weeklyPulse: { perceived_pressure_level: 5 }, baselineEvidence: { weeklyPulseCount: 50 } });
  assert.deepEqual(score, retainedOldAnswers);
  assert.equal(score.scoring_version, 'burnout_engine_v6_core9_v1');
  assert.equal(score.data_points_count, 9);
  assert.equal(score.completeness_score, 100);
  assert.deepEqual(score.missing_fields, []);
  assert.equal(score.source_snapshot.daily_log.daily_focus_level, null);
  assert.ok(calculateDailyBurnoutSnapshot({ ...inputs, dailyLog: { ...core, energy_level: 1 } }).overall_score > score.overall_score);
});

test('baseline uses dimension means with equal dimension weights and reverses only accomplishment', () => {
  const result = calculateBurnoutBaselineScore({ ...answers(1), ...Object.fromEntries(BURNOUT_QUESTIONS.filter((q) => q.category === 'personal_accomplishment').map((q) => [q.question_key, 5])) }, BURNOUT_QUESTIONNAIRE_VERSION);
  assert.equal(result.baseline_average, 1);
  assert.equal(result.initial_burnout_level, 'Very Low');
  assert.equal(result.personal_accomplishment_score, 5);
});

test('restored daily questionnaire requires and preserves all five restored fields', () => {
  const result = normalizeDailyCheckIn({ schema_version: 2, daily });
  for (const key of ['perceived_stress_level', 'break_quality_level', 'daily_detachment_level', 'daily_focus_level', 'daily_accomplishment_level']) {
    assert.equal(result[key], daily[key]);
    assert.throws(() => normalizeDailyCheckIn({ schema_version: 2, daily: { ...daily, [key]: null } }));
  }
  assert.equal(result.questionnaire_version, 'daily_14_v2');
});

test('weekly answers and weekly participation cannot change the restored daily index', () => {
  const inputs = { userId: 1, scoreDate: '2026-10-14', dailyLog: daily, profile: { initial_burnout_score: 25 } };
  const first = calculateDailyBurnoutSnapshot(inputs);
  const second = calculateDailyBurnoutSnapshot({ ...inputs, weeklyPulse: { perceived_pressure_level: 5, detachment_level: 5, recovery_rest_level: 1 }, baselineEvidence: { weeklyPulseCount: 10 } });
  assert.deepEqual(first, second);
  assert.equal(first.data_points_count, 14);
  assert.equal(first.completeness_score, 100);
  assert.equal(first.scoring_version, 'burnout_engine_v5_daily14_v1');
});

test('weekly saves use the cycle identity and never write daily logs, streaks, or index scores', async () => {
  const commands = [];
  let advances = 0;
  const client = {
    async query(sql, params) {
      commands.push(sql);
      return { rows: sql.includes('INSERT INTO weekly_burnout_assessments') ? [{ due_date: params[1], response_date: params[2], scores: JSON.parse(params[5]) }] : [] };
    }, release() {}
  };
  const payload = { due_date: '2026-10-12', response_date: '2026-10-14', questionnaire_version: BURNOUT_QUESTIONNAIRE_VERSION, answers: answers(3) };
  const options = {
    userId: 1, payload, database: { connect: async () => client },
    scheduleReader: async () => ({ nextDueDate: '2026-10-12', pulseWeekday: 1 }),
    scheduleAdvancer: async () => { advances++; }
  };
  const result = await submitWeeklyAssessment(options);
  assert.equal(result.assessment.scores.emotional_exhaustion.total, 27);
  await submitWeeklyAssessment({ ...options, scheduleReader: async () => ({ nextDueDate: '2026-10-19', lastCompletedDueDate: '2026-10-12', pulseWeekday: 1 }) });
  // A queued older cycle must not rewind a schedule already rolled forward.
  await submitWeeklyAssessment({ ...options, scheduleReader: async () => ({ nextDueDate: '2026-10-26', lastCompletedDueDate: '2026-10-05', pulseWeekday: 1 }) });
  assert.equal(advances, 1);
  assert.ok(commands.some((sql) => sql.includes('ON CONFLICT (user_id, due_date)')));
  assert.ok(commands.every((sql) => !/daily_logs|user_streaks|burnout_score_history/.test(sql)));
  await assert.rejects(submitWeeklyAssessment({ ...options, payload: { ...payload, due_date: '2026-10-19' } }));
  const short = await submitWeeklyAssessment({ ...options, payload: {
    ...payload, questionnaire_version: WEEKLY_QUESTIONNAIRE_VERSION, answers: weeklyAnswers(5)
  } });
  assert.equal(short.assessment.scores.emotional_exhaustion.total, 25);
  assert.equal(short.assessment.scores.personal_accomplishment.maximum, 15);
  assert.ok(commands.some((sql) => sql.includes('questionnaire_version = EXCLUDED.questionnaire_version')));
});

test('reports keep weekly dimension values separate from legacy pulse and index values', () => {
  const metrics = buildReportMetrics({ now: new Date('2026-10-14T00:00:00Z'), weeklyAssessments: [
    { response_date: '2026-10-14', questionnaire_version: WEEKLY_QUESTIONNAIRE_VERSION, scores: calculateQuestionnaireDimensions(weeklyAnswers(5), WEEKLY_QUESTIONNAIRE_VERSION) },
    { response_date: '2026-10-13', questionnaire_version: BURNOUT_QUESTIONNAIRE_VERSION, scores: calculateQuestionnaireDimensions(answers(1)) }
  ] });
  assert.equal(metrics.questionnaire.week.personal_accomplishment, 5);
  assert.equal(metrics.questionnaire.week.count, 1);
  assert.equal(metrics.legacyQuestionnaire.week.count, 1);
  assert.equal(metrics.legacyQuestionnaire.week.personal_accomplishment, 1);
  assert.equal(metrics.pulse.week.count, 0);
  assert.equal(metrics.latestBurnout, null);
});
