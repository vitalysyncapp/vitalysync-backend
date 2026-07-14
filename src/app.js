import express from 'express';
import cors from 'cors';

import {
  enforceAuthenticatedUser,
  optionalAuth,
  requireAuth
} from './middleware/auth.middleware.js';
import adaptiveRoutes from './routes/adaptive.routes.js';
import authRoutes from './routes/auth.routes.js';
import activityRoutes from './routes/activity.routes.js';
import burnoutRoutes from './routes/burnout.routes.js';
import environmentRoutes from './routes/environment.routes.js';
import exerciseGoalRoutes from './routes/exerciseGoal.routes.js';
import goalsRoutes from './routes/goals.routes.js';
import logRoutes from './routes/log.routes.js';
import nutritionRoutes from './routes/nutrition.routes.js';
import onboardingRoutes from './routes/onboarding.routes.js';
import profileRoutes from './routes/profile.routes.js';
import streakRoutes from './routes/streak.routes.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'vitalysync-backend',
    timestamp: new Date().toISOString()
  });
});
app.use('/api/environment', optionalAuth, enforceAuthenticatedUser, environmentRoutes);

app.use('/api', requireAuth, enforceAuthenticatedUser);

app.use('/api/adaptive', adaptiveRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/burnout', burnoutRoutes);
app.use('/api/exercise-goals', exerciseGoalRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/nutrition', nutritionRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/streaks', streakRoutes);

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
