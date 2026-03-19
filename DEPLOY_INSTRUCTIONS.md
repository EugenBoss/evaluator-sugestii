# Deploy Instructions — Evaluator Sugestii Hipnotice

## Ce conține proiectul

```
index.html       ← Aplicația completă (frontend)
api/evaluate.js  ← Proxy API (ascunde cheia Anthropic)
vercel.json      ← Config Vercel
```

## Ce trebuie de la client (Eugen)

1. **Anthropic API Key** — de pe https://console.anthropic.com/
2. **(Opțional)** Domeniu custom (ex: evaluator.putereamintii.ro)

## Pași deploy pe Vercel

### 1. Creează repository pe GitHub
- Creează un repo nou (public sau privat)
- Încarcă toate fișierele păstrând structura:
  ```
  /index.html
  /api/evaluate.js
  /vercel.json
  ```

### 2. Deploy pe Vercel
- Login pe https://vercel.com cu cont GitHub
- Click "Add New Project"
- Selectează repository-ul creat
- La "Environment Variables" adaugă:
  - **Name:** `ANTHROPIC_API_KEY`
  - **Value:** cheia API de la Anthropic
- Click "Deploy"

### 3. (Opțional) Domeniu custom
- În Vercel → Settings → Domains
- Adaugă domeniul dorit
- Configurează DNS-ul conform instrucțiunilor Vercel

### 4. Embed pe WordPress
```html
<iframe 
  src="https://evaluator-sugestii.vercel.app" 
  width="100%" 
  height="900" 
  frameborder="0"
  style="border-radius: 12px; max-width: 700px; margin: 0 auto; display: block;">
</iframe>
```

## Note tehnice

- `api/evaluate.js` e o Vercel Serverless Function (Node.js)
- Proxy-ul trimite request-uri la Anthropic API cu cheia din env var
- Model folosit: `claude-sonnet-4-20250514`
- Frontend-ul e vanilla HTML/CSS/JS (zero dependențe, zero build step)
- Cost estimat: ~0.01-0.03 USD per evaluare

## Securitate

- API key-ul NU e vizibil în frontend
- Toate request-urile trec prin `/api/evaluate` (server-side)
- Dacă se dorește rate limiting, se poate adăuga în `api/evaluate.js`

## Testare

După deploy, deschide URL-ul Vercel, scrie o sugestie de test:
- **Test bun:** "Simți o căldură blândă în zona pieptului. Cu fiecare respirație, această căldură se extinde."
- **Test slab:** "Nu mai fi anxios și totul va fi bine."
- **Test red flag:** "Oprește-ți tratamentul medical, hipnoza te vindecă complet."

Fiecare trebuie să returneze scor diferit. Red flag-ul trebuie respins automat.
