import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNudgeEvent,
  getNudgeRecommendations,
  updateNudgeEventStatus,
} from '../src/controllers/adaptive.controller.js';
import { createMockResponse } from './controllerTestHelpers.js';

test('nudge recommendations validate user id before database work', async () => {
  const res = createMockResponse();

  await getNudgeRecommendations({ query: { user_id: 'abc' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid user_id is required');
});

test('nudge recommendations validate boolean flags before database work', async () => {
  const res = createMockResponse();

  await getNudgeRecommendations(
    { query: { user_id: 1, record: 'sometimes' } },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid record flag is required');
});

test('nudge event creation validates required message before database work', async () => {
  const res = createMockResponse();

  await createNudgeEvent(
    { body: { user_id: 1, nudge_type: 'recovery_break' } },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid message is required');
});

test('nudge event updates validate allowed statuses before database work', async () => {
  const res = createMockResponse();

  await updateNudgeEventStatus(
    { params: { eventId: 12 }, body: { user_id: 1, status: 'ignored' } },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid nudge status is required');
});
