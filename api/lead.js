export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = req.body;

    // Payload — 16 fields, always same keys, blank if no data
    const payload = {
      // Personal (from gate form)
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
      // Evaluation (filled after eval, blank if user left before)
      suggestion_text: data.suggestion_text || '',
      score: data.score !== undefined && data.score !== null ? String(data.score) : '',
      detected_type: data.detected_type || '',
      level: data.level || ''
    };

    // Webhook URLs (Pabbly Connect)
    const WEBHOOK_GSHEET = 'https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjcwNTZmMDYzMjA0M2Q1MjZjNTUzMTUxMzAi_pc';
    const WEBHOOK_GHL = 'https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjcwNTZmMDYzMjA0MzI1MjY0NTUzNDUxMzYi_pc';

    const results = await Promise.allSettled([
      fetch(WEBHOOK_GSHEET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      fetch(WEBHOOK_GHL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    ]);

    const gsheetOk = results[0].status === 'fulfilled' && results[0].value?.ok;
    const ghlOk = results[1].status === 'fulfilled' && results[1].value?.ok;

    return res.status(200).json({
      success: true,
      gsheet: gsheetOk ? 'ok' : 'failed',
      ghl: ghlOk ? 'ok' : 'failed'
    });

  } catch (err) {
    console.error('Lead webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
