import { getAuthenticatedUserId } from '../middleware/auth.middleware.js';
import { getWeeklyAssessmentStatus, submitWeeklyAssessment } from '../services/weeklyAssessment.service.js';
import pool from '../config/db.js';
import { recordProductEventSafely } from '../services/productEventService.js';

export async function getWeeklyAssessment(req, res) {
  try {
    const userId = getAuthenticatedUserId(req);
    const result = await getWeeklyAssessmentStatus({ userId, logDate: req.query?.date });
    if (result.is_due) {
      await recordProductEventSafely(pool, userId, {
        eventName: 'weekly_pulse_prompted', eventKey: req.query.date,
        dimensions: { check_in_type: 'weekly', overdue: result.is_overdue }
      });
    }
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode ?? 500).json({
      message: error.statusCode ? error.message : 'Unable to load weekly logs'
    });
  }
}

export async function saveWeeklyAssessment(req, res) {
  try {
    const userId = getAuthenticatedUserId(req);
    const result = await submitWeeklyAssessment({ userId, payload: req.body });
    // Keep existing participation analytics compatible with the new weekly form.
    await recordProductEventSafely(pool, userId, {
      eventName: 'weekly_pulse_completed', eventKey: req.body.response_date,
      dimensions: { check_in_type: 'weekly' }
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode ?? 500).json({
      message: error.statusCode ? error.message : 'Unable to save weekly log'
    });
  }
}
