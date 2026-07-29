import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import {
  enforceAuthenticatedUser,
  optionalAuth,
  requireAuth
} from './middleware/auth.middleware.js';
import { attachRequestContext } from './middleware/requestContext.middleware.js';
import { createCorsOptions } from './config/cors.config.js';
import { rateLimitConfig } from './config/rateLimit.config.js';
import { rateLimiters } from './middleware/rateLimit.middleware.js';
import { logApiError } from './utils/errorLogging.js';
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
import reportRoutes from './routes/report.routes.js';
import userSettingsRoutes from './routes/userSettings.routes.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', rateLimitConfig.trustProxyHops);

app.use(attachRequestContext);
app.use(helmet());
app.use(cors(createCorsOptions()));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'vitalysync-backend',
    timestamp: new Date().toISOString()
  });
});
app.use('/api', rateLimiters.perimeter);

app.use('/api/auth', authRoutes);
app.use(
  '/api/environment',
  optionalAuth,
  rateLimiters.general,
  enforceAuthenticatedUser,
  environmentRoutes
);

app.use('/api', requireAuth, rateLimiters.general, enforceAuthenticatedUser);

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
app.use('/api/reports', reportRoutes);
app.use('/api/settings', userSettingsRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((error, req, res, _next) => {
  const clientErrorStatus = Number(error?.status ?? error?.statusCode);
  if (Number.isInteger(clientErrorStatus) && clientErrorStatus >= 400 && clientErrorStatus < 500) {
    return res.status(clientErrorStatus).json({
      message: clientErrorStatus === 413
        ? 'Request body is too large'
        : 'Invalid request',
    });
  }

  logApiError(req, 'Unhandled API error', error);

  return res.status(500).json({
    message: 'Unexpected server error',
  });
});

export default app;
