import express from 'express';

import {
  enforceAuthenticatedUser,
  requireAuth
} from '../middleware/auth.middleware.js';
import {
  deleteAccount,
  login,
  signup,
  updateProfile
} from '../controllers/auth.controller.js';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.put('/profile', requireAuth, enforceAuthenticatedUser, updateProfile);
router.delete('/account', requireAuth, enforceAuthenticatedUser, deleteAccount);

export default router;
