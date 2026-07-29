const PRODUCT_EVENT_NAMES = new Set([
  'daily_check_in_prompted',
  'daily_check_in_completed',
  'weekly_pulse_prompted',
  'weekly_pulse_completed',
  'baseline_refresh_prompted',
  'baseline_refresh_completed',
  'nutrition_nudge_shown',
  'exercise_recommendation_shown',
  'exercise_recommendation_selected',
  'exercise_goal_completed'
]);

export const CLIENT_PRODUCT_EVENT_NAMES = new Set([
  'nutrition_nudge_shown',
  'exercise_recommendation_shown'
]);

const DIMENSION_KEYS = {
  daily_check_in_prompted: new Set(['check_in_type', 'overdue']),
  daily_check_in_completed: new Set(['check_in_type', 'redo']),
  weekly_pulse_prompted: new Set(['check_in_type', 'overdue']),
  weekly_pulse_completed: new Set(['check_in_type', 'redo']),
  baseline_refresh_prompted: new Set(['reason']),
  baseline_refresh_completed: new Set(['reason']),
  nutrition_nudge_shown: new Set([
    'macro_focus',
    'food_group',
    'nutrition_nudge_type',
    'source',
    'ai_enhanced'
  ]),
  exercise_recommendation_shown: new Set([
    'recommendation_key',
    'exercise_category',
    'is_none_today',
    'effort_level',
    'source'
  ]),
  exercise_recommendation_selected: new Set([
    'recommendation_key',
    'exercise_category',
    'is_none_today',
    'source'
  ]),
  exercise_goal_completed: new Set([
    'recommendation_key',
    'exercise_category',
    'source'
  ])
};

export class ProductEventValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductEventValidationError';
  }
}

function normalizeKey(value, field, maxLength = 160) {
  const normalized = String(value ?? '').trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    !/^[A-Za-z0-9:_-]+$/.test(normalized)
  ) {
    throw new ProductEventValidationError(`Valid ${field} is required`);
  }
  return normalized;
}

function normalizeDimensionValue(value, key) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.length > 0 && normalized.length <= 80) return normalized;
  }
  throw new ProductEventValidationError(`Valid ${key} dimension is required`);
}

export function normalizeProductEvent(input, { clientOnly = false } = {}) {
  const eventName = String(input?.eventName ?? '').trim();
  const allowedNames = clientOnly ? CLIENT_PRODUCT_EVENT_NAMES : PRODUCT_EVENT_NAMES;
  if (!allowedNames.has(eventName)) {
    throw new ProductEventValidationError('Valid event_name is required');
  }

  const rawDimensions = input?.dimensions ?? {};
  if (
    !rawDimensions ||
    typeof rawDimensions !== 'object' ||
    Array.isArray(rawDimensions)
  ) {
    throw new ProductEventValidationError('Valid dimensions object is required');
  }

  const allowedDimensionKeys = DIMENSION_KEYS[eventName];
  const dimensions = {};
  for (const [key, value] of Object.entries(rawDimensions)) {
    if (!allowedDimensionKeys.has(key)) {
      throw new ProductEventValidationError(`Unsupported product event dimension: ${key}`);
    }
    dimensions[key] = normalizeDimensionValue(value, key);
  }

  return {
    eventName,
    eventKey: normalizeKey(input?.eventKey, 'event_key'),
    correlationKey: input?.correlationKey == null
      ? null
      : normalizeKey(input.correlationKey, 'correlation_key'),
    dimensions
  };
}

export async function recordProductEvent(
  client,
  userId,
  input,
  { clientOnly = false } = {}
) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new ProductEventValidationError('Valid user_id is required');
  }
  const event = normalizeProductEvent(input, { clientOnly });
  const result = await client.query(
    `INSERT INTO wellness_product_events (
       user_id, event_name, event_key, correlation_key, dimensions
     )
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (user_id, event_name, event_key)
     DO UPDATE SET event_key = EXCLUDED.event_key
     RETURNING event_id, event_name, event_key, occurred_at`,
    [
      normalizedUserId,
      event.eventName,
      event.eventKey,
      event.correlationKey,
      JSON.stringify(event.dimensions)
    ]
  );
  return result.rows[0];
}

export async function recordProductEventSafely(client, userId, input) {
  try {
    return await recordProductEvent(client, userId, input);
  } catch (error) {
    console.error('Product event recording error:', error?.message ?? error);
    return null;
  }
}
