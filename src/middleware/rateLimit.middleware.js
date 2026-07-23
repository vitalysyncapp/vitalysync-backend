import crypto from 'crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

import { rateLimitConfig } from '../config/rateLimit.config.js';

function clientIpKey(req) {
  return `ip:${ipKeyGenerator(req.ip)}`;
}

function authenticatedUserKey(req) {
  const userId = Number(req.auth?.sub);
  return Number.isInteger(userId) && userId > 0
    ? `user:${userId}`
    : clientIpKey(req);
}

function loginIdentityKey(req) {
  const normalizedEmail = String(req.body?.email ?? '')
    .trim()
    .toLowerCase();
  const emailDigest = crypto
    .createHash('sha256')
    .update(normalizedEmail || '<missing-email>')
    .digest('hex');

  return `${clientIpKey(req)}:email:${emailDigest}`;
}

function parseBoolean(value, fallback) {
  if (value == null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return undefined;
}

function shouldSkipAiNudge(req) {
  const baseUrl = String(req.baseUrl ?? '');
  const isAdaptiveNudge = baseUrl.endsWith('/adaptive');
  const aiEnabled = parseBoolean(req.query?.ai, !isAdaptiveNudge);

  return aiEnabled !== true;
}

function retryAfterSeconds(req, windowMs) {
  const resetAt = req.rateLimit?.resetTime?.getTime?.();
  const remainingMs = Number.isFinite(resetAt)
    ? Math.max(0, resetAt - Date.now())
    : windowMs;

  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function formatWaitTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
  }

  return parts.join(' ');
}

function createLimiter({
  identifier,
  policy,
  keyGenerator,
  skip,
  skipSuccessfulRequests = false,
}) {
  return rateLimit({
    windowMs: policy.windowMs,
    limit: policy.limit,
    identifier,
    keyGenerator,
    skip: (req, res) =>
      req.method === 'OPTIONS' || (skip ? skip(req, res) : false),
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      const retrySeconds = retryAfterSeconds(req, policy.windowMs);
      const waitTime = formatWaitTime(retrySeconds);
      res.set('Retry-After', String(retrySeconds));
      return res.status(429).json({
        message: `Too many requests. Please wait ${waitTime} before trying again.`,
        retry_after_seconds: retrySeconds,
      });
    },
  });
}

export function createRateLimiters(config = rateLimitConfig) {
  return Object.freeze({
    perimeter: createLimiter({
      identifier: 'perimeter',
      policy: config.perimeter,
      keyGenerator: clientIpKey,
      skip: (req) => req.path === '/health',
    }),
    general: createLimiter({
      identifier: 'api',
      policy: config.general,
      keyGenerator: authenticatedUserKey,
    }),
    authBurst: createLimiter({
      identifier: 'auth',
      policy: config.authBurst,
      keyGenerator: clientIpKey,
    }),
    loginFailure: createLimiter({
      identifier: 'login-failure',
      policy: config.loginFailure,
      keyGenerator: loginIdentityKey,
      skipSuccessfulRequests: true,
    }),
    signup: createLimiter({
      identifier: 'signup',
      policy: config.signup,
      keyGenerator: clientIpKey,
    }),
    emailVerification: createLimiter({
      identifier: 'email-verification',
      policy: config.emailVerification,
      keyGenerator: loginIdentityKey,
    }),
    passwordReset: createLimiter({
      identifier: 'password-reset',
      policy: config.passwordReset,
      keyGenerator: loginIdentityKey,
    }),
    nutritionAnalysis: createLimiter({
      identifier: 'nutrition-analysis',
      policy: config.nutritionAnalysis,
      keyGenerator: authenticatedUserKey,
    }),
    aiNudge: createLimiter({
      identifier: 'ai-nudge',
      policy: config.aiNudge,
      keyGenerator: authenticatedUserKey,
      skip: shouldSkipAiNudge,
    }),
    reportRefresh: createLimiter({
      identifier: 'report-refresh',
      policy: config.reportRefresh,
      keyGenerator: authenticatedUserKey,
    }),
  });
}

export const rateLimiters = createRateLimiters();
