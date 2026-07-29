import express from 'express';

import { requireMatchingParamUser } from '../middleware/auth.middleware.js';
import {
  getUserSettingsHandler,
  updateUserSettingsHandler,
} from '../controllers/userSettings.controller.js';

const router = express.Router();

router.get('/:userId', requireMatchingParamUser(), getUserSettingsHandler);
router.put('/:userId', requireMatchingParamUser(), updateUserSettingsHandler);

export default router;
