import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTodayLog,
  saveDailyLog,
  saveWeeklyPulse,
} from '../src/controllers/log.controller.js';
import { createMockResponse } from './controllerTestHelpers.js';

test('daily log fetch requires a valid user id', async () => {
  const res = createMockResponse();

  await getTodayLog({ query: { user_id: 'abc', log_date: '2026-05-18' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid user_id is required');
});

test('daily log save validates date before database work', async () => {
  const res = createMockResponse();

  await saveDailyLog({ body: { user_id: 1, log_date: 'not-a-date' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid log_date is required');
});

test('daily log save validates energy as a 1 to 5 Likert value', async () => {
  const res = createMockResponse();

  await saveDailyLog(
    {
      body: {
        user_id: 1,
        log_date: '2026-05-18',
        sleep_hours: 7,
        sleep_quality: 2,
        mood_index: 2,
        energy_level: 0,
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid energy_level is required');
});

test('weekly pulse validates Likert values before database work', async () => {
  const res = createMockResponse();

  await saveWeeklyPulse(
    {
      body: {
        user_id: 1,
        response_date: '2026-05-18',
        productivity_focus_level: 6,
        recovery_rest_level: 3,
        detachment_level: 3,
        accomplishment_level: 3,
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid productivity_focus_level is required');
});
