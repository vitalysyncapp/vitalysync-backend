import crypto from 'node:crypto';

export const CONTENT_VERSION = 'companion_v2';
export const CONTENT_INTERACTIONS = new Set(['shown', 'done', 'another_idea', 'not_now', 'like', 'dislike']);
const HOUR = 3600000;

export function contentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

export function eventMetadata(event) {
  try {
    const value = typeof event?.metadata === 'string' ? JSON.parse(event.metadata) : event?.metadata;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function recent(value, hours, now) {
  const age = now.getTime() - new Date(value).getTime();
  return Number.isFinite(age) && age >= 0 && age < hours * HOUR;
}

export function actionUnavailable(candidate, events, now = new Date(), { selectionMode = 'default', cooldownHours = 8, excludeActionIds = [] } = {}) {
  const action = candidate.metadata?.action_id;
  if (excludeActionIds.includes(action)) return true;
  return events.some((event) => {
    const metadata = eventMetadata(event);
    if (!action || metadata.action_id !== action) return false;
    if (metadata.surface && metadata.surface !== candidate.metadata?.surface) return false;
    const sameContext = metadata.context_hash === candidate.metadata?.context_hash;
    return recent(metadata.completed_at, 24, now) ||
      (selectionMode !== 'revisit' && sameContext && recent(metadata.skipped_at, cooldownHours, now)) ||
      (new Date(metadata.snoozed_until).getTime() > now.getTime());
  });
}

export function parseSelectionOptions(query = {}) {
  const selectionMode = query.selection_mode ?? 'default';
  if (!['default', 'next', 'revisit'].includes(selectionMode)) return null;
  const raw = query.exclude_action_ids ?? '';
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  const excludeActionIds = [...new Set(raw.split(',').filter(Boolean))];
  if (excludeActionIds.length > 40 || excludeActionIds.some((id) => !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) return null;
  return { selectionMode, excludeActionIds };
}

export function contentSelectionState(candidates, events, selected, options = {}) {
  const now = options.now ?? new Date();
  const currentAction = options.excludeActionIds?.at(-1);
  const revisitable = candidates.some((candidate) =>
    !actionUnavailable(candidate, events, now, { ...options, selectionMode: 'revisit', excludeActionIds: currentAction ? [currentAction] : [] }) &&
    events.some((event) => {
      const metadata = eventMetadata(event);
      return metadata.action_id === candidate.metadata.action_id &&
        metadata.context_hash === candidate.metadata.context_hash && Boolean(metadata.skipped_at);
    }));
  return { status: selected ? 'available' : 'exhausted', can_revisit: revisitable };
}

export function interactionPatch(event, interaction, now = new Date()) {
  if (!CONTENT_INTERACTIONS.has(interaction)) throw new Error('Invalid content interaction');
  const metadata = { ...eventMetadata(event) };
  let status = event.status ?? 'shown';
  const at = now.toISOString();
  // Exposure retries must not erase a later response or restart its cooldown.
  if (interaction === 'shown') {
    metadata.displayed_at ??= at;
    metadata.generated_only = false;
  } else {
    metadata.last_interaction = interaction;
    metadata.interacted_at = at;
    if (interaction === 'done') { metadata.completed_at ??= at; status = 'completed'; }
    if (interaction === 'another_idea') metadata.skipped_at = at;
    if (['done', 'another_idea', 'not_now'].includes(interaction) && metadata.delivery &&
        ['pending', 'claimed', 'scheduled'].includes(metadata.delivery.state)) {
      metadata.delivery = { ...metadata.delivery, state: 'cancelled', reason: interaction };
    }
    if (interaction === 'not_now') {
      const hours = Math.min(48, Math.max(1, Number(metadata.nudge_cooldown_hours) || 8));
      metadata.snoozed_until = new Date(now.getTime() + hours * HOUR).toISOString();
      if (!metadata.completed_at) status = 'snoozed';
    }
    if (interaction === 'like' || interaction === 'dislike') {
      metadata.helpfulness = interaction;
      metadata.helpfulness_at = at;
      if (!metadata.completed_at && !metadata.snoozed_until) {
        status = interaction === 'like' ? 'accepted' : 'dismissed';
      }
    }
  }
  return { status, metadata };
}

export function buildWellnessContext(summary, personalization, preferences, locale) {
  return {
    locale, version: CONTENT_VERSION,
    baseline_epoch_id: summary.baseline_epoch_id,
    latest: summary.latest_score ? {
      date: summary.latest_score.score_date,
      score: summary.latest_score.overall_score,
      confidence: summary.latest_score.confidence_score,
      daily: summary.latest_score.source_snapshot?.daily_log,
      weekly: summary.latest_score.source_snapshot?.weekly_pulse
    } : null,
    windows: summary.windows,
    patterns: summary.patterns,
    profile: personalization?.profile ?? {},
    style: preferences?.preferredNudgeStyle ?? 'Gentle'
  };
}

export function personalEvidence(summary, profile = {}, focus = '', locale = 'en') {
  const daily = summary.latest_score?.source_snapshot?.daily_log;
  const date = summary.latest_score?.score_date;
  const fil = locale === 'fil';
  const facts = [];
  if (date && daily && /recovery|maintenance/.test(focus) && Number.isFinite(daily.sleep_hours)) {
    facts.push(fil ? `Sa check-in noong ${date}, ${daily.sleep_hours} oras ang logged sleep mo.`
      : `In your ${date} check-in, you logged ${daily.sleep_hours} hours of sleep.`);
  } else if (date && daily && Number.isFinite(daily.energy_level)) {
    facts.push(fil ? `Sa check-in noong ${date}, ${daily.energy_level}/5 ang logged energy mo.`
      : `In your ${date} check-in, you logged energy at ${daily.energy_level}/5.`);
  }
  const goal = String(profile.wellness_goal ?? '').toLowerCase();
  if (/sleep/.test(goal) && /recovery|maintenance/.test(focus)) {
    facts.push(fil ? 'Kasama sa goals mo ang mas maayos na tulog.' : 'Improving sleep is one of your goals.');
  } else if (/stress/.test(goal) && /workload|load|recovery/.test(focus)) {
    facts.push(fil ? 'Kasama sa goals mo ang pag-manage ng stress.' : 'Managing stress is one of your goals.');
  }
  return facts.join(' ');
}

export function identifyContent(candidate, { surface, context, locale = 'en', now = new Date() }) {
  const contextHash = contentHash(context);
  const metadata = candidate.metadata ?? {};
  return {
    ...candidate,
    metadata: {
      ...metadata, surface, locale, content_version: CONTENT_VERSION,
      context_hash: contextHash,
      content_id: contentHash([surface, contextHash, candidate.nudge_type, metadata.action_id, metadata.variant_id]),
      generated_at: now.toISOString(),
      title: candidate.title,
      evidence: metadata.evidence ?? candidate.trigger_reason ?? ''
    }
  };
}

// Stable across fetches; rotate only at a relevant context change or cooldown.
// Call this within one priority tier so novelty cannot outrank a stronger signal.
export function selectContent(candidates, events, { now = new Date(), cooldownHours = 8, persistent = false, selectionMode = 'default', excludeActionIds = [] } = {}) {
  if (!candidates.length) return null;
  const eligible = candidates.filter((candidate) => !actionUnavailable(candidate, events, now, { selectionMode, cooldownHours, excludeActionIds }));
  if (!eligible.length) return null;
  for (const event of selectionMode === 'default' ? events : []) {
    const metadata = eventMetadata(event);
    const candidate = eligible.find((item) => item.metadata.content_id === (metadata.candidate_id ?? metadata.content_id));
    if (!candidate || metadata.helpfulness === 'dislike' || event.status === 'dismissed') continue;
    if (persistent || recent(metadata.displayed_at ?? event.created_at, cooldownHours, now)) {
      return {
        ...candidate, title: metadata.title ?? candidate.title,
        message: event.message ?? candidate.message,
        action_label: event.action_label ?? candidate.action_label,
        nudge_event_id: event.nudge_event_id,
        metadata: { ...candidate.metadata, ...metadata, throttled: candidate.metadata.throttled,
          throttle_reason: candidate.metadata.throttle_reason, reused_content: true }
      };
    }
  }
  const score = (candidate) => {
    let penalty = 0;
    for (const event of events) {
      const metadata = eventMetadata(event);
      const at = metadata.displayed_at ?? event.created_at;
      if (recent(at, 7 * 24, now) && metadata.variant_id === candidate.metadata.variant_id) penalty += 0.5;
      if (recent(at, 48, now) && (metadata.variant_id === candidate.metadata.variant_id ||
          String(event.message).trim().toLowerCase() === candidate.message.trim().toLowerCase())) penalty += 4;
      if (recent(at, 24, now) && metadata.action_id === candidate.metadata.action_id) penalty += 2;
    }
    return penalty;
  };
  const chosen = [...eligible].sort((a, b) => score(a) - score(b))[0];
  return { ...chosen, metadata: { ...chosen.metadata,
    candidate_id: chosen.metadata.content_id,
    content_id: contentHash([chosen.metadata.content_id, Math.floor(now.getTime() / (cooldownHours * HOUR))])
  } };
}

export async function loadContentHistory(client, userId) {
  const result = await client.query(
    `SELECT nudge_event_id, nudge_type, message, action_label, status, metadata, acted_at, created_at
     FROM nudge_events WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
     ORDER BY created_at DESC LIMIT 200`, [userId]);
  return result.rows;
}

// An advisory lock supplies idempotency without a schema change. Both the app
// and Android overlay can report the same rendered card concurrently.
export async function saveContentEvent(pool, userId, body, interaction) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [userId]);
    const contentId = body.metadata?.content_id;
    const existing = await client.query(
      `SELECT * FROM nudge_events WHERE user_id = $1 AND metadata->>'content_id' = $2
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [userId, contentId]);
    const previous = existing.rows[0];
    const patched = interactionPatch(previous ?? { status: 'shown', metadata: body.metadata }, interaction);
    const result = previous
      ? await client.query(
        `UPDATE nudge_events SET status = $3, metadata = $4,
         acted_at = CASE WHEN $5 = 'shown' THEN acted_at ELSE NOW() END, updated_at = NOW()
         WHERE user_id = $1 AND nudge_event_id = $2 RETURNING *`,
        [userId, previous.nudge_event_id, patched.status, JSON.stringify(patched.metadata), interaction])
      : await client.query(
        `INSERT INTO nudge_events (user_id, nudge_type, message, action_label, trigger_reason, status, metadata, acted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 = 'shown' THEN NULL ELSE NOW() END) RETURNING *`,
        [userId, body.nudge_type, body.message, body.action_label, body.trigger_reason,
          patched.status, JSON.stringify(patched.metadata), interaction]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
