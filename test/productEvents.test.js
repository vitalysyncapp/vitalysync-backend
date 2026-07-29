import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProductEventValidationError,
  normalizeProductEvent,
  recordProductEvent
} from '../src/services/productEventService.js';

test('client events accept curated categorical dimensions only', () => {
  const event = normalizeProductEvent({
    eventName: 'nutrition_nudge_shown',
    eventKey: '2026-07-29:protein',
    dimensions: {
      macro_focus: 'protein',
      food_group: 'protein_foods',
      nutrition_nudge_type: 'pattern_support',
      ai_enhanced: true
    }
  }, { clientOnly: true });

  assert.deepEqual(event.dimensions, {
    macro_focus: 'protein',
    food_group: 'protein_foods',
    nutrition_nudge_type: 'pattern_support',
    ai_enhanced: true
  });
});

test('client events reject raw or sensitive dimensions', () => {
  assert.throws(
    () => normalizeProductEvent({
      eventName: 'nutrition_nudge_shown',
      eventKey: '2026-07-29:protein',
      dimensions: { message: 'Eat eggs because lunch was skipped' }
    }, { clientOnly: true }),
    ProductEventValidationError
  );
});

test('client endpoint cannot forge completion events', () => {
  assert.throws(
    () => normalizeProductEvent({
      eventName: 'daily_check_in_completed',
      eventKey: '2026-07-29',
      dimensions: {}
    }, { clientOnly: true }),
    ProductEventValidationError
  );
});

test('recording is idempotent on user, event name, and event key', async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{ event_id: 9, event_name: values[1], event_key: values[2] }] };
    }
  };

  const event = await recordProductEvent(client, 4, {
    eventName: 'exercise_recommendation_selected',
    eventKey: '2026-07-29:walk',
    dimensions: {
      recommendation_key: 'walk',
      exercise_category: 'walking',
      is_none_today: false,
      source: 'vitalysync_assistant'
    }
  });

  assert.equal(event.event_id, 9);
  assert.match(calls[0].text, /ON CONFLICT \(user_id, event_name, event_key\)/);
  assert.equal(calls[0].values[0], 4);
  assert.doesNotMatch(calls[0].values[4], /message|sleep_hours/);
});
