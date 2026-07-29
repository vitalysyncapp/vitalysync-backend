import pool from '../config/db.js';
import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';
import {
  getCheckInStatus,
  submitCheckIn
} from '../services/checkIn.service.js';
import { recordProductEventSafely } from '../services/productEventService.js';

function sendError(res, error, fallbackMessage) {
  const statusCode = Number(error?.statusCode);
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({
      message: error.message,
      code: error.code,
      ...(error.details ?? {})
    });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({ message: fallbackMessage });
}

export async function getUnifiedCheckInStatus(req, res) {
  try {
    const userId = getAuthenticatedUserId(req) ?? req.query?.user_id;
    const result = await getCheckInStatus({
      userId,
      logDate: req.query?.date ?? req.query?.log_date
    });
    const eventDate = String(
      req.query?.date ?? req.query?.log_date ?? new Date().toISOString().slice(0, 10)
    ).slice(0, 10);
    if (result.requires_baseline_refresh) {
      await recordProductEventSafely(pool, userId, {
        eventName: 'baseline_refresh_prompted',
        eventKey: eventDate,
        dimensions: { reason: result.baseline_refresh_reason ?? 'thirty_day_return' }
      });
    } else {
      const mode = result.required_mode === 'weekly' ? 'weekly' : 'daily';
      await recordProductEventSafely(pool, userId, {
        eventName: mode === 'weekly'
          ? 'weekly_pulse_prompted'
          : 'daily_check_in_prompted',
        eventKey: eventDate,
        dimensions: {
          check_in_type: mode,
          overdue: result.schedule?.is_overdue === true
        }
      });
    }
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to fetch check-in status');
  }
}

export async function saveUnifiedCheckIn(req, res) {
  try {
    const userId = getAuthenticatedUserId(req) ?? req.body?.user_id;
    const result = await submitCheckIn({
      userId,
      payload: req.body,
      idempotencyKey: req.headers?.['idempotency-key']
    });
    const eventDate = String(result.log?.log_date ?? req.body?.log_date).slice(0, 10);
    const mode = result.check_in_type === 'weekly' ? 'weekly' : 'daily';
    await recordProductEventSafely(pool, userId, {
      eventName: mode === 'weekly'
        ? 'weekly_pulse_completed'
        : 'daily_check_in_completed',
      eventKey: eventDate,
      dimensions: { check_in_type: mode, redo: result.is_redo === true }
    });
    return res.status(result.is_redo ? 200 : 201).json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to save check-in');
  }
}
