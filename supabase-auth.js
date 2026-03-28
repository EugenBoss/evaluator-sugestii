// ============================================
// SUPABASE AUTH MODULE — supabase-auth.js
// Loaded AFTER main inline script in index.html
// Overrides OTP-based gates with Supabase magic link auth
// ============================================

(function () {
  'use strict';

  // --- STATE ---
  let _sb = null;           // Supabase client
  let _sbUser = null;       // Current auth user
  let _sbProfile = null;    // Profile from DB
  let _effectiveTier = 'anonymous'; // anonymous | free | premium
  let _authReady = false;
  let _initPromise = null;

  // --- INIT ---
  async function initSupabaseAuth() {
    if (_initPromise) return _initPromise;
    _initPromise = _doInit();
    return _initPromise;
  }

  async function _doInit() {
    try {
      // Load config from API
      const cfgRes = await fetch('/api/config');
      const cfg = await cfgRes.json();

      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        console.warn('Supabase not configured, falling back to anonymous mode');
        _authReady = true;
        return;
      }

      // Init Supabase client (from CDN global)
      if (!window.supabase || !window.supabase.createClient) {
        console.warn('Supabase SDK not loaded');
        _authReady = true;
        return;
      }

      _sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

      // Check for magic link callback (hash fragment or query params)
      await _handleAuthCallback();

      // Get current session
      const { data: { session } } = await _sb.auth.getSession();
      if (session) {
        _sbUser = session.user;
        await _loadProfile();
      }

      // Listen for auth changes
      _sb.auth.onAuthStateChange(async (event, session) => {
        console.log('Auth event:', event);
        if (event === 'SIGNED_IN' && session) {
          _sbUser = session.user;
          await _loadProfile();
          _updateUI();

          // If there was a pending tier switch, execute it
          if (window._pendingTierAfterAuth) {
            const tier = window._pendingTierAfterAuth;
            window._pendingTierAfterAuth = null;
            setTierDirect(tier);
          }
        } else if (event === 'SIGNED_OUT') {
          _sbUser = null;
          _sbProfile = null;
          _effectiveTier = 'anonymous';
          _updateUI();
        }
      });

      _authReady = true;
      _updateUI();

    } catch (err) {
      console.error('Supabase auth init error:', err);
      _authReady = true;
    }
  }

  // --- HANDLE MAGIC LINK CALLBACK ---
  async function _handleAuthCallback() {
    // Supabase magic link appends tokens to URL hash or as query params
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);

    // Check for access_token in hash (Supabase default)
    if (hash && hash.includes('access_token')) {
      // Supabase SDK handles this automatically via getSession()
      // Clean URL
      history.replaceState(null, '', window.location.pathname);
      return;
    }

    // Check for upgrade success
    if (params.get('upgraded') === '1') {
      history.replaceState(null, '', window.location.pathname);
      setTimeout(() => {
        _showNotification(
          window.currentLang === 'ro'
            ? '✅ Premium activat! Bine ai venit.'
            : '✅ Premium activated! Welcome.',
          'success'
        );
      }, 1000);
    }
  }

  // --- LOAD PROFILE ---
  async function _loadProfile() {
    if (!_sb || !_sbUser) return;

    try {
      const { data, error } = await _sb
        .from('profiles')
        .select('*')
        .eq('id', _sbUser.id)
        .single();

      if (error) {
        console.error('Profile load error:', error);
        _sbProfile = null;
        _effectiveTier = 'free'; // has account, profile might still be creating
        return;
      }

      _sbProfile = data;
      _effectiveTier = _computeEffectiveTier(data);
    } catch (err) {
      console.error('Profile fetch error:', err);
      _effectiveTier = 'free';
    }
  }

  // --- COMPUTE EFFECTIVE TIER (mirrors SQL function) ---
  function _computeEffectiveTier(profile) {
    if (!profile) return 'anonymous';

    // Training students always get premium
    if (profile.training_access === true) return 'premium';

    // PM Inner Circle
    if (profile.pm_subscription_tier === 'inner_circle') return 'premium';

    // Active Stripe subscription
    if (profile.stripe_subscription_status === 'active') return 'premium';

    // Active trial
    if (profile.trial_active === true && new Date(profile.trial_expires_at) > new Date()) {
      return 'premium';
    }

    return 'free';
  }

  // --- MAGIC LINK SIGN IN ---
  async function sendMagicLink(email) {
    if (!_sb) return { error: 'Supabase not initialized' };

    const redirectTo = window.location.origin + '/';
    const { error } = await _sb.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: redirectTo }
    });

    if (error) {
      console.error('Magic link error:', error);
      return { error: error.message };
    }

    return { ok: true };
  }

  // --- SIGN OUT ---
  async function signOut() {
    if (!_sb) return;
    await _sb.auth.signOut();
    // Clear old localStorage data
    localStorage.removeItem('eval_lead_ok');
    localStorage.removeItem('eval_expert_ok');
    localStorage.removeItem('eval_lead_name');
    localStorage.removeItem('eval_lead_email');
    localStorage.removeItem('eval_lead_phone');
    window.location.reload();
  }

  // --- STRIPE CHECKOUT ---
  async function startCheckout(plan) {
    if (!_sbUser) return;

    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: plan, // 'monthly' or 'annual'
          email: _sbUser.email,
          user_id: _sbUser.id,
        }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('Checkout error:', data);
        alert('Eroare la checkout. Încearcă din nou.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Eroare la checkout. Încearcă din nou.');
    }
  }

  // --- UPDATE UI ---
  function _updateUI() {
    // Update account indicator in nav
    _updateAccountBadge();

    // If user is logged in, map Supabase tier to app tier
    if (_sbUser) {
      const appTier = _effectiveTier === 'premium' ? 'expert' : 'avansat';

      // Auto-select highest available tier
      if (typeof window.currentTier !== 'undefined') {
        // If user was on basic, upgrade them
        if (window.currentTier === 'basic') {
          setTierDirect(appTier);
        }
        // If user was on avansat and now has premium, offer expert
        else if (window.currentTier === 'avansat' && _effectiveTier === 'premium') {
          setTierDirect('expert');
        }
      }
    }

    // Update tier button labels
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
      // Create badge in nav
      const nav = document.querySelector('.nav-items') || document.querySelector('nav');
      if (!nav) return;
      badge = document.createElement('div');
      badge.id = 'authBadge';
      badge.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:8px;font-size:0.82rem;';
      nav.appendChild(badge);
    }

    if (_sbUser) {
      const tierLabel = _effectiveTier === 'premium' ? '⭐ Premium' : 'Free';
      const tierColor = _effectiveTier === 'premium' ? 'var(--accent-gold)' : 'var(--accent-blue)';

      // Show trial badge if applicable
      let trialInfo = '';
      if (_sbProfile && _sbProfile.trial_active && _effectiveTier === 'premium'
        && _sbProfile.stripe_subscription_status !== 'active'
        && !_sbProfile.training_access) {
        const daysLeft = Math.ceil((new Date(_sbProfile.trial_expires_at) - new Date()) / 86400000);
        if (daysLeft > 0) {
          trialInfo = `<span style="font-size:0.72rem;color:var(--accent-orange);margin-left:4px">(trial: ${daysLeft}z)</span>`;
        }
      }

      badge.innerHTML = `
        <span style="color:${tierColor};font-weight:600">${tierLabel}</span>${trialInfo}
        <span style="color:var(--text-muted);font-size:0.78rem">${_sbUser.email}</span>
        <button onclick="window._sbAuth.signOut()" style="padding:4px 10px;border:1px solid var(--border-card);border-radius:6px;background:transparent;color:var(--text-secondary);font-size:0.75rem;cursor:pointer;font-family:var(--font-main)">Logout</button>
      `;
    } else {
      badge.innerHTML = `
        <button onclick="window._sbAuth.showAuthModal()" style="padding:6px 14px;border:none;border-radius:6px;background:var(--accent-blue);color:#0f1f28;font-size:0.82rem;font-weight:600;cursor:pointer;font-family:var(--font-main)">Cont gratuit →</button>
      `;
    }
  }

  function _updateTierButtons() {
    const btns = document.querySelectorAll('.tier-toggle button');
    if (btns.length < 3) return;

    const isRo = window.currentLang === 'ro';

    // Remove lock emoji from expert if premium
    if (_effectiveTier === 'premium') {
      btns[2].textContent = btns[2].textContent.replace(' 🔒', '');
    }

    // Remove lock from avansat if logged in
    if (_sbUser) {
      btns[1].textContent = btns[1].textContent.replace(' 🔒', '');
    }
  }

  // --- AUTH MODAL (replaces OTP lead gate) ---
  function showAuthModal(onSuccess) {
    // Remove existing modal if any
    const existing = document.getElementById('sbAuthModal');
    if (existing) existing.remove();

    const isRo = window.currentLang === 'ro';

    const modal = document.createElement('div');
    modal.id = 'sbAuthModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.3s ease';
    modal.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border-card);border-radius:var(--radius);padding:32px 28px;max-width:420px;width:100%;position:relative">
        <button onclick="document.getElementById('sbAuthModal').remove()" style="position:absolute;top:12px;right:12px;border:none;background:none;color:var(--text-muted);font-size:1.2rem;cursor:pointer">✕</button>
        
        <div style="text-align:center;margin-bottom:20px">
          <div style="font-size:0.72rem;font-weight:600;color:var(--accent-blue);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">
            ${isRo ? 'Cont gratuit' : 'Free account'}
          </div>
          <h3 style="font-size:1.1rem;font-weight:700;color:var(--text-heading);margin:0 0 6px">
            ${isRo ? 'Creează cont și deblochează Avansat' : 'Create account and unlock Advanced'}
          </h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0">
            ${isRo
        ? 'Evaluare pe 9 criterii + versiune îmbunătățită + explicații detaliate. Plus 7 zile gratuit de Premium cu toate cele 17 criterii.'
        : 'Evaluation on 9 criteria + improved version + detailed explanations. Plus 7 days free Premium trial with all 17 criteria.'}
          </p>
        </div>

        <div id="sbAuthStep1">
          <label style="display:block;font-size:0.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Email</label>
          <input type="email" id="sbAuthEmail" placeholder="${isRo ? 'adresa@email.com' : 'your@email.com'}" 
            style="width:100%;padding:12px 14px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-size:0.92rem;font-family:var(--font-main);box-sizing:border-box"
            onkeydown="if(event.key==='Enter')window._sbAuth.doMagicLink()">
          <div id="sbAuthError" style="display:none;color:var(--accent-red);font-size:0.82rem;margin-top:6px"></div>
          <button onclick="window._sbAuth.doMagicLink()" id="sbAuthBtn"
            style="width:100%;margin-top:12px;padding:12px;border:none;border-radius:var(--radius-sm);background:var(--accent-blue);color:#0f1f28;font-size:0.92rem;font-weight:700;cursor:pointer;font-family:var(--font-main)">
            ${isRo ? 'Trimite link de acces →' : 'Send access link →'}
          </button>
        </div>

        <div id="sbAuthStep2" style="display:none;text-align:center">
          <div style="font-size:2.5rem;margin-bottom:12px">📧</div>
          <h3 style="font-size:1rem;font-weight:700;color:var(--text-heading);margin:0 0 8px">
            ${isRo ? 'Verifică email-ul' : 'Check your email'}
          </h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5">
            ${isRo
        ? 'Am trimis un link de acces. Click pe link pentru a activa contul. Poți închide acest pop-up.'
        : 'We sent an access link. Click the link to activate your account. You can close this popup.'}
          </p>
          <button onclick="document.getElementById('sbAuthModal').remove()"
            style="margin-top:16px;padding:10px 24px;border:1px solid var(--border-card);border-radius:var(--radius-sm);background:transparent;color:var(--text-secondary);font-size:0.85rem;cursor:pointer;font-family:var(--font-main)">
            OK
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector('#sbAuthEmail').focus();

    // Store callback for after auth
    window._authSuccessCallback = onSuccess || null;
  }

  // --- SEND MAGIC LINK ---
  async function doMagicLink() {
    const emailInput = document.getElementById('sbAuthEmail');
    const errorDiv = document.getElementById('sbAuthError');
    const btn = document.getElementById('sbAuthBtn');
    const email = emailInput.value.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorDiv.textContent = window.currentLang === 'ro' ? 'Introdu o adresă de email validă.' : 'Enter a valid email address.';
      errorDiv.style.display = 'block';
      return;
    }

    errorDiv.style.display = 'none';
    btn.disabled = true;
    btn.textContent = window.currentLang === 'ro' ? 'Se trimite...' : 'Sending...';

    const result = await sendMagicLink(email);

    if (result.error) {
      errorDiv.textContent = result.error;
      errorDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = window.currentLang === 'ro' ? 'Trimite link de acces →' : 'Send access link →';
      return;
    }

    // Show step 2
    document.getElementById('sbAuthStep1').style.display = 'none';
    document.getElementById('sbAuthStep2').style.display = 'block';

    // Also store email in localStorage for lead tracking compatibility
    localStorage.setItem('eval_lead_email', email);
    localStorage.setItem('eval_lead_ok', '1');
  }

  // --- PREMIUM UPGRADE MODAL ---
  function showPremiumModal() {
    const existing = document.getElementById('sbPremiumModal');
    if (existing) existing.remove();

    const isRo = window.currentLang === 'ro';

    // Calculate trial info
    let trialText = '';
    if (_sbProfile && _sbProfile.trial_active && _effectiveTier === 'premium'
      && !_sbProfile.training_access
      && _sbProfile.stripe_subscription_status !== 'active') {
      const daysLeft = Math.ceil((new Date(_sbProfile.trial_expires_at) - new Date()) / 86400000);
      trialText = isRo
        ? `Ai încă ${daysLeft} zile de trial Premium gratuit.`
        : `You have ${daysLeft} days of free Premium trial left.`;
    }

    const modal = document.createElement('div');
    modal.id = 'sbPremiumModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.3s ease';
    modal.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border-card);border-radius:var(--radius);padding:32px 28px;max-width:520px;width:100%;position:relative">
        <button onclick="document.getElementById('sbPremiumModal').remove()" style="position:absolute;top:12px;right:12px;border:none;background:none;color:var(--text-muted);font-size:1.2rem;cursor:pointer">✕</button>
        
        <div style="text-align:center;margin-bottom:20px">
          <div style="font-size:0.72rem;font-weight:600;color:var(--accent-gold);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">PREMIUM</div>
          <h3 style="font-size:1.1rem;font-weight:700;color:var(--text-heading);margin:0 0 8px">
            ${isRo ? 'Deblochează evaluarea Expert' : 'Unlock Expert evaluation'}
          </h3>
          ${trialText ? `<p style="font-size:0.82rem;color:var(--accent-orange);margin:0 0 8px">${trialText}</p>` : ''}
          <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;margin:0">
            ${isRo
        ? '17 criterii ponderate · Analiză NLP · Radar chart · Script autohipnoză săptămânal · Afirmație zilnică personalizată'
        : '17 weighted criteria · NLP Analysis · Radar chart · Weekly autohypnosis script · Daily personalized affirmation'}
          </p>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div onclick="window._sbAuth.startCheckout('monthly')" style="padding:20px 16px;border:1px solid rgba(246,212,76,0.3);border-radius:var(--radius-sm);cursor:pointer;text-align:center;transition:all 0.2s" onmouseover="this.style.borderColor='var(--accent-gold)';this.style.background='rgba(246,212,76,0.06)'" onmouseout="this.style.borderColor='rgba(246,212,76,0.3)';this.style.background='transparent'">
            <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:4px">${isRo ? 'Lunar' : 'Monthly'}</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--accent-gold)">49 RON</div>
            <div style="font-size:0.78rem;color:var(--text-muted)">/ ${isRo ? 'lună' : 'month'}</div>
          </div>
          <div onclick="window._sbAuth.startCheckout('annual')" style="padding:20px 16px;border:2px solid var(--accent-gold);border-radius:var(--radius-sm);cursor:pointer;text-align:center;transition:all 0.2s;background:rgba(246,212,76,0.04);position:relative" onmouseover="this.style.background='rgba(246,212,76,0.1)'" onmouseout="this.style.background='rgba(246,212,76,0.04)'">
            <div style="position:absolute;top:-10px;right:12px;background:var(--accent-gold);color:#0f1f28;font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:10px">-32%</div>
            <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:4px">${isRo ? 'Anual' : 'Annual'}</div>
            <div style="font-size:1.3rem;font-weight:700;color:var(--accent-gold)">399 RON</div>
            <div style="font-size:0.78rem;color:var(--text-muted)">/ ${isRo ? 'an' : 'year'} (${isRo ? '~33 RON/lună' : '~33 RON/mo'})</div>
          </div>
        </div>

        <div style="text-align:center">
          <button onclick="document.getElementById('sbPremiumModal').remove()" style="padding:8px 16px;border:none;background:transparent;color:var(--text-muted);font-size:0.82rem;cursor:pointer;font-family:var(--font-main)">
            ${isRo ? 'Poate mai târziu' : 'Maybe later'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  // --- NOTIFICATION HELPER ---
  function _showNotification(text, type) {
    const n = document.createElement('div');
    n.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:14px 24px;border-radius:10px;font-size:0.88rem;font-weight:600;z-index:1000;animation:fadeIn 0.3s ease;font-family:var(--font-main);${type === 'success'
      ? 'background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.4);color:#4CAF50'
      : 'background:rgba(231,76,94,0.15);border:1px solid rgba(231,76,94,0.4);color:#E74C5E'
      }`;
    n.textContent = text;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 4000);
  }

  // ============================================
  // OVERRIDE EXISTING GATE FUNCTIONS
  // ============================================

  // Override hasLeadAccess: now checks if user has Supabase session
  window.hasLeadAccess = function () {
    if (_sbUser) return true;
    // Fallback: check old localStorage (for transition period)
    return localStorage.getItem('eval_lead_ok') === '1';
  };

  // Override hasExpertAccess: now checks if effective tier is premium
  window.hasExpertAccess = function () {
    if (_effectiveTier === 'premium') return true;
    // Fallback: check old localStorage
    return localStorage.getItem('eval_expert_ok') === '1';
  };

  // Override showLeadGate: now shows auth modal with magic link
  window.showLeadGate = function (callback) {
    if (_sbUser) {
      // Already logged in, execute callback directly
      if (callback) callback();
      return;
    }
    window._pendingTierAfterAuth = 'avansat';
    showAuthModal(callback);
  };

  // Override showExpertGate: now shows premium upgrade or auth
  window.showExpertGate = function (callback) {
    if (!_sbUser) {
      // Not logged in — need account first
      window._pendingTierAfterAuth = 'expert';
      showAuthModal(callback);
      return;
    }
    if (_effectiveTier === 'premium') {
      // Already premium, execute callback
      if (callback) callback();
      return;
    }
    // Logged in but not premium — show upgrade
    showPremiumModal();
  };

  // Override getEvalEmail
  const _origGetEvalEmail = window.getEvalEmail;
  window.getEvalEmail = function () {
    if (_sbUser) return _sbUser.email;
    if (_origGetEvalEmail) return _origGetEvalEmail();
    return localStorage.getItem('eval_lead_email') || '';
  };

  // ============================================
  // PUBLIC API
  // ============================================
  window._sbAuth = {
    init: initSupabaseAuth,
    showAuthModal,
    showPremiumModal,
    doMagicLink,
    sendMagicLink,
    signOut,
    startCheckout,
    getUser: () => _sbUser,
    getProfile: () => _sbProfile,
    getEffectiveTier: () => _effectiveTier,
    isReady: () => _authReady,
    refreshProfile: _loadProfile,
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupabaseAuth);
  } else {
    initSupabaseAuth();
  }

})();
