import express from 'express';

import { rateLimiters } from '../middleware/rateLimit.middleware.js';

import {
  getSavedSmartNudge,
  respondToSmartNudgeDelivery,
  createNotificationEvent,
  createNudgeEvent,
  getNudgeRecommendations,
  getPersonalInsightForUser,
  getReminderPreferences,
  listInsightReports,
  listNotificationEvents,
  listNudgeEvents,
  refreshInsightReports,
  saveReminderPreferences,
  updateNotificationEventStatus,
  updateNudgeEventStatus
} from '../controllers/adaptive.controller.js';
import { createProductEvent } from '../controllers/productEvent.controller.js';

const router = express.Router();

router.get('/reminders', getReminderPreferences);
router.put('/reminders', saveReminderPreferences);
router.post('/product-events', createProductEvent);

router.get(
  '/nudges/recommendations',
  rateLimiters.aiNudge,
  getNudgeRecommendations
);

router.get('/insight-reports', listInsightReports);
router.get('/personal-insight', rateLimiters.aiNudge, getPersonalInsightForUser);
router.post(
  '/insight-reports/refresh',
  rateLimiters.reportRefresh,
  refreshInsightReports
);

router.get('/nudges/:contentId', getSavedSmartNudge);
router.post('/nudges/:contentId/delivery', respondToSmartNudgeDelivery);
router.get('/nudge-events', listNudgeEvents);
router.post('/nudge-events', createNudgeEvent);
router.put('/nudge-events/:eventId/status', updateNudgeEventStatus);

router.get('/notification-events', listNotificationEvents);
router.post('/notification-events', createNotificationEvent);
router.put(
  '/notification-events/:eventId/status',
  updateNotificationEventStatus
);

export default router;
