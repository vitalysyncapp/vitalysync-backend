import express from 'express';
import { getWeeklyAssessment, saveWeeklyAssessment } from '../controllers/weeklyAssessment.controller.js';

import {
  getUnifiedCheckInStatus,
  saveUnifiedCheckIn
} from '../controllers/checkIn.controller.js';
import {
  createCheckInPresetHandler,
  deleteCheckInPresetHandler,
  getCheckInPresets,
  updateCheckInPresetHandler,
} from '../controllers/checkInPreset.controller.js';

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

router.get('/check-in-presets', getCheckInPresets);
router.post('/check-in-presets', createCheckInPresetHandler);
router.put('/check-in-presets/:presetId', updateCheckInPresetHandler);
router.delete('/check-in-presets/:presetId', deleteCheckInPresetHandler);

router.get('/weekly-assessment', getWeeklyAssessment);
router.post('/weekly-assessment', saveWeeklyAssessment);

router.get('/check-in/status', getUnifiedCheckInStatus);
router.post('/check-in', saveUnifiedCheckIn);
router.get('/today', getTodayLog);
router.get('/latest', getLatestLog);
router.get('/streak', getCurrentStreak);
router.get('/history', getLogHistory);
router.get('/weekly-pulse/status', getWeeklyPulseStatus);
router.post('/weekly-pulse', saveWeeklyPulse);
router.post('/', saveDailyLog);

export default router;
