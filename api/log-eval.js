// Origin check
function isOriginAllowed(req) {
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  if (!origin && !referer) return true;
  const check = origin || referer;
  if (/^https:\/\/evaluator-sugestii[a-z0-9-]*\.vercel\.app/.test(check)) return true;
  if (check.includes('eugenboss-projects.vercel.app')) return true;
  if (check.startsWith('https://putereamintii.ro') || check.startsWith('https://evaluator.putereamintii.ro')) return true;
  if (check.startsWith('http://localhost:3000')) return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isOriginAllowed(req)) return res.status(403).json({ error: 'Forbidden' });

  const webhookUrl = process.env.DATA_WEBHOOK_URL;
  if (!webhookUrl) return res.status(200).json({ ok: true }); // silently skip if not configured

  const { name, email, phone, text, score, score_max, tier, tip_detectat, criterii, timestamp } = req.body || {};

  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' });

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name || '',
        email: email || '',
        phone: phone || '',
        text: text.substring(0, 1000),
        score: score || 0,
        score_max: score_max || 100,
        tier: tier || 'basic',
        tip_detectat: tip_detectat || '',
        criterii: criterii || '',
        timestamp: timestamp || new Date().toISOString(),
        source: 'Evaluator Sugestii Hipnotice',
      }),
    });
  } catch (e) {
    console.error('Data webhook error:', e);
  }

  return res.status(200).json({ ok: true });
}
