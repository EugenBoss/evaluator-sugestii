import crypto from 'crypto';

// Origin check
function isOriginAllowed(req) {
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  if (!origin && !referer) return true;
  const check = origin || referer;
  if (/^https:\/\/evaluator-sugestii[a-z0-9-]*\.vercel\.app/.test(check)) return true;
  if (check.includes('eugenboss-projects.vercel.app')) return true;
  if (check.startsWith('https://putereamintii.ro')) return true;
  if (check.startsWith('http://localhost:3000')) return true;
  return false;
}

// Verify token signature
function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isOriginAllowed(req)) return res.status(403).json({ error: 'Forbidden' });

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: 'Service not configured' });

  const { token, code } = req.body || {};
  if (!token || !code) return res.status(400).json({ error: 'Token și codul sunt obligatorii' });

  // Verify token
  const secret = resendKey + '_otp_secret';
  const data = verifyToken(token, secret);

  if (!data) return res.status(400).json({ error: 'Token invalid. Trimite un cod nou.' });
  if (Date.now() > data.exp) return res.status(400).json({ error: 'Codul a expirat. Trimite un cod nou.' });
  if (data.code !== code.trim()) return res.status(400).json({ error: 'Cod incorect. Verifică și încearcă din nou.' });

  // Code correct — send verified lead to Pabbly
  const webhookUrl = process.env.GHL_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'lead',
          name: data.name,
          email: data.email,
          phone: data.phone,
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
