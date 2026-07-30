import express from 'express';

import {
  clearData,
  deactivate,
  reactivate,
} from '../controllers/account.controller.js';
import {
  enforceAuthenticatedUser,
  requireAuth,
} from '../middleware/auth.middleware.js';
import { rateLimiters } from '../middleware/rateLimit.middleware.js';

const router = express.Router();

router.post(
  '/deactivate',
  requireAuth,
  rateLimiters.accountAction,
  enforceAuthenticatedUser,
  deactivate,
);
router.post(
  '/reactivate',
  rateLimiters.authBurst,
  rateLimiters.accountAction,
  reactivate,
);
router.delete(
  '/data',
  requireAuth,
  rateLimiters.accountAction,
  enforceAuthenticatedUser,
  clearData,
);

export default router;
