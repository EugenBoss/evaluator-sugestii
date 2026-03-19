export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, email, phone } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Split name into first + last
    const parts = name.trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    // Submit to GHL form
    const formData = new URLSearchParams();
    formData.append('formId', 'H6w4fktJXDl7D50eBiBx');
    formData.append('location_id', ''); // GHL fills this from formId
    formData.append('first_name', firstName);
    formData.append('last_name', lastName);
    formData.append('full_name', name);
    formData.append('email', email);
    formData.append('phone', phone);
    formData.append('source', 'Evaluator Sugestii Hipnotice');

    const response = await fetch('https://services.leadconnectorhq.com/funnels/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    // Also try the backend endpoint if the first one doesn't work
    if (!response.ok) {
      const response2 = await fetch('https://backend.leadconnectorhq.com/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });
      const data2 = await response2.json().catch(() => ({}));
      return res.status(200).json({ ok: true, fallback: true });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Lead error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}
