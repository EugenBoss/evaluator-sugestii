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

  const { name, email, phone, source, tier, timestamp } = req.body;

  console.log('[LEAD]', JSON.stringify({ name, email, phone, source, tier, timestamp }));

  // --- WEBHOOK GHL ---
  // Decomentează și pune URL-ul webhook-ului din GoHighLevel:
  //
  // try {
  //   await fetch('https://services.leadconnectorhq.com/hooks/XXXXXXX', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({
  //       firstName: name,
  //       email: email,
  //       phone: phone,
  //       source: source || 'evaluator-sugestii',
  //       tags: ['evaluator-sugestii', tier || 'avansat']
  //     })
  //   });
  // } catch (e) {
  //   console.error('[LEAD WEBHOOK ERROR]', e);
  // }

  return res.status(200).json({ ok: true });
}
