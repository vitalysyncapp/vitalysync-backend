import pool from '../config/db.js';
import {
  getAdaptiveNudgeRecommendations
} from '../services/adaptiveNudgeService.js';

const ALLOWED_NUDGE_STATUSES = new Set([
  'shown',
  'accepted',
  'dismissed',
  'completed',
  'snoozed'
]);

const ALLOWED_NOTIFICATION_STATUSES = new Set([
  'scheduled',
  'sent',
  'dismissed',
  'failed'
]);

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseLimitedInt(value, fallback = 20, max = 50) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function parseBoundedInt(value, fallback, min, max) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return undefined;
  }

  return parsed;
}

function normalizeNullableText(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRequiredText(value) {
  return normalizeNullableText(value);
}

function normalizeTime(value) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(normalized)) {
    return undefined;
  }

  return normalized.length === 5 ? `${normalized}:00` : normalized;
}

function parseOptionalBoolean(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return undefined;
}

function parseWeekday(value) {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6
    ? parsed
    : undefined;
}

function normalizeMetadata(value) {
  if (value == null) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : undefined;
    } catch (_) {
      return undefined;
    }
  }

  return typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}

function normalizeTimestamp(value) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

async function ensureUserExists(client, userId) {
  const result = await client.query(
    'SELECT user_id FROM users WHERE user_id = $1',
    [userId]
  );

  return result.rowCount > 0;
}

function formatReminderPreferences(row) {
  return {
    user_id: row.user_id,
    daily_log_reminder_time: row.daily_log_reminder_time,
    weekly_pulse_reminder_day: row.weekly_pulse_reminder_day,
    weekly_pulse_reminder_time: row.weekly_pulse_reminder_time,
    hydration_start_time: row.hydration_start_time,
    hydration_end_time: row.hydration_end_time,
    hydration_interval_minutes: row.hydration_interval_minutes,
    sleep_wind_down_time: row.sleep_wind_down_time,
    hydration_reminder_enabled: row.hydration_reminder_enabled == true,
    recovery_reminder_enabled: row.recovery_reminder_enabled == true,
    sleep_wind_down_enabled: row.sleep_wind_down_enabled == true,
    nudge_cooldown_hours: row.nudge_cooldown_hours,
    max_daily_nudges: row.max_daily_nudges,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function formatNudgeEvent(row) {
  return {
    nudge_event_id: row.nudge_event_id,
    user_id: row.user_id,
    nudge_type: row.nudge_type,
    trigger_reason: row.trigger_reason,
    message: row.message,
    action_label: row.action_label,
    status: row.status,
    metadata: row.metadata ?? {},
    acted_at: row.acted_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function formatNotificationEvent(row) {
  return {
    notification_event_id: row.notification_event_id,
    user_id: row.user_id,
    notification_type: row.notification_type,
    title: row.title,
    body: row.body,
    scheduled_for: row.scheduled_for,
    sent_at: row.sent_at,
    status: row.status,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function getReminderPreferences(req, res) {
  const userId = parsePositiveInt(req.query.user_id);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (status === 'scheduled' && scheduledFor) {
      const existing = await pool.query(
        `SELECT
           notification_event_id,
           user_id,
           notification_type,
           title,
           body,
           scheduled_for,
           sent_at,
           status,
           metadata,
           created_at,
           updated_at
         FROM notification_events
         WHERE user_id = $1
           AND notification_type = $2
           AND scheduled_for = $3
           AND status = 'scheduled'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, notificationType, scheduledFor]
      );

      if (existing.rowCount > 0) {
        return res.status(200).json({
          message: 'Notification event already scheduled',
          event: formatNotificationEvent(existing.rows[0])
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO user_reminder_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING
         user_id,
         daily_log_reminder_time,
         weekly_pulse_reminder_day,
         weekly_pulse_reminder_time,
         hydration_start_time,
         hydration_end_time,
         hydration_interval_minutes,
         sleep_wind_down_time,
         hydration_reminder_enabled,
         recovery_reminder_enabled,
         sleep_wind_down_enabled,
         nudge_cooldown_hours,
         max_daily_nudges,
         created_at,
         updated_at`,
      [userId]
    );

    return res.status(200).json({
      preferences: formatReminderPreferences(result.rows[0])
    });
  } catch (error) {
    console.error('Get reminder preferences error:', error);
    return res.status(500).json({ message: 'Failed to fetch reminder preferences' });
  }
}

export async function saveReminderPreferences(req, res) {
  const body = req.body ?? {};
  const userId = parsePositiveInt(body.user_id);
  const dailyLogReminderTime = normalizeTime(body.daily_log_reminder_time);
  const weeklyPulseReminderDay = parseWeekday(body.weekly_pulse_reminder_day);
  const weeklyPulseReminderTime = normalizeTime(body.weekly_pulse_reminder_time);
  const hydrationStartTime = normalizeTime(body.hydration_start_time);
  const hydrationEndTime = normalizeTime(body.hydration_end_time);
  const hydrationIntervalMinutes = parseBoundedInt(
    body.hydration_interval_minutes,
    120,
    30,
    360
  );
  const sleepWindDownTime = normalizeTime(body.sleep_wind_down_time);
  const nudgeCooldownHours = parseBoundedInt(
    body.nudge_cooldown_hours,
    6,
    1,
    48
  );
  const maxDailyNudges = parseBoundedInt(body.max_daily_nudges, 3, 1, 10);
  const hydrationReminderEnabled = parseOptionalBoolean(
    body.hydration_reminder_enabled
  );
  const recoveryReminderEnabled = parseOptionalBoolean(
    body.recovery_reminder_enabled
  );
  const sleepWindDownEnabled = parseOptionalBoolean(
    body.sleep_wind_down_enabled
  );

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (dailyLogReminderTime === undefined) {
    return res.status(400).json({ message: 'Valid daily_log_reminder_time is required' });
  }

  if (weeklyPulseReminderDay === undefined) {
    return res.status(400).json({ message: 'Valid weekly_pulse_reminder_day is required' });
  }

  if (weeklyPulseReminderTime === undefined) {
    return res.status(400).json({ message: 'Valid weekly_pulse_reminder_time is required' });
  }

  if (hydrationStartTime === undefined) {
    return res.status(400).json({ message: 'Valid hydration_start_time is required' });
  }

  if (hydrationEndTime === undefined) {
    return res.status(400).json({ message: 'Valid hydration_end_time is required' });
  }

  if (hydrationIntervalMinutes === undefined) {
    return res.status(400).json({
      message: 'hydration_interval_minutes must be between 30 and 360'
    });
  }

  if (sleepWindDownTime === undefined) {
    return res.status(400).json({ message: 'Valid sleep_wind_down_time is required' });
  }

  if (nudgeCooldownHours === undefined) {
    return res.status(400).json({
      message: 'nudge_cooldown_hours must be between 1 and 48'
    });
  }

  if (maxDailyNudges === undefined) {
    return res.status(400).json({
      message: 'max_daily_nudges must be between 1 and 10'
    });
  }

  if (
    hydrationReminderEnabled === undefined ||
    recoveryReminderEnabled === undefined ||
    sleepWindDownEnabled === undefined
  ) {
    return res.status(400).json({ message: 'Reminder toggles must be valid booleans' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `INSERT INTO user_reminder_preferences (
         user_id,
         daily_log_reminder_time,
         weekly_pulse_reminder_day,
         weekly_pulse_reminder_time,
         hydration_start_time,
         hydration_end_time,
         hydration_interval_minutes,
         sleep_wind_down_time,
         hydration_reminder_enabled,
         recovery_reminder_enabled,
         sleep_wind_down_enabled,
         nudge_cooldown_hours,
         max_daily_nudges
       )
       VALUES (
         $1,
         COALESCE($2, '20:00'::time),
         COALESCE($3, 1),
         COALESCE($4, '18:00'::time),
         COALESCE($5, '07:00'::time),
         COALESCE($6, '21:00'::time),
         COALESCE($7, 120),
         COALESCE($8, '21:30'::time),
         COALESCE($9, TRUE),
         COALESCE($10, TRUE),
         COALESCE($11, TRUE),
         COALESCE($12, 6),
         COALESCE($13, 3)
       )
       ON CONFLICT (user_id)
       DO UPDATE SET
         daily_log_reminder_time = EXCLUDED.daily_log_reminder_time,
         weekly_pulse_reminder_day = EXCLUDED.weekly_pulse_reminder_day,
         weekly_pulse_reminder_time = EXCLUDED.weekly_pulse_reminder_time,
         hydration_start_time = EXCLUDED.hydration_start_time,
         hydration_end_time = EXCLUDED.hydration_end_time,
         hydration_interval_minutes = EXCLUDED.hydration_interval_minutes,
         sleep_wind_down_time = EXCLUDED.sleep_wind_down_time,
         hydration_reminder_enabled = EXCLUDED.hydration_reminder_enabled,
         recovery_reminder_enabled = EXCLUDED.recovery_reminder_enabled,
         sleep_wind_down_enabled = EXCLUDED.sleep_wind_down_enabled,
         nudge_cooldown_hours = EXCLUDED.nudge_cooldown_hours,
         max_daily_nudges = EXCLUDED.max_daily_nudges,
         updated_at = NOW()
       RETURNING
         user_id,
         daily_log_reminder_time,
         weekly_pulse_reminder_day,
         weekly_pulse_reminder_time,
         hydration_start_time,
         hydration_end_time,
         hydration_interval_minutes,
         sleep_wind_down_time,
         hydration_reminder_enabled,
         recovery_reminder_enabled,
         sleep_wind_down_enabled,
         nudge_cooldown_hours,
         max_daily_nudges,
         created_at,
         updated_at`,
      [
        userId,
        dailyLogReminderTime,
        weeklyPulseReminderDay,
        weeklyPulseReminderTime,
        hydrationStartTime,
        hydrationEndTime,
        hydrationIntervalMinutes,
        sleepWindDownTime,
        hydrationReminderEnabled,
        recoveryReminderEnabled,
        sleepWindDownEnabled,
        nudgeCooldownHours,
        maxDailyNudges
      ]
    );

    return res.status(200).json({
      message: 'Reminder preferences saved successfully',
      preferences: formatReminderPreferences(result.rows[0])
    });
  } catch (error) {
    console.error('Save reminder preferences error:', error);
    return res.status(500).json({ message: 'Failed to save reminder preferences' });
  }
}

export async function getNudgeRecommendations(req, res) {
  const userId = parsePositiveInt(req.query.user_id);
  const limit = parseLimitedInt(req.query.limit, 3, 5);
  const recordShown = req.query.record == null
    ? true
    : parseOptionalBoolean(req.query.record);
  const useAi = req.query.ai == null
    ? false
    : parseOptionalBoolean(req.query.ai);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (recordShown === undefined) {
    return res.status(400).json({ message: 'Valid record flag is required' });
  }

  if (useAi === undefined) {
    return res.status(400).json({ message: 'Valid ai flag is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await getAdaptiveNudgeRecommendations(pool, userId, {
      limit,
      recordShown,
      useAi
    });
    const primaryRecommendation = result.recommendations[0] ?? null;

    return res.status(200).json({
      recommendations: result.recommendations,
      primary_recommendation: primaryRecommendation,
      adaptive_state: result.summary.adaptive_state,
      patterns: result.summary.patterns,
      ai_enhanced: result.recommendations.some(
        (recommendation) => recommendation.metadata?.ai_enhanced === true
      ),
      generated_at: result.summary.generated_at
    });
  } catch (error) {
    console.error('Get nudge recommendations error:', error);
    return res.status(500).json({ message: 'Failed to fetch nudge recommendations' });
  }
}

export async function listNudgeEvents(req, res) {
  const userId = parsePositiveInt(req.query.user_id);
  const limit = parseLimitedInt(req.query.limit);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `SELECT
         nudge_event_id,
         user_id,
         nudge_type,
         trigger_reason,
         message,
         action_label,
         status,
         metadata,
         acted_at,
         created_at,
         updated_at
       FROM nudge_events
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return res.status(200).json({
      events: result.rows.map(formatNudgeEvent)
    });
  } catch (error) {
    console.error('List nudge events error:', error);
    return res.status(500).json({ message: 'Failed to fetch nudge events' });
  }
}

export async function createNudgeEvent(req, res) {
  const body = req.body ?? {};
  const userId = parsePositiveInt(body.user_id);
  const nudgeType = normalizeRequiredText(body.nudge_type);
  const message = normalizeRequiredText(body.message);
  const triggerReason = normalizeNullableText(body.trigger_reason);
  const actionLabel = normalizeNullableText(body.action_label);
  const status = normalizeNullableText(body.status) ?? 'shown';
  const metadata = normalizeMetadata(body.metadata);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!nudgeType) {
    return res.status(400).json({ message: 'Valid nudge_type is required' });
  }

  if (!message) {
    return res.status(400).json({ message: 'Valid message is required' });
  }

  if (!ALLOWED_NUDGE_STATUSES.has(status)) {
    return res.status(400).json({ message: 'Valid nudge status is required' });
  }

  if (metadata === undefined) {
    return res.status(400).json({ message: 'Valid metadata object is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `INSERT INTO nudge_events (
         user_id,
         nudge_type,
         trigger_reason,
         message,
         action_label,
         status,
         metadata,
         acted_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         CASE WHEN $6 = 'shown' THEN NULL ELSE NOW() END
       )
       RETURNING
         nudge_event_id,
         user_id,
         nudge_type,
         trigger_reason,
         message,
         action_label,
         status,
         metadata,
         acted_at,
         created_at,
         updated_at`,
      [
        userId,
        nudgeType,
        triggerReason,
        message,
        actionLabel,
        status,
        JSON.stringify(metadata)
      ]
    );

    return res.status(201).json({
      message: 'Nudge event saved successfully',
      event: formatNudgeEvent(result.rows[0])
    });
  } catch (error) {
    console.error('Create nudge event error:', error);
    return res.status(500).json({ message: 'Failed to save nudge event' });
  }
}

export async function updateNudgeEventStatus(req, res) {
  const eventId = parsePositiveInt(req.params.eventId);
  const userId = parsePositiveInt(req.body?.user_id);
  const status = normalizeRequiredText(req.body?.status);

  if (!eventId) {
    return res.status(400).json({ message: 'Valid nudge event id is required' });
  }

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!status || !ALLOWED_NUDGE_STATUSES.has(status)) {
    return res.status(400).json({ message: 'Valid nudge status is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE nudge_events
       SET status = $3,
           acted_at = CASE WHEN $3 = 'shown' THEN acted_at ELSE NOW() END,
           updated_at = NOW()
       WHERE nudge_event_id = $1 AND user_id = $2
       RETURNING
         nudge_event_id,
         user_id,
         nudge_type,
         trigger_reason,
         message,
         action_label,
         status,
         metadata,
         acted_at,
         created_at,
         updated_at`,
      [eventId, userId, status]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Nudge event not found' });
    }

    return res.status(200).json({
      message: 'Nudge event updated successfully',
      event: formatNudgeEvent(result.rows[0])
    });
  } catch (error) {
    console.error('Update nudge event error:', error);
    return res.status(500).json({ message: 'Failed to update nudge event' });
  }
}

export async function listNotificationEvents(req, res) {
  const userId = parsePositiveInt(req.query.user_id);
  const limit = parseLimitedInt(req.query.limit);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `SELECT
         notification_event_id,
         user_id,
         notification_type,
         title,
         body,
         scheduled_for,
         sent_at,
         status,
         metadata,
         created_at,
         updated_at
       FROM notification_events
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return res.status(200).json({
      events: result.rows.map(formatNotificationEvent)
    });
  } catch (error) {
    console.error('List notification events error:', error);
    return res.status(500).json({ message: 'Failed to fetch notification events' });
  }
}

export async function createNotificationEvent(req, res) {
  const body = req.body ?? {};
  const userId = parsePositiveInt(body.user_id);
  const notificationType = normalizeRequiredText(body.notification_type);
  const title = normalizeRequiredText(body.title);
  const notificationBody = normalizeRequiredText(body.body);
  const scheduledFor = normalizeTimestamp(body.scheduled_for);
  const sentAt = normalizeTimestamp(body.sent_at);
  const status = normalizeNullableText(body.status) ?? 'scheduled';
  const metadata = normalizeMetadata(body.metadata);

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!notificationType) {
    return res.status(400).json({ message: 'Valid notification_type is required' });
  }

  if (!title) {
    return res.status(400).json({ message: 'Valid title is required' });
  }

  if (!notificationBody) {
    return res.status(400).json({ message: 'Valid body is required' });
  }

  if (scheduledFor === undefined || sentAt === undefined) {
    return res.status(400).json({ message: 'Notification timestamps must be valid dates' });
  }

  if (!ALLOWED_NOTIFICATION_STATUSES.has(status)) {
    return res.status(400).json({ message: 'Valid notification status is required' });
  }

  if (metadata === undefined) {
    return res.status(400).json({ message: 'Valid metadata object is required' });
  }

  try {
    const userExists = await ensureUserExists(pool, userId);
    if (!userExists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const result = await pool.query(
      `INSERT INTO notification_events (
         user_id,
         notification_type,
         title,
         body,
         scheduled_for,
         sent_at,
         status,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING
         notification_event_id,
         user_id,
         notification_type,
         title,
         body,
         scheduled_for,
         sent_at,
         status,
         metadata,
         created_at,
         updated_at`,
      [
        userId,
        notificationType,
        title,
        notificationBody,
        scheduledFor,
        sentAt,
        status,
        JSON.stringify(metadata)
      ]
    );

    return res.status(201).json({
      message: 'Notification event saved successfully',
      event: formatNotificationEvent(result.rows[0])
    });
  } catch (error) {
    console.error('Create notification event error:', error);
    return res.status(500).json({ message: 'Failed to save notification event' });
  }
}

export async function updateNotificationEventStatus(req, res) {
  const eventId = parsePositiveInt(req.params.eventId);
  const userId = parsePositiveInt(req.body?.user_id);
  const status = normalizeRequiredText(req.body?.status);

  if (!eventId) {
    return res.status(400).json({ message: 'Valid notification event id is required' });
  }

  if (!userId) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!status || !ALLOWED_NOTIFICATION_STATUSES.has(status)) {
    return res.status(400).json({ message: 'Valid notification status is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE notification_events
       SET status = $3,
           sent_at = CASE WHEN $3 = 'sent' THEN COALESCE(sent_at, NOW()) ELSE sent_at END,
           updated_at = NOW()
       WHERE notification_event_id = $1 AND user_id = $2
       RETURNING
         notification_event_id,
         user_id,
         notification_type,
         title,
         body,
         scheduled_for,
         sent_at,
         status,
         metadata,
         created_at,
         updated_at`,
      [eventId, userId, status]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Notification event not found' });
    }

    return res.status(200).json({
      message: 'Notification event updated successfully',
      event: formatNotificationEvent(result.rows[0])
    });
  } catch (error) {
    console.error('Update notification event error:', error);
    return res.status(500).json({ message: 'Failed to update notification event' });
  }
}
