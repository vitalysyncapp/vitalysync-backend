import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';
import {
  getCheckInStatus,
  submitCheckIn
} from '../services/checkIn.service.js';

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
    const result = await getCheckInStatus({
      userId: getAuthenticatedUserId(req) ?? req.query?.user_id,
      logDate: req.query?.date ?? req.query?.log_date
    });
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to fetch check-in status');
  }
}

export async function saveUnifiedCheckIn(req, res) {
  try {
    const result = await submitCheckIn({
      userId: getAuthenticatedUserId(req) ?? req.body?.user_id,
      payload: req.body,
      idempotencyKey: req.headers?.['idempotency-key']
    });
    return res.status(result.is_redo ? 200 : 201).json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to save check-in');
  }
}
