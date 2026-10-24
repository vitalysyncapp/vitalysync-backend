import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyContent, selectContent, interactionPatch, saveContentEvent, buildWellnessContext, personalEvidence } from '../src/services/wellnessContentService.js';
import { wellnessVariants, nutritionVariants } from '../src/services/wellnessCopy.js';
import { applyCompanionWording, enhanceCompanionWording } from '../src/services/companionWordingService.js';
import { buildPersonalInsightCandidates } from '../src/services/personalInsightService.js';
import { applyRecentFeedback, personalizeNudgeRecommendation } from '../src/services/adaptiveNudgeService.js';
import { validateNudgeCopy } from '../src/services/nudgeCopyPolicy.js';

const now = new Date('2026-10-15T02:00:00Z');
const base = { nudge_type: 'recovery_break', priority: 'medium', severity: 'watch', recommended_focus: 'recovery', trigger_reason: 'Recovery in recent check-ins', metadata: {} };
const variants = (context = { score: 55 }, locale = 'en') => wellnessVariants(base, locale).map((item) => identifyContent(item, { surface: 'wellness', context, locale, now }));
const exposure = (item, at = now) => ({ nudge_event_id: 7, status: 'shown', message: item.message,
  metadata: { ...item.metadata, displayed_at: at.toISOString() }, created_at: at.toISOString() });

test('all authored wellness families have three distinct, bounded bilingual variants', () => {
  for (const locale of ['en', 'fil']) {
    for (const focus of ['recovery', 'workload', 'progress', 'connection', 'maintenance', 'data_completion', 'support']) {
      const candidates = wellnessVariants({ ...base, recommended_focus: focus, severity: focus === 'support' ? 'needs support' : 'watch' }, locale);
      assert.equal(candidates.length, 3);
      assert.equal(new Set(candidates.map((item) => item.message)).size, 3);
      for (const item of candidates) {
        const validation = validateNudgeCopy({ title: item.title, message: item.message, actionLabel: item.action_label });
        assert.deepEqual(validation.errors, [], `${locale}/${focus}: ${item.message}`);
      }
    }
  }
});

test('a short username does not accidentally replace unnamed personalized copy', () => {
  const item = variants()[0];
  assert.equal(personalizeNudgeRecommendation(item, { displayName: 'a', profile: {} }).message, item.message);
});

test('refreshes reuse displayed content but new evidence invalidates it', () => {
  const first = selectContent(variants(), [], { now });
  const history = [exposure(first)];
  const again = selectContent(variants(), history, { now: new Date(now.getTime() + 3600000) });
  assert.equal(again.metadata.content_id, first.metadata.content_id);
  assert.equal(again.metadata.reused_content, true);
  const changed = selectContent(variants({ score: 65 }), history, { now });
  assert.notEqual(changed.metadata.context_hash, first.metadata.context_hash);
  assert.notEqual(changed.metadata.content_id, first.metadata.content_id);
});

test('done, another idea and snooze exclude an action without disliking its focus', () => {
  const first = selectContent(variants(), [], { now });
  for (const interaction of ['done', 'another_idea', 'not_now']) {
    const event = exposure(first);
    Object.assign(event, interactionPatch(event, interaction, now));
    assert.notEqual(event.metadata.helpfulness, 'dislike');
    const next = selectContent(variants(), [event], { now });
    assert.notEqual(next.metadata.action_id, first.metadata.action_id);
    assert.equal(selectContent([variants()[0]], [event], { now }), null);
  }
});

test('helpfulness and repeated exposure never erase completion or reset display time', () => {
  let event = exposure(selectContent(variants(), [], { now }));
  event = { ...event, ...interactionPatch(event, 'done', now) };
  event = { ...event, ...interactionPatch(event, 'like', now) };
  event = { ...event, ...interactionPatch(event, 'shown', new Date(now.getTime() + 10000)) };
  assert.equal(event.status, 'completed');
  assert.equal(event.metadata.completed_at, now.toISOString());
  assert.equal(event.metadata.displayed_at, now.toISOString());
  assert.equal(event.metadata.helpfulness, 'like');
});

test('explicit responses are honored, while repetition alone never hides strong guidance', () => {
  const candidates = variants();
  const history = candidates.map((item) => {
    const event = exposure(item);
    return { ...event, ...interactionPatch(event, 'another_idea', now) };
  });
  assert.equal(selectContent(candidates, history, { now }), null);
  assert.ok(selectContent(candidates, [exposure(candidates[0])], { now }));
});

test('a simulated week rotates wording and actions without refresh churn', () => {
  const history = [];
  const messages = [];
  for (let day = 0; day < 7; day++) {
    const at = new Date(now.getTime() + day * 86400000);
    const item = selectContent(variants(), history, { now: at });
    messages.push(item.message);
    if (day) assert.notEqual(item.message, messages[day - 1]);
    history.unshift(exposure(item, at));
    assert.equal(selectContent(variants(), history, { now: at }).message, item.message);
  }
  assert.equal(new Set(messages).size, 3);
  assert.equal(new Set(history.map((event) => event.metadata.content_id)).size, 7);
});

test('dashboard and nutrition impressions do not spend the wellness notification allowance', () => {
  const history = ['dashboard', 'nutrition'].map((surface) => ({ ...exposure(variants()[0]), metadata: { surface } }));
  const ranked = applyRecentFeedback([base], history, { cooldownHours: 8, maxDailyNudges: 1, preferredNudgeStyle: 'Gentle' });
  assert.equal(ranked[0].metadata.throttled, false);
});

test('observations describe the evidence without duplicating an action or inventing progress', () => {
  const summary = { end_date: '2026-10-15', latest_score: { score_date: '2026-10-15' },
    adaptive_state: { state: 'improving', confidence_score: 80 } };
  for (const locale of ['en', 'fil']) {
    const items = buildPersonalInsightCandidates(summary, { locale, now });
    assert.equal(items.length, 3);
    assert.equal(items[0].action_label, '');
    assert.match(items[0].metadata.evidence, /2026-10-15/);
    assert.ok(items.every((item) => item.message.length <= 140));
  }
  const learning = buildPersonalInsightCandidates({ ...summary, adaptive_state: { state: 'improving', confidence_score: 20 } }, { now });
  assert.match(learning[0].metadata.action_id, /learning/);
  assert.equal(buildPersonalInsightCandidates({}, { now }).length, 0);
});

test('context fingerprint ignores generation time and evidence uses only recorded facts', () => {
  const summary = { latest_score: { score_date: '2026-10-15', source_snapshot: { daily_log: { sleep_hours: 6.5 } } } };
  assert.deepEqual(buildWellnessContext({ ...summary, generated_at: 'a' }), buildWellnessContext({ ...summary, generated_at: 'b' }));
  assert.match(personalEvidence(summary, { wellness_goal: 'Improve sleep' }, 'recovery'), /6.5 hours/);
  assert.equal(personalEvidence({}, {}, 'recovery'), '');
});

test('personal insights use actual recorded comparisons only with enough coverage', () => {
  const summary = { end_date: '2026-10-15', latest_score: {}, adaptive_state: { state: 'improving', confidence_score: 80 },
    windows: { '7_day': { available_days: 4, latest_score: 42, delta_from_start: -8 } } };
  for (const locale of ['en', 'fil']) {
    const items = buildPersonalInsightCandidates(summary, { locale });
    for (const item of items) {
      assert.match(item.message, /42/);
      assert.match(item.message, /50/);
      assert.ok(item.message.length <= 140);
    }
  }
  summary.windows['7_day'].available_days = 1;
  assert.doesNotMatch(buildPersonalInsightCandidates(summary)[0].message, /42|50/);
});

test('natural wording preserves actions and rejects new measurements, claims and unknown action IDs', async () => {
  const item = variants()[0];
  const valid = { title: 'A moment for you', encouragement: 'There is no need to rush.', approved_action: item.message, action_id: item.metadata.action_id };
  assert.ok(applyCompanionWording(item, valid).message.startsWith(item.message + '\n\n'));
  for (const output of [{ ...valid, encouragement: 'You slept 8 hours.' }, { ...valid, title: 'Your stress improved.' }, { ...valid, action_id: 'other' }]) {
    assert.equal(applyCompanionWording(item, output), null);
  }
  const fallback = await enhanceCompanionWording(item, { generate: async () => { throw new Error('offline'); } });
  assert.equal(fallback.message, item.message);
  assert.equal(fallback.metadata.ai_fallback, true);
});

test('nutrition variants keep missing logs distinct from missed meals', () => {
  for (const locale of ['en', 'fil']) {
    const items = nutritionVariants({ title: 'Log your next meal', metadata: { macro_focus: 'complete_meal' } }, locale);
    assert.equal(new Set(items.map((item) => item.message)).size, 3);
    assert.ok(items.every((item) => item.message.length <= 180));
    assert.doesNotMatch(items.map((item) => item.message).join(' '), /skipped|did not eat|hindi kumain/i);
  }
});

test('display persistence locks and reuses identity instead of inserting a duplicate', async () => {
  const item = selectContent(variants(), [], { now });
  const queries = [];
  const row = { ...exposure(item), user_id: 1, nudge_type: 'recovery_break' };
  const client = { release() {}, async query(sql, values) {
    queries.push(sql);
    if (sql.startsWith('SELECT *')) return { rows: [row] };
    if (sql.startsWith('UPDATE')) return { rows: [{ ...row, status: values[2], metadata: JSON.parse(values[3]) }] };
    return { rows: [] };
  } };
  const saved = await saveContentEvent({ connect: async () => client }, 1, { ...item, metadata: item.metadata }, 'shown');
  assert.equal(saved.nudge_event_id, row.nudge_event_id);
  assert.ok(queries[1].includes('pg_advisory_xact_lock'));
  assert.equal(queries.some((sql) => sql.startsWith('INSERT')), false);
  assert.equal(queries.at(-1), 'COMMIT');
});
