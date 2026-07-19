import express from 'express';

import {
  enforceAuthenticatedUser,
  requireAuth
} from '../middleware/auth.middleware.js';
import { rateLimiters } from '../middleware/rateLimit.middleware.js';
import {
  deleteAccount,
  login,
  signup,
  updateProfile
} from '../controllers/auth.controller.js';

const router = express.Router();

router.post('/signup', rateLimiters.authBurst, rateLimiters.signup, signup);
router.post('/login', rateLimiters.authBurst, rateLimiters.loginFailure, login);
router.put(
  '/profile',
  requireAuth,
  rateLimiters.general,
  enforceAuthenticatedUser,
  updateProfile
);
router.delete(
  '/account',
  requireAuth,
  rateLimiters.general,
  enforceAuthenticatedUser,
  deleteAccount
);

export default router;
