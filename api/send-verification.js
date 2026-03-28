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
  if (action === 'send-reset') return handleSendReset(req, res);
  if (action === 'reset-password') return handleResetPassword(req, res);
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

// --- SEND RESET CODE ---
async function handleSendReset(req, res) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: 'Email not configured' });

  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email invalid' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = Date.now() + 600000;
  const secret = getSecret();

  const data = JSON.stringify({ code, email: email.trim().toLowerCase(), exp: expires, type: 'reset' });
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
        subject: 'Resetare parolă — Evaluator Sugestii',
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:30px;background:#f8f9fa;border-radius:12px">
          <div style="text-align:center;margin-bottom:24px">
            <strong style="color:#F6D44C;font-size:12px;letter-spacing:3px">PUTEREA MINȚII</strong>
            <h2 style="color:#1a3040;margin:8px 0 0;font-size:22px">Resetare parolă</h2>
          </div>
          <p style="color:#444;font-size:15px;line-height:1.6">Ai cerut resetarea parolei. Folosește codul de mai jos:</p>
          <div style="text-align:center;margin:24px 0">
            <div style="display:inline-block;padding:16px 40px;background:#1a3040;border-radius:12px;font-family:monospace;font-size:32px;font-weight:bold;color:#4FC1E9;letter-spacing:8px">${code}</div>
          </div>
          <p style="color:#888;font-size:13px;text-align:center">Codul expiră în 10 minute. Dacă nu ai cerut resetarea, ignoră acest email.</p>
          <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0">
          <p style="color:#aaa;font-size:11px;text-align:center">Evaluator Sugestii Hipnotice — <a href="https://putereamintii.ro" style="color:#4FC1E9">putereamintii.ro</a></p>
        </div>`,
      }),
    });

    if (!emailRes.ok) {
      return res.status(500).json({ error: 'Nu am putut trimite emailul.' });
    }

    return res.status(200).json({ ok: true, token, hmac });
  } catch (err) {
    return res.status(500).json({ error: 'Eroare la trimiterea emailului' });
  }
}

// --- RESET PASSWORD (after code verified) ---
async function handleResetPassword(req, res) {
  const { token, hmac, code, newPassword } = req.body || {};

  if (!token || !hmac || !code || !newPassword) {
    return res.status(400).json({ error: 'Missing params' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Parola trebuie să aibă minim 6 caractere.' });
  }

  // Verify HMAC
  const secret = getSecret();
  const expectedHmac = crypto.createHmac('sha256', secret).update(token).digest('hex');
  if (hmac !== expectedHmac) {
    return res.status(400).json({ error: 'Token invalid' });
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(token, 'base64url').toString());
  } catch (e) {
    return res.status(400).json({ error: 'Token invalid' });
  }

  if (Date.now() > data.exp) {
    return res.status(400).json({ error: 'expired' });
  }
  if (data.code !== code.trim()) {
    return res.status(400).json({ error: 'wrong_code' });
  }

  // Update password via Supabase Admin API
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server config error' });
  }

  try {
    // Find user by email
    const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
      },
    });
    // Actually, use the filter endpoint
    const usersRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
      },
    });
    const usersData = await usersRes.json();
    const users = usersData.users || usersData || [];
    const user = users.find(u => u.email === data.email.toLowerCase());

    if (!user) {
      return res.status(400).json({ error: 'Contul nu a fost găsit.' });
    }

    // Update password
    const updateRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: newPassword }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      console.error('Password update error:', err);
      return res.status(500).json({ error: 'Nu am putut reseta parola.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Eroare server.' });
  }
}
