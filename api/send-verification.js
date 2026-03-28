// ============================================
// SEND/VERIFY CODE — /api/send-verification.js
// action=send: generates 6-digit code, sends via Resend
// action=verify: checks code against token
// ============================================

import crypto from 'crypto';

const SECRET_SUFFIX = '_eval_verify_2026';

function getSecret() {
  return (process.env.RESEND_API_KEY || '') + SECRET_SUFFIX;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  if (action === 'verify') return handleVerify(req, res);
  return handleSend(req, res);
}

// --- SEND CODE ---
async function handleSend(req, res) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: 'Email not configured' });

  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email invalid' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = Date.now() + 600000; // 10 min
  const secret = getSecret();

  // Create signed token
  const data = JSON.stringify({ code, email: email.trim().toLowerCase(), exp: expires });
  const token = Buffer.from(data).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(token).digest('hex');

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Puterea Mintii <noreply@verificare.putereamintii.ro>',
        to: [email.trim()],
        subject: 'Codul tău de confirmare — Evaluator Sugestii',
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:30px;background:#f8f9fa;border-radius:12px">
          <div style="text-align:center;margin-bottom:24px">
            <strong style="color:#F6D44C;font-size:12px;letter-spacing:3px">PUTEREA MINȚII</strong>
            <h2 style="color:#1a3040;margin:8px 0 0;font-size:22px">Codul tău de confirmare</h2>
          </div>
          <p style="color:#444;font-size:15px;line-height:1.6">Folosește codul de mai jos pentru a-ți activa contul:</p>
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
      return res.status(500).json({ error: 'Nu am putut trimite emailul.' });
    }

    return res.status(200).json({ ok: true, token, hmac });
  } catch (err) {
    console.error('Send error:', err);
    return res.status(500).json({ error: 'Eroare la trimiterea emailului' });
  }
}

// --- VERIFY CODE ---
async function handleVerify(req, res) {
  const { token, hmac, code } = req.body || {};

  if (!token || !hmac || !code) {
    return res.status(400).json({ error: 'Missing params' });
  }

  // Verify HMAC
  const secret = getSecret();
  const expectedHmac = crypto.createHmac('sha256', secret).update(token).digest('hex');
  if (hmac !== expectedHmac) {
    return res.status(400).json({ error: 'Token invalid' });
  }

  // Decode and check
  let data;
  try {
    data = JSON.parse(Buffer.from(token, 'base64url').toString());
  } catch (e) {
    return res.status(400).json({ error: 'Token invalid' });
  }

  if (Date.now() > data.exp) {
    return res.status(400).json({ error: 'expired', message: 'Codul a expirat. Retrimite un cod nou.' });
  }

  if (data.code !== code.trim()) {
    return res.status(400).json({ error: 'wrong_code', message: 'Cod incorect.' });
  }

  return res.status(200).json({ ok: true, verified: true, email: data.email });
}
