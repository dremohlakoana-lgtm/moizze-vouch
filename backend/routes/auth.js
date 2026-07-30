const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

// Generate unique 16-digit account number (South Africa format)
async function generateAccountNumber() {
  let accountNumber;
  let isUnique = false;
  while (!isUnique) {
    // 16 digits: prefix 6277 (ZA Moizze) + 12 random digits
    const prefix = '6277';
    const random = Math.floor(100000000000 + Math.random() * 900000000000).toString();
    accountNumber = prefix + random;
    const result = await pool.query('SELECT id FROM users WHERE account_number = $1', [accountNumber]);
    if (result.rows.length === 0) isUnique = true;
  }
  return accountNumber;
}

// POST /api/auth/register
router.post('/register', [
  body('full_name').trim().notEmpty().withMessage('Full name is required').isLength({ min: 2, max: 255 }),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').optional().trim().isLength({ min: 7, max: 20 }),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('invite_code').trim().notEmpty().withMessage('Invitation code is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array(), message: errors.array()[0].msg });
    }

    const { full_name, email, phone, password, invite_code } = req.body;

    // Validate invite code
    const inviteResult = await pool.query(
      `SELECT * FROM invite_codes WHERE code = $1 AND is_used = false AND (expires_at IS NULL OR expires_at > NOW())`,
      [invite_code.toUpperCase()]
    );
    if (inviteResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired invitation code.' });
    }
    const invite = inviteResult.rows[0];

    // Check if email exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const account_number = await generateAccountNumber();

    // Determine role
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@moizze.com';
    const role = email.toLowerCase() === adminEmail.toLowerCase() ? 'admin' : 'user';

    const result = await pool.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, account_number)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, full_name, email, phone, role, vouch_balance, account_number, is_active, created_at`,
      [full_name, email.toLowerCase(), phone || null, password_hash, role, account_number]
    );

    const user = result.rows[0];

    // Mark invite code as used
    await pool.query(
      `UPDATE invite_codes SET is_used = true, used_by = $1, used_at = NOW() WHERE id = $2`,
      [user.id, invite.id]
    );

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        vouch_balance: parseFloat(user.vouch_balance),
        account_number: user.account_number,
        is_active: user.is_active,
        created_at: user.created_at,
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }

    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact support.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        vouch_balance: parseFloat(user.vouch_balance),
        account_number: user.account_number,
        is_active: user.is_active,
        created_at: user.created_at,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, full_name, email, phone, role, vouch_balance, account_number, is_active, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0];
    res.json({
      success: true,
      user: {
        ...user,
        vouch_balance: parseFloat(user.vouch_balance),
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user profile.' });
  }
});

module.exports = router;
