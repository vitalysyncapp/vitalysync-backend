export const NUDGE_COPY_LIMITS = Object.freeze({
  title: 48,
  message: 140,
  actionLabel: 32,
  reason: 80,
  actionStep: 48,
  safetyNote: 80
});

const DIAGNOSIS_PATTERNS = [
  /\byou (?:have|are|are experiencing|suffer(?:ing)? from) burnout\b/i,
  /\byou (?:are|feel|seem) burned out\b/i,
  /\byour burnout\b/i,
  /\byou (?:have|are|are experiencing|suffer(?:ing)? from) (?:anxiety|depression)\b/i,
  /\bdiagnos(?:e|ed|is|ing)\b/i,
  /\bclinical(?:ly)?\b/i,
  /\bmedical diagnosis\b/i
];

const UNSUPPORTED_CLAIM_PATTERNS = [
  /\bguarantee(?:d|s)?\b/i,
  /\b(?:will|can) cure\b/i,
  /\b(?:will|can) prevent burnout\b/i,
  /\b(?:will|can) eliminate (?:burnout|stress|anxiety|depression)\b/i,
  /\bproven to (?:cure|prevent|treat|fix)\b/i,
  /\bdata (?:proves|confirms) (?:that )?you\b/i,
  /\byour (?:body|brain) (?:needs|is lacking)\b/i,
  /\b(?:always|never) works?\b/i
];

const INTERNAL_SEVERITY_PATTERN = /\b(?:critical|urgent)\b/i;

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textWithoutDisplayName(text, displayName) {
  if (!displayName) {
    return text;
  }

  return text.replace(new RegExp(escapeRegExp(displayName), 'gi'), '');
}

export function validateNudgeCopy({
  title,
  message,
  actionLabel,
  displayName = null,
  additionalText = []
}) {
  const normalizedTitle = normalizedText(title);
  const normalizedMessage = normalizedText(message);
  const normalizedAction = normalizedText(actionLabel);
  const normalizedName = normalizedText(displayName);
  const extras = (Array.isArray(additionalText) ? additionalText : [additionalText])
    .map(normalizedText)
    .filter(Boolean);
  const errors = [];

  if (!normalizedTitle) errors.push('missing_title');
  if (!normalizedMessage) errors.push('missing_message');
  if (!normalizedAction) errors.push('missing_action_label');
  if (normalizedTitle.length > NUDGE_COPY_LIMITS.title) {
    errors.push('title_too_long');
  }
  if (normalizedMessage.length > NUDGE_COPY_LIMITS.message) {
    errors.push('message_too_long');
  }
  if (normalizedAction.length > NUDGE_COPY_LIMITS.actionLabel) {
    errors.push('action_label_too_long');
  }

  const allCopy = [
    normalizedTitle,
    normalizedMessage,
    normalizedAction,
    ...extras
  ].join(' ');
  const policyCopy = textWithoutDisplayName(allCopy, normalizedName);

  if (DIAGNOSIS_PATTERNS.some((pattern) => pattern.test(policyCopy))) {
    errors.push('diagnosis_language');
  }
  if (UNSUPPORTED_CLAIM_PATTERNS.some((pattern) => pattern.test(policyCopy))) {
    errors.push('unsupported_claim');
  }
  if (INTERNAL_SEVERITY_PATTERN.test(policyCopy)) {
    errors.push('internal_severity_label');
  }

  if (normalizedName) {
    const nameMatches = allCopy.match(
      new RegExp(escapeRegExp(normalizedName), 'gi')
    ) ?? [];
    if (nameMatches.length !== 1) {
      errors.push('username_count');
    }
    if (!normalizedMessage.toLowerCase().startsWith(
      `${normalizedName.toLowerCase()},`
    )) {
      errors.push('username_placement');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    copy: {
      title: normalizedTitle,
      message: normalizedMessage,
      actionLabel: normalizedAction
    }
  };
}
