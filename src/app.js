import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.routes.js';
import environmentRoutes from './routes/environment.routes.js';
import logRoutes from './routes/log.routes.js';
import nutritionRoutes from './routes/nutrition.routes.js';
import onboardingRoutes from './routes/onboarding.routes.js';
import profileRoutes from './routes/profile.routes.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/environment', environmentRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/nutrition', nutritionRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/profile', profileRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled API error:', error);
  res.status(500).json({
    message: 'Unexpected server error',
  });
});

export default app;
