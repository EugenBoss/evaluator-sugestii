// api/daily-nudge.js — Cron daily nudge email (cron-job.org → this endpoint)
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NUDGE_SECRET
// Setup: cron-job.org calls GET https://evaluator.putereamintii.ro/api/daily-nudge?token=NUDGE_SECRET daily at 10:00 AM

export default async function handler(req, res) {
  // Auth
  const token = req.query?.token || req.headers?.['x-nudge-token'] || '';
  if (!process.env.NUDGE_SECRET || token !== process.env.NUDGE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_KEY) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  try {
    // Get yesterday and today dates
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);

    // Query Supabase: users with evaluations yesterday but NOT today
    // Uses evaluations table (logged by the platform)
    const yesterdayStart = yesterday + 'T00:00:00Z';
    const yesterdayEnd = yesterday + 'T23:59:59Z';
    const todayStart = today + 'T00:00:00Z';

    // Step 1: Get distinct emails from yesterday
    const ydResp = await fetch(
      `${SUPABASE_URL}/rest/v1/evaluations?select=email,score,created_at&created_at=gte.${yesterdayStart}&created_at=lte.${yesterdayEnd}&email=neq.&email=not.is.null&order=created_at.desc`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!ydResp.ok) throw new Error('Supabase yesterday query failed: ' + ydResp.status);
    const ydRows = await ydResp.json();

    // Get unique emails from yesterday
    const ydEmails = new Map();
    ydRows.forEach(r => {
      if (r.email && !ydEmails.has(r.email)) {
        ydEmails.set(r.email, { score: r.score || 0 });
      }
    });

    if (ydEmails.size === 0) {
      return res.json({ sent: 0, message: 'No users active yesterday' });
    }

    // Step 2: Get emails that already have activity today
    const tdResp = await fetch(
      `${SUPABASE_URL}/rest/v1/evaluations?select=email&created_at=gte.${todayStart}&email=neq.&email=not.is.null`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const tdRows = tdResp.ok ? await tdResp.json() : [];
    const todayEmails = new Set(tdRows.map(r => r.email));

    // Step 3: Filter — yesterday active, NOT today active
    const targets = [];
    ydEmails.forEach((data, email) => {
      if (!todayEmails.has(email)) {
        targets.push({ email, score: data.score });
      }
    });

    if (targets.length === 0) {
      return res.json({ sent: 0, message: 'All yesterday users already active today' });
    }

    // Step 4: Get today's daily challenge brief
    const BRIEFS = [
      { cat: 'Anxietate', desc: 'Frica de a vorbi în public. Clienta, 34 ani, evită prezentările.' },
      { cat: 'Stimă de sine', desc: 'Sindromul impostorului. Manager, 42 ani, se simte incompetent.' },
      { cat: 'Relații', desc: 'Frică de abandon. Crize de gelozie nejustificată, relație de 3 ani.' },
      { cat: 'Depresie', desc: 'Lipsa de sens după pierderea unui job. Bărbat, 48 ani.' },
      { cat: 'Somn', desc: 'Insomnie cronică de 2 ani. Nu poate adormi, gânduri repetitive.' },
      { cat: 'Burnout', desc: 'Epuizare completă. Mamă, 38 ani, burnout profesional + parental.' },
      { cat: 'Procrastinare', desc: 'Amână totul. Student, 22 ani, examen important în 2 săptămâni.' },
      { cat: 'Încredere', desc: 'Vorbitul în fața grupurilor. Profesor, 45 ani, anxietate socială.' },
      { cat: 'Trauma', desc: 'Accident rutier acum 6 luni. Evitare totală, nu mai conduce.' },
      { cat: 'Dependențe', desc: 'Fumat 20 țigări/zi de 15 ani. A încercat tot, nimic nu a funcționat.' },
      { cat: 'Bani', desc: 'Anxietate financiară. Câștigă bine dar se simte mereu în pericol.' },
      { cat: 'Sănătate', desc: 'Durere cronică de spate. 5 ani, nicio cauză medicală clară.' },
      { cat: 'Comunicare', desc: 'Dificultate în a spune Nu. Oamenii profită de bunătatea sa.' },
      { cat: 'Copil interior', desc: 'Abandon parental la 5 ani. Acum 39 ani, relații instabile.' }
    ];
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const brief = BRIEFS[dayOfYear % BRIEFS.length];

    // Step 5: Send emails via Resend
    let sent = 0;
    const errors = [];
    const appUrl = 'https://evaluator.putereamintii.ro';

    for (const target of targets.slice(0, 50)) { // Cap at 50 emails/day
      try {
        const emailResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_KEY}`
          },
          body: JSON.stringify({
            from: 'Puterea Minții <noreply@putereamintii.ro>',
            to: target.email,
            subject: `🎯 Provocarea de azi: ${brief.cat} — Evaluator Puterea Minții`,
            html: `
<div style="font-family:'DM Sans',sans-serif;max-width:520px;margin:0 auto;background:#0f1f28;color:#e8edf0;padding:32px;border-radius:12px">
  <div style="text-align:center;margin-bottom:20px">
    <div style="font-size:0.72rem;color:#8fa3b0;text-transform:uppercase;letter-spacing:0.1em">Puterea Minții · Evaluator</div>
  </div>
  <div style="font-size:1.1rem;font-weight:700;color:#F6D44C;margin-bottom:8px">🎯 Provocarea zilei</div>
  <div style="font-size:0.82rem;color:#8fa3b0;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">${brief.cat}</div>
  <div style="font-size:0.92rem;color:#e8edf0;line-height:1.6;margin-bottom:20px;padding:16px;background:#162a36;border-radius:8px;border:1px solid #1e3f52">${brief.desc}</div>
  ${target.score ? `<div style="font-size:0.85rem;color:#8fa3b0;margin-bottom:16px">Ieri ai obținut scorul <strong style="color:#4FC1E9">${target.score}</strong>. Poți mai bine azi?</div>` : ''}
  <div style="text-align:center;margin:24px 0">
    <a href="${appUrl}#acasa" style="display:inline-block;padding:14px 32px;background:#F6D44C;color:#0f1f28;text-decoration:none;border-radius:8px;font-weight:700;font-size:0.95rem">Scrie sugestia ta →</a>
  </div>
  <div style="font-size:0.78rem;color:#5a7585;text-align:center;margin-top:20px;line-height:1.5">
    Primești acest email pentru că ai folosit Evaluatorul Puterea Minții ieri.<br>
    <a href="${appUrl}" style="color:#4FC1E9;text-decoration:none">evaluator.putereamintii.ro</a>
  </div>
</div>`
          })
        });
        if (emailResp.ok) sent++;
        else errors.push({ email: target.email, status: emailResp.status });
      } catch (e) {
        errors.push({ email: target.email, error: e.message });
      }
    }

    return res.json({
      sent,
      total_targets: targets.length,
      brief_category: brief.cat,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: now.toISOString()
    });

  } catch (e) {
    console.error('Daily nudge error:', e);
    return res.status(500).json({ error: e.message });
  }
}
