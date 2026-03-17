// routes/auth.js
import express from 'express';
import authController from '../controllers/authController.js'; // default import

const router = express.Router();

// use the controller router
router.use('/', authController);

export default router;