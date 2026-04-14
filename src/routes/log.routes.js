import express from 'express';

import {
  getCurrentStreak,
  getLatestLog,
  getTodayLog,
  saveDailyLog
} from '../controllers/log.controller.js';

const router = express.Router();

router.get('/today', getTodayLog);
router.get('/latest', getLatestLog);
router.get('/streak', getCurrentStreak);
router.post('/', saveDailyLog);

export default router;
