// --- Protection: Daily Budget ---
let dailyCount = 0;
let dailyReset = Date.now();
const DAILY_LIMIT = 100;

function checkDailyBudget() {
  const now = Date.now();
  // Reset at midnight or after 24h
  if (now - dailyReset > 86400000) {
    dailyCount = 0;
    dailyReset = now;
  }
  if (dailyCount >= DAILY_LIMIT) return false;
  dailyCount++;
  return true;
}

// --- Protection: Cooloff (60s between requests per IP) + Session Cap (5 total per IP) ---
const ipMap = new Map();
const COOLOFF = 60000;    // 60 seconds between requests
const SESSION_CAP = 5;    // max 5 evaluations per IP

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

function checkIPLimits(ip) {
  const now = Date.now();
  const record = ipMap.get(ip);

  if (!record) {
    ipMap.set(ip, { last: now, count: 1 });
    return { ok: true };
  }

  // Session cap
  if (record.count >= SESSION_CAP) {
    return { ok: false, error: 'Ai atins limita de ' + SESSION_CAP + ' evaluări. Revino mai târziu.' };
  }

  // Cooloff
  const elapsed = now - record.last;
  if (elapsed < COOLOFF) {
    const wait = Math.ceil((COOLOFF - elapsed) / 1000);
    return { ok: false, error: 'Așteaptă ' + wait + ' secunde înainte de următoarea evaluare.' };
  }

  record.last = now;
  record.count++;
  return { ok: true };
}

// --- Protection: Allowed Origins ---
const ALLOWED_ORIGINS = [
  'https://evaluator-sugestii.vercel.app',
  'https://putereamintii.ro',
  'http://localhost:3000',
];

function isOriginAllowed(req) {
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  if (!origin && !referer) return true;
  const check = origin || referer;
  if (ALLOWED_ORIGINS.some(o => check.startsWith(o))) return true;
  // Match all Vercel preview deployments for this project
  if (/^https:\/\/evaluator-sugestii[a-z0-9-]*\.vercel\.app/.test(check)) return true;
  if (check.includes('eugenboss-projects.vercel.app')) return true;
  return false;
}

// --- Cleanup old IPs every 10 minutes ---
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipMap) {
    if (now - record.last > 3600000) ipMap.delete(ip);
  }
}, 600000);

// --- Handler ---
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Origin check
  if (!isOriginAllowed(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Daily budget
  if (!checkDailyBudget()) {
    return res.status(429).json({ error: 'Limita zilnică de evaluări a fost atinsă. Revino mâine.' });
  }

  // IP cooloff + session cap
  const ip = getIP(req);
  const ipCheck = checkIPLimits(ip);
  if (!ipCheck.ok) {
    return res.status(429).json({ error: ipCheck.error });
  }

  // API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Body validation
  const { system, messages } = req.body || {};
  if (!system || !messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

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
        max_tokens: 3000,
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
