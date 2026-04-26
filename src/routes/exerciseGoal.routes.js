import express from 'express';

import {
  cancelExerciseGoal,
  chooseExerciseGoal,
  completeExerciseGoal,
  getTodayExerciseGoal,
  updateExerciseGoalProgress,
} from '../controllers/exerciseGoal.controller.js';

const router = express.Router();

router.get('/today/:userId', getTodayExerciseGoal);
router.post('/choose', chooseExerciseGoal);
router.put('/progress', updateExerciseGoalProgress);
router.put('/complete', completeExerciseGoal);
router.put('/cancel', cancelExerciseGoal);

export default router;
