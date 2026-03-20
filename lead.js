// --- Rate Limiter ---
const rateMap = new Map();
const RATE_LIMIT = 3;       // max 3 submissions per window
const RATE_WINDOW = 300000;  // per 5 minutes

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateMap.get(ip);
  if (!record || now - record.start > RATE_WINDOW) {
    rateMap.set(ip, { start: now, count: 1 });
    return false;
  }
  record.count++;
  if (record.count > RATE_LIMIT) return true;
  return false;
}

// --- Allowed Origins ---
const ALLOWED_ORIGINS = [
  'https://evaluator-sugestii.vercel.app',
  'https://evaluator-sugestii-eugenboss-projects.vercel.app',
  'https://putereamintii.ro',
  'http://localhost:3000',
];

function isOriginAllowed(req) {
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  if (!origin && !referer) return true;
  return ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o));
}

// --- Handler ---
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isOriginAllowed(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const ip = getIP(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Prea multe încercări. Așteaptă câteva minute.' });
  }

  const webhookUrl = process.env.GHL_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Body validation
  const { name, email, phone, website } = req.body || {};

  // Honeypot: if "website" field is filled, it's a bot
  if (website) {
    // Silently accept to not tip off the bot
    return res.status(200).json({ ok: true });
  }

  if (!name || typeof name !== 'string' || name.length < 2 || name.length > 100) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  if (!phone || typeof phone !== 'string' || phone.replace(/\D/g, '').length < 8 || phone.length > 20) {
    return res.status(400).json({ error: 'Invalid phone' });
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        source: 'Evaluator Sugestii Hipnotice',
        timestamp: new Date().toISOString(),
      }),
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Lead webhook error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}
