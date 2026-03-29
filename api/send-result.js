// api/send-result.js — Send evaluation results via Resend email
// Env: RESEND_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, score, level, tier, detected_type, original_text, improved, explanations, top_problems, criterii, lang } = req.body;

  if (!email) return res.status(400).json({ error: 'Missing email' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(500).json({ error: 'Email service not configured' });

  // Score color
  const scoreColor = score >= 90 ? '#2ecc71' : score >= 75 ? '#4FC1E9' : score >= 60 ? '#F6D44C' : score >= 40 ? '#f39c12' : '#e74c5e';

  // Build criteria HTML
  let criteriiHtml = '';
  if (criterii && criterii.length) {
    criteriiHtml = '<table style="width:100%;border-collapse:collapse;margin:16px 0">';
    criteriiHtml += '<tr style="border-bottom:1px solid #1e3f52"><th style="text-align:left;padding:8px;font-size:13px;color:#8fa3b0">Criteriu</th><th style="text-align:center;padding:8px;font-size:13px;color:#8fa3b0">Scor</th><th style="text-align:left;padding:8px;font-size:13px;color:#8fa3b0">Observație</th></tr>';
    criterii.forEach(c => {
      const cl = c.scor >= 8 ? '#2ecc71' : c.scor >= 6 ? '#F6D44C' : c.scor >= 4 ? '#f39c12' : '#e74c5e';
      const obs = c.observatie || c.feedback || c.observation || '';
      criteriiHtml += `<tr style="border-bottom:1px solid rgba(30,63,82,0.5)"><td style="padding:8px;font-size:13px;color:#e8edf0">C${c.id}</td><td style="padding:8px;text-align:center;font-weight:700;color:${cl};font-size:14px">${c.scor}/10</td><td style="padding:8px;font-size:12px;color:#8fa3b0">${esc(obs)}</td></tr>`;
    });
    criteriiHtml += '</table>';
  }

  // Problems HTML
  let problemsHtml = '';
  if (top_problems && top_problems.length) {
    problemsHtml = '<div style="margin:16px 0;padding:14px;background:rgba(231,76,94,0.06);border:1px solid rgba(231,76,94,0.2);border-radius:8px">';
    problemsHtml += '<div style="font-size:13px;font-weight:700;color:#e74c5e;margin-bottom:8px">⚠ Probleme principale</div>';
    top_problems.forEach(p => {
      problemsHtml += `<div style="font-size:13px;color:#e8edf0;padding:4px 0;padding-left:12px;border-left:2px solid rgba(231,76,94,0.4)">${esc(p)}</div>`;
    });
    problemsHtml += '</div>';
  }

  // Improved version HTML
  let improvedHtml = '';
  if (improved) {
    improvedHtml = `<div style="margin:16px 0;padding:16px;background:rgba(46,204,113,0.06);border:1px solid rgba(46,204,113,0.2);border-radius:8px">
      <div style="font-size:13px;font-weight:700;color:#2ecc71;margin-bottom:8px">✦ Versiune îmbunătățită</div>
      <div style="font-size:14px;color:#e8edf0;line-height:1.7;font-style:italic">${esc(improved)}</div>
    </div>`;
  }

  // Explanations HTML
  let explHtml = '';
  if (explanations) {
    explHtml = `<div style="margin:16px 0;padding:14px;background:rgba(79,193,233,0.06);border-radius:8px">
      <div style="font-size:13px;font-weight:700;color:#4FC1E9;margin-bottom:8px">💡 Ce s-a schimbat și de ce</div>
      <div style="font-size:13px;color:#8fa3b0;line-height:1.6">${esc(explanations)}</div>
    </div>`;
  }

  const subjects = {
    ro: 'Rezultatul evaluării tale — Evaluator Puterea Minții',
    en: 'Your evaluation result — Puterea Minții Evaluator',
    es: 'Tu resultado de evaluación — Evaluador Puterea Minții',
    fr: 'Votre résultat d\'évaluation — Évaluateur Puterea Minții',
    de: 'Ihr Bewertungsergebnis — Bewerter Puterea Minții',
    pt: 'Seu resultado de avaliação — Avaliador Puterea Minții'
  };

  const htmlEmail = `
<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;background:#0f1f28;color:#e8edf0;border-radius:12px;overflow:hidden">
  <div style="background:#162a36;padding:24px 28px;border-bottom:1px solid #1e3f52">
    <div style="font-size:12px;color:#8fa3b0;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px">Puterea Minții · Evaluator</div>
    <div style="font-size:18px;font-weight:700;color:#e8edf0">Rezultatul evaluării tale</div>
  </div>
  <div style="padding:28px">
    <div style="display:flex;align-items:center;margin-bottom:20px">
      <div style="width:80px;height:80px;border-radius:50%;background:${scoreColor};display:flex;align-items:center;justify-content:center;margin-right:20px">
        <span style="font-size:28px;font-weight:700;color:#0f1f28">${score}</span>
      </div>
      <div>
        <div style="font-size:16px;font-weight:700;color:${scoreColor}">${level}</div>
        <div style="font-size:13px;color:#8fa3b0">Tip detectat: ${esc(detected_type || '—')}</div>
        <div style="font-size:13px;color:#8fa3b0">Nivel: ${esc(tier || 'basic')}</div>
      </div>
    </div>

    ${original_text ? `<div style="margin:16px 0;padding:14px;background:#162a36;border:1px solid #1e3f52;border-radius:8px">
      <div style="font-size:12px;color:#8fa3b0;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Textul evaluat</div>
      <div style="font-size:14px;color:#e8edf0;line-height:1.6">${esc(original_text)}</div>
    </div>` : ''}

    ${criteriiHtml}
    ${problemsHtml}
    ${improvedHtml}
    ${explHtml}

    <div style="text-align:center;margin:28px 0 16px">
      <a href="https://evaluator.putereamintii.ro#evaluator" style="display:inline-block;padding:14px 32px;background:#4FC1E9;color:#0f1f28;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">Evaluează altă sugestie →</a>
    </div>
  </div>
  <div style="padding:16px 28px;background:#162a36;border-top:1px solid #1e3f52;text-align:center">
    <div style="font-size:12px;color:#5a7585;line-height:1.5">
      ${name ? `Trimis pentru ${esc(name)} · ` : ''}${new Date().toLocaleDateString('ro-RO')}<br>
      <a href="https://evaluator.putereamintii.ro" style="color:#4FC1E9;text-decoration:none">evaluator.putereamintii.ro</a>
    </div>
  </div>
</div>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_KEY}`
      },
      body: JSON.stringify({
        from: 'Puterea Mintii <noreply@verificare.putereamintii.ro>',
        to: email,
        subject: subjects[lang] || subjects.ro,
        html: htmlEmail
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Resend error:', response.status, errText);
      return res.status(500).json({ error: 'Email send failed' });
    }

    const result = await response.json();
    return res.status(200).json({ sent: true, id: result.id });

  } catch (error) {
    console.error('Send result email error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
