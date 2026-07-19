import express from 'express';

import { requireMatchingParamUser } from '../middleware/auth.middleware.js';
import {
  getActivityHistory,
  getTodayActivity,
  saveActivityLog,
  updateActivityLog,
} from '../controllers/activity.controller.js';

const router = express.Router();

router.get('/history', getActivityHistory);
router.get('/history/:userId', requireMatchingParamUser(), getActivityHistory);
router.get('/today', getTodayActivity);
router.get('/today/:userId', requireMatchingParamUser(), getTodayActivity);
router.post('/save', saveActivityLog);
router.put('/update', updateActivityLog);

export default router;
