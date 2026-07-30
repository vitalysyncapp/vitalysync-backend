import express from 'express';

import {
  enforceAuthenticatedUser,
  requireAuth
} from '../middleware/auth.middleware.js';
import { rateLimiters } from '../middleware/rateLimit.middleware.js';
import {
  changePassword,
  confirmPasswordReset,
  confirmEmailVerification,
  login,
  requestPasswordReset,
  resendEmailVerification,
  signup,
  updateProfile,
  verifyPasswordResetCode,
} from '../controllers/auth.controller.js';

const router = express.Router();

router.post('/signup', rateLimiters.authBurst, rateLimiters.signup, signup);
router.post('/login', rateLimiters.authBurst, rateLimiters.loginFailure, login);
router.post(
  '/password-reset/request',
  rateLimiters.authBurst,
  rateLimiters.passwordReset,
  requestPasswordReset
);
router.post(
  '/password-reset/verify-code',
  rateLimiters.authBurst,
  rateLimiters.passwordReset,
  verifyPasswordResetCode,
);
router.post(
  '/password-reset/confirm',
  rateLimiters.authBurst,
  rateLimiters.passwordReset,
  confirmPasswordReset
);
router.post(
  '/email-verification/resend',
  requireAuth,
  rateLimiters.authBurst,
  rateLimiters.emailVerification,
  resendEmailVerification,
);
router.post(
  '/email-verification/confirm',
  requireAuth,
  rateLimiters.authBurst,
  rateLimiters.emailVerification,
  confirmEmailVerification,
);
router.put(
  '/password',
  requireAuth,
  rateLimiters.passwordChange,
  enforceAuthenticatedUser,
  changePassword,
);
router.put(
  '/profile',
  requireAuth,
  rateLimiters.general,
  enforceAuthenticatedUser,
  updateProfile
);
export default router;
