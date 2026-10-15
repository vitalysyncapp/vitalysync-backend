export const BURNOUT_QUESTIONNAIRE_VERSION = 'vitalysync_maslach22_v1';
export const WEEKLY_QUESTIONNAIRE_VERSION = 'vitalysync_maslach11_v1';
export const LEGACY_BASELINE_VERSION = 'baseline_15_v1';

const LEGACY_QUESTIONS = [
  {
    question_key: 'ee_01',
    question_text: 'I feel emotionally drained by my daily responsibilities.',
    category: 'emotional_exhaustion',
    is_reverse_scored: false
  },
  {
    question_key: 'ee_02',
    question_text: 'I feel tired even before starting my day.',
    category: 'emotional_exhaustion',
    is_reverse_scored: false
  },
  {
    question_key: 'ee_03',
    question_text: 'I feel overwhelmed by my tasks.',
    category: 'emotional_exhaustion',
    is_reverse_scored: false
  },
  {
    question_key: 'ee_04',
    question_text: 'I feel fatigued most of the time.',
    category: 'emotional_exhaustion',
    is_reverse_scored: false
  },
  {
    question_key: 'ee_05',
    question_text: 'I feel I have no energy left at the end of the day.',
    category: 'emotional_exhaustion',
    is_reverse_scored: false
  },
  {
    question_key: 'dp_01',
    question_text: 'I feel detached from my responsibilities.',
    category: 'depersonalization',
    is_reverse_scored: false
  },
  {
    question_key: 'dp_02',
    question_text: 'I have become less interested in things I used to enjoy.',
    category: 'depersonalization',
    is_reverse_scored: false
  },
  {
    question_key: 'dp_03',
    question_text: 'I feel indifferent toward my tasks.',
    category: 'depersonalization',
    is_reverse_scored: false
  },
  {
    question_key: 'dp_04',
    question_text: 'I feel less emotionally connected to others.',
    category: 'depersonalization',
    is_reverse_scored: false
  },
  {
    question_key: 'dp_05',
    question_text: 'I sometimes feel like I’m just going through the motions.',
    category: 'depersonalization',
    is_reverse_scored: false
  },
  {
    question_key: 'pa_01',
    question_text: 'I feel productive in my daily life.',
    category: 'personal_accomplishment',
    is_reverse_scored: true
  },
  {
    question_key: 'pa_02',
    question_text: 'I feel I am achieving meaningful results.',
    category: 'personal_accomplishment',
    is_reverse_scored: true
  },
  {
    question_key: 'pa_03',
    question_text: 'I feel confident handling my responsibilities.',
    category: 'personal_accomplishment',
    is_reverse_scored: true
  },
  {
    question_key: 'pa_04',
    question_text: 'I feel motivated to accomplish my goals.',
    category: 'personal_accomplishment',
    is_reverse_scored: true
  },
  {
    question_key: 'pa_05',
    question_text: 'I feel satisfied with what I achieve each day.',
    category: 'personal_accomplishment',
    is_reverse_scored: true
  }
];

const ADDITIONAL_QUESTIONS = [
  {
    "question_key": "ee_06",
    "question_text": "I feel worn out after dealing with everyday demands.",
    "category": "emotional_exhaustion",
    "is_reverse_scored": false
  },
  {
    "question_key": "ee_07",
    "question_text": "I find it tiring to keep up with what is expected of me.",
    "category": "emotional_exhaustion",
    "is_reverse_scored": false
  },
  {
    "question_key": "ee_08",
    "question_text": "I feel emotionally spent when another task comes up.",
    "category": "emotional_exhaustion",
    "is_reverse_scored": false
  },
  {
    "question_key": "ee_09",
    "question_text": "I feel that my responsibilities use up my emotional strength.",
    "category": "emotional_exhaustion",
    "is_reverse_scored": false
  },
  {
    "question_key": "pa_06",
    "question_text": "I can find a useful way forward when a task becomes difficult.",
    "category": "personal_accomplishment",
    "is_reverse_scored": true
  },
  {
    "question_key": "pa_07",
    "question_text": "I feel that my efforts make a positive difference.",
    "category": "personal_accomplishment",
    "is_reverse_scored": true
  },
  {
    "question_key": "pa_08",
    "question_text": "I handle unexpected demands effectively.",
    "category": "personal_accomplishment",
    "is_reverse_scored": true
  }
];

export const BURNOUT_QUESTIONS = [...LEGACY_QUESTIONS, ...ADDITIONAL_QUESTIONS]
  .sort((a, b) => {
    const order = ['emotional_exhaustion', 'depersonalization', 'personal_accomplishment'];
    return order.indexOf(a.category) - order.indexOf(b.category) || a.question_key.localeCompare(b.question_key);
  });

// The baseline retains all 22 items; the weekly form uses this stable subset.
export const WEEKLY_BURNOUT_QUESTIONS = BURNOUT_QUESTIONS.filter((question) =>
  Number(question.question_key.slice(-2)) <=
    (question.category === 'emotional_exhaustion' ? 5 : 3)
);

export function questionsForVersion(version = LEGACY_BASELINE_VERSION) {
  if (version === LEGACY_BASELINE_VERSION) return LEGACY_QUESTIONS;
  if (version === BURNOUT_QUESTIONNAIRE_VERSION) return BURNOUT_QUESTIONS;
  if (version === WEEKLY_QUESTIONNAIRE_VERSION) return WEEKLY_BURNOUT_QUESTIONS;
  const error = new Error('Unsupported burnout questionnaire version');
  error.statusCode = 400;
  throw error;
}

export function normalizeBurnoutAnswers(answers, version = BURNOUT_QUESTIONNAIRE_VERSION) {
  const questions = questionsForVersion(version);
  const entries = Array.isArray(answers)
    ? answers.map((answer) => [answer?.question_key ?? answer?.key, answer?.numeric_value ?? answer?.value])
    : answers && typeof answers === 'object' ? Object.entries(answers) : [];
  const keys = new Set(questions.map((question) => question.question_key));
  const normalized = {};
  for (const [key, value] of entries) {
    if (!keys.has(key) || Object.hasOwn(normalized, key) || typeof value !== 'number' ||
        !Number.isInteger(value) || value < 1 || value > 5) {
      const error = new Error('Every questionnaire answer must have a unique known key and an integer value from 1 to 5');
      error.statusCode = 400;
      throw error;
    }
    normalized[key] = value;
  }
  if (Object.keys(normalized).length !== questions.length) {
    const error = new Error(`All ${questions.length} questionnaire answers are required`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

export function calculateQuestionnaireDimensions(answers, version = BURNOUT_QUESTIONNAIRE_VERSION) {
  const normalized = normalizeBurnoutAnswers(answers, version);
  return Object.fromEntries(['emotional_exhaustion', 'depersonalization', 'personal_accomplishment'].map((dimension) => {
    const items = questionsForVersion(version).filter((question) => question.category === dimension);
    const total = items.reduce((sum, question) => sum + normalized[question.question_key], 0);
    return [dimension, {
      total,
      mean: Math.round(total / items.length * 100) / 100,
      item_count: items.length,
      minimum: items.length,
      maximum: items.length * 5,
      higher_is: dimension === 'personal_accomplishment' ? 'more_accomplishment' : 'more_burden'
    }];
  }));
}
