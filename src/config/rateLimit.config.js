import dotenv from 'dotenv';

dotenv.config();

const MINUTE_MS = 60 * 1000;

function readPositiveInteger(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue == null || String(rawValue).trim() === '') {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readNonNegativeInteger(name, fallback) {
  const rawValue = process.env[name];

  if (rawValue == null || String(rawValue).trim() === '') {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return parsed;
}

function createPolicy(name, fallback, windowMinutes) {
  return Object.freeze({
    limit: readPositiveInteger(name, fallback),
    windowMs: windowMinutes * MINUTE_MS,
  });
}

export const rateLimitConfig = Object.freeze({
  trustProxyHops: readNonNegativeInteger('TRUST_PROXY_HOPS', 1),
  perimeter: createPolicy('RATE_LIMIT_PERIMETER_MAX', 1000, 15),
  general: createPolicy('RATE_LIMIT_API_MAX', 300, 15),
  authBurst: createPolicy('RATE_LIMIT_AUTH_MAX', 30, 15),
  loginFailure: createPolicy('RATE_LIMIT_LOGIN_FAILURE_MAX', 5, 15),
  signup: createPolicy('RATE_LIMIT_SIGNUP_MAX', 5, 60),
  emailVerification: createPolicy('RATE_LIMIT_EMAIL_VERIFICATION_MAX', 5, 60),
  passwordReset: createPolicy('RATE_LIMIT_PASSWORD_RESET_MAX', 5, 60),
  passwordChange: createPolicy('RATE_LIMIT_PASSWORD_CHANGE_MAX', 5, 15),
  accountAction: createPolicy('RATE_LIMIT_ACCOUNT_ACTION_MAX', 5, 15),
  nutritionAnalysis: createPolicy(
    'RATE_LIMIT_NUTRITION_ANALYZE_MAX',
    10,
    60
  ),
  aiNudge: createPolicy('RATE_LIMIT_AI_NUDGE_MAX', 20, 60),
  reportRefresh: createPolicy('RATE_LIMIT_REPORT_REFRESH_MAX', 10, 60),
  reportExport: createPolicy('RATE_LIMIT_REPORT_EXPORT_MAX', 5, 24 * 60),
});
