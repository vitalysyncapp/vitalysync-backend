import pool from '../config/db.js';
import { getUserProfileSummary } from './onboarding.service.js';
import { generateReportAiContent } from './reportAi.service.js';
import { buildUserReportDocx } from './reportDocument.service.js';
import { buildReportInsights } from './reportInsights.service.js';
import { buildReportMetrics } from './reportMetrics.service.js';

async function loadReportRows(userId) {
  const [logsResult, pulseResult, burnoutResult, exerciseResult] = await Promise.all([
    pool.query(
      `SELECT
         log_date, sleep_hours, sleep_quality, mood_index, energy_level
       FROM daily_logs
       WHERE user_id = $1
         AND log_date >= (CURRENT_DATE - INTERVAL '364 days')
       ORDER BY log_date DESC`,
      [userId],
    ),
    pool.query(
      `SELECT
         response_date, perceived_pressure_level, recovery_rest_level,
         detachment_level, productivity_focus_level, accomplishment_level
       FROM weekly_pulse_responses
       WHERE user_id = $1
         AND response_date >= (CURRENT_DATE - INTERVAL '364 days')
       ORDER BY response_date DESC`,
      [userId],
    ),
    pool.query(
      `SELECT
         score_date, overall_score AS burnout_score,
         risk_level AS status_category, emotional_exhaustion_score,
         detachment_score, reduced_accomplishment_score
       FROM burnout_score_history
       WHERE user_id = $1
         AND score_date >= (CURRENT_DATE - INTERVAL '364 days')
       ORDER BY score_date DESC`,
      [userId],
    ),
    pool.query(
      `SELECT
         log_date, steps, active_minutes, calories_burned, exercise_type,
         goal_completed
       FROM daily_activity_logs
       WHERE user_id = $1
         AND log_date >= (CURRENT_DATE - INTERVAL '364 days')
       ORDER BY log_date DESC`,
      [userId],
    ),
  ]);

  return {
    logs: logsResult.rows,
    weeklyPulses: pulseResult.rows,
    burnoutHistory: burnoutResult.rows,
    exercises: exerciseResult.rows,
  };
}

export async function generateUserReportDocx(userId) {
  const profile = await getUserProfileSummary(userId);
  if (!profile) {
    throw new Error('User not found');
  }

  const reportDate = new Date();
  const rows = await loadReportRows(userId);
  const metrics = buildReportMetrics({ ...rows, now: reportDate });
  const insights = buildReportInsights(metrics);
  const aiContent = await generateReportAiContent(metrics);

  return buildUserReportDocx({
    profile,
    metrics,
    insights,
    aiContent,
    reportDate,
  });
}
