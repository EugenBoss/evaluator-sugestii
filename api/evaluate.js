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

  const { system, messages, temperature } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        temperature: typeof temperature === 'number' ? temperature : 0,
        system: system || '',
        messages: messages
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);
      return res.status(response.status).json({ error: 'API error', details: errorText });
    }

    const data = await response.json();

    // --- LOGGING NON-BLOCKING (fire and forget) ---
    const sheetUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
    if (sheetUrl) {
      try {
        // Extrage sugestia din ultimul mesaj user
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        const sugestie = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)) : '';

        // Extrage răspunsul AI
        const raspunsAI = data.content ? data.content.map(c => c.text || '').join('') : '';

        // Detectează nivel din system prompt
        const nivel = (system || '').includes('14 criterii') ? 'Avansat' :
                      (system || '').includes('criterii') ? 'Basic' : 'Necunoscut';

        // Extrage scor total din răspuns (caută pattern "XX/100" sau "XX%")
        const scorMatch = raspunsAI.match(/(\d{1,3})\s*[/%]\s*(?:100)?/);
        const scorTotal = scorMatch ? scorMatch[1] : '';

        // Extrage scoruri individuale (caută pattern "X/10" repetat)
        const scoruri = [];
        const scorRegex = /(\d{1,2})\s*\/\s*10/g;
        let match;
        while ((match = scorRegex.exec(raspunsAI)) !== null) {
          scoruri.push(match[1]);
        }

        // Extrage tip sugestie detectat
        const tipMatch = raspunsAI.match(/(?:Tip(?:ul)?\s*(?:sugestie|detectat)?)\s*[:：]\s*(Direct[ăa]|Indirect[ăa]|Mixt[ăa]|Post-hipnotic[ăa]|Metafor[ăa])/i);
        const tipSugestie = tipMatch ? tipMatch[1] : '';

        // Trimite la Sheet — nu așteaptă răspunsul
        fetch(sheetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            sugestie: sugestie.substring(0, 2000),
            nivel: nivel,
            tip_sugestie: tipSugestie,
            scor_total: scorTotal,
            scoruri_criterii: scoruri.join(','),
            nr_cuvinte: sugestie.split(/\s+/).filter(Boolean).length,
            raspuns_complet: raspunsAI.substring(0, 5000)
          })
        }).catch(logErr => {
          console.error('Sheet logging failed (non-blocking):', logErr.message);
        });

      } catch (parseErr) {
        console.error('Log parse error (non-blocking):', parseErr.message);
      }
    }
    // --- END LOGGING ---

    return res.status(200).json(data);
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
