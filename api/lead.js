export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = req.body;

    // Validate required fields
    if (!data.name || !data.email) {
      return res.status(400).json({ error: 'name and email are required' });
    }

    // Webhook URLs (Pabbly Connect)
    const WEBHOOK_GSHEET = 'https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjcwNTZmMDYzMjA0M2Q1MjZjNTUzMTUxMzAi_pc';
    const WEBHOOK_GHL = 'https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjcwNTZmMDYzMjA0MzI1MjY0NTUzNDUxMzYi_pc';

    // Payload (12 fields as documented)
    const payload = {
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      source: data.source || 'evaluator-sugestii',
      tier: data.tier || '',
      content_type: data.content_type || 'sugestie',
      email_verified: data.email_verified || 'da',
      gdpr_consent: data.gdpr_consent || 'da',
      gdpr_timestamp: data.gdpr_timestamp || new Date().toISOString(),
      device: data.device || '',
      lang: data.lang || 'ro',
      timestamp: data.timestamp || new Date().toISOString()
    };

    // Send to both webhooks in parallel (fire-and-forget style, but we wait)
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
