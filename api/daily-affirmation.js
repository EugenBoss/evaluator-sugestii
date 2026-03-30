// api/daily-affirmation.js — Vercel Serverless Function (ESM)
// Called by cron-job.org daily at 7:00 AM EET
// Generates personalized affirmation for paid subscribers (Creștere + Transformare)
// Uses: Supabase (query profiles + save), Claude (generate), Resend (email)

export default async function handler(req, res) {
  // Accept GET (cron-job.org default) and POST
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY || !RESEND_API_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    // 1. Get paid users from profiles table (tier = crestere or transformare)
    const profilesResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?tier=in.(crestere,transformare)&select=id,email,display_name,tier,affirmation_theme,stripe_subscription_status`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    const allProfiles = await profilesResp.json();

    // Filter: must have email
    const subscribers = (Array.isArray(allProfiles) ? allProfiles : []).filter(p => p.email);

    if (subscribers.length === 0) {
      return res.status(200).json({ message: 'No active subscribers', count: 0 });
    }

    // 2. Check which users already got today's affirmation (skip duplicates)
    const userIds = subscribers.map(s => s.id);
    const existingResp = await fetch(
      `${SUPABASE_URL}/rest/v1/affirmations?date=eq.${today}&user_id=in.(${userIds.join(',')})&select=user_id`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    const existing = await existingResp.json();
    const alreadySent = new Set((Array.isArray(existing) ? existing : []).map(e => e.user_id));

    // 3. Process each subscriber
    const results = [];
    const THEMES = {
      anxietate: 'Anxietate, frici și atacuri de panică',
      relatii: 'Probleme relaționale și de cuplu',
      stima: 'Stimă de sine și încredere în sine',
      trauma: 'Traumă și copil interior',
      depresie: 'Depresie, tristețe cronică și lipsă de sens',
      burnout: 'Burnout și epuizare cronică',
      procrastinare: 'Procrastinare și lipsă de motivație',
      singuratate: 'Singurătate și izolare socială',
      dependente: 'Dependențe și comportamente compulsive',
      bani: 'Relație cu banii și securitate materială',
      sanatate: 'Sănătate fizică și energie',
      trauma_morala: 'Traumă morală și conflict de valori'
    };
    const themeKeys = Object.keys(THEMES);

    for (const profile of subscribers) {
      if (alreadySent.has(profile.id)) {
        results.push({ user_id: profile.id, status: 'skipped_duplicate' });
        continue;
      }

      // Determine theme
      let themeKey = profile.affirmation_theme || 'auto';
      if (themeKey === 'auto' || !THEMES[themeKey]) {
        themeKey = themeKeys[Math.floor(Math.random() * themeKeys.length)];
      }
      const themeName = THEMES[themeKey];
      const userName = profile.display_name || '';

      try {
        // 4. Generate affirmation with Claude
        const affirmationText = await generateAffirmation(ANTHROPIC_API_KEY, themeName, userName);

        // 5. Save to Supabase
        await fetch(`${SUPABASE_URL}/rest/v1/affirmations`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            user_id: profile.id,
            date: today,
            text: affirmationText,
            theme: themeKey,
            delivered: true
          })
        });

        // 6. Send email via Resend
        await sendAffirmationEmail(RESEND_API_KEY, profile.email, userName, affirmationText, themeName);

        results.push({ user_id: profile.id, status: 'sent', theme: themeKey });
      } catch (err) {
        results.push({ user_id: profile.id, status: 'error', error: err.message });
      }
    }

    return res.status(200).json({
      date: today,
      total_subscribers: subscribers.length,
      processed: results.length,
      results
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function generateAffirmation(apiKey, themeName, userName) {
  const nameInstruction = userName ? `Numele persoanei: ${userName}. Poți folosi prenumele o dată, natural, nu forțat.` : 'Nu cunoaștem numele persoanei.';

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Generează O SINGURĂ afirmație zilnică terapeutică în limba română.

TEMA: ${themeName}
${nameInstruction}

REGULI:
- Formulare pozitivă (zero negații — subconștientul nu procesează „nu")
- Persoana I, prezent (Eu sunt, Eu am, Eu simt, Eu aleg)
- 2-3 propoziții maximum
- Limbaj cald, senzorial, cu cel puțin un element kinestezic
- Specifică (nu generică — trebuie să rezoneze cu tema)
- Fără promisiuni medicale
- Tonul: blând, cald, ca o respirație profundă de dimineață

RETURNEAZĂ DOAR TEXTUL AFIRMAȚIEI, fără ghilimele, fără explicații, fără prefix.`
      }]
    })
  });

  const data = await resp.json();
  if (data.content && data.content[0] && data.content[0].text) {
    return data.content[0].text.trim();
  }
  throw new Error('Claude API returned no content');
}

async function sendAffirmationEmail(apiKey, toEmail, userName, affirmationText, themeName) {
  const greeting = userName ? `Bună dimineața, ${userName}` : 'Bună dimineața';
  const today = new Date();
  const months = ['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'];
  const dateStr = `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0c1820;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
  <div style="text-align:center;margin-bottom:24px">
    <div style="display:inline-block;width:48px;height:48px;background:linear-gradient(135deg,#4FC1E9,#3B596A);border-radius:12px;line-height:48px;font-size:24px">🧠</div>
    <div style="color:#4FC1E9;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:8px">Puterea Minții</div>
  </div>
  <div style="background:#162a36;border:1px solid rgba(79,193,233,0.2);border-radius:16px;padding:32px 28px;margin-bottom:20px">
    <div style="color:#8fa3b0;font-size:13px;margin-bottom:4px">${greeting} ✨</div>
    <div style="color:#5a7585;font-size:12px;margin-bottom:20px">${dateStr} · ${themeName}</div>
    <div style="color:#f0f4f6;font-size:18px;line-height:1.7;font-style:italic;padding:20px 0;border-top:1px solid rgba(79,193,233,0.12);border-bottom:1px solid rgba(79,193,233,0.12)">
      ${affirmationText}
    </div>
    <div style="margin-top:20px;color:#5a7585;font-size:12px;line-height:1.6">
      💡 Citește afirmația cu voce lină de 3 ori. Simte fiecare cuvânt. Lasă-l să se așeze.
    </div>
  </div>
  <div style="text-align:center;margin-bottom:16px">
    <a href="https://evaluator.putereamintii.ro/#dashboard" style="display:inline-block;padding:12px 28px;background:#c0392b;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
      Vezi Dashboard-ul tău →
    </a>
  </div>
  <div style="text-align:center;color:#3B596A;font-size:11px;line-height:1.5">
    Primești acest email ca abonat Puterea Minții.<br>
    <a href="https://evaluator.putereamintii.ro" style="color:#4FC1E9;text-decoration:none">evaluator.putereamintii.ro</a>
  </div>
</div>
</body></html>`;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: 'Puterea Minții <noreply@putereamintii.ro>',
      to: toEmail,
      subject: `✨ Afirmația ta de azi — ${themeName}`,
      html
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Resend error: ${resp.status} ${err}`);
  }
}
