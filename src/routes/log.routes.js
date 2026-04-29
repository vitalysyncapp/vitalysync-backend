import express from 'express';

import {
  getCurrentStreak,
  getLogHistory,
  getLatestLog,
  getTodayLog,
  getWeeklyPulseStatus,
  saveDailyLog,
  saveWeeklyPulse
} from '../controllers/log.controller.js';

const router = express.Router();

router.get('/today', getTodayLog);
router.get('/latest', getLatestLog);
router.get('/streak', getCurrentStreak);
router.get('/history', getLogHistory);
router.get('/weekly-pulse/status', getWeeklyPulseStatus);
router.post('/weekly-pulse', saveWeeklyPulse);
router.post('/', saveDailyLog);

export default router;
