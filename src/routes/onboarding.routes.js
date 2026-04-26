import express from 'express';

import {
  createOnboarding,
  createPreferences,
  getRequiredOnboardingStatus,
  getOnboardingSummary,
  submitOnboarding,
  updateOnboarding,
  updatePreferences
} from '../controllers/onboarding.controller.js';

const router = express.Router();

router.get('/status/:userId', getRequiredOnboardingStatus);
router.post('/submit', submitOnboarding);
router.get('/:userId', getOnboardingSummary);
router.post('/', createOnboarding);
router.put('/:userId', updateOnboarding);
router.post('/preferences', createPreferences);
router.put('/:userId/preferences', updatePreferences);

export default router;
