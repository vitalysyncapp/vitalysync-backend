import express from 'express';

import {
  getActivityHistory,
  getTodayActivity,
  saveActivityLog,
  updateActivityLog,
} from '../controllers/activity.controller.js';

const router = express.Router();

router.get('/history/:userId', getActivityHistory);
router.get('/today/:userId', getTodayActivity);
router.post('/save', saveActivityLog);
router.put('/update', updateActivityLog);

export default router;
