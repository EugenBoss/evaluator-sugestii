// ============================================
// STRIPE WEBHOOK — /api/stripe-webhook.js
// No SDK — raw fetch + crypto for signature
// Maps price_id → tier + subscription_plan
// ============================================

import crypto from 'crypto';

export const config = {
  api: { bodyParser: false },
};

// --- Price → Plan mapping ---
const PRICE_PLAN_MAP = {
  'price_1TGGWdEQCf9MHQbjsA9L6qav': { tier: 'crestere', plan: 'crestere_lunar' },
  'price_1TGGZIEQCf9MHQbjp5NjnaRf': { tier: 'transformare', plan: 'transformare_lunar' },
  'price_1TGGa6EQCf9MHQbjJwiRf9jR': { tier: 'transformare', plan: 'transformare_anual' },
};

function getPlanFromSubscription(subscription) {
  const priceId = subscription?.items?.data?.[0]?.price?.id;
  if (priceId && PRICE_PLAN_MAP[priceId]) return PRICE_PLAN_MAP[priceId];
  // Fallback: check metadata from checkout
  const metaPlan = subscription?.metadata?.plan;
  if (metaPlan === 'crestere_lunar') return { tier: 'crestere', plan: 'crestere_lunar' };
  if (metaPlan === 'transformare_lunar') return { tier: 'transformare', plan: 'transformare_lunar' };
  if (metaPlan === 'transformare_anual') return { tier: 'transformare', plan: 'transformare_anual' };
  // Legacy fallback
  return { tier: 'crestere', plan: 'crestere_lunar' };
}

// --- Stripe signature verification ---
function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key.trim()] = value;
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) return false;

  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// --- Supabase admin helper (raw REST, bypasses RLS) ---
async function supabaseAdmin(method, table, query, body) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  const endpoint = `${url}/rest/v1/${table}${query ? '?' + query : ''}`;
  const opts = {
    method,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'PATCH' ? 'return=minimal' : 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(endpoint, opts);
  if (method === 'PATCH' || method === 'DELETE') return { ok: res.ok, status: res.status };
  return res.json();
}

// --- Stripe API helper ---
async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

// --- Buffer helper for raw body ---
async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const rawBody = buf.toString('utf8');
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return res.status(400).json({ error: 'Missing signature or secret' });
  }

  if (!verifyStripeSignature(rawBody, sig, webhookSecret)) {
    console.error('Webhook signature verification failed');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  try {
    switch (event.type) {
      // ==========================================
      // NEW SUBSCRIPTION
      // ==========================================
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_email || session.customer_details?.email;
        const stripeCustomerId = session.customer;
        const subscriptionId = session.subscription;

        if (!customerEmail) {
          console.error('No email in checkout session');
          break;
        }

        // Find user by email
        const profiles = await supabaseAdmin(
          'GET', 'profiles',
          `email=eq.${encodeURIComponent(customerEmail.toLowerCase())}&select=id&limit=1`
        );

        if (!Array.isArray(profiles) || profiles.length === 0) {
          console.error('No profile found for email:', customerEmail);
          break;
        }

        const profileId = profiles[0].id;

        // Get subscription details from Stripe
        const subscription = await stripeGet(`/subscriptions/${subscriptionId}`);
        const { tier, plan } = getPlanFromSubscription(subscription);

        await supabaseAdmin('PATCH', 'profiles',
          `id=eq.${profileId}`,
          {
            tier,
            subscription_plan: plan,
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: subscriptionId,
            stripe_subscription_status: subscription.status,
            stripe_current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            trial_active: false,
            updated_at: new Date().toISOString(),
          }
        );

        console.log(`✅ ${tier} (${plan}) activated for ${customerEmail}`);
        break;
      }

      // ==========================================
      // SUBSCRIPTION RENEWED
      // ==========================================
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        const subscription = await stripeGet(`/subscriptions/${subscriptionId}`);
        const { tier, plan } = getPlanFromSubscription(subscription);

        await supabaseAdmin('PATCH', 'profiles',
          `stripe_subscription_id=eq.${subscriptionId}`,
          {
            tier,
            subscription_plan: plan,
            stripe_subscription_status: 'active',
            stripe_current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }
        );
        break;
      }

      // ==========================================
      // SUBSCRIPTION CHANGED (upgrade/downgrade)
      // ==========================================
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const status = subscription.status;
        const { tier, plan } = getPlanFromSubscription(subscription);

        const updates = {
          stripe_subscription_status: status,
          stripe_current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          subscription_plan: plan,
          updated_at: new Date().toISOString(),
        };

        if (status === 'canceled' || status === 'unpaid') {
          updates.tier = 'free';
          updates.subscription_plan = null;
        } else {
          updates.tier = tier;
        }

        await supabaseAdmin('PATCH', 'profiles',
          `stripe_subscription_id=eq.${subscription.id}`,
          updates
        );
        break;
      }

      // ==========================================
      // SUBSCRIPTION DELETED
      // ==========================================
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;

        await supabaseAdmin('PATCH', 'profiles',
          `stripe_subscription_id=eq.${subscription.id}`,
          {
            tier: 'free',
            subscription_plan: null,
            stripe_subscription_status: 'canceled',
            updated_at: new Date().toISOString(),
          }
        );

        console.log(`⚠️ Subscription canceled: ${subscription.id}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
