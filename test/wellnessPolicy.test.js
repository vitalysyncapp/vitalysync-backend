import assert from 'node:assert/strict';
import test from 'node:test';
import { EVIDENCE_REGISTER, WELLNESS_POLICY_VERSION, summarizeObservations, compareRecordedWeeks, selectWellnessRecommendations } from '../src/services/wellnessEvidencePolicy.js';
import { buildAiContext, isApprovedNudgeWording } from '../src/services/aiNudgeService.js';
import { getAdaptiveNudgeRecommendations } from '../src/services/adaptiveNudgeService.js';
import { upsertBurnoutScoreForDate, upsertBurnoutScoresForRange } from '../src/services/burnoutScoringService.js';

const input = { age: 25, endDate: '2026-10-14', logs: [], goals: [], activity: [], assessment: null };
test('wellness summaries keep missing values absent, recorded zero, and require three dates per window', () => {
  const current = summarizeObservations([{ log_date: '2026-10-14', hydration_liters: 0 }, { log_date: '2026-10-13', hydration_liters: null }], 'hydration_liters');
  assert.deepEqual(current, { mean: 0, recorded_days: 1 });
  assert.deepEqual(summarizeObservations([], 'sleep_hours'), { mean: null, recorded_days: 0 });
  assert.equal(compareRecordedWeeks(current, { mean: 2, recorded_days: 3 }).delta, null);
  assert.equal(compareRecordedWeeks({ mean: 1, recorded_days: 3 }, { mean: 2, recorded_days: 3 }).delta, -1);
});
test('sleep advice requires sufficient observations and source population, or an explicit goal', () => {
  const logs = [12, 13, 14].map((day) => ({ log_date: `2026-10-${day}`, sleep_hours: 6 }));
  assert.equal(selectWellnessRecommendations({ ...input, logs: logs.slice(1) }).length, 0);
  assert.equal(selectWellnessRecommendations({ ...input, logs, age: 65 }).length, 0);
  const [rec] = selectWellnessRecommendations({ ...input, logs });
  assert.match(rec.trigger_reason, /6 hours.*3 days/);
  assert.equal(rec.metadata.evidence, EVIDENCE_REGISTER.REC01);
  assert.equal(selectWellnessRecommendations({ ...input, age: null, logs }).length, 0);
  assert.equal(selectWellnessRecommendations({ ...input, logs: logs.map((row) => ({ ...row, sleep_hours: 10 })) }).length, 0);
});
test('individual context is dated, expires for advice, and the CBI result never changes selection or urgency', () => {
  const assessment = { completed_at: '2026-10-13T12:00:00Z', cbi_score: 0, context: { context1: 4, context4: 2 } };
  const recs = selectWellnessRecommendations({ ...input, assessment });
  assert.deepEqual(recs.map((rec) => rec.metadata.recommendation_id), ['REC03', 'REC04']);
  assert.ok(recs.every((rec) => rec.priority === 'low' && rec.metadata.policy_version === WELLNESS_POLICY_VERSION));
  assert.deepEqual(selectWellnessRecommendations({ ...input, assessment: { ...assessment, cbi_score: 100 } }), recs);
  assert.equal(selectWellnessRecommendations({ ...input, assessment: { ...assessment, completed_at: '2026-08-01T12:00:00Z' } }).length, 0);
});
test('movement uses the chosen goal and keeps recovery safeguards; hydration needs a record and goal', () => {
  const goals = [{ source: 'user', goal_type: 'daily_steps', target_value: 5000 }, { source: 'user', goal_type: 'hydration_liters', target_value: 2 }];
  assert.equal(selectWellnessRecommendations({ ...input, goals }).length, 0);
  const recs = selectWellnessRecommendations({ ...input, goals, activity: [{ log_date: input.endDate, steps: 1000 }], logs: [{ log_date: input.endDate, hydration_liters: 0, energy_level: 1 }] });
  assert.match(recs[0].message, /rest or comfortable gentle movement/);
  assert.match(recs[1].trigger_reason, /0 L/);
  assert.doesNotMatch(JSON.stringify(recs), /dehydrated|critical|urgent/);
});
test('AI sees approved action and observation only and cannot invent advice or evidence', () => {
  const [rec] = selectWellnessRecommendations({ ...input, goals: [{ source: 'user', goal_type: 'sleep_hours', target_value: 8 }] });
  const context = buildAiContext(rec, { latest_score: { overall_score: 99, risk_level: 'critical' } }, {});
  assert.doesNotMatch(JSON.stringify(context), /latest_score|critical|risk_level|burnout_context/);
  const output = { title: rec.title, message: rec.message, suggested_action: rec.action_label, why_this_matters: rec.trigger_reason, action_steps: [], safety_note: '' };
  assert.equal(isApprovedNudgeWording(output, rec), true);
  assert.equal(isApprovedNudgeWording({ ...output, message: 'Exercise vigorously to treat burnout.' }, rec), false);
  assert.equal(isApprovedNudgeWording({ ...output, why_this_matters: 'A clinical study proves this.' }, rec), false);
});
test('retired internal scoring helpers reject before any query regardless of the assessment flag', async () => {
  const db = { query() { assert.fail('Retired formula must not read or write'); } };
  for (const scorer of [() => upsertBurnoutScoreForDate(db, 1, input.endDate), () => upsertBurnoutScoresForRange(db, 1, input.endDate, input.endDate)]) {
    await assert.rejects(scorer(), { code: 'LEGACY_SCORING_RETIRED', statusCode: 410 });
  }
});
