import bcrypt from 'bcrypt';

import pool from '../config/db.js';
import {
  AUTH_EMAIL_TOKEN_MESSAGES,
  AUTH_EMAIL_TOKEN_TYPES,
  hashEmailToken,
} from './authEmailToken.service.js';

export const PASSWORD_CHANGE_MESSAGES = Object.freeze({
  invalidCurrentPassword: 'Current password is incorrect',
  passwordUnchanged: 'New password must be different from your current password',
});

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

export function resetPasswordWithGrant({ resetToken, newPassword, db = pool }) {
  const normalizedToken = String(resetToken ?? '').trim();
  if (!normalizedToken) {
    return Promise.resolve({
      error: AUTH_EMAIL_TOKEN_MESSAGES.invalidPasswordResetToken,
    });
  }

  return withTransaction(db, async (client) => {
    const tokenResult = await client.query(
      `SELECT token_id, user_id, email
       FROM auth_email_tokens
       WHERE token_hash = $1
         AND token_type = $2
         AND code_hash IS NULL
         AND consumed_at IS NULL
         AND expires_at > NOW()
       LIMIT 1
       FOR UPDATE`,
      [hashEmailToken(normalizedToken), AUTH_EMAIL_TOKEN_TYPES.passwordReset],
    );
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow) {
      return { error: AUTH_EMAIL_TOKEN_MESSAGES.invalidPasswordResetToken };
    }

    const userResult = await client.query(
      `SELECT user_id, email, password
       FROM users
       WHERE user_id = $1
         AND LOWER(email) = $2
         AND (
           deactivated_at IS NULL
           OR reactivation_deadline > NOW()
         )
       FOR UPDATE`,
      [tokenRow.user_id, String(tokenRow.email).trim().toLowerCase()],
    );
    const user = userResult.rows[0];
    if (!user) {
      return { error: AUTH_EMAIL_TOKEN_MESSAGES.invalidPasswordResetToken };
    }

    if (await bcrypt.compare(newPassword, user.password)) {
      return { error: PASSWORD_CHANGE_MESSAGES.passwordUnchanged };
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updatedResult = await client.query(
      `UPDATE users
       SET password = $2,
           auth_token_version = auth_token_version + 1
       WHERE user_id = $1
       RETURNING user_id, email, auth_token_version`,
      [user.user_id, passwordHash],
    );

    await client.query(
      `UPDATE auth_email_tokens
       SET consumed_at = NOW()
       WHERE token_id = $1`,
      [tokenRow.token_id],
    );

    return { user: updatedResult.rows[0] };
  });
}

export function changeAuthenticatedPassword({
  userId,
  currentPassword,
  newPassword,
  db = pool,
}) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return Promise.resolve({ error: 'Authenticated user is required' });
  }

  return withTransaction(db, async (client) => {
    const userResult = await client.query(
      `SELECT user_id, password
       FROM users
       WHERE user_id = $1
         AND deactivated_at IS NULL
       FOR UPDATE`,
      [normalizedUserId],
    );
    const user = userResult.rows[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return { error: PASSWORD_CHANGE_MESSAGES.invalidCurrentPassword };
    }

    if (await bcrypt.compare(newPassword, user.password)) {
      return { error: PASSWORD_CHANGE_MESSAGES.passwordUnchanged };
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updatedResult = await client.query(
      `UPDATE users
       SET password = $2,
           auth_token_version = auth_token_version + 1
       WHERE user_id = $1
       RETURNING user_id, auth_token_version`,
      [normalizedUserId, passwordHash],
    );

    return { user: updatedResult.rows[0] };
  });
}
