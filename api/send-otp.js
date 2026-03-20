// Shared OTP store (global so verify-otp.js can access on same instance)
const otpStore = globalThis.__otpStore || (globalThis.__otpStore = new Map());

// Rate limit
const rateMap = new Map();
function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}
function isRateLimited(ip) {
  const now = Date.now();
  const r = rateMap.get(ip);
  if (!r || now - r.start > 300000) { rateMap.set(ip, { start: now, count: 1 }); return false; }
  r.count++;
  return r.count > 3; // max 3 OTPs per 5 min
}

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

  const ip = getIP(req);
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Prea multe încercări. Așteaptă câteva minute.' });

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: 'Email service not configured' });

  const { name, email, phone, website } = req.body || {};

  // Honeypot
  if (website) return res.status(200).json({ ok: true });

  // Validate
  if (!name || typeof name !== 'string' || name.length < 2 || name.length > 100)
    return res.status(400).json({ error: 'Completează numele' });
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Email invalid' });
  if (!phone || typeof phone !== 'string' || phone.replace(/\D/g, '').length < 8)
    return res.status(400).json({ error: 'Telefon invalid' });

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const key = email.trim().toLowerCase();

  // Store (expires 10 min)
  otpStore.set(key, {
    code, name: name.trim(), email: key, phone: phone.trim(),
    expires: Date.now() + 600000, attempts: 0,
  });

  // Cleanup old entries
  for (const [k, v] of otpStore) { if (Date.now() > v.expires) otpStore.delete(k); }

  // Send via Resend
  try {
    const firstName = name.trim().split(' ')[0];
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'Puterea Mintii <onboarding@resend.dev>',
        to: [email.trim()],
        subject: 'Codul tău de verificare — Evaluator Sugestii',
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:30px;background:#f8f9fa;border-radius:12px">
          <div style="text-align:center;margin-bottom:24px">
            <strong style="color:#F6D44C;font-size:12px;letter-spacing:3px">PUTEREA MINȚII</strong>
            <h2 style="color:#1a3040;margin:8px 0 0;font-size:22px">Codul tău de verificare</h2>
          </div>
          <p style="color:#444;font-size:15px;line-height:1.6">Salut ${firstName},</p>
          <p style="color:#444;font-size:15px;line-height:1.6">Folosește codul de mai jos pentru a activa evaluarea avansată:</p>
          <div style="text-align:center;margin:24px 0">
            <div style="display:inline-block;padding:16px 40px;background:#1a3040;border-radius:12px;font-family:monospace;font-size:32px;font-weight:bold;color:#4FC1E9;letter-spacing:8px">${code}</div>
          </div>
          <p style="color:#888;font-size:13px;text-align:center">Codul expiră în 10 minute.</p>
          <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0">
          <p style="color:#aaa;font-size:11px;text-align:center">Evaluator Sugestii Hipnotice — <a href="https://putereamintii.ro" style="color:#4FC1E9">putereamintii.ro</a></p>
        </div>`,
      }),
    });

    if (!emailRes.ok) {
      const errData = await emailRes.json().catch(() => ({}));
      console.error('Resend error:', errData);
      return res.status(500).json({ error: 'Nu am putut trimite emailul. Verifică adresa.' });
    }

    return res.status(200).json({ ok: true, message: 'Cod trimis pe email' });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ error: 'Eroare la trimiterea emailului' });
  }
}
