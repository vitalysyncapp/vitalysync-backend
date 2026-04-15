import bcrypt from 'bcrypt';
import pool from '../config/db.js';

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
    onboarding_completed: user.onboarding_completed ?? false
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

    // Insert user
    const newUser = await pool.query(
      `INSERT INTO users 
       (username, email, password)
       VALUES ($1, $2, $3)
       RETURNING user_id, username, email, onboarding_completed, NULL::TEXT AS user_type`,
      [username, email, hashedPassword]
    );

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

    const userQuery = await pool.query(
      `SELECT
         users.user_id,
         users.username,
         users.email,
         users.password,
         users.onboarding_completed,
         onboarding.role_type AS user_type
       FROM users
       LEFT JOIN user_onboarding onboarding
         ON onboarding.user_id = users.user_id
       WHERE users.email = $1`,
      [email]
    );
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

    const updatedUser = await pool.query(
      `UPDATE users
       SET username = $1,
           email = $2
       WHERE user_id = $3
       RETURNING user_id, username, email, onboarding_completed`,
      [username, email, user_id]
    );

    const normalizedRoleType = String(user_type ?? '').trim();
    if (normalizedRoleType) {
      await pool.query(
        `INSERT INTO user_onboarding (user_id, role_type)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           role_type = EXCLUDED.role_type,
           updated_at = NOW()`,
        [user_id, normalizedRoleType]
      );
    }

    const roleResult = await pool.query(
      `SELECT role_type AS user_type
       FROM user_onboarding
       WHERE user_id = $1`,
      [user_id]
    );

    res.status(200).json({
      message: 'Profile updated successfully',
      user: formatUserPayload({
        ...updatedUser.rows[0],
        user_type: roleResult.rows[0]?.user_type ?? null
      })
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: err.message });
  }
}
