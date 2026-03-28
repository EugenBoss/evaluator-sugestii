// ============================================
// SUPABASE AUTH MODULE — supabase-auth.js
// Email + Password auth (replaces OTP gates)
// ============================================

(function () {
  'use strict';

  let _sb = null;
  let _sbUser = null;
  let _sbProfile = null;
  let _effectiveTier = 'anonymous';
  let _authReady = false;
  let _initPromise = null;

  async function initSupabaseAuth() {
    if (_initPromise) return _initPromise;
    _initPromise = _doInit();
    return _initPromise;
  }

  async function _doInit() {
    try {
      const cfgRes = await fetch('/api/config');
      const cfg = await cfgRes.json();
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { _authReady = true; return; }
      if (!window.supabase || !window.supabase.createClient) { _authReady = true; return; }

      _sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      _handleUrlParams();

      const { data: { session } } = await _sb.auth.getSession();
      if (session) {
        _sbUser = session.user;
        await _loadProfile();
      }

      _sb.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          _sbUser = session.user;
          await _loadProfile();
          _updateUI();
          if (window._pendingTierAfterAuth) {
            const tier = window._pendingTierAfterAuth;
            window._pendingTierAfterAuth = null;
            setTierDirect(tier);
          }
        } else if (event === 'SIGNED_OUT') {
          _sbUser = null; _sbProfile = null; _effectiveTier = 'anonymous';
          _updateUI();
        }
      });

      _authReady = true;
      _updateUI();
    } catch (err) {
      console.error('Auth init error:', err);
      _authReady = true;
    }
  }

  function _handleUrlParams() {
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    if (hash && hash.includes('error=')) history.replaceState(null, '', window.location.pathname);
    if (params.get('upgraded') === '1') {
      history.replaceState(null, '', window.location.pathname);
      setTimeout(() => _showNotification('✅ Premium activat! Bine ai venit.', 'success'), 1000);
    }
  }

  async function _loadProfile() {
    if (!_sb || !_sbUser) return;
    try {
      const { data, error } = await _sb.from('profiles').select('*').eq('id', _sbUser.id).single();
      if (error) { _sbProfile = null; _effectiveTier = 'free'; return; }
      _sbProfile = data;
      _effectiveTier = _computeEffectiveTier(data);
    } catch (err) { _effectiveTier = 'free'; }
  }

  function _computeEffectiveTier(p) {
    if (!p) return 'anonymous';
    if (p.training_access) return 'premium';
    if (p.pm_subscription_tier === 'inner_circle') return 'premium';
    if (p.stripe_subscription_status === 'active') return 'premium';
    if (p.trial_active && new Date(p.trial_expires_at) > new Date()) return 'premium';
    return 'free';
  }

  async function signUp(email, password) {
    if (!_sb) return { error: 'Nu s-a inițializat.' };
    const { data, error } = await _sb.auth.signUp({ email: email.trim().toLowerCase(), password });
    if (error) return { error: error.message };
    return { ok: true, user: data.user };
  }

  async function signIn(email, password) {
    if (!_sb) return { error: 'Nu s-a inițializat.' };
    const { data, error } = await _sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) return { error: error.message };
    return { ok: true, user: data.user };
  }

  async function signOut() {
    if (_sb) await _sb.auth.signOut();
    ['eval_lead_ok','eval_expert_ok','eval_lead_name','eval_lead_email','eval_lead_phone'].forEach(k => localStorage.removeItem(k));
    window.location.reload();
  }

  async function startCheckout(plan) {
    if (!_sbUser) return;
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, email: _sbUser.email, user_id: _sbUser.id }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert('Eroare la checkout. Încearcă din nou.');
    } catch (err) { alert('Eroare la checkout. Încearcă din nou.'); }
  }

  // --- UI ---
  function _updateUI() {
    _updateAccountBadge();
    if (_sbUser) {
      const appTier = _effectiveTier === 'premium' ? 'expert' : 'avansat';
      if (typeof window.currentTier !== 'undefined') {
        if (window.currentTier === 'basic') setTierDirect(appTier);
        else if (window.currentTier === 'avansat' && _effectiveTier === 'premium') setTierDirect('expert');
      }
    }
    _updateTierButtons();
  }

  function setTierDirect(tierVal) {
    if (typeof window.currentTier === 'undefined') return;
    window.currentTier = tierVal;
    document.querySelectorAll('.tier-toggle button').forEach(x => x.classList.remove('active'));
    const idx = tierVal === 'basic' ? 0 : tierVal === 'avansat' ? 1 : 2;
    const btns = document.querySelectorAll('.tier-toggle button');
    if (btns[idx]) btns[idx].classList.add('active');
    if (typeof updateCharCount === 'function') updateCharCount();
    if (typeof updateUsageMeter === 'function') updateUsageMeter();
  }

  function _updateAccountBadge() {
    let badge = document.getElementById('authBadge');
    if (!badge) {
      const nav = document.querySelector('.nav-items') || document.querySelector('nav');
      if (!nav) return;
      badge = document.createElement('div');
      badge.id = 'authBadge';
      badge.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:8px;font-size:0.82rem;flex-wrap:wrap;';
      nav.appendChild(badge);
    }

    if (_sbUser) {
      const tierLabel = _effectiveTier === 'premium' ? '⭐ Premium' : 'Free';
      const tierColor = _effectiveTier === 'premium' ? 'var(--accent-gold)' : 'var(--accent-blue)';
      let trialInfo = '';
      if (_sbProfile && _sbProfile.trial_active && _effectiveTier === 'premium'
        && _sbProfile.stripe_subscription_status !== 'active' && !_sbProfile.training_access) {
        const daysLeft = Math.max(0, Math.ceil((new Date(_sbProfile.trial_expires_at) - new Date()) / 86400000));
        if (daysLeft > 0) trialInfo = `<span style="font-size:0.72rem;color:var(--accent-orange);margin-left:4px">(trial: ${daysLeft} zile)</span>`;
      }
      badge.innerHTML = `
        <span style="color:${tierColor};font-weight:600">${tierLabel}</span>${trialInfo}
        <span style="color:var(--text-muted);font-size:0.78rem">${_sbUser.email}</span>
        <button onclick="window._sbAuth.signOut()" style="padding:4px 10px;border:1px solid var(--border-card);border-radius:6px;background:transparent;color:var(--text-secondary);font-size:0.75rem;cursor:pointer;font-family:var(--font-main)">Logout</button>
      `;
    } else {
      badge.innerHTML = `
        <button onclick="window._sbAuth.showAuthModal('signup')" style="padding:6px 14px;border:none;border-radius:6px;background:var(--accent-blue);color:#0f1f28;font-size:0.82rem;font-weight:600;cursor:pointer;font-family:var(--font-main)">Cont gratuit →</button>
        <button onclick="window._sbAuth.showAuthModal('login')" style="padding:6px 14px;border:1px solid var(--border-card);border-radius:6px;background:transparent;color:var(--text-secondary);font-size:0.82rem;cursor:pointer;font-family:var(--font-main)">Intră în cont</button>
      `;
    }
  }

  function _updateTierButtons() {
    const btns = document.querySelectorAll('.tier-toggle button');
    if (btns.length < 3) return;
    if (_effectiveTier === 'premium') btns[2].textContent = btns[2].textContent.replace(' 🔒', '');
    if (_sbUser) btns[1].textContent = btns[1].textContent.replace(' 🔒', '');
  }

  // --- AUTH MODAL ---
  function showAuthModal(mode, onSuccess) {
    const existing = document.getElementById('sbAuthModal');
    if (existing) existing.remove();
    const isSignup = mode === 'signup';
    const isRo = !window.currentLang || window.currentLang === 'ro';

    const title = isSignup ? (isRo ? 'Creează cont gratuit' : 'Create free account') : (isRo ? 'Intră în cont' : 'Log in');
    const subtitle = isSignup
      ? (isRo ? 'Evaluare pe 9 criterii + versiune îmbunătățită + explicații detaliate.<br>Plus <strong>7 zile gratuit de Premium</strong> cu toate cele 17 criterii.' : 'Evaluation on 9 criteria + improved version + detailed explanations.<br>Plus <strong>7 days free Premium</strong> with all 17 criteria.')
      : (isRo ? 'Intră în contul tău pentru a accesa evaluarea avansată.' : 'Log in to access advanced evaluation.');
    const btnText = isSignup ? (isRo ? 'Creează cont →' : 'Create account →') : (isRo ? 'Intră în cont →' : 'Log in →');
    const switchText = isSignup
      ? (isRo ? 'Ai deja cont? <a href="#" id="sbSwitchMode" style="color:var(--accent-blue);text-decoration:none;font-weight:600">Intră în cont</a>' : 'Already have an account? <a href="#" id="sbSwitchMode" style="color:var(--accent-blue);text-decoration:none;font-weight:600">Log in</a>')
      : (isRo ? 'Nu ai cont? <a href="#" id="sbSwitchMode" style="color:var(--accent-blue);text-decoration:none;font-weight:600">Creează cont gratuit</a>' : 'No account? <a href="#" id="sbSwitchMode" style="color:var(--accent-blue);text-decoration:none;font-weight:600">Create free account</a>');

    const modal = document.createElement('div');
    modal.id = 'sbAuthModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.3s ease';
    modal.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border-card);border-radius:var(--radius);padding:32px 28px;max-width:420px;width:100%;position:relative">
        <button onclick="document.getElementById('sbAuthModal').remove()" style="position:absolute;top:12px;right:12px;border:none;background:none;color:var(--text-muted);font-size:1.2rem;cursor:pointer">✕</button>
        <div style="text-align:center;margin-bottom:20px">
          ${isSignup ? '<div style="font-size:0.72rem;font-weight:600;color:var(--accent-blue);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">' + (isRo ? 'Cont gratuit' : 'Free account') + '</div>' : ''}
          <h3 style="font-size:1.1rem;font-weight:700;color:var(--text-heading);margin:0 0 6px">${title}</h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0">${subtitle}</p>
        </div>
        <div id="sbAuthForm">
          <label style="display:block;font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Email</label>
          <input type="email" id="sbAuthEmail" placeholder="${isRo ? 'adresa@email.com' : 'your@email.com'}" style="width:100%;padding:12px 14px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-size:0.92rem;font-family:var(--font-main);box-sizing:border-box;margin-bottom:12px">
          <label style="display:block;font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px">${isRo ? 'Parolă' : 'Password'}${isSignup ? ' <span style="font-weight:400;color:var(--text-muted)">(min. 6 caractere)</span>' : ''}</label>
          <input type="password" id="sbAuthPassword" placeholder="${isSignup ? (isRo ? 'Alege o parolă' : 'Choose a password') : (isRo ? 'Parola ta' : 'Your password')}" style="width:100%;padding:12px 14px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-size:0.92rem;font-family:var(--font-main);box-sizing:border-box" onkeydown="if(event.key==='Enter')window._sbAuth.doAuth('${mode}')">
          <div id="sbAuthError" style="display:none;color:var(--accent-red);font-size:0.82rem;margin-top:8px"></div>
          <div id="sbAuthSuccess" style="display:none;color:var(--accent-green);font-size:0.82rem;margin-top:8px"></div>
          <button onclick="window._sbAuth.doAuth('${mode}')" id="sbAuthBtn" style="width:100%;margin-top:14px;padding:12px;border:none;border-radius:var(--radius-sm);background:var(--accent-blue);color:#0f1f28;font-size:0.92rem;font-weight:700;cursor:pointer;font-family:var(--font-main)">${btnText}</button>
          <div style="text-align:center;margin-top:14px;font-size:0.82rem;color:var(--text-muted)">${switchText}</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('sbAuthEmail').focus();
    setTimeout(() => {
      const sw = document.getElementById('sbSwitchMode');
      if (sw) sw.addEventListener('click', (e) => { e.preventDefault(); modal.remove(); showAuthModal(isSignup ? 'login' : 'signup', onSuccess); });
    }, 50);
    window._authSuccessCallback = onSuccess || null;
  }

  async function doAuth(mode) {
    const email = document.getElementById('sbAuthEmail').value.trim();
    const password = document.getElementById('sbAuthPassword').value;
    const errorDiv = document.getElementById('sbAuthError');
    const successDiv = document.getElementById('sbAuthSuccess');
    const btn = document.getElementById('sbAuthBtn');
    const isRo = !window.currentLang || window.currentLang === 'ro';
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorDiv.textContent = isRo ? 'Introdu o adresă de email validă.' : 'Enter a valid email.';
      errorDiv.style.display = 'block'; return;
    }
    if (!password || password.length < 6) {
      errorDiv.textContent = isRo ? 'Parola trebuie să aibă minim 6 caractere.' : 'Password must be at least 6 characters.';
      errorDiv.style.display = 'block'; return;
    }

    btn.disabled = true;
    btn.textContent = isRo ? 'Se procesează...' : 'Processing...';

    const result = mode === 'signup' ? await signUp(email, password) : await signIn(email, password);

    if (result.error) {
      let msg = result.error;
      if (isRo) {
        if (msg.includes('already registered') || msg.includes('already been registered')) msg = 'Acest email are deja cont. Intră în cont.';
        else if (msg.includes('Invalid login')) msg = 'Email sau parolă incorecte.';
        else if (msg.includes('Email not confirmed')) msg = 'Contul nu a fost confirmat încă.';
        else if (msg.includes('rate limit')) msg = 'Prea multe încercări. Așteaptă un minut.';
      }
      errorDiv.textContent = msg;
      errorDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = mode === 'signup' ? (isRo ? 'Creează cont →' : 'Create account →') : (isRo ? 'Intră în cont →' : 'Log in →');
      return;
    }

    successDiv.textContent = mode === 'signup' ? (isRo ? '✅ Cont creat! Se încarcă...' : '✅ Account created!') : (isRo ? '✅ Conectat! Se încarcă...' : '✅ Logged in!');
    successDiv.style.display = 'block';
    localStorage.setItem('eval_lead_email', email);
    localStorage.setItem('eval_lead_ok', '1');
    setTimeout(() => { const m = document.getElementById('sbAuthModal'); if (m) m.remove(); }, 800);
  }

  // --- PREMIUM MODAL ---
  function showPremiumModal() {
    const existing = document.getElementById('sbPremiumModal');
    if (existing) existing.remove();
    const isRo = !window.currentLang || window.currentLang === 'ro';
    let trialText = '';
    if (_sbProfile && _sbProfile.trial_active && _effectiveTier === 'premium' && _sbProfile.stripe_subscription_status !== 'active' && !_sbProfile.training_access) {
      const d = Math.max(0, Math.ceil((new Date(_sbProfile.trial_expires_at) - new Date()) / 86400000));
      trialText = isRo ? `Ai încă ${d} zile de trial Premium gratuit.` : `You have ${d} days of free Premium trial left.`;
    }
    const modal = document.createElement('div');
    modal.id = 'sbPremiumModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.3s ease';
    modal.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border-card);border-radius:var(--radius);padding:32px 28px;max-width:520px;width:100%;position:relative">
        <button onclick="document.getElementById('sbPremiumModal').remove()" style="position:absolute;top:12px;right:12px;border:none;background:none;color:var(--text-muted);font-size:1.2rem;cursor:pointer">✕</button>
        <div style="text-align:center;margin-bottom:20px">
          <div style="font-size:0.72rem;font-weight:600;color:var(--accent-gold);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">PREMIUM</div>
          <h3 style="font-size:1.1rem;font-weight:700;color:var(--text-heading);margin:0 0 8px">${isRo ? 'Deblochează evaluarea Expert' : 'Unlock Expert evaluation'}</h3>
          ${trialText ? `<p style="font-size:0.82rem;color:var(--accent-orange);margin:0 0 8px">${trialText}</p>` : ''}
          <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0">${isRo ? '17 criterii ponderate · Analiză NLP · Radar chart · Script autohipnoză săptămânal · Afirmație zilnică personalizată' : '17 weighted criteria · NLP Analysis · Radar chart · Weekly script · Daily affirmation'}</p>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div onclick="window._sbAuth.startCheckout('monthly')" style="padding:20px 16px;border:1px solid rgba(246,212,76,0.3);border-radius:var(--radius-sm);cursor:pointer;text-align:center;transition:all 0.2s" onmouseover="this.style.borderColor='var(--accent-gold)'" onmouseout="this.style.borderColor='rgba(246,212,76,0.3)'">
            <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:4px">${isRo ? 'Lunar' : 'Monthly'}</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--accent-gold)">49 RON</div>
            <div style="font-size:0.78rem;color:var(--text-muted)">/ ${isRo ? 'lună' : 'month'}</div>
          </div>
          <div onclick="window._sbAuth.startCheckout('annual')" style="padding:20px 16px;border:2px solid var(--accent-gold);border-radius:var(--radius-sm);cursor:pointer;text-align:center;transition:all 0.2s;background:rgba(246,212,76,0.04);position:relative" onmouseover="this.style.background='rgba(246,212,76,0.1)'" onmouseout="this.style.background='rgba(246,212,76,0.04)'">
            <div style="position:absolute;top:-10px;right:12px;background:var(--accent-gold);color:#0f1f28;font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:10px">-32%</div>
            <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:4px">${isRo ? 'Anual' : 'Annual'}</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--accent-gold)">399 RON</div>
            <div style="font-size:0.78rem;color:var(--text-muted)">/ ${isRo ? 'an' : 'year'} (~33 RON/${isRo ? 'lună' : 'mo'})</div>
          </div>
        </div>
        <div style="text-align:center"><button onclick="document.getElementById('sbPremiumModal').remove()" style="padding:8px 16px;border:none;background:transparent;color:var(--text-muted);font-size:0.82rem;cursor:pointer;font-family:var(--font-main)">${isRo ? 'Poate mai târziu' : 'Maybe later'}</button></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function _showNotification(text, type) {
    const n = document.createElement('div');
    n.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:14px 24px;border-radius:10px;font-size:0.88rem;font-weight:600;z-index:1000;animation:fadeIn 0.3s ease;font-family:var(--font-main);${type === 'success' ? 'background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.4);color:#4CAF50' : 'background:rgba(231,76,94,0.15);border:1px solid rgba(231,76,94,0.4);color:#E74C5E'}`;
    n.textContent = text;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 4000);
  }

  // --- OVERRIDES ---
  window.hasLeadAccess = function () { return _sbUser ? true : localStorage.getItem('eval_lead_ok') === '1'; };
  window.hasExpertAccess = function () { return _effectiveTier === 'premium' ? true : localStorage.getItem('eval_expert_ok') === '1'; };
  window.showLeadGate = function (cb) { if (_sbUser) { if (cb) cb(); return; } window._pendingTierAfterAuth = 'avansat'; showAuthModal('signup', cb); };
  window.showExpertGate = function (cb) {
    if (!_sbUser) { window._pendingTierAfterAuth = 'expert'; showAuthModal('signup', cb); return; }
    if (_effectiveTier === 'premium') { if (cb) cb(); return; }
    showPremiumModal();
  };
  const _orig = window.getEvalEmail;
  window.getEvalEmail = function () { if (_sbUser) return _sbUser.email; if (_orig) return _orig(); return localStorage.getItem('eval_lead_email') || ''; };

  // --- PUBLIC API ---
  window._sbAuth = {
    init: initSupabaseAuth, showAuthModal, showPremiumModal, doAuth, signUp, signIn, signOut, startCheckout,
    getUser: () => _sbUser, getProfile: () => _sbProfile, getEffectiveTier: () => _effectiveTier, isReady: () => _authReady, refreshProfile: _loadProfile,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSupabaseAuth);
  else initSupabaseAuth();
})();
