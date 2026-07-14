import assert from 'node:assert/strict';
import test from 'node:test';

import {
  StreakServiceError,
  prepareStreakForNewLog,
  readLeaderboard,
} from '../src/services/streak.service.js';

function mockClient({ availableSavers = 3, leaderboardRows = [] } = {}) {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('FROM streak_saver_periods')) {
        return {
          rows: [
            {
              user_id: params[0],
              period_month: params[1],
              base_savers: 3,
              earned_savers: Math.max(0, availableSavers - 3),
              used_savers: Math.max(0, 3 - availableSavers),
            },
          ],
          rowCount: 1,
        };
      }

      if (sql.includes('INSERT INTO streak_saver_events')) {
        return { rows: [{ event_id: calls.length }], rowCount: 1 };
      }

      if (sql.includes('(SELECT location_name FROM latest_area) AS area_name')) {
        return {
          rows: [
            {
              user_id: 1,
              role: 'Student',
              wellness_goal: 'Improve sleep',
              area_name: 'Manila',
            },
          ],
          rowCount: 1,
        };
      }

      if (sql.includes('scored AS')) {
        return { rows: leaderboardRows, rowCount: leaderboardRows.length };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

test('streak increments normally on the next logged day', async () => {
  const client = mockClient();
  const result = await prepareStreakForNewLog(client, {
    userId: 1,
    logDate: '2026-06-02',
    streakRow: {
      current_streak: 4,
      longest_streak: 6,
      last_logged_date: '2026-06-01',
    },
    restoreDecision: 'defer',
  });

  assert.equal(result.updatedStreak, 5);
  assert.equal(result.longestStreak, 6);
  assert.equal(result.restore.required, false);
});

test('missed day with use spends savers and bridges the streak', async () => {
  const client = mockClient({ availableSavers: 3 });
  const result = await prepareStreakForNewLog(client, {
    userId: 1,
    logDate: '2026-06-04',
    streakRow: {
      current_streak: 4,
      longest_streak: 4,
      last_logged_date: '2026-06-01',
    },
    restoreDecision: 'use',
  });

  const spendEvents = client.calls.filter((call) =>
    call.sql.includes('INSERT INTO streak_saver_events')
  );

  assert.equal(result.updatedStreak, 7);
  assert.equal(result.longestStreak, 7);
  assert.equal(result.restore.savers_used, 2);
  assert.equal(spendEvents.length, 2);
});

test('missed day with skip resets the active streak', async () => {
  const client = mockClient({ availableSavers: 3 });
  const result = await prepareStreakForNewLog(client, {
    userId: 1,
    logDate: '2026-06-04',
    streakRow: {
      current_streak: 4,
      longest_streak: 8,
      last_logged_date: '2026-06-01',
    },
    restoreDecision: 'skip',
  });

  assert.equal(result.updatedStreak, 1);
  assert.equal(result.longestStreak, 8);
  assert.equal(result.restore.required, true);
  assert.equal(result.restore.savers_used, 0);
});

test('missed day without a decision asks for manual restore choice', async () => {
  const client = mockClient({ availableSavers: 3 });

  await assert.rejects(
    () =>
      prepareStreakForNewLog(client, {
        userId: 1,
        logDate: '2026-06-04',
        streakRow: {
          current_streak: 4,
          longest_streak: 8,
          last_logged_date: '2026-06-01',
        },
        restoreDecision: 'defer',
      }),
    (error) =>
      error instanceof StreakServiceError &&
      error.statusCode === 409 &&
      error.details.streak_restore.reason === 'missed_days'
  );
});

test('insufficient savers return a clear restore failure', async () => {
  const client = mockClient({ availableSavers: 1 });

  await assert.rejects(
    () =>
      prepareStreakForNewLog(client, {
        userId: 1,
        logDate: '2026-06-04',
        streakRow: {
          current_streak: 4,
          longest_streak: 8,
          last_logged_date: '2026-06-01',
        },
        restoreDecision: 'use',
      }),
    (error) =>
      error instanceof StreakServiceError &&
      error.statusCode === 409 &&
      error.details.streak_restore.reason === 'insufficient_savers'
  );
});

test('leaderboard rows stay privacy-safe', async () => {
  const client = mockClient({
    leaderboardRows: [
      {
        user_id: 1,
        username: 'Vitaly One',
        score: 12,
        protected_day_count: 1,
        longest_streak: 20,
      },
      {
        user_id: 2,
        username: 'Vitaly Two',
        score: 9,
        protected_day_count: 0,
        longest_streak: 12,
      },
    ],
  });

  const leaderboard = await readLeaderboard(1, {
    client,
    section: 'global',
    metric: 'current',
    today: '2026-06-21',
  });

  assert.equal(leaderboard.rows.length, 2);
  assert.deepEqual(Object.keys(leaderboard.rows[0]).sort(), [
    'avatar_color',
    'display_name',
    'initials',
    'is_current_user',
    'protected_day_count',
    'rank',
    'score',
    'user_id',
  ]);
  assert.equal(leaderboard.rows[0].display_name, 'Vitaly One');
  assert.equal(leaderboard.rows[0].is_current_user, true);
});
