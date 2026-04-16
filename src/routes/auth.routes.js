import express from 'express';

import {
  deleteAccount,
  login,
  signup,
  updateProfile
} from '../controllers/auth.controller.js';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);
router.put('/profile', updateProfile);
router.delete('/account', deleteAccount);

export default router;
