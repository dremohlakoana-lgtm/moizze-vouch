const express = require('express');
const router = express.Router();
const { body, query, validationResult } = require('express-validator');
const pool = require('../config/db');
const auth = require('../middleware/auth');

// Generate transaction reference
function generateTxnRef() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let random = '';
  for (let i = 0; i < 6; i++) random += chars.charAt(Math.floor(Math.random() * chars.length));
  return `TXN${Date.now()}${random}`;
}

// Create notification helper
async function createNotification(client, userId, title, message, type) {
  await client.query(
    'INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)',
    [userId, title, message, type]
  );
}

// GET /api/wallet/balance
router.get('/balance', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT vouch_balance, account_number FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0];
    res.json({
      success: true,
      balance: parseFloat(user.vouch_balance),
      account_number: user.account_number,
    });
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ success: false, message: 'Failed to get balance.' });
  }
});

// POST /api/wallet/send
router.post('/send', auth, [
  body('receiver_account_number').trim().notEmpty().withMessage('Receiver account number is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('description').optional().trim().isLength({ max: 255 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { receiver_account_number, amount, description } = req.body;
  const sendAmount = parseFloat(amount);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock sender row
    const senderResult = await client.query(
      'SELECT id, full_name, vouch_balance, account_number FROM users WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );
    const sender = senderResult.rows[0];

    if (sender.account_number === receiver_account_number) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Cannot send Vouch to yourself.' });
    }

    if (parseFloat(sender.vouch_balance) < sendAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Insufficient Vouch balance.' });
    }

    // Lock receiver row
    const receiverResult = await client.query(
      'SELECT id, full_name, account_number, is_active FROM users WHERE account_number = $1 FOR UPDATE',
      [receiver_account_number]
    );

    if (receiverResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Receiver account not found.' });
    }

    const receiver = receiverResult.rows[0];
    if (!receiver.is_active) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Receiver account is inactive.' });
    }

    // Deduct from sender
    await client.query(
      'UPDATE users SET vouch_balance = vouch_balance - $1, updated_at = NOW() WHERE id = $2',
      [sendAmount, sender.id]
    );

    // Credit receiver
    await client.query(
      'UPDATE users SET vouch_balance = vouch_balance + $1, updated_at = NOW() WHERE id = $2',
      [sendAmount, receiver.id]
    );

    const txnRef = generateTxnRef();
    const desc = description || `Transfer to ${receiver.full_name}`;

    // Record transaction (debit for sender)
    await client.query(
      `INSERT INTO transactions (transaction_ref, sender_id, receiver_id, amount, type, status, description)
       VALUES ($1, $2, $3, $4, 'transfer', 'completed', $5)`,
      [txnRef, sender.id, receiver.id, sendAmount, desc]
    );

    // Notify receiver
    await createNotification(
      client, receiver.id,
      'Vouch Received',
      `You received V ${sendAmount.toFixed(2)} from ${sender.full_name}. Ref: ${txnRef}`,
      'credit'
    );

    await client.query('COMMIT');

    // Get updated balance
    const updatedSender = await pool.query('SELECT vouch_balance FROM users WHERE id = $1', [sender.id]);

    res.json({
      success: true,
      message: `V ${sendAmount.toFixed(2)} sent to ${receiver.full_name} successfully.`,
      transaction_ref: txnRef,
      new_balance: parseFloat(updatedSender.rows[0].vouch_balance),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Send error:', error);
    res.status(500).json({ success: false, message: 'Transfer failed. Please try again.' });
  } finally {
    client.release();
  }
});

// GET /api/wallet/transactions
router.get('/transactions', auth, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT
        t.id, t.transaction_ref, t.amount, t.type, t.status, t.description, t.created_at,
        s.full_name AS sender_name, s.account_number AS sender_account,
        r.full_name AS receiver_name, r.account_number AS receiver_account,
        CASE
          WHEN t.receiver_id = $1 THEN 'credit'
          ELSE 'debit'
        END AS direction
       FROM transactions t
       LEFT JOIN users s ON t.sender_id = s.id
       LEFT JOIN users r ON t.receiver_id = r.id
       WHERE t.sender_id = $1 OR t.receiver_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM transactions WHERE sender_id = $1 OR receiver_id = $1',
      [userId]
    );

    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      transactions: result.rows.map(t => ({ ...t, amount: parseFloat(t.amount) })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      }
    });
  } catch (error) {
    console.error('Transactions error:', error);
    res.status(500).json({ success: false, message: 'Failed to get transactions.' });
  }
});

// POST /api/wallet/withdraw
router.post('/withdraw', auth, [
  body('amount').isFloat({ min: 1 }).withMessage('Minimum withdrawal is V 1.00'),
  body('bank_name').trim().notEmpty().withMessage('Bank name is required'),
  body('account_number').trim().notEmpty().withMessage('Account number is required'),
  body('account_name').trim().notEmpty().withMessage('Account name is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { amount, bank_name, account_number, account_name } = req.body;
  const withdrawAmount = parseFloat(amount);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT vouch_balance FROM users WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );

    const userBalance = parseFloat(userResult.rows[0].vouch_balance);
    if (userBalance < withdrawAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Insufficient Vouch balance.' });
    }

    // Deduct immediately (hold)
    await client.query(
      'UPDATE users SET vouch_balance = vouch_balance - $1, updated_at = NOW() WHERE id = $2',
      [withdrawAmount, req.user.id]
    );

    // Create withdrawal request
    const wResult = await client.query(
      `INSERT INTO withdrawal_requests (user_id, amount, bank_name, account_number, account_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [req.user.id, withdrawAmount, bank_name, account_number, account_name]
    );

    const txnRef = generateTxnRef();
    await client.query(
      `INSERT INTO transactions (transaction_ref, sender_id, amount, type, status, description)
       VALUES ($1, $2, $3, 'withdrawal', 'pending', $4)`,
      [txnRef, req.user.id, withdrawAmount, `Withdrawal to ${bank_name} - ${account_number}`]
    );

    await client.query('COMMIT');

    const updatedUser = await pool.query('SELECT vouch_balance FROM users WHERE id = $1', [req.user.id]);

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted. Funds will be processed within 24 hours.',
      withdrawal_id: wResult.rows[0].id,
      new_balance: parseFloat(updatedUser.rows[0].vouch_balance),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Withdraw error:', error);
    res.status(500).json({ success: false, message: 'Withdrawal request failed. Please try again.' });
  } finally {
    client.release();
  }
});

// GET /api/wallet/notifications
router.get('/notifications', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );

    const unreadCount = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({
      success: true,
      notifications: result.rows,
      unread_count: parseInt(unreadCount.rows[0].count),
    });
  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to get notifications.' });
  }
});

// PUT /api/wallet/notifications/read
router.put('/notifications/read', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark notifications.' });
  }
});

module.exports = router;
