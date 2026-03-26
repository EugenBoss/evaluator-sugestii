// ============================================
// course_recommender_v2.js
// Motor de recomandări cursuri + lecții — Puterea Minții
// Versiune 2.0 — Integrare MASTER_catalog_v4 (4352 intrări)
// ============================================

// ===== CONFIGURARE EZYCOURSE =====
const EZYCOURSE_URLS = {
  membership: 'https://putereamintii.ro/cursuri',
  courses: {
    'Regresia Hipnotică 2023 — Curs și Practică': 'https://app.ezycourse.com/putereamintii/regresia-hipnotica',
    'Hipnoza Directivă — Elman 2016': 'https://app.ezycourse.com/putereamintii/hipnoza-elman',
    'Copilul Interior': 'https://app.ezycourse.com/putereamintii/copilul-interior',
    'Autohipnoză': 'https://app.ezycourse.com/putereamintii/autohipnoza',
    'Terapia Yageriană': 'https://app.ezycourse.com/putereamintii/terapia-yageriana',
    'NLP Practitioner': 'https://app.ezycourse.com/putereamintii/nlp-practitioner',
    'MindFlow': 'https://app.ezycourse.com/putereamintii/mindflow',
    'Coaching': 'https://app.ezycourse.com/putereamintii/coaching',
    'Metoda PACE': 'https://app.ezycourse.com/putereamintii/metoda-pace',
    'Protocolul CALM': 'https://app.ezycourse.com/putereamintii/protocolul-calm',
    'Rewind Technique': 'https://app.ezycourse.com/putereamintii/rewind',
    'LAB Profile': 'https://app.ezycourse.com/putereamintii/lab-profile',
    'Hipnoza Esențial': 'https://app.ezycourse.com/putereamintii/hipnoza-esential',
    // Adaugă restul cursurilor când ai slug-urile reale
  },
  training_hipnoza: 'https://putereamintii.ro/training-hipnoza',
  curs_coaching: 'https://putereamintii.ro/curs-coaching',
  default: 'https://putereamintii.ro/cursuri'
};

// ===== BAZE DE DATE =====
let _engineDB = null;   // course_recommendations_engine_v2.json
let _catalogDB = null;  // MASTER_catalog_v4.json (intrări individuale)
let _loading = { engine: false, catalog: false };

async function loadEngineDB() {
  if (_engineDB) return _engineDB;
  if (_loading.engine) {
    return new Promise(resolve => {
      const check = setInterval(() => {
        if (_engineDB) { clearInterval(check); resolve(_engineDB); }
      }, 100);
    });
  }
  _loading.engine = true;
  try {
    const resp = await fetch('/data/course_recommendations_engine_v2.json');
    if (!resp.ok) throw new Error('Failed to load engine DB');
    _engineDB = await resp.json();
    return _engineDB;
  } catch (e) {
    console.error('Engine DB load error:', e);
    _engineDB = getFallbackDB();
    return _engineDB;
  } finally {
    _loading.engine = false;
  }
}

async function loadCatalogDB() {
  if (_catalogDB) return _catalogDB;
  if (_loading.catalog) {
    return new Promise(resolve => {
      const check = setInterval(() => {
        if (_catalogDB) { clearInterval(check); resolve(_catalogDB); }
      }, 100);
    });
  }
  _loading.catalog = true;
  try {
    const resp = await fetch('/data/MASTER_catalog_v4.json');
    if (!resp.ok) throw new Error('Failed to load catalog DB');
    const raw = await resp.json();
    // Support compact format (keys: e, t, c, cp, tm, d, n, l, demo, caz)
    if (raw.e && !raw.intrari) {
      _catalogDB = {
        intrari: raw.e.map(e => ({
          id: e.id,
          titlu_descriptiv: e.t,
          curs_parinte: e.c,
          tip_continut: e.tc,
          durata_estimata_minute: e.d,
          nivel: e.n,
          categorii_probleme: e.cp,
          tehnici_metode: e.tm,
          metadate: { limba: e.l, contine_demonstratie_live: e.demo, contine_caz_real: e.caz }
        }))
      };
    } else {
      _catalogDB = raw;
    }
    return _catalogDB;
  } catch (e) {
    console.error('Catalog DB load error:', e);
    _catalogDB = { intrari: [] };
    return _catalogDB;
  } finally {
    _loading.catalog = false;
  }
}

// Preload ambele DB-uri
function preloadDatabases() {
  loadEngineDB();
  loadCatalogDB();
}

// ===== DETECȚIE CATEGORIE DIN TEXT =====
const CATEGORY_KEYWORDS = {
  anxietate: ['anxietate','anxios','anxioasă','frică','frica','teamă','panică','panica','neliniște','neliniste','îngrijorare','ingrijorare','tensiune','agitație','agitatie','fobii','fobie','îmi e frică','imi e frica','mă sperie','ma sperie','palpitații','palpitatii','transpir','tremur','sufoc','gât strâns','gat strans'],
  relatii: ['relație','relatie','cuplu','partener','parteneră','soț','soție','sot','sotie','iubire','despărțire','despartire','divorț','divort','înșelat','inselat','trădat','tradat','abandon','comunicare','conflict','ceartă','cearta','atașament','atasament','dependență afectivă','dependenta afectiva','toxică','toxic'],
  stima: ['stimă','stima','încredere','incredere','valoare','nu merit','nu sunt destul','nu sunt suficient','neîncredere','neincredere','inferioritate','rușine','rusine','vinovăție','vinovatie','critic interior','judecata','judecată','respingere','aprobare','validare','nu mă accept','nu ma accept'],
  trauma: ['traumă','trauma','copil interior','copilul interior','rană','rana','vindecare','trecut','amintire','durere','abuz','neglijare','abandon','atașament','atasament','flashback','coșmar','cosmar','corp','trup','protecție','protectie','supraviețuire','supravietuire','regresie','parte din mine'],
  depresie: ['depresie','deprimat','trist','tristă','tristețe','tristete','lipsă de sens','lipsa de sens','vid','gol interior','deznădejde','deznadejde','apatie','oboseală','oboseala','nu mai pot','nu mai vreau','degeaba','fără speranță','fara speranta','letargie','plâng','plang','izolare'],
  burnout: ['burnout','epuizare','epuizat','suprasolicitare','oboseală cronică','oboseala cronica','nu mai pot','nu mai am energie','stres','stres cronic','la capăt','la capat','copleșit','coplesit','overwhelm','suprasarcină','suprasarcina','istovit'],
  procrastinare: ['procrastin','amân','aman','motivație','motivatie','lipsă de motivație','lipsa de motivatie','lene','disciplină','disciplina','obiectiv','scop','start','nu încep','nu incep','auto-sabotaj','sabotaj','blocat','blocaj','perfectionism'],
  singuratate: ['singurătate','singuratate','singur','singură','izolare','izolat','deconectat','neînțeles','neinteles','nu aparțin','nu apartin','exclus','marginalizat','niciun prieten','fără prieteni','fara prieteni'],
  dependente: ['dependență','dependenta','adicție','addictie','compulsiv','alcool','fumat','jocuri','gaming','pornografie','mâncat compulsiv','mancat compulsiv','shopping','drog','substanță','substanta','obicei','autodistructiv'],
  bani: ['bani','financiar','datorii','sărăcie','saracie','abundență','abundenta','lipsă','lipsa','nu câștig','nu castig','sabotaj financiar','cheltuiesc','economisesc','investiție','investitie','securitate','prosperitate','bogăție','bogatie'],
  sanatate: ['sănătate','sanatate','corp','fizic','durere','boală','boala','energie','oboseală','oboseala','imunitate','greutate','slăbit','slabit','somn','insomnie','alimentație','alimentatie','exercițiu','exercitiu'],
  trauma_morala: ['valori','valoare morală','valoare morala','conflict interior','dilemă','dilema','vinovăție morală','vinovatie morala','dreptate','nedreptate','etică','etica','corect','greșit','gresit','principii','compromis','integritate','conștiință','constiinta']
};

// Map internal keys to MASTER_catalog category names
const CATEGORY_MAP = {
  anxietate: 'Anxietate frici și atacuri de panică',
  relatii: 'Probleme relaționale și de cuplu',
  stima: 'Stimă de sine și încredere în sine',
  trauma: 'Traumă și copil interior',
  depresie: 'Depresie tristețe cronică și lipsă de sens',
  burnout: 'Burnout și epuizare cronică',
  procrastinare: 'Procrastinare și lipsă de motivație',
  singuratate: 'Singurătate și izolare socială',
  dependente: 'Dependențe și comportamente compulsive',
  bani: 'Relație cu banii și securitate materială',
  sanatate: 'Sănătate fizică și energie',
  trauma_morala: 'Traumă morală și conflict de valori'
};

function detectCategoriesFromText(text) {
  if (!text) return [];
  const enIndicators = /\b(the|and|you|your|with|this|that|from|feel|are|can|will)\b/i;
  if (enIndicators.test(text)) return [];

  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ');
  const tOriginal = text.toLowerCase();
  const scores = {};

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      const kwNorm = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (t.includes(kwNorm) || tOriginal.includes(kw)) {
        score += kw.includes(' ') ? 3 : 1;
      }
    }
    if (score > 0) scores[cat] = score;
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);
}

// ===== RECOMANDĂRI CURSURI (din engine) =====
async function getCourseRecommendations(suggestionText, aiDetectedCategories) {
  const db = await loadEngineDB();
  if (!db || !db.categories) return [];

  const isEnglish = /\b(the|and|you|your|with|this|that|from|feel|are|can|will)\b/i.test(suggestionText);
  if (isEnglish) return [];

  let categories = (aiDetectedCategories && aiDetectedCategories.length > 0)
    ? aiDetectedCategories
    : detectCategoriesFromText(suggestionText);

  if (categories.length === 0) return [];

  const recommendations = [];
  const seenCourses = new Set();

  for (const cat of categories) {
    const catData = db.categories[cat];
    if (!catData || !catData.top_courses) continue;

    for (const course of catData.top_courses.slice(0, 4)) {
      if (seenCourses.has(course.curs)) continue;
      if (recommendations.length >= 6) break;

      seenCourses.add(course.curs);
      const leaning = course.hipnoza_pct > 60 ? 'hipnoza' :
                       course.coaching_pct > 60 ? 'coaching' : 'ambele';

      recommendations.push({
        type: 'course',
        curs: course.curs,
        categorie: cat,
        categorie_label: catData.label_ro || cat,
        entries: course.entries,
        sample_titles: course.sample_titles || [],
        leaning, hipnoza_pct: course.hipnoza_pct, coaching_pct: course.coaching_pct,
        url: getCourseUrl(course.curs)
      });
    }
  }
  return recommendations;
}

// ===== RECOMANDĂRI LECȚII SPECIFICE (din catalog) =====
async function getLessonRecommendations(suggestionText, aiDetectedCategories, maxResults = 5) {
  const catalog = await loadCatalogDB();
  if (!catalog || !catalog.intrari) return [];

  let categories = (aiDetectedCategories && aiDetectedCategories.length > 0)
    ? aiDetectedCategories
    : detectCategoriesFromText(suggestionText);

  // Map short keys to full MASTER_catalog category names
  const fullCatNames = categories.map(c => CATEGORY_MAP[c] || c);

  if (fullCatNames.length === 0) return [];

  // Score each entry based on category match + text relevance
  const keywords = extractKeywords(suggestionText);
  const scored = [];

  for (const entry of catalog.intrari) {
    let score = 0;

    // Category match (primary signal)
    for (const cat of (entry.categorii_probleme || [])) {
      if (fullCatNames.includes(cat)) score += 10;
    }
    if (score === 0) continue; // No category match

    // Keyword match in title + summary (secondary signal)
    const entryText = ((entry.titlu_descriptiv || '') + ' ' + (entry.sumar_continut || '')).toLowerCase();
    for (const kw of keywords) {
      if (entryText.includes(kw)) score += 2;
    }

    // Bonus for content with demos/cases
    if (entry.metadate?.contine_demonstratie_live) score += 3;
    if (entry.metadate?.contine_caz_real) score += 2;

    // Bonus for Romanian content
    if (entry.metadate?.limba === 'ro') score += 1;

    // Bonus for longer content (more substantive)
    if (entry.durata_estimata_minute >= 30) score += 2;
    else if (entry.durata_estimata_minute >= 15) score += 1;

    // Penalty for very short content
    if (entry.durata_estimata_minute < 5) score -= 3;

    scored.push({ entry, score });
  }

  // Sort by score, deduplicate by course, take top N
  scored.sort((a, b) => b.score - a.score);

  const results = [];
  const seenCourses = new Set();

  for (const { entry, score } of scored) {
    // Max 2 lessons per course to ensure diversity
    const courseKey = entry.curs_parinte;
    const courseCount = [...results].filter(r => r.curs_parinte === courseKey).length;
    if (courseCount >= 2) continue;

    results.push({
      type: 'lesson',
      id: entry.id,
      titlu: entry.titlu_descriptiv,
      curs_parinte: entry.curs_parinte,
      tip_continut: entry.tip_continut,
      durata: entry.durata_estimata_minute,
      nivel: entry.nivel,
      categorii: entry.categorii_probleme,
      tehnici: entry.tehnici_metode,
      sumar: (entry.sumar_continut || '').substring(0, 200),
      has_demo: entry.metadate?.contine_demonstratie_live || false,
      has_case: entry.metadate?.contine_caz_real || false,
      limba: entry.metadate?.limba || 'ro',
      url: getCourseUrl(entry.curs_parinte),
      score
    });

    if (results.length >= maxResults) break;
  }

  return results;
}

function extractKeywords(text) {
  const stopwords = new Set(['și','sau','dar','că','de','la','în','pe','cu','un','o','ce','am','ai','nu','este','sunt','mai','din','se','ca','eu','tu','el','ea','ne','le','lor','meu','mea','acest','această','pentru','care','a','fi','fost','avea','prin','despre','după','când','cum','unde','într','într-o','într-un']);
  return text.toLowerCase()
    .replace(/[^\w\sàâăîșțéèê]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w));
}

// ===== COMBINARE: CURSURI + LECȚII =====
async function getRecommendations(suggestionText, aiDetectedCategories) {
  const [courses, lessons] = await Promise.all([
    getCourseRecommendations(suggestionText, aiDetectedCategories),
    getLessonRecommendations(suggestionText, aiDetectedCategories, 5)
  ]);

  return { courses, lessons };
}

// ===== URL HELPERS =====
function getCourseUrl(courseName) {
  if (EZYCOURSE_URLS.courses[courseName]) return EZYCOURSE_URLS.courses[courseName];
  const nameL = courseName.toLowerCase();
  const hipnozaKw = ['hipnoz', 'elman', 'regres', 'inducti', 'terapia', 'autohipnoz', 'rewind'];
  const coachingKw = ['coaching', 'coach', 'nlp', 'master', 'lab'];
  if (hipnozaKw.some(k => nameL.includes(k))) return EZYCOURSE_URLS.training_hipnoza;
  if (coachingKw.some(k => nameL.includes(k))) return EZYCOURSE_URLS.curs_coaching;
  return EZYCOURSE_URLS.default;
}

// ===== RENDER CURSURI =====
function renderCourseCards(courses, lang) {
  if (!courses || courses.length === 0) return '';
  const isRo = (lang || 'ro') === 'ro';

  let html = `
<div class="rec-section" style="margin-top:20px">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
    <div style="width:40px;height:40px;border-radius:10px;background:rgba(246,212,76,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    </div>
    <div>
      <h3 style="font-size:1.05rem;font-weight:700;color:var(--accent-gold);margin:0">
        ${isRo ? 'Cursuri recomandate' : 'Recommended courses'}
      </h3>
      <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">
        ${isRo ? 'Bazat pe tema sugestiei tale' : 'Based on your suggestion topic'}
      </div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">`;

  for (const rec of courses.slice(0, 4)) {
    const icon = rec.leaning === 'hipnoza' ? '🧠' : rec.leaning === 'coaching' ? '🎯' : '🔄';
    const label = rec.leaning === 'hipnoza' ? (isRo ? 'Hipnoză' : 'Hypnosis') :
                  rec.leaning === 'coaching' ? 'Coaching' : (isRo ? 'Hipnoză + Coaching' : 'Hypnosis + Coaching');

    html += `
    <a href="${rec.url}" target="_blank" rel="noopener"
       style="display:block;text-decoration:none;background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:16px;transition:all 0.25s;cursor:pointer"
       onmouseover="this.style.borderColor='rgba(246,212,76,0.4)';this.style.transform='translateY(-2px)'"
       onmouseout="this.style.borderColor='var(--border-subtle)';this.style.transform='none'">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:1.1rem">${icon}</span>
        <span style="font-size:0.7rem;font-weight:600;color:var(--accent-gold);text-transform:uppercase;letter-spacing:0.06em">${label}</span>
      </div>
      <div style="font-size:0.92rem;font-weight:600;color:var(--text-heading);line-height:1.4;margin-bottom:6px">
        ${escapeHtml(rec.curs)}
      </div>
      <div style="font-size:0.78rem;color:var(--text-muted);line-height:1.5;margin-bottom:10px">
        ${rec.entries} ${isRo ? 'lecții relevante' : 'relevant lessons'}
      </div>
      <div style="font-size:0.82rem;font-weight:600;color:var(--accent-blue);display:flex;align-items:center;gap:4px">
        ${isRo ? 'Vezi cursul' : 'View course'} →
      </div>
    </a>`;
  }

  html += `</div></div>`;
  return html;
}

// ===== RENDER LECȚII SPECIFICE =====
function renderLessonCards(lessons, lang) {
  if (!lessons || lessons.length === 0) return '';
  const isRo = (lang || 'ro') === 'ro';

  let html = `
<div class="rec-section" style="margin-top:16px">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
    <div style="width:36px;height:36px;border-radius:10px;background:rgba(52,152,219,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
    </div>
    <div>
      <h3 style="font-size:0.95rem;font-weight:700;color:var(--accent-blue);margin:0">
        ${isRo ? 'Lecții specifice recomandate' : 'Specific recommended lessons'}
      </h3>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">
        ${isRo ? 'Conținut direct relevant pentru problema ta' : 'Content directly relevant to your issue'}
      </div>
    </div>
  </div>
  <div style="display:flex;flex-direction:column;gap:8px">`;

  for (const lesson of lessons.slice(0, 5)) {
    const badges = [];
    if (lesson.has_demo) badges.push(isRo ? '🎬 Demo live' : '🎬 Live demo');
    if (lesson.has_case) badges.push(isRo ? '📋 Caz real' : '📋 Real case');
    if (lesson.durata) badges.push(`⏱ ${lesson.durata} min`);

    const techStr = (lesson.tehnici || []).slice(0, 3).join(', ');

    html += `
    <a href="${lesson.url}" target="_blank" rel="noopener"
       style="display:flex;gap:12px;align-items:flex-start;text-decoration:none;background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:12px 14px;transition:all 0.2s"
       onmouseover="this.style.borderColor='rgba(52,152,219,0.3)'"
       onmouseout="this.style.borderColor='var(--border-subtle)'">
      <div style="flex:1;min-width:0">
        <div style="font-size:0.88rem;font-weight:600;color:var(--text-heading);line-height:1.4;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${escapeHtml(lesson.titlu)}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px">
          ${escapeHtml(lesson.curs_parinte)}${techStr ? ' · ' + escapeHtml(techStr) : ''}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${badges.map(b => `<span style="font-size:0.65rem;padding:2px 6px;border-radius:10px;background:rgba(52,152,219,0.08);color:var(--accent-blue)">${b}</span>`).join('')}
        </div>
      </div>
      <div style="font-size:0.78rem;color:var(--accent-blue);white-space:nowrap;padding-top:2px">→</div>
    </a>`;
  }

  html += `</div></div>`;
  return html;
}

// ===== RENDER COMBINAT =====
function renderRecommendations(data, lang) {
  if (!data) return '';

  // Backwards compatible: dacă primește array (v1), convertește
  if (Array.isArray(data)) {
    return renderCourseCards(data, lang);
  }

  let html = '';
  html += renderCourseCards(data.courses, lang);
  html += renderLessonCards(data.lessons, lang);

  // Footer link
  const isRo = (lang || 'ro') === 'ro';
  html += `
<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle);display:flex;justify-content:flex-end">
  <a href="${EZYCOURSE_URLS.membership}" target="_blank" rel="noopener"
     style="font-size:0.82rem;font-weight:600;color:var(--accent-blue);text-decoration:none"
     onmouseover="this.style.textDecoration='underline'"
     onmouseout="this.style.textDecoration='none'">
    ${isRo ? 'Vezi toate cursurile' : 'View all courses'} →
  </a>
</div>`;

  return html;
}

// ===== HIGH-TICKET CTA =====
function renderHighTicketCTA(score, categories, lang) {
  if (score >= 70) return '';
  const isRo = (lang || 'ro') === 'ro';
  const hipnozaCats = ['anxietate', 'trauma', 'dependente', 'sanatate'];
  const coachingCats = ['procrastinare', 'bani', 'stima', 'burnout'];

  let h = 0, c = 0;
  for (const cat of (categories || [])) {
    if (hipnozaCats.includes(cat)) h++;
    if (coachingCats.includes(cat)) c++;
  }

  const isHipnoza = h >= c;
  const ctaUrl = isHipnoza ? EZYCOURSE_URLS.training_hipnoza : EZYCOURSE_URLS.curs_coaching;
  const ctaTitle = isHipnoza
    ? (isRo ? 'Training Profesional de Hipnoză' : 'Professional Hypnosis Training')
    : (isRo ? 'Cursul de Coaching' : 'Coaching Course');
  const ctaDesc = isHipnoza
    ? (isRo ? 'Învață să construiești sugestii hipnotice care produc schimbare reală. 4 module, practică supervizată, certificare.' : 'Learn to build hypnotic suggestions that create real change.')
    : (isRo ? 'Dezvoltă abilitățile de coaching care transformă. Metodologie structurată, practică reală, certificare.' : 'Develop coaching skills that transform.');

  return `
<div class="card" style="margin-top:16px;border-color:rgba(192,57,43,0.3);background:linear-gradient(135deg,var(--bg-card) 0%,rgba(192,57,43,0.04) 100%)">
  <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <div style="flex:1;min-width:220px">
      <div style="font-size:0.7rem;font-weight:600;color:var(--accent-red);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">
        ${isRo ? 'Pasul următor' : 'Next step'}
      </div>
      <div style="font-size:1.05rem;font-weight:700;color:var(--text-heading);margin-bottom:6px">${ctaTitle}</div>
      <div style="font-size:0.85rem;color:var(--text-secondary);line-height:1.6">${ctaDesc}</div>
    </div>
    <a href="${ctaUrl}" target="_blank" rel="noopener" class="btn-primary" style="white-space:nowrap;text-decoration:none">
      ${isRo ? 'Află mai multe' : 'Learn more'} →
    </a>
  </div>
</div>`;
}

// ===== UTILITAR =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function getFallbackDB() {
  return {
    categories: {
      anxietate: { label_ro: 'Anxietate, frici și atacuri de panică', top_courses: [] },
      relatii: { label_ro: 'Probleme relaționale', top_courses: [] },
      stima: { label_ro: 'Stimă de sine', top_courses: [] },
      trauma: { label_ro: 'Traumă și copil interior', top_courses: [] },
      depresie: { label_ro: 'Depresie', top_courses: [] },
      burnout: { label_ro: 'Burnout', top_courses: [] }
    }
  };
}

// ===== CHATBOT API =====
// Funcție expusă pentru chatbot-ul AnyChat
// Primește textul utilizatorului, returnează recomandări formatate
async function chatbotGetRecommendations(userMessage) {
  const categories = detectCategoriesFromText(userMessage);
  const { courses, lessons } = await getRecommendations(userMessage, categories);

  return {
    categories,
    courses: courses.slice(0, 3),
    lessons: lessons.slice(0, 5),
    highTicketUrl: getCourseUrl(courses[0]?.curs || ''),
    formattedText: formatForChatbot(courses, lessons, categories)
  };
}

function formatForChatbot(courses, lessons, categories) {
  let text = '';

  if (courses.length > 0) {
    text += 'Cursuri recomandate:\n';
    for (const c of courses.slice(0, 3)) {
      text += `• ${c.curs} (${c.entries} lecții relevante)\n`;
    }
  }

  if (lessons.length > 0) {
    text += '\nLecții specifice:\n';
    for (const l of lessons.slice(0, 3)) {
      text += `• "${l.titlu}" din ${l.curs_parinte}`;
      if (l.durata) text += ` (${l.durata} min)`;
      text += '\n';
    }
  }

  return text;
}

// ===== EXPORT =====
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getRecommendations, getCourseRecommendations, getLessonRecommendations,
    renderRecommendations, renderHighTicketCTA, chatbotGetRecommendations,
    detectCategoriesFromText, preloadDatabases, CATEGORY_MAP
  };
}
