// ============================================
// evaluate.js — Vercel Serverless Function
// Evaluator Sugestii Hipnotice — Puterea Minții
// Rate limiting: IP + Fingerprint + Email
// ============================================

// --- IN-MEMORY RATE LIMIT STORE ---
// Persists across warm invocations (5-15 min on Vercel)
// Resets on cold start — acceptable tradeoff vs. external DB
const rateLimitStore = new Map();

function getRateLimitKey(ip, fingerprint, email) {
  // Composite key: IP is primary, fingerprint and email add specificity
  const parts = [ip || 'unknown'];
  if (fingerprint) parts.push(fingerprint);
  if (email) parts.push(email);
  return parts.join('|');
}

function getHourKey() {
  return new Date().toISOString().slice(0, 13); // "2026-03-25T14"
}

function getDayKey() {
  return new Date().toISOString().slice(0, 10); // "2026-03-25"
}

function checkRateLimit(ip, fingerprint, email, tier, charCount) {
  const hourKey = getHourKey();
  const dayKey = getDayKey();
  
  // Build multiple keys to check (IP alone + IP+fingerprint + email if present)
  const keys = [
    `ip:${ip}:${hourKey}`,
    `ip:${ip}:${dayKey}`
  ];
  if (fingerprint) {
    keys.push(`fp:${fingerprint}:${hourKey}`);
    keys.push(`fp:${fingerprint}:${dayKey}`);
  }
  if (email) {
    keys.push(`em:${email}:${hourKey}`);
    keys.push(`em:${email}:${dayKey}`);
  }

  // Get max counts across all keys (catches people switching browsers/incognito)
  let maxHour = 0;
  let maxDay = 0;
  let maxCharsHour = 0;

  for (const key of keys) {
    const entry = rateLimitStore.get(key);
    if (!entry) continue;
    if (key.includes(hourKey)) {
      maxHour = Math.max(maxHour, entry.count || 0);
      maxCharsHour = Math.max(maxCharsHour, entry.chars || 0);
    }
    if (key.includes(dayKey)) {
      maxDay = Math.max(maxDay, entry.count || 0);
    }
  }

  // Limits per tier (evaluate + generate modes)
  const limits = {
    basic:       { perHour: 5,  perDay: Infinity, charsPerHour: Infinity },
    avansat:     { perHour: 3,  perDay: 7,        charsPerHour: Infinity },
    expert:      { perHour: 10, perDay: Infinity,  charsPerHour: 60000 },
    gen_simplu:  { perHour: 3,  perDay: 5,        charsPerHour: Infinity },
    gen_avansat: { perHour: 3,  perDay: 5,        charsPerHour: Infinity },
    gen_expert:  { perHour: 2,  perDay: 3,        charsPerHour: Infinity }
  };

  const limit = limits[tier] || limits.basic;

  if (maxHour >= limit.perHour) {
    const remMin = 60 - new Date().getMinutes();
    return { allowed: false, reason: `rate_limit_hour`, remaining: remMin, unit: 'min' };
  }
  if (maxDay >= limit.perDay) {
    const remHours = 24 - new Date().getHours();
    return { allowed: false, reason: `rate_limit_day`, remaining: remHours, unit: 'hours' };
  }
  if (tier === 'expert' && (maxCharsHour + charCount) > limit.charsPerHour) {
    const remMin = 60 - new Date().getMinutes();
    return { allowed: false, reason: `char_limit_hour`, remaining: remMin, unit: 'min' };
  }

  return { allowed: true };
}

function recordUsage(ip, fingerprint, email, charCount) {
  const hourKey = getHourKey();
  const dayKey = getDayKey();

  const keysToUpdate = [
    `ip:${ip}:${hourKey}`,
    `ip:${ip}:${dayKey}`
  ];
  if (fingerprint) {
    keysToUpdate.push(`fp:${fingerprint}:${hourKey}`);
    keysToUpdate.push(`fp:${fingerprint}:${dayKey}`);
  }
  if (email) {
    keysToUpdate.push(`em:${email}:${hourKey}`);
    keysToUpdate.push(`em:${email}:${dayKey}`);
  }

  for (const key of keysToUpdate) {
    const entry = rateLimitStore.get(key) || { count: 0, chars: 0 };
    entry.count++;
    entry.chars += charCount;
    rateLimitStore.set(key, entry);
  }

  // Cleanup old entries (older than 25 hours)
  if (rateLimitStore.size > 500) {
    const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString().slice(0, 13);
    for (const [key] of rateLimitStore) {
      // Extract date part from key (last segment after last colon that looks like a date)
      const parts = key.split(':');
      const datePart = parts[parts.length - 1];
      if (datePart < cutoff) {
        rateLimitStore.delete(key);
      }
    }
  }
}

function getClientIP(req) {
  // Vercel provides real IP in x-forwarded-for or x-real-ip
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

// --- MAIN HANDLER ---
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

  const { system, messages, temperature, tier, fingerprint, email, max_tokens: reqMaxTokens } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // --- SERVER-SIDE RATE LIMITING ---
  const clientIP = getClientIP(req);
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const msgContent = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)) : '';
  const charCount = msgContent.length;
  const effectiveTier = tier || 'basic';

  const rateCheck = checkRateLimit(clientIP, fingerprint, email, effectiveTier, charCount);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'rate_limited',
      reason: rateCheck.reason,
      remaining: rateCheck.remaining,
      unit: rateCheck.unit
    });
  }

  try {
    // Retry logic for transient errors (529 overloaded, 500, 503)
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // 2s, 4s, 8s
    let response = null;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: Math.min(reqMaxTokens || 4096, 8192),
            temperature: typeof temperature === 'number' ? temperature : 0,
            system: system || '',
            messages: messages
          })
        });

        // If success or non-retryable error, break
        if (response.ok || ![429, 500, 502, 503, 529].includes(response.status)) {
          break;
        }

        // Retryable error
        lastError = `Anthropic ${response.status}`;
        console.warn(`Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${response.status}. Retrying in ${RETRY_DELAYS[attempt]}ms...`);
        
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        }
      } catch (fetchErr) {
        lastError = fetchErr.message;
        console.warn(`Attempt ${attempt + 1}/${MAX_RETRIES} fetch error: ${fetchErr.message}`);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        }
      }
    }

    if (!response) {
      console.error('All retries failed:', lastError);
      return res.status(503).json({ error: 'API temporarily unavailable', details: lastError });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error after retries:', response.status, errorText);
      return res.status(response.status).json({ error: 'API error', details: errorText });
    }

    const data = await response.json();

    // Record successful usage AFTER API call succeeds
    recordUsage(clientIP, fingerprint, email, charCount);

    // --- LOGGING NON-BLOCKING ---
    const sheetUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
    if (sheetUrl) {
      try {
        const raspunsAI = data.content ? data.content.map(c => c.text || '').join('') : '';
        const nivel = (system || '').includes('MODUL GENERATOR') ? 'Generator' :
                      (system || '').includes('17 criterii') ? 'Expert' :
                      (system || '').includes('9 criterii') ? 'Avansat' :
                      (system || '').includes('3 criterii') ? 'Basic' : 'Necunoscut';
        
        // Parse JSON response robustly
        let scorTotal = '';
        let tipSugestie = '';
        let scoruriStr = '';
        try {
          const clean = raspunsAI.replace(/```json\s*/g, '').replace(/```/g, '').trim();
          const jsonMatch = clean.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            scorTotal = parsed.scor_total || '';
            tipSugestie = parsed.tip_detectat || '';
            if (parsed.criterii && Array.isArray(parsed.criterii)) {
              scoruriStr = parsed.criterii.map(c => c.id + ':' + c.scor).join(', ');
            }
          }
        } catch (parseJsonErr) {
          // Fallback to regex
          const sm = raspunsAI.match(/"scor_total"\s*:\s*(\d+)/);
          scorTotal = sm ? sm[1] : '';
          const tm = raspunsAI.match(/"tip_detectat"\s*:\s*"([^"]+)"/);
          tipSugestie = tm ? tm[1] : '';
        }

        // Await with 3s timeout so Vercel doesn't kill the function before logging completes
        const sheetPayload = JSON.stringify({
            timestamp: new Date().toISOString(),
            sugestie: msgContent.substring(0, 2000),
            nivel: nivel,
            tip_sugestie: tipSugestie,
            scor_total: scorTotal,
            scoruri_criterii: scoruriStr,
            nr_cuvinte: msgContent.split(/\s+/).filter(Boolean).length,
            raspuns_complet: raspunsAI.substring(0, 5000),
            ip: clientIP,
            fingerprint: (fingerprint || '').substring(0, 16),
            email: email || ''
        });

        await Promise.race([
          fetch(sheetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            redirect: 'manual',
            body: sheetPayload
          }).then(sheetResp => {
            console.log('Sheet webhook status:', sheetResp.status);
          }).catch(logErr => {
            console.error('Sheet logging failed:', logErr.message);
          }),
          new Promise(r => setTimeout(r, 3000)) // 3s timeout - don't block user
        ]);

      } catch (parseErr) {
        console.error('Log parse error:', parseErr.message);
      }
    }
    // --- END LOGGING ---

    return res.status(200).json(data);
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
