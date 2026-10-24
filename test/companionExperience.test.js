import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPersonalHighlights, validInsightDate, loadPersonalInsightContext } from '../src/services/personalInsightContext.js';
import { buildWellnessInsight, validInsightWording } from '../src/services/personalInsightService.js';
import { enhanceCompanionWording } from '../src/services/companionWordingService.js';
import { personalizeNudgeRecommendation } from '../src/services/adaptiveNudgeService.js';
import { generateCompanionJson } from '../src/services/companionGenerationService.js';
import { wellnessVariants } from '../src/services/wellnessCopy.js';
import { identifyContent, selectContent, interactionPatch, contentSelectionState, parseSelectionOptions } from '../src/services/wellnessContentService.js';
import { buildNutritionAssistantNudgeResponse } from '../src/services/nutritionAssistantNudgeService.js';
import { finalizeSmartNudge, updateSmartNudgeDelivery, readSmartNudge, deliveryClaimable } from '../src/services/smartNudgeDeliveryService.js';

const now = new Date('2026-10-23T10:00:00Z');
const base = { nudge_type: 'maintenance', recommended_focus: 'maintenance', priority: 'low', severity: 'steady' };
const candidates = (context = { sleep: 7 }) => wellnessVariants(base).map((item) => identifyContent(item, { surface: 'wellness', context, now }));
const event = (item, interaction) => ({ ...item, status: 'shown', created_at: now.toISOString(), ...interactionPatch(item, interaction, now) });

test('alternatives exclude actual actions, exhaust, and revisit without overriding completion or snooze', () => {
  const choices = candidates();
  const history = choices.map((item) => event(item, 'another_idea'));
  assert.equal(selectContent(choices, history, { now, selectionMode: 'next' }), null);
  assert.deepEqual(contentSelectionState(choices, history, null, { now }), { status: 'exhausted', can_revisit: true });
  const review = selectContent(choices, history, { now, selectionMode: 'revisit', excludeActionIds: [choices[0].metadata.action_id] });
  assert.notEqual(review.metadata.action_id, choices[0].metadata.action_id);
  const protectedHistory = choices.map((item, i) => event(item, i === 0 ? 'done' : 'not_now'));
  assert.equal(selectContent(choices, protectedHistory, { now, selectionMode: 'revisit' }), null);
  assert.equal(contentSelectionState(choices, protectedHistory, null, { now }).can_revisit, false);
  assert.equal(contentSelectionState([choices[0]], [history[0]], null,
    { now, excludeActionIds: [choices[0].metadata.action_id] }).can_revisit, false, 'the current idea alone is not an earlier alternative');
  assert.ok(selectContent(candidates({ sleep: 8 }), history, { now }));
  assert.ok(selectContent(choices, history, { now: new Date(now.getTime() + 9 * 3600000) }));
});

test('selection inputs reject unsupported modes and excessive or malformed action IDs', () => {
  assert.equal(parseSelectionOptions({ selection_mode: 'random' }), null);
  assert.equal(parseSelectionOptions({ exclude_action_ids: ['break'] }), null);
  assert.equal(parseSelectionOptions({ exclude_action_ids: 'bad/id' }), null);
  assert.deepEqual(parseSelectionOptions({ selection_mode: 'next', exclude_action_ids: 'break,break,walk' }),
    { selectionMode: 'next', excludeActionIds: ['break', 'walk'] });
});

test('nutrition progresses through suitable topics instead of stopping at the first skipped topic', async () => {
  const summary = { day_totals: { total_calories: 500, total_protein_g: 5, total_carbs_g: 140, total_fat_g: 2 },
    meals: [{ meal_type: 'lunch', items: [{ food_name: 'rice' }] }] };
  const history = [];
  const excluded = [];
  const topics = new Set();
  for (let index = 0; index < 20; index++) {
    const item = await buildNutritionAssistantNudgeResponse({ summary, recentEvents: history, now,
      useAi: false, includeSelection: true, selectionMode: 'next', excludeActionIds: excluded });
    if (!item.metadata) {
      assert.equal(item.selection.status, 'exhausted');
      assert.equal(item.selection.can_revisit, true);
      break;
    }
    assert.ok(!excluded.includes(item.metadata.action_id));
    excluded.push(item.metadata.action_id);
    topics.add(item.metadata.macro_focus);
    history.push(event(item, 'another_idea'));
  }
  assert.ok(topics.size > 1, 'must continue beyond one macro focus');
});

test('AI preserves bilingual approved actions and returns complete authored copy on invalid output or failure', async () => {
  for (const locale of ['en', 'fil']) {
    const candidate = wellnessVariants(base, locale)[0];
    const valid = await enhanceCompanionWording(candidate, { locale, generate: async () => ({
      title: locale === 'fil' ? 'Oras para sa kaunting pahinga' : 'Make room for a pause',
      approved_action: candidate.message, action_id: candidate.metadata.action_id,
      encouragement: locale === 'fil' ? 'Hindi kailangang magmadali.' : 'There is no need to rush.',
    }) });
    assert.equal(valid.message, `${candidate.message}\n\n${valid.metadata.encouragement}`);
    const reused = { ...valid, metadata: { ...valid.metadata, reused_content: true } };
    assert.equal(personalizeNudgeRecommendation(reused, {}).message, valid.message);
    for (const generate of [async () => { throw new Error('deadline'); }, async () => ({
      title: 'Your health has improved', action_id: candidate.metadata.action_id,
      approved_action: 'Do a different action.', encouragement: '',
    })]) {
      const fallback = await enhanceCompanionWording(candidate, { locale, generate });
      assert.equal(fallback.message, candidate.message);
      assert.equal(fallback.title, candidate.title);
      assert.equal(fallback.metadata.ai_fallback, true);
    }
  }
});

test('validated cache coalesces concurrent requests and scopes by user, model, style, locale, action and context', async () => {
  const keys = [];
  const client = { query: async (_sql, values) => {
    keys.push(values);
    await new Promise((resolve) => setImmediate(resolve));
    return { rows: [{ output_json: { valid: true } }] };
  } };
  const input = { client, userId: 42, kind: 'companion_nudge', model: 'model-a', context: { locale: 'en', style: 'Gentle', action: 'pause', context_hash: 'one' }, validate: (v) => v.valid };
  await Promise.all([generateCompanionJson(input), generateCompanionJson(input)]);
  assert.equal(keys.length, 1);
  for (const patch of [{ userId: 43 }, { model: 'model-b' }, { context: { ...input.context, locale: 'fil' } },
    { context: { ...input.context, style: 'Direct' } }, { context: { ...input.context, action: 'walk' } },
    { context: { ...input.context, context_hash: 'two' } }]) await generateCompanionJson({ ...input, ...patch });
  assert.equal(new Set(keys.map((key) => JSON.stringify(key))).size, 7);
});

const dailyRows = (dates, values) => dates.map((log_date) => ({ log_date, ...values }));
const current = ['2026-10-21', '2026-10-22', '2026-10-23'];
const previous = ['2026-10-14', '2026-10-15', '2026-10-16'];

test('insights combine multiple sources without a burnout assessment and prioritize goal-related topics', () => {
  const data = { end_date: '2026-10-23', daily: dailyRows(current, { sleep_hours: 7, hydration_liters: 1.5, mood_index: 4 }),
    activity: dailyRows(current, { steps: 4000 }), nutrition: dailyRows(current, { meal_count: 2 }),
    goals: [{ goal_type: 'wellness', target_text: 'Stay active and improve nutrition' }] };
  const insight = buildWellnessInsight({}, data);
  const highlights = insight.metadata.highlights;
  assert.equal(highlights.length, 3);
  assert.deepEqual(highlights.slice(0, 2).map((item) => item.topic), ['activity', 'nutrition']);
  assert.equal(highlights.find((item) => item.topic === 'nutrition').value, 6);
  assert.deepEqual(insight.metadata.period, { start_date: '2026-10-17', end_date: '2026-10-23', days: 7 });
  assert.equal(buildWellnessInsight({}, { end_date: '2026-10-23' }), null);
});

test('mood is converted from zero-based scale; averages exclude unknown days and use coverage for comparison', () => {
  const data = { end_date: '2026-10-23', daily: [
    ...dailyRows(current, { sleep_hours: '7', mood_index: 0, energy_level: 4 }),
    ...dailyRows(previous, { sleep_hours: 6, mood_index: 1, energy_level: 3 }),
    { log_date: '2026-10-20', sleep_hours: null, mood_index: null, energy_level: null },
    { log_date: '2026-10-24', sleep_hours: 20, mood_index: 4 },
  ] };
  const highlights = buildPersonalHighlights(data).highlights;
  const sleep = highlights.find((item) => item.topic === 'sleep');
  const mood = highlights.find((item) => item.topic === 'mood_energy');
  assert.equal(sleep.value, 7);
  assert.equal(sleep.change, 1);
  assert.equal(sleep.coverage.recorded_days, 3);
  assert.equal(mood.value, 1);
  assert.equal(mood.change, -1);
  assert.equal(mood.energy.value, 4);
  assert.equal(mood.energy.change, 1);
  data.daily = data.daily.filter((row) => row.log_date !== previous[0]);
  assert.ok(buildPersonalHighlights(data).highlights.every((item) => item.change === null));
});

test('active minutes and numeric goals are usable without daily logs; changed facts invalidate identity', () => {
  const data = { end_date: '2026-10-23', activity: [{ log_date: '2026-10-23', active_minutes: 20 }],
    goals: [{ goal_type: 'daily_steps', target_value: 6000 }] };
  const first = buildWellnessInsight({}, data);
  assert.equal(first.metadata.highlights[0].topic, 'activity');
  assert.equal(first.metadata.highlights[0].value, 20);
  assert.equal(first.metadata.highlights[0].goal_related, true);
  assert.equal(first.metadata.highlights[0].change, null);
  const updated = buildWellnessInsight({}, { ...data, activity: [{ log_date: '2026-10-23', active_minutes: 25 }] });
  assert.notEqual(first.metadata.content_id, updated.metadata.content_id);
});

test('local calendar boundaries and sparse meal logging never become claims of missed meals', async () => {
  assert.equal(validInsightDate('2026-02-30'), false);
  assert.equal(validInsightDate('2026-10-23'), true);
  const dates = [];
  await loadPersonalInsightContext({ query: async (sql, args) => { if (sql.includes('BETWEEN')) dates.push(args.slice(1)); return { rows: [] }; } }, 8, '2026-01-01');
  assert.deepEqual(dates, Array(3).fill(['2025-12-19', '2026-01-01']));
  const insight = buildWellnessInsight({}, { end_date: '2026-10-23', nutrition: [{ log_date: '2026-10-23', meal_count: 1 }] });
  assert.equal(insight.metadata.highlights[0].coverage.recorded_days, 1);
  assert.doesNotMatch(insight.message, /skipped|missed|improv/i);
  const valid = { title: 'A glimpse of your meal logs', summary: 'Your meal logs offer a starting point. The rest of the week remains unknown.', topics: ['nutrition'] };
  assert.ok(validInsightWording(valid, insight));
  for (const summary of ['You skipped meals. Your diet improved.', 'You logged 5 meals. That is progress.', 'Sleep is higher. Your logs tell the story.', 'One incomplete fragment']) {
    assert.equal(validInsightWording({ ...valid, summary }, insight), false);
  }
});

// In-memory transaction adapter exercises shared-record semantics without touching a real database.
function deliveryDatabase() {
  const rows = [];
  const notifications = [];
  const query = async (sql, args = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory)/.test(sql)) return { rows: [] };
    if (sql.startsWith('SELECT * FROM nudge_events')) return { rows: structuredClone(rows.filter((r) => r.user_id === args[0] && (!sql.includes('content_id') || r.metadata.content_id === args[1]))) };
    if (sql.startsWith('INSERT INTO nudge_events')) {
      const row = { user_id: args[0], nudge_event_id: rows.length + 1, nudge_type: args[1], message: args[2], action_label: args[3], trigger_reason: args[4], metadata: JSON.parse(args[5]), status: 'shown', created_at: now.toISOString() };
      rows.push(row); return { rows: [structuredClone(row)] };
    }
    if (sql.startsWith('UPDATE nudge_events')) {
      if (sql.includes('jsonb_set')) {
        const cancelled = rows.filter((r) => r.user_id === args[0] && r.metadata.content_id !== args[1] && ['pending', 'claimed', 'scheduled'].includes(r.metadata.delivery.state));
        cancelled.forEach((r) => { r.metadata.delivery.state = 'cancelled'; });
        return { rows: cancelled.map((r) => ({ content_id: r.metadata.content_id })) };
      }
      const row = rows.find((r) => r.user_id === args[0] && r.nudge_event_id === args[1]);
      row.metadata = JSON.parse(args[2]); return { rows: [structuredClone(row)] };
    }
    if (sql.startsWith('SELECT notification_event_id')) return { rows: notifications.filter((n) => n.user_id === args[0] && n.metadata.content_id === args[1]) };
    if (sql.startsWith('INSERT INTO notification_events')) {
      notifications.push({ notification_event_id: notifications.length + 1, user_id: args[0], title: args[1], body: args[2], scheduled_for: args[3], status: args[4], metadata: JSON.parse(args[5]) }); return { rows: [] };
    }
    if (sql.startsWith('UPDATE notification_events')) {
      const row = notifications.find((n) => n.user_id === args[0] && n.notification_event_id === args[1]);
      row.status = args[2]; row.metadata = JSON.parse(args[3]); return { rows: [] };
    }
    throw new Error(`Unexpected test query: ${sql}`);
  };
  return { rows, notifications, query, connect: async () => ({ query, release() {} }) };
}

test('finalization freezes exact copy and immediate timing, shares identity, and never counts as exposure', async () => {
  const db = deliveryDatabase();
  const item = selectContent(candidates(), [], { now });
  const saved = await finalizeSmartNudge(db, 1, item, { now, trigger: 'context_update' });
  const again = await finalizeSmartNudge(db, 1, { ...item, message: 'Different AI output' }, { now });
  assert.equal(again.message, saved.message);
  assert.equal(db.rows.length, 1);
  assert.equal(saved.metadata.delivery.scheduled_for, now.toISOString());
  assert.equal(saved.metadata.generated_only, true);
  assert.equal(saved.metadata.displayed_at, undefined);
  const first = await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'claim' }, now);
  const otherEngine = await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'claim' }, now);
  assert.equal(first.claimed, true);
  assert.equal(otherEngine.claimed, false);
  assert.equal(await readSmartNudge(db, 2, item.metadata.content_id), null);
  await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'sent', token: first.token }, now);
  await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'sent', token: first.token }, now);
  assert.equal(db.notifications.length, 1);
  assert.equal(db.notifications[0].title, saved.title);
  assert.equal(db.notifications[0].body, saved.message);
  assert.equal(db.notifications[0].status, 'sent');
  assert.equal(deliveryClaimable(db.rows[0].metadata, now), false);
});

test('scheduled timestamps are preserved; failed claims retry and replacement cancels pending delivery', async () => {
  const db = deliveryDatabase();
  const item = selectContent(candidates(), [], { now });
  item.metadata.scheduled_for = '2026-10-24T08:00:00+08:00';
  const saved = await finalizeSmartNudge(db, 1, item, { now, trigger: 'scheduled' });
  assert.equal(saved.metadata.delivery.scheduled_for, item.metadata.scheduled_for);
  const claim = await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'claim' }, now);
  await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'failed', token: claim.token }, now);
  const retry = await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'claim' }, now);
  assert.equal(retry.claimed, true);
  await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'scheduled', token: retry.token }, now);
  const next = selectContent(candidates({ sleep: 6 }), [], { now });
  const replacement = await finalizeSmartNudge(db, 1, next, { now, trigger: 'another_idea' });
  assert.equal(db.rows[0].metadata.delivery.state, 'cancelled');
  assert.deepEqual(replacement.metadata.delivery.cancelled_content_ids, [item.metadata.content_id]);
  assert.equal(replacement.metadata.delivery.state, 'suppressed', 'shared cooldown still applies');
  assert.equal(replacement.metadata.delivery.reason, 'shared_nudge_limit');
  assert.equal(deliveryClaimable(interactionPatch(saved, 'not_now', now).metadata, now), false);
});

test('permission suppression is recorded without changing the saved nudge', async () => {
  const db = deliveryDatabase();
  const item = selectContent(candidates(), [], { now });
  await finalizeSmartNudge(db, 1, item, { now });
  const claim = await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'claim' }, now);
  await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'suppressed', token: claim.token, reason: 'permission_denied' }, now);
  const saved = await readSmartNudge(db, 1, item.metadata.content_id);
  assert.equal(saved.message, item.message);
  assert.equal(saved.metadata.delivery.reason, 'permission_denied');
  assert.equal(deliveryClaimable(saved.metadata, now), false);
});

test('one shared daily allowance spans different actions and preserves elevated-support priority', async () => {
  const db = deliveryDatabase();
  for (let i = 0; i < 4; i++) {
    const item = { ...selectContent(candidates({ sequence: i }), [], { now }), nudge_type: `type_${i}` };
    const saved = await finalizeSmartNudge(db, 1, item, { now });
    assert.equal(saved.metadata.delivery.state, i < 3 ? 'pending' : 'suppressed');
    if (i < 3) {
      const claim = await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'claim' }, now);
      await updateSmartNudgeDelivery(db, 1, item.metadata.content_id, { operation: 'sent', token: claim.token }, now);
    }
  }
  const support = { ...selectContent(candidates({ support: true }), [], { now }), priority: 'high' };
  assert.equal((await finalizeSmartNudge(db, 1, support, { now })).metadata.delivery.state, 'pending');
});
