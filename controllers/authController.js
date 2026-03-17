import pool from '../config/db.js';
import bcrypt from 'bcrypt';

export const signUp = async (req, res) => {
  const { fullName, email, username, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (full_name, email, username, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, full_name, email, username',
      [fullName, email, username, hashedPassword]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') { // Unique violation
      return res.status(409).json({ message: 'Email or username already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};