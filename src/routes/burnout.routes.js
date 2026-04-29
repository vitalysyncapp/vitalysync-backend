import express from 'express';

import {
  getLatestScore,
  getPatternSummary,
  getScoreHistory,
  recalculateScore
} from '../controllers/burnout.controller.js';

const router = express.Router();

router.get('/scores/latest', getLatestScore);
router.get('/scores/history', getScoreHistory);
router.post('/scores/recalculate', recalculateScore);
router.get('/patterns/summary', getPatternSummary);

export default router;
