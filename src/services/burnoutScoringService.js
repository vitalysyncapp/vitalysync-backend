import {
  addDays,
  calculateBurnoutBaselineScore,
  calculateDailyBurnoutSnapshot,
  formatDateOnly,
  toNumberOrNull,
  burnoutQuestionKeys
} from './burnoutScoringEngine.js';

export {
  calculateBurnoutBaselineScore,
  calculateDailyBurnoutSnapshot,
  burnoutQuestionKeys
};

export function formatBurnoutScoreRow(row) {
  if (!row) {
    return null;
  }

  return {
    burnout_score_id: row.burnout_score_id,
    user_id: row.user_id,
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
    missing_fields: row.missing_fields ?? [],
    contributing_factors: row.contributing_factors ?? [],
    source_snapshot: row.source_snapshot ?? {},
    scoring_version: row.scoring_version,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function loadBurnoutScoreInputs(client, userId, scoreDate) {
  const normalizedScoreDate = formatDateOnly(scoreDate);
  const weekStartDate = getWeekStartDate(normalizedScoreDate);

  const [
    dailyLogResult,
    weeklyPulseResult,
    activityResult,
    profileResult
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
         symptom_names,
         habit_names
       FROM daily_logs
       WHERE user_id = $1 AND log_date = $2`,
      [userId, normalizedScoreDate]
    ),
    client.query(
      `SELECT
         pulse_id,
         user_id,
         week_start_date,
         productivity_focus_level,
         recovery_rest_level,
         detachment_level,
         accomplishment_level
       FROM weekly_pulse_responses
       WHERE user_id = $1 AND week_start_date = $2`,
      [userId, weekStartDate]
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
    )
  ]);

  return {
    userId,
    scoreDate: normalizedScoreDate,
    weekStartDate,
    dailyLog: dailyLogResult.rows[0] ?? null,
    weeklyPulse: weeklyPulseResult.rows[0] ?? null,
    activityLog: activityResult.rows[0] ?? null,
    profile: profileResult.rows[0] ?? null
  };
}

export async function upsertBurnoutScoreForDate(client, userId, scoreDate) {
  const inputs = await loadBurnoutScoreInputs(client, userId, scoreDate);
  const score = calculateDailyBurnoutSnapshot(inputs);

  if (!score) {
    return null;
  }

  const result = await client.query(
    `INSERT INTO burnout_score_history (
       user_id,
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
       scoring_version
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16
     )
     ON CONFLICT (user_id, score_date)
     DO UPDATE SET
       overall_score = EXCLUDED.overall_score,
       risk_level = EXCLUDED.risk_level,
       emotional_exhaustion_score = EXCLUDED.emotional_exhaustion_score,
       detachment_score = EXCLUDED.detachment_score,
       reduced_accomplishment_score = EXCLUDED.reduced_accomplishment_score,
       workload_strain_score = EXCLUDED.workload_strain_score,
       recovery_deficit_score = EXCLUDED.recovery_deficit_score,
       confidence_score = EXCLUDED.confidence_score,
       completeness_score = EXCLUDED.completeness_score,
       data_points_count = EXCLUDED.data_points_count,
       missing_fields = EXCLUDED.missing_fields,
       contributing_factors = EXCLUDED.contributing_factors,
       source_snapshot = EXCLUDED.source_snapshot,
       scoring_version = EXCLUDED.scoring_version,
       updated_at = NOW()
     RETURNING
       burnout_score_id,
       user_id,
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
       updated_at`,
    [
      userId,
      score.score_date,
      score.overall_score,
      score.risk_level,
      score.emotional_exhaustion_score,
      score.detachment_score,
      score.reduced_accomplishment_score,
      score.workload_strain_score,
      score.recovery_deficit_score,
      score.confidence_score,
      score.completeness_score,
      score.data_points_count,
      score.missing_fields,
      JSON.stringify(score.contributing_factors),
      JSON.stringify(score.source_snapshot),
      score.scoring_version
    ]
  );

  return formatBurnoutScoreRow(result.rows[0]);
}

export async function upsertBurnoutScoresForWeek(client, userId, weekStartDate) {
  const endDate = addDays(weekStartDate, 6);
  return upsertBurnoutScoresForRange(client, userId, weekStartDate, endDate);
}

export async function upsertBurnoutScoresForRange(
  client,
  userId,
  startDate,
  endDate
) {
  const result = await client.query(
    `SELECT log_date
     FROM daily_logs
     WHERE user_id = $1
       AND log_date BETWEEN $2 AND $3
     ORDER BY log_date ASC`,
    [userId, startDate, endDate]
  );

  const scores = [];
  for (const row of result.rows) {
    const score = await upsertBurnoutScoreForDate(
      client,
      userId,
      formatDateOnly(row.log_date)
    );

    if (score) {
      scores.push(score);
    }
  }

  return scores;
}

export async function getLatestBurnoutScore(client, userId) {
  const result = await client.query(
    `SELECT
       burnout_score_id,
       user_id,
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
     ORDER BY score_date DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(formatBurnoutScoreRow);
}
