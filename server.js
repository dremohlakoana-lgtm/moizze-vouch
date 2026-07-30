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

// ─── Leads API
const leadsRoutes = require('./backend/routes/leads');
app.use('/api/leads', leadsRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Forex Proxy (avoids browser CORS issues) ────────────────────────────────
app.get('/api/forex', async (req, res) => {
  try {
    const https = require('https');
    const fetch = (url) => new Promise((resolve, reject) => {
      https.get(url, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const [fxData, btcData] = await Promise.allSettled([
      fetch('https://api.frankfurter.app/latest?from=ZAR&to=USD,EUR,GBP,CNY,AUD'),
      fetch('https://api.coinbase.com/v2/prices/BTC-ZAR/spot')
    ]);

    const rates = {};
    if (fxData.status === 'fulfilled') {
      for (const [currency, rate] of Object.entries(fxData.value.rates)) {
        rates[currency] = (1 / rate).toFixed(4);
      }
    }

    if (btcData.status === 'fulfilled') {
      rates['BTC'] = parseFloat(btcData.value.data.amount).toFixed(0);
    }

    res.json({ success: true, rates, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Forex unavailable' });
  }
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
