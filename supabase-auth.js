// ============================================
// SUPABASE AUTH MODULE — supabase-auth.js
// Email + Password + OTP via Resend API
// ============================================

(function () {
  'use strict';

  let _sb = null;
  let _sbUser = null;
  let _sbProfile = null;
  let _effectiveTier = 'anonymous';
  let _authReady = false;
  let _initPromise = null;
  // OTP state
  let _otpToken = null;
  let _otpHmac = null;
  let _otpEmail = null;
  let _otpPassword = null;

  async function initSupabaseAuth() {
    if (_initPromise) return _initPromise;
    _initPromise = _doInit();
    return _initPromise;
  }

  async function _doInit() {
    try {
      // Load config - bypass cache explicitly
      let cfg;
      try {
        const cfgRes = await fetch('/api/config', { cache: 'no-store' });
        cfg = await cfgRes.json();
      } catch (fetchErr) {
        console.warn('Config fetch failed, retrying...', fetchErr);
        // Retry once after 1s
        await new Promise(r => setTimeout(r, 1000));
        try {
          const cfgRes2 = await fetch('/api/config?t=' + Date.now(), { cache: 'no-store' });
          cfg = await cfgRes2.json();
        } catch (e) {
          console.error('Config fetch failed twice, auth disabled');
          _authReady = true;
          return;
        }
      }

      if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        console.warn('Supabase config missing');
        _authReady = true;
        return;
      }

      if (!window.supabase || !window.supabase.createClient) {
        console.warn('Supabase SDK not loaded');
        _authReady = true;
        return;
      }

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
          _syncHistory(); // merge Supabase history into localStorage
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
    // Capture UTM params on first visit
    _captureUtm();
  }

  // --- UTM / REFERRER / DEVICE CAPTURE ---
  let _capturedUtm = null;
  function _captureUtm() {
    const params = new URLSearchParams(window.location.search);
    const utm = {
      utm_source: params.get('utm_source') || sessionStorage.getItem('_utm_source') || '',
      utm_medium: params.get('utm_medium') || sessionStorage.getItem('_utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || sessionStorage.getItem('_utm_campaign') || '',
      referrer: document.referrer || sessionStorage.getItem('_referrer') || '',
      device_type: window.innerWidth <= 768 ? 'mobile' : 'desktop',
      preferred_language: window.currentLang || navigator.language?.slice(0, 2) || 'ro',
    };
    // Persist in sessionStorage so they survive page reloads
    if (utm.utm_source) sessionStorage.setItem('_utm_source', utm.utm_source);
    if (utm.utm_medium) sessionStorage.setItem('_utm_medium', utm.utm_medium);
    if (utm.utm_campaign) sessionStorage.setItem('_utm_campaign', utm.utm_campaign);
    if (utm.referrer) sessionStorage.setItem('_referrer', utm.referrer);
    _capturedUtm = utm;
  }

  async function _saveUtmToProfile() {
    if (!_sb || !_sbUser || !_capturedUtm) return;
    const updates = {};
    if (_capturedUtm.utm_source) updates.utm_source = _capturedUtm.utm_source;
    if (_capturedUtm.utm_medium) updates.utm_medium = _capturedUtm.utm_medium;
    if (_capturedUtm.utm_campaign) updates.utm_campaign = _capturedUtm.utm_campaign;
    if (_capturedUtm.referrer) updates.referrer = _capturedUtm.referrer;
    if (_capturedUtm.device_type) updates.device_type = _capturedUtm.device_type;
    if (_capturedUtm.preferred_language) updates.preferred_language = _capturedUtm.preferred_language;
    if (Object.keys(updates).length === 0) return;
    updates.updated_at = new Date().toISOString();
    try {
      await _sb.from('profiles').update(updates).eq('id', _sbUser.id);
    } catch (err) {
      console.error('UTM save error:', err);
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
    if (p.stripe_subscription_status === 'active' || p.stripe_subscription_status === 'trialing') return 'premium';
    if (p.trial_active && new Date(p.trial_expires_at) > new Date()) return 'premium';
    return 'free';
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
        body: JSON.stringify({ plan, email: _sbUser.email, user_id: _sbUser.id, lang: window.currentLang || 'ro' }),
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

  // ============================================
  // AUTH MODAL
  // ============================================
  function showAuthModal(mode, onSuccess) {
    const existing = document.getElementById('sbAuthModal');
    if (existing) existing.remove();
    const isSignup = mode === 'signup';
    const isRo = !window.currentLang || window.currentLang === 'ro';

    const title = isSignup ? (isRo ? 'Creează cont gratuit' : 'Create free account') : (isRo ? 'Intră în cont' : 'Log in');
    const subtitle = isSignup
      ? (isRo ? 'Evaluare pe 9 criterii + versiune îmbunătățită + explicații detaliate.<br>Plus <strong>7 zile gratuit de Premium</strong> cu toate cele 17 criterii.' : 'Evaluation on 9 criteria + improved version.<br>Plus <strong>7 days free Premium</strong> with all 17 criteria.')
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

        <!-- STEP 1: Email + Password -->
        <div id="sbStep1">
          <label style="display:block;font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Email</label>
          <input type="email" id="sbAuthEmail" placeholder="${isRo ? 'adresa@email.com' : 'your@email.com'}" style="width:100%;padding:12px 14px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-size:0.92rem;font-family:var(--font-main);box-sizing:border-box;margin-bottom:12px">
          <label style="display:block;font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px">${isRo ? 'Parolă' : 'Password'}${isSignup ? ' <span style="font-weight:400;color:var(--text-muted)">(min. 6 caractere)</span>' : ''}</label>
          <input type="password" id="sbAuthPassword" placeholder="${isSignup ? (isRo ? 'Alege o parolă' : 'Choose a password') : (isRo ? 'Parola ta' : 'Your password')}" style="width:100%;padding:12px 14px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-size:0.92rem;font-family:var(--font-main);box-sizing:border-box" onkeydown="if(event.key==='Enter')window._sbAuth.doAuth('${mode}')">
          <div id="sbAuthError" style="display:none;color:var(--accent-red);font-size:0.82rem;margin-top:8px"></div>
          <button onclick="window._sbAuth.doAuth('${mode}')" id="sbAuthBtn" style="width:100%;margin-top:14px;padding:12px;border:none;border-radius:var(--radius-sm);background:var(--accent-blue);color:#0f1f28;font-size:0.92rem;font-weight:700;cursor:pointer;font-family:var(--font-main)">${btnText}</button>
          ${!isSignup ? `<div style="text-align:center;margin-top:10px"><a href="#" id="sbForgotPw" style="color:var(--text-muted);font-size:0.78rem;text-decoration:none">${isRo ? 'Ai uitat parola?' : 'Forgot password?'}</a></div>` : ''}
          <div style="text-align:center;margin-top:14px;font-size:0.82rem;color:var(--text-muted)">${switchText}</div>
        </div>

        <!-- STEP 2: OTP Code -->
        <div id="sbStep2" style="display:none;text-align:center">
          <div style="font-size:2.5rem;margin-bottom:12px">📧</div>
          <h3 style="font-size:1rem;font-weight:700;color:var(--text-heading);margin:0 0 8px">${isRo ? 'Verifică email-ul' : 'Check your email'}</h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0 0 20px" id="sbOtpDesc"></p>
          <div id="sbOtpWrap" style="display:flex;justify-content:center;gap:8px;margin-bottom:16px">
            ${[0,1,2,3,4,5].map(i => `<input type="text" inputmode="numeric" maxlength="1" class="sbOtpInput" style="width:46px;height:54px;text-align:center;font-size:1.4rem;font-weight:700;font-family:var(--font-mono);border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);outline:none" data-idx="${i}">`).join('')}
          </div>
          <div id="sbOtpError" style="display:none;color:var(--accent-red);font-size:0.82rem;margin-bottom:12px"></div>
          <div id="sbOtpSuccess" style="display:none;color:var(--accent-green);font-size:0.82rem;margin-bottom:12px"></div>
          <button onclick="window._sbAuth.doVerifyOtp()" id="sbOtpBtn" style="width:100%;padding:12px;border:none;border-radius:var(--radius-sm);background:var(--accent-blue);color:#0f1f28;font-size:0.92rem;font-weight:700;cursor:pointer;font-family:var(--font-main)">${isRo ? 'Confirmă codul →' : 'Confirm code →'}</button>
          <div style="margin-top:12px"><a href="#" id="sbResendCode" style="color:var(--text-muted);font-size:0.78rem;text-decoration:none">${isRo ? 'Nu ai primit? Retrimite codul' : 'Didn\'t receive? Resend code'}</a></div>
        </div>

        <!-- STEP: Forgot password — 3 sub-steps -->
        <div id="sbStepForgot" style="display:none">
          <!-- Sub-step A: enter email -->
          <div id="sbForgotA" style="text-align:center">
            <h3 style="font-size:1rem;font-weight:700;color:var(--text-heading);margin:0 0 8px">${isRo ? 'Resetează parola' : 'Reset password'}</h3>
            <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0 0 16px">${isRo ? 'Introdu emailul și îți trimitem un cod de verificare.' : 'Enter your email and we\'ll send a verification code.'}</p>
            <input type="email" id="sbForgotEmail" placeholder="${isRo ? 'adresa@email.com' : 'your@email.com'}" style="width:100%;padding:12px 14px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-size:0.92rem;font-family:var(--font-main);box-sizing:border-box;margin-bottom:12px">
            <div id="sbForgotMsg" style="display:none;font-size:0.82rem;margin-bottom:8px"></div>
            <button onclick="window._sbAuth.doForgotSendCode()" id="sbForgotBtn" style="width:100%;padding:12px;border:none;border-radius:var(--radius-sm);background:var(--accent-blue);color:#0f1f28;font-size:0.92rem;font-weight:700;cursor:pointer;font-family:var(--font-main)">${isRo ? 'Trimite cod →' : 'Send code →'}</button>
            <div style="margin-top:12px"><a href="#" id="sbBackToLogin" style="color:var(--text-muted);font-size:0.78rem;text-decoration:none">${isRo ? '← Înapoi la login' : '← Back to login'}</a></div>
          </div>
          <!-- Sub-step B: enter code + new password -->
          <div id="sbForgotB" style="display:none;text-align:center">
            <div style="font-size:2.5rem;margin-bottom:12px">🔑</div>
            <h3 style="font-size:1rem;font-weight:700;color:var(--text-heading);margin:0 0 8px">${isRo ? 'Introdu codul și noua parolă' : 'Enter code and new password'}</h3>
            <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0 0 16px" id="sbForgotBDesc"></p>
            <div id="sbForgotOtpWrap" style="display:flex;justify-content:center;gap:8px;margin-bottom:16px">
              ${[0,1,2,3,4,5].map(i => '<input type="text" inputmode="numeric" maxlength="1" class="sbForgotOtpInput" style="width:46px;height:54px;text-align:center;font-size:1.4rem;font-weight:700;font-family:var(--font-mono);border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);outline:none" data-idx="' + i + '">').join('')}
            </div>
            <label style="display:block;font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-align:left">${isRo ? 'Parolă nouă' : 'New password'} <span style="font-weight:400;color:var(--text-muted)">(min. 6 caractere)</span></label>
            <input type="password" id="sbForgotNewPw" placeholder="${isRo ? 'Noua parolă' : 'New password'}" style="width:100%;padding:12px 14px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-size:0.92rem;font-family:var(--font-main);box-sizing:border-box;margin-bottom:12px">
            <div id="sbForgotBError" style="display:none;color:var(--accent-red);font-size:0.82rem;margin-bottom:8px"></div>
            <div id="sbForgotBSuccess" style="display:none;color:var(--accent-green);font-size:0.82rem;margin-bottom:8px"></div>
            <button onclick="window._sbAuth.doForgotResetPassword()" id="sbForgotBBtn" style="width:100%;padding:12px;border:none;border-radius:var(--radius-sm);background:var(--accent-blue);color:#0f1f28;font-size:0.92rem;font-weight:700;cursor:pointer;font-family:var(--font-main)">${isRo ? 'Resetează parola →' : 'Reset password →'}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('sbAuthEmail').focus();

    setTimeout(() => {
      _wireOtpInputs();
      const sw = document.getElementById('sbSwitchMode');
      if (sw) sw.addEventListener('click', (e) => { e.preventDefault(); modal.remove(); showAuthModal(isSignup ? 'login' : 'signup', onSuccess); });
      const fp = document.getElementById('sbForgotPw');
      if (fp) fp.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('sbStep1').style.display = 'none';
        document.getElementById('sbStepForgot').style.display = 'block';
        const em = document.getElementById('sbAuthEmail').value;
        if (em) document.getElementById('sbForgotEmail').value = em;
      });
      const bl = document.getElementById('sbBackToLogin');
      if (bl) bl.addEventListener('click', (e) => { e.preventDefault(); modal.remove(); showAuthModal('login', onSuccess); });
      const rs = document.getElementById('sbResendCode');
      if (rs) rs.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!_otpEmail) return;
        rs.textContent = isRo ? 'Se retrimite...' : 'Resending...';
        await _sendVerificationCode(_otpEmail);
        rs.textContent = isRo ? '✓ Cod retrimis!' : '✓ Code resent!';
        setTimeout(() => { rs.textContent = isRo ? 'Nu ai primit? Retrimite codul' : 'Didn\'t receive? Resend code'; }, 3000);
      });
      // Wire forgot password OTP inputs
      _wireForgotOtpInputs();
    }, 50);

    window._authSuccessCallback = onSuccess || null;
  }

  function _wireOtpInputs() {
    const inputs = document.querySelectorAll('.sbOtpInput');
    inputs.forEach((inp, i) => {
      inp.addEventListener('input', (e) => {
        const v = e.target.value.replace(/\D/g, '');
        e.target.value = v;
        if (v && i < 5) inputs[i + 1].focus();
        if (i === 5 && v) window._sbAuth.doVerifyOtp();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && i > 0) inputs[i - 1].focus();
      });
      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        paste.split('').forEach((ch, j) => { if (inputs[j]) inputs[j].value = ch; });
        if (paste.length === 6) window._sbAuth.doVerifyOtp();
        else if (paste.length > 0) inputs[Math.min(paste.length, 5)].focus();
      });
    });
  }

  function _wireForgotOtpInputs() {
    const inputs = document.querySelectorAll('.sbForgotOtpInput');
    inputs.forEach((inp, i) => {
      inp.addEventListener('input', (e) => {
        const v = e.target.value.replace(/\D/g, '');
        e.target.value = v;
        if (v && i < 5) inputs[i + 1].focus();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && i > 0) inputs[i - 1].focus();
      });
      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        paste.split('').forEach((ch, j) => { if (inputs[j]) inputs[j].value = ch; });
        if (paste.length > 0) inputs[Math.min(paste.length, 5)].focus();
      });
    });
  }

  // --- SEND CODE VIA RESEND ---
  async function _sendVerificationCode(email) {
    try {
      const res = await fetch('/api/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.ok) {
        _otpToken = data.token;
        _otpHmac = data.hmac;
        return { ok: true };
      }
      return { error: data.error || 'Eroare la trimitere.' };
    } catch (err) {
      return { error: 'Eroare de conexiune.' };
    }
  }

  // --- STEP 1: AUTH ---
  async function doAuth(mode) {
    const email = document.getElementById('sbAuthEmail').value.trim();
    const password = document.getElementById('sbAuthPassword').value;
    const errorDiv = document.getElementById('sbAuthError');
    const btn = document.getElementById('sbAuthBtn');
    const isRo = !window.currentLang || window.currentLang === 'ro';
    errorDiv.style.display = 'none';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorDiv.textContent = isRo ? 'Introdu o adresă de email validă.' : 'Enter a valid email.';
      errorDiv.style.display = 'block'; return;
    }
    if (!password || password.length < 6) {
      errorDiv.textContent = isRo ? 'Parola trebuie să aibă minim 6 caractere.' : 'Min 6 characters.';
      errorDiv.style.display = 'block'; return;
    }

    btn.disabled = true;
    btn.textContent = isRo ? 'Se procesează...' : 'Processing...';

    if (mode === 'signup') {
      // Step 1: Send verification code first
      _otpEmail = email;
      _otpPassword = password;
      const sendResult = await _sendVerificationCode(email);
      if (sendResult.error) {
        errorDiv.textContent = sendResult.error;
        errorDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = isRo ? 'Creează cont →' : 'Create account →';
        return;
      }
      // Show OTP step
      document.getElementById('sbStep1').style.display = 'none';
      document.getElementById('sbStep2').style.display = 'block';
      document.getElementById('sbOtpDesc').innerHTML = isRo
        ? `Am trimis un cod de 6 cifre pe <strong>${email}</strong>. Introdu-l mai jos.`
        : `We sent a 6-digit code to <strong>${email}</strong>. Enter it below.`;
      const firstInput = document.querySelector('.sbOtpInput');
      if (firstInput) firstInput.focus();
    } else {
      // Login: direct sign in
      const result = await signIn(email, password);
      if (result.error) {
        let msg = result.error;
        if (isRo) {
          if (msg.includes('Invalid login')) msg = 'Email sau parolă incorecte.';
          else if (msg.includes('Email not confirmed')) msg = 'Contul nu a fost confirmat încă.';
          else if (msg.includes('rate limit')) msg = 'Prea multe încercări. Așteaptă un minut.';
        }
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = isRo ? 'Intră în cont →' : 'Log in →';
        return;
      }
      localStorage.setItem('eval_lead_email', email);
      localStorage.setItem('eval_lead_ok', '1');
      setTimeout(() => { const m = document.getElementById('sbAuthModal'); if (m) m.remove(); }, 300);
    }
  }

  // --- STEP 2: VERIFY OTP ---
  async function doVerifyOtp() {
    const inputs = document.querySelectorAll('.sbOtpInput');
    const code = Array.from(inputs).map(i => i.value).join('');
    const errorDiv = document.getElementById('sbOtpError');
    const successDiv = document.getElementById('sbOtpSuccess');
    const btn = document.getElementById('sbOtpBtn');
    const isRo = !window.currentLang || window.currentLang === 'ro';

    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    if (code.length !== 6) {
      errorDiv.textContent = isRo ? 'Introdu toate cele 6 cifre.' : 'Enter all 6 digits.';
      errorDiv.style.display = 'block'; return;
    }

    btn.disabled = true;
    btn.textContent = isRo ? 'Se verifică...' : 'Verifying...';

    // Verify code on server
    try {
      const res = await fetch('/api/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', token: _otpToken, hmac: _otpHmac, code }),
      });
      const data = await res.json();

      if (!data.ok) {
        let msg = data.message || 'Cod invalid.';
        if (isRo && data.error === 'expired') msg = 'Codul a expirat. Retrimite un cod nou.';
        if (isRo && data.error === 'wrong_code') msg = 'Cod incorect. Verifică și încearcă din nou.';
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = isRo ? 'Confirmă codul →' : 'Confirm code →';
        inputs.forEach(i => { i.value = ''; i.style.borderColor = 'var(--accent-red)'; });
        inputs[0].focus();
        return;
      }

      // Code verified — now create Supabase account
      successDiv.textContent = isRo ? '✅ Email verificat! Se creează contul...' : '✅ Verified! Creating account...';
      successDiv.style.display = 'block';

      const { data: signUpData, error: signUpError } = await _sb.auth.signUp({
        email: _otpEmail.trim().toLowerCase(),
        password: _otpPassword,
      });

      if (signUpError) {
        let msg = signUpError.message;
        if (isRo && msg.includes('already registered')) msg = 'Acest email are deja cont. Intră în cont.';
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
        successDiv.style.display = 'none';
        btn.disabled = false;
        btn.textContent = isRo ? 'Confirmă codul →' : 'Confirm code →';
        return;
      }

      // Success — user is created and logged in
      localStorage.setItem('eval_lead_email', _otpEmail);
      localStorage.setItem('eval_lead_ok', '1');
      _otpToken = null; _otpHmac = null; _otpEmail = null; _otpPassword = null;

      successDiv.textContent = isRo ? '✅ Cont creat! Bine ai venit.' : '✅ Account created! Welcome.';
      _saveUtmToProfile();
      setTimeout(() => { const m = document.getElementById('sbAuthModal'); if (m) m.remove(); }, 1000);

    } catch (err) {
      errorDiv.textContent = isRo ? 'Eroare de conexiune. Încearcă din nou.' : 'Connection error.';
      errorDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = isRo ? 'Confirmă codul →' : 'Confirm code →';
    }
  }

  // --- FORGOT PASSWORD (via Resend code) ---
  let _resetToken = null;
  let _resetHmac = null;
  let _resetEmail = null;

  async function doForgotSendCode() {
    const email = document.getElementById('sbForgotEmail').value.trim();
    const msgDiv = document.getElementById('sbForgotMsg');
    const btn = document.getElementById('sbForgotBtn');
    const isRo = !window.currentLang || window.currentLang === 'ro';
    msgDiv.style.display = 'none';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msgDiv.textContent = isRo ? 'Introdu o adresă de email validă.' : 'Enter a valid email.';
      msgDiv.style.color = 'var(--accent-red)';
      msgDiv.style.display = 'block'; return;
    }

    btn.disabled = true;
    btn.textContent = isRo ? 'Se trimite...' : 'Sending...';
    _resetEmail = email;

    try {
      const res = await fetch('/api/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-reset', email }),
      });
      const data = await res.json();
      btn.disabled = false;
      btn.textContent = isRo ? 'Trimite cod →' : 'Send code →';

      if (data.ok) {
        _resetToken = data.token;
        _resetHmac = data.hmac;
        document.getElementById('sbForgotA').style.display = 'none';
        document.getElementById('sbForgotB').style.display = 'block';
        document.getElementById('sbForgotBDesc').innerHTML = isRo
          ? 'Am trimis un cod de 6 cifre pe <strong>' + email + '</strong>.'
          : 'We sent a 6-digit code to <strong>' + email + '</strong>.';
        const fi = document.querySelector('.sbForgotOtpInput');
        if (fi) fi.focus();
      } else {
        msgDiv.textContent = data.error || (isRo ? 'Eroare la trimitere.' : 'Send error.');
        msgDiv.style.color = 'var(--accent-red)';
        msgDiv.style.display = 'block';
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = isRo ? 'Trimite cod →' : 'Send code →';
      msgDiv.textContent = isRo ? 'Eroare de conexiune.' : 'Connection error.';
      msgDiv.style.color = 'var(--accent-red)';
      msgDiv.style.display = 'block';
    }
  }

  async function doForgotResetPassword() {
    const inputs = document.querySelectorAll('.sbForgotOtpInput');
    const code = Array.from(inputs).map(i => i.value).join('');
    const newPassword = document.getElementById('sbForgotNewPw').value;
    const errorDiv = document.getElementById('sbForgotBError');
    const successDiv = document.getElementById('sbForgotBSuccess');
    const btn = document.getElementById('sbForgotBBtn');
    const isRo = !window.currentLang || window.currentLang === 'ro';

    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    if (code.length !== 6) {
      errorDiv.textContent = isRo ? 'Introdu toate cele 6 cifre.' : 'Enter all 6 digits.';
      errorDiv.style.display = 'block'; return;
    }
    if (!newPassword || newPassword.length < 6) {
      errorDiv.textContent = isRo ? 'Parola trebuie să aibă minim 6 caractere.' : 'Min 6 characters.';
      errorDiv.style.display = 'block'; return;
    }

    btn.disabled = true;
    btn.textContent = isRo ? 'Se resetează...' : 'Resetting...';

    try {
      const res = await fetch('/api/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset-password',
          token: _resetToken,
          hmac: _resetHmac,
          code,
          newPassword,
        }),
      });
      const data = await res.json();

      if (data.ok) {
        successDiv.textContent = isRo ? '✅ Parolă resetată! Te poți loga acum.' : '✅ Password reset! You can log in now.';
        successDiv.style.display = 'block';
        _resetToken = null; _resetHmac = null; _resetEmail = null;
        setTimeout(() => {
          const modal = document.getElementById('sbAuthModal');
          if (modal) modal.remove();
          showAuthModal('login');
        }, 1500);
      } else {
        let msg = data.error || 'Eroare.';
        if (isRo) {
          if (msg === 'expired') msg = 'Codul a expirat. Retrimite un cod nou.';
          if (msg === 'wrong_code') msg = 'Cod incorect. Verifică și încearcă din nou.';
        }
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = isRo ? 'Resetează parola →' : 'Reset password →';
      }
    } catch (err) {
      errorDiv.textContent = isRo ? 'Eroare de conexiune.' : 'Connection error.';
      errorDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = isRo ? 'Resetează parola →' : 'Reset password →';
    }
  }

  // --- PREMIUM MODAL ---
  function showPremiumModal() {
    const existing = document.getElementById('sbPremiumModal');
    if (existing) existing.remove();
    const isRo = !window.currentLang || window.currentLang === 'ro';
    let trialText = '';
    if (_sbProfile && _sbProfile.trial_active && _effectiveTier === 'premium' && _sbProfile.stripe_subscription_status !== 'active' && !_sbProfile.training_access) {
      const d = Math.max(0, Math.ceil((new Date(_sbProfile.trial_expires_at) - new Date()) / 86400000));
      trialText = isRo ? `Ai încă ${d} zile de trial Premium gratuit.` : `${d} days free trial left.`;
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
          <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0">${isRo ? '17 criterii ponderate · Analiză NLP · Radar chart · Script autohipnoză săptămânal · Afirmație zilnică personalizată' : '17 weighted criteria · NLP Analysis · Radar chart'}</p>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div onclick="window._sbAuth.startCheckout('monthly')" style="padding:20px 16px;border:1px solid rgba(246,212,76,0.3);border-radius:var(--radius-sm);cursor:pointer;text-align:center" onmouseover="this.style.borderColor='var(--accent-gold)'" onmouseout="this.style.borderColor='rgba(246,212,76,0.3)'">
            <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:4px">${isRo ? 'Lunar' : 'Monthly'}</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--accent-gold)">49 RON</div>
            <div style="font-size:0.78rem;color:var(--text-muted)">/ ${isRo ? 'lună' : 'month'}</div>
            <div style="font-size:0.72rem;color:var(--accent-blue);margin-top:6px;font-weight:600">${isRo ? '7 zile gratuit' : '7 days free'}</div>
          </div>
          <div onclick="window._sbAuth.startCheckout('annual')" style="padding:20px 16px;border:2px solid var(--accent-gold);border-radius:var(--radius-sm);cursor:pointer;text-align:center;background:rgba(246,212,76,0.04);position:relative" onmouseover="this.style.background='rgba(246,212,76,0.1)'" onmouseout="this.style.background='rgba(246,212,76,0.04)'">
            <div style="position:absolute;top:-10px;right:12px;background:var(--accent-gold);color:#0f1f28;font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:10px">-32%</div>
            <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:4px">${isRo ? 'Anual' : 'Annual'}</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--accent-gold)">399 RON</div>
            <div style="font-size:0.78rem;color:var(--text-muted)">/ ${isRo ? 'an' : 'year'} (~33 RON/${isRo ? 'lună' : 'mo'})</div>
            <div style="font-size:0.72rem;color:var(--accent-blue);margin-top:6px;font-weight:600">${isRo ? '7 zile gratuit' : '7 days free'}</div>
          </div>
        </div>
        <div style="text-align:center;margin-bottom:12px;padding-top:4px;border-top:1px solid var(--border-card)">
          <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">${isRo ? 'Participant la Training Profesional de Hipnoză?' : 'Professional Hypnosis Training participant?'}</div>
          <button onclick="window._sbAuth.showTrainingCodeInput()" id="sbTrainingCodeToggle" style="padding:6px 16px;border:1px solid var(--border-card);border-radius:6px;background:transparent;color:var(--text-secondary);font-size:0.8rem;cursor:pointer;font-family:var(--font-main)">${isRo ? 'Am cod de acces →' : 'I have an access code →'}</button>
          <div id="sbTrainingCodeWrap" style="display:none;margin-top:10px">
            <div style="display:flex;gap:8px;max-width:300px;margin:0 auto">
              <input type="text" id="sbTrainingCodeInput" placeholder="${isRo ? 'Cod acces training' : 'Training access code'}" style="flex:1;padding:10px 12px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-size:0.88rem;font-family:var(--font-main)">
              <button onclick="window._sbAuth.activateTrainingCode()" id="sbTrainingCodeBtn" style="padding:10px 16px;border:none;border-radius:var(--radius-sm);background:var(--accent-blue);color:#0f1f28;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:var(--font-main);white-space:nowrap">${isRo ? 'Activează' : 'Activate'}</button>
            </div>
            <div id="sbTrainingCodeMsg" style="display:none;font-size:0.8rem;margin-top:6px"></div>
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

  // --- SUPABASE EVALUATION LOGGING ---
  async function _saveEvalToSupabase(entry) {
    if (!_sb || !_sbUser) return;
    try {
      await _sb.from('evaluations').insert({
        user_id: _sbUser.id,
        suggestion_text: entry.text || '',
        suggestion_type: entry.tip || '',
        evaluation_tier: entry.tier || 'basic',
        total_score: entry.scor || 0,
        score_level: entry.level || '',
        criteria_scores: entry.criterii || [],
        problems: entry.top_probleme || [],
        improved_version: entry.versiune_imbunatatita || '',
        feedback_text: entry.explicatii || '',
        content_type: entry.content_type || 'sugestie',
        module: entry.source || 'evaluator',
        language: entry.lang || 'ro',
        device: window.innerWidth <= 768 ? 'mobile' : 'desktop',
        local_id: entry.id || null,
        created_at: entry.date || new Date().toISOString(),
      });
    } catch (err) {
      console.warn('Supabase eval save error:', err);
    }
  }

  async function _saveGenToSupabase(entry) {
    if (!_sb || !_sbUser) return;
    try {
      await _sb.from('generations').insert({
        user_id: _sbUser.id,
        problem_text: entry.problem_text || '',
        category: entry.category || '',
        intensity: entry.intensity || 0,
        level: entry.level || 'simplu',
        recipient_name: entry.recipient_name || '',
        afirmatii: entry.afirmatii || null,
        sugestii: entry.sugestii || null,
        sugestii_complete: entry.sugestii_complete || null,
        script_text: entry.script_text || '',
        device: window.innerWidth <= 768 ? 'mobile' : 'desktop',
        language: entry.lang || 'ro',
        local_id: entry.local_id || null,
        created_at: entry.created_at || new Date().toISOString(),
      });
    } catch (err) {
      console.warn('Supabase gen save error:', err);
    }
  }

  async function _syncHistory() {
    if (!_sb || !_sbUser) return;
    try {
      // 1. Fetch evaluations from Supabase (last 40)
      const { data: remoteEvals, error: evErr } = await _sb
        .from('evaluations')
        .select('*')
        .eq('user_id', _sbUser.id)
        .order('created_at', { ascending: false })
        .limit(40);

      // 2. Fetch generations from Supabase (last 20)
      let remoteGens = [];
      try {
        const { data: gd, error: gErr } = await _sb
          .from('generations')
          .select('*')
          .eq('user_id', _sbUser.id)
          .order('created_at', { ascending: false })
          .limit(20);
        if (!gErr && gd) remoteGens = gd;
      } catch (e) { /* generations table may not exist yet */ }

      const hasRemoteData = (remoteEvals && remoteEvals.length > 0) || remoteGens.length > 0;

      if (!hasRemoteData) {
        _migrateLocalHistory();
        return;
      }

      // 3. Convert evaluations to localStorage format
      const evalEntries = (remoteEvals || []).map(r => ({
        id: r.local_id || ('sb_' + r.id.slice(0, 8)),
        date: r.created_at,
        text: r.suggestion_text || '',
        scor: r.total_score || 0,
        tier: r.evaluation_tier || 'basic',
        tip: r.suggestion_type || '—',
        source: r.module || 'evaluator',
        content_type: r.content_type || 'sugestie',
        lang: r.language || 'ro',
        criterii: r.criteria_scores || [],
        top_probleme: r.problems || [],
        versiune_imbunatatita: r.improved_version || '',
        explicatii: r.feedback_text || '',
        sumar: '',
        _fromSupabase: true,
      }));

      // 4. Convert generations to localStorage format
      const genEntries = remoteGens.map(r => {
        const sug = r.sugestii || [];
        const aff = r.afirmatii || [];
        return {
          id: r.local_id || ('sbg_' + r.id.slice(0, 8)),
          date: r.created_at,
          text: r.problem_text || '',
          scor: 0,
          tier: r.level || 'simplu',
          tip: r.category || '—',
          source: 'generator',
          content_type: 'generator',
          lang: r.language || 'ro',
          criterii: [],
          top_probleme: [],
          versiune_imbunatatita: sug.map(s => typeof s === 'string' ? s : (s.text || s.sugestie || '')).join('\n\n---\n\n'),
          explicatii: '',
          sumar: '',
          gen_count: sug.length + aff.length,
          gen_category: r.category || '',
          _fromSupabase: true,
        };
      });

      // 5. Merge: remote entries + localStorage-only entries (deduplicate by id)
      const remoteAll = [...evalEntries, ...genEntries];
      const localHist = JSON.parse(localStorage.getItem('eval_history') || '[]');
      const remoteIds = new Set(remoteAll.map(e => e.id));
      const localOnly = localHist.filter(e => !remoteIds.has(e.id) && !e._fromSupabase);

      // Upload local-only entries to appropriate Supabase table
      for (const entry of localOnly) {
        if (entry.source === 'generator') {
          await _saveGenToSupabase({
            problem_text: entry.text || '',
            category: entry.gen_category || entry.tip || '',
            intensity: entry.gen_intensity || 0,
            level: entry.tier || 'simplu',
            recipient_name: '',
            afirmatii: null,
            sugestii: null,
            script_text: '',
            lang: entry.lang || 'ro',
            local_id: entry.id,
            created_at: entry.date,
          });
        } else {
          await _saveEvalToSupabase(entry);
        }
      }

      // 6. Merged list: all remote + local-only, sorted by date desc, max 60
      const merged = [...remoteAll, ...localOnly]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 60);

      localStorage.setItem('eval_history', JSON.stringify(merged));
      localStorage.setItem('eval_history_synced', Date.now().toString());

      // Re-render history if visible
      if (typeof renderHistory === 'function' && document.querySelector('.page.active #histList')) {
        renderHistory();
      }
    } catch (err) {
      console.warn('History sync error:', err);
    }
  }

  async function _migrateLocalHistory() {
    if (!_sb || !_sbUser) return;
    const migrated = localStorage.getItem('eval_history_migrated_' + _sbUser.id);
    if (migrated) return;

    const hist = JSON.parse(localStorage.getItem('eval_history') || '[]');
    if (hist.length === 0) {
      localStorage.setItem('eval_history_migrated_' + _sbUser.id, '1');
      return;
    }

    let count = 0;
    for (const entry of hist) {
      if (entry.source === 'generator') {
        await _saveGenToSupabase({
          problem_text: entry.text || '',
          category: entry.gen_category || entry.tip || '',
          intensity: entry.gen_intensity || 0,
          level: entry.tier || 'simplu',
          recipient_name: '',
          afirmatii: null,
          sugestii: null,
          script_text: '',
          lang: entry.lang || 'ro',
          local_id: entry.id,
          created_at: entry.date,
        });
      } else {
        await _saveEvalToSupabase(entry);
      }
      count++;
    }
    localStorage.setItem('eval_history_migrated_' + _sbUser.id, '1');
    console.log(`Migrated ${count} entries to Supabase (evals + gens)`);
  }

  // --- TRAINING CODE ---
  function showTrainingCodeInput() {
    const wrap = document.getElementById('sbTrainingCodeWrap');
    const toggle = document.getElementById('sbTrainingCodeToggle');
    if (wrap && toggle) {
      wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
      toggle.style.display = wrap.style.display === 'none' ? '' : 'none';
    }
  }

  async function activateTrainingCode() {
    const input = document.getElementById('sbTrainingCodeInput');
    const msgDiv = document.getElementById('sbTrainingCodeMsg');
    const btn = document.getElementById('sbTrainingCodeBtn');
    const isRo = !window.currentLang || window.currentLang === 'ro';
    if (!input || !msgDiv || !btn) return;

    const code = input.value.trim();
    if (!code) {
      msgDiv.textContent = isRo ? 'Introdu codul de acces.' : 'Enter the access code.';
      msgDiv.style.color = 'var(--accent-red)';
      msgDiv.style.display = 'block'; return;
    }
    if (!_sbUser) {
      msgDiv.textContent = isRo ? 'Trebuie să fii logat.' : 'You must be logged in.';
      msgDiv.style.color = 'var(--accent-red)';
      msgDiv.style.display = 'block'; return;
    }

    btn.disabled = true;
    btn.textContent = isRo ? 'Se verifică...' : 'Verifying...';
    msgDiv.style.display = 'none';

    try {
      const res = await fetch('/api/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'training-code', code, user_id: _sbUser.id }),
      });
      const data = await res.json();

      if (data.ok) {
        msgDiv.textContent = isRo ? '✅ Acces Premium activat permanent!' : '✅ Permanent Premium access activated!';
        msgDiv.style.color = 'var(--accent-green, #4CAF50)';
        msgDiv.style.display = 'block';
        // Refresh profile
        await _loadProfile();
        _updateUI();
        setTimeout(() => {
          const modal = document.getElementById('sbPremiumModal');
          if (modal) modal.remove();
          _showNotification(isRo ? '✅ Premium activat! Acces permanent la Expert.' : '✅ Premium activated! Permanent Expert access.', 'success');
        }, 1200);
      } else {
        msgDiv.textContent = data.error || (isRo ? 'Cod invalid.' : 'Invalid code.');
        msgDiv.style.color = 'var(--accent-red)';
        msgDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = isRo ? 'Activează' : 'Activate';
      }
    } catch (err) {
      msgDiv.textContent = isRo ? 'Eroare de conexiune.' : 'Connection error.';
      msgDiv.style.color = 'var(--accent-red)';
      msgDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = isRo ? 'Activează' : 'Activate';
    }
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

  window._sbAuth = {
    init: initSupabaseAuth, showAuthModal, showPremiumModal, doAuth, doVerifyOtp,
    doForgotSendCode, doForgotResetPassword,
    signIn, signOut, startCheckout,
    showTrainingCodeInput, activateTrainingCode,
    saveEval: _saveEvalToSupabase, saveGen: _saveGenToSupabase, syncHistory: _syncHistory,
    getUser: () => _sbUser, getProfile: () => _sbProfile, getEffectiveTier: () => _effectiveTier, isReady: () => _authReady, refreshProfile: _loadProfile,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSupabaseAuth);
  else initSupabaseAuth();
})();
