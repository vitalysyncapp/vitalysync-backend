import crypto from 'node:crypto';
import { eventMetadata } from './wellnessContentService.js';

function snapshot(row) {
  const metadata = eventMetadata(row);
  return { ...metadata.content_snapshot, nudge_event_id: row.nudge_event_id,
    title: metadata.title, message: row.message, metadata };
}

// Reopening either Flutter engine must reuse the finalized copy, even when
// newer logs have changed the context used to select the next nudge.
export function currentSmartNudge(events, { locale = 'en', now = new Date() } = {}) {
  const latest = events.filter((row) => {
    const metadata = eventMetadata(row);
    return metadata.surface === 'wellness' && (metadata.locale ?? 'en') === locale &&
      metadata.delivery && metadata.content_snapshot;
  }).sort((a, b) => new Date(eventMetadata(b).selected_at ?? b.created_at) -
    new Date(eventMetadata(a).selected_at ?? a.created_at) || b.nudge_event_id - a.nudge_event_id)[0];
  if (!latest) return null;
  const metadata = eventMetadata(latest);
  const hours = Math.min(48, Math.max(1, Number(metadata.nudge_cooldown_hours) || 8));
  const due = metadata.next_due_at ?? new Date(new Date(latest.created_at).getTime() + hours * 3600000).toISOString();
  if (new Date(due).getTime() <= now.getTime() || !Number.isFinite(Date.parse(due))) return null;
  return { ...snapshot(latest), metadata: { ...metadata, next_due_at: due } };
}

export function deliveryClaimable(metadata, now = new Date()) {
  const delivery = metadata.delivery;
  if (!delivery || metadata.completed_at || metadata.skipped_at || metadata.snoozed_until ||
      ['sent', 'scheduled', 'suppressed', 'cancelled'].includes(delivery.state)) return false;
  return delivery.state !== 'claimed' || new Date(delivery.lease_until).getTime() <= now.getTime();
}

async function cancelReplacedDeliveries(client, userId, contentId) {
  // Also invalidate another engine's outstanding delivery lease.
  const result = await client.query(`UPDATE nudge_events SET metadata =
    jsonb_set(metadata, '{delivery}', (metadata->'delivery') ||
      '{"state":"cancelled","reason":"replaced"}'::jsonb), updated_at = NOW()
    WHERE user_id = $1 AND metadata->>'content_id' <> $2
      AND metadata->'delivery'->>'state' IN ('pending', 'claimed', 'scheduled')
    RETURNING metadata->>'content_id' AS content_id`, [userId, contentId]);
  return result.rows.map((row) => row.content_id);
}

// Finalizing is distinct from viewport exposure. The lock also makes the
// notification allowance and identity shared by the app and overlay engines.
export async function finalizeSmartNudge(pool, userId, recommendation, { trigger = 'context_update', now = new Date() } = {}) {
  const contentId = recommendation?.metadata?.content_id;
  if (!contentId) return recommendation;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [userId]);
    const recent = await client.query(`SELECT * FROM nudge_events WHERE user_id = $1
      AND created_at > NOW() - INTERVAL '48 hours' AND COALESCE(metadata->>'surface', 'wellness') = 'wellness'`, [userId]);
    if (trigger === 'context_update') {
      const current = currentSmartNudge(recent.rows, { locale: recommendation.metadata.locale, now });
      if (current) {
        await client.query('COMMIT');
        return current;
      }
    }
    const existing = await client.query(`SELECT * FROM nudge_events WHERE user_id = $1
      AND metadata->>'content_id' = $2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [userId, contentId]);
    const previous = existing.rows[0];
    if (eventMetadata(previous).delivery) {
      // Revisiting an earlier idea makes it the latest choice again without
      // resending its notification or losing its feedback history.
      if (['another_idea', 'revisit'].includes(trigger)) {
        const metadata = eventMetadata(previous);
        const hours = Math.min(48, Math.max(1, Number(metadata.nudge_cooldown_hours) || 8));
        metadata.selected_at = now.toISOString();
        metadata.next_due_at = new Date(now.getTime() + hours * 3600000).toISOString();
        metadata.delivery = { ...metadata.delivery,
          cancelled_content_ids: await cancelReplacedDeliveries(client, userId, contentId) };
        const updated = await client.query(`UPDATE nudge_events SET metadata = $3, updated_at = NOW()
          WHERE user_id = $1 AND nudge_event_id = $2 RETURNING *`, [userId, previous.nudge_event_id, JSON.stringify(metadata)]);
        await client.query('COMMIT');
        return snapshot(updated.rows[0]);
      }
      await client.query('COMMIT');
      return snapshot(previous);
    }
    const metadata = { ...recommendation.metadata, ...eventMetadata(previous) };
    const active = recent.rows.filter((row) => row.nudge_event_id !== previous?.nudge_event_id &&
      now - new Date(row.created_at) < 24 * 3600000 &&
      (eventMetadata(row).generated_only !== true || ['pending', 'claimed', 'scheduled', 'sent'].includes(eventMetadata(row).delivery?.state)));
    const strong = ['high', 'urgent'].includes(recommendation.priority);
    const limit = Number(metadata.max_daily_nudges) || 3;
    const cooldown = Number(metadata.nudge_cooldown_hours) || 8;
    const inCooldown = active.some((row) => row.nudge_type === recommendation.nudge_type &&
      now - new Date(row.created_at) < cooldown * 3600000);
    const throttled = !strong && (metadata.throttled === true || active.length >= limit || inCooldown);
    const scheduledFor = metadata.scheduled_for ?? now.toISOString();
    const cancelled = await cancelReplacedDeliveries(client, userId, contentId);
    metadata.content_snapshot = { ...recommendation, metadata: { ...recommendation.metadata } };
    metadata.title = recommendation.title;
    metadata.selected_at = now.toISOString();
    metadata.next_due_at = new Date(now.getTime() + Math.min(48, Math.max(1, cooldown)) * 3600000).toISOString();
    metadata.generated_only = !metadata.displayed_at;
    metadata.delivery = { key: contentId, trigger, scheduled_for: scheduledFor,
      cancelled_content_ids: cancelled,
      state: throttled ? 'suppressed' : 'pending', reason: throttled ? 'shared_nudge_limit' : null };
    const result = previous
      ? await client.query(`UPDATE nudge_events SET metadata = $3, updated_at = NOW()
          WHERE user_id = $1 AND nudge_event_id = $2 RETURNING *`, [userId, previous.nudge_event_id, JSON.stringify(metadata)])
      : await client.query(`INSERT INTO nudge_events (user_id, nudge_type, message, action_label, trigger_reason, metadata)
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [userId, recommendation.nudge_type, recommendation.message, recommendation.action_label, recommendation.trigger_reason, JSON.stringify(metadata)]);
    await client.query('COMMIT');
    return snapshot(result.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function readSmartNudge(pool, userId, contentId) {
  const result = await pool.query(`SELECT * FROM nudge_events WHERE user_id = $1
    AND metadata->>'content_id' = $2 ORDER BY created_at DESC LIMIT 1`, [userId, contentId]);
  return result.rows[0] ? snapshot(result.rows[0]) : null;
}

export async function updateSmartNudgeDelivery(pool, userId, contentId, { operation, token, reason }, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [userId]);
    const result = await client.query(`SELECT * FROM nudge_events WHERE user_id = $1
      AND metadata->>'content_id' = $2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [userId, contentId]);
    const row = result.rows[0];
    if (!row) { await client.query('COMMIT'); return null; }
    const metadata = eventMetadata(row);
    const delivery = metadata.delivery;
    if (!delivery) { await client.query('COMMIT'); return { claimed: false }; }
    let claimed = false;
    if (operation === 'cancelled' && ['pending', 'claimed', 'scheduled', 'failed'].includes(delivery.state)) {
      delivery.state = 'cancelled';
      delivery.reason = reason ?? 'context_changed';
    } else if (operation === 'claim' && deliveryClaimable(metadata, now)) {
      claimed = true;
      delivery.state = 'claimed';
      delivery.token = crypto.randomUUID();
      delivery.lease_until = new Date(now.getTime() + 120000).toISOString();
    } else if (operation !== 'claim' && token && token === delivery.token && delivery.state === 'claimed') {
      delivery.state = operation;
      delivery.reason = reason ?? null;
      delivery.updated_at = now.toISOString();
    }
    metadata.delivery = delivery;
    await client.query(`UPDATE nudge_events SET metadata = $3, updated_at = NOW() WHERE user_id = $1 AND nudge_event_id = $2`,
      [userId, row.nudge_event_id, JSON.stringify(metadata)]);
    // A single notification record mirrors the same immutable content.
    if (claimed || operation !== 'claim') {
      const notification = await client.query(`SELECT notification_event_id FROM notification_events
        WHERE user_id = $1 AND metadata->>'content_id' = $2 ORDER BY created_at DESC LIMIT 1`, [userId, contentId]);
      const status = delivery.state === 'sent' ? 'sent' : delivery.state === 'cancelled' ? 'dismissed' : ['failed', 'suppressed'].includes(delivery.state) ? 'failed' : 'scheduled';
      const details = JSON.stringify({ content_id: contentId, delivery, nudge_event_id: row.nudge_event_id });
      if (notification.rows[0]) {
        await client.query(`UPDATE notification_events SET status = $3, metadata = $4,
          sent_at = CASE WHEN $3 = 'sent' THEN COALESCE(sent_at, NOW()) ELSE sent_at END, updated_at = NOW()
          WHERE user_id = $1 AND notification_event_id = $2`, [userId, notification.rows[0].notification_event_id, status, details]);
      } else {
        await client.query(`INSERT INTO notification_events (user_id, notification_type, title, body, scheduled_for, status, metadata)
          VALUES ($1, 'adaptive_nudge_now', $2, $3, $4, $5, $6)`, [userId, metadata.title, row.message, delivery.scheduled_for, status, details]);
      }
    }
    await client.query('COMMIT');
    return { claimed, token: claimed ? delivery.token : null, recommendation: snapshot({ ...row, metadata }) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
