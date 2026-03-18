import express from 'express';
import authRouter from '../controllers/authController.js';

const app = express();

// Use the router
app.use('/api', authRouter);

export default app;