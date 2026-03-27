// ============================================
// contact.js — Vercel Serverless Function
// Contact Form — trimite email direct via Resend
// ============================================

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, phone, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Câmpuri obligatorii lipsă' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  // Build email HTML
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:#0f1f28;border-radius:12px;padding:24px;color:#e8edf0">
        <h2 style="color:#4FC1E9;margin:0 0 20px">Mesaj nou — Evaluator Sugestii</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 12px;color:#8fa3b0;font-size:14px;width:100px">Nume:</td><td style="padding:8px 12px;color:#e8edf0;font-size:14px;font-weight:600">${escapeHtml(name)}</td></tr>
          <tr><td style="padding:8px 12px;color:#8fa3b0;font-size:14px">Email:</td><td style="padding:8px 12px"><a href="mailto:${escapeHtml(email)}" style="color:#4FC1E9;text-decoration:none">${escapeHtml(email)}</a></td></tr>
          ${phone ? `<tr><td style="padding:8px 12px;color:#8fa3b0;font-size:14px">Telefon:</td><td style="padding:8px 12px;color:#e8edf0;font-size:14px">${escapeHtml(phone)}</td></tr>` : ''}
          <tr><td style="padding:8px 12px;color:#8fa3b0;font-size:14px">Subiect:</td><td style="padding:8px 12px;color:#F6D44C;font-size:14px;font-weight:600">${escapeHtml(subject)}</td></tr>
        </table>
        <div style="margin-top:16px;padding:16px;background:#1a2e38;border-radius:8px;border-left:3px solid #4FC1E9">
          <div style="color:#8fa3b0;font-size:12px;margin-bottom:8px">MESAJ:</div>
          <div style="color:#e8edf0;font-size:14px;line-height:1.7;white-space:pre-wrap">${escapeHtml(message)}</div>
        </div>
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid #2a4a5a;font-size:12px;color:#5a7585">
          Trimis de pe evaluator.putereamintii.ro · ${new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' })}
        </div>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Evaluator Sugestii <noreply@verificare.putereamintii.ro>',
        to: ['contact@putereamintii.ro'],
        reply_to: email,
        subject: `[Contact Evaluator] ${subject}`,
        html: htmlBody
      })
    });

    if (!response.ok) {
      const errData = await response.text();
      console.error('Resend error:', response.status, errData);
      return res.status(500).json({ error: 'Email send failed' });
    }

    // Also log to GHL (non-blocking)
    try {
      fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, phone: phone || '',
          source: 'evaluator-sugestii',
          tier: 'contact',
          content_type: 'contact',
          lead_type: 'contact_form',
          timestamp: new Date().toISOString(),
          suggestion_text: `[SUBIECT] ${subject} [MESAJ] ${message.substring(0, 2000)}`
        })
      }).catch(() => {});
    } catch (e) {}

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Contact form error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
