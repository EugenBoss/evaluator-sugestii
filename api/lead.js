// api/lead.js — Lead tracking: Pabbly webhook + GHL contact upsert with smart tags
// Env vars: GHL_API_KEY, GHL_LOCATION_ID (optional — if missing, only Pabbly fires)
// ESM format for Vercel

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = req.body;

    // ===== PAYLOAD (17 fields, always same keys) =====
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

    // ===== 1. PABBLY WEBHOOK (existing, backward compat) =====
    const WEBHOOK_PABBLY = 'https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjcwNTZmMDYzMjA0MzI1MjY0NTUzNDUxMzYi_pc';

    const pabblyPromise = fetch(WEBHOOK_PABBLY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => null);

    // ===== 2. GHL CONTACT UPSERT + SMART TAGS =====
    const GHL_API_KEY = process.env.GHL_API_KEY || '';
    const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';

    let ghlResult = 'skipped';

    if (GHL_API_KEY && payload.email) {
      try {
        // Build smart tags
        const tags = ['evaluator_activ'];

        // Score bracket
        const score = parseInt(payload.score) || 0;
        if (score >= 90) tags.push('scor_excelent');
        else if (score >= 75) tags.push('scor_bun');
        else if (score >= 60) tags.push('scor_mediu');
        else if (score > 0) tags.push('scor_slab');

        // Module
        const source = (payload.source || '').toLowerCase();
        const contentType = (payload.content_type || '').toLowerCase();
        if (source.includes('evaluator') || source === 'evaluator-sugestii') tags.push('modul_evaluator');
        if (source.includes('generator') || contentType.includes('generator')) tags.push('modul_generator');
        if (source.includes('antrenament')) tags.push('modul_antrenament');
        if (source.includes('laborator') || contentType.includes('laborator')) tags.push('modul_lab');

        // Tier
        const tier = (payload.tier || '').toLowerCase();
        if (tier === 'expert') tags.push('tier_expert');
        else if (tier === 'avansat') tags.push('tier_avansat');
        else if (tier === 'basic') tags.push('tier_basic');

        // Language
        const lang = (payload.lang || 'ro').toLowerCase();
        tags.push('limba_' + lang);

        // Device
        const device = (payload.device || '').toLowerCase();
        if (device === 'mobile') tags.push('device_mobile');
        else if (device === 'desktop') tags.push('device_desktop');

        // Content type
        if (contentType === 'afirmatie') tags.push('tip_afirmatie');
        else if (contentType === 'sugestie') tags.push('tip_sugestie');

        // Lead type
        if (payload.lead_type === 'complet') tags.push('lead_complet');

        // GHL v1 API — upsert contact
        // POST /v1/contacts/ with email does upsert (creates if new, updates if exists)
        const ghlBody = {
          email: payload.email,
          name: payload.name || undefined,
          phone: payload.phone || undefined,
          tags: tags,
          source: 'evaluator_sugestii',
          customField: {}
        };

        // Add location if configured
        if (GHL_LOCATION_ID) {
          ghlBody.locationId = GHL_LOCATION_ID;
        }

        // Custom fields (if you've created them in GHL)
        if (score > 0) ghlBody.customField.evaluator_last_score = String(score);
        if (payload.level) ghlBody.customField.evaluator_last_level = payload.level;
        if (tier) ghlBody.customField.evaluator_tier = tier;
        if (payload.timestamp) ghlBody.customField.evaluator_last_activity = payload.timestamp;

        const ghlResp = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GHL_API_KEY}`
          },
          body: JSON.stringify(ghlBody)
        });

        if (ghlResp.ok) {
          const ghlData = await ghlResp.json();
          ghlResult = 'ok';

          // If contact already existed, tags from POST only ADD (don't remove old ones)
          // This is exactly what we want — tags accumulate over time
          // GHL deduplicates by email automatically

        } else {
          const errText = await ghlResp.text().catch(() => '');
          console.error('GHL error:', ghlResp.status, errText);
          ghlResult = 'error_' + ghlResp.status;
        }
      } catch (ghlErr) {
        console.error('GHL exception:', ghlErr.message);
        ghlResult = 'exception';
      }
    }

    // Wait for Pabbly (non-blocking, max 3s)
    const pabblyResult = await Promise.race([
      pabblyPromise.then(r => r?.ok ? 'ok' : 'failed'),
      new Promise(r => setTimeout(() => r('timeout'), 3000))
    ]);

    return res.status(200).json({
      success: true,
      pabbly: pabblyResult,
      ghl: ghlResult
    });

  } catch (err) {
    console.error('Lead webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
