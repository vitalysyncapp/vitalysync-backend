import assert from 'node:assert/strict';
import test from 'node:test';

import {
  refreshInsightReports as refreshInsightReportsController
} from '../src/controllers/adaptive.controller.js';
import {
  listInsightReports,
  previousUtcDateKey,
  refreshInsightReports
} from '../src/services/insightReportService.js';
import { createMockResponse } from './controllerTestHelpers.js';

function reportRowFromParams(params, id = 1) {
  return {
    insight_report_id: id,
    user_id: params[0],
    report_type: params[1],
    period_start: params[2],
    period_end: params[3],
    title: params[4],
    summary: params[5],
    priority: params[6],
    metrics: JSON.parse(params[7]),
    source_snapshot: JSON.parse(params[8]),
    created_at: new Date('2026-05-21T00:00:00Z').toISOString(),
    updated_at: new Date('2026-05-21T00:00:00Z').toISOString()
  };
}

function createInsightReportClient({ dailyData = false, weeklyData = false } = {}) {
  const inserts = [];
  return { inserts, async query(sql, params = []) {
    if (sql.includes('INSERT INTO user_insight_reports')) {
      inserts.push({ sql, params });
      return { rowCount: 1, rows: [reportRowFromParams(params, inserts.length)] };
    }
    if (sql.includes('burnout_score_history') || /UPDATE.*user_assessments/.test(sql)) assert.fail('Reports must not query legacy scores or mutate CBI');
    if (sql.includes('FROM users')) return { rows: [{ age: 25 }] };
    const date = weeklyData ? '2026-05-18' : '2026-05-21';
    const inRange = (dailyData || weeklyData) && params[1] <= date && params[2] >= date;
    if (sql.includes('FROM daily_logs')) return { rows: inRange ? [{ log_date: date, sleep_hours: dailyData ? 5.5 : 6.5, energy_level: 3, hydration_liters: 0 }] : [] };
    if (sql.includes('FROM weekly_pulse_responses')) return { rows: weeklyData && inRange ? [{ response_date: date, perceived_pressure_level: 4, productivity_focus_level: 3, detachment_level: 2, accomplishment_level: 4, schema_version: 2 }] : [] };
    return { rows: [] };
  } };
}

test('insight report refresh validates user id before database work', async () => {
  const res = createMockResponse();

  await refreshInsightReportsController({ body: { user_id: 'abc' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid user_id is required');
});

test('previous UTC report date crosses month and year boundaries', () => {
  assert.equal(
    previousUtcDateKey(new Date('2026-01-01T00:00:00.000Z')),
    '2025-12-31'
  );
  assert.equal(
    previousUtcDateKey(new Date('2026-03-01T23:59:59.999Z')),
    '2026-02-28'
  );
});

test('daily insight report refresh inserts yesterday-context report once', async () => {
  const client = createInsightReportClient({ dailyData: true });

  const reports = await refreshInsightReports(client, 1, {
    date: '2026-05-21'
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].report_type, 'daily');
  assert.equal(reports[0].period_start, '2026-05-21');
  assert.equal(reports[0].metrics.observations.energy_level.mean, 3);
  assert.equal(reports[0].metrics.observations.sleep_hours.mean, 5.5);
  assert.equal(reports[0].metrics.daily_detachment_level, undefined);
  assert.match(reports[0].summary, /1 daily log/);
  assert.doesNotMatch(reports[0].summary, /risk|dimension|critical/i);
  assert.equal(reports[0].metrics.observations.hydration_liters.mean, 0);
  assert.equal(client.inserts.length, 1);
  assert.match(client.inserts[0].sql, /ON CONFLICT[\s\S]*DO NOTHING/);
});

test('repeated daily refresh returns the immutable existing report', async () => {
  const baseClient = createInsightReportClient({ dailyData: true });
  let storedReport = null;
  let sourceQueryCount = 0;

  const client = {
    async query(sql, params) {
      if (
        sql.includes('FROM user_insight_reports') &&
        sql.includes('report_type = $2')
      ) {
        return { rows: storedReport ? [storedReport] : [] };
      }

      if (sql.includes('INSERT INTO user_insight_reports')) {
        const result = await baseClient.query(sql, params);
        storedReport = result.rows[0];
        return result;
      }

      sourceQueryCount += 1;
      return baseClient.query(sql, params);
    }
  };

  const first = await refreshInsightReports(client, 1, {
    date: '2026-05-21'
  });
  const sourceQueriesAfterFirstRefresh = sourceQueryCount;
  const second = await refreshInsightReports(client, 1, {
    date: '2026-05-21'
  });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(baseClient.inserts.length, 1);
  assert.equal(sourceQueryCount, sourceQueriesAfterFirstRefresh);
  assert.deepEqual(second[0], first[0]);
  assert.equal(second[0].updated_at, '2026-05-21T00:00:00.000Z');
});

test('daily insert conflict returns the concurrently-created report', async () => {
  const baseClient = createInsightReportClient({ dailyData: true });
  const concurrentReport = {
    insight_report_id: 91,
    user_id: 1,
    report_type: 'daily',
    period_start: '2026-05-21',
    period_end: '2026-05-21',
    title: 'Daily wellness report',
    summary: 'Immutable report from the winning request.',
    priority: 'low',
    metrics: { date: '2026-05-21' },
    source_snapshot: {},
    created_at: '2026-05-22T07:00:00.000Z',
    updated_at: '2026-05-22T07:00:00.000Z'
  };
  let lookupCount = 0;
  let insertSql = '';

  const client = {
    async query(sql, params) {
      if (
        sql.includes('FROM user_insight_reports') &&
        sql.includes('report_type = $2')
      ) {
        lookupCount += 1;
        return { rows: lookupCount === 1 ? [] : [concurrentReport] };
      }

      if (sql.includes('INSERT INTO user_insight_reports')) {
        insertSql = sql;
        return { rowCount: 0, rows: [] };
      }

      return baseClient.query(sql, params);
    }
  };

  const reports = await refreshInsightReports(client, 1, {
    date: '2026-05-21'
  });

  assert.equal(lookupCount, 2);
  assert.match(insertSql, /ON CONFLICT[\s\S]*DO NOTHING/);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].insight_report_id, 91);
  assert.equal(reports[0].summary, concurrentReport.summary);
  assert.equal(reports[0].updated_at, concurrentReport.updated_at);
});

test('weekly insight report refresh skips non-Sunday dates', async () => {
  const client = createInsightReportClient({ weeklyData: true });

  const reports = await refreshInsightReports(client, 1, {
    date: '2026-05-21'
  });

  assert.equal(reports.length, 0);
  assert.equal(client.inserts.length, 0);
});

test('weekly insight report refresh inserts once on Sunday', async () => {
  const client = createInsightReportClient({ weeklyData: true });

  const reports = await refreshInsightReports(client, 1, {
    date: '2026-05-24'
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].report_type, 'weekly');
  assert.equal(reports[0].period_start, '2026-05-18');
  assert.equal(reports[0].period_end, '2026-05-24');
  assert.equal(reports[0].source_snapshot.weekly_reflections[0].perceived_pressure_level, 4);
  assert.equal(reports[0].source_snapshot.weekly_reflections[0].productivity_focus_level, 3);
  assert.equal(reports[0].source_snapshot.weekly_reflections[0].detachment_level, 2);
  assert.equal(reports[0].metrics.average_daily_detachment_level, undefined);
  assert.equal(reports[0].metrics.weekly_reflection_count, 1);
  assert.equal(reports[0].metrics.policy_version, 'cbi-wellness-1.0.0');
});

test('insight report listing requests newest reports first', async () => {
  let listSql = '';
  const client = {
    async query(sql) {
      listSql = sql;
      return {
        rows: [
          {
            insight_report_id: 2,
            user_id: 1,
            report_type: 'weekly',
            period_start: '2026-05-18',
            period_end: '2026-05-24',
            title: 'Weekly wellness report',
            summary: 'Weekly summary',
            priority: 'low',
            metrics: {},
            source_snapshot: {},
            created_at: new Date('2026-05-24T00:00:00Z').toISOString(),
            updated_at: new Date('2026-05-24T00:00:00Z').toISOString()
          },
          {
            insight_report_id: 1,
            user_id: 1,
            report_type: 'daily',
            period_start: '2026-05-21',
            period_end: '2026-05-21',
            title: 'Daily wellness report',
            summary: 'Daily summary',
            priority: 'medium',
            metrics: {},
            source_snapshot: {},
            created_at: new Date('2026-05-21T00:00:00Z').toISOString(),
            updated_at: new Date('2026-05-21T00:00:00Z').toISOString()
          }
        ]
      };
    }
  };

  const reports = await listInsightReports(client, 1, { limit: 2 });

  assert.match(listSql, /ORDER BY updated_at DESC/);
  assert.deepEqual(
    reports.map((report) => report.insight_report_id),
    [2, 1]
  );
});
