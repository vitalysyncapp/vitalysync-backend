import express from 'express';

import { requireMatchingParamUser } from '../middleware/auth.middleware.js';
import {
  cancelExerciseGoal,
  chooseExerciseGoal,
  completeExerciseGoal,
  getExerciseGoalHistory,
  getTodayExerciseGoal,
  updateExerciseGoalProgress,
} from '../controllers/exerciseGoal.controller.js';

const router = express.Router();

router.get(
  '/history/:userId',
  requireMatchingParamUser(),
  getExerciseGoalHistory
);
router.get('/today/:userId', requireMatchingParamUser(), getTodayExerciseGoal);
router.post('/choose', chooseExerciseGoal);
router.put('/progress', updateExerciseGoalProgress);
router.put('/complete', completeExerciseGoal);
router.put('/cancel', cancelExerciseGoal);

export default router;
