import assert from 'node:assert/strict';
import test from 'node:test';

import pool from '../src/config/db.js';
import {
  createNudgeEvent,
  getNudgeRecommendations,
  updateNudgeEventStatus,
} from '../src/controllers/adaptive.controller.js';
import { applyRecentFeedback } from '../src/services/adaptiveNudgeService.js';
import { createMockResponse } from './controllerTestHelpers.js';

function recommendation({
  nudgeType,
  priority = 'medium',
  recommendedFocus = 'recovery',
} = {}) {
  return {
    nudge_type: nudgeType,
    priority,
    title: nudgeType,
    message: 'Test message',
    action_label: 'Act',
    trigger_reason: 'Test',
    recommended_focus: recommendedFocus,
    metadata: { recommended_focus: recommendedFocus },
  };
}

const feedbackPreferences = {
  preferredNudgeStyle: 'Gentle',
  cooldownHours: 8,
  maxDailyNudges: 4,
};

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

test('smart nudge feedback suppresses recently dismissed non-urgent types when alternatives exist', () => {
  const ranked = applyRecentFeedback(
    [
      recommendation({ nudgeType: 'recovery_break', priority: 'medium' }),
      recommendation({
        nudgeType: 'small_win',
        priority: 'medium',
        recommendedFocus: 'progress',
      }),
    ],
    [
      {
        nudge_type: 'recovery_break',
        status: 'dismissed',
        created_at: new Date(),
        metadata: { recommended_focus: 'recovery' },
      },
    ],
    feedbackPreferences
  );

  assert.equal(ranked[0].nudge_type, 'small_win');
  assert.equal(
    ranked.some((item) => item.nudge_type === 'recovery_break'),
    false
  );
});

test('smart nudge feedback uses accepted status as same-priority tie breaker', () => {
  const ranked = applyRecentFeedback(
    [
      recommendation({ nudgeType: 'recovery_break', priority: 'medium' }),
      recommendation({
        nudgeType: 'small_win',
        priority: 'medium',
        recommendedFocus: 'progress',
      }),
    ],
    [
      {
        nudge_type: 'small_win',
        status: 'accepted',
        created_at: new Date(),
        metadata: { recommended_focus: 'progress' },
      },
    ],
    feedbackPreferences
  );

  assert.equal(ranked[0].nudge_type, 'small_win');
  assert.equal(ranked[0].metadata.recently_accepted, true);
});

test('smart nudge feedback does not let accepted low priority outrank high priority nudges', () => {
  const ranked = applyRecentFeedback(
    [
      recommendation({ nudgeType: 'load_reduction_check', priority: 'high' }),
      recommendation({
        nudgeType: 'small_win',
        priority: 'low',
        recommendedFocus: 'progress',
      }),
    ],
    [
      {
        nudge_type: 'small_win',
        status: 'accepted',
        created_at: new Date(),
        metadata: { recommended_focus: 'progress' },
      },
    ],
    feedbackPreferences
  );

  assert.equal(ranked[0].nudge_type, 'load_reduction_check');
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
