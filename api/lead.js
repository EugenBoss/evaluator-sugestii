module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = req.body;

    // Payload — 17 fields, always same keys, blank if no data
    const payload = {
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      source: data.source || '',
      tier: data.tier || '',
      content_type: data.content_type || '',
      email_verified: data.email_verified || '',
      gdpr_consent: data.gdpr_consent || '',
      gdpr_timestamp: data.gdpr_timestamp || '',
      device: data.device || '',
      lang: data.lang || '',
      timestamp: data.timestamp || '',
      suggestion_text: data.suggestion_text || '',
      score: data.score !== undefined && data.score !== null ? String(data.score) : '',
      detected_type: data.detected_type || '',
      level: data.level || '',
      lead_type: data.lead_type || ''
    };

    const WEBHOOK_GHL = 'https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjcwNTZmMDYzMjA0MzI1MjY0NTUzNDUxMzYi_pc';

    // GSheet logging is now consolidated in api/evaluate.js
    const result = await fetch(WEBHOOK_GHL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => null);

    const ghlOk = result?.ok || false;

    return res.status(200).json({
      success: true,
      ghl: ghlOk ? 'ok' : 'failed'
    });

  } catch (err) {
    console.error('Lead webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
