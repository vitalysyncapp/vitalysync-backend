import {
  BURNOUT_SCORING_VERSION,
  calculateBaselinePolicy
} from './burnoutEvidencePolicy.js';

const EMOTIONAL_EXHAUSTION_KEYS = ['ee_01', 'ee_02', 'ee_03', 'ee_04', 'ee_05'];
const DEPERSONALIZATION_KEYS = ['dp_01', 'dp_02', 'dp_03', 'dp_04', 'dp_05'];
const PERSONAL_ACCOMPLISHMENT_KEYS = ['pa_01', 'pa_02', 'pa_03', 'pa_04', 'pa_05'];

const DIMENSION_WEIGHTS = {
  emotionalExhaustion: {
    pressureRisk: 0.28,
    energyRisk: 0.22,
    sleepQualityRisk: 0.16,
    sleepDurationRisk: 0.13,
    moodRisk: 0.13,
    workloadRisk: 0.05,
    symptomRisk: 0.03
  },
  detachment: {
    detachmentRisk: 0.55,
    recoveryRestRisk: 0.15,
    habitRecoveryRisk: 0.12,
    moodRisk: 0.08,
    hydrationRisk: 0.05,
    pressureRisk: 0.05
  },
  reducedAccomplishment: {
    productivityFocusRisk: 0.42,
    accomplishmentRisk: 0.42,
    workloadRisk: 0.08,
    movementRisk: 0.08
  },
  recoveryDeficit: {
    recoveryRestRisk: 0.42,
    sleepDurationRisk: 0.18,
    sleepQualityRisk: 0.12,
    movementRisk: 0.10,
    habitRecoveryRisk: 0.10,
    hydrationRisk: 0.08
  },
  workloadStrain: {
    workloadRisk: 0.65,
    pressureRisk: 0.25,
    recoveryDeficitScore: 0.10
  },
  behavioralComposite: {
    emotionalExhaustionScore: 0.45,
    detachmentScore: 0.22,
    reducedAccomplishmentScore: 0.22,
    recoveryDeficitScore: 0.07,
    workloadStrainScore: 0.04
  }
};

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
  'daily_logs.exercise_names',
  'daily_logs.symptom_names',
  'daily_logs.habit_names'
];

const EXPECTED_WEEKLY_SCORE_FIELDS = [
  'weekly_pulse_responses.perceived_pressure_level',
  'weekly_pulse_responses.productivity_focus_level',
  'weekly_pulse_responses.recovery_rest_level',
  'weekly_pulse_responses.detachment_level',
  'weekly_pulse_responses.accomplishment_level'
];

function roundTwo(value) {
  return Math.round(value * 100) / 100;
}
function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

export function toNumberOrNull(value) {
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

function exerciseSelectionRisk(exercises) {
  if (!Array.isArray(exercises) || exercises.length === 0) {
    return null;
  }

  const normalized = exercises.map((item) => String(item).trim().toLowerCase());
  if (normalized.includes('none')) {
    return 60;
  }

  return 20;
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

function habitRecoveryRisk(habits) {
  if (!Array.isArray(habits) || habits.length === 0) {
    return null;
  }

  const normalized = habits.map((item) => String(item).trim().toLowerCase());
  if (normalized.includes('none')) {
    return 60;
  }

  const count = new Set(normalized).size;
  if (count >= 3) {
    return 5;
  }
  if (count === 2) {
    return 12;
  }
  return 25;
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

export function formatDateOnly(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value ?? '').slice(0, 10);
}

export function addDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${formatDateOnly(startDate)}T00:00:00.000Z`);
  const end = new Date(`${formatDateOnly(endDate)}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  );
}

function weeklyPulseFreshness(weeklyPulse, scoreDate) {
  if (!weeklyPulse) {
    return { ageDays: null, freshness: 'not_available' };
  }

  const ageDays = daysBetween(
    weeklyPulse.response_date ?? weeklyPulse.week_start_date,
    scoreDate
  );

  if (ageDays == null) {
    return { ageDays: null, freshness: 'unknown' };
  }
  if (ageDays <= 8) {
    return { ageDays, freshness: 'current' };
  }
  if (ageDays <= 13) {
    return { ageDays, freshness: 'aging' };
  }

  return { ageDays, freshness: 'stale' };
}

export function getWeekStartDate(value) {
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

  return {
    'daily_logs.sleep_hours': dailyLog?.sleep_hours,
    'daily_logs.sleep_quality': dailyLog?.sleep_quality,
    'daily_logs.mood_index': dailyLog?.mood_index,
    'daily_logs.energy_level': dailyLog?.energy_level,
    'daily_logs.hydration_liters': dailyLog?.hydration_liters,
    'daily_logs.workload_hours_band': dailyLog?.workload_hours_band,
    'daily_logs.exercise_names': dailyLog?.exercise_names,
    'daily_logs.symptom_names': dailyLog?.symptom_names,
    'daily_logs.habit_names': dailyLog?.habit_names,
    'weekly_pulse_responses.perceived_pressure_level':
      weeklyPulse?.perceived_pressure_level,
    'weekly_pulse_responses.productivity_focus_level':
      weeklyPulse?.productivity_focus_level,
    'weekly_pulse_responses.recovery_rest_level':
      weeklyPulse?.recovery_rest_level,
    'weekly_pulse_responses.detachment_level': weeklyPulse?.detachment_level,
    'weekly_pulse_responses.accomplishment_level':
      weeklyPulse?.accomplishment_level
  };
}

function computeCompleteness(inputs) {
  const fieldMap = presentFieldMap(inputs);
  const expectedFields = inputs.weeklyPulse
    ? [...EXPECTED_DAILY_SCORE_FIELDS, ...EXPECTED_WEEKLY_SCORE_FIELDS]
    : EXPECTED_DAILY_SCORE_FIELDS;
  const presentFields = expectedFields.filter((field) =>
    isPresent(fieldMap[field])
  );
  const missingFields = expectedFields.filter((field) =>
    !isPresent(fieldMap[field])
  );

  return {
    completenessScore: roundTwo(
      (presentFields.length / expectedFields.length) * 100
    ),
    dataPointsCount: presentFields.length,
    missingFields
  };
}

function compactSourceSnapshot(inputs, risks, baselinePolicy) {
  const dailyLog = inputs.dailyLog;
  const weeklyPulse = inputs.weeklyPulse;
  const activityLog = inputs.activityLog;
  const profile = inputs.profile;
  const pulseFreshness = weeklyPulseFreshness(weeklyPulse, inputs.scoreDate);

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
          daily_detachment_level: toIntegerOrNull(
            dailyLog.daily_detachment_level
          ),
          daily_focus_level: toIntegerOrNull(dailyLog.daily_focus_level),
          daily_accomplishment_level: toIntegerOrNull(
            dailyLog.daily_accomplishment_level
          ),
          exercise_names: Array.isArray(dailyLog.exercise_names)
            ? dailyLog.exercise_names
                .map((item) => String(item).trim())
                .filter((item) => item.length > 0)
            : null,
          symptom_names: Array.isArray(dailyLog.symptom_names)
            ? dailyLog.symptom_names
                .map((item) => String(item).trim())
                .filter((item) => item.length > 0)
            : null,
          habit_names: Array.isArray(dailyLog.habit_names)
            ? dailyLog.habit_names
                .map((item) => String(item).trim())
                .filter((item) => item.length > 0)
            : null,
          exercise_goal_name: dailyLog.exercise_goal_name ?? null,
          exercise_goal_completed:
            dailyLog.exercise_goal_completed == null
              ? null
              : dailyLog.exercise_goal_completed === true,
          exercise_goal_source: dailyLog.exercise_goal_source ?? null,
          exercise_goal_status: dailyLog.exercise_goal_status ?? null,
          exercise_count: Array.isArray(dailyLog.exercise_names)
            ? dailyLog.exercise_names.filter((item) => item !== 'None').length
            : null,
          symptom_count: Array.isArray(dailyLog.symptom_names)
            ? dailyLog.symptom_names.filter((item) => item !== 'None').length
            : null,
          habit_count: Array.isArray(dailyLog.habit_names)
            ? dailyLog.habit_names.filter((item) => item !== 'None').length
            : null
        }
      : null,
    weekly_pulse: weeklyPulse
      ? {
          week_start_date: formatDateOnly(weeklyPulse.week_start_date),
          due_date: formatDateOnly(
            weeklyPulse.due_date ?? weeklyPulse.week_start_date
          ),
          response_date: formatDateOnly(
            weeklyPulse.response_date ?? weeklyPulse.week_start_date
          ),
          perceived_pressure_level: toIntegerOrNull(
            weeklyPulse.perceived_pressure_level
          ),
          productivity_focus_level: toIntegerOrNull(
            weeklyPulse.productivity_focus_level
          ),
          recovery_rest_level: toIntegerOrNull(
            weeklyPulse.recovery_rest_level
          ),
          detachment_level: toIntegerOrNull(weeklyPulse.detachment_level),
          accomplishment_level: toIntegerOrNull(
            weeklyPulse.accomplishment_level
          ),
          age_days: pulseFreshness.ageDays,
          freshness: pulseFreshness.freshness,
          schema_version: toIntegerOrNull(weeklyPulse.schema_version)
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
    baseline_policy: {
      epoch_started_at: baselinePolicy.epochStartedAt,
      days_since_epoch_start: baselinePolicy.daysSinceEpochStart,
      logged_day_count: baselinePolicy.loggedDayCount,
      weekly_pulse_count_since_epoch: baselinePolicy.weeklyPulseCount,
      stable_pattern_detected: baselinePolicy.stablePatternDetected,
      baseline_weight: baselinePolicy.baselineWeight,
      window_used: baselinePolicy.windowUsed
    },
    normalized_risks: risks
  };
}

function buildContributingFactors(scores, risks) {
  const factors = [
    {
      key: 'weekly_pressure',
      label: 'Weekly pressure',
      score: risks.pressureRisk,
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
      key: 'recovery_habits',
      label: 'Recovery habits',
      score: risks.habitRecoveryRisk,
      direction: 'higher_increases_risk'
    },
    {
      key: 'weekly_detachment',
      label: 'Weekly detachment',
      score: risks.detachmentRisk,
      direction: 'higher_increases_risk'
    },
    {
      key: 'weekly_focus',
      label: 'Weekly focus',
      score: risks.productivityFocusRisk,
      direction: 'higher_increases_risk'
    },
    {
      key: 'weekly_accomplishment',
      label: 'Weekly accomplishment',
      score: risks.accomplishmentRisk,
      direction: 'higher_increases_risk'
    },
    {
      key: 'sleep_recovery',
      label: 'Sleep recovery',
      score: risks.sleepDurationRisk,
      direction: 'higher_increases_risk'
    },
    {
      key: 'movement',
      label: 'Movement',
      score: risks.movementRisk,
      direction: 'higher_increases_risk'
    },
    {
      key: 'detachment',
      label: 'Detachment dimension',
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
  if (averageScore <= 1.5) {
    return { level: 'Very Low', displayScore: 10 };
  }

  if (averageScore <= 2.5) {
    return { level: 'Low', displayScore: 25 };
  }

  if (averageScore <= 3.5) {
    return { level: 'Moderate', displayScore: 35 };
  }

  if (averageScore <= 4.5) {
    return { level: 'High', displayScore: 45 };
  }

  return { level: 'Very High', displayScore: 60 };
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
  const activityRiskValue = activityRisk(activityLog);
  // Retired daily dimension fields remain as fallbacks for historical rows only.
  // New check-ins supply these signals through the weekly pulse.
  const pressureValue = weeklyPulse?.perceived_pressure_level ??
    dailyLog?.perceived_stress_level;
  const recoveryRestValue = weeklyPulse?.recovery_rest_level ??
    dailyLog?.break_quality_level;
  const detachmentValue = weeklyPulse?.detachment_level ??
    dailyLog?.daily_detachment_level;
  const productivityFocusValue = weeklyPulse?.productivity_focus_level ??
    dailyLog?.daily_focus_level;
  const accomplishmentValue = weeklyPulse?.accomplishment_level ??
    dailyLog?.daily_accomplishment_level;
  const risks = {
    pressureRisk: riskFromLikertHighRisk(pressureValue),
    workloadRisk,
    sleepDurationRisk: sleepDurationRisk(dailyLog?.sleep_hours),
    sleepQualityRisk: riskFromZeroIndexedHighGood(dailyLog?.sleep_quality, 4),
    moodRisk: riskFromZeroIndexedHighGood(dailyLog?.mood_index, 4),
    energyRisk: riskFromLikertHighGood(dailyLog?.energy_level),
    hydrationRisk: hydrationRisk(dailyLog?.hydration_liters),
    symptomRisk: symptomsRisk(dailyLog?.symptom_names),
    habitRecoveryRisk: habitRecoveryRisk(dailyLog?.habit_names),
    productivityFocusRisk: riskFromLikertHighGood(productivityFocusValue),
    recoveryRestRisk: riskFromLikertHighGood(recoveryRestValue),
    detachmentRisk: riskFromLikertHighRisk(detachmentValue),
    accomplishmentRisk: riskFromLikertHighGood(accomplishmentValue),
    activityRisk: activityRiskValue,
    movementRisk: activityRiskValue ??
      exerciseSelectionRisk(dailyLog?.exercise_names),
    baselineRisk
  };

  const emotionalExhaustionScore = weightedAverage([
    { score: risks.pressureRisk, weight: DIMENSION_WEIGHTS.emotionalExhaustion.pressureRisk },
    { score: risks.energyRisk, weight: DIMENSION_WEIGHTS.emotionalExhaustion.energyRisk },
    { score: risks.sleepQualityRisk, weight: DIMENSION_WEIGHTS.emotionalExhaustion.sleepQualityRisk },
    { score: risks.sleepDurationRisk, weight: DIMENSION_WEIGHTS.emotionalExhaustion.sleepDurationRisk },
    { score: risks.moodRisk, weight: DIMENSION_WEIGHTS.emotionalExhaustion.moodRisk },
    { score: risks.workloadRisk, weight: DIMENSION_WEIGHTS.emotionalExhaustion.workloadRisk },
    { score: risks.symptomRisk, weight: DIMENSION_WEIGHTS.emotionalExhaustion.symptomRisk }
  ]);

  const detachmentScore = weightedAverage([
    { score: risks.detachmentRisk, weight: DIMENSION_WEIGHTS.detachment.detachmentRisk },
    { score: risks.recoveryRestRisk, weight: DIMENSION_WEIGHTS.detachment.recoveryRestRisk },
    { score: risks.habitRecoveryRisk, weight: DIMENSION_WEIGHTS.detachment.habitRecoveryRisk },
    { score: risks.hydrationRisk, weight: DIMENSION_WEIGHTS.detachment.hydrationRisk },
    { score: risks.moodRisk, weight: DIMENSION_WEIGHTS.detachment.moodRisk },
    { score: risks.pressureRisk, weight: DIMENSION_WEIGHTS.detachment.pressureRisk }
  ]);

  const reducedAccomplishmentScore = weightedAverage([
    { score: risks.productivityFocusRisk, weight: DIMENSION_WEIGHTS.reducedAccomplishment.productivityFocusRisk },
    { score: risks.accomplishmentRisk, weight: DIMENSION_WEIGHTS.reducedAccomplishment.accomplishmentRisk },
    { score: risks.workloadRisk, weight: DIMENSION_WEIGHTS.reducedAccomplishment.workloadRisk },
    { score: risks.movementRisk, weight: DIMENSION_WEIGHTS.reducedAccomplishment.movementRisk }
  ]);

  const recoveryDeficitScore = weightedAverage([
    { score: risks.recoveryRestRisk, weight: DIMENSION_WEIGHTS.recoveryDeficit.recoveryRestRisk },
    { score: risks.sleepDurationRisk, weight: DIMENSION_WEIGHTS.recoveryDeficit.sleepDurationRisk },
    { score: risks.sleepQualityRisk, weight: DIMENSION_WEIGHTS.recoveryDeficit.sleepQualityRisk },
    { score: risks.hydrationRisk, weight: DIMENSION_WEIGHTS.recoveryDeficit.hydrationRisk },
    { score: risks.movementRisk, weight: DIMENSION_WEIGHTS.recoveryDeficit.movementRisk },
    { score: risks.habitRecoveryRisk, weight: DIMENSION_WEIGHTS.recoveryDeficit.habitRecoveryRisk }
  ]);

  const workloadStrainScore = weightedAverage([
    { score: risks.workloadRisk, weight: DIMENSION_WEIGHTS.workloadStrain.workloadRisk },
    { score: risks.pressureRisk, weight: DIMENSION_WEIGHTS.workloadStrain.pressureRisk },
    { score: recoveryDeficitScore, weight: DIMENSION_WEIGHTS.workloadStrain.recoveryDeficitScore }
  ]);

  const behavioralComposite = weightedAverage([
    { score: emotionalExhaustionScore, weight: DIMENSION_WEIGHTS.behavioralComposite.emotionalExhaustionScore },
    { score: detachmentScore, weight: DIMENSION_WEIGHTS.behavioralComposite.detachmentScore },
    { score: reducedAccomplishmentScore, weight: DIMENSION_WEIGHTS.behavioralComposite.reducedAccomplishmentScore },
    { score: recoveryDeficitScore, weight: DIMENSION_WEIGHTS.behavioralComposite.recoveryDeficitScore },
    { score: workloadStrainScore, weight: DIMENSION_WEIGHTS.behavioralComposite.workloadStrainScore }
  ]);

  if (behavioralComposite == null) {
    return null;
  }

  const completeness = computeCompleteness(inputs);
  const pulseFreshness = weeklyPulseFreshness(weeklyPulse, inputs.scoreDate);
  const sourceBreadthMultiplier = dailyLog && weeklyPulse
    ? pulseFreshness.freshness === 'current'
      ? 1
      : pulseFreshness.freshness === 'aging'
        ? 0.94
        : 0.82
    : dailyLog
      ? 0.9
      : weeklyPulse
        ? 0.72
        : 0.58;
  const confidenceScore = roundTwo(
    clamp(completeness.completenessScore * sourceBreadthMultiplier)
  );
  const baselineEvidence = inputs.baselineEvidence ?? {};
  const recentScores = Array.isArray(baselineEvidence.recentScores)
    ? baselineEvidence.recentScores.filter((score) =>
        formatDateOnly(score.score_date) !== inputs.scoreDate
      )
    : [];
  const sevenDayScores = [
    ...recentScores.map((score) => ({
      overallScore: toNumberOrNull(score.overall_score),
      confidenceScore: toNumberOrNull(score.confidence_score),
      completenessScore: toNumberOrNull(score.completeness_score)
    })),
    {
      overallScore: behavioralComposite,
      confidenceScore,
      completenessScore: completeness.completenessScore
    }
  ].filter((score) => Number.isFinite(score.overallScore));
  const averageMetric = (key) => weightedAverage(
    sevenDayScores.map((score) => ({ score: score[key], weight: 1 }))
  );
  const volatilityValues = [];
  for (let index = 1; index < sevenDayScores.length; index += 1) {
    volatilityValues.push(Math.abs(
      sevenDayScores[index].overallScore - sevenDayScores[index - 1].overallScore
    ));
  }
  const volatility7Day = volatilityValues.length === 0
    ? 0
    : roundTwo(
        volatilityValues.reduce((sum, value) => sum + value, 0) /
          volatilityValues.length
      );
  const epochStartedAt = inputs.baselineEpoch?.startedAt ??
    baselineEvidence.epochStartedAt ?? inputs.scoreDate;
  const weeklyPulseCount = Math.max(
    Number(baselineEvidence.weeklyPulseCount ?? 0),
    weeklyPulse ? 1 : 0
  );
  const baselinePolicy = calculateBaselinePolicy({
    epochStartedAt,
    daysSinceEpochStart: daysBetween(epochStartedAt, inputs.scoreDate) ?? 0,
    loggedDayCount: Math.max(
      Number(baselineEvidence.loggedDayCount ?? 0),
      dailyLog ? 1 : 0
    ),
    weeklyPulseCount,
    logsLast14Days: Math.max(
      Number(baselineEvidence.logsLast14Days ?? 0),
      dailyLog ? 1 : 0
    ),
    logsLast28Days: Math.max(
      Number(baselineEvidence.logsLast28Days ?? 0),
      dailyLog ? 1 : 0
    ),
    averageConfidence7Day: averageMetric('confidenceScore'),
    averageCompleteness7Day: averageMetric('completenessScore'),
    volatility7Day,
    hasAdditionalBehavioralSource: weeklyPulseCount > 0 ||
      Number(baselineEvidence.activityRecordCount ?? 0) > 0 ||
      activityLog != null
  });
  if (!Number.isFinite(baselineRisk)) {
    baselinePolicy.baselineWeight = 0;
  }
  const overallScore = Number.isFinite(baselineRisk) &&
      baselinePolicy.baselineWeight > 0
    ? roundTwo(
        behavioralComposite * (1 - baselinePolicy.baselineWeight) +
          baselineRisk * baselinePolicy.baselineWeight
      )
    : behavioralComposite;
  const scores = {
    emotionalExhaustionScore,
    detachmentScore,
    reducedAccomplishmentScore,
    workloadStrainScore,
    recoveryDeficitScore
  };

  const contributingFactors = buildContributingFactors(scores, risks);

  return {
    user_id: inputs.userId,
    baseline_epoch_id: inputs.baselineEpoch?.baselineEpochId ?? null,
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
    contributing_factors: contributingFactors,
    source_snapshot: compactSourceSnapshot(inputs, risks, baselinePolicy),
    scoring_version: BURNOUT_SCORING_VERSION
  };
}
