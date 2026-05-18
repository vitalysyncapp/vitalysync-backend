import express from 'express';

import { requireMatchingParamUser } from '../middleware/auth.middleware.js';
import { getProfile } from '../controllers/profile.controller.js';

const router = express.Router();

router.get('/:userId', requireMatchingParamUser(), getProfile);

export default router;
