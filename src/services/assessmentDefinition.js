import { createHash } from 'node:crypto';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const ASSESSMENT_IDENTITY = freeze({
  instrument: 'cbi_personal_burnout',
  instrument_version: '1.0.0',
  definition_version: 'cbi-pb-context-en-1.0.0',
  scoring_version: 'cbi-pb-mean-1.0.0',
  context_version: 'vitalysync-context-1.0.0',
  language: 'en',
});

const questions = [
  ['PB1', 'How often do you feel tired?'],
  ['PB2', 'How often are you physically exhausted?'],
  ['context1', 'How often do your daily responsibilities feel unmanageable?'],
  ['PB3', 'How often are you emotionally exhausted?'],
  ['context2', 'How often do you have time to rest after demanding activities?'],
  ['PB4', 'How often do you think: “I can’t take it anymore”?'],
  ['context3', 'How often can you maintain a consistent sleep schedule?'],
  ['PB5', 'How often do you feel worn out?'],
  ['context4', 'How often can you get support when your responsibilities feel difficult?'],
  ['PB6', 'How often do you feel weak and susceptible to illness?'],
];

// Retain this definition unchanged once used; register a new version for changes.
export const CBI_DEFINITION = freeze({
  ...ASSESSMENT_IDENTITY,
  title: 'Exhaustion assessment — CBI Personal Burnout',
  response_options: ['Never/almost never', 'Seldom', 'Sometimes', 'Often', 'Always']
    .map((label, index) => ({ value: index + 1, label })),
  items: questions.map(([question_id, text], index) => ({
    question_id,
    text,
    type: question_id.startsWith('PB') ? 'cbi' : 'context',
    instrument: question_id.startsWith('PB') ? 'cbi_personal_burnout' : 'vitalysync_context',
    required: question_id.startsWith('PB'),
    position: index + 1,
  })),
  presentation_order: questions.map(([id]) => id),
  minimum_scoring_answers: 3,
  required_submission_answers: 6,
  translation_allowed: false,
  explanation: 'This score describes how often you reported physical and psychological exhaustion. '
    + 'It is not a diagnosis or a probability. Lifestyle context and daily logs do not change it.',
  context_explanation: 'Four optional researcher-developed questions help personalize wellness support. '
    + 'They are not CBI items and are not scored.',
  sources: [
    { citation: 'Kristensen TS, Borritz M, Villadsen E, Christensen KB. 2005. The Copenhagen Burnout Inventory: A new tool for the assessment of burnout. Work & Stress 19(3), 192–207.', url: 'https://doi.org/10.1080/02678370500297720' },
    { citation: 'Borritz M et al. 2006. Burnout among employees in human service work: design and baseline findings of the PUMA study. Scandinavian Journal of Public Health 34, 49–58.', url: 'https://nfa.dk/vaerktoejer/spoergeskemaer/spoergeskema-til-maaling-af-udbraendthed-cbi/copenhagen-burnout-inventory-cbi' },
    { citation: 'NFA. Copenhagen Burnout Inventory, English version used in the PUMA study. Personal burnout.', url: 'https://nfa.dk/media/a4wheblj/cbi-scales.pdf' },
  ],
});

export const DEFINITION_ETAG = `"${createHash('sha256').update(JSON.stringify(CBI_DEFINITION)).digest('hex')}"`;

export class AssessmentError extends Error {
  constructor(code, message, statusCode = 400, details) {
    super(message);
    this.name = 'AssessmentError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function isAssessmentEnabled() {
  return (process.env.CBI_ASSESSMENT_ENABLED ?? 'true') === 'true';
}

export function requireAssessmentEnabled() {
  if (!isAssessmentEnabled()) {
    throw new AssessmentError('ASSESSMENT_NOT_ENABLED', 'Assessment submissions are not enabled.', 503);
  }
}

export function getAssessmentDefinition({ instrument, definition_version } = {}) {
  if ((instrument !== undefined && instrument !== ASSESSMENT_IDENTITY.instrument)
    || (definition_version !== undefined && definition_version !== ASSESSMENT_IDENTITY.definition_version)) {
    throw new AssessmentError('UNSUPPORTED_ASSESSMENT_VERSION', 'Unsupported assessment definition.', 422,
      { supported_versions: [ASSESSMENT_IDENTITY] });
  }
  return CBI_DEFINITION;
}

export function validateAssessmentIdentity(payload) {
  if (Object.entries(ASSESSMENT_IDENTITY).some(([key, value]) => payload[key] !== value)) {
    throw new AssessmentError('UNSUPPORTED_ASSESSMENT_VERSION', 'Unsupported assessment version or language.', 422,
      { supported_versions: [ASSESSMENT_IDENTITY] });
  }
}
