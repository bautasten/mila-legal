// Driftpanelens session (dash-session, 2026-10-19): the panel stays signed in on this browser for as long as it is used, at most 30 days
// after the last sign-in with a code; then a new code is asked for. The refresh token is the one thing kept on the device (localStorage,
// the one key DEVICE: {r: refresh token, since: when the code was used}); the access token lives in memory only and is renewed through
// Supabase Auth (grant_type=refresh_token, rotated: every refresh gives a new refresh token and the old one stops working) five minutes
// before it runs out, and first thing after a wake. Only Supabase's own "no" (400/401/403 on the refresh) ends the session; no network,
// 429 or 5xx is "offline" and the caller retries quietly. Tabs share the token one at a time (Web Locks where the browser has them, the
// stored token read again inside the lock), so a rotated token is never used twice. Log out revokes this session on the server and
// clears everything. The server checks the JWT and ADMIN_USER_IDS on every call whatever happens here. No DOM: dash.js draws; the logic
// is unit-tested in tests/dashboard_test.ts with a fake fetch, clock and storage.
(function (root) {
  "use strict";
  var DEVICE = "mila-dash-device";
  var MAX_AGE = 30 * 24 * 3600e3, MARGIN = 5 * 60e3, SKEW = 30e3;

  /** o: {url, anon, fetch, now, storage?: {get, set, remove} (defaults to localStorage, else memory), locks?: navigator.locks}. */
  function MilaDashSession(o) {
    var now = o.now || function () { return Date.now(); }, f = o.fetch;
    var store = o.storage || deviceStore(), access = null, pending = null;
    function read() { try { var s = JSON.parse(store.get() || "null"); return s && typeof s.r === "string" && s.r && typeof s.since === "number" ? s : null; } catch (e) { return null; } }
    function write(s) { try { store.set(JSON.stringify(s)); } catch (e) { /* memory only */ } }
    function clear() { access = null; try { store.remove(); } catch (e) { /* none */ } }
    function tooOld(s) { return !s || now() - s.since > MAX_AGE || s.since > now() + SKEW; }
    // the access token's end: the response's expires_in, never more than an hour (as before)
    function take(j) { access = { t: j.access_token, exp: now() + Math.min(Number(j.expires_in) || 3600, 3600) * 1000 }; }
    function post(path, body, t) {
      var h = { apikey: o.anon, "Content-Type": "application/json" }; if (t) h.Authorization = "Bearer " + t;
      return f(o.url + "/auth/v1/" + path, { method: "POST", headers: h, body: JSON.stringify(body || {}), credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    }
    function locked(fn) { return o.locks && o.locks.request ? o.locks.request("mila-dash-refresh", fn) : fn(); }

    /** After the code was verified: keep the refresh token on the device, the access token in memory. */
    function signedIn(j) {
      if (!j || !j.access_token || !j.refresh_token) return false;
      take(j); write({ r: j.refresh_token, since: now() }); return true;
    }
    /** The access token if it is good for more than half a minute, else null (no network). */
    function token() { return access && access.exp > now() + SKEW ? access.t : null; }
    /** Whether a refresh is due: no access token, or less than MARGIN left. */
    function due() { return !access || access.exp - now() < MARGIN; }
    /** Whether a session can be resumed on this device (a kept refresh token, younger than 30 days). */
    function resumable() { var s = read(); if (s && tooOld(s)) { clear(); return false; } return !!s || !!token(); }

    function refreshOnce() {
      return locked(function () {
        var s = read();
        if (!s) return { ok: false, why: "auth" };
        if (tooOld(s)) { clear(); return { ok: false, why: "expired" }; }
        // another tab may have refreshed while this one waited for the lock: its access token is not shared, so refresh again with the
        // newest stored refresh token (never an old one)
        return post("token?grant_type=refresh_token", { refresh_token: s.r }).then(function (r) {
          if (r.status === 400 || r.status === 401 || r.status === 403) {
            // the stored token may have been rotated by another tab during the call: then that tab's session is the good one
            var again = read(); if (again && again.r !== s.r) return { ok: false, why: "offline" };
            clear(); return { ok: false, why: "auth" };
          }
          if (!r.ok) return { ok: false, why: "offline" };
          return r.json().then(function (j) {
            if (!j || !j.access_token || !j.refresh_token) return { ok: false, why: "offline" };
            take(j); write({ r: j.refresh_token, since: s.since }); // the 30 days count from the code, not from the refresh
            return { ok: true, t: j.access_token };
          }, function () { return { ok: false, why: "offline" }; });
        }, function () { return { ok: false, why: "offline" }; });
      });
    }
    /** A good access token: {ok: true, t}, or {ok: false, why: "offline" | "auth" | "expired"}. Refreshes when due (or forced);
     *  one refresh at a time in this tab. */
    function fresh(force) {
      var s = read();
      if (s && tooOld(s)) { clear(); return Promise.resolve({ ok: false, why: "expired" }); }
      if (!force && !due() && token()) return Promise.resolve({ ok: true, t: token() });
      if (!pending) pending = Promise.resolve(refreshOnce()).then(function (x) { pending = null; return x; }, function () { pending = null; return { ok: false, why: "offline" }; });
      return pending;
    }
    /** Log out: everything here is cleared at once; then this session is revoked on the server (scope=local: only this sign-in). With
     *  no good access token in memory (asleep, expired) the kept refresh token buys one first, only to revoke it. */
    function logout() {
      var t = token(), s = read(); clear();
      var done = function () { return true; }, revoke = function (at) { return post("logout?scope=local", {}, at).then(done, done); };
      if (t) return revoke(t);
      if (!s || tooOld(s)) return Promise.resolve(true);
      return post("token?grant_type=refresh_token", { refresh_token: s.r }).then(function (r) {
        return r.ok ? r.json().then(function (j) { return j && j.access_token ? revoke(j.access_token) : true; }, done) : true;
      }, done);
    }
    return { signedIn: signedIn, token: token, due: due, resumable: resumable, fresh: fresh, logout: logout, forget: clear, DEVICE: DEVICE, MAX_AGE: MAX_AGE, MARGIN: MARGIN };
  }
  // the device's store: localStorage, the one key DEVICE only; memory when the browser refuses it
  function deviceStore() {
    var mem = null;
    return {
      get: function () { try { var v = localStorage.getItem(DEVICE); return v !== null ? v : mem; } catch (e) { return mem; } },
      set: function (v) { try { localStorage.setItem(DEVICE, v); mem = null; } catch (e) { mem = v; } },
      remove: function () { mem = null; try { localStorage.removeItem(DEVICE); } catch (e) { /* none */ } }
    };
  }
  MilaDashSession.DEVICE = DEVICE;
  root.MilaDashSession = MilaDashSession;
})(self);
