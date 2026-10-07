// ============================================================
//  MAX by UIB — consumer lead app
//  ------------------------------------------------------------
//  A guided, no-login flow for prospects: license photo → VIN → phone → email →
//  driver's license photo → VIN photo → current insurance →
//  consent → submit. MAX (Claude Haiku 4.5, through the Supabase
//  "claude" proxy) reads the photos; the lead is emailed to the
//  office through the "inquiry" function (Resend), which also logs
//  it to the max_leads table when that table exists.
//
//  The page is a PWA and is also what the App Store / Play Store
//  wrappers in native/ load, so one deploy updates every channel.
//  This repository is the standalone home of the app (served at /).
// ============================================================
(function () {
    'use strict';

    const SUPABASE_URL  = 'https://jgjmobktucyimupelfxd.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnam1vYmt0dWN5aW11cGVsZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDAxMDYsImV4cCI6MjA5ODUxNjEwNn0.5vClAeHl-Cgo6QH4IW3oDHKQn_DKB3DZef9bN9IP0XQ';
    const CLAUDE_FN  = SUPABASE_URL + '/functions/v1/claude';
    const INQUIRY_FN = SUPABASE_URL + '/functions/v1/inquiry';
    const MODEL      = 'claude-haiku-4-5';
    const INQUIRY_TO = 'quotes@universalinsurancebroker.com';
    const AUTH_URL   = SUPABASE_URL + '/auth/v1';
    const SITE_URL   = 'https://uibautorater.vercel.app';   // where confirmation / reset links land
    // Shown on the marketing partner sign-up form; the checkbox below it is required.
    const PARTNER_TERMS = [
        'By creating an account you are signing up as a <b>marketing agent (referral partner)</b> of Universal Insurance Brokers. You are not an employee or a licensed agent of the agency, and you do not quote, bind or sell insurance.',
        'The information you provide about your clients is handled as <b>100% secure and confidential</b>. It is transmitted encrypted, used only to prepare the insurance quote, and shared only with Universal Insurance Brokers and the insurance carriers that rate the policy. It is never sold.',
        'Any <b>disbursement you receive as a Gift Card Reward</b> for a referral is paid by Universal Insurance Brokers from its own marketing funds. It does <b>not</b> influence, raise or otherwise affect the price of the insurance for the client you refer, who always receives the carrier\'s filed rate.',
    ];
    const HEADERS    = { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' };

    // ── native shell (Capacitor) ─────────────────────────────────
    // When this page runs inside the App Store / Google Play app, the
    // Capacitor runtime is injected and exposes the native plugins. The
    // same code keeps working as a plain website when it is absent.
    const Cap    = window.Capacitor;
    const NATIVE = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
    const Plug   = (Cap && Cap.Plugins) || {};
    const PRIVACY_HREF = NATIVE ? 'privacy.html' : '/privacy';
    async function haptic(kind) { try { if (NATIVE && Plug.Haptics) { if (kind === 'error') await Plug.Haptics.notification({ type: 'ERROR' }); else if (kind === 'success') await Plug.Haptics.notification({ type: 'SUCCESS' }); else await Plug.Haptics.impact({ style: 'LIGHT' }); } } catch (e) { /* ignore */ } }

    const STEPS = ['dl', 'vin', 'phone', 'email', 'submit'];
    let step = 0;
    let lead = blank();
    let busy = false;
    let pendingKind = 'dl';

    function blank() { return { name: '', phone: '', email: '', dl: null, dlPhoto: null, vin: '', vehicle: null, vinPhoto: null, consent: false, startedAt: new Date().toISOString() }; }

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // ── chat helpers ─────────────────────────────────────────────
    function msg(role, html, photoUrl) {
        const d = document.createElement('div'); d.className = 'msg ' + role;
        d.innerHTML = (photoUrl ? '<img class="ph" src="' + photoUrl + '" alt="">' : '') + html;
        $('log').appendChild(d); scrollDown(); return d;
    }
    function scrollDown() { requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })); }
    function typing(on) {
        let t = $('typing');
        if (on && !t) { t = document.createElement('div'); t.id = 'typing'; t.className = 'typing'; t.innerHTML = '<i></i><i></i><i></i> MAX is reading'; $('log').appendChild(t); scrollDown(); }
        if (!on && t) t.remove();
        $('bot').classList.toggle('thinking', !!on);
    }
    async function say(html, photoUrl) { typing(true); await sleep(350); typing(false); return msg('bot', html, photoUrl); }
    function progress() { $('steps').innerHTML = STEPS.map((_, i) => '<i class="' + (i <= step ? 'on' : '') + '"></i>').join(''); }
    function compose(html) { $('composer').innerHTML = html; const inp = $('composer').querySelector('input[type=text],input[type=tel],input[type=email]'); if (inp) setTimeout(() => inp.focus(), 50); scrollDown(); }
    function onEnter(e, fn) { if (e.key === 'Enter') { e.preventDefault(); fn(); } }

    // ── marketing partner accounts (Supabase Auth, email + password) ──
    // Salespeople sign up once (name, dealership, address, phone, email,
    // password) and then log in with that email and password. The session
    // is kept on the device so the app opens straight into the chat.
    let auth = null;                               // { access_token, refresh_token, expires_at, user }
    let guest = false;                             // using the app without an account (this browser session only)
    function isGuest() { return guest && !(auth && auth.access_token); }
    function loggedIn() { return !!(auth && auth.access_token); }
    function setGuest(on) { guest = !!on; try { if (on) sessionStorage.setItem('maxGuest', '1'); else sessionStorage.removeItem('maxGuest'); } catch (e) { /* ignore */ } }
    function loadAuth() { try { auth = JSON.parse(localStorage.getItem('maxAuth') || 'null'); } catch (e) { auth = null; } try { guest = sessionStorage.getItem('maxGuest') === '1'; } catch (e) { guest = false; } return auth; }
    function saveAuth(a) { auth = a; try { if (a) localStorage.setItem('maxAuth', JSON.stringify(a)); else localStorage.removeItem('maxAuth'); } catch (e) { /* private mode */ } }
    function me() { const u = (auth && auth.user) || {}; const m = u.user_metadata || {}; return { id: u.id || '', email: u.email || '', name: m.full_name || '', dealership: m.dealership || '', address: m.address || '', phone: m.phone || '' }; }
    function authError(j, fallback) { return (j && (j.error_description || j.msg || j.message || (typeof j.error === 'string' ? j.error : ''))) || fallback; }
    async function authPost(path, body, token) {
        const res = await fetch(AUTH_URL + path, { method: 'POST', headers: Object.assign({}, HEADERS, token ? { 'Authorization': 'Bearer ' + token } : {}), body: JSON.stringify(body || {}) });
        const j = await res.json().catch(() => ({})); return { ok: res.ok, status: res.status, j };
    }
    function sessionFrom(j) { return j && j.access_token ? { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)), user: j.user } : null; }
    async function signUp(d, password) {
        const r = await authPost('/signup?redirect_to=' + encodeURIComponent(SITE_URL), { email: d.email, password, data: { full_name: d.name, dealership: d.dealership, address: d.address, phone: d.phone, agreed_terms_at: d.agreed_terms_at || '' } });
        if (!r.ok) {
            const m = authError(r.j, '');
            if (/already|exists/i.test(m)) throw new Error('That email already has an account. Log in instead, or reset your password.');
            if (/rate limit/i.test(m)) throw new Error('We could not send the confirmation email right now (the email service has a limit on how many it sends per hour). If you already submitted this form once, your account may exist: tap "I already have an account" and log in. Otherwise please try again in about an hour, or continue as a guest for now.');
            throw new Error(m || 'Sign-up failed (HTTP ' + r.status + ').');
        }
        const s = sessionFrom(r.j); if (s) { saveAuth(s); return 'active'; }
        if (r.j && Array.isArray(r.j.identities) && r.j.identities.length === 0) throw new Error('That email already has an account. Log in instead, or reset your password.');
        return 'confirm';                          // confirmation email sent
    }
    async function logIn(email, password) {
        const r = await authPost('/token?grant_type=password', { email, password });
        if (!r.ok) throw new Error(/invalid/i.test(authError(r.j, '')) ? 'Wrong email or password.' : /confirm/i.test(authError(r.j, '')) ? 'Please confirm your email first (check your inbox for our link), then log in. If no email arrived, ask the office to confirm your account.' : authError(r.j, 'Login failed (HTTP ' + r.status + ').'));
        saveAuth(sessionFrom(r.j));
    }
    async function refreshSession() {
        if (!auth || !auth.refresh_token) return false;
        const r = await authPost('/token?grant_type=refresh_token', { refresh_token: auth.refresh_token });
        if (!r.ok) { if (r.status === 400 || r.status === 401) saveAuth(null); return false; }
        saveAuth(sessionFrom(r.j)); return true;
    }
    async function ensureSession() {
        if (!auth || !auth.access_token) return false;
        if ((auth.expires_at || 0) - Math.floor(Date.now() / 1000) > 60) return true;
        const ok = await refreshSession(); return ok || !!(auth && auth.access_token);   // offline: keep the stored session
    }
    async function logOut() {
        const tok = auth && auth.access_token; saveAuth(null);
        if (tok) { try { await authPost('/logout', {}, tok); } catch (e) { /* ignore */ } }
        setGuest(false); lead = blank(); welcomeScreen();
    }
    async function forgotPassword(email) { const r = await authPost('/recover?redirect_to=' + encodeURIComponent(SITE_URL), { email }); if (!r.ok) throw new Error(authError(r.j, 'Could not send the reset email.')); }
    async function setPassword(password) {
        const res = await fetch(AUTH_URL + '/user', { method: 'PUT', headers: Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + auth.access_token }), body: JSON.stringify({ password }) });
        const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(authError(j, 'Could not save the new password.'));
        if (j && j.id) saveAuth(Object.assign({}, auth, { user: j }));
    }
    // Recovery links from the reset email arrive as #access_token=…&type=recovery
    function recoveryFromHash() {
        const h = location.hash || ''; if (!/type=recovery/.test(h)) return null;
        const q = new URLSearchParams(h.replace(/^#/, '')); if (!q.get('access_token')) return null;
        const s = { access_token: q.get('access_token'), refresh_token: q.get('refresh_token') || '', expires_at: Math.floor(Date.now() / 1000) + parseInt(q.get('expires_in') || '3600', 10), user: null };
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
        return s;
    }
    function setHeader() {
        const u = me(); const btn = $('hdrAccount'); const sub = document.querySelector('.hdr .s'); const rs = document.querySelector('.hdr .restart');
        if (auth && auth.access_token) { btn.style.display = ''; btn.innerHTML = 'Log out'; btn.title = u.email; if (sub) sub.textContent = (u.name || u.email) + (u.dealership ? ' · ' + u.dealership : ''); if (rs) rs.style.display = ''; }
        else if (isGuest()) { btn.style.display = ''; btn.innerHTML = 'Log in'; btn.title = 'Log in or create a marketing partner account'; btn.onclick = () => { setGuest(false); loginScreen(); }; if (sub) sub.textContent = 'Universal Insurance Brokers · Guest'; if (rs) rs.style.display = ''; }
        else { btn.style.display = 'none'; if (sub) sub.textContent = 'Universal Insurance Brokers · Marketing partners'; if (rs) rs.style.display = 'none'; }
        if (loggedIn()) btn.onclick = () => MaxLead.logout();
    }
    function formShell(id, title, intro, body) { cur = ''; $('steps').innerHTML = ''; compose(''); $('log').innerHTML = '<div class="form" id="' + id + '"><h2>' + title + '</h2><p>' + intro + '</p>' + body + '<div class="err" id="f_err" style="display:none;"></div></div>'; window.scrollTo({ top: 0 }); }
    function showErr(text) { const e = $('f_err'); if (!e) return; e.innerHTML = text; e.style.display = ''; }
    // MAX greets and offers the three ways in, as chat bubbles with reply buttons.
    async function welcomeScreen() {
        setGuest(false); setHeader(); step = 0; $('steps').innerHTML = ''; $('log').innerHTML = ''; compose('');
        await say("Hi! I'm <b>MAX</b>, the quote assistant at Universal Insurance Brokers. I can get a car insurance quote started in about two minutes from a photo of a driver's license and a VIN.");
        await say('Are you a <b>marketing partner</b> (auto-dealer salesperson) referring a customer, or would you like a quote for yourself as a guest?');
        compose('<div id="welcomeChoices" class="chips" style="flex-direction:column;">' +
            '<button class="b pri big" id="w_login" onclick="MaxLead.chooseLogin()">🔐 Log in</button>' +
            '<button class="b ok big" id="w_signup" onclick="MaxLead.chooseSignup()">🤝 Create account</button>' +
            '<button class="b sec big" id="w_guest" onclick="MaxLead.continueAsGuest()">Continue as guest</button></div>' +
            '<p class="consent" style="margin-top:6px;">Marketing partners log in so their referrals are credited to them. Guests can send a quote request for themselves without an account.</p>');
    }
    function chooseLogin() { msg('user', 'Log in'); loginScreen(); }
    function chooseSignup() { msg('user', 'Create an account'); dealerSignup(); }
    async function continueAsGuest() { const fromWelcome = !!$('welcomeChoices'); if (fromWelcome) msg('user', 'Continue as guest'); setGuest(true); lead = blank(); start({ greeted: fromWelcome }); }
    function loginScreen(notice) {
        setHeader(); step = 0;
        formShell('loginForm', '🔐 Marketing partner log in', 'Sign in with the email and password you chose when you signed up.',
            '<div><label>Email</label><input type="email" id="l_email" inputmode="email" autocomplete="username" placeholder="name@dealership.com" onkeydown="MaxLead.enter(event, MaxLead.login)"></div>' +
            '<div><label>Password</label><input type="password" id="l_pw" autocomplete="current-password" placeholder="Your password" onkeydown="MaxLead.enter(event, MaxLead.login)"></div>' +
            (notice ? '<div class="ok-note">' + notice + '</div>' : '') +
            '<button class="b pri big" id="l_btn" onclick="MaxLead.login()">Log in</button>' +
            '<div class="links"><a href="#" onclick="MaxLead.forgot();return false;">Forgot password?</a><a href="#" onclick="MaxLead.dealerSignup();return false;">New here? Create your account</a></div>' +
            '<div class="links"><a href="#" onclick="MaxLead.welcome();return false;">&larr; Back</a><a href="#" onclick="MaxLead.continueAsGuest();return false;">Continue as guest</a></div>');
        setTimeout(() => { const e = $('l_email'); if (e) e.focus(); }, 50);
    }
    async function login() {
        const email = ($('l_email').value || '').trim().toLowerCase(); const pw = $('l_pw').value || '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Please enter the email you signed up with.');
        if (!pw) return showErr('Please enter your password.');
        const btn = $('l_btn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Logging in…';
        try { await logIn(email, pw); setGuest(false); haptic('success'); lead = blank(); start(); }
        catch (e) { btn.disabled = false; btn.innerHTML = 'Log in'; showErr(esc(e.message)); haptic('error'); }
    }
    async function forgot() {
        const email = ($('l_email') && $('l_email').value || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Type your email in the box above, then tap "Forgot password?" again.');
        try { await forgotPassword(email); loginScreen('If <b>' + esc(email) + '</b> has an account, a password-reset link is on its way. Open it on this device and choose a new password.'); }
        catch (e) { showErr(esc(e.message)); }
    }
    function resetScreen() {
        setHeader();
        formShell('resetForm', '🔑 Choose a new password', 'You followed a password-reset link. Pick a new password for ' + esc(me().email || 'your account') + '.',
            '<div><label>New password</label><input type="password" id="r_pw" autocomplete="new-password" placeholder="At least 8 characters"></div>' +
            '<div><label>Confirm new password</label><input type="password" id="r_pw2" autocomplete="new-password" placeholder="Type it again" onkeydown="MaxLead.enter(event, MaxLead.saveNewPassword)"></div>' +
            '<button class="b pri big" id="r_btn" onclick="MaxLead.saveNewPassword()">Save password</button>');
    }
    async function saveNewPassword() {
        const pw = $('r_pw').value || '', pw2 = $('r_pw2').value || '';
        if (pw.length < 8) return showErr('Please choose a password of at least 8 characters.');
        if (pw !== pw2) return showErr('The two passwords do not match.');
        const btn = $('r_btn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Saving…';
        try { await setPassword(pw); haptic('success'); lead = blank(); start(); }
        catch (e) { btn.disabled = false; btn.innerHTML = 'Save password'; showErr(esc(e.message) + ' Request a new reset link from the login screen if this one expired.'); }
    }
    async function boot() {
        loadAuth();
        const rec = recoveryFromHash();
        if (rec) { saveAuth(rec); try { const res = await fetch(AUTH_URL + '/user', { headers: Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + rec.access_token }) }); const u = await res.json(); if (res.ok && u && u.id) saveAuth(Object.assign({}, rec, { user: u })); } catch (e) { /* offline */ } return resetScreen(); }
        if (await ensureSession()) { setHeader(); return start(); }
        if (guest) { setHeader(); return start(); }
        welcomeScreen();
    }

    // ── back navigation ──────────────────────────────────────────
    // Each composer panel registers which step it belongs to; "← Back"
    // re-asks the previous step without losing what was already entered.
    let cur = '';
    const PREV = { dlType: 'dl', dlConfirm: 'dl', vin: 'dl', vinType: 'vin', vinBad: 'vin', phone: 'vin', email: 'phone' };
    function withBack(html, key) {
        cur = key;
        const canBack = !!PREV[key] || (key === 'dl' && isGuest());
        return canBack ? html + '<div class="links" style="justify-content:center;margin-top:8px;"><a href="#" class="back-link" onclick="MaxLead.back();return false;">&larr; Back</a></div>' : html;
    }
    async function back() {
        if (busy) return;
        const to = PREV[cur];
        if (!to) { if (cur === 'dl' && isGuest()) { msg('user', 'Back'); return welcomeScreen(); } return; }
        msg('user', 'Back');
        if (to === 'dl') { step = 0; progress(); await say(isGuest() ? 'No problem — back to your license.' : 'No problem — back to the customer\'s license.'); return composeDL(); }
        if (to === 'vin') { step = 1; progress(); await say('Back to the car\'s VIN.'); return composeVIN(); }
        if (to === 'phone') { return askPhone(); }
    }

    // ── steps ────────────────────────────────────────────────────
    async function start(opts) {
        setHeader(); opts = opts || {};
        if (!opts.greeted) $('log').innerHTML = '';
        step = 0; progress();
        if (isGuest() && opts.greeted) {
            await say('Great — let\'s get your quote started. Snap your driver\'s license and VIN, add your phone and email, and a licensed agent will contact you with your best rates.');
            await say('First, take a photo of the <b>front of your driver\'s license</b>. Hold it flat, fill the frame, and avoid glare. It is used only to prepare your quote.');
        } else if (isGuest()) {
            await say("Hi! I'm MAX from Universal Insurance Brokers. Snap your driver's license and VIN, add your phone and email, and a licensed agent will contact you with your best car insurance rates.");
            await say('First, take a photo of the <b>front of your driver\'s license</b>. Hold it flat, fill the frame, and avoid glare. It is used only to prepare your quote.');
        } else {
            await say('Hi ' + esc(firstOf(me().name) || 'there') + "! I'm MAX. Snap your customer's driver's license and VIN, add their phone and email, and a licensed UIB agent will contact them with their best car insurance rates.");
            await say('First, take a photo of the <b>front of the customer\'s driver\'s license</b>. Hold it flat, fill the frame, and avoid glare.');
        }
        composeDL();
    }
    function fmtPhone(v) { const d = String(v || '').replace(/\D/g, '').slice(0, 10); if (d.length < 4) return d; if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3); return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6); }
    async function askPhone() {
        step = 2; progress();
        await say(isGuest() ? 'Almost done, ' + esc(firstName()) + '. What\'s the best phone number for the agent to reach you?' : 'Almost done. What\'s the best phone number for the agent to reach ' + esc(firstName()) + '?');
        compose(withBack('<div class="row"><input type="tel" id="in" inputmode="tel" placeholder="(305) 555-1234" autocomplete="tel" maxlength="14" value="' + esc(lead.phone) + '" oninput="this.value=MaxLead.fmtPhone(this.value)" onkeydown="MaxLead.enter(event, MaxLead.savePhone)"><button class="b pri" onclick="MaxLead.savePhone()">Next</button></div>', 'phone'));
    }
    async function savePhone() {
        const v = fmtPhone($('in').value); if (v.replace(/\D/g, '').length !== 10) { msg('bot err', 'Please enter a 10-digit phone number.'); $('in').focus(); return; }
        lead.phone = v; msg('user', esc(v)); step = 3; progress();
        await say(isGuest() ? 'And your email address? The quote goes there too.' : 'And ' + esc(firstName()) + '\'s email address? The quote goes there too.');
        compose(withBack('<div class="row"><input type="email" id="in" inputmode="email" placeholder="name@example.com" autocomplete="email" value="' + esc(lead.email) + '" onkeydown="MaxLead.enter(event, MaxLead.saveEmail)"><button class="b ok" id="sendBtn" onclick="MaxLead.saveEmail()">Send</button></div>' +
            (isGuest() ? '<p class="consent">By tapping <b>Send</b> you agree to be contacted by Universal Insurance Brokers by phone, text or email about this quote, and you accept the <a href="' + PRIVACY_HREF + '" target="_blank">privacy policy</a>.</p>'
                       : '<p class="consent">By tapping <b>Send</b> you confirm that ' + esc(firstName()) + ' agrees to be contacted by Universal Insurance Brokers by phone, text or email about this quote, and has seen the <a href="' + PRIVACY_HREF + '" target="_blank">privacy policy</a>.</p>'), 'email'));
    }
    async function saveEmail() {
        const v = ($('in').value || '').trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { msg('bot err', 'That email doesn\'t look right. Please check it.'); $('in').focus(); return; }
        lead.email = v; lead.consent = true; msg('user', esc(v)); step = 4; progress();
        await submit();
    }
    // Dates: stored as YYYY-MM-DD, shown as MM/DD/YYYY. isoDate() accepts the
    // date picker's value or a typed MM/DD/YYYY (browsers without a picker).
    const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
    function today() { return new Date().toISOString().slice(0, 10); }
    function isoDate(v) { v = String(v || '').trim(); let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return v; m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); return m ? m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') : ''; }
    function fmtDate(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[2] + '/' + m[3] + '/' + m[1] : (iso || ''); }
    function firstOf(s) { return String(s || '').trim().split(' ')[0]; }
    function firstName() { return firstOf(lead.name) || (isGuest() ? 'there' : 'the customer'); }
    function composeDL() {
        compose(withBack('<div class="chips"><button class="b pri big" id="camBtn" style="flex:1 1 55%;" onclick="MaxLead.pick(\'dl\', \'camera\')">📷 Take a photo of the license</button><button class="b pri big" id="upBtn" style="flex:1 1 40%;background:linear-gradient(to right,#0e7490,#06b6d4);" onclick="MaxLead.pick(\'dl\', \'upload\')">🖼️ Upload a photo</button></div><div class="chips" style="margin-top:8px;"><button class="b sec" onclick="MaxLead.typeDL()">Type it instead</button>' + (lead.dl ? '<button class="b ok" onclick="MaxLead.keepDL()">Keep ' + esc(firstOf(lead.name) || 'this') + '\'s license &amp; continue</button>' : '') + '</div>', 'dl'));
    }
    function typeDL() {
        compose(withBack('<div class="row" style="flex-wrap:wrap;"><input type="text" id="nm" placeholder="' + (isGuest() ? 'Your first and last name' : 'Customer\'s first and last name') + '" autocomplete="off" value="' + esc(lead.name) + '" style="flex:1 1 100%;"><label class="dob-lbl" for="dob" style="flex:1 1 100%;">Date of birth</label><input type="date" id="dob" max="' + today() + '" style="flex:1 1 100%;"><label class="dob-lbl" for="dls" style="flex:1 1 100%;">Driver\'s license state <span style="font-weight:500;color:var(--gray-500);">(optional)</span></label><select id="dls" style="flex:1 1 100%;"><option value="">— Not sure —</option>' + US_STATES.map((s) => '<option value="' + s + '"' + (s === 'FL' ? ' selected' : '') + '>' + s + '</option>').join('') + '</select><input type="text" id="dln" placeholder="DL number (optional)" autocapitalize="characters" autocomplete="off" style="flex:1 1 100%;"><button class="b pri" style="flex:1" onclick="MaxLead.saveTypedDL()">Next</button></div>', 'dlType'));
    }
    async function saveTypedDL() {
        const nm = ($('nm').value || '').trim(); const dob = ($('dob').value || '').trim(); const dln = ($('dln').value || '').trim(); const dls = ($('dls') && $('dls').value) || '';
        if (nm.length < 2) { msg('bot err', isGuest() ? 'Please type your first and last name.' : 'Please type the customer\'s first and last name.'); $('nm').focus(); return; }
        const iso = isoDate(dob); if (!iso) { msg('bot err', 'Please pick the date of birth.'); $('dob').focus(); return; }
        if (new Date(iso) > new Date()) { msg('bot err', 'The date of birth cannot be in the future.'); return; }
        lead.name = nm; const parts = nm.split(' ');
        lead.dl = { firstName: parts[0] || '', lastName: parts.slice(1).join(' '), dob: iso, dlNumber: dln.toUpperCase(), dlState: dls };
        msg('user', esc(nm) + ', DOB ' + esc(fmtDate(iso)) + (dln ? ', DL ' + esc(dln.toUpperCase()) + (dls ? ' (' + esc(dls) + ')' : '') : (dls ? ', DL state ' + esc(dls) : '')));
        await afterDL();
    }
    async function afterDL() {
        step = 1; progress();
        await say('Great. Now a photo of the car\'s <b>VIN</b> — it\'s on the driver\'s door sticker, the dashboard by the windshield, or the registration or insurance card.');
        composeVIN();
    }
    function composeVIN() {
        compose(withBack('<div class="chips"><button class="b pur big" id="camBtn" style="flex:1 1 55%;" onclick="MaxLead.pick(\'vin\', \'camera\')">📷 Take a photo of the VIN</button><button class="b pur big" id="upBtn" style="flex:1 1 40%;background:linear-gradient(to right,#0e7490,#06b6d4);" onclick="MaxLead.pick(\'vin\', \'upload\')">🖼️ Upload a picture of the VIN</button></div><div class="chips" style="margin-top:8px;"><button class="b sec" onclick="MaxLead.typeVIN()">Type the VIN</button><button class="b sec" onclick="MaxLead.skipVIN()">Skip for now</button></div>', 'vin'));
    }
    function typeVIN() {
        compose(withBack('<div class="row"><input type="text" id="in" placeholder="17-character VIN" maxlength="17" autocapitalize="characters" autocomplete="off" spellcheck="false" value="' + esc(lead.vin || '') + '" style="text-transform:uppercase;letter-spacing:1px;font-family:ui-monospace,Menlo,Consolas,monospace;" oninput="MaxLead.vinHint(this)" onkeydown="MaxLead.enter(event, MaxLead.saveTypedVIN)"><button class="b pri" onclick="MaxLead.saveTypedVIN()">Decode</button></div><p class="consent" id="vinHint">17 letters and numbers, no I, O or Q.</p>', 'vinType'));
    }
    function vinHint(inp) { const v = (inp.value || '').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, ''); const h = $('vinHint'); if (!h) return; h.textContent = v.length === 17 ? (vinCheckDigit(v) ? 'Looks good — tap Decode.' : 'Check digit does not match; double-check the characters.') : v.length + ' / 17 characters' + (/[IOQ]/i.test(inp.value) ? ' — VINs never contain I, O or Q' : ''); }
    // ISO 3779 check digit (position 9) used on North American VINs.
    function vinCheckDigit(vin) {
        const map = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
        const w = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]; let sum = 0;
        for (let i = 0; i < 17; i++) { const c = vin[i]; const n = /\d/.test(c) ? parseInt(c, 10) : (map[c] || 0); sum += n * w[i]; }
        const cd = sum % 11; return (cd === 10 ? 'X' : String(cd)) === vin[8];
    }
    async function saveTypedVIN() {
        const v = ($('in').value || '').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
        if (v.length !== 17) { msg('bot err', 'A VIN has exactly 17 letters and numbers (no I, O or Q).'); return; }
        msg('user', esc(v)); await useVIN(v);
    }
    async function skipVIN() { msg('user', 'Skip for now'); lead.vin = ''; lead.vehicle = null; await afterVIN(); }
    // VIN decoder (NHTSA vPIC, free, no key). Returns the decoded vehicle or
    // null, plus the decoder's own verdict on the VIN itself.
    async function decodeVIN(vin) {
        const r = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + encodeURIComponent(vin) + '?format=json');
        const j = await r.json(); const d = (j.Results && j.Results[0]) || {};
        const codes = String(d.ErrorCode || '').split(',').map((x) => x.trim()).filter(Boolean);
        const bad = codes.some((c) => c !== '0' && c !== '6');          // 6 = incomplete VIN decode, still usable
        const engine = [d.DisplacementL ? (Math.round(parseFloat(d.DisplacementL) * 10) / 10) + 'L' : '', d.EngineCylinders ? d.EngineCylinders + '-cyl' : '', d.EngineHP ? d.EngineHP + ' hp' : ''].filter(Boolean).join(' ');
        const vehicle = d.Make ? { year: d.ModelYear || '', make: titleCase(d.Make), model: d.Model || '', trim: d.Trim || d.Series || '', body: d.BodyClass || '', doors: d.Doors || '', engine, fuel: d.FuelTypePrimary || '', drive: d.DriveType || '', transmission: d.TransmissionStyle || '', type: d.VehicleType ? titleCase(d.VehicleType) : '', plant: [d.PlantCity ? titleCase(d.PlantCity) : '', d.PlantCountry ? titleCase(d.PlantCountry).replace(/\(Usa\)/, '(USA)') : ''].filter(Boolean).join(', '), checkDigitOk: !codes.includes('1') } : null;
        return { vehicle, bad, error: bad ? String(d.ErrorText || '').split(';')[0].replace(/^\d+\s*-\s*/, '') : '' };
    }
    function vehicleCard(vin, v) {
        const row = (k, val) => val ? '<div><b>' + k + ':</b> ' + esc(val) + '</div>' : '';
        return '<div class="card"><div><b>VIN:</b> <span style="font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:1px;">' + esc(vin) + '</span></div>' +
            row('Vehicle', [v.year, v.make, v.model].filter(Boolean).join(' ')) + row('Trim', v.trim) + row('Body', [v.body, v.doors ? v.doors + '-door' : ''].filter(Boolean).join(', ')) +
            row('Engine', [v.engine, v.fuel].filter(Boolean).join(', ')) + row('Drive', [v.drive, v.transmission].filter(Boolean).join(', ')) + row('Built in', v.plant) +
            (v.checkDigitOk ? '' : '<div style="color:#92400e;"><b>Note:</b> the VIN\'s check digit does not match — please double-check it.</div>') + '</div>';
    }
    async function useVIN(vin) {
        lead.vin = vin; lead.vehicle = null; typing(true);
        let dec = null;
        try { dec = await decodeVIN(vin); } catch (e) { /* offline: keep just the VIN */ }
        typing(false);
        if (dec && dec.vehicle) {
            lead.vehicle = dec.vehicle; haptic('success');
            await say('VIN decoded — a <b>' + esc([dec.vehicle.year, dec.vehicle.make, dec.vehicle.model].filter(Boolean).join(' ')) + '</b>.' + vehicleCard(vin, dec.vehicle));
            return afterVIN();
        }
        if (dec && dec.bad) {
            await say('The VIN decoder could not verify <b>' + esc(vin) + '</b>' + (dec.error ? ' (' + esc(dec.error) + ')' : '') + '. Please check it against the door sticker or registration.');
            compose(withBack('<div class="chips"><button class="b pri" onclick="MaxLead.typeVIN()">Fix the VIN</button><button class="b sec" onclick="MaxLead.pick(\'vin\', \'camera\')">📷 Retake photo</button><button class="b sec" onclick="MaxLead.keepVIN()">Use it anyway</button></div>', 'vinBad'));
            return;
        }
        await say('Got the VIN ' + esc(vin) + ' (the decoder is not reachable right now, so the agent will look up the vehicle).');
        await afterVIN();
    }
    async function keepVIN() { msg('user', 'Use it anyway'); await afterVIN(); }
    async function keepDL() { msg('user', 'Keep the license'); await afterDL(); }
    function titleCase(s) { return String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
    async function afterVIN() { await askPhone(); }

    // ── photos → MAX reads them ──────────────────────────────────
    // how = 'camera' (take a new photo) or 'upload' (an existing photo / file)
    function pick(kind, how) {
        pendingKind = kind;
        if (NATIVE && Plug.Camera) return nativePhoto(kind, how);
        const f = $(how === 'upload' ? 'fileUpload' : 'file'); f.value = ''; f.click();
    }
    // Native camera (App Store / Play Store builds): the phone's own camera
    // UI, orientation corrected, nothing saved to the gallery. "PROMPT" lets
    // the prospect choose between the camera and an existing photo.
    async function nativePhoto(kind, how) {
        if (busy) return;
        let shot;
        try {
            shot = await Plug.Camera.getPhoto({ quality: 90, width: 2000, height: 2000, resultType: 'base64', source: how === 'upload' ? 'PHOTOS' : how === 'camera' ? 'CAMERA' : 'PROMPT', correctOrientation: true, saveToGallery: false, promptLabelHeader: kind === 'dl' ? "Driver's license" : 'VIN', promptLabelPhoto: 'Choose from photos', promptLabelPicture: 'Take a photo' });
        } catch (e) {
            const m = String((e && e.message) || e || '');
            if (/cancel/i.test(m)) return;                       // the prospect closed the camera
            if (/denied|permission/i.test(m)) { msg('bot err', 'MAX needs camera access to read the license. Allow it in your phone\'s Settings, or type the details instead.'); if (kind === 'dl') composeDL(); else composeVIN(); return; }
            const f = $(how === 'upload' ? 'fileUpload' : 'file'); f.value = ''; f.click(); return;   // anything else: the browser picker
        }
        if (!shot || !shot.base64String) return;
        const media = 'image/' + ((shot.format || 'jpeg').replace('jpg', 'jpeg'));
        await handleImage({ url: 'data:' + media + ';base64,' + shot.base64String, b64: shot.base64String, media }, kind);
    }
    async function fileChosen(input) {
        const file = input.files && input.files[0]; if (!file || busy) return;
        busy = true;
        let im;
        try { im = await prepare(file); } catch (e) { busy = false; msg('bot err', 'I could not open that photo. Please try again with the camera.'); return; }
        busy = false;
        await handleImage(im, pendingKind);
    }
    async function handleImage(im, kind) {
        if (busy) return;
        busy = true;
        msg('user', kind === 'dl' ? 'Customer\'s license' : 'Car VIN', im.url);
        typing(true);
        try {
            const data = await extract(im, kind);
            typing(false);
            if (kind === 'dl') {
                if (!data || !(data.firstName || data.lastName || data.dob || data.dlNumber)) { await say('I couldn\'t read that clearly. Try again with more light, no glare, and the card filling the frame.'); composeDL(); busy = false; return; }
                lead.dl = data; lead.dlPhoto = im; haptic('success');
                if (data.address) lead.address = data.address;
                await say('I read: <b>' + esc([data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ')) + '</b>' + (data.dob ? ', born ' + esc(fmtDate(data.dob)) : '') + (data.dlNumber ? ', license ' + esc(data.dlNumber) : '') + '. Is that right?');
                compose(withBack('<div class="chips"><button class="b ok" onclick="MaxLead.confirmDL(true)">Yes, correct</button><button class="b sec" onclick="MaxLead.confirmDL(false)">Retake photo</button></div>', 'dlConfirm'));
            } else {
                const vin = String((data && data.vin) || '').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
                if (vin.length !== 17) { await say('I couldn\'t make out a full 17-character VIN. Try a closer, straight-on photo, or type it.'); composeVIN(); busy = false; return; }
                lead.vinPhoto = im; haptic('success'); await useVIN(vin);
            }
        } catch (e) {
            typing(false);
            await say('Sorry, I had trouble reading that (' + esc(e.message) + '). You can try again or type the details.');
            if (kind === 'dl') composeDL(); else composeVIN();
        }
        busy = false;
    }
    async function confirmDL(ok) {
        msg('user', ok ? 'Yes, correct' : 'Retake');
        if (!ok) { lead.dl = null; lead.dlPhoto = null; lead.name = ''; composeDL(); return; }
        lead.name = [lead.dl.firstName, lead.dl.lastName].filter(Boolean).join(' ') || lead.name;
        await afterDL();
    }

    async function loadBitmap(file) {
        if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall back */ } }
        return new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); }; img.src = url; });
    }
    async function prepare(file) {
        const bmp = await loadBitmap(file);
        const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
        const scale = Math.min(1, 2000 / Math.max(w, h));
        const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * scale)); cv.height = Math.max(1, Math.round(h * scale));
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
        if (bmp.close) bmp.close();
        const url = cv.toDataURL('image/jpeg', 0.9);
        return { url, b64: url.split(',')[1], media: 'image/jpeg' };
    }
    async function extract(im, kind) {
        const system = 'You are MAX, an assistant inside Universal Insurance Brokers\' quote app. The customer is sharing their own ' + (kind === 'dl' ? "driver's license" : 'vehicle VIN') + ' photo so an agent can prepare their car insurance quote; reading it is expected. Transcribe what you can read even if the photo is rotated, tilted or glary; leave out fields you cannot read. Answer with ONLY a JSON object, no prose. ' +
            (kind === 'dl' ? 'Keys: firstName, middleName, lastName, dob (YYYY-MM-DD), gender (Male/Female), dlNumber, dlState (2 letters), address (one line), expiration (YYYY-MM-DD).' : 'Keys: vin (17 characters, letters I, O and Q never occur), plate (if visible).') +
            ' If nothing is legible answer {}.';
        const res = await fetch(CLAUDE_FN, { method: 'POST', headers: HEADERS, body: JSON.stringify({ model: MODEL, max_tokens: 400, system, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: im.media, data: im.b64 } }, { type: 'text', text: 'Read this ' + (kind === 'dl' ? 'license' : 'VIN') + '.' }] }] }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) throw new Error((j.error && (j.error.message || j.error.type)) || ('HTTP ' + res.status));
        const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
        try { return JSON.parse(m[0]); } catch (e) { return null; }
    }

    // ── submit ───────────────────────────────────────────────────
    function leadText() {
        const d = lead.dl || {}; const v = lead.vehicle || {}; const u = me();
        return ['NEW LEAD — MAX app', 'Received: ' + new Date().toLocaleString('en-US'), '',
            'REFERRED BY', ...(isGuest() ? ['  Guest — no marketing partner account (customer used the app directly)'] : ['  ' + (u.name || '—') + (u.dealership ? ' — ' + u.dealership : ''), '  ' + [u.phone, u.email].filter(Boolean).join('   ')]), '',
            'Name: ' + lead.name, 'Phone: ' + lead.phone, 'Email: ' + lead.email, '',
            'DRIVER\'S LICENSE', '  Name on license: ' + ([d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ') || '—'), '  DOB: ' + (d.dob ? fmtDate(d.dob) : '—') + '   Sex: ' + (d.gender || '—'), '  DL #: ' + (d.dlNumber || '—') + '   State: ' + (d.dlState || '—') + '   Exp: ' + (d.expiration || '—'), '  Address: ' + (d.address || lead.address || '—'), '',
            'VEHICLE', '  VIN: ' + (lead.vin || '— (skipped)'), '  ' + ([v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || (lead.vin ? '(not decoded)' : '')),
            ...(v.make ? ['  Body: ' + ([v.body, v.doors ? v.doors + '-door' : ''].filter(Boolean).join(', ') || '—'), '  Engine: ' + ([v.engine, v.fuel].filter(Boolean).join(', ') || '—'), '  Drive: ' + ([v.drive, v.transmission].filter(Boolean).join(', ') || '—'), '  Built in: ' + (v.plant || '—')] : []), '',
            'Consent to contact: yes (agreed in the app)', '',
            (lead.dlPhoto ? 'License photo attached. ' : '') + (lead.vinPhoto ? 'VIN photo attached.' : '')].join('\n');
    }
    async function submit() {
        const btn = $('sendBtn'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Sending…'; }
        typing(true);
        const u = me(); const text = leadText(); const subject = 'New Lead (MAX app) – ' + lead.name + (isGuest() ? ' (guest)' : (u.dealership || u.name ? ' via ' + (u.dealership || u.name) : ''));
        const attachments = []; if (lead.dlPhoto) attachments.push({ filename: 'drivers-license.jpg', content: lead.dlPhoto.b64 }); if (lead.vinPhoto) attachments.push({ filename: 'vin.jpg', content: lead.vinPhoto.b64 });
        try {
            const res = await fetch(INQUIRY_FN, { method: 'POST', headers: HEADERS, body: JSON.stringify({ subject, text, html: '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;">' + esc(text) + '</pre>', replyTo: lead.email, attachments, source: 'max-app',
                lead: { name: lead.name, phone: lead.phone, email: lead.email, dl: lead.dl, vin: lead.vin, vehicle: lead.vehicle, address: (lead.dl && lead.dl.address) || lead.address || '', referrer: isGuest() ? { guest: true } : { user_id: u.id, name: u.name, dealership: u.dealership, phone: u.phone, email: u.email } } }) });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
            typing(false); haptic('success'); done();
        } catch (e) {
            // Fallback: the prospect's own mail app, prefilled (photos cannot be attached this way).
            const mailto = 'mailto:' + INQUIRY_TO + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text.slice(0, 1800));
            typing(false); if (btn) { btn.disabled = false; btn.innerHTML = 'Send'; }
            msg('bot err', 'I couldn\'t send that automatically. <a href="' + mailto + '">Tap here to send it by email</a> and we\'ll take it from there.');
        }
    }
    function done() {
        compose('');
        $('log').innerHTML += '<div class="done"><div class="big-check">✓</div><h2>' + (isGuest() ? 'Thanks, ' + esc(firstName()) + '!' : 'Sent!') + '</h2><p><b>An agent will contact ' + (isGuest() ? 'you' : esc(firstName())) + ' shortly.</b> ' + (isGuest() ? 'Your details are on their way to Universal Insurance Brokers; a licensed agent will reach you at ' + esc(lead.phone) + ' or ' + esc(lead.email) + ' with your best rates.' : 'The details are on their way to Universal Insurance Brokers; a licensed agent will reach ' + esc(firstName()) + ' at ' + esc(lead.phone) + ' or ' + esc(lead.email) + ' with their best rates.') + '</p><p style="margin-top:14px;"><button class="b sec" onclick="MaxLead.restart()">' + (isGuest() ? 'Start another quote' : 'Refer another customer') + '</button></p></div>';
        scrollDown();
        try { localStorage.removeItem('maxLeadDraft'); } catch (e) {}
    }
    function restart() { if (!loggedIn() && !isGuest()) return welcomeScreen(); if (step > 0 && !confirm('Start over?')) return; lead = blank(); start(); }

    // ── Auto dealer sign-up ──────────────────────────────────────
    // A dealership salesperson registers so the office can set them up as a
    // referral partner. Sent to the office like a lead (source 'dealer-signup').
    function dealerSignup() {
        setHeader();
        formShell('signupForm', '🤝 Create your marketing partner account', 'Partner with Universal Insurance Brokers. You will log in with this email and password.',
            '<div><label>Full name</label><input type="text" id="d_name" autocomplete="name" placeholder="First and last name"></div>' +
            '<div><label>Dealership</label><input type="text" id="d_dealer" autocomplete="organization" placeholder="Dealership name"></div>' +
            '<div><label>Address <span style="font-weight:500;color:var(--gray-500);">(optional)</span></label><input type="text" id="d_address" autocomplete="street-address" placeholder="Street, city, state, zip"></div>' +
            '<div><label>Phone number</label><input type="tel" id="d_phone" inputmode="tel" autocomplete="tel" placeholder="(305) 555-1234" maxlength="14" oninput="this.value=MaxLead.fmtPhone(this.value)"></div>' +
            '<div><label>Email (this is your username)</label><input type="email" id="d_email" inputmode="email" autocomplete="username" placeholder="name@dealership.com"></div>' +
            '<div><label>Password</label><input type="password" id="d_pw" autocomplete="new-password" placeholder="At least 8 characters"></div>' +
            '<div><label>Confirm password</label><input type="password" id="d_pw2" autocomplete="new-password" placeholder="Type it again" onkeydown="MaxLead.enter(event, MaxLead.submitDealer)"></div>' +
            '<div class="terms"><b>Referral partner disclaimer</b>' + PARTNER_TERMS.map((x) => '<p>' + x + '</p>').join('') + '</div>' +
            '<label class="ack"><input type="checkbox" id="d_ack"><span>I have read and understand the disclaimer above, and I acknowledge that by signing up I become a marketing agent for Universal Insurance Brokers under these terms.</span></label>' +
            '<button class="b ok big" id="d_send" onclick="MaxLead.submitDealer()">Create account</button>' +
            '<button class="b sec big" onclick="MaxLead.toLogin()">I already have an account</button>' +
            '<div class="links"><a href="#" onclick="MaxLead.welcome();return false;">&larr; Back</a><a href="#" onclick="MaxLead.continueAsGuest();return false;">Continue as guest</a></div>');
        step = 0; setTimeout(() => $('d_name').focus(), 50);
    }
    async function submitDealer() {
        const v = (id) => ($(id).value || '').trim();
        const d = { name: v('d_name'), dealership: v('d_dealer'), address: v('d_address'), phone: fmtPhone(v('d_phone')), email: v('d_email').toLowerCase() };
        const pw = $('d_pw').value || '', pw2 = $('d_pw2').value || '';
        const problem = d.name.length < 2 ? 'Please enter your full name.' : d.phone.replace(/\D/g, '').length !== 10 ? 'Please enter a 10-digit phone number.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ? 'Please enter a valid email.' : pw.length < 8 ? 'Please choose a password of at least 8 characters.' : pw !== pw2 ? 'The two passwords do not match.' : !$('d_ack').checked ? 'Please read the disclaimer and tick the acknowledgement box to continue.' : '';
        d.agreed_terms_at = new Date().toISOString();
        if (problem) { showErr(problem); haptic('error'); return; }
        $('f_err').style.display = 'none';
        const btn = $('d_send'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Creating account…';
        let outcome;
        try { outcome = await signUp(d, pw); }
        catch (e) { btn.disabled = false; btn.innerHTML = 'Create account'; showErr(esc(e.message)); haptic('error'); return; }
        // Tell the office (best effort; the account exists either way).
        const subject = 'New Dealer Sign-up – ' + d.name + (d.dealership ? ' (' + d.dealership + ')' : '');
        const text = ['NEW AUTO DEALER SIGN-UP — MAX app', 'Received: ' + new Date().toLocaleString('en-US'), '', 'Name: ' + d.name, 'Dealership: ' + (d.dealership || '—'), 'Address: ' + (d.address || '—'), 'Phone: ' + d.phone, 'Email (login): ' + d.email, '', 'Referral partner disclaimer acknowledged: ' + d.agreed_terms_at].join('\n');
        try { await fetch(INQUIRY_FN, { method: 'POST', headers: HEADERS, body: JSON.stringify({ subject, text, html: '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;">' + esc(text) + '</pre>', replyTo: d.email, source: 'dealer-signup', lead: Object.assign({ type: 'dealer' }, d) }) }); } catch (e) { /* ignore */ }
        haptic('success');
        if (outcome === 'active') { setGuest(false); lead = blank(); return start(); }
        $('log').innerHTML = '<div class="done"><div class="big-check">✉</div><h2>Check your email</h2><p>We sent a confirmation link to <b>' + esc(d.email) + '</b>. Tap it, then come back here and log in with your email and password.</p><p style="margin-top:14px;"><button class="b pri" onclick="MaxLead.toLogin()">Go to log in</button></p></div>';
        window.scrollTo({ top: 0 });
    }
    function toLogin() { loginScreen(); }

    // ── boot ─────────────────────────────────────────────────────
    // The worker lives at the site root (sw.js) and controls the whole site.
    if (!NATIVE && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    function initNative() {
        if (!NATIVE) return;
        document.documentElement.classList.add('native');
        document.querySelectorAll('a[href="/privacy"]').forEach((a) => { a.setAttribute('href', PRIVACY_HREF); a.removeAttribute('target'); });
        try { if (Plug.StatusBar) { Plug.StatusBar.setStyle({ style: 'DARK' }).catch(() => {}); Plug.StatusBar.setBackgroundColor({ color: '#0d1f3c' }).catch(() => {}); } } catch (e) { /* iOS has no setBackgroundColor */ }
        try { if (Plug.App) Plug.App.addListener('backButton', () => { if ($('signupForm') || $('loginForm')) welcomeScreen(); else Plug.App.minimizeApp(); }); } catch (e) { /* ignore */ }
        try { if (Plug.SplashScreen) setTimeout(() => Plug.SplashScreen.hide().catch(() => {}), 150); } catch (e) { /* ignore */ }
    }
    // Offline notice: the bundled app opens without a connection, but MAX
    // needs one to read photos and send the lead.
    function onlineState() { const b = $('offline'); if (b) b.style.display = navigator.onLine === false ? 'block' : 'none'; }
    window.addEventListener('online', onlineState); window.addEventListener('offline', onlineState);
    document.addEventListener('DOMContentLoaded', () => { initNative(); onlineState(); boot(); });
    window.addEventListener('hashchange', () => { if (/type=recovery/.test(location.hash)) boot(); });   // reset link opened in an already-open tab

    window.MaxLead = { enter: onEnter, back, keepDL, login, logout: logOut, forgot, toLogin, welcome: welcomeScreen, chooseLogin, chooseSignup, continueAsGuest, saveNewPassword, savePhone, saveEmail, fmtPhone, pick, fileChosen, keepVIN, vinHint, confirmDL, typeDL, saveTypedDL, typeVIN, saveTypedVIN, skipVIN, submit, restart, dealerSignup, submitDealer, get lead() { return lead; }, get user() { return me(); } };
})();
