import pool from '../config/db.js';

export class UserSettingsError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'UserSettingsError';
    this.statusCode = statusCode;
  }
}

/**
 * Reads the user's settings row, inserting defaults if none exists.
 */
export async function getUserSettings(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new UserSettingsError('Valid user_id is required');
  }

  await pool.query(
    `INSERT INTO user_settings (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [id]
  );

  const result = await pool.query(
    `SELECT user_id, hide_from_leaderboard, updated_at
     FROM user_settings
     WHERE user_id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
}

/**
 * Updates the user's settings. Only provided fields are changed.
 */
export async function updateUserSettings(userId, { hideFromLeaderboard }) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new UserSettingsError('Valid user_id is required');
  }

  const hideValue = hideFromLeaderboard === true;

  const result = await pool.query(
    `INSERT INTO user_settings (user_id, hide_from_leaderboard, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       hide_from_leaderboard = $2,
       updated_at = NOW()
     RETURNING user_id, hide_from_leaderboard, updated_at`,
    [id, hideValue]
  );

  return result.rows[0] ?? null;
}
