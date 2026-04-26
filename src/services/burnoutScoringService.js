const EMOTIONAL_EXHAUSTION_KEYS = ['ee_01', 'ee_02', 'ee_03', 'ee_04', 'ee_05'];
const DEPERSONALIZATION_KEYS = ['dp_01', 'dp_02', 'dp_03', 'dp_04', 'dp_05'];
const PERSONAL_ACCOMPLISHMENT_KEYS = ['pa_01', 'pa_02', 'pa_03', 'pa_04', 'pa_05'];

function roundTwo(value) {
  return Math.round(value * 100) / 100;
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
