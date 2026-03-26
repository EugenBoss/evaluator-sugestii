// ============================================
// send-suggestions.js — Vercel Serverless Function
// Sends generated suggestions via Resend email
// ============================================

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

  const { email, name, level, problem, goal, intensity, motivation, data } = req.body;

  if (!email || !data) {
    return res.status(400).json({ error: 'Missing email or data' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  // Build HTML email
  const htmlEmail = buildEmailHTML({
    name: name || '',
    level: level || 'simplu',
    problem: problem || '',
    goal: goal || '',
    intensity: intensity || 5,
    motivation: motivation || 5,
    afirmatii: data.afirmatii || [],
    sugestii: data.sugestii || [],
    sugestii_complete: data.sugestii_complete || [],
    script: data.script || '',
    instructiuni_afirmatii: data.instructiuni_afirmatii || '',
    instructiuni_sugestii: data.instructiuni_sugestii || '',
    instructiuni_complete: data.instructiuni_complete || '',
    instructiuni_script: data.instructiuni_script || ''
  });

  const subjectMap = {
    simplu: 'Afirmațiile și sugestiile tale personalizate',
    avansat: 'Sugestiile tale hipnotice personalizate — Nivel Avansat',
    expert: 'Scriptul tău complet de autohipnoză — Nivel Expert'
  };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'Puterea Minții <noreply@putereamintii.ro>',
        to: email,
        subject: subjectMap[level] || subjectMap.simplu,
        html: htmlEmail
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Resend error:', response.status, errText);
      return res.status(500).json({ error: 'Email send failed', details: errText });
    }

    const result = await response.json();
    return res.status(200).json({ sent: true, id: result.id });

  } catch (error) {
    console.error('Send email error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function buildEmailHTML({ name, level, problem, goal, intensity, motivation, afirmatii, sugestii, sugestii_complete, script, instructiuni_afirmatii, instructiuni_sugestii, instructiuni_complete, instructiuni_script }) {
  const greeting = name ? `Salut ${esc(name)},` : 'Salut,';
  const levelLabel = { simplu: 'Simplu', avansat: 'Avansat', expert: 'Expert' }[level] || 'Simplu';

  let sections = '';

  // Afirmatii
  if (afirmatii.length) {
    sections += sectionTitle('Afirmațiile tale', '#F6D44C');
    if (instructiuni_afirmatii) sections += instructions(instructiuni_afirmatii);
    afirmatii.forEach((a, i) => {
      sections += suggestionCard(a, i + 1, '#F6D44C');
    });
  }

  // Sugestii
  if (sugestii.length) {
    sections += sectionTitle('Sugestiile tale', '#4FC1E9');
    if (instructiuni_sugestii) sections += instructions(instructiuni_sugestii);
    sugestii.forEach((s, i) => {
      sections += suggestionCard(s, i + 1, '#4FC1E9');
    });
  }

  // Sugestii complete
  if (sugestii_complete.length) {
    sections += sectionTitle('Sugestii complete cu scenariu senzorial', '#2ecc71');
    if (instructiuni_complete) sections += instructions(instructiuni_complete);
    sugestii_complete.forEach((sc, i) => {
      const text = typeof sc === 'string' ? sc : sc.text || '';
      const expl = typeof sc === 'object' ? sc.explicatie || '' : '';
      sections += suggestionCard(text, i + 1, '#2ecc71');
      if (expl) sections += `<p style="margin:0 0 16px 0;padding:0 24px;font-size:13px;color:#8fa3b0;font-style:italic;line-height:1.5">${esc(expl)}</p>`;
    });
  }

  // Script
  if (script) {
    sections += sectionTitle('Script complet de autohipnoză (5-7 min)', '#F6D44C');
    if (instructiuni_script) sections += instructions(instructiuni_script);
    sections += `
      <div style="margin:0 24px 24px;padding:20px;background:#162a36;border:1px solid rgba(46,204,113,0.2);border-radius:8px;font-family:'Georgia',serif;font-size:15px;color:#e8edf0;line-height:1.9;white-space:pre-wrap">${esc(script)}</div>
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0c1820;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#0f1f28">

  <!-- Header -->
  <div style="padding:32px 24px 24px;text-align:center;border-bottom:1px solid rgba(79,193,233,0.12)">
    <div style="font-size:18px;font-weight:700;color:#e8edf0;margin-bottom:4px">Puterea Minții</div>
    <div style="font-size:11px;color:#4FC1E9;letter-spacing:2px;text-transform:uppercase">Generator de Sugestii</div>
  </div>

  <!-- Greeting -->
  <div style="padding:28px 24px 8px">
    <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:#e8edf0;line-height:1.4">${greeting}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#8fa3b0;line-height:1.6">Iată sugestiile tale personalizate, generate la nivel <strong style="color:#4FC1E9">${esc(levelLabel)}</strong>.</p>
    <p style="margin:0 0 20px;font-size:13px;color:#5a7585;line-height:1.5">Problema: ${esc(problem)} · Dorință: ${esc(goal)}</p>
  </div>

  <!-- Content -->
  ${sections}

  <!-- CTA -->
  <div style="padding:20px 24px 8px;text-align:center">
    <a href="https://evaluator.putereamintii.ro/#generator" style="display:inline-block;padding:14px 32px;background:#c0392b;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px">Generează alte sugestii →</a>
  </div>

  <!-- CTA Curs -->
  <div style="margin:20px 24px;padding:20px;background:rgba(246,212,76,0.06);border:1px solid rgba(246,212,76,0.2);border-radius:8px;text-align:center">
    <div style="font-size:11px;font-weight:700;color:#F6D44C;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Pasul următor</div>
    <div style="font-size:15px;font-weight:700;color:#e8edf0;margin-bottom:6px">Secretele Autohipnozei</div>
    <div style="font-size:13px;color:#8fa3b0;line-height:1.5;margin-bottom:14px">Învață să-ți creezi singur(ă) sugestii și scripturi profesionale.</div>
    <a href="https://app.ezycourse.com/putereamintii/autohipnoza" style="display:inline-block;padding:10px 24px;background:#F6D44C;color:#0f1f28;font-size:13px;font-weight:700;text-decoration:none;border-radius:6px">Află mai multe →</a>
  </div>

  <!-- Footer -->
  <div style="padding:24px;border-top:1px solid rgba(79,193,233,0.12);text-align:center">
    <p style="margin:0 0 8px;font-size:12px;color:#5a7585">Acest email a fost generat de <a href="https://evaluator.putereamintii.ro" style="color:#4FC1E9;text-decoration:none">Generator de Sugestii — Puterea Minții</a></p>
    <p style="margin:0;font-size:11px;color:#3a5565">© ${new Date().getFullYear()} Puterea Minții · Asociația Română de Hipnoză</p>
  </div>

</div>
</body>
</html>`;
}

function sectionTitle(title, color) {
  return `<div style="padding:20px 24px 8px"><div style="font-size:15px;font-weight:700;color:${color};margin-bottom:4px">${esc(title)}</div><div style="width:40px;height:2px;background:${color};border-radius:1px;opacity:0.5"></div></div>`;
}

function instructions(text) {
  return `<div style="margin:8px 24px 16px;padding:12px 16px;background:rgba(79,193,233,0.06);border:1px solid rgba(79,193,233,0.12);border-radius:6px;font-size:13px;color:#8fa3b0;line-height:1.5">${esc(text)}</div>`;
}

function suggestionCard(text, num, color) {
  return `
    <div style="margin:0 24px 8px;padding:14px 16px;background:#162a36;border:1px solid rgba(79,193,233,0.08);border-left:3px solid ${color};border-radius:0 6px 6px 0">
      <div style="font-size:11px;font-weight:700;color:${color};margin-bottom:6px;opacity:0.7">#${num}</div>
      <div style="font-size:14px;color:#e8edf0;line-height:1.7">${esc(text)}</div>
    </div>
  `;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
