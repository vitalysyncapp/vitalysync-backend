import assert from 'node:assert/strict';
import test from 'node:test';

import {
  refreshInsightReports as refreshInsightReportsController
} from '../src/controllers/adaptive.controller.js';
import {
  listInsightReports,
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

  return {
    inserts,
    async query(sql, params) {
      if (sql.includes('INSERT INTO user_insight_reports')) {
        inserts.push({ sql, params });
        return {
          rowCount: 1,
          rows: [reportRowFromParams(params, inserts.length)]
        };
      }

      if (
        sql.includes('FROM daily_logs') &&
        sql.includes('log_date BETWEEN')
      ) {
        return {
          rows: weeklyData
            ? [
                {
                  log_date: '2026-05-18',
                  sleep_hours: 6.5,
                  mood_index: 3,
                  energy_level: 5,
                  hydration_liters: 2.1,
                  perceived_stress_level: 3,
                  break_quality_level: 4,
                  exercise_names: ['Walking'],
                  symptom_names: ['None'],
                  habit_names: ['Quiet break'],
                  exercise_goal_completed: true
                }
              ]
            : []
        };
      }

      if (
        sql.includes('FROM daily_logs') &&
        sql.includes('log_date = $2')
      ) {
        return {
          rows: dailyData
            ? [
                {
                  log_id: 1,
                  log_date: params[1],
                  sleep_hours: 5.5,
                  sleep_quality: 2,
                  mood_index: 2,
                  energy_level: 3,
                  hydration_liters: 1.2,
                  workload_hours_band: '8-9 hours',
                  perceived_stress_level: 4,
                  break_quality_level: 2,
                  exercise_names: ['Walking'],
                  symptom_names: ['Headache'],
                  habit_names: ['Quiet break'],
                  exercise_goal_name: 'Walking',
                  exercise_goal_completed: false,
                  exercise_goal_status: 'active',
                  updated_at: new Date().toISOString()
                }
              ]
            : []
        };
      }

      if (
        sql.includes('FROM daily_activity_logs') &&
        sql.includes('log_date BETWEEN')
      ) {
        return {
          rows: weeklyData
            ? [
                {
                  log_date: '2026-05-18',
                  steps: 6400,
                  active_minutes: 38,
                  goal_completed: true
                }
              ]
            : []
        };
      }

      if (
        sql.includes('FROM daily_activity_logs') &&
        sql.includes('log_date = $2')
      ) {
        return {
          rows: dailyData
            ? [
                {
                  log_date: params[1],
                  steps: 3400,
                  active_minutes: 18,
                  calories_burned: 120,
                  goal_steps: 5000,
                  goal_completed: false,
                  updated_at: new Date().toISOString()
                }
              ]
            : []
        };
      }

      if (sql.includes('FROM daily_exercise_goals')) {
        return {
          rows: dailyData
            ? [
                {
                  log_date: params[1],
                  exercise_name: 'Walking',
                  exercise_category: 'cardio',
                  status: 'active',
                  completed_at: null,
                  updated_at: new Date().toISOString()
                }
              ]
            : []
        };
      }

      if (
        sql.includes('FROM nutrition_logs') &&
        sql.includes('log_date BETWEEN')
      ) {
        return {
          rows: weeklyData
            ? [
                {
                  log_date: '2026-05-18',
                  total_calories: 1800,
                  meal_count: 3
                }
              ]
            : []
        };
      }

      if (
        sql.includes('FROM nutrition_logs') &&
        sql.includes('log_date = $2')
      ) {
        return {
          rows: dailyData
            ? [
                {
                  log_date: params[1],
                  total_calories: 1450,
                  total_protein_g: 70,
                  total_carbs_g: 160,
                  total_fat_g: 45,
                  meal_count: 3
                }
              ]
            : []
        };
      }

      if (sql.includes('FROM weekly_pulse_responses')) {
        return {
          rows: weeklyData
            ? [
                {
                  week_start_date: params[1],
                  productivity_focus_level: 3,
                  recovery_rest_level: 4,
                  detachment_level: 2,
                  accomplishment_level: 3,
                  updated_at: new Date().toISOString()
                }
              ]
            : []
        };
      }

      if (
        sql.includes('FROM burnout_score_history') &&
        sql.includes('score_date BETWEEN')
      ) {
        return {
          rows: weeklyData
            ? [
                {
                  score_date: '2026-05-18',
                  overall_score: 42,
                  risk_level: 'moderate',
                  confidence_score: 80
                }
              ]
            : []
        };
      }

      if (
        sql.includes('FROM burnout_score_history') &&
        sql.includes('score_date = $2')
      ) {
        return {
          rows: dailyData
            ? [
                {
                  score_date: params[1],
                  overall_score: 68,
                  risk_level: 'moderate',
                  confidence_score: 85,
                  updated_at: new Date().toISOString()
                }
              ]
            : []
        };
      }

      return { rows: [] };
    }
  };
}

test('insight report refresh validates user id before database work', async () => {
  const res = createMockResponse();

  await refreshInsightReportsController({ body: { user_id: 'abc' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Valid user_id is required');
});

test('daily insight report refresh upserts a daily report', async () => {
  const client = createInsightReportClient({ dailyData: true });

  const reports = await refreshInsightReports(client, 1, {
    date: '2026-05-21'
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].report_type, 'daily');
  assert.equal(reports[0].period_start, '2026-05-21');
  assert.equal(client.inserts.length, 1);
  assert.match(client.inserts[0].sql, /ON CONFLICT/);
});

test('weekly insight report refresh skips non-Sunday dates', async () => {
  const client = createInsightReportClient({ weeklyData: true });

  const reports = await refreshInsightReports(client, 1, {
    date: '2026-05-21'
  });

  assert.equal(reports.length, 0);
  assert.equal(client.inserts.length, 0);
});

test('weekly insight report refresh upserts a weekly report on Sunday', async () => {
  const client = createInsightReportClient({ weeklyData: true });

  const reports = await refreshInsightReports(client, 1, {
    date: '2026-05-24'
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].report_type, 'weekly');
  assert.equal(reports[0].period_start, '2026-05-18');
  assert.equal(reports[0].period_end, '2026-05-24');
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
