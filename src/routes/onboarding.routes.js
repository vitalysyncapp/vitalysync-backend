import express from 'express';

import { requireMatchingParamUser } from '../middleware/auth.middleware.js';
import {
  createOnboarding,
  createPreferences,
  getRequiredOnboardingStatus,
  getOnboardingSummary,
  submitOnboarding,
  updateWellnessProfile,
  updateOnboarding,
  updatePreferences
} from '../controllers/onboarding.controller.js';

const router = express.Router();

router.get('/status/:userId', requireMatchingParamUser(), getRequiredOnboardingStatus);
router.post('/submit', submitOnboarding);
router.get('/:userId', requireMatchingParamUser(), getOnboardingSummary);
router.put('/:userId/wellness-profile', requireMatchingParamUser(), updateWellnessProfile);
router.post('/', createOnboarding);
router.put('/:userId', requireMatchingParamUser(), updateOnboarding);
router.post('/preferences', createPreferences);
router.put('/:userId/preferences', requireMatchingParamUser(), updatePreferences);

export default router;
