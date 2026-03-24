import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const secret = process.env.VERIFY_SECRET || 'eval-sugestii-default-2026';
  const expires = Date.now() + 600000;
  const payload = email.toLowerCase().trim() + ':' + code + ':' + expires;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Evaluator Sugestii <onboarding@resend.dev>',
        to: email,
        subject: 'Codul tău de verificare — Evaluator Sugestii Hipnotice',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f1f28;color:#e8edf0;border-radius:12px"><div style="text-align:center;margin-bottom:24px"><div style="font-size:24px;font-weight:700;color:#4FC1E9">Evaluator Sugestii</div><div style="font-size:12px;color:#8fa3b0;text-transform:uppercase;letter-spacing:2px">Puterea Minții</div></div><p>Salut${name ? ' ' + name : ''},</p><p>Codul tău de verificare este:</p><div style="text-align:center;margin:24px 0"><div style="display:inline-block;padding:16px 40px;background:#162a36;border:2px solid #4FC1E9;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:8px;color:#4FC1E9">${code}</div></div><p style="color:#8fa3b0;font-size:14px">Codul expiră în 10 minute.</p><hr style="border:none;border-top:1px solid #1e3f52;margin:24px 0"><p style="font-size:12px;color:#5a7585;text-align:center">Evaluator Sugestii Hipnotice — Puterea Minții</p></div>`
      })
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('[RESEND ERROR]', r.status, err);
      return res.status(500).json({ error: 'Email send failed' });
    }
  } catch (e) {
    console.error('[SEND CODE ERROR]', e);
    return res.status(500).json({ error: 'Email send failed' });
  }

  return res.status(200).json({ hmac, expires });
}
