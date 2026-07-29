import pool from '../config/db.js';
import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';
import {
  ProductEventValidationError,
  recordProductEvent
} from '../services/productEventService.js';

export async function createProductEvent(req, res) {
  const userId = getAuthenticatedUserId(req) ?? Number(req.body?.user_id);
  try {
    const event = await recordProductEvent(
      pool,
      userId,
      {
        eventName: req.body?.event_name,
        eventKey: req.body?.event_key,
        correlationKey: req.body?.correlation_key,
        dimensions: req.body?.dimensions
      },
      { clientOnly: true }
    );
    return res.status(200).json({ event });
  } catch (error) {
    if (error instanceof ProductEventValidationError) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Create product event error:', error);
    return res.status(500).json({ message: 'Failed to record product event' });
  }
}
