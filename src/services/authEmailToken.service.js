import crypto from 'node:crypto';

import bcrypt from 'bcrypt';

import pool from '../config/db.js';

export const AUTH_EMAIL_TOKEN_TYPES = Object.freeze({
  emailVerification: 'email_verification',
  passwordReset: 'password_reset',
});

export const AUTH_EMAIL_TOKEN_MESSAGES = Object.freeze({
  invalidVerificationCode: 'Invalid or expired verification code',
  invalidPasswordResetCode: 'Invalid or expired password reset code',
  invalidPasswordResetToken: 'Invalid or expired password reset session',
});

export const AUTH_CODE_LENGTH = 6;
export const AUTH_CODE_MAX_ATTEMPTS = 5;

const DEFAULT_AUTH_CODE_TTL_MINUTES = 10;
const DEFAULT_PASSWORD_RESET_GRANT_TTL_MINUTES = 10;
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

async function withTransaction(db, work) {
  if (typeof db.connect !== 'function') {
    return work(db);
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function isValidCode(code) {
  return new RegExp(`^\\d{${AUTH_CODE_LENGTH}}$`).test(String(code ?? '').trim());
}

function getCodeExpiresAt(now = new Date()) {
  const ttlMinutes = readPositiveInteger(
    'AUTH_CODE_TTL_MINUTES',
    DEFAULT_AUTH_CODE_TTL_MINUTES,
  );
  return new Date(now.getTime() + ttlMinutes * MINUTE_MS);
}

function getPasswordResetGrantExpiresAt(now = new Date()) {
  const ttlMinutes = readPositiveInteger(
    'PASSWORD_RESET_GRANT_TTL_MINUTES',
    DEFAULT_PASSWORD_RESET_GRANT_TTL_MINUTES,
  );
  return new Date(now.getTime() + ttlMinutes * MINUTE_MS);
}

export function createRawEmailCode() {
  return crypto
    .randomInt(0, 10 ** AUTH_CODE_LENGTH)
    .toString()
    .padStart(AUTH_CODE_LENGTH, '0');
}

export function createRawPasswordResetGrant() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashEmailToken(token) {
  return crypto
    .createHash('sha256')
    .update(String(token ?? '').trim())
    .digest('hex');
}

async function createAuthCode({ userId, email, tokenType, db, now }) {
  const normalizedUserId = Number(userId);
  const normalizedEmail = normalizeEmail(email);

  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error('Valid user id is required for authentication email');
  }
  if (!normalizedEmail) {
    throw new Error('Email is required for authentication email');
  }

  const code = createRawEmailCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = getCodeExpiresAt(now);

  await withTransaction(db, async (client) => {
    await client.query(
      `UPDATE auth_email_tokens
       SET consumed_at = NOW()
       WHERE user_id = $1
         AND token_type = $2
         AND consumed_at IS NULL`,
      [normalizedUserId, tokenType],
    );

    await client.query(
      `INSERT INTO auth_email_tokens
         (user_id, email, token_type, token_hash, code_hash, failed_attempts, expires_at)
       VALUES ($1, $2, $3, NULL, $4, 0, $5)`,
      [normalizedUserId, normalizedEmail, tokenType, codeHash, expiresAt],
    );
  });

  return { code, expiresAt };
}

export function createEmailVerificationCode({
  userId,
  email,
  db = pool,
  now = new Date(),
}) {
  return createAuthCode({
    userId,
    email,
    tokenType: AUTH_EMAIL_TOKEN_TYPES.emailVerification,
    db,
    now,
  });
}

export function createPasswordResetCode({
  userId,
  email,
  db = pool,
  now = new Date(),
}) {
  return createAuthCode({
    userId,
    email,
    tokenType: AUTH_EMAIL_TOKEN_TYPES.passwordReset,
    db,
    now,
  });
}

async function findAndCheckCode({
  client,
  code,
  tokenType,
  userId,
  email,
  invalidMessage,
}) {
  if (!isValidCode(code)) {
    return { error: invalidMessage };
  }

  const conditions = [
    'token_type = $1',
    'consumed_at IS NULL',
    'expires_at > NOW()',
    `failed_attempts < ${AUTH_CODE_MAX_ATTEMPTS}`,
  ];
  const params = [tokenType];

  if (userId != null) {
    params.push(Number(userId));
    conditions.push(`user_id = $${params.length}`);
  } else {
    params.push(normalizeEmail(email));
    conditions.push(`LOWER(email) = $${params.length}`);
  }

  const result = await client.query(
    `SELECT token_id, user_id, email, code_hash
     FROM auth_email_tokens
     WHERE ${conditions.join('\n       AND ')}
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    params,
  );
  const tokenRow = result.rows[0];

  if (!tokenRow?.code_hash) {
    return { error: invalidMessage };
  }

  const valid = await bcrypt.compare(String(code).trim(), tokenRow.code_hash);
  if (!valid) {
    await client.query(
      `UPDATE auth_email_tokens
       SET failed_attempts = failed_attempts + 1,
           consumed_at = CASE
             WHEN failed_attempts + 1 >= $2 THEN NOW()
             ELSE consumed_at
           END
       WHERE token_id = $1`,
      [tokenRow.token_id, AUTH_CODE_MAX_ATTEMPTS],
    );
    return { error: invalidMessage };
  }

  return { tokenRow };
}

export function consumeEmailVerificationCode({ userId, code, db = pool }) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return Promise.resolve({
      error: AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationCode,
    });
  }

  return withTransaction(db, async (client) => {
    const checked = await findAndCheckCode({
      client,
      code,
      tokenType: AUTH_EMAIL_TOKEN_TYPES.emailVerification,
      userId: normalizedUserId,
      invalidMessage: AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationCode,
    });
    if (checked.error) return checked;

    const tokenRow = checked.tokenRow;
    const userResult = await client.query(
      `UPDATE users
       SET email_verified = TRUE,
           email_verified_at = COALESCE(email_verified_at, NOW())
       WHERE user_id = $1
         AND LOWER(email) = $2
       RETURNING user_id, email, email_verified, email_verified_at`,
      [tokenRow.user_id, normalizeEmail(tokenRow.email)],
    );
    const user = userResult.rows[0];
    if (!user) {
      return { error: AUTH_EMAIL_TOKEN_MESSAGES.invalidVerificationCode };
    }

    await client.query(
      `UPDATE auth_email_tokens
       SET consumed_at = NOW()
       WHERE token_id = $1`,
      [tokenRow.token_id],
    );

    return { user };
  });
}

export function exchangePasswordResetCode({ email, code, db = pool, now = new Date() }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return Promise.resolve({
      error: AUTH_EMAIL_TOKEN_MESSAGES.invalidPasswordResetCode,
    });
  }

  return withTransaction(db, async (client) => {
    const checked = await findAndCheckCode({
      client,
      code,
      tokenType: AUTH_EMAIL_TOKEN_TYPES.passwordReset,
      email: normalizedEmail,
      invalidMessage: AUTH_EMAIL_TOKEN_MESSAGES.invalidPasswordResetCode,
    });
    if (checked.error) return checked;

    const resetToken = createRawPasswordResetGrant();
    const expiresAt = getPasswordResetGrantExpiresAt(now);
    await client.query(
      `UPDATE auth_email_tokens
       SET token_hash = $2,
           code_hash = NULL,
           failed_attempts = 0,
           expires_at = $3
       WHERE token_id = $1`,
      [checked.tokenRow.token_id, hashEmailToken(resetToken), expiresAt],
    );

    return { resetToken, expiresAt };
  });
}
