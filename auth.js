'use strict';

// Auth is independent of app.js/IndexedDB. Only this module creates a client.
(() => {
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
  const rootURL = new URL('./', document.currentScript.src);
  const redirectTo = rootURL.href;
  const callbackURL = new URL(location.href);
  const callbackHash = new URLSearchParams(callbackURL.hash.slice(1));
  const isCallback = callbackURL.searchParams.has('code') || callbackURL.searchParams.has('error') || callbackHash.has('access_token') || callbackHash.has('error');
  const callbackFailed = callbackURL.searchParams.has('error') || callbackHash.has('error');
  const el = id => document.getElementById(id);
  let client = null, initializing = null, user = null, ready = false, busy = false, problem = '';

  function projectBaseURL() {
    if (typeof SUPABASE_URL !== 'string') return null;
    try {
      const url = new URL(SUPABASE_URL);
      // createClient derives Auth and REST itself. Never accept an API endpoint
      // (including /rest/v1) as its base, or silently discard a configured path.
      if (url.protocol !== 'https:' || url.username || url.password ||
          url.pathname !== '/' || url.search || url.hash) return null;
      return url.origin;
    } catch {return null;}
  }

  function configured() {
    return projectBaseURL() !== null && typeof SUPABASE_PUBLISHABLE_KEY === 'string' &&
      /^sb_publishable_[A-Za-z0-9_-]+$/.test(SUPABASE_PUBLISHABLE_KEY);
  }

  function renderAccount() {
    const name = user?.user_metadata?.full_name || user?.user_metadata?.name || '';
    el('auth-identity').textContent = user ? [name,user.email].filter(Boolean).join(' · ') || 'Signed-in account' : '';
    el('auth-identity').hidden = !user;
    el('auth-status').textContent = !navigator.onLine
      ? user ? 'Offline · session not checked · cloud sync not enabled yet' : ready ? 'Not signed in · offline' : 'Offline · account unavailable; local diary available'
      : !configured() ? 'Account setup needed · local diary available'
      : user ? 'Signed in · cloud sync not enabled yet'
      : ready ? 'Not signed in · cloud sync not enabled yet'
      : problem ? 'Account unavailable · local diary available' : 'Checking account…';
    el('auth-error').textContent = problem;
    el('auth-error').hidden = !problem;
    el('auth-action').textContent = busy ? 'Please wait…' : user ? 'Sign out' : 'Sign in with Google';
    el('auth-action').disabled = busy || !navigator.onLine || !configured();
    el('auth-action').title = !navigator.onLine ? 'Reconnect to sign in or sign out' : '';
    window.dispatchEvent(new Event('bella-auth-change'));
  }

  function loadLibrary() {
    if (window.supabase?.createClient) return Promise.resolve();
    return new Promise((resolve,reject) => {
      const script = document.createElement('script');
      const finish = error => {
        clearTimeout(timer); script.onload = script.onerror = null;
        if (error) {script.remove(); reject(error);} else resolve();
      };
      const timer = setTimeout(() => finish(new Error('Library unavailable')),12000);
      script.async = true; script.src = SDK_URL; script.referrerPolicy = 'no-referrer';
      script.onload = () => finish(window.supabase?.createClient ? null : new Error('Library unavailable'));
      script.onerror = () => finish(new Error('Library unavailable'));
      document.head.append(script);
    });
  }

  function cleanCallback() {
    if (!isCallback) return;
    const url = new URL(location.href);
    for (const key of ['code','error','error_code','error_description']) url.searchParams.delete(key);
    if (callbackHash.has('access_token') || callbackHash.has('error')) url.hash = '';
    history.replaceState(history.state,'',url.pathname + url.search + url.hash);
  }

  function refreshPolicy() {
    if (!client) return;
    // SDK calls stay outside onAuthStateChange's lock. Never retry network auth
    // while offline, and keep an already-known identity visible in memory.
    const method = navigator.onLine && !document.hidden ? 'startAutoRefresh' : 'stopAutoRefresh';
    Promise.resolve(client.auth[method]()).catch(() => {});
  }

  function boundedRequest(request) {
    let timer;
    return Promise.race([
      request,
      new Promise((_,reject) => {timer = setTimeout(() => reject(new Error('Auth unavailable')),10000);})
    ]).finally(() => clearTimeout(timer));
  }

  async function initialize() {
    if (!configured() || !navigator.onLine) {renderAccount(); return false;}
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        await loadLibrary();
        if (!client) {
          client = window.supabase.createClient(projectBaseURL(),SUPABASE_PUBLISHABLE_KEY,{
            auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:'pkce'},
            global:{fetch:(...args) => navigator.onLine ? window.fetch(...args) : Promise.reject(new TypeError('Offline'))}
          });
          client.auth.onAuthStateChange((event,session) => {
            if (session?.user) {user = session.user; ready = true; problem = '';}
            else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && navigator.onLine)) {user = null; ready = true;}
            renderAccount();
            setTimeout(refreshPolicy,0);
          });
        }
        // A stalled Auth request must not leave the account controls stuck forever.
        const result = await boundedRequest(client.auth.getSession());
        if (result.error) {cleanCallback(); throw result.error;}
        if (result.data.session?.user || navigator.onLine) user = result.data.session?.user || null;
        ready = true;
        problem = callbackFailed ? 'Sign-in could not complete. Please try again.' : '';
        cleanCallback(); refreshPolicy(); renderAccount(); return true;
      } catch {
        // Never show raw SDK/provider errors: they can contain callback credentials.
        problem = 'Could not connect to the cloud account. Your local diary is available.';
        renderAccount(); return false;
      } finally {initializing = null;}
    })();
    return initializing;
  }

  async function accountAction() {
    if (busy || !navigator.onLine || !configured()) return;
    busy = true; problem = ''; renderAccount();
    try {
      if (!client || !ready) {if (!await initialize()) return;}
      if (!navigator.onLine) return;
      let error;
      if (user) {
        // Local account/data isolation must be addressed before multi-user sync:
        // the IndexedDB diary is shared by the browser profile, not the account.
        ({error} = await boundedRequest(client.auth.signOut({scope:'local'})));
        if (!error) {user = null; ready = true;}
      } else {
        ({error} = await boundedRequest(client.auth.signInWithOAuth({provider:'google', options:{redirectTo}})));
      }
      if (error) throw error;
    } catch {
      problem = 'Account action could not complete. Please try again when online.';
    } finally {busy = false; renderAccount();}
  }

  // Reuse the one authenticated client. No session/token accessor or diary access.
  window.bellaAuth = Object.freeze({getClient:() => client, getUser:() => user});
  el('auth-action').addEventListener('click',accountAction);
  window.addEventListener('offline',() => {refreshPolicy(); renderAccount();});
  window.addEventListener('online',() => {refreshPolicy(); if (!client || !ready) initialize(); renderAccount();});
  document.addEventListener('visibilitychange',refreshPolicy);
  renderAccount();
  // No promise is shared with diary startup. No diary table is queried here.
  initialize();
})();
