import express from 'express';

import { requireMatchingParamUser } from '../middleware/auth.middleware.js';
import {
  getStreakLeaderboard,
  getStreakOverview,
} from '../controllers/streak.controller.js';

const router = express.Router();

router.get('/:userId', requireMatchingParamUser(), getStreakOverview);
router.get('/:userId/leaderboard', requireMatchingParamUser(), getStreakLeaderboard);

export default router;
