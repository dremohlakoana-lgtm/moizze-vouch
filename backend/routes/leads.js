const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const https = require('https');

const LEAD_PRICE_ZAR = 150; // R150 per lead
const REPORT_PATH = path.join(__dirname, '../../world/report-latest.json');
const SOLD_PATH = path.join(__dirname, '../../world/sold-leads.json');

function getReport() {
  try { return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')); } catch { return null; }
}

function getSold() {
  try { return JSON.parse(fs.readFileSync(SOLD_PATH, 'utf8')); } catch { return {}; }
}

function saveSold(data) {
  fs.writeFileSync(SOLD_PATH, JSON.stringify(data, null, 2));
}

function generateRef() {
  return 'MZZ-LEAD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

// Paystack fetch helper (no axios needed)
function paystackRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.paystack.co',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// GET /api/leads — list all leads (teased, no source/contact)
router.get('/', (req, res) => {
  const report = getReport();
  if (!report || !report.scout || !report.scout.data) {
    return res.json({ success: true, leads: [], week: null });
  }

  const sold = getSold();

  const leads = report.scout.data.map((lead, i) => {
    const id = `lead-${i}`;
    const isSold = sold[id] && sold[id].paid;
    return {
      id,
      rank: lead.rank || i + 1,
      sector: lead.sector || 'Business',
      location: lead.location || 'South Africa',
      digital_need: lead.digital_need || '',
      price_zar: LEAD_PRICE_ZAR,
      // Hide name and source until purchased
      name: isSold ? lead.name : null,
      source: isSold ? lead.source : null,
      is_sold: isSold,
      week: report.generated_at,
    };
  });

  res.json({ success: true, leads, week: report.generated_at });
});

// POST /api/leads/buy — initiate payment for a lead
router.post('/buy', async (req, res) => {
  const { lead_id, email } = req.body;
  if (!lead_id || !email) {
    return res.status(400).json({ success: false, message: 'lead_id and email are required.' });
  }

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(503).json({ success: false, message: 'Payment not configured yet. Contact admin.' });
  }

  const report = getReport();
  if (!report || !report.scout) {
    return res.status(404).json({ success: false, message: 'No leads available.' });
  }

  const index = parseInt(lead_id.replace('lead-', ''));
  const lead = report.scout.data[index];
  if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

  const ref = generateRef();
  const host = req.get('host');
  const protocol = req.protocol;

  try {
    const response = await paystackRequest('POST', '/transaction/initialize', {
      email,
      amount: LEAD_PRICE_ZAR * 100, // kobo
      reference: ref,
      currency: 'ZAR',
      metadata: { lead_id, lead_name: lead.name, buyer_email: email },
      callback_url: `${protocol}://${host}/leads.html?verify=${ref}&lead=${lead_id}`,
    });

    if (!response.data) throw new Error('Paystack error');

    // Track pending purchase
    const sold = getSold();
    sold[lead_id] = sold[lead_id] || {};
    sold[`pending-${ref}`] = { lead_id, email, ref, paid: false, created: new Date().toISOString() };
    saveSold(sold);

    res.json({ success: true, payment_url: response.data.authorization_url, reference: ref });
  } catch (e) {
    console.error('Lead buy error:', e.message);
    res.status(500).json({ success: false, message: 'Payment init failed. Try again.' });
  }
});

// GET /api/leads/verify/:ref — verify payment, reveal lead
router.get('/verify/:ref', async (req, res) => {
  const { ref } = req.params;
  const { email } = req.query;

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(503).json({ success: false, message: 'Payment not configured.' });
  }

  try {
    const response = await paystackRequest('GET', `/transaction/verify/${ref}`);
    const data = response.data;

    if (!data || data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not successful.' });
    }

    const lead_id = data.metadata?.lead_id;
    const report = getReport();
    const index = parseInt(lead_id?.replace('lead-', '') || '-1');
    const lead = report?.scout?.data?.[index];

    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    // Mark as sold
    const sold = getSold();
    sold[lead_id] = { paid: true, buyer: data.metadata?.buyer_email || email, paid_at: new Date().toISOString(), ref };
    saveSold(sold);

    res.json({
      success: true,
      message: 'Payment confirmed! Here is your lead.',
      lead: {
        name: lead.name,
        sector: lead.sector,
        location: lead.location,
        digital_need: lead.digital_need,
        source: lead.source,
        contact_hint: `Search "${lead.name} South Africa" on LinkedIn or Google to find decision makers.`,
      }
    });
  } catch (e) {
    console.error('Lead verify error:', e.message);
    res.status(500).json({ success: false, message: 'Verification failed.' });
  }
});

module.exports = router;
