const EMOTIONAL_EXHAUSTION_KEYS = ['ee_01', 'ee_02', 'ee_03', 'ee_04', 'ee_05'];
const DEPERSONALIZATION_KEYS = ['dp_01', 'dp_02', 'dp_03', 'dp_04', 'dp_05'];
const PERSONAL_ACCOMPLISHMENT_KEYS = ['pa_01', 'pa_02', 'pa_03', 'pa_04', 'pa_05'];
const PHASE_TWO_SCORING_VERSION = 'phase2_v1';

const WORKLOAD_HOURS_BAND_RISK = {
  None: 0,
  '1-2 hours': 10,
  '3-4 hours': 20,
  '5-6 hours': 35,
  '6-7 hours': 45,
  '8-9 hours': 65,
  '10-12 hours': 90
};

const EXPECTED_DAILY_SCORE_FIELDS = [
  'daily_logs.sleep_hours',
  'daily_logs.sleep_quality',
  'daily_logs.mood_index',
  'daily_logs.energy_level',
  'daily_logs.hydration_liters',
  'daily_logs.workload_hours_band',
  'daily_logs.perceived_stress_level',
  'daily_logs.break_quality_level',
  'daily_logs.symptom_names',
  'weekly_pulse_responses.productivity_focus_level',
  'weekly_pulse_responses.recovery_rest_level',
  'weekly_pulse_responses.detachment_level',
  'weekly_pulse_responses.accomplishment_level',
  'daily_activity_logs.active_minutes',
  'daily_activity_logs.goal_completed'
];

function roundTwo(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

function toNumberOrNull(value) {
  if (value == null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIntegerOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function isPresent(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== null && value !== undefined;
}

function riskFromLikertHighRisk(value) {
  const parsed = toIntegerOrNull(value);
  if (parsed == null || parsed < 1 || parsed > 5) {
    return null;
  }

  return roundTwo(((parsed - 1) / 4) * 100);
}

function riskFromLikertHighGood(value) {
  const parsed = toIntegerOrNull(value);
  if (parsed == null || parsed < 1 || parsed > 5) {
    return null;
  }

  return roundTwo(((5 - parsed) / 4) * 100);
}

function riskFromZeroIndexedHighGood(value, maxValue) {
  const parsed = toIntegerOrNull(value);
  if (parsed == null || parsed < 0 || parsed > maxValue) {
    return null;
  }

  return roundTwo(((maxValue - parsed) / maxValue) * 100);
}

function sleepDurationRisk(value) {
  const hours = toNumberOrNull(value);
  if (hours == null) {
    return null;
  }

  if (hours < 4) {
    return 100;
  }
  if (hours < 6) {
    return 75;
  }
  if (hours < 7) {
    return 45;
  }
  if (hours <= 9) {
    return 10;
  }
  if (hours <= 10) {
    return 30;
  }

  return 50;
}

function hydrationRisk(value) {
  const liters = toNumberOrNull(value);
  if (liters == null) {
    return null;
  }

  if (liters < 1) {
    return 55;
  }
  if (liters < 1.5) {
    return 35;
  }
  if (liters <= 3.5) {
    return 10;
  }
  if (liters <= 5) {
    return 25;
  }

  return 50;
}

function activityRisk(activityLog) {
  if (!activityLog) {
    return null;
  }

  const activeMinutes = toIntegerOrNull(activityLog.active_minutes);
  const goalCompleted = activityLog.goal_completed;

  if (goalCompleted === true) {
    return 10;
  }

  if (activeMinutes == null) {
    return goalCompleted === false ? 45 : null;
  }

  if (activeMinutes >= 30) {
    return 15;
  }
  if (activeMinutes >= 15) {
    return 30;
  }
  if (activeMinutes > 0) {
    return 45;
  }

  return 60;
}

function symptomsRisk(symptoms) {
  if (!Array.isArray(symptoms) || symptoms.length === 0) {
    return null;
  }

  const normalized = symptoms.map((item) => String(item).toLowerCase());
  if (normalized.includes('none')) {
    return 0;
  }

  const weightedSymptoms = new Set(['fatigue', 'irritability', 'anxiety']);
  const score = normalized.reduce((sum, symptom) => {
    return sum + (weightedSymptoms.has(symptom) ? 20 : 12);
  }, 0);

  return clamp(score, 0, 75);
}

function workloadBandRisk(value) {
  const normalized = String(value ?? '').trim();
  return Object.prototype.hasOwnProperty.call(WORKLOAD_HOURS_BAND_RISK, normalized)
    ? WORKLOAD_HOURS_BAND_RISK[normalized]
    : null;
}

function weightedAverage(items) {
  const validItems = items.filter((item) => Number.isFinite(item.score));
  if (validItems.length === 0) {
    return null;
  }

  const totalWeight = validItems.reduce((sum, item) => sum + item.weight, 0);
  const total = validItems.reduce(
    (sum, item) => sum + item.score * item.weight,
    0
  );

  return roundTwo(total / totalWeight);
}

function classifyDailyRisk(score) {
  if (score < 34) {
    return 'low';
  }
  if (score < 60) {
    return 'moderate';
  }
  if (score < 80) {
    return 'high';
  }

  return 'critical';
}

function formatDateOnly(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value ?? '').slice(0, 10);
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

function getWeekStartDate(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const utcDate = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  const day = utcDate.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  utcDate.setUTCDate(utcDate.getUTCDate() + mondayOffset);

  return formatDateOnly(utcDate);
}

function presentFieldMap(inputs) {
  const dailyLog = inputs.dailyLog;
  const weeklyPulse = inputs.weeklyPulse;
  const activityLog = inputs.activityLog;

  return {
    'daily_logs.sleep_hours': dailyLog?.sleep_hours,
    'daily_logs.sleep_quality': dailyLog?.sleep_quality,
    'daily_logs.mood_index': dailyLog?.mood_index,
    'daily_logs.energy_level': dailyLog?.energy_level,
    'daily_logs.hydration_liters': dailyLog?.hydration_liters,
    'daily_logs.workload_hours_band': dailyLog?.workload_hours_band,
    'daily_logs.perceived_stress_level': dailyLog?.perceived_stress_level,
    'daily_logs.break_quality_level': dailyLog?.break_quality_level,
    'daily_logs.symptom_names': dailyLog?.symptom_names,
    'weekly_pulse_responses.productivity_focus_level':
      weeklyPulse?.productivity_focus_level,
    'weekly_pulse_responses.recovery_rest_level':
      weeklyPulse?.recovery_rest_level,
    'weekly_pulse_responses.detachment_level': weeklyPulse?.detachment_level,
    'weekly_pulse_responses.accomplishment_level':
      weeklyPulse?.accomplishment_level,
    'daily_activity_logs.active_minutes': activityLog?.active_minutes,
    'daily_activity_logs.goal_completed': activityLog?.goal_completed
  };
}

function computeCompleteness(inputs) {
  const fieldMap = presentFieldMap(inputs);
  const presentFields = EXPECTED_DAILY_SCORE_FIELDS.filter((field) =>
    isPresent(fieldMap[field])
  );
  const missingFields = EXPECTED_DAILY_SCORE_FIELDS.filter((field) =>
    !isPresent(fieldMap[field])
  );

  return {
    completenessScore: roundTwo(
      (presentFields.length / EXPECTED_DAILY_SCORE_FIELDS.length) * 100
    ),
    dataPointsCount: presentFields.length,
    missingFields
  };
}

function compactSourceSnapshot(inputs, risks) {
  const dailyLog = inputs.dailyLog;
  const weeklyPulse = inputs.weeklyPulse;
  const activityLog = inputs.activityLog;
  const profile = inputs.profile;

  return {
    score_date: inputs.scoreDate,
    week_start_date: inputs.weekStartDate,
    daily_log: dailyLog
      ? {
          sleep_hours: toNumberOrNull(dailyLog.sleep_hours),
          sleep_quality: toIntegerOrNull(dailyLog.sleep_quality),
          mood_index: toIntegerOrNull(dailyLog.mood_index),
          energy_level: toIntegerOrNull(dailyLog.energy_level),
          hydration_liters: toNumberOrNull(dailyLog.hydration_liters),
          workload_hours_band: dailyLog.workload_hours_band,
          perceived_stress_level: toIntegerOrNull(
            dailyLog.perceived_stress_level
          ),
          break_quality_level: toIntegerOrNull(dailyLog.break_quality_level),
          symptom_count: Array.isArray(dailyLog.symptom_names)
            ? dailyLog.symptom_names.filter((item) => item !== 'None').length
            : null
        }
      : null,
    weekly_pulse: weeklyPulse
      ? {
          productivity_focus_level: toIntegerOrNull(
            weeklyPulse.productivity_focus_level
          ),
          recovery_rest_level: toIntegerOrNull(
            weeklyPulse.recovery_rest_level
          ),
          detachment_level: toIntegerOrNull(weeklyPulse.detachment_level),
          accomplishment_level: toIntegerOrNull(
            weeklyPulse.accomplishment_level
          )
        }
      : null,
    activity_log: activityLog
      ? {
          active_minutes: toIntegerOrNull(activityLog.active_minutes),
          goal_completed: activityLog.goal_completed === true
        }
      : null,
    onboarding_baseline: profile
      ? {
          workload_level: toIntegerOrNull(profile.workload_level),
          initial_burnout_score: toNumberOrNull(profile.initial_burnout_score),
          initial_burnout_level: profile.initial_burnout_level
        }
      : null,
    normalized_risks: risks
  };
}

function buildContributingFactors(scores, risks) {
  const factors = [
    {
      key: 'perceived_stress',
      label: 'Perceived stress',
      score: risks.stressRisk,
      direction: 'higher_increases_risk'
    },
    {
      key: 'workload_strain',
      label: 'Workload strain',
      score: scores.workloadStrainScore,
      direction: 'higher_increases_risk'
    },
    {
      key: 'recovery_deficit',
      label: 'Recovery deficit',
      score: scores.recoveryDeficitScore,
      direction: 'higher_increases_risk'
    },
    {
      key: 'sleep_recovery',
      label: 'Sleep recovery',
      score: risks.sleepDurationRisk,
      direction: 'higher_increases_risk'
    },
    {
      key: 'detachment',
      label: 'Weekly detachment',
      score: scores.detachmentScore,
      direction: 'higher_increases_risk'
    },
    {
      key: 'reduced_accomplishment',
      label: 'Reduced accomplishment',
      score: scores.reducedAccomplishmentScore,
      direction: 'higher_increases_risk'
    }
  ].filter((factor) => Number.isFinite(factor.score));

  return factors
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function normalizeAnswers(answers) {
  if (Array.isArray(answers)) {
    return answers.reduce((map, answer) => {
      const key = String(answer?.question_key ?? answer?.key ?? '').trim();
      const value = Number(answer?.numeric_value ?? answer?.value);

      if (key && Number.isInteger(value) && value >= 1 && value <= 5) {
        map[key] = value;
      }

      return map;
    }, {});
  }

  if (answers && typeof answers === 'object') {
    return Object.entries(answers).reduce((map, [key, value]) => {
      const numericValue = Number(value);

      if (Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= 5) {
        map[key] = numericValue;
      }

      return map;
    }, {});
  }

  return {};
}

function averageForKeys(answerMap, keys) {
  const values = keys.map((key) => answerMap[key]);

  if (values.some((value) => !Number.isInteger(value))) {
    return null;
  }

  return roundTwo(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function classifyBaseline(averageScore) {
  if (averageScore <= 2) {
    return { level: 'Low', displayScore: 20 };
  }

  if (averageScore <= 3.5) {
    return { level: 'Moderate', displayScore: 40 };
  }

  return { level: 'High', displayScore: 60 };
}

export function calculateBurnoutBaselineScore(answers) {
  const answerMap = normalizeAnswers(answers);
  const emotionalExhaustionScore = averageForKeys(
    answerMap,
    EMOTIONAL_EXHAUSTION_KEYS
  );
  const depersonalizationScore = averageForKeys(
    answerMap,
    DEPERSONALIZATION_KEYS
  );
  const personalAccomplishmentScore = averageForKeys(
    answerMap,
    PERSONAL_ACCOMPLISHMENT_KEYS
  );

  if (
    emotionalExhaustionScore === null ||
    depersonalizationScore === null ||
    personalAccomplishmentScore === null
  ) {
    throw new Error('All burnout baseline questions must be answered from 1 to 5');
  }

  const reversePersonalAccomplishment = roundTwo(6 - personalAccomplishmentScore);
  const baselineAverage = roundTwo(
    (
      emotionalExhaustionScore +
      depersonalizationScore +
      reversePersonalAccomplishment
    ) / 3
  );
  const classification = classifyBaseline(baselineAverage);

  return {
    emotional_exhaustion_score: emotionalExhaustionScore,
    depersonalization_score: depersonalizationScore,
    personal_accomplishment_score: personalAccomplishmentScore,
    reverse_personal_accomplishment: reversePersonalAccomplishment,
    baseline_average: baselineAverage,
    initial_burnout_score: classification.displayScore,
    initial_burnout_level: classification.level
  };
}

export const burnoutQuestionKeys = {
  emotional_exhaustion: EMOTIONAL_EXHAUSTION_KEYS,
  depersonalization: DEPERSONALIZATION_KEYS,
  personal_accomplishment: PERSONAL_ACCOMPLISHMENT_KEYS
};

export function calculateDailyBurnoutSnapshot(inputs) {
  const dailyLog = inputs.dailyLog;
  const weeklyPulse = inputs.weeklyPulse;
  const activityLog = inputs.activityLog;
  const profile = inputs.profile;

  const baselineRisk = toNumberOrNull(profile?.initial_burnout_score);
  const workloadRisk = workloadBandRisk(dailyLog?.workload_hours_band) ??
    riskFromLikertHighRisk(profile?.workload_level);
  const risks = {
    stressRisk: riskFromLikertHighRisk(dailyLog?.perceived_stress_level),
    workloadRisk,
    sleepDurationRisk: sleepDurationRisk(dailyLog?.sleep_hours),
    sleepQualityRisk: riskFromZeroIndexedHighGood(dailyLog?.sleep_quality, 4),
    moodRisk: riskFromZeroIndexedHighGood(dailyLog?.mood_index, 4),
    energyRisk: riskFromZeroIndexedHighGood(dailyLog?.energy_level, 2),
    hydrationRisk: hydrationRisk(dailyLog?.hydration_liters),
    symptomRisk: symptomsRisk(dailyLog?.symptom_names),
    breakQualityRisk: riskFromLikertHighGood(dailyLog?.break_quality_level),
    productivityFocusRisk: riskFromLikertHighGood(
      weeklyPulse?.productivity_focus_level
    ),
    recoveryRestRisk: riskFromLikertHighGood(weeklyPulse?.recovery_rest_level),
    detachmentRisk: riskFromLikertHighRisk(weeklyPulse?.detachment_level),
    accomplishmentRisk: riskFromLikertHighGood(
      weeklyPulse?.accomplishment_level
    ),
    activityRisk: activityRisk(activityLog),
    baselineRisk
  };

  const emotionalExhaustionScore = weightedAverage([
    { score: risks.stressRisk, weight: 0.28 },
    { score: risks.energyRisk, weight: 0.18 },
    { score: risks.sleepQualityRisk, weight: 0.14 },
    { score: risks.sleepDurationRisk, weight: 0.12 },
    { score: risks.moodRisk, weight: 0.12 },
    { score: risks.workloadRisk, weight: 0.10 },
    { score: risks.symptomRisk, weight: 0.06 }
  ]);

  const detachmentScore = weightedAverage([
    { score: risks.detachmentRisk, weight: 0.75 },
    { score: risks.moodRisk, weight: 0.10 },
    { score: risks.stressRisk, weight: 0.10 },
    { score: risks.recoveryRestRisk, weight: 0.05 }
  ]);

  const reducedAccomplishmentScore = weightedAverage([
    { score: risks.productivityFocusRisk, weight: 0.45 },
    { score: risks.accomplishmentRisk, weight: 0.45 },
    { score: risks.energyRisk, weight: 0.05 },
    { score: risks.moodRisk, weight: 0.05 }
  ]);

  const recoveryDeficitScore = weightedAverage([
    { score: risks.breakQualityRisk, weight: 0.40 },
    { score: risks.recoveryRestRisk, weight: 0.30 },
    { score: risks.sleepDurationRisk, weight: 0.12 },
    { score: risks.hydrationRisk, weight: 0.08 },
    { score: risks.activityRisk, weight: 0.10 }
  ]);

  const workloadStrainScore = weightedAverage([
    { score: risks.workloadRisk, weight: 0.60 },
    { score: risks.stressRisk, weight: 0.25 },
    { score: recoveryDeficitScore, weight: 0.15 }
  ]);

  const behavioralComposite = weightedAverage([
    { score: emotionalExhaustionScore, weight: 0.45 },
    { score: detachmentScore, weight: 0.22 },
    { score: reducedAccomplishmentScore, weight: 0.22 },
    { score: recoveryDeficitScore, weight: 0.07 },
    { score: workloadStrainScore, weight: 0.04 }
  ]);

  if (behavioralComposite == null) {
    return null;
  }

  const overallScore = Number.isFinite(baselineRisk)
    ? roundTwo((behavioralComposite * 0.9) + (baselineRisk * 0.1))
    : behavioralComposite;
  const completeness = computeCompleteness(inputs);
  const sourceBreadthMultiplier = dailyLog && weeklyPulse
    ? 1
    : dailyLog
      ? 0.9
      : weeklyPulse
        ? 0.72
        : 0.58;
  const confidenceScore = roundTwo(
    clamp(completeness.completenessScore * sourceBreadthMultiplier)
  );
  const scores = {
    emotionalExhaustionScore,
    detachmentScore,
    reducedAccomplishmentScore,
    workloadStrainScore,
    recoveryDeficitScore
  };

  return {
    user_id: inputs.userId,
    score_date: inputs.scoreDate,
    overall_score: clamp(overallScore),
    risk_level: classifyDailyRisk(overallScore),
    emotional_exhaustion_score: emotionalExhaustionScore,
    detachment_score: detachmentScore,
    reduced_accomplishment_score: reducedAccomplishmentScore,
    workload_strain_score: workloadStrainScore,
    recovery_deficit_score: recoveryDeficitScore,
    confidence_score: confidenceScore,
    completeness_score: completeness.completenessScore,
    data_points_count: completeness.dataPointsCount,
    missing_fields: completeness.missingFields,
    contributing_factors: buildContributingFactors(scores, risks),
    source_snapshot: compactSourceSnapshot(inputs, risks),
    scoring_version: PHASE_TWO_SCORING_VERSION
  };
}

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
         symptom_names
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
