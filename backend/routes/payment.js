const express = require('express');
const router = express.Router();
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const auth = require('../middleware/auth');

function generateTxnRef() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let random = '';
  for (let i = 0; i < 6; i++) random += chars.charAt(Math.floor(Math.random() * chars.length));
  return `TXN${Date.now()}${random}`;
}

// POST /api/payment/initiate
router.post('/initiate', auth, [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum deposit is ₦100'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  try {
    const { amount } = req.body;
    const amountInKobo = Math.round(parseFloat(amount) * 100); // Paystack uses kobo
    const reference = generateTxnRef();

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: req.user.email,
        amount: amountInKobo,
        reference,
        metadata: {
          user_id: req.user.id,
          full_name: req.user.full_name,
          vouch_amount: parseFloat(amount) * (parseFloat(process.env.VOUCH_RATE) || 1),
        },
        callback_url: `${req.protocol}://${req.get('host')}/deposit.html?verify=true`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = response.data.data;

    // Store pending transaction
    await pool.query(
      `INSERT INTO transactions (transaction_ref, receiver_id, amount, type, status, description)
       VALUES ($1, $2, $3, 'deposit', 'pending', $4)`,
      [reference, req.user.id, parseFloat(amount) * (parseFloat(process.env.VOUCH_RATE) || 1), `Vouch purchase via Paystack`]
    );

    res.json({
      success: true,
      payment_url: data.authorization_url,
      reference: data.reference,
      access_code: data.access_code,
    });
  } catch (error) {
    console.error('Payment initiate error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Failed to initialize payment. Please try again.' });
  }
});

// GET /api/payment/verify/:reference
router.get('/verify/:reference', auth, async (req, res) => {
  try {
    const { reference } = req.params;

    // Check if already processed
    const existingTxn = await pool.query(
      'SELECT * FROM transactions WHERE transaction_ref = $1 AND receiver_id = $2',
      [reference, req.user.id]
    );

    if (existingTxn.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    if (existingTxn.rows[0].status === 'completed') {
      return res.json({
        success: true,
        message: 'Payment already processed.',
        amount: parseFloat(existingTxn.rows[0].amount),
        already_credited: true,
      });
    }

    // Verify with Paystack
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = response.data.data;

    if (data.status !== 'success') {
      await pool.query(
        'UPDATE transactions SET status = $1 WHERE transaction_ref = $2',
        ['failed', reference]
      );
      return res.status(400).json({ success: false, message: 'Payment was not successful.' });
    }

    const vouchRate = parseFloat(process.env.VOUCH_RATE) || 1;
    const nairaAmount = data.amount / 100; // Convert from kobo
    const vouchAmount = nairaAmount * vouchRate;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Credit user with Vouch
      await client.query(
        'UPDATE users SET vouch_balance = vouch_balance + $1, updated_at = NOW() WHERE id = $2',
        [vouchAmount, req.user.id]
      );

      // Mark transaction complete
      await client.query(
        'UPDATE transactions SET status = $1, amount = $2 WHERE transaction_ref = $3',
        ['completed', vouchAmount, reference]
      );

      // Create notification
      await client.query(
        'INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)',
        [
          req.user.id,
          'Vouch Purchased',
          `V ${vouchAmount.toFixed(2)} has been added to your wallet. Ref: ${reference}`,
          'credit'
        ]
      );

      await client.query('COMMIT');

      const updatedUser = await pool.query('SELECT vouch_balance FROM users WHERE id = $1', [req.user.id]);

      res.json({
        success: true,
        message: `V ${vouchAmount.toFixed(2)} added to your wallet!`,
        vouch_amount: vouchAmount,
        new_balance: parseFloat(updatedUser.rows[0].vouch_balance),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Payment verify error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Payment verification failed. Please contact support.' });
  }
});

module.exports = router;
