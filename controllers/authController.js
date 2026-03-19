// controllers/authController.js
import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../config/db.js';

const router = express.Router();

// Signup endpoint
router.post('/signup', async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      age = null,
      gender = null,
      user_type = null
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
       (username, email, password, age, gender, user_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, email, age, gender, user_type`,
      [username, email, hashedPassword, age, gender, user_type]
    );

    res.status(201).json({
      message: 'User created successfully',
      user: newUser.rows[0]
    });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: err.message, });
  }
});

export default router;