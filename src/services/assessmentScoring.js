import { AssessmentError, CBI_DEFINITION } from './assessmentDefinition.js';

export function validateAssessmentAnswers(answers, { requireComplete = false } = {}) {
  if (!Array.isArray(answers) || answers.length > CBI_DEFINITION.items.length) {
    throw new AssessmentError('INVALID_ASSESSMENT_PAYLOAD', 'Expected at most ten answer records.');
  }
  const seen = new Set();
  const normalized = answers.map((answer) => {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)
      || Object.keys(answer).some((key) => !['question_id', 'response'].includes(key))) {
      throw new AssessmentError('INVALID_ASSESSMENT_PAYLOAD', 'Invalid answer record.');
    }
    const item = CBI_DEFINITION.items.find((item) => item.question_id === answer.question_id);
    if (!item || seen.has(item.question_id)) {
      throw new AssessmentError('INVALID_ASSESSMENT_PAYLOAD', 'Unknown or duplicate question ID.');
    }
    seen.add(item.question_id);
    if (!Number.isInteger(answer.response) || answer.response < 1 || answer.response > 5) {
      throw new AssessmentError('INVALID_ASSESSMENT_RESPONSE', 'Responses must be integers from 1 to 5.');
    }
    return { question_id: item.question_id, response: answer.response };
  });
  const missing = CBI_DEFINITION.items.filter((item) => item.required && !seen.has(item.question_id));
  if (requireComplete && missing.length) {
    throw new AssessmentError('ASSESSMENT_INCOMPLETE', 'Answer all six CBI questions to complete the assessment.', 400,
      { missing_question_ids: missing.map((item) => item.question_id) });
  }
  return normalized.sort((a, b) => a.question_id.localeCompare(b.question_id, 'en'));
}

// Published missing-item rule. App submissions enforce complete-six separately.
export function scorePersonalBurnout(answers) {
  const normalized = validateAssessmentAnswers(answers);
  const cbi = normalized.filter((answer) => answer.question_id.startsWith('PB'));
  const total = cbi.reduce((sum, answer) => sum + 25 * (answer.response - 1), 0);
  const mean = cbi.length >= 3 ? total / cbi.length : null;
  const score = mean === null ? null : Math.round(mean * 10) / 10;
  return {
    score,
    display_score: score === null ? null : score.toFixed(1),
    mapped_total: total,
    answered_items: cbi.length,
    required_items: 6,
    scale_min: 0,
    scale_max: 100,
  };
}
