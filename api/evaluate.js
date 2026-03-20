// --- Rate Limiter (per Vercel instance, resets on cold start) ---
const rateMap = new Map();
const RATE_LIMIT = 5;      // max requests
const RATE_WINDOW = 60000;  // per 60 seconds

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
  // Allow if no origin (server-to-server, curl for testing)
  if (!origin && !referer) return true;
  return ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o));
}

// --- Handler ---
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Method check
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Origin check
  if (!isOriginAllowed(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Rate limit
  const ip = getIP(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Prea multe cereri. Așteaptă un minut.' });
  }

  // API key check
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Body validation
  const { system, messages } = req.body || {};
  if (!system || !messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // Validate message content length (prevent huge payloads)
  const totalLength = JSON.stringify(messages).length + system.length;
  if (totalLength > 10000) {
    return res.status(400).json({ error: 'Request too large' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system,
        messages,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
}
