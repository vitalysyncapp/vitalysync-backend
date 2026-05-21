import express from 'express';

import {
  createNotificationEvent,
  createNudgeEvent,
  getNudgeRecommendations,
  getReminderPreferences,
  listInsightReports,
  listNotificationEvents,
  listNudgeEvents,
  refreshInsightReports,
  saveReminderPreferences,
  updateNotificationEventStatus,
  updateNudgeEventStatus
} from '../controllers/adaptive.controller.js';

const router = express.Router();

router.get('/reminders', getReminderPreferences);
router.put('/reminders', saveReminderPreferences);

router.get('/nudges/recommendations', getNudgeRecommendations);

router.get('/insight-reports', listInsightReports);
router.post('/insight-reports/refresh', refreshInsightReports);

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
