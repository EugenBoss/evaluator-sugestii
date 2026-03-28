module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SERVICE_KEY;

  const checks = {
    SUPABASE_URL: url ? 'setat' : 'lipsa',
    SUPABASE_ANON_KEY: anon ? 'setat (' + anon.substring(0, 15) + '...)' : 'lipsa',
    SUPABASE_SERVICE_KEY: secret ? 'setat (' + secret.substring(0, 15) + '...)' : 'lipsa',
    connection: 'netestat'
  };

  if (!url || !secret) {
    return res.json({ ok: false, message: 'Env vars lipsa in Vercel', checks });
  }

  try {
    const resp = await fetch(url + '/rest/v1/profiles?select=id&limit=1', {
      headers: {
        'apikey': secret,
        'Authorization': 'Bearer ' + secret
      }
    });

    if (resp.ok) {
      checks.connection = 'conectat';
      const tables = ['profiles', 'evaluations', 'daily_affirmations', 'weekly_scripts', 'progress_reports'];
      const tableChecks = {};

      for (const t of tables) {
        const r = await fetch(url + '/rest/v1/' + t + '?select=id&limit=1', {
          headers: { 'apikey': secret, 'Authorization': 'Bearer ' + secret }
        });
        tableChecks[t] = r.ok ? 'OK' : 'LIPSA';
      }

      const allOk = Object.values(tableChecks).every(v => v === 'OK');

      return res.json({
        ok: allOk,
        message: allOk
          ? 'PERFECT — Supabase conectat, toate 5 tabelele exista!'
          : 'Conexiune OK dar unele tabele lipsesc. Ruleaza SQL-ul din spec in SQL Editor.',
        checks,
        tables: tableChecks
      });
    } else {
      const errText = await resp.text();
      checks.connection = 'eroare';
      return res.json({
        ok: false,
        message: resp.status === 404
          ? 'Conexiune OK dar tabelul profiles nu exista. Ruleaza SQL-ul din spec in SQL Editor.'
          : 'Eroare: ' + resp.status,
        checks
      });
    }
  } catch (err) {
    checks.connection = 'eroare: ' + err.message;
    return res.json({ ok: false, message: 'Nu pot conecta la Supabase: ' + err.message, checks });
  }
};
