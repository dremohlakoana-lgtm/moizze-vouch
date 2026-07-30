require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json());

// ─── Serve Static Frontend ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'frontend')));

// ─── Serve World Reports ──────────────────────────────────────────────────────
app.use('/world', express.static(path.join(__dirname, 'world')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Fallback ─────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ─── Keep-Alive Self Ping ─────────────────────────────────────────────────────
function startKeepAlive() {
  const appUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(() => {
    try {
      const http = appUrl.startsWith('https') ? require('https') : require('http');
      http.get(`${appUrl}/api/health`, (res) => { res.resume(); }).on('error', () => {});
    } catch (e) {}
  }, 14 * 60 * 1000);
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌍 Moizze World running on port ${PORT}\n`);
  startKeepAlive();
});

module.exports = app;
