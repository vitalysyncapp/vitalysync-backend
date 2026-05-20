import assert from 'node:assert/strict';
import test from 'node:test';

import pool from '../src/config/db.js';
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

test('nudge event creation casts reused status parameter for PostgreSQL', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;
  const queries = [];

  pool.query = async (sql, params) => {
    queries.push({ sql, params });

    if (sql.includes('SELECT user_id FROM users')) {
      return { rowCount: 1, rows: [{ user_id: params[0] }] };
    }

    return {
      rowCount: 1,
      rows: [
        {
          nudge_event_id: 42,
          user_id: params[0],
          nudge_type: params[1],
          trigger_reason: params[2],
          message: params[3],
          action_label: params[4],
          status: params[5],
          metadata: JSON.parse(params[6]),
          acted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    };
  };

  try {
    await createNudgeEvent(
      {
        body: {
          user_id: 1,
          nudge_type: 'steady_routine',
          message: 'Keep today steady.',
          status: 'accepted',
          metadata: { title: 'Keep today steady' }
        }
      },
      res
    );
  } finally {
    pool.query = originalQuery;
  }

  const insertQuery = queries.find((query) =>
    query.sql.includes('INSERT INTO nudge_events')
  );

  assert.equal(res.statusCode, 201);
  assert.match(insertQuery.sql, /\$6::varchar/);
  assert.match(insertQuery.sql, /CASE WHEN \$6::text = 'shown'/);
});

test('nudge event status update casts reused status parameter for PostgreSQL', async () => {
  const res = createMockResponse();
  const originalQuery = pool.query;
  let updateSql = '';

  pool.query = async (sql, params) => {
    updateSql = sql;
    return {
      rowCount: 1,
      rows: [
        {
          nudge_event_id: params[0],
          user_id: params[1],
          nudge_type: 'steady_routine',
          trigger_reason: null,
          message: 'Keep today steady.',
          action_label: null,
          status: params[2],
          metadata: {},
          acted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    };
  };

  try {
    await updateNudgeEventStatus(
      { params: { eventId: 12 }, body: { user_id: 1, status: 'dismissed' } },
      res
    );
  } finally {
    pool.query = originalQuery;
  }

  assert.equal(res.statusCode, 200);
  assert.match(updateSql, /status = \$3::varchar/);
  assert.match(updateSql, /CASE WHEN \$3::text = 'shown'/);
});
