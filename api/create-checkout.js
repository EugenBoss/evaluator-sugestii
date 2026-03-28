// ============================================
// CREATE CHECKOUT — /api/create-checkout.js
// Creates Stripe Checkout session for Premium upgrade
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });

  const { plan, email, user_id, lang } = req.body || {};

  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!plan || !['monthly', 'annual'].includes(plan)) {
    return res.status(400).json({ error: 'Plan must be monthly or annual' });
  }

  const priceId = plan === 'monthly'
    ? process.env.STRIPE_PRICE_MONTHLY
    : process.env.STRIPE_PRICE_ANNUAL;

  if (!priceId) return res.status(500).json({ error: 'Price ID not configured' });

  const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://evaluator.putereamintii.ro';

  try {
    // Use Stripe API directly (no SDK needed — keeps bundle small)
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('customer_email', email);
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', `${baseUrl}?upgraded=1`);
    params.append('cancel_url', `${baseUrl}?upgrade_cancelled=1`);
    params.append('allow_promotion_codes', 'true');
    params.append('subscription_data[trial_period_days]', '7');
    if (user_id) {
      params.append('metadata[supabase_user_id]', user_id);
    }
    const stripeLocale = { ro: 'ro', en: 'en', es: 'es', fr: 'fr', de: 'de', pt: 'pt-BR' }[lang] || 'ro';
    params.append('locale', stripeLocale);

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error('Stripe error:', session);
      return res.status(500).json({ error: 'Stripe checkout failed', details: session.error?.message });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
