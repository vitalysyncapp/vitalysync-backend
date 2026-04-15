import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.routes.js';
import logRoutes from './routes/log.routes.js';
import onboardingRoutes from './routes/onboarding.routes.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/onboarding', onboardingRoutes);

export default app;
