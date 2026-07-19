import express from 'express';

import { requireMatchingParamUser } from '../middleware/auth.middleware.js';
import {
  getUserGoals,
  updateUserGoals,
} from '../controllers/goals.controller.js';

const router = express.Router();

router.get('/', getUserGoals);
router.put('/', updateUserGoals);
router.get('/:userId', requireMatchingParamUser(), getUserGoals);
router.put('/:userId', requireMatchingParamUser(), updateUserGoals);

export default router;
