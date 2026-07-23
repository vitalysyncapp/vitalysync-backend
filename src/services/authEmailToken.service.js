import crypto from 'node:crypto';

import pool from '../config/db.js';

export const AUTH_EMAIL_TOKEN_TYPES = Object.freeze({
  emailVerification: 'email_verification',
  passwordReset: 'password_reset',
});

export const AUTH_EMAIL_TOKEN_MESSAGES = Object.freeze({
  invalidVerificationToken: 'Invalid or expired verification link',
});

const DEFAULT_EMAIL_VERIFICATION_TTL_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

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

export function createRawEmailToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashEmailToken(token) {
  return crypto
    .createHash('sha256')
    .update(String(token ?? '').trim())
    .digest('hex');
}

export function getEmailVerificationExpiresAt(now = new Date()) {
  const ttlHours = readPositiveInteger(
    'EMAIL_VERIFICATION_TTL_HOURS',
    DEFAULT_EMAIL_VERIFICATION_TTL_HOURS
  );

  return new Date(now.getTime() + ttlHours * HOUR_MS);
}

export async function createEmailVerificationToken({
  userId,
  email,
  db = pool,
  now = new Date(),
}) {
  const normalizedUserId = Number(userId);
  const normalizedEmail = String(email ?? '').trim().toLowerCase();

  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error('Valid user id is required for email verification');
  }

  if (!normalizedEmail) {
    throw new Error('Email is required for email verification');
  }

  const token = createRawEmailToken();
  const tokenHash = hashEmailToken(token);
  const expiresAt = getEmailVerificationExpiresAt(now);

  await db.query(
    `UPDATE auth_email_tokens
     SET consumed_at = NOW()
     WHERE user_id = $1
       AND token_type = $2
       AND consumed_at IS NULL`,
    [normalizedUserId, AUTH_EMAIL_TOKEN_TYPES.emailVerification]
  );

  await db.query(
    `INSERT INTO auth_email_tokens
       (user_id, email, token_type, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      normalizedUserId,
      normalizedEmail,
      AUTH_EMAIL_TOKEN_TYPES.emailVerification,
      tokenHash,
      expiresAt,
    ]
  );

  return { token, expiresAt };
}

export async function consumeEmailVerificationToken(token, { db = pool } = {}) {
  const normalizedToken = String(token ?? '').trim();
  if (!normalizedToken) {
    return { error: AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationToken };
  }

  const tokenResult = await db.query(
    `UPDATE auth_email_tokens
     SET consumed_at = NOW()
     WHERE token_hash = $1
       AND token_type = $2
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING user_id, email`,
    [
      hashEmailToken(normalizedToken),
      AUTH_EMAIL_TOKEN_TYPES.emailVerification,
    ]
  );

  const tokenRow = tokenResult.rows[0];
  if (!tokenRow) {
    return { error: AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationToken };
  }

  const userResult = await db.query(
    `UPDATE users
     SET email_verified = TRUE,
         email_verified_at = COALESCE(email_verified_at, NOW())
     WHERE user_id = $1
       AND LOWER(email) = $2
     RETURNING user_id, email, email_verified, email_verified_at`,
    [tokenRow.user_id, String(tokenRow.email ?? '').trim().toLowerCase()]
  );

  const user = userResult.rows[0];
  if (!user) {
    return { error: AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationToken };
  }

  return { user };
}
