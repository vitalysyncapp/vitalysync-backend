const USER_FACING_SEVERITY = {
  steady: 'steady',
  improving: 'steady',
  low: 'steady',
  watch: 'watch',
  moderate: 'watch',
  medium: 'watch',
  high_risk: 'high',
  high: 'high',
  critical: 'needs support',
  urgent: 'needs support',
  needs_support: 'needs support'
};

export function toUserFacingNudgeSeverity(value, fallback = 'steady') {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  const normalizedFallback = String(fallback ?? 'steady')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');

  return USER_FACING_SEVERITY[normalized] ??
    USER_FACING_SEVERITY[normalizedFallback] ??
    'steady';
}

export function fallbackCopyForSeverity(value) {
  switch (toUserFacingNudgeSeverity(value)) {
    case 'needs support':
      return {
        title: 'Extra support may help',
        message:
          'Today calls for extra support. Lower one demand and reach out to someone you trust if needed.',
        actionLabel: 'Reach out'
      };
    case 'high':
      return {
        title: 'Protect recovery today',
        message:
          'Recent strain is staying high. Make one task smaller and protect a real break.',
        actionLabel: 'Reduce one task'
      };
    case 'watch':
      return {
        title: 'Take a small reset',
        message:
          'Pressure is trending up. Take one short reset before the next task.',
        actionLabel: 'Take a reset'
      };
    default:
      return {
        title: 'Keep what is working',
        message:
          'Your recent pattern is steady. Keep one recovery habit simple today.',
        actionLabel: 'Keep it simple'
      };
  }
}
