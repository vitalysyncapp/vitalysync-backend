import express from 'express';
import authRouter from '../controllers/authController.js';

const router = express.Router();

// mount controller routes
router.use('/', authRouter);

export default router;