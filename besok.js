// Mila's own visit counter (round besok-statistik, 2026-11-18): one small message to Mila's server (EU) per page view, and one per click
// on the App Store link. It sends the page's path (never its query or fragment) and, for a view, the host name of the page the visitor
// came from (never its path). Nothing is stored on the device: no cookie, no localStorage or sessionStorage, no identifier, and nothing
// else is read (no screen size, no fonts, no fingerprint). Loaded with defer at the end of the page and sent with fetch keepalive (CORS,
// without credentials), so the page never waits for it. Counts only on milacoach.app itself, never on the tower or the panel (which never load it).
(function () {
  "use strict";
  if (location.hostname !== "milacoach.app" || /^\/(torn|dash)(\/|$)/.test(location.pathname)) return;
  // a browser that asks not to be counted (Global Privacy Control, Do Not Track) sends nothing at all, so no call is even logged
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
  // pinned to the project's own region (Ireland), as the app and the support form are: never run nearer the visitor outside the EU
  var FN = "https://vfjofaniwtudzvadxpsd.supabase.co/functions/v1/besok?forceFunctionRegion=eu-west-1", path = location.pathname;
  function send(o) {
    // a CORS request (a text body: no preflight) always carries the page's real Origin, which the server checks; a no-cors one would
    // send "Origin: null" from the pages whose referrer rule is same-origin (the support pages). Not counted when it fails (offline, a
    // blocker): no retry, no error on the page.
    try { fetch(FN, { method: "POST", body: JSON.stringify(o), keepalive: true, mode: "cors", credentials: "omit" }).catch(function () { /* not counted */ }); }
    catch (e) { /* not counted */ }
  }
  function view() {
    var from = "";
    // a web page's host name only; an app that opened the page (android-app://…) is no source and counts as direct
    try { var u = document.referrer ? new URL(document.referrer) : null; from = u && /^https?:$/.test(u.protocol) ? u.hostname : ""; } catch (e) { from = ""; }
    send({ k: "v", p: path, r: from });
  }
  // a page the browser renders ahead of time (prerender) is counted only when it is shown
  if (document.prerendering) document.addEventListener("prerenderingchange", view, { once: true }); else view();
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (a && /^https:\/\/apps\.apple\.com\//.test(a.href)) send({ k: "a", p: path });
  }, true);
})();
