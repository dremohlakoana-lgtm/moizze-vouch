const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const adminAuth = require('../middleware/adminAuth');

function generateTxnRef() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let random = '';
  for (let i = 0; i < 6; i++) random += chars.charAt(Math.floor(Math.random() * chars.length));
  return `TXN${Date.now()}${random}`;
}

// GET /api/admin/stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [users, totalVouch, pendingWithdrawals, totalTxns, totalDeposits] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM users WHERE role = 'user'"),
      pool.query("SELECT COALESCE(SUM(vouch_balance), 0) AS total FROM users"),
      pool.query("SELECT COUNT(*) FROM withdrawal_requests WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) FROM transactions"),
      pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'deposit' AND status = 'completed'"),
    ]);

    res.json({
      success: true,
      stats: {
        total_users: parseInt(users.rows[0].count),
        total_vouch_circulation: parseFloat(totalVouch.rows[0].total),
        pending_withdrawals: parseInt(pendingWithdrawals.rows[0].count),
        total_transactions: parseInt(totalTxns.rows[0].count),
        total_deposits: parseFloat(totalDeposits.rows[0].total),
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to get stats.' });
  }
});

// GET /api/admin/users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let query = `SELECT id, full_name, email, phone, role, vouch_balance, account_number, is_active, created_at
                 FROM users`;
    let params = [];

    if (search) {
      query += ` WHERE full_name ILIKE $1 OR email ILIKE $1 OR account_number ILIKE $1`;
      params.push(`%${search}%`);
      query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      params.push(limit, offset);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
      params.push(limit, offset);
    }

    const result = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) FROM users';
    let countParams = [];
    if (search) {
      countQuery += ` WHERE full_name ILIKE $1 OR email ILIKE $1 OR account_number ILIKE $1`;
      countParams.push(`%${search}%`);
    }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      success: true,
      users: result.rows.map(u => ({ ...u, vouch_balance: parseFloat(u.vouch_balance) })),
      pagination: {
        page, limit,
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
      }
    });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ success: false, message: 'Failed to get users.' });
  }
});

// GET /api/admin/users/:id
router.get('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const userResult = await pool.query(
      'SELECT id, full_name, email, phone, role, vouch_balance, account_number, is_active, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const txnResult = await pool.query(
      `SELECT t.*, s.full_name AS sender_name, r.full_name AS receiver_name
       FROM transactions t
       LEFT JOIN users s ON t.sender_id = s.id
       LEFT JOIN users r ON t.receiver_id = r.id
       WHERE t.sender_id = $1 OR t.receiver_id = $1
       ORDER BY t.created_at DESC LIMIT 10`,
      [userId]
    );

    const user = userResult.rows[0];
    res.json({
      success: true,
      user: { ...user, vouch_balance: parseFloat(user.vouch_balance) },
      recent_transactions: txnResult.rows.map(t => ({ ...t, amount: parseFloat(t.amount) })),
    });
  } catch (error) {
    console.error('Admin get user error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user.' });
  }
});

// POST /api/admin/users/:id/load-vouch
router.post('/users/:id/load-vouch', adminAuth, [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('description').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  try {
    const userId = parseInt(req.params.id);
    const { amount, description } = req.body;
    const loadAmount = parseFloat(amount);

    const userResult = await pool.query('SELECT id, full_name, is_active FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE users SET vouch_balance = vouch_balance + $1, updated_at = NOW() WHERE id = $2',
        [loadAmount, userId]
      );

      const txnRef = generateTxnRef();
      const desc = description || `Admin credit by ${req.user.full_name}`;
      await client.query(
        `INSERT INTO transactions (transaction_ref, receiver_id, amount, type, status, description)
         VALUES ($1, $2, $3, 'admin_credit', 'completed', $4)`,
        [txnRef, userId, loadAmount, desc]
      );

      await client.query(
        'INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)',
        [
          userId,
          'Vouch Loaded',
          `V ${loadAmount.toFixed(2)} has been added to your wallet. ${desc}`,
          'credit'
        ]
      );

      await client.query('COMMIT');

      const updatedUser = await pool.query('SELECT vouch_balance FROM users WHERE id = $1', [userId]);

      res.json({
        success: true,
        message: `V ${loadAmount.toFixed(2)} loaded to user successfully.`,
        new_balance: parseFloat(updatedUser.rows[0].vouch_balance),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Load vouch error:', error);
    res.status(500).json({ success: false, message: 'Failed to load Vouch.' });
  }
});

// POST /api/admin/users/:id/deduct-vouch
router.post('/users/:id/deduct-vouch', adminAuth, [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('description').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  try {
    const userId = parseInt(req.params.id);
    const { amount, description } = req.body;
    const deductAmount = parseFloat(amount);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        'SELECT id, full_name, vouch_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );

      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      if (parseFloat(userResult.rows[0].vouch_balance) < deductAmount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'User has insufficient balance.' });
      }

      await client.query(
        'UPDATE users SET vouch_balance = vouch_balance - $1, updated_at = NOW() WHERE id = $2',
        [deductAmount, userId]
      );

      const txnRef = generateTxnRef();
      const desc = description || `Admin deduction by ${req.user.full_name}`;
      await client.query(
        `INSERT INTO transactions (transaction_ref, sender_id, amount, type, status, description)
         VALUES ($1, $2, $3, 'admin_debit', 'completed', $4)`,
        [txnRef, userId, deductAmount, desc]
      );

      await client.query('COMMIT');

      const updatedUser = await pool.query('SELECT vouch_balance FROM users WHERE id = $1', [userId]);

      res.json({
        success: true,
        message: `V ${deductAmount.toFixed(2)} deducted from user successfully.`,
        new_balance: parseFloat(updatedUser.rows[0].vouch_balance),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Deduct vouch error:', error);
    res.status(500).json({ success: false, message: 'Failed to deduct Vouch.' });
  }
});

// PUT /api/admin/users/:id/toggle-active
router.put('/users/:id/toggle-active', adminAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    const result = await pool.query(
      'UPDATE users SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING is_active, full_name',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const { is_active, full_name } = result.rows[0];
    res.json({
      success: true,
      message: `User ${full_name} has been ${is_active ? 'activated' : 'deactivated'}.`,
      is_active,
    });
  } catch (error) {
    console.error('Toggle active error:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle user status.' });
  }
});

// GET /api/admin/withdrawals
router.get('/withdrawals', adminAuth, async (req, res) => {
  try {
    const status = req.query.status || null;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    let query = `SELECT wr.*, u.full_name AS user_name, u.email AS user_email, u.account_number AS user_account
                 FROM withdrawal_requests wr
                 JOIN users u ON wr.user_id = u.id`;
    let params = [];

    if (status) {
      query += ` WHERE wr.status = $1 ORDER BY wr.created_at DESC LIMIT $2 OFFSET $3`;
      params = [status, limit, offset];
    } else {
      query += ` ORDER BY wr.created_at DESC LIMIT $1 OFFSET $2`;
      params = [limit, offset];
    }

    const result = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) FROM withdrawal_requests';
    let countParams = [];
    if (status) {
      countQuery += ' WHERE status = $1';
      countParams = [status];
    }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      success: true,
      withdrawals: result.rows.map(w => ({ ...w, amount: parseFloat(w.amount) })),
      pagination: {
        page, limit,
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
      }
    });
  } catch (error) {
    console.error('Admin withdrawals error:', error);
    res.status(500).json({ success: false, message: 'Failed to get withdrawals.' });
  }
});

// PUT /api/admin/withdrawals/:id/approve
router.put('/withdrawals/:id/approve', adminAuth, async (req, res) => {
  try {
    const withdrawalId = parseInt(req.params.id);

    const wResult = await pool.query(
      'SELECT * FROM withdrawal_requests WHERE id = $1',
      [withdrawalId]
    );

    if (wResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    const withdrawal = wResult.rows[0];
    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Withdrawal is already ${withdrawal.status}.` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE withdrawal_requests
         SET status = 'approved', processed_by = $1, updated_at = NOW()
         WHERE id = $2`,
        [req.user.id, withdrawalId]
      );

      // Update pending transaction status
      await client.query(
        `UPDATE transactions SET status = 'completed'
         WHERE sender_id = $1 AND type = 'withdrawal' AND status = 'pending'
         AND amount = $2`,
        [withdrawal.user_id, withdrawal.amount]
      );

      await client.query(
        'INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)',
        [
          withdrawal.user_id,
          'Withdrawal Approved',
          `Your withdrawal of V ${parseFloat(withdrawal.amount).toFixed(2)} to ${withdrawal.bank_name} has been approved and is being processed.`,
          'info'
        ]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Withdrawal approved successfully.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Approve withdrawal error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve withdrawal.' });
  }
});

// PUT /api/admin/withdrawals/:id/reject
router.put('/withdrawals/:id/reject', adminAuth, [
  body('admin_note').optional().trim(),
], async (req, res) => {
  try {
    const withdrawalId = parseInt(req.params.id);
    const { admin_note } = req.body;

    const wResult = await pool.query(
      'SELECT * FROM withdrawal_requests WHERE id = $1',
      [withdrawalId]
    );

    if (wResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    const withdrawal = wResult.rows[0];
    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Withdrawal is already ${withdrawal.status}.` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE withdrawal_requests
         SET status = 'rejected', admin_note = $1, processed_by = $2, updated_at = NOW()
         WHERE id = $3`,
        [admin_note || null, req.user.id, withdrawalId]
      );

      // Refund Vouch to user
      await client.query(
        'UPDATE users SET vouch_balance = vouch_balance + $1, updated_at = NOW() WHERE id = $2',
        [withdrawal.amount, withdrawal.user_id]
      );

      // Mark transaction as failed and create refund record
      await client.query(
        `UPDATE transactions SET status = 'failed'
         WHERE sender_id = $1 AND type = 'withdrawal' AND status = 'pending'
         AND amount = $2`,
        [withdrawal.user_id, withdrawal.amount]
      );

      const txnRef = generateTxnRef();
      await client.query(
        `INSERT INTO transactions (transaction_ref, receiver_id, amount, type, status, description)
         VALUES ($1, $2, $3, 'refund', 'completed', $4)`,
        [txnRef, withdrawal.user_id, withdrawal.amount, `Withdrawal refund - ${admin_note || 'Rejected by admin'}`]
      );

      await client.query(
        'INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)',
        [
          withdrawal.user_id,
          'Withdrawal Rejected',
          `Your withdrawal of V ${parseFloat(withdrawal.amount).toFixed(2)} was rejected. ${admin_note ? 'Reason: ' + admin_note : ''} Your Vouch has been refunded.`,
          'warning'
        ]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Withdrawal rejected and Vouch refunded to user.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Reject withdrawal error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject withdrawal.' });
  }
});

module.exports = router;
