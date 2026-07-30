import bcrypt from 'bcrypt';

import pool from '../config/db.js';
import {
  createAccessToken,
  verifyAccountReactivationGrant,
} from './authToken.service.js';

export const REACTIVATION_WINDOW_DAYS = 40;
export const RETENTION_YEARS = 5;

export const ACCOUNT_LIFECYCLE_CODES = Object.freeze({
  invalidCredentials: 'INVALID_CREDENTIALS',
  alreadyDeactivated: 'ACCOUNT_ALREADY_DEACTIVATED',
  reactivationRequired: 'ACCOUNT_REACTIVATION_REQUIRED',
  reactivationExpired: 'ACCOUNT_REACTIVATION_EXPIRED',
  invalidReactivationGrant: 'INVALID_REACTIVATION_GRANT',
});

// Keep dependency targets before the rows they reference. Indirect children,
// such as nutrition_log_items, are removed by their ON DELETE CASCADE.
export const USER_OWNED_TABLES = Object.freeze([
  'ai_nudge_generations',
  'streak_protected_days',
  'burnout_score_history',
  'auth_email_tokens',
  'wellness_product_events',
  'user_settings',
  'user_check_in_schedules',
  'user_baseline_epochs',
  'streak_reward_claims',
  'streak_saver_events',
  'streak_saver_periods',
  'user_goals',
  'user_insight_reports',
  'notification_events',
  'user_reminder_preferences',
  'nudge_events',
  'weekly_pulse_responses',
  'daily_exercise_goals',
  'daily_activity_logs',
  'nutrition_attempts',
  'nutrition_logs',
  'user_environment_snapshots',
  'user_onboarding_answers',
  'user_onboarding_profiles',
  'user_busy_days',
  'user_preferences',
  'user_onboarding',
  'daily_logs',
  'user_streaks',
]);

export class AccountLifecycleError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = 'AccountLifecycleError';
    this.status = status;
    this.code = code;
  }
}

function normalizeUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AccountLifecycleError('Authenticated user is required', {
      status: 401,
    });
  }
  return userId;
}

async function withTransaction(db, work) {
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

function lifecycleDates(now) {
  const deactivatedAt = new Date(now);
  const reactivationDeadline = new Date(deactivatedAt);
  reactivationDeadline.setUTCDate(
    reactivationDeadline.getUTCDate() + REACTIVATION_WINDOW_DAYS,
  );
  const retentionExpiresAt = new Date(deactivatedAt);
  retentionExpiresAt.setUTCFullYear(
    retentionExpiresAt.getUTCFullYear() + RETENTION_YEARS,
  );
  return { deactivatedAt, reactivationDeadline, retentionExpiresAt };
}

async function lockedUser(client, userId) {
  const result = await client.query(
    `SELECT
       user_id,
       username,
       email,
       password,
       auth_token_version,
       deactivated_at,
       reactivation_deadline,
       retention_expires_at
     FROM users
     WHERE user_id = $1
     FOR UPDATE`,
    [userId],
  );
  return result.rows[0];
}

async function requirePassword(user, password) {
  const normalizedPassword = String(password ?? '').trim();
  if (
    !user ||
    !normalizedPassword ||
    !(await bcrypt.compare(normalizedPassword, user.password))
  ) {
    throw new AccountLifecycleError('Current password is incorrect', {
      status: 401,
      code: ACCOUNT_LIFECYCLE_CODES.invalidCredentials,
    });
  }
}

export function deactivateAccount({
  userId,
  currentPassword,
  confirmation,
  db = pool,
  now = new Date(),
}) {
  const normalizedUserId = normalizeUserId(userId);
  if (String(confirmation ?? '').trim() !== 'CONFIRM') {
    throw new AccountLifecycleError(
      'Type CONFIRM exactly to deactivate your account',
    );
  }

  return withTransaction(db, async (client) => {
    const user = await lockedUser(client, normalizedUserId);
    await requirePassword(user, currentPassword);
    if (user.deactivated_at != null) {
      throw new AccountLifecycleError('This account is already deactivated', {
        status: 409,
        code: ACCOUNT_LIFECYCLE_CODES.alreadyDeactivated,
      });
    }

    const dates = lifecycleDates(now);
    const result = await client.query(
      `UPDATE users
       SET deactivated_at = $2,
           reactivation_deadline = $3,
           retention_expires_at = $4,
           auth_token_version = auth_token_version + 1
       WHERE user_id = $1
       RETURNING
         user_id,
         auth_token_version,
         deactivated_at,
         reactivation_deadline,
         retention_expires_at`,
      [
        normalizedUserId,
        dates.deactivatedAt,
        dates.reactivationDeadline,
        dates.retentionExpiresAt,
      ],
    );
    await client.query(
      `UPDATE auth_email_tokens
       SET consumed_at = NOW()
       WHERE user_id = $1
         AND consumed_at IS NULL`,
      [normalizedUserId],
    );
    return result.rows[0];
  });
}

function formatUser(row) {
  const hasProfile = row.has_onboarding_profile === true;
  return {
    user_id: Number(row.user_id),
    username: row.username,
    email: row.email,
    email_verified: row.email_verified === true,
    age: row.age == null ? null : Number(row.age),
    gender: row.gender ?? null,
    user_type: row.user_type ?? row.role ?? null,
    role: row.role ?? row.user_type ?? null,
    lifestyle_type: row.lifestyle_type ?? null,
    wellness_goal: row.wellness_goal ?? null,
    onboarding_completed: row.onboarding_completed === true && hasProfile,
  };
}

export function reactivateAccount({
  reactivationToken,
  db = pool,
  now = new Date(),
}) {
  let grant;
  try {
    grant = verifyAccountReactivationGrant(reactivationToken, { now });
  } catch (_error) {
    throw new AccountLifecycleError('Invalid or expired reactivation session', {
      status: 401,
      code: ACCOUNT_LIFECYCLE_CODES.invalidReactivationGrant,
    });
  }

  return withTransaction(db, async (client) => {
    const user = await lockedUser(client, grant.sub);
    if (
      !user ||
      Number(user.auth_token_version ?? 0) !== Number(grant.ver) ||
      user.deactivated_at == null
    ) {
      throw new AccountLifecycleError(
        'Invalid or expired reactivation session',
        {
          status: 401,
          code: ACCOUNT_LIFECYCLE_CODES.invalidReactivationGrant,
        },
      );
    }
    if (new Date(user.reactivation_deadline).getTime() <= now.getTime()) {
      throw new AccountLifecycleError(
        'The 40-day reactivation period has ended',
        {
          status: 423,
          code: ACCOUNT_LIFECYCLE_CODES.reactivationExpired,
        },
      );
    }

    const activated = await client.query(
      `UPDATE users
       SET deactivated_at = NULL,
           reactivation_deadline = NULL,
           retention_expires_at = NULL
       WHERE user_id = $1
       RETURNING auth_token_version`,
      [user.user_id],
    );

    await client.query(
      `INSERT INTO user_streaks (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.user_id],
    );

    const sessionResult = await client.query(
      `SELECT
         users.user_id,
         users.username,
         users.email,
         users.email_verified,
         users.age,
         users.gender,
         users.onboarding_completed,
         COALESCE(profile.role, users.role) AS role,
         COALESCE(profile.role, users.role) AS user_type,
         COALESCE(profile.lifestyle_type, users.lifestyle_type) AS lifestyle_type,
         COALESCE(profile.wellness_goal, users.wellness_goal) AS wellness_goal,
         EXISTS (
           SELECT 1 FROM user_onboarding_profiles existing_profile
           WHERE existing_profile.user_id = users.user_id
         ) AS has_onboarding_profile
       FROM users
       LEFT JOIN user_onboarding_profiles profile
         ON profile.user_id = users.user_id
       WHERE users.user_id = $1`,
      [user.user_id],
    );
    const streakResult = await client.query(
      `SELECT current_streak, longest_streak, last_logged_date
       FROM user_streaks
       WHERE user_id = $1`,
      [user.user_id],
    );
    const tokenUser = {
      user_id: user.user_id,
      auth_token_version: activated.rows[0].auth_token_version,
    };

    return {
      user: formatUser(sessionResult.rows[0]),
      streak: streakResult.rows[0] ?? {
        current_streak: 0,
        longest_streak: 0,
        last_logged_date: null,
      },
      ...createAccessToken(tokenUser),
    };
  });
}

export function clearAccountData({
  userId,
  currentPassword,
  db = pool,
}) {
  const normalizedUserId = normalizeUserId(userId);
  return withTransaction(db, async (client) => {
    const user = await lockedUser(client, normalizedUserId);
    await requirePassword(user, currentPassword);
    if (user.deactivated_at != null) {
      throw new AccountLifecycleError(
        'Reactivate this account before clearing its data',
        {
          status: 423,
          code: ACCOUNT_LIFECYCLE_CODES.reactivationRequired,
        },
      );
    }

    for (const tableName of USER_OWNED_TABLES) {
      await client.query(
        `DELETE FROM ${tableName} WHERE user_id = $1`,
        [normalizedUserId],
      );
    }

    const result = await client.query(
      `UPDATE users
       SET onboarding_completed = FALSE,
           onboarding_completed_at = NULL,
           age = NULL,
           gender = NULL,
           role = NULL,
           lifestyle_type = NULL,
           wellness_goal = NULL,
           wellness_goals = '{}'::TEXT[],
           auth_token_version = auth_token_version + 1
       WHERE user_id = $1
       RETURNING user_id, auth_token_version`,
      [normalizedUserId],
    );
    return result.rows[0];
  });
}

export async function purgeExpiredDeactivatedAccounts({ db = pool } = {}) {
  return withTransaction(db, async (client) => {
    const expiredResult = await client.query(
      `SELECT user_id
       FROM users
       WHERE deactivated_at IS NOT NULL
         AND retention_expires_at <= NOW()
       FOR UPDATE`,
    );

    for (const row of expiredResult.rows) {
      const userId = Number(row.user_id);
      for (const tableName of USER_OWNED_TABLES) {
        await client.query(
          `DELETE FROM ${tableName} WHERE user_id = $1`,
          [userId],
        );
      }
      await client.query('DELETE FROM users WHERE user_id = $1', [userId]);
    }

    return expiredResult.rows.length;
  });
}

export function startAccountRetentionCleanup({
  db = pool,
  intervalMs = 24 * 60 * 60 * 1000,
} = {}) {
  const run = async () => {
    try {
      const count = await purgeExpiredDeactivatedAccounts({ db });
      if (count > 0) {
        console.log(`Purged ${count} expired deactivated account(s).`);
      }
    } catch (_error) {
      console.error('Expired account retention cleanup failed.');
    }
  };

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
