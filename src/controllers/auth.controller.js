import bcrypt from 'bcrypt';
import pool from '../config/db.js';

async function getAuthSchemaSupport() {
  const result = await pool.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'onboarding_completed'
      ) AS has_onboarding_completed,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_onboarding'
      ) AS has_user_onboarding
  `);

  return result.rows[0] ?? {
    has_onboarding_completed: false,
    has_user_onboarding: false
  };
}

async function ensureUserStreak(userId) {
  await pool.query(
    `INSERT INTO user_streaks (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const streakResult = await pool.query(
    `SELECT current_streak, longest_streak, last_logged_date
     FROM user_streaks
     WHERE user_id = $1`,
    [userId]
  );

  return streakResult.rows[0] ?? {
    current_streak: 0,
    longest_streak: 0,
    last_logged_date: null
  };
}

function formatUserPayload(user) {
  return {
    user_id: user.user_id,
    username: user.username,
    email: user.email,
    user_type: user.user_type ?? null,
    onboarding_completed: user.onboarding_completed == true && user.has_preferences == true
  };
}

export async function signup(req, res) {
  try {
    const {
      username,
      email,
      password
    } = req.body;

    // Validate required fields
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Username, email, and password are required' });
    }

    // Check if email or username already exists
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Email or username already exists' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    const schema = await getAuthSchemaSupport();

    // Insert user
    const signupQuery = schema.has_onboarding_completed
      ? `INSERT INTO users
         (username, email, password)
         VALUES ($1, $2, $3)
         RETURNING user_id, username, email, onboarding_completed, NULL::TEXT AS user_type`
      : `INSERT INTO users
         (username, email, password)
         VALUES ($1, $2, $3)
         RETURNING user_id, username, email, FALSE AS onboarding_completed, NULL::TEXT AS user_type`;
    const newUser = await pool.query(signupQuery, [username, email, hashedPassword]);

    const streak = await ensureUserStreak(newUser.rows[0].user_id);

    res.status(201).json({
      message: 'User created successfully',
      user: formatUserPayload(newUser.rows[0]),
      streak
    });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: err.message, });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: 'Email and password required' });

    const schema = await getAuthSchemaSupport();
    const loginQuery = schema.has_user_onboarding
      ? `SELECT
           users.user_id,
           users.username,
           users.email,
           users.password,
           ${schema.has_onboarding_completed ? 'users.onboarding_completed' : 'FALSE AS onboarding_completed'},
           onboarding.role_type AS user_type,
           EXISTS (
             SELECT 1
             FROM user_preferences preferences
             WHERE preferences.user_id = users.user_id
           ) AS has_preferences
         FROM users
         LEFT JOIN user_onboarding onboarding
           ON onboarding.user_id = users.user_id
         WHERE users.email = $1`
      : `SELECT
           users.user_id,
           users.username,
           users.email,
           users.password,
           ${schema.has_onboarding_completed ? 'users.onboarding_completed' : 'FALSE AS onboarding_completed'},
           NULL::TEXT AS user_type,
           FALSE AS has_preferences
         FROM users
         WHERE users.email = $1`;
    const userQuery = await pool.query(loginQuery, [email]);
    const user = userQuery.rows[0];

    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ message: 'Invalid credentials' });

    const streak = await ensureUserStreak(user.user_id);

    res.status(200).json({
      message: 'Login successful',
      user: formatUserPayload(user),
      streak,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function updateProfile(req, res) {
  try {
    const {
      user_id,
      username,
      email,
      user_type = null
    } = req.body;

    if (!user_id || !username || !email) {
      return res.status(400).json({
        message: 'User ID, username, and email are required'
      });
    }

    const schema = await getAuthSchemaSupport();

    const existingUser = await pool.query(
      'SELECT user_id FROM users WHERE user_id = $1',
      [user_id]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const duplicateUser = await pool.query(
      `SELECT user_id
       FROM users
       WHERE (email = $1 OR username = $2) AND user_id <> $3`,
      [email, username, user_id]
    );

    if (duplicateUser.rows.length > 0) {
      return res.status(400).json({
        message: 'Email or username already exists'
      });
    }

    const updateQuery = schema.has_onboarding_completed
      ? `UPDATE users
         SET username = $1,
             email = $2
         WHERE user_id = $3
         RETURNING user_id, username, email, onboarding_completed`
      : `UPDATE users
         SET username = $1,
             email = $2
         WHERE user_id = $3
         RETURNING user_id, username, email, FALSE AS onboarding_completed`;
    const updatedUser = await pool.query(updateQuery, [username, email, user_id]);

    const normalizedRoleType = String(user_type ?? '').trim();
    if (schema.has_user_onboarding && normalizedRoleType) {
      await pool.query(
        `INSERT INTO user_onboarding (user_id, role_type)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           role_type = EXCLUDED.role_type,
           updated_at = NOW()`,
        [user_id, normalizedRoleType]
      );
    }

    const roleResult = schema.has_user_onboarding
      ? await pool.query(
          `SELECT role_type AS user_type
           FROM user_onboarding
           WHERE user_id = $1`,
          [user_id]
        )
      : { rows: [] };

    res.status(200).json({
      message: 'Profile updated successfully',
      user: formatUserPayload({
        ...updatedUser.rows[0],
        user_type: roleResult.rows[0]?.user_type ?? null,
        has_preferences: false
      })
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getAccountDeletionSupport(client) {
  const result = await client.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'daily_logs'
      ) AS has_daily_logs,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_streaks'
      ) AS has_user_streaks,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_busy_days'
      ) AS has_user_busy_days,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_preferences'
      ) AS has_user_preferences,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_onboarding'
      ) AS has_user_onboarding,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_environment_snapshots'
      ) AS has_user_environment_snapshots
  `);

  return result.rows[0] ?? {
    has_daily_logs: false,
    has_user_streaks: false,
    has_user_busy_days: false,
    has_user_preferences: false,
    has_user_onboarding: false,
    has_user_environment_snapshots: false
  };
}

export async function deleteAccount(req, res) {
  const {
    user_id: rawUserId,
    email,
    password
  } = req.body;

  const userId = Number(rawUserId);
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const normalizedPassword = String(password ?? '').trim();

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Valid user_id is required' });
  }

  if (!normalizedEmail || !normalizedPassword) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT user_id, email, password
       FROM users
       WHERE user_id = $1`,
      [userId]
    );

    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    if (String(user.email ?? '').trim().toLowerCase() !== normalizedEmail) {
      await client.query('ROLLBACK');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(normalizedPassword, user.password);
    if (!validPassword) {
      await client.query('ROLLBACK');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const schema = await getAccountDeletionSupport(client);

    if (schema.has_user_environment_snapshots) {
      await client.query(
        'DELETE FROM user_environment_snapshots WHERE user_id = $1',
        [userId]
      );
    }

    if (schema.has_daily_logs) {
      await client.query(
        'DELETE FROM daily_logs WHERE user_id = $1',
        [userId]
      );
    }

    if (schema.has_user_streaks) {
      await client.query(
        'DELETE FROM user_streaks WHERE user_id = $1',
        [userId]
      );
    }

    if (schema.has_user_busy_days) {
      await client.query(
        'DELETE FROM user_busy_days WHERE user_id = $1',
        [userId]
      );
    }

    if (schema.has_user_preferences) {
      await client.query(
        'DELETE FROM user_preferences WHERE user_id = $1',
        [userId]
      );
    }

    if (schema.has_user_onboarding) {
      await client.query(
        'DELETE FROM user_onboarding WHERE user_id = $1',
        [userId]
      );
    }

    await client.query(
      'DELETE FROM users WHERE user_id = $1',
      [userId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Account deleted successfully'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete account error:', err);
    return res.status(500).json({ message: 'Failed to delete account' });
  } finally {
    client.release();
  }
}
