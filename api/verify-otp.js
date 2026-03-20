// Access shared OTP store
const otpStore = globalThis.__otpStore || (globalThis.__otpStore = new Map());

// Origin check
const ALLOWED_ORIGINS = ['https://evaluator-sugestii.vercel.app', 'https://putereamintii.ro', 'http://localhost:3000'];
function isOriginAllowed(req) {
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  if (!origin && !referer) return true;
  const check = origin || referer;
  if (ALLOWED_ORIGINS.some(o => check.startsWith(o))) return true;
  if (/^https:\/\/evaluator-sugestii[a-z0-9-]*\.vercel\.app/.test(check)) return true;
  if (check.includes('eugenboss-projects.vercel.app')) return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isOriginAllowed(req)) return res.status(403).json({ error: 'Forbidden' });

  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Email și codul sunt obligatorii' });

  const key = email.trim().toLowerCase();
  const record = otpStore.get(key);

  if (!record) return res.status(400).json({ error: 'Codul a expirat sau emailul nu e corect. Trimite un cod nou.' });
  if (Date.now() > record.expires) { otpStore.delete(key); return res.status(400).json({ error: 'Codul a expirat. Trimite un cod nou.' }); }
  if (record.attempts >= 5) { otpStore.delete(key); return res.status(429).json({ error: 'Prea multe încercări greșite. Trimite un cod nou.' }); }
  if (record.code !== code.trim()) { record.attempts++; return res.status(400).json({ error: 'Cod incorect. Mai ai ' + (5 - record.attempts) + ' încercări.' }); }

  // Code correct — send verified lead to Pabbly
  otpStore.delete(key);

  const webhookUrl = process.env.GHL_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: record.name,
          email: record.email,
          phone: record.phone,
          source: 'Evaluator Sugestii Hipnotice',
          verified: true,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.error('Webhook error:', e);
    }
  }

  return res.status(200).json({ ok: true, verified: true });
}
