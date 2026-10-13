import { addDays, formatDateOnly } from './burnoutScoringEngine.js';
import { WELLNESS_POLICY_VERSION, summarizeObservations, compareRecordedWeeks, selectWellnessRecommendations } from './wellnessEvidencePolicy.js';

export async function loadWellnessSummary(client, userId, { endDate = new Date().toISOString().slice(0, 10) } = {}) {
  const end = formatDateOnly(endDate);
  const start = addDays(end, -13);
  const [user, goals, logs, activity, assessments] = await Promise.all([
    client.query('SELECT users.age, profile.wellness_goals FROM users LEFT JOIN user_onboarding_profiles profile ON profile.user_id = users.user_id WHERE users.user_id = $1', [userId]),
    client.query('SELECT goal_type, target_value, target_text, source FROM user_goals WHERE user_id = $1', [userId]),
    client.query('SELECT * FROM daily_logs WHERE user_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date DESC', [userId, start, end]),
    client.query('SELECT * FROM daily_activity_logs WHERE user_id = $1 AND log_date BETWEEN $2 AND $3 ORDER BY log_date DESC', [userId, start, end]),
    client.query(`SELECT assessment_id, instrument, instrument_version, scoring_version, completed_at, cbi_score
      FROM user_assessments WHERE user_id = $1 AND instrument = 'cbi_personal_burnout'
      AND completed_at < ($2::date + INTERVAL '1 day') AT TIME ZONE 'UTC'
      ORDER BY completed_at DESC, submission_id DESC LIMIT 1`, [userId, end])
  ]);
  const normalize = (rows) => rows.map((row) => ({ ...row, log_date: formatDateOnly(row.log_date) }));
  const daily = normalize(logs.rows);
  const movement = normalize(activity.rows);
  const currentStart = addDays(end, -6);
  const currentLogs = daily.filter((row) => row.log_date >= currentStart);
  const previousLogs = daily.filter((row) => row.log_date < currentStart);
  let assessment = null;
  const saved = assessments.rows[0];
  if (saved) {
    const answers = await client.query(`SELECT question_id, response FROM user_assessment_answers
      WHERE assessment_id = $1 AND question_type = 'context'`, [saved.assessment_id]);
    assessment = { ...saved, assessment_id: String(saved.assessment_id),
      completed_at: new Date(saved.completed_at).toISOString(), display_score: Number(saved.cbi_score).toFixed(1),
      completion_status: 'complete', context: Object.fromEntries(answers.rows.map((row) => [row.question_id, row.response])) };
  }
  const wellness = Object.fromEntries(['sleep_hours', 'sleep_quality', 'hydration_liters', 'mood_index', 'energy_level'].map((field) => [field,
    compareRecordedWeeks(summarizeObservations(currentLogs, field), summarizeObservations(previousLogs, field))]));
  const recommendations = selectWellnessRecommendations({ age: user.rows[0]?.age, goals: [...goals.rows, ...(user.rows[0]?.wellness_goals ?? []).map((goal) => ({ goal_type: 'wellness', target_text: goal, source: 'onboarding' }))],
    logs: currentLogs, activity: movement.filter((row) => row.log_date >= currentStart), assessment, endDate: end });
  return { policy_version: WELLNESS_POLICY_VERSION, generated_at: new Date().toISOString(), period_start: currentStart, period_end: end,
    assessment, wellness, recorded_days: currentLogs.length,
    activity: { steps: summarizeObservations(movement.filter((row) => row.log_date >= currentStart), 'steps'),
      active_minutes: summarizeObservations(movement.filter((row) => row.log_date >= currentStart), 'active_minutes') },
    recommendations };
}
