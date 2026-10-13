import { rejectLegacyScoring } from './legacyScoringRetirement.js';
import {
  addDays,
  calculateBurnoutBaselineScore,
  calculateDailyBurnoutSnapshot,
  formatDateOnly,
  getWeekStartDate,
  toNumberOrNull,
  burnoutQuestionKeys
} from './burnoutScoringEngine.js';
import { ensureBaselineEpochForDate } from './baselineEpochService.js';
import { BURNOUT_SCORING_VERSION } from './burnoutEvidencePolicy.js';

export const BURNOUT_SCORE_EXPLANATION_NOTE =
  'This is a pattern estimate based on your recent logs, not a medical diagnosis.';

export {
  calculateBurnoutBaselineScore,
  calculateDailyBurnoutSnapshot,
  burnoutQuestionKeys
};

export function formatBurnoutScoreRow(row) {
  if (!row) {
    return null;
  }

  const sourceSnapshot = row.source_snapshot ?? {};
  const baselinePolicy = sourceSnapshot.baseline_policy ?? {};
  const contributingFactors = row.contributing_factors ?? [];
  const missingFields = row.missing_fields ?? [];
  const windowUsed = baselinePolicy.window_used ?? null;
  const windowDays = Number.parseInt(String(windowUsed ?? ''), 10);
  const loggedDayCount = Number(baselinePolicy.logged_day_count ?? 0);
  const logCoveragePercent = Number.isFinite(windowDays) && windowDays > 0
    ? Math.min(100, Math.round((loggedDayCount / windowDays) * 10000) / 100)
    : null;

  return {
    burnout_score_id: row.burnout_score_id,
    user_id: row.user_id,
    baseline_epoch_id: row.baseline_epoch_id == null
      ? null
      : Number(row.baseline_epoch_id),
    score_date: formatDateOnly(row.score_date),
    overall_score: toNumberOrNull(row.overall_score),
    risk_level: row.risk_level,
    emotional_exhaustion_score: toNumberOrNull(
      row.emotional_exhaustion_score
    ),
    detachment_score: toNumberOrNull(row.detachment_score),
    reduced_accomplishment_score: toNumberOrNull(
      row.reduced_accomplishment_score
    ),
    workload_strain_score: toNumberOrNull(row.workload_strain_score),
    recovery_deficit_score: toNumberOrNull(row.recovery_deficit_score),
    confidence_score: toNumberOrNull(row.confidence_score),
    completeness_score: toNumberOrNull(row.completeness_score),
    data_points_count: Number(row.data_points_count ?? 0),
    missing_fields: missingFields,
    contributing_factors: contributingFactors,
    source_snapshot: sourceSnapshot,
    scoring_version: row.scoring_version,
    evidence_basis: {
      scoring_version: row.scoring_version,
      baseline_weight: baselinePolicy.baseline_weight ?? null,
      baseline_epoch_started_at: baselinePolicy.epoch_started_at ?? null,
      window_used: windowUsed,
      weekly_pulse_count_since_epoch:
        baselinePolicy.weekly_pulse_count_since_epoch ?? 0,
      log_coverage_percent: logCoveragePercent,
      confidence_score: toNumberOrNull(row.confidence_score),
      missing_fields: missingFields,
      top_factor_keys: contributingFactors
        .map((factor) => factor?.key)
        .filter(Boolean)
    },
    explanation_note: BURNOUT_SCORE_EXPLANATION_NOTE,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

const DAILY_LOG_BACKED_SCORE_FILTER =
  "source_snapshot ? 'daily_log' AND source_snapshot->'daily_log' <> 'null'::jsonb";

export async function loadBurnoutScoreInputs(client, userId, scoreDate) {
  const normalizedScoreDate = formatDateOnly(scoreDate);
  const weekStartDate = getWeekStartDate(normalizedScoreDate);
  const baselineEpoch = await ensureBaselineEpochForDate(
    client,
    userId,
    normalizedScoreDate
  );
  const epochStartedAt = baselineEpoch?.startedAt ?? null;
  const weeklyPulseParams = epochStartedAt
    ? [userId, normalizedScoreDate, epochStartedAt]
    : [userId, normalizedScoreDate];
  const weeklyPulseEpochFilter = epochStartedAt
    ? 'AND response_date >= $3'
    : '';

  const [
    dailyLogResult,
    weeklyPulseResult,
    activityResult,
    profileResult,
    evidenceResult,
    recentScoresResult
  ] = await Promise.all([
    client.query(
      `SELECT
         log_id,
         user_id,
         log_date,
         sleep_hours,
         sleep_quality,
         mood_index,
         energy_level,
         hydration_liters,
         workload_hours_band,
         perceived_stress_level,
         break_quality_level,
         daily_detachment_level,
         daily_focus_level,
         daily_accomplishment_level,
         exercise_names,
         symptom_names,
         habit_names,
         exercise_goal_name,
         exercise_goal_completed,
         exercise_goal_source,
         exercise_goal_status
       FROM daily_logs
       WHERE user_id = $1 AND log_date = $2`,
      [userId, normalizedScoreDate]
    ),
    client.query(
      `SELECT
         pulse_id,
         user_id,
         week_start_date,
         due_date,
         response_date,
         perceived_pressure_level,
         productivity_focus_level,
         recovery_rest_level,
         detachment_level,
         accomplishment_level,
         schema_version
       FROM weekly_pulse_responses
       WHERE user_id = $1
         AND response_date <= $2
         ${weeklyPulseEpochFilter}
       ORDER BY response_date DESC, updated_at DESC
       LIMIT 1`,
      weeklyPulseParams
    ),
    client.query(
      `SELECT
         activity_log_id,
         user_id,
         log_date,
         active_minutes,
         goal_completed
       FROM daily_activity_logs
       WHERE user_id = $1 AND log_date = $2`,
      [userId, normalizedScoreDate]
    ),
    client.query(
      `SELECT
         user_id,
         workload_level,
         initial_burnout_score,
         initial_burnout_level
       FROM user_onboarding_profiles
       WHERE user_id = $1`,
      [userId]
    ),
    client.query(
      `SELECT
         COUNT(DISTINCT log_date) FILTER (
           WHERE log_date BETWEEN COALESCE($3::DATE, log_date) AND $2
         ) AS logged_day_count,
         COUNT(DISTINCT log_date) FILTER (
           WHERE log_date BETWEEN ($2::DATE - INTERVAL '13 days') AND $2
             AND ($3::DATE IS NULL OR log_date >= $3)
         ) AS logs_last_14_days,
         COUNT(DISTINCT log_date) FILTER (
           WHERE log_date BETWEEN ($2::DATE - INTERVAL '27 days') AND $2
             AND ($3::DATE IS NULL OR log_date >= $3)
         ) AS logs_last_28_days,
         (
           SELECT COUNT(*)
           FROM weekly_pulse_responses pulse
           WHERE pulse.user_id = $1
             AND pulse.response_date <= $2
             AND ($3::DATE IS NULL OR pulse.response_date >= $3)
         ) AS weekly_pulse_count,
         (
           SELECT COUNT(*)
           FROM daily_activity_logs activity
           WHERE activity.user_id = $1
             AND activity.log_date <= $2
             AND ($3::DATE IS NULL OR activity.log_date >= $3)
         ) AS activity_record_count
       FROM daily_logs
       WHERE user_id = $1 AND log_date <= $2`,
      [userId, normalizedScoreDate, epochStartedAt]
    ),
    client.query(
      `SELECT
         score_date,
         overall_score,
         confidence_score,
         completeness_score
       FROM burnout_score_history
       WHERE user_id = $1
         AND score_date BETWEEN ($2::DATE - INTERVAL '6 days') AND $2
         AND scoring_version = $4
         AND (
           $3::BIGINT IS NULL
           OR baseline_epoch_id = $3
         )
       ORDER BY score_date ASC`,
      [
        userId,
        normalizedScoreDate,
        baselineEpoch?.baselineEpochId ?? null,
        BURNOUT_SCORING_VERSION
      ]
    )
  ]);

  const evidence = evidenceResult.rows[0] ?? {};

  return {
    userId,
    scoreDate: normalizedScoreDate,
    weekStartDate,
    baselineEpoch,
    dailyLog: dailyLogResult.rows[0] ?? null,
    weeklyPulse: weeklyPulseResult.rows[0] ?? null,
    activityLog: activityResult.rows[0] ?? null,
    profile: profileResult.rows[0] ?? null,
    baselineEvidence: {
      epochStartedAt,
      loggedDayCount: Number(evidence.logged_day_count ?? 0),
      logsLast14Days: Number(evidence.logs_last_14_days ?? 0),
      logsLast28Days: Number(evidence.logs_last_28_days ?? 0),
      weeklyPulseCount: Number(evidence.weekly_pulse_count ?? 0),
      activityRecordCount: Number(evidence.activity_record_count ?? 0),
      recentScores: recentScoresResult.rows
    }
  };
}

export async function upsertBurnoutScoreForDate() {
  rejectLegacyScoring();
}

export async function upsertBurnoutScoresForWeek() {
  rejectLegacyScoring();
}

export async function upsertBurnoutScoresForRange() {
  rejectLegacyScoring();
}

export async function getLatestBurnoutScore(client, userId) {
  const result = await client.query(
    `SELECT
       burnout_score_id,
       user_id,
       baseline_epoch_id,
       score_date,
       overall_score,
       risk_level,
       emotional_exhaustion_score,
       detachment_score,
       reduced_accomplishment_score,
       workload_strain_score,
       recovery_deficit_score,
       confidence_score,
       completeness_score,
       data_points_count,
       missing_fields,
       contributing_factors,
       source_snapshot,
       scoring_version,
       created_at,
       updated_at
     FROM burnout_score_history
     WHERE user_id = $1
       AND ${DAILY_LOG_BACKED_SCORE_FILTER}
       AND (
         baseline_epoch_id = (
           SELECT baseline_epoch_id
           FROM user_baseline_epochs epoch
           WHERE epoch.user_id = $1 AND epoch.ended_at IS NULL
           ORDER BY epoch.started_at DESC, epoch.baseline_epoch_id DESC
           LIMIT 1
         )
         OR NOT EXISTS (
           SELECT 1 FROM user_baseline_epochs epoch WHERE epoch.user_id = $1
         )
       )
     ORDER BY score_date DESC
     LIMIT 1`,
    [userId]
  );

  return formatBurnoutScoreRow(result.rows[0]);
}

export async function getBurnoutScoreHistory(
  client,
  userId,
  { startDate, endDate, limit = 30 } = {}
) {
  const params = [userId];
  const filters = ['user_id = $1'];

  if (startDate) {
    params.push(startDate);
    filters.push(`score_date >= $${params.length}`);
  }

  if (endDate) {
    params.push(endDate);
    filters.push(`score_date <= $${params.length}`);
  }

  params.push(limit);

  const result = await client.query(
    `SELECT
       burnout_score_id,
       user_id,
       baseline_epoch_id,
       score_date,
       overall_score,
       risk_level,
       emotional_exhaustion_score,
       detachment_score,
       reduced_accomplishment_score,
       workload_strain_score,
       recovery_deficit_score,
       confidence_score,
       completeness_score,
       data_points_count,
       missing_fields,
       contributing_factors,
       source_snapshot,
       scoring_version,
       created_at,
       updated_at
     FROM burnout_score_history
     WHERE ${filters.join(' AND ')}
       AND ${DAILY_LOG_BACKED_SCORE_FILTER}
     ORDER BY score_date DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(formatBurnoutScoreRow);
}
