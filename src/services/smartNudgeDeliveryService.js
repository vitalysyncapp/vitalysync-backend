import crypto from 'node:crypto';
import { eventMetadata } from './wellnessContentService.js';

function snapshot(row) {
  const metadata = eventMetadata(row);
  return { ...metadata.content_snapshot, nudge_event_id: row.nudge_event_id,
    title: metadata.title, message: row.message, metadata };
}

export function deliveryClaimable(metadata, now = new Date()) {
  const delivery = metadata.delivery;
  if (!delivery || metadata.completed_at || metadata.skipped_at || metadata.snoozed_until ||
      ['sent', 'scheduled', 'suppressed', 'cancelled'].includes(delivery.state)) return false;
  return delivery.state !== 'claimed' || new Date(delivery.lease_until).getTime() <= now.getTime();
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
    const existing = await client.query(`SELECT * FROM nudge_events WHERE user_id = $1
      AND metadata->>'content_id' = $2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [userId, contentId]);
    const previous = existing.rows[0];
    if (eventMetadata(previous).delivery) {
      await client.query('COMMIT');
      return snapshot(previous);
    }
    const recent = await client.query(`SELECT * FROM nudge_events WHERE user_id = $1
      AND created_at > NOW() - INTERVAL '24 hours' AND COALESCE(metadata->>'surface', 'wellness') = 'wellness'`, [userId]);
    const metadata = { ...recommendation.metadata, ...eventMetadata(previous) };
    const active = recent.rows.filter((row) => row.nudge_event_id !== previous?.nudge_event_id &&
      (eventMetadata(row).generated_only !== true || ['pending', 'claimed', 'scheduled', 'sent'].includes(eventMetadata(row).delivery?.state)));
    const strong = ['high', 'urgent'].includes(recommendation.priority);
    const limit = Number(metadata.max_daily_nudges) || 3;
    const cooldown = Number(metadata.nudge_cooldown_hours) || 8;
    const inCooldown = active.some((row) => row.nudge_type === recommendation.nudge_type &&
      now - new Date(row.created_at) < cooldown * 3600000);
    const throttled = !strong && (metadata.throttled === true || active.length >= limit || inCooldown);
    const scheduledFor = metadata.scheduled_for ?? now.toISOString();
    // A replacement invalidates outstanding deliveries, including another engine's lease.
    const cancelled = await client.query(`UPDATE nudge_events SET metadata =
      jsonb_set(metadata, '{delivery}', (metadata->'delivery') ||
        '{"state":"cancelled","reason":"replaced"}'::jsonb), updated_at = NOW()
      WHERE user_id = $1 AND metadata->>'content_id' <> $2
        AND metadata->'delivery'->>'state' IN ('pending', 'claimed', 'scheduled')
      RETURNING metadata->>'content_id' AS content_id`, [userId, contentId]);
    metadata.content_snapshot = { ...recommendation, metadata: { ...recommendation.metadata } };
    metadata.title = recommendation.title;
    metadata.generated_only = !metadata.displayed_at;
    metadata.delivery = { key: contentId, trigger, scheduled_for: scheduledFor,
      cancelled_content_ids: cancelled.rows.map((row) => row.content_id),
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
