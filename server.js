require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Trust Proxy (required for Render) ───────────────────────────────────────
app.set('trust proxy', 1);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, message: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);

// ─── Serve Static Frontend ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'frontend')));

// ─── API Routes ───────────────────────────────────────────────────────────────
const authRoutes = require('./backend/routes/auth');
const walletRoutes = require('./backend/routes/wallet');
const paymentRoutes = require('./backend/routes/payment');
const adminRoutes = require('./backend/routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// ─── Keep-Alive Self Ping (fights Render free tier spin-down) ───────────────
function startKeepAlive() {
  const appUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  // Ping every 14 minutes (Render spins down after 15 min of inactivity)
  setInterval(async () => {
    try {
      const https = appUrl.startsWith('https') ? require('https') : require('http');
      https.get(`${appUrl}/api/health`, (res) => {
        // consume response
        res.resume();
      }).on('error', () => {}); // silently ignore errors
    } catch (e) {}
  }, 14 * 60 * 1000);
  console.log(`🔄 Keep-alive ping every 14 min → ${appUrl}/api/health`);
}

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏦 Moizze Vouch Banking Server`);
  console.log(`✅ Running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 http://localhost:${PORT}\n`);
  startKeepAlive();
});

module.exports = app;
