// ============================================
// contact.js — Vercel Serverless Function
// Contact form → Email via Resend
// Evaluator Sugestii Hipnotice — Puterea Minții
// ============================================

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, phone, subject, message } = req.body || {};

  // Validation
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Numele este obligatoriu.' });
  }
  if (!email || !email.trim() || !email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'Email-ul este invalid.' });
  }
  if (!subject || !subject.trim()) {
    return res.status(400).json({ error: 'Subiectul este obligatoriu.' });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mesajul este obligatoriu.' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM || 'Evaluator Sugestii <noreply@verificare.putereamintii.ro>';

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'Email service not configured.' });
  }

  // Build HTML email
  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0c1820;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 24px">
  <div style="background:#162a36;border:1px solid #1e3f52;border-radius:12px;padding:28px;margin-bottom:16px">
    <div style="font-size:11px;color:#4FC1E9;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px">Contact Evaluator Sugestii</div>
    <h1 style="color:#f0f4f6;font-size:20px;margin:0 0 20px">${escapeHtml(subject.trim())}</h1>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#8fa3b0;font-size:13px;width:90px;vertical-align:top">Nume:</td><td style="padding:8px 0;color:#e8edf0;font-size:14px">${escapeHtml(name.trim())}</td></tr>
      <tr><td style="padding:8px 0;color:#8fa3b0;font-size:13px;vertical-align:top">Email:</td><td style="padding:8px 0;color:#4FC1E9;font-size:14px"><a href="mailto:${escapeHtml(email.trim())}" style="color:#4FC1E9;text-decoration:none">${escapeHtml(email.trim())}</a></td></tr>
      ${phone && phone.trim() ? `<tr><td style="padding:8px 0;color:#8fa3b0;font-size:13px;vertical-align:top">Telefon:</td><td style="padding:8px 0;color:#e8edf0;font-size:14px">${escapeHtml(phone.trim())}</td></tr>` : ''}
    </table>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #1e3f52">
      <div style="color:#8fa3b0;font-size:12px;margin-bottom:8px">MESAJ:</div>
      <div style="color:#e8edf0;font-size:14px;line-height:1.7;white-space:pre-wrap">${escapeHtml(message.trim())}</div>
    </div>
  </div>
  <div style="text-align:center;color:#5a7585;font-size:11px;padding:8px 0">
    Trimis din Evaluator Sugestii — evaluator.putereamintii.ro
  </div>
</div>
</body>
</html>`;

  try {
    // Send email via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: ['contact@putereamintii.ro'],
        reply_to: email.trim(),
        subject: `[Contact Evaluator] ${subject.trim()}`,
        html: htmlBody
      })
    });

    if (!resendResponse.ok) {
      const errData = await resendResponse.json().catch(() => ({}));
      console.error('Resend error:', errData);
      return res.status(500).json({ error: 'Email send failed.' });
    }

    // Backup log to /api/lead (non-blocking)
    try {
      const leadUrl = new URL('/api/lead', `https://${req.headers.host || 'evaluator-sugestii.vercel.app'}`).toString();
      fetch(leadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone ? phone.trim() : '',
          source: 'contact_form',
          subject: subject.trim(),
          message: message.trim().substring(0, 500)
        })
      }).catch(() => {}); // Fire-and-forget
    } catch (_) {}

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Contact form error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
