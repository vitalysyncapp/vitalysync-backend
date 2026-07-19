import express from 'express';

import { requireMatchingParamUser } from '../middleware/auth.middleware.js';
import {
  createOnboarding,
  createPreferences,
  getRequiredOnboardingStatus,
  getOnboardingSummary,
  submitOnboarding,
  updateBurnoutBaseline,
  updateWellnessProfile,
  updateOnboarding,
  updatePreferences
} from '../controllers/onboarding.controller.js';

const router = express.Router();

router.get('/status', getRequiredOnboardingStatus);
router.get('/status/:userId', requireMatchingParamUser(), getRequiredOnboardingStatus);
router.get('/', getOnboardingSummary);
router.post('/submit', submitOnboarding);
router.get('/:userId', requireMatchingParamUser(), getOnboardingSummary);
router.put('/burnout-baseline', updateBurnoutBaseline);
router.put('/:userId/burnout-baseline', requireMatchingParamUser(), updateBurnoutBaseline);
router.put('/wellness-profile', updateWellnessProfile);
router.put('/:userId/wellness-profile', requireMatchingParamUser(), updateWellnessProfile);
router.post('/', createOnboarding);
router.put('/', updateOnboarding);
router.post('/preferences', createPreferences);
router.put('/preferences', updatePreferences);
router.put('/:userId', requireMatchingParamUser(), updateOnboarding);
router.put('/:userId/preferences', requireMatchingParamUser(), updatePreferences);

export default router;
