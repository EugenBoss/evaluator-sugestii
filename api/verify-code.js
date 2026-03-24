import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, code, hmac, expires } = req.body;
  if (!email || !code || !hmac || !expires) {
    return res.status(400).json({ verified: false, error: 'Missing fields' });
  }
  if (Date.now() > expires) {
    return res.status(400).json({ verified: false, error: 'expired' });
  }

  const secret = process.env.VERIFY_SECRET || 'eval-sugestii-default-2026';
  const payload = email.toLowerCase().trim() + ':' + code + ':' + expires;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  if (hmac === expected) {
    return res.status(200).json({ verified: true });
  }
  return res.status(400).json({ verified: false, error: 'invalid' });
}
