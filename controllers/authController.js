// authController.js
import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../config/db.js';

const router = express.Router();

// Signup endpoint
router.post('/signup', async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      age = null,
      gender = null,
      occupation = null,
      work_hours_per_day = null,
      academic_hours_per_day = null
    } = req.body;

    // Validate required fields
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password, and role are required' });
    }

    // Check if email already exists
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user into database
    const newUser = await pool.query(
      `INSERT INTO users 
        (name, email, password_hash, role, age, gender, occupation, work_hours_per_day, academic_hours_per_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, email, role, age, gender, occupation`,
      [name, email, hashedPassword, role, age, gender, occupation, work_hours_per_day, academic_hours_per_day]
    );

    res.status(201).json({ message: 'User created successfully', user: newUser.rows[0] });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;