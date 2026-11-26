// Mila Kontrolltorn (milacoach.app/torn/): the owner's one page for running Mila. Signs in exactly as the driftpanel does
// (../dash/session.js: Supabase Auth's e-mail OTP, no account created here, the same 30-day session on this device), then asks the
// function `tower` for everything it shows.
//
// The overhaul (round torn-oversyn, 2026-11-18) is built from what the owner does here, not from the modules:
//   1. decide what waits for him (I dag: the whole queue, each row with its own buttons, one tap or one key),
//   2. read and answer mail (Mejl: what is left to do first, a reading pane beside the list on a wide screen, the next mail after "Klar"),
//   3. see that nothing is broken (the navigation itself carries each part's state; Läget lists them on a phone),
//   4. keep the dates (Kalender), and now and then change a setting or read the log (Inställningar).
// Every part that was here before is still here (the nine modules keep their names and their keys 1–9).
// Everything is drawn with the DOM's own text nodes: never markup from strings, no script from anywhere else. Calm: no scores, no red,
// no blinking numbers; a small orange dot marks what waits for the owner. A number that is old says so in words.
(function () {
  "use strict";
  var SUPABASE = "https://vfjofaniwtudzvadxpsd.supabase.co";
  // the project's public (anon) key, as the app ships it; written in by publish_torn.sh from Secrets.plist (never in git)
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmam9mYW5pd3R1ZHp2YWR4cHNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MDk2NzIsImV4cCI6MjEwNzI4NTY3Mn0.uENQuzKYjhjoy5XUydXC5mz_HmpIIxGCw4exqJxGBnc";
  var FN = SUPABASE + "/functions/v1/tower";
  var LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var DEMO = LOCAL && /^#demo\b/.test(location.hash);
  // the nine modules, in the order of their keys 1–9 (unchanged), then the two views the overhaul added
  var MODULES = [["idag", "I dag"], ["mejl", "Mejl"], ["appen", "Appen"], ["pengar", "Pengar"], ["drift", "Drift"], ["anvandare", "Användare"], ["juridik", "Juridik"], ["marknad", "Marknad"], ["kalender", "Kalender"]];
  var VIEWS = MODULES.concat([["laget", "Läget"], ["mer", "Inställningar"]]);
  var NAME = {}; VIEWS.forEach(function (m) { NAME[m[0]] = m[1]; });
  var nf = new Intl.NumberFormat("sv-SE"), nf2 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var $ = function (id) { return document.getElementById(id); };
  var data = null, mail = "", timer = null, retryT = null, lastLoad = 0, module = "idag", mailId = null;
  var needOpen = false, asleepOpen = false, changesOpen = false, mailBox = "alla", mailCat = "alla", mailState = "gora";
  var mails = {}, drafts = {}, pendingRender = false, forceNext = false, pick = -1;
  // I dag answers a mail in its own row: which rows are open, and which replies already went to Mail (then: Klar or Väntar)
  var replyOpen = {}, handedToMail = {}, focusReply = null, keptInline = {};

  // ---- helpers (text only through textContent)
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function num(x) { var v = Number(x); return isFinite(v) ? v : 0; }
  function has(x) { return x !== null && x !== undefined && x !== "" && isFinite(Number(x)); }
  function f0(x) { return has(x) ? nf.format(Math.round(num(x))) : "–"; }
  function usd(x) { return has(x) ? "$" + nf2.format(num(x)) : "–"; }
  function kr(x) { return has(x) ? nf.format(Math.round(num(x))) + " kr" : "–"; }
  function sum(o) { var s = 0; for (var k in (o || {})) s += num(o[k]); return s; }
  /** The moment the page's ages are counted from: now, or the demo data's own moment (so the demo never looks two weeks old). */
  function nowMs() { return DEMO && data && data.demo_now ? Date.parse(data.demo_now) : Date.now(); }
  function span(ms) {
    var m = Math.round(ms / 60000);
    if (!isFinite(m)) return "";
    if (m < 2) return "nyss"; if (m < 60) return m + " min sedan";
    var h = Math.round(m / 60); if (h < 36) return h + " h sedan";
    return Math.round(h / 24) + " dagar sedan";
  }
  function ago(iso) { if (!iso) return "aldrig hämtat"; var s = span(nowMs() - Date.parse(iso)); return "hämtat " + (s === "nyss" ? s : "för " + s); }
  function dayText(d) { try { return new Date(d + "T12:00:00Z").toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" }); } catch (e) { return d; } }
  function longDay(d) { try { return new Date(d + "T12:00:00Z").toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" }); } catch (e) { return d || ""; } }
  function when(iso) { try { return new Date(iso).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; } }
  function clock(iso) { try { return new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function plusDays(d, n) { return new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10); }
  function stockholmDay(iso) { try { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); } catch (e) { return ""; } }
  /** A mail's time as a person says it: the clock today, else the day. */
  function shortWhen(iso) {
    var d = stockholmDay(iso);
    if (data && d === data.today) return clock(iso);
    if (data && d === plusDays(data.today, -1)) return "i går";
    try { return new Date(iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" }); } catch (e) { return iso; }
  }
  function card(parent, title, lead, cls) {
    var c = el("section", "card" + (cls ? " " + cls : "")); if (title) c.appendChild(el("h2", null, title)); if (lead) c.appendChild(el("p", "lead", lead)); parent.appendChild(c); return c;
  }
  function button(parent, text, cls, fn) { var b = el("button", cls || null, text); b.type = "button"; b.addEventListener("click", fn); parent.appendChild(b); return b; }
  function dot(label) { var d = el("span", "dot"); if (label) { d.setAttribute("role", "img"); d.setAttribute("aria-label", label); } else d.setAttribute("aria-hidden", "true"); return d; }
  /** Three equal tiles per row (never a stretched single one: a missing third is left empty space). */
  function tiles(parent, items) {
    var t = el("div", "tiles");
    items.forEach(function (i) { var x = el("div", "tile"); x.appendChild(el("div", "v", i.v)); x.appendChild(el("div", "l", i.l)); if (i.d) x.appendChild(el("div", "d", i.d)); t.appendChild(x); });
    parent.appendChild(t); return t;
  }
  /** Label and value pairs; the value moves under its label when the two do not fit on one line (a label is never squeezed). */
  function kv(parent, pairs) {
    var d = el("dl", "kv");
    pairs.forEach(function (p) { var r = el("div", "kv-row"); r.appendChild(el("dt", null, p[0])); r.appendChild(el("dd", null, p[1])); d.appendChild(r); });
    parent.appendChild(d); return d;
  }
  function bars(parent, xs, values, label) {
    var max = Math.max.apply(null, values.map(num).concat([0])) || 1;
    var b = el("div", "bars"); b.style.setProperty("--n", String(Math.max(xs.length, 1))); b.setAttribute("role", "img"); b.setAttribute("aria-label", label);
    values.forEach(function (v, i) { var bar = el("i"); bar.style.height = Math.max(1, Math.round(num(v) / max * 100)) + "%"; bar.title = xs[i] + ": " + v; b.appendChild(bar); });
    parent.appendChild(b);
    var x = el("div", "bars-x"); x.appendChild(el("span", null, xs[0] ? dayText(xs[0]) : "")); x.appendChild(el("span", null, xs.length ? dayText(xs[xs.length - 1]) : "")); parent.appendChild(x);
  }
  function link(parent, text, href) { var a = el("a", null, text); a.href = href; a.rel = "noopener"; a.target = "_blank"; parent.appendChild(a); return a; }
  /** A plain list row: a title, lines under it, and (optionally) a dot in front and a small label over it. */
  function row(ul, title, lines, marked, label) {
    var li = el("li", "row"), mark = el("span", "mark"); if (marked) mark.appendChild(dot("väntar på dig")); li.appendChild(mark);
    var d = el("div", "row-body"); if (label) d.appendChild(el("div", "label", label)); d.appendChild(el("div", "t", title));
    (lines || []).forEach(function (x) { if (x) d.appendChild(el("div", "d", x)); });
    li.appendChild(d); ul.appendChild(li); return li;
  }

  // ---- how old a number is. The collector on the Mac runs every 30 minutes and the mail is read every tenth: something older than
  // three rounds is said to be old, in words, wherever it is shown; a failed fetch newer than the last good one is said too.
  var OLD_MIN = 95;
  /** null while fresh; else how old, as words. */
  function oldness(iso, limit) {
    if (!iso) return null;
    var ms = nowMs() - Date.parse(iso);
    return isFinite(ms) && ms > (limit || OLD_MIN) * 60000 ? span(ms).replace(" sedan", "") : null;
  }
  function failed(err, goodAt) { return !!(err && err.at && (!goodAt || Date.parse(err.at) > Date.parse(goodAt))); }
  /** Under a card: when it was fetched; marked and in plain words when it is old or the last fetch failed. */
  function age(c, iso, errKey, limit) {
    var old = oldness(iso, limit), err = errKey && data.errors ? data.errors[errKey] : null, bad = failed(err, iso), a = ago(iso);
    var p = el("p", "age" + (old || bad ? " old" : ""));
    if (old || bad) p.appendChild(dot());
    p.appendChild(document.createTextNode(!iso ? "Aldrig hämtat." : old ? "Gammal siffra: " + a + "." : a.charAt(0).toUpperCase() + a.slice(1) + "."));
    if (bad) p.appendChild(document.createTextNode(" Senaste hämtningen misslyckades " + when(err.at) + "."));
    c.appendChild(p); return p;
  }
  /** Every source the page shows, with when it last came in and whether its last fetch failed. */
  function sources() {
    var e = data.errors || {}, m = data.mail || {}, o = data.ops || {};
    var list = [
      { key: "mejl", name: "Mejlen (iCloud, var tionde minut)", at: m.sync && m.sync.at, err: m.sync_error ? { at: m.sync_error.at, error: m.sync_error.data && m.sync_error.data.error } : null, limit: 45, off: !m.configured },
      { key: "asc", name: "App Store Connect", at: data.app && data.app.asc && data.app.asc.at, err: e.asc },
      { key: "agents", name: "Agenter och byggen", at: o.agents && o.agents.at, err: e.agents },
      { key: "site", name: "Webbplatsens svar", at: o.site && o.site.at, err: e.site },
      { key: "arbete", name: "Rundor och grenar", at: o.work && o.work.at, err: e.arbete },
      { key: "kalender", name: "Kalendern ”mila coach”", at: data.calendar && data.calendar.at, err: e.kalender },
      { key: "expiry", name: "Certifikat och profiler", at: null, err: e.expiry, noAge: true },
      { key: "sales", name: "Apples försäljningsrapporter", at: data.money && data.money.sales && data.money.sales.at, err: e.sales, limit: 36 * 60, optional: true },
    ];
    Object.keys(e).forEach(function (k) { if (k !== "mail_sync" && !list.some(function (s) { return s.key === k; })) list.push({ key: k, name: k, at: null, err: e[k], noAge: true }); });
    list.forEach(function (s) {
      s.old = s.noAge || s.off ? null : oldness(s.at, s.limit);
      // a source without its own clock: its last failure counts for a day and a half, then it is history
      s.bad = failed(s.err, s.at) && !(s.noAge && nowMs() - Date.parse(s.err.at) > 36 * 3600e3);
      s.never = !s.at && !s.noAge && !s.off && !s.optional;
      s.trouble = !!(s.old || s.bad || s.never);
    });
    return list;
  }

  // ---- words for the server's codes
  var KIND = { beslut: "Beslut", lopp: "Loppregistret", mejl: "Mejl", gdpr: "GDPR", support: "Support", kostnad: "Kostnad", frist: "Datum", app: "Appen", moderering: "Granskning", agent: "Agenter" };
  var CAT = { support: "Support", bugg: "Bugg", betalning: "Betalning", gdpr: "GDPR-begäran", partner: "Partner", press: "Press", leverantor: "Apple och leverantörer", juridik: "Juridik", skrap: "Skräp", ovrigt: "Övrigt" };
  var BOX = { alla: "Alla", egen: "Din adress", info: "info@", support: "support@", annan: "Annan" };
  var STATE = { ny: "Ny", last: "Läst", vantar: "Väntar på svar", klar: "Klar" };
  var ASC = { READY_FOR_SALE: "Ute i App Store", WAITING_FOR_REVIEW: "Väntar på granskning", IN_REVIEW: "Granskas nu", PENDING_DEVELOPER_RELEASE: "Godkänd, väntar på dig",
    REJECTED: "Avslag", METADATA_REJECTED: "Avslag på texterna", DEVELOPER_REJECTED: "Tillbakadragen", PREPARE_FOR_SUBMISSION: "Förbereds", READY_FOR_REVIEW: "Redo att skickas in",
    PROCESSING_FOR_APP_STORE: "Bearbetas", PENDING_APPLE_RELEASE: "Släpps av Apple", DEVELOPER_ACTION_NEEDED: "Apple väntar på dig", INVALID_BINARY: "Ogiltigt bygge",
    VALID: "Klart", PROCESSING: "Bearbetas", FAILED: "Misslyckades", INVALID: "Ogiltigt" };
  var PHASED = { ACTIVE: "pågår", PAUSED: "pausad", COMPLETE: "klar", INACTIVE: "inte startad" };
  // the gate's own word stays beside the Swedish one (a status the page does not know is shown as it is)
  var GATE = { running: "kör", passed: "grön", success: "grön", ok: "grön", failed: "föll", error: "föll", cancelled: "avbruten", canceled: "avbruten", queued: "i kö" };
  function gateWord(s) { var k = String(s || "").toLowerCase(); return GATE[k] ? GATE[k] + " (" + s + ")" : (s || "?"); }
  var ACTION = { mail_state: "Mejl markerat", mail_category: "Mejl flyttat", mail_draft: "Utkast sparat", mail_open_in_mail: "Svar öppnat i Mail", deadline_add: "Datum inlagt", deadline_done: "Datum markerat klart",
    snooze: "Uppskjutet", unsnooze: "Taget tillbaka", notify_set: "Notis ändrad", cost_set: "Fast kostnad sparad", decision_answer: "Beslut besvarat", race_approve: "Lopp godkänt", race_reject: "Lopp avvisat",
    pending_approve: "Förslag godkänt", pending_reject: "Förslag avvisat", kalender_ny: "Tornet lade in i kalendern", kalender_andrad: "Tornet ändrade i kalendern", kalender_borttagen: "Tornet tog bort ur kalendern",
    paminnelse_ny: "Tornet lade in en påminnelse", paminnelse_andrad: "Tornet ändrade en påminnelse", paminnelse_borttagen: "Tornet tog bort en påminnelse", anteckning_andrad: "Tornet ändrade anteckningen", anteckning_ny: "Tornet skrev anteckningen" };

  // ---- where the owner is: #/mejl/12 (the demo keeps its own prefix), so the phone's back swipe works
  function route() {
    var h = location.hash.replace(/^#demo\b/, "").replace(/^#/, "").replace(/^\//, ""), p = h.split("/");
    return { module: NAME[p[0]] ? p[0] : null, id: p[1] && /^\d{1,18}$/.test(p[1]) ? p[1] : null };
  }
  function hashFor(m, id) { return (DEMO ? "#demo/" : "#/") + m + (id ? "/" + id : ""); }
  function go(m, id) {
    var same = module === m && mailId === (id || null);
    module = m; mailId = m === "mejl" ? (id || null) : null; pick = -1;
    try { sessionStorage.setItem("mila-torn-module", module); } catch (e) { /* none */ }
    if (location.hash !== hashFor(module, mailId)) { try { history.pushState(null, "", hashFor(module, mailId)); } catch (e) { location.hash = hashFor(module, mailId); } }
    render(true);
    if (!same) { scrollTo(0, 0); $("board").focus({ preventScroll: true }); }
  }
  // back to an entry without a view of its own is I dag; a hash that is no view at all (the skip link's) changes nothing
  addEventListener("popstate", function () { if (location.hash && !/^#(demo\b|\/)/.test(location.hash)) return; var r = route(); module = r.module || "idag"; mailId = module === "mejl" ? r.id : null; pick = -1; render(true); });
  (function () {
    var r = route();
    if (r.module) { module = r.module; mailId = r.module === "mejl" ? r.id : null; }
    else { try { var saved = sessionStorage.getItem("mila-torn-module"); if (saved && NAME[saved]) module = saved; } catch (e) { /* none */ } }
    // the first entry names its view too, so going back to it shows that view again
    try { history.replaceState(null, "", hashFor(module, mailId)); } catch (e) { /* none */ }
  })();

  // ---- the state of every part: one value, one sentence, and a dot only when something there waits for the owner. The navigation
  // carries these, so the state is in view on every page; Läget lists them whole on a phone.
  var CONSENT_NEXT = "v7 på väg i bygge 32";
  function usdSek() { return num((data.money && data.money.usd_sek) || 10); }
  function moneyEst() { var d = data.money && data.money.dash; return d && d.envs && d.envs.as ? d.envs.as.est : null; }
  function aiDaily() { return (data.money && data.money.dash && data.money.dash.common && data.money.dash.common.ai && data.money.dash.common.ai.daily) || []; }
  /** The AI cost of today (the day's row only when it is today's; a row from yesterday is not today's cost). */
  function aiToday() { var daily = aiDaily(), last = daily[daily.length - 1]; return last && last.d === data.today ? last : null; }
  /** A change against the week before as plain words with a small arrow, or nothing when there is nothing to compare. */
  function trend(p, what) {
    if (!p || !has(p.now) || !has(p.before) || (num(p.now) === 0 && num(p.before) === 0)) return "";
    var d = num(p.now) - num(p.before), word = what ? " " + what : "";
    if (Math.abs(d) < 0.005) return " · som förra veckan";
    return " · " + (d > 0 ? "↑ " : "↓ ") + (p.money ? kr(Math.abs(d)) : f0(Math.abs(d)) + word) + " mot förra veckan";
  }
  /** Yesterday's visits from the site's own counter (Marknad); null while it is not running or did not count all of yesterday. */
  function visitsYesterday() {
    var v = data.market && data.market.visits, yd = plusDays(data.today, -1);
    if (!v || !v.first_day || v.first_day >= yd) return null;
    var r = (v.days || []).filter(function (x) { return x.d === yd; })[0];
    return r ? num(r.e) : null;
  }
  function aiWeek() {
    var daily = aiDaily();
    // seven whole days ending yesterday against the seven before (today is still running)
    var s = function (from, to) { return daily.filter(function (x) { return x.d >= plusDays(data.today, -from) && x.d <= plusDays(data.today, -to); }).reduce(function (a, x) { return a + num(x.usd); }, 0) * usdSek(); };
    return daily.length >= 15 ? { now: s(7, 1), before: s(14, 8), money: true } : null;
  }
  function newWeek() {
    var envs = (data.money && data.money.dash && data.money.dash.envs) || {}, n = 0, b = 0, ok = false;
    // b41-kod-dash: Kod (offer codes, from 5 accounts its own tab) counts with them; a small Kod is still inside App Store
    ["as", "kod", "tf"].forEach(function (e) { ((envs[e] && envs[e].growth && envs[e].growth.daily) || []).forEach(function (x) { ok = true; var v = sum(x.new); if (x.d >= plusDays(data.today, -7) && x.d <= plusDays(data.today, -1)) n += v; else if (x.d >= plusDays(data.today, -14) && x.d <= plusDays(data.today, -8)) b += v; }); });
    return ok ? { now: n, before: b } : null;
  }
  function todoMail(m) { return m.category !== "skrap" && (m.state === "ny" || m.state === "last"); }
  function openMailCount() { return ((data.mail && data.mail.items) || []).filter(function (m) { return m.state === "ny" && m.category !== "skrap"; }).length; }
  function gateRuns() { var gate = data.ops && data.ops.gate; return Array.isArray(gate) ? gate : (gate && Array.isArray(gate.runs) ? gate.runs : []); }
  var PARTS = ["appen", "pengar", "drift", "anvandare", "marknad", "juridik"];
  function pulse() {
    var m = (data.mail && data.mail.items) || [], open = openMailCount(), configured = !!(data.mail && data.mail.configured);
    var gdpr = m.filter(function (x) { return x.category === "gdpr" && x.state !== "klar"; }).length;
    var a = data.app && data.app.asc && data.app.asc.data, est = moneyEst() || {};
    var ai = aiToday();
    var site = data.ops && data.ops.site && data.ops.site.data, down = site ? (site.checks || []).filter(function (c) { return !c.ok; }).length : 0;
    var ag = data.ops && data.ops.agents && data.ops.agents.data;
    var envs = (data.money && data.money.dash && data.money.dash.envs) || {}, act7 = sum(((envs.as || {}).growth || {}).active_7d) + sum(((envs.kod || {}).growth || {}).active_7d) + sum(((envs.tf || {}).growth || {}).active_7d);
    var cv = (data.legal && data.legal.consent_versions) || {};
    var races = num(data.ops && data.ops.races_pending);
    // the next expiry (certificates, profiles, the domain, keys): what "Behöver dig" and the timeline do not already say
    var next = (data.deadlines || []).filter(function (d) { return /^(apple|doman|nyckel)$/.test(d.kind) && (d.due >= data.today || d.level === "passerad"); })[0];
    var sync = !!(data.mail && failed(data.mail.sync_error, data.mail.sync && data.mail.sync.at));
    var src = sources(), old = function (keys) { return src.some(function (s) { return keys.indexOf(s.key) >= 0 && s.trouble; }); };
    var trouble = src.filter(function (s) { return s.trouble; }).length;
    return [
      { module: "mejl", name: "Mejl", value: configured ? f0(open) : "–", line: !configured ? "inte kopplat än" : sync ? "inkorgen gick inte att läsa senast" : open ? "att läsa" + (gdpr ? " · " + gdpr + " GDPR" : "") : "inget nytt", dot: !!gdpr || sync, old: old(["mejl"]) },
      { module: "appen", name: "Appen", value: a ? "v" + (a.version || "?") : "–", line: a ? (ASC[a.state] || a.state || "").toLowerCase() : "inte hämtat", dot: !!(data.app && data.app.attention), old: old(["asc"]) },
      { module: "pengar", name: "Pengar", value: f0(est.payers || 0), line: "betalande · coachens AI i dag " + (ai ? kr(num(ai.usd) * usdSek()) : "inget än") + trend(aiWeek()), dot: !!((data.ops && data.ops.alerts_2d) || []).length, old: false },
      { module: "drift", name: "Drift", value: down ? down + " nere" : trouble ? (trouble === 1 ? "1 källa gammal" : trouble + " källor gamla") : "allt svarar", line: ag ? (ag.focus ? "slutprov pågår" : "inget slutprov") + (ag.blocked ? " · en agent väntar" : "") : "agenter inte hämtade", dot: down > 0 || !!(ag && ag.blocked), old: trouble > 0 },
      { module: "anvandare", name: "Användare", value: f0(act7), line: "aktiva senaste veckan" + trend(newWeek(), "nya konton"), dot: false, old: false },
      { module: "juridik", name: "Juridik", value: gdpr ? gdpr + " GDPR" : "samtycke v" + (cv.ai || "–"), line: (gdpr ? "begäran öppna · " : "") + (num(cv.ai) < 7 ? CONSENT_NEXT : "samtycke v" + cv.ai), dot: gdpr > 0, old: false },
      { module: "marknad", name: "Marknad", value: races ? f0(races) : "0", line: races ? "godkännanden väntar" : "inget att godkänna" + (site && has(site.race_pages) ? " · " + f0(site.race_pages) + " loppsidor" : "") + (visitsYesterday() !== null ? " · " + f0(visitsYesterday()) + " besök i går" : ""), dot: races > 0, old: false },
      { module: "kalender", name: "Nästa utgång", value: next ? (next.due < data.today ? "passerat" : next.due === data.today ? "i dag" : dayText(next.due)) : "–", line: next ? next.title : "inget som går ut", dot: !!(next && (next.level === "1" || next.level === "passerad")), old: old(["kalender"]), oldText: "kalendern är inte läst på ett tag" },
    ];
  }

  // ---- the navigation: a list down the side on a wide screen (every part with its value), a bar under the thumb on a phone
  var BAR = ["idag", "mejl", "laget", "kalender", "mer"], BARNAME = { mer: "Mer" };
  function navButton(parent, id, text, value, dotted, old) {
    var b = el("button", "nav-item"); b.type = "button";
    var on = id === module || (parent.id === "bar" && id === "laget" && PARTS.indexOf(module) >= 0);
    if (on) b.setAttribute("aria-current", "page");
    b.appendChild(el("span", "nav-name", text));
    if (dotted) b.appendChild(dot("väntar på dig"));
    if (value) b.appendChild(el("span", "nav-value" + (old ? " old" : ""), value));
    b.addEventListener("click", function () { go(id); });
    parent.appendChild(b); return b;
  }
  function drawNav() {
    var p = pulse(), by = {}, rows = (data.idag && data.idag.rows) || [], urgent = rows.some(function (r) { return r.urgent; });
    p.forEach(function (x) { by[x.module] = x; });
    var side = clear($("side")), bar = clear($("bar"));
    var group = function (title) { var g = el("div", "nav-group"); if (title) g.appendChild(el("p", "nav-title", title)); side.appendChild(g); return g; };
    var g1 = group(null);
    navButton(g1, "idag", "I dag", rows.length ? f0(rows.length) : "", urgent);
    navButton(g1, "mejl", "Mejl", by.mejl.value !== "0" ? by.mejl.value : "", by.mejl.dot, by.mejl.old);
    navButton(g1, "kalender", "Kalender", by.kalender.value !== "–" ? by.kalender.value : "", by.kalender.dot, by.kalender.old);
    var g2 = group("Läget");
    PARTS.forEach(function (k) { navButton(g2, k, NAME[k], by[k].value, by[k].dot, by[k].old); });
    var g3 = group(null);
    navButton(g3, "laget", "Hela läget", "", false);
    navButton(g3, "mer", "Inställningar", "", false);
    var anyDot = PARTS.some(function (k) { return by[k].dot; });
    BAR.forEach(function (k) {
      navButton(bar, k, BARNAME[k] || NAME[k], k === "idag" && rows.length ? f0(rows.length) : k === "mejl" && openMailCount() ? f0(openMailCount()) : "",
        k === "idag" ? urgent : k === "mejl" ? by.mejl.dot : k === "laget" ? anyDot : k === "kalender" ? by.kalender.dot : false);
    });
  }

  function render(force) {
    if (!data) return;
    if (forceNext) { force = true; forceNext = false; }
    document.title = (module === "idag" ? "" : NAME[module] + " · ") + "Mila kontrolltorn";
    $("view-title").textContent = module === "idag" ? "Kontrolltornet" : NAME[module];
    $("day").textContent = longDay(data.today);
    var src = sources().filter(function (s) { return s.trouble; }), fr = clear($("fresh"));
    if (src.length) { fr.appendChild(dot()); fr.appendChild(document.createTextNode(src.length === 1 ? "1 källa är gammal" : src.length + " källor är gamla")); fr.className = "fresh old"; }
    else { fr.appendChild(document.createTextNode("Läget " + clock(data.at))); fr.className = "fresh"; }
    $("asof").textContent = "Läget " + when(data.at) + ". Inget skickas, publiceras eller godkänns utan ditt klick.";
    drawNav();
    document.body.className = "view-" + module + (mailId ? " mail-open" : "");
    // never pull a field away from under the owner's fingers: the frame above is current, the content waits until he leaves the field
    var act0 = document.activeElement, inBoard = act0 && $("board").contains(act0);
    if (!force && inBoard && /^(INPUT|TEXTAREA|SELECT)$/.test(act0.tagName)) { pendingRender = true; return; }
    pendingRender = false;
    // the row chosen with j/k stays chosen when the content is drawn again
    var held = inBoard && act0.closest ? act0.closest("[data-pick]") : null, heldAt = held ? picks().indexOf(held) : -1, heldKey = held && held.rowData ? held.rowData.key : null;
    keptInline = {};
    var keptTop = [];
    if (!force && module === "idag") Array.prototype.forEach.call($("board").querySelectorAll(".inline-mail[data-reply]"), function (n) { keptInline[n.getAttribute("data-reply")] = n; var t0 = n.querySelector(".mailtext"); if (t0) keptTop.push([t0, t0.scrollTop]); });
    var b = clear($("board"));
    var restoreTop = function () { keptTop.forEach(function (k) { if (k[0].isConnected) k[0].scrollTop = k[1]; }); };
    ({ idag: drawToday, mejl: drawMail, appen: drawApp, pengar: drawMoney, drift: drawOps, anvandare: drawUsers, juridik: drawLegal, marknad: drawMarket, kalender: drawCalendar, laget: drawState, mer: drawMore }[module] || drawToday)(b);
    restoreTop();
    if (heldAt >= 0) {
      // by its key where the row has one (the same mail or queue row, wherever it now is), else by its place
      var now = picks(), same = heldKey ? now.filter(function (x) { return x.rowData && x.rowData.key === heldKey; })[0] : now[heldAt];
      if (same) same.focus({ preventScroll: true });
    }
  }
  // a refresh that waited for a field is drawn a moment after the owner has left it (long enough for the click that took him out to land)
  var pendingT = null;
  $("board").addEventListener("focusout", function () { if (!pendingRender) return; clearTimeout(pendingT); pendingT = setTimeout(function () { if (pendingRender) render(); }, 700); });
  $("fresh").addEventListener("click", function () { go("drift"); });
  // the skip link moves the focus without leaving an entry of its own in the history
  $("skip").addEventListener("click", function (ev) { ev.preventDefault(); $("board").focus(); });

  // ---- I dag. In reading order: what waits for the owner (every row with its own buttons), what deviates, what is ahead, what is going
  // on, and what happened since yesterday. The greeting is one line; the picture is small and never pushes the queue off the screen.
  function greeting() {
    var h = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "numeric" }).format(new Date(nowMs())));
    return h < 5 ? "God natt" : h < 10 ? "God morgon" : h < 17 ? "God dag" : "God kväll";
  }
  function dayLine() {
    var r = data.rhythm || {}, wd = r.weekday ? r.weekday[0].toUpperCase() + r.weekday.slice(1) : "";
    var tag = r.friday ? "aldrig inskick eller släpp" : r.weekday === "torsdag" ? "inskicksdag" : r.weekday === "tisdag" ? "släppdag" : "";
    return wd + " " + (data.today ? new Date(data.today + "T12:00:00Z").toLocaleDateString("sv-SE", { day: "numeric", month: "long" }) : "") + (tag ? " · " + tag : "");
  }
  function snooze(r, days) {
    var until = plusDays(data.today, days);
    act("snooze", r.key, { until: until }, "Uppskjutet till " + dayText(until) + ".", function () { act("unsnooze", r.key, {}, "Tillbaka i listan."); });
  }
  function mailItem(id) { return ((data.mail && data.mail.items) || []).filter(function (m) { return String(m.id) === String(id); })[0] || null; }
  function toggleReply(id) { if (replyOpen[id]) delete replyOpen[id]; else { replyOpen[id] = true; focusReply = id; } forceNext = true; render(true); }
  /** One row of the queue, whole: what it is, what it says, and everything the owner can do with it. */
  function needRow(r, hidden) {
    var li = el("li", "need-row" + (r.urgent ? " urgent" : "") + (hidden ? " later" : "")); li.tabIndex = -1; li.setAttribute("data-pick", "");
    var head = el("div", "label"); if (r.urgent) { head.appendChild(dot()); head.appendChild(el("strong", null, "Brådskande")); head.appendChild(document.createTextNode(" · ")); }
    head.appendChild(document.createTextNode(KIND[r.kind] || r.kind)); li.appendChild(head);
    li.appendChild(el("div", "t", r.title));
    if (r.detail) li.appendChild(el("div", "d", r.detail));
    if (r.link && /^https:\/\//.test(r.link)) { var lk = el("a", "under", "Öppna underlaget"); lk.href = r.link; lk.rel = "noopener noreferrer"; lk.target = "_blank"; li.appendChild(lk); }
    var foot = el("div", "need-foot"), acts = el("div", "acts"), own = r.kind === "frist" && r.open && /^\d{1,18}$/.test(String(r.open.id || ""));
    if (own) button(acts, "Klar", "", function () { ask({ title: "Markera klart?", text: r.title + " tas bort från datumen.", yes: "Klar" }).then(function (ok) { if (ok) act("deadline_done", String(r.open.id), {}, "Markerat klart."); }); });
    if (r.approve && r.approve.action === "decision") { button(acts, "Ja", "", function () { answer(r, "ja"); }); button(acts, "Nej", "soft", function () { answer(r, "nej"); }); }
    else if (r.approve) { button(acts, "Godkänn", "", function () { approve(r, true); }); button(acts, "Avvisa", "soft", function () { approve(r, false); }); }
    var mailRow = r.open && r.open.module === "mejl" && /^\d{1,18}$/.test(String(r.open.id || "")) ? mailItem(r.open.id) : null;
    if (mailRow) {
      // a mail is read and answered where it stands: the text and the reply open under the row, and the queue stays in view
      var id = String(mailRow.id), rb = button(acts, replyOpen[id] ? "Stäng" : "Läs och svara", replyOpen[id] ? "soft" : "", function () { toggleReply(id); });
      rb.setAttribute("aria-expanded", String(!!replyOpen[id]));
      if (r.kind === "mejl") button(acts, "Klar", "soft", function () { setMailState(mailRow, "klar", "Markerat klart.", false, true); });
      button(acts, "Hela mejlet", "quiet", function () { go("mejl", id); });
    } else if (r.open && NAME[r.open.module]) button(acts, r.open.module === "mejl" && r.open.id ? "Öppna mejlet" : "Öppna " + NAME[r.open.module], r.approve || own ? "quiet" : "", function () { go(r.open.module, r.open.module === "mejl" ? r.open.id : null); });
    foot.appendChild(acts); li.appendChild(foot);
    if (mailRow && replyOpen[String(mailRow.id)]) {
      // a plain refresh keeps the open mail as it is (where it is read, what is typed, a draft on its way); an action draws it anew
      var kept = keptInline[String(mailRow.id)];
      if (kept) li.appendChild(kept);
      else { var inl = el("div", "inline-mail"); li.appendChild(inl); showMail(inl, String(mailRow.id), true); }
    }
    if (r.kind !== "beslut") {
      var later = el("div", "later-acts"); later.appendChild(el("span", "sub", "Skjut upp:"));
      button(later, "Till i morgon", "quiet", function () { snooze(r, 1); });
      button(later, "En vecka", "quiet", function () { snooze(r, 7); });
      foot.appendChild(later);
    }
    li.rowData = r; return li;
  }
  function drawToday(b) {
    var t = data.idag || { rows: [], snoozed: 0, changed: [] }, rows = t.rows || [];
    // a mail that has left the queue (done, put off) comes back closed
    var inQueue = {}; rows.forEach(function (r) { if (r.open && r.open.module === "mejl" && r.open.id) inQueue[String(r.open.id)] = true; });
    Object.keys(replyOpen).forEach(function (k) { if (!inQueue[k]) delete replyOpen[k]; });
    var hero = el("section", "hero"); b.appendChild(hero);
    hero.appendChild(el("p", "eyebrow hero-day", dayLine()));
    var urgent = rows.filter(function (r) { return r.urgent; }).length;
    hero.appendChild(el("h2", "hello", greeting() + ". " + (!rows.length ? "Inget väntar på dig."
      : rows.length === 1 ? (urgent ? "En sak behöver dig, och den är brådskande." : "En sak behöver dig.")
      : rows.length + " saker behöver dig" + (urgent === 1 ? ", en är brådskande." : urgent > 1 ? ", " + urgent + " är brådskande." : "."))));
    if (data.rhythm && data.rhythm.line) hero.appendChild(el("p", "hero-rhythm", data.rhythm.line));
    var g = el("div", "home"); b.appendChild(g);
    var main = el("div", "home-main"), aside = el("div", "home-side"); g.appendChild(main); g.appendChild(aside);

    // what needs the owner: the first five whole, the rest behind one quiet line
    var need = el("section", "card need" + (needOpen ? " open" : "")); main.appendChild(need);
    need.appendChild(el("h2", null, "Behöver dig"));
    if (!rows.length) need.appendChild(el("p", "empty", "Inget just nu. Allt rullar."));
    var ul = el("ul", "need-list"), SHOW = 5;
    rows.forEach(function (r, i) { ul.appendChild(needRow(r, i >= SHOW)); });
    if (rows.length) need.appendChild(ul);
    if (rows.length > SHOW && !needOpen) {
      var more = button(need, "Visa " + (rows.length - SHOW) + " till", "soft wide", function () {
        needOpen = true; need.classList.add("open"); more.remove();
        var first = need.querySelector(".need-row.later"); if (first) first.focus();
      });
    }
    // what was put off is never out of reach: listed on request, each with its way back
    var asleep = t.asleep || [];
    if (t.snoozed) {
      if (!asleep.length) need.appendChild(el("p", "sub", t.snoozed === 1 ? "En sak är uppskjuten." : t.snoozed + " saker är uppskjutna."));
      else {
        var det = el("details", "fold"); det.open = asleepOpen; det.addEventListener("toggle", function () { asleepOpen = det.open; });
        det.appendChild(el("summary", null, t.snoozed === 1 ? "En sak är uppskjuten" : t.snoozed + " saker är uppskjutna"));
        var sl = el("ul", "rows compact");
        asleep.forEach(function (x) {
          var li = row(sl, x.title, [(KIND[x.kind] || x.kind) + " · tillbaka " + dayText(x.until)]);
          var a = el("div", "acts"); button(a, "Ta tillbaka nu", "quiet", function () { act("unsnooze", x.key, {}, "Tillbaka i listan."); }); li.appendChild(a);
        });
        det.appendChild(sl);
        if (t.snoozed > asleep.length) det.appendChild(el("p", "sub", (t.snoozed - asleep.length) + " till är uppskjutna och kommer tillbaka av sig själva."));
        need.appendChild(det);
      }
    }
    if (rows.length < 3) shortQueue(need);
    need.appendChild(el("p", "keys", "Tangenter: j och k väljer rad · r läser och svarar · x klar · g godkänner (eller ja) · s skjuter upp en vecka · ö öppnar · ? visar alla"));

    // what deviates right now, in one look: a part with a dot, or a source that is old. The calm parts are one line.
    var p = pulse(), loud = p.filter(function (x) { return x.dot || x.old; }), calm = p.filter(function (x) { return !x.dot && !x.old; });
    var st = el("section", "card state"); main.appendChild(st);
    st.appendChild(el("h2", null, "Läget"));
    if (!loud.length) st.appendChild(el("p", "empty", "Inget sticker ut."));
    else stateRows(st, loud);
    if (calm.length) {
      var cl = el("p", "calm"); cl.appendChild(document.createTextNode("Lugnt: "));
      calm.forEach(function (x, i) {
        if (i) cl.appendChild(document.createTextNode(" · "));
        var bt = button(cl, x.name + " " + x.value, "inline", function () { go(x.module); }); bt.setAttribute("aria-label", x.name + ": " + x.value + ", " + x.line);
      });
      st.appendChild(cl);
    }
    button(st, "Hela läget", "quiet tail", function () { go("laget"); });

    drawAhead(aside, rows);
    drawWork(aside);
    drawSince(aside, t);
  }
  /** The parts as rows: name, value, sentence; the whole row opens the part. */
  function stateRows(parent, list) {
    var ul = el("ul", "state-list");
    list.forEach(function (x) {
      var li = el("li"), bt = el("button", "state-row"); bt.type = "button"; bt.setAttribute("aria-label", x.name + ": " + x.value + ", " + x.line + (x.dot ? ", väntar på dig" : "") + (x.old ? ", gammal siffra" : ""));
      var top = el("span", "sr-top"); top.appendChild(el("span", "sr-name", x.name)); if (x.dot) top.appendChild(dot()); top.appendChild(el("span", "sr-value", x.value)); bt.appendChild(top);
      bt.appendChild(el("span", "sr-line", x.line + (x.old && x.module !== "drift" ? " · " + (x.oldText || "gammal siffra") : "")));
      bt.addEventListener("click", function () { go(x.module); });
      li.appendChild(bt); ul.appendChild(li);
    });
    parent.appendChild(ul);
  }
  /** The two weeks ahead: the tower's dates, the calendar "mila coach" and the release rhythm, one line per day. */
  function drawAhead(g, rows) {
    var wk = el("section", "card ahead"); g.appendChild(wk);
    wk.appendChild(el("h2", null, "Veckorna framåt"));
    var items = {}, add = function (day, title, mine, overdue) {
      title = String(title || "");
      if (!day || day > plusDays(data.today, 14) || (day < data.today && !overdue)) return;
      var k = day + "|" + title.toLowerCase(); if (!items[k]) items[k] = { day: day, title: title, mine: mine };
    };
    // an open date that has passed stays on the page until it is marked done
    (data.deadlines || []).forEach(function (d) { add(d.due, d.title, true, typeof d.id === "number"); });
    var ev = data.calendar && data.calendar.data && data.calendar.data.events;
    (ev || []).forEach(function (e) { add(e.day || (e.start || "").slice(0, 10), e.title || "", !!e.ours); });
    if (data.rhythm) { add(data.rhythm.nextSubmit, "Inskicksdag (torsdag)", true); add(data.rhythm.nextRelease, "Släppdag (tisdag)", true); }
    // what the visible rows already say on their own day is not said again (a hidden row, or another day, still shows)
    var shown = {}; rows.slice(0, needOpen ? rows.length : 5).forEach(function (r) { if (r.due) shown[r.due + "|" + String(r.title || "").toLowerCase()] = true; });
    var list = Object.keys(items).map(function (k) { return items[k]; }).filter(function (x) { return !shown[x.day + "|" + x.title.toLowerCase()]; }).sort(function (a, c) { return a.day < c.day ? -1 : a.day > c.day ? 1 : a.title.localeCompare(c.title); });
    if (!list.length) wk.appendChild(el("p", "empty", "Inget inlagt de närmaste två veckorna."));
    var tl = el("ol", "timeline"), last = null;
    if (list.length > 10) wk.appendChild(el("p", "sub", "Visar 10 av " + list.length + "."));
    list.slice(0, 10).forEach(function (x) {
      var li = el("li", x.day === data.today ? "today" : x.day < data.today ? "past" : null);
      li.appendChild(el("span", "when", x.day === last ? "" : x.day < data.today ? "Passerat" : x.day === data.today ? "I dag" : x.day === plusDays(data.today, 1) ? "I morgon" : dayText(x.day)));
      li.appendChild(el("span", "what", x.title));
      tl.appendChild(li); last = x.day;
    });
    wk.appendChild(tl);
    if (data.calendar && (oldness(data.calendar.at) || failed((data.errors || {}).kalender, data.calendar.at))) age(wk, data.calendar.at, "kalender");
    button(wk, "Hela kalendern", "quiet tail", function () { go("kalender"); });
  }
  /** When the queue is short: the newest mail (any that is not junk) and what the owner already did today. */
  function shortQueue(c) {
    var m = ((data.mail && data.mail.items) || []).filter(function (x) { return x.category !== "skrap"; }).slice(0, 3);
    if (m.length) {
      c.appendChild(el("h3", "minor", "Senaste mejlen"));
      var ul = el("ul", "rows compact");
      m.forEach(function (x) {
        var li = el("li", "row"); li.appendChild(el("span", "mark")); var o = el("button", "open"); o.type = "button";
        o.appendChild(el("div", "t", x.subject || "(utan ämne)")); o.appendChild(el("div", "d", (CAT[x.category] || x.category) + " · " + when(x.received_at) + (x.state === "klar" ? " · klar" : "")));
        o.addEventListener("click", function () { go("mejl", String(x.id)); }); li.appendChild(o); ul.appendChild(li);
      });
      c.appendChild(ul);
    }
    var done = (data.audit || []).filter(function (a) { return a.at && stockholmDay(a.at) === data.today && !/^(kalender|paminnelse|anteckning)_/.test(a.action); });
    c.appendChild(el("h3", "minor", "Klart i dag"));
    c.appendChild(el("p", "sub", done.length ? (done.length === 1 ? "En sak gjord härifrån i dag." : done.length + " saker gjorda härifrån i dag.") : "Inget gjort härifrån än i dag."));
  }
  /** Work in progress: the rounds with commits the last day and a half, the gate, the final-test flag, what waits for the owner. */
  function drawWork(g) {
    var w = el("section", "card work"); g.appendChild(w);
    w.appendChild(el("h2", null, "Pågående arbete"));
    var f = data.ops && data.ops.work, wk = f && f.data, ag = data.ops && data.ops.agents && data.ops.agents.data;
    var g0 = gateRuns()[0];
    var waiting = ((data.decisions && data.decisions.open) || []).length;
    kv(w, [["Väntar på dig", waiting ? (waiting === 1 ? "ett beslut" : waiting + " beslut") : "inget"],
      ["Slutprov (release.focus)", ag ? (ag.focus ? "pågår" : "nej") : "–"],
      ["Grinden", g0 ? gateWord(g0.status) + (g0.branch ? " · " + g0.branch : "") : "–"],
      ["Står en agent still", ag ? (ag.blocked ? "ja: " + ag.blocked : "nej") : "–"]]);
    if (!wk) { w.appendChild(el("p", "empty", "Rundorna har inte lästs än (insamlaren på Macen).")); return; }
    w.appendChild(el("h3", "minor", wk.active ? (wk.active === 1 ? "En runda har rört sig senaste dygnet" : wk.active + " rundor har rört sig senaste dygnet") : "Ingen runda har rört sig senaste dygnet"));
    var ul = el("ul", "rows compact");
    (wk.rounds || []).slice(0, 5).forEach(function (r) { row(ul, r.branch, [r.hours < 1 ? "senaste commit nyss" : "senaste commit för " + Math.round(r.hours) + " h sedan"]); });
    w.appendChild(ul);
    if ((wk.results || []).length) w.appendChild(el("p", "sub", "Senaste resultat: " + wk.results.slice(0, 3).map(function (x) { return x.name; }).join(", ") + "."));
    age(w, f.at, "arbete");
  }
  /** Since yesterday: mail, subscribers, AI cost, and what the tower itself changed (a calm line, never a decision). */
  function drawSince(g, t) {
    var since = el("section", "card since"); g.appendChild(since);
    since.appendChild(el("h2", null, "Senaste dygnet"));
    var n = ((data.mail && data.mail.items) || []).filter(function (m) { return nowMs() - Date.parse(m.received_at) < 86400e3 && m.category !== "skrap"; }).length;
    var ai = aiToday(), est = moneyEst() || {};
    var ch = t.changed || [], total = has(t.changed_total) ? t.changed_total : ch.length;
    kv(since, [["Nya mejl", data.mail && data.mail.configured ? f0(n) : "inte kopplat"], ["Betalande i App Store", f0(est.payers || 0)], ["Coachens AI i dag (hela Mila)", ai ? usd(ai.usd) + " ≈ " + kr(num(ai.usd) * usdSek()) : "inget än"], ["Tornets egna AI-anrop i dag", has(data.ops && data.ops.ai_today) ? f0(data.ops.ai_today) : "–"], ["Tornet ändrade på Macen", total ? f0(total) : "inget"]]);
    if (ch.length) {
      var det = el("details", "fold"); det.open = changesOpen; det.addEventListener("toggle", function () { changesOpen = det.open; });
      det.appendChild(el("summary", null, "Vad tornet ändrade"));
      var cl = el("ul", "plain"); ch.forEach(function (x) { cl.appendChild(el("li", null, x)); }); det.appendChild(cl);
      if (total > ch.length) det.appendChild(el("p", "sub", "De " + ch.length + " senaste av " + total + "; hela loggen finns under Inställningar."));
      since.appendChild(det);
    }
  }

  // ---- Läget: every part in one list (the phone's way to the six parts; on a wide screen the side list says the same)
  function drawState(b) {
    var g = el("div", "grid"); b.appendChild(g);
    var c = card(g, null, "Varje del med sitt läge. En prick betyder att något där väntar på dig.");
    stateRows(c, pulse());
    var s = card(g, "Insamlingen", null), bad = sources().filter(function (x) { return x.trouble; });
    s.appendChild(el("p", bad.length ? "note" : "empty", bad.length ? (bad.length === 1 ? "En källa är gammal eller gick inte att hämta: " : bad.length + " källor är gamla eller gick inte att hämta: ") + bad.map(function (x) { return x.name; }).join(", ") + "." : "Alla källor är färska."));
    button(s, "Visa källorna", "quiet tail", function () { go("drift"); });
  }

  // ---- questions the page asks before it acts: in the page itself (never the browser's own boxes), with the way out first in line
  /** A question in the sheet. opts: {title, text, yes, danger (asked a second time), second, yesSecond, input}. Resolves false, or {note}. */
  function ask(opts) {
    return new Promise(function (resolve) {
      var done = false, finish = function (v) { if (done) return; done = true; sheetOnClose = null; closeSheet(); resolve(v); };
      sheet(opts.title, function (body) {
        var text = el("p", "ask-text", opts.text || ""); body.appendChild(text);
        var input = null;
        if (opts.input) { input = el("textarea", "ask-input"); input.rows = 2; input.maxLength = 1000; input.placeholder = opts.input; input.setAttribute("aria-label", opts.input); body.appendChild(input); }
        var a = el("div", "acts ask-acts");
        var no = button(a, "Avbryt", "soft", function () { finish(false); });
        var armed = false;
        var yes = button(a, opts.yes || "Ja", "", function () {
          // what cannot be taken back is asked twice; the second time the button rests a moment and the focus is on the way out
          if (opts.danger && !armed) {
            armed = true; text.textContent = opts.second || "Säker? Det kan inte tas tillbaka härifrån."; yes.textContent = opts.yesSecond || "Ja, jag är säker";
            yes.disabled = true; setTimeout(function () { yes.disabled = false; }, 800); no.focus(); return;
          }
          finish({ note: input ? input.value : "" });
        });
        body.appendChild(a);
        // a second tap of a double tap never answers the question it opened
        yes.disabled = true; setTimeout(function () { if (armed) return; yes.disabled = false; if (!opts.danger && !input && document.activeElement === no) yes.focus(); }, 400);
        setTimeout(function () { (input || no).focus(); }, 0);
      }, function () { finish(false); });
    });
  }
  /** One action: the server does it and logs it; then the page reloads. A refusal is said plainly, never hidden. */
  function act(action, target, args, done, undo) {
    if (DEMO) { toast("Demoläge, inget ändras. " + (done || ""), undo ? function () { toast("Demoläge, inget ändras."); } : null); return Promise.resolve({ ok: true }); }
    return call("POST", "", { action: action, target: target, args: args || {} }).then(function (x) {
      if (!x || x.error) { toast(x && x.error === "ai_off" ? "AI-utkast är avstängda." : "Det gick inte (" + ((x && x.error) || "ingen anslutning") + ")."); return null; }
      if (done) toast(done, undo);
      if (target && mails[target]) delete mails[target];
      // what the owner just did is drawn at once, also when the cursor still rests in a field (a form is emptied, never sent twice)
      // (a refresh already on its way started before this action: a new one is fetched after it, and only that one is drawn)
      forceNext = true; if (loading) again = true; else load(); return x;
    });
  }
  function approve(r, yes) {
    var what = r.approve.action === "race" ? "race" : "pending";
    if (yes) { ask({ title: "Godkänn?", text: r.title + "\n\nDet blir synligt för alla löpare.", yes: "Godkänn" }).then(function (ok) { if (ok) act(what + "_approve", r.approve.id, {}, "Godkänt."); }); return; }
    // a rejection removes the proposal: asked twice
    ask({ title: "Avvisa?", text: r.title, yes: "Avvisa", danger: true, second: "Säker? Förslaget tas bort och kan inte tas tillbaka härifrån.", yesSecond: "Ja, ta bort förslaget" })
      .then(function (ok) { if (ok) act(what + "_reject", r.approve.id, { confirmed: true }, "Avvisat."); });
  }
  function answer(r, yn) {
    ask({ title: yn === "ja" ? "Svara ja?" : "Svara nej?", text: r.title, yes: yn === "ja" ? "Svara ja" : "Svara nej", input: "En rad till den som frågade (valfritt)" })
      .then(function (ok) { if (ok) act("decision_answer", r.approve.id, { answer: yn, note: ok.note.slice(0, 1000) }, yn === "ja" ? "Svarat ja." : "Svarat nej."); });
  }
  var toastT = null;
  function toast(text, undo) {
    var t = clear($("toast")); t.appendChild(el("span", null, text)); t.hidden = false;
    if (undo) button(t, "Ångra", "toast-undo", function () { t.hidden = true; undo(); });
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, undo ? 8000 : 4000);
  }

  // ---- Mejl: what is left to do first; the list and the mail side by side on a wide screen, one at a time on a phone
  function mailList() {
    var m = data.mail || { items: [] };
    return (m.items || []).filter(function (x) {
      return (mailBox === "alla" || x.box === mailBox) && (mailCat === "alla" || x.category === mailCat)
        && (mailState === "alla" || (mailState === "gora" ? todoMail(x) : mailState === "vantar" ? x.state === "vantar" : mailState === "klar" ? x.state === "klar" : x.category === "skrap"));
    });
  }
  /** One row per thread: the newest message, with how many there are. */
  function threadsOf(list) {
    var threads = {}, order = [];
    list.forEach(function (x) { if (!threads[x.thread]) { threads[x.thread] = { top: x, n: 0 }; order.push(x.thread); } threads[x.thread].n++; });
    return order.map(function (k) { return threads[k]; });
  }
  function chip(parent, text, on, fn) { var ch = el("button", "chip", text); ch.type = "button"; ch.setAttribute("aria-pressed", String(on)); ch.addEventListener("click", fn); parent.appendChild(ch); return ch; }
  function drawMail(b) {
    var m = data.mail || { items: [], counts: {} };
    if (!m.configured) {
      var c0 = card(b, "Mejl", "Din adress, info@ och support@. Sorterat automatiskt; flytta det som hamnat fel.");
      c0.appendChild(el("p", "note", "Inte kopplat än. När ett appspecifikt lösenord för iCloud ligger i Supabase Secrets (ICLOUD_MAIL_USER och ICLOUD_MAIL_PASSWORD) läses inkorgen var tionde minut, utan att något markeras som läst eller flyttas."));
      return;
    }
    var split = el("div", "mail-split"); b.appendChild(split);
    var c = el("section", "card mail-list"); split.appendChild(c);
    var items = m.items || [], count = function (f) { return items.filter(f).length; };
    // what is left to do, what waits for an answer, what is done: the first question about a mailbox
    var seg = el("div", "chips seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Visa");
    [["gora", "Att göra", count(todoMail)], ["vantar", "Väntar", count(function (x) { return x.state === "vantar"; })], ["klar", "Klara", count(function (x) { return x.state === "klar"; })], ["skrap", "Skräp", count(function (x) { return x.category === "skrap"; })], ["alla", "Alla", items.length]].forEach(function (s) {
      chip(seg, s[1] + " " + s[2], mailState === s[0], function () { mailState = s[0]; render(true); });
    });
    c.appendChild(seg);
    var filt = el("div", "chips"); filt.setAttribute("role", "group"); filt.setAttribute("aria-label", "Adress och sortering");
    ["alla", "support", "info", "egen"].forEach(function (k) {
      var n = k === "alla" ? items.length : count(function (x) { return x.box === k; });
      chip(filt, (k === "alla" ? "Alla adresser" : BOX[k]) + " " + n, mailBox === k, function () { mailBox = k; render(true); });
    });
    var present = {}; items.forEach(function (x) { if (mailBox === "alla" || x.box === mailBox) present[x.category] = (present[x.category] || 0) + 1; });
    var sel = el("select", "chip-select"); sel.setAttribute("aria-label", "Sortering");
    ["alla"].concat(Object.keys(CAT)).forEach(function (k) {
      if (k !== "alla" && !present[k] && mailCat !== k) return;
      var o = el("option", null, k === "alla" ? "Alla sorteringar" : CAT[k] + " " + (present[k] || 0)); o.value = k; if (mailCat === k) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener("change", function () { mailCat = sel.value; render(true); });
    filt.appendChild(sel); c.appendChild(filt);

    var th = threadsOf(mailList());
    if (!th.length) {
      c.appendChild(el("p", "empty", mailState === "gora" && mailBox === "alla" && mailCat === "alla" ? "Inget att göra i mejlen." : "Inga mejl här."));
      if (mailState !== "alla" && items.length) button(c, "Visa alla " + items.length, "soft", function () { mailState = "alla"; mailBox = "alla"; mailCat = "alla"; render(true); });
    } else {
      var ul = el("ul", "mails");
      th.forEach(function (t) {
        var x = t.top, isNew = x.state === "ny" && x.category !== "skrap", li = el("li"), o = el("button", "mail-row" + (String(x.id) === mailId ? " on" : "") + (isNew ? " new" : "")); o.type = "button"; o.setAttribute("data-pick", ""); o.rowData = { key: "mail:" + x.id };
        if (String(x.id) === mailId) o.setAttribute("aria-current", "true");
        var top = el("span", "mr-top");
        if (isNew) top.appendChild(dot("ny"));
        top.appendChild(el("span", "mr-from", x.from_name || x.from_addr || "okänd")); top.appendChild(el("span", "mr-when", shortWhen(x.received_at))); o.appendChild(top);
        o.appendChild(el("span", "mr-subject", x.subject || "(utan ämne)"));
        if (x.snippet) o.appendChild(el("span", "mr-snippet", x.snippet.replace(/\s+/g, " ").slice(0, 160)));
        o.appendChild(el("span", "mr-meta", (CAT[x.category] || x.category) + " · " + (BOX[x.box] || x.box) + (x.state !== "ny" ? " · " + (STATE[x.state] || x.state).toLowerCase() : "") + (x.has_draft ? " · utkast finns" : "") + (t.n > 1 ? " · " + t.n + " i tråden" : "") + (x.sorted_by === "agaren" ? " · flyttad av dig" : "")));
        if (x.category === "gdpr" && x.gdpr_due && x.state !== "klar") o.appendChild(el("span", "mr-due", "Svara senast " + dayText(x.gdpr_due)));
        o.addEventListener("click", function () { go("mejl", String(x.id)); });
        li.appendChild(o); ul.appendChild(li);
      });
      c.appendChild(ul);
    }
    mailSync(c, m);

    var pane = el("section", "card mail-pane"); split.appendChild(pane);
    if (!mailId) { pane.classList.add("idle"); pane.appendChild(el("p", "empty", th.length ? "Välj ett mejl i listan." : "Inget mejl valt.")); return; }
    button(pane, "‹ Alla mejl", "quiet back", function () { go("mejl"); });
    var body = el("div"); pane.appendChild(body);
    showMail(body, mailId);
  }
  /** How the reading of the mailbox went: one line, the rest on request; a failed read is said first. */
  function mailSync(c, m) {
    var se = m.sync_error, ok = m.sync, bad = failed(se, ok && ok.at), old = ok && oldness(ok.at, 45);
    var p = el("p", "age" + (bad || old ? " old" : ""));
    if (bad || old) p.appendChild(dot());
    p.appendChild(document.createTextNode(bad ? "Senaste läsningen gick inte (" + ((se.data && se.data.error) || "fel") + ") " + when(se.at) + (ok ? " · senast läst " + when(ok.at) : "")
      : ok ? (old ? "Gammalt: Mila-mapparna lästes " + when(ok.at) + "." : "Mila-mapparna lästes " + when(ok.at) + ".") : "Mila-mapparna har inte lästs än."));
    c.appendChild(p);
    var notes = ["Din adress, info@ och support@. Sorterat automatiskt; flytta det som hamnat fel."];
    if (ok && ok.data && ok.data.folders) {
      var fl = Object.keys(ok.data.folders);
      notes.push(fl.length ? "Läser bara mappen Mila: " + fl.map(function (n) { var f = ok.data.folders[n], d = f.delim || "/"; return n.split(d).pop() + " " + num(f.probe) + (f.error ? " (gick inte att läsa)" : ""); }).join(" · ") + " mejl senaste veckan." : "Hittar ingen mapp som heter Mila i iCloud.");
      var miss = fl.reduce(function (a, n) { return a + num(ok.data.folders[n].missing); }, 0);
      if (miss) notes.push(miss + " mejl gick inte att läsa ut ur iCloud och hoppades över.");
      if (ok.data.stopped) notes.push("Tiden räckte inte för alla mappar senast; resten läses nästa gång.");
      if (ok.data.no_address) notes.push(ok.data.no_address + " mejl i Mila-mapparna saknade Mila-adress och hoppades över.");
      if (ok.data.by_folder) notes.push(ok.data.by_folder + " mejl utan Mila-adress i mottagarraden räknades till sin mapp (vidarebefordrade).");
    }
    if (ok && ok.data && ok.data.skipped) notes.push(ok.data.skipped + " mejl kunde inte sparas vid senaste läsningen (de hoppades över).");
    var det = el("details", "fold"); det.appendChild(el("summary", null, "Om läsningen"));
    notes.forEach(function (n) { det.appendChild(el("p", "sub", n)); });
    c.appendChild(det);
  }
  function fetchMail(id) {
    if (mails[id]) return Promise.resolve(mails[id]);
    return call("GET", "?mail=" + encodeURIComponent(id)).then(function (x) { if (x && !x.error) mails[id] = x; return x; });
  }
  function showMail(body, id, inline) {
    if (!mails[id]) body.appendChild(el("p", "sub", "Hämtar…"));
    fetchMail(id).then(function (x) {
      if ((!inline && mailId !== id) || !body.isConnected) return;
      clear(body);
      if (!x || x.error) { body.appendChild(el("p", "err", x && x.status === 404 ? "Mejlet finns inte längre (sparas i 13 månader)." : "Mejlet kunde inte hämtas.")); return; }
      if (inline) {
        body.setAttribute("data-reply", id);
        var from = el("p", "mail-meta"); from.appendChild(el("strong", null, x.from_name || x.from_addr || "okänd")); if (x.from_name && x.from_addr) from.appendChild(document.createTextNode(" <" + x.from_addr + ">")); from.appendChild(document.createTextNode(" · " + when(x.received_at)));
        body.appendChild(from);
        body.appendChild(el("div", "mailtext short", x.body || "(ingen text)"));
        replyBox(body, x, true);
        if (focusReply === id) {
          focusReply = null;
          // only while the owner is still at that row (a mail that took a moment to come never takes the focus from elsewhere)
          var at = document.activeElement, rowLi = body.closest("li"), ta0 = body.querySelector("textarea, .handed button");
          if (ta0 && rowLi && (at === document.body || rowLi.contains(at))) ta0.focus({ preventScroll: true });
        }
        return;
      }
      body.appendChild(el("h2", "mail-subject", x.subject || "(utan ämne)"));
      var meta = el("p", "mail-meta"); meta.appendChild(el("strong", null, x.from_name || x.from_addr || "okänd"));
      if (x.from_name && x.from_addr) meta.appendChild(document.createTextNode(" <" + x.from_addr + ">"));
      body.appendChild(meta);
      body.appendChild(el("p", "mail-meta", "Till " + (BOX[x.box] || x.box) + " · " + when(x.received_at) + " · " + (CAT[x.category] || x.category) + (x.state ? " · " + (STATE[x.state] || x.state).toLowerCase() : "")));
      if (x.gdpr_due) { var due = el("p", "due-note"); due.appendChild(dot()); due.appendChild(document.createTextNode("Svara senast " + dayText(x.gdpr_due) + ".")); body.appendChild(due); }
      body.appendChild(el("div", "mailtext", x.body || "(ingen text)"));
      if (x.html) {
        // the original, sanitised by the browser's sandbox: no scripts, no forms, no navigation, and no image or style from elsewhere
        // (the frame's own policy allows only inline styles and embedded data images), so a tracking pixel never says it was opened
        var show = el("button", "quiet", "Visa original"); show.type = "button";
        show.addEventListener("click", function () {
          var fr = document.createElement("iframe");
          fr.setAttribute("sandbox", ""); fr.setAttribute("referrerpolicy", "no-referrer"); fr.className = "original"; fr.title = "Mejlets original";
          fr.srcdoc = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\">" + x.html;
          show.replaceWith(fr);
        });
        body.appendChild(show);
      }
      mailTools(body, x);
      if (focusReply === id) { focusReply = null; var ta1 = body.querySelector(".mail-pane textarea, textarea"); if (ta1) ta1.focus({ preventScroll: true }); }
    });
  }
  /** The mail after this one in the list as it is filtered now (the owner works down the list). */
  function nextMail(id) {
    var th = threadsOf(mailList()), i = -1;
    th.forEach(function (t, n) { if (String(t.top.id) === String(id)) i = n; });
    var nx = i < 0 ? null : th[i + 1] || (i > 0 ? th[i - 1] : null);
    return nx ? String(nx.top.id) : null;
  }
  function setMailState(x, state, said, move, thread) {
    var before = x.state || "ny", nx = move ? nextMail(x.id) : String(x.id);
    // the list shows one row per thread, so "Klar" and "Väntar" mark the whole thread as it is listed now (older messages with it)
    var me = ((data.mail && data.mail.items) || []).filter(function (m) { return String(m.id) === String(x.id); })[0];
    // from Mejl the thread as it is listed now; from I dag (no list there) the whole thread
    var pool = move ? mailList() : ((data.mail && data.mail.items) || []);
    // a GDPR request in the same thread is never closed along with another message: it is marked on its own, after its question
    var rest = !(move || thread) || !me || !me.thread ? [] : pool.filter(function (m) { return !(state === "klar" && (m.category === "gdpr" || m.gdpr_due)); }).filter(function (m) { return m.thread === me.thread && String(m.id) !== String(x.id) && m.state !== state && (state === "klar" || todoMail(m)); }).map(function (m) { return { id: String(m.id), was: m.state || "ny" }; });
    // the older ones first, all at once, then this one: one refresh and one line with its way back
    // resolves to how many of them the server did not take (said beside the result, never dropped)
    var all = function (to) {
      if (DEMO || !rest.length) return Promise.resolve(0);
      return Promise.all(rest.map(function (o) { delete mails[o.id]; return call("POST", "", { action: "mail_state", target: o.id, args: { state: to(o) } }).then(function (r) { return !r || r.error ? 1 : 0; }, function () { return 1; }); }))
        .then(function (xs) { return xs.reduce(function (a, n) { return a + n; }, 0); });
    };
    all(function () { return state; }).then(function (missed) {
      act("mail_state", String(x.id), { state: state }, said + (missed ? " " + (missed === 1 ? "Ett äldre mejl i tråden gick inte att markera." : missed + " äldre mejl i tråden gick inte att markera.") : ""), function () { all(function (o) { return o.was; }).then(function () { act("mail_state", String(x.id), { state: before }, "Ångrat."); }); });
    });
    if (move) go("mejl", nx);
  }
  /** Under a mail: mark it, move it, and a reply draft that is only ever sent from the owner's own Mail app. */
  function mailTools(body, x) {
    var st = el("div", "acts mail-acts");
    button(st, "Klar", "", function () { setMailState(x, "klar", "Markerat klart.", true); });
    button(st, "Väntar på svar", "soft", function () { setMailState(x, "vantar", "Markerat väntar.", true); });
    button(st, "Läst", "soft", function () { setMailState(x, "last", "Markerat läst.", false); });
    body.appendChild(st);
    var sortRow = el("label", "sort-row", "Sortera som "), sel = el("select"); sel.setAttribute("aria-label", "Flytta till");
    Object.keys(CAT).forEach(function (k) { var o = el("option", null, CAT[k]); o.value = k; if (k === x.category) o.selected = true; sel.appendChild(o); });
    sel.addEventListener("change", function () { var was = x.category, now = sel.value; act("mail_category", String(x.id), { category: now }, "Flyttat till " + CAT[now] + ".", function () { act("mail_category", String(x.id), { category: was }, "Ångrat."); }); });
    sortRow.appendChild(sel); body.appendChild(sortRow);
    replyBox(body, x, false);
  }
  /** The reply: a draft that is only ever sent from the owner's own Mail app. Once it is handed to Mail the mail asks what it is now. */
  function replyBox(body, x, inline) {
    if (x.category === "skrap" || !x.from_addr) return;
    var key = String(x.id);
    if (handedToMail[key]) {
      var done = el("div", "handed"); done.setAttribute("role", "status");
      done.appendChild(el("p", "note", "Svaret är lämnat till Mail. Skicka det där, och säg sedan här vad mejlet är nu."));
      var da = el("div", "acts"), gdpr = x.category === "gdpr" || !!x.gdpr_due;
      var mark = function (state, said) { delete handedToMail[key]; delete replyOpen[key]; setMailState(x, state, said, !inline, true); };
      // a GDPR request is done only when it is handled, not when it is answered: asked first, never one tap
      button(da, "Klar", "", function () {
        if (!gdpr) { mark("klar", "Markerat klart."); return; }
        ask({ title: "Är begäran hanterad?", text: (x.subject || "GDPR-begäran") + "\n\nMarkera klar först när det som begärdes är gjort. Raden försvinner då ur I dag.", yes: "Ja, hanterad" }).then(function (ok) { if (ok) mark("klar", "Markerat klart."); });
      });
      button(da, "Väntar på svar", "soft", function () { mark("vantar", "Markerat väntar."); });
      button(da, "Mail öppnades inte", "quiet", function () { delete handedToMail[key]; focusReply = key; forceNext = true; render(true); });
      done.appendChild(da); body.appendChild(done); return;
    }
    body.appendChild(el(inline ? "h4" : "h3", "reply-title", "Svar"));
    body.appendChild(el("p", "sub", "Inget skickas härifrån: Öppna i Mail lägger svaret i din egen e-post, och du skickar det själv."));
    var ta = el("textarea"); ta.rows = inline ? 6 : 9; ta.value = drafts[key] !== undefined ? drafts[key] : (x.draft || ""); ta.setAttribute("aria-label", "Utkast till svar"); body.appendChild(ta);
    // what is typed is kept while the page refreshes around it (until it is saved or the page is closed)
    ta.addEventListener("input", function () { drafts[key] = ta.value; });
    var note = el("p", "sub"); note.setAttribute("role", "status"); body.appendChild(note);
    var save = function (said) { var text = ta.value; return act("mail_draft", key, { draft: text.slice(0, 8000) }, said).then(function (r) { if (r && drafts[key] === text) delete drafts[key]; return r; }); };
    var a = el("div", "acts");
    // nothing is sent from here, so opening Mail is one tap; only a reply too long for a mail link is asked about first (it would be cut)
    var toMail = function () {
      save(); act("mail_open_in_mail", key, {});
      handedToMail[key] = true; forceNext = true; render(true);
      var subj = x.subject && /^re:/i.test(x.subject) ? x.subject : "Re: " + (x.subject || "");
      location.href = "mailto:" + encodeURIComponent(x.from_addr) + "?subject=" + encodeURIComponent(subj.slice(0, 200)) + "&body=" + encodeURIComponent(ta.value.slice(0, 1800));
    };
    button(a, "Öppna i Mail", "", function () {
      if (!ta.value.trim()) { note.textContent = "Skriv något först."; return; }
      if (ta.value.length <= 1800) { toMail(); return; }
      ask({ title: "Svaret är långt", text: "Bara början följer med till Mail. Kopiera hela svaret först och klistra in det i Mail.", yes: "Öppna i Mail ändå" }).then(function (ok) { if (ok) toMail(); });
    });
    if (data.ai && data.ai.on) button(a, "Skriv utkast", "soft", function () {
      note.textContent = "Skriver…";
      call("POST", "", { action: "draft_ai", target: key }).then(function (r) {
        if (!r || r.error || typeof r.draft !== "string") { note.textContent = "Utkastet kunde inte skrivas just nu."; return; }
        ta.value = r.draft; drafts[key] = r.draft; note.textContent = r.flagged ? "Obs: utkastet nämner något som aldrig får stå i ett svar. Ändra innan du skickar." : "Utkast skrivet. Läs och ändra.";
      });
    });
    button(a, "Börja med en mall", "quiet", function () { call("POST", "", { action: "draft_start", target: key }).then(function (r) { if (r && typeof r.draft === "string" && !ta.value) { ta.value = r.draft; drafts[key] = r.draft; } }); });
    button(a, "Spara utkast", "quiet", function () { save("Utkastet sparat."); });
    button(a, "Kopiera svaret", "quiet", function () {
      if (!ta.value.trim()) { note.textContent = "Skriv något först."; return; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { note.textContent = "Svaret är kopierat."; }, function () { ta.select(); note.textContent = "Markerat: kopiera själv."; });
      else { ta.select(); note.textContent = "Markerat: kopiera själv."; }
    });
    body.appendChild(a);
  }

  // ---- Kalender och utgångsdatum (varnar 30, 7 och 1 dag före)
  var LEVEL = { passerad: "Passerat", "1": "I dag eller i morgon", "7": "Inom en vecka", "30": "Inom en månad" };
  var DKIND = { apple: "Apple", doman: "Domän", nyckel: "Nyckel", partner: "Partner", juridik: "Juridik", skatt: "Skatt", release: "Release", ovrigt: "Övrigt" };
  function drawCalendar(b) {
    var g = el("div", "grid two"); b.appendChild(g);
    var c = card(g, "Datum att hålla koll på", "I dag visar dem en månad före (i tre dagar), sedan en vecka före och dagen före; morgonsammanfattningen tar med dem.");
    var list = data.deadlines || [];
    if (!list.length) c.appendChild(el("p", "empty", "Inga datum inlagda."));
    var ul = el("ul", "rows");
    list.forEach(function (d) {
      var li = row(ul, d.title, [dayText(d.due) + (d.note ? " · " + d.note : "") + (d.source === "insamlare" ? " · från App Store Connect" : "")], d.level === "1" || d.level === "passerad", (DKIND[d.kind] || d.kind) + (d.level ? " · " + LEVEL[d.level] : ""));
      if (typeof d.id === "number") {
        var a = el("div", "acts");
        button(a, "Klar", "soft", function () { ask({ title: "Markera klart?", text: d.title + " (" + dayText(d.due) + ") tas bort från datumen.", yes: "Klar" }).then(function (ok) { if (ok) act("deadline_done", String(d.id), {}, "Markerat klart."); }); });
        li.appendChild(a);
      }
    });
    c.appendChild(ul);
    c.appendChild(el("h3", "minor", "Lägg till ett datum"));
    var form = el("form", "form");
    var ti = el("input"); ti.placeholder = "Vad"; ti.maxLength = 200; ti.required = true; ti.setAttribute("aria-label", "Vad");
    var du = el("input"); du.type = "date"; du.required = true; du.setAttribute("aria-label", "Datum");
    var kd = el("select"); kd.setAttribute("aria-label", "Typ"); Object.keys(DKIND).forEach(function (k) { var o = el("option", null, DKIND[k]); o.value = k; kd.appendChild(o); });
    var no = el("input"); no.placeholder = "Anteckning (valfritt)"; no.maxLength = 1000; no.setAttribute("aria-label", "Anteckning");
    var sb = el("button", "soft", "Lägg till"); sb.type = "submit";
    [ti, du, kd, no, sb].forEach(function (x) { form.appendChild(x); });
    form.addEventListener("submit", function (ev) { ev.preventDefault(); act("deadline_add", null, { title: ti.value.trim(), due: du.value, kind: kd.value, note: no.value.trim() }, "Datumet är inlagt."); });
    c.appendChild(form);
    var cf = data.calendar, ev = cf && cf.data && cf.data.events;
    var k = card(g, "Kalendern ”mila coach”", "Tornet lägger in och håller sina datum uppdaterade här. Andra kalendrar rör det aldrig.");
    if (!ev) k.appendChild(el("p", "empty", "Inte läst än (insamlaren på Macen behöver åtkomst till Kalender)."));
    else if (!ev.length) k.appendChild(el("p", "empty", "Inga händelser de närmaste fyra månaderna."));
    else {
      var ul2 = el("ul", "rows");
      ev.slice(0, 40).forEach(function (e) { row(ul2, e.title || "(utan rubrik)", [e.allday ? dayText(e.day || String(e.start || "").slice(0, 10)) : e.start ? when(e.start) : ""], false, e.ours ? "Lagd av tornet" : "Din"); });
      k.appendChild(ul2);
    }
    if (cf) age(k, cf.at, "kalender");
    // these three lived here before the overhaul; they are whole under Inställningar, one tap from here
    var mv = card(g, "Notiser, beslut och logg", "Finns under Inställningar.", "span");
    var a2 = el("div", "acts"); button(a2, "Öppna Inställningar", "soft", function () { go("mer"); }); mv.appendChild(a2);
  }

  // ---- Inställningar: the notices' switches, the latest decisions, the log, the keys, the driftpanel, signing out
  var KEYS = [["1–9", "I dag, Mejl, Appen, Pengar, Drift, Användare, Juridik, Marknad, Kalender"], ["0", "Inställningar"], ["l", "Hela läget"], ["j / k", "Nästa / föregående rad (I dag och Mejl)"], ["ö eller o", "Öppna den valda raden"],
    ["g", "Godkänn eller svara ja på den valda raden (annars den översta)"], ["s", "Skjut upp den en vecka"], ["r", "Läs och svara på mejlet i den valda raden"], ["x", "Markera mejlet i den valda raden klart"], ["e", "Mejl: markera klart och gå till nästa"], ["u", "Uppdatera"], ["?", "Visa tangenterna"], ["Esc", "Stäng rutan"]];
  function drawMore(b) {
    var g = el("div", "grid two"); b.appendChild(g);
    var n = card(g, "Notiser", "Högst en sammanfattning på morgonen, och bara när något väntar. Direkt bara när det är akut. Allt går till din egen e-post.");
    var NAMES = { morgon: "Morgonsammanfattning", nere: "Webbplatsen svarar inte", kostnadsparr: "Ett konto eller appen närmar sig kostnadsspärren (80 %)", avslag: "Avslag i App Review", gdpr_frist: "GDPR-frist inom 3 dagar", sakerhet: "Säkerhetshändelse (ingen källa kopplad än)" };
    var OFF = { morgon: "Av: du ser läget bara när du öppnar tornet.", nere: "Av: du märker det först när du öppnar tornet.", kostnadsparr: "Av: spärren skyddar ändå, men du får inte veta i förväg att den närmar sig.", avslag: "Av: du ser avslaget i tornet och i Apples eget mejl.", gdpr_frist: "Av: fristen syns bara i I dag.", sakerhet: "Av: inget skickas." };
    Object.keys(NAMES).forEach(function (k) {
      var on = (data.notify || {})[k] !== false, r = el("label", "switch");
      var cb = el("input"); cb.type = "checkbox"; cb.checked = on; cb.setAttribute("role", "switch");
      cb.addEventListener("change", function () { var want = cb.checked; act("notify_set", k, { on: want }, NAMES[k] + (want ? ": på." : ": av. " + OFF[k])).then(function (r) { if (!r) cb.checked = !want; }, function () { cb.checked = !want; }); });
      var tx = el("span", "switch-text"); tx.appendChild(el("span", null, NAMES[k])); tx.appendChild(el("span", "sub", OFF[k]));
      r.appendChild(cb); r.appendChild(tx); n.appendChild(r);
    });
    var dq = (data.decisions && data.decisions.answered) || [];
    var h = card(g, "Senaste besluten", null);
    if (!dq.length) h.appendChild(el("p", "empty", "Inga beslut besvarade än."));
    else kv(h, dq.slice(0, 8).map(function (x) { return [x.title, (x.answer === "ja" ? "Ja" : "Nej") + " · " + when(x.answered_at)]; }));
    var lg = card(g, "Loggen", "Det senaste som gjorts härifrån, av dig och av tornet.");
    if (!(data.audit || []).length) lg.appendChild(el("p", "empty", "Inget än."));
    else kv(lg, data.audit.slice(0, 12).map(function (x) { return [(ACTION[x.action] || x.action) + (x.target ? " · " + x.target : ""), when(x.at)]; }));
    var ky = card(g, "Tangenter", "På en dator med tangentbord.");
    kv(ky, KEYS);
    var mo = card(g, "Mer", null, "span");
    var p = el("p", "note"); p.appendChild(document.createTextNode("Driftpanelen med alla grafer finns kvar: ")); link(p, "milacoach.app/dash", "../dash/"); p.appendChild(document.createTextNode(" .")); mo.appendChild(p);
    mo.appendChild(el("p", "sub", "Läget hämtades " + when(data.at) + " och hämtas om varannan minut medan sidan är öppen."));
    var a = el("div", "acts"); button(a, "Uppdatera nu", "soft", function () { load(); toast("Hämtar läget…"); }); button(a, "Logga ut", "soft", logout); mo.appendChild(a);
  }

  // b41-kod-dash: Kod's counts (in a code's period, code ran out unpaid; paid after a code: paying now or stopped, both in App Store)
  function kodKv(c, k) {
    var o = k.outcome || {}, paid = num(o.paying) + num(o.left), done = paid + num(o.ended);
    kv(c, [["I kodperiod nu", f0(k.in_code)], ["Koden slut, inget betalt efter", f0(o.ended)], ["Betalar efter koden (i App Store)", f0(o.paying)],
      ["Gick vidare efter koden, betalar inte nu (i App Store)", f0(o.left)], ["Andel som gick vidare efter koden", done ? Math.round(paid / done * 100) + " %" : "–"]]);
  }

  // ---- Användare (bara sammanräknat: inga namn, inga hälsovärden)
  function drawUsers(b) {
    var d = (data.money && data.money.dash) || {}, envs = d.envs || {}, g = el("div", "grid two"); b.appendChild(g);
    // b41-kod-dash: Kod (accounts whose latest App Store transaction is still an offer code) has its own card; under 5 accounts only
    // its counts, and those accounts are still in App Store's numbers
    var kod = envs.kod;
    if (kod && kod.small) {
      var kc = card(g, "Kod", "Erbjudandekoder. Färre än 5 konton: bara antal, och de räknas i App Store.");
      kodKv(kc, kod);
    }
    [["as", "App Store"]].concat(kod && !kod.small ? [["kod", "Kod"]] : [], [["tf", "TestFlight"]]).forEach(function (e) {
      var gr = (envs[e[0]] && envs[e[0]].growth) || {}, c = card(g, e[1], e[0] === "kod" ? "Erbjudandekoder: konton vars senaste transaktion fortfarande är koden. Inte med i App Store." : null);
      if (e[0] === "kod") kodKv(c, kod);
      tiles(c, [{ v: f0(sum(gr.active_1d)), l: "Aktiva i dag" }, { v: f0(sum(gr.active_7d)), l: "Aktiva 7 d" }, { v: f0(sum(gr.active_30d)), l: "Aktiva 30 d", d: f0(sum(gr.accounts)) + " konton" }]);
      var co = (gr.cohorts || []).slice(-6);
      if (co.length) kv(c, co.map(function (x) { return ["Vecka " + String(x.w).slice(-2) + " (" + f0(x.n) + " nya)", "dag 1: " + (has(x.d1) ? f0(x.d1) : "–") + " · dag 7: " + (has(x.d7) ? f0(x.d7) : "–") + " · dag 30: " + (has(x.d30) ? f0(x.d30) : "–")]; }));
      var u = envs[e[0]] && envs[e[0]].usage;
      if (u) c.appendChild(el("p", "sub", "Kopplingar: " + Object.keys(u.connections || {}).map(function (k) { return k + " " + f0(u.connections[k]); }).join(", ") + (has(u.buddies) ? " · löparkompisar " + f0(u.buddies) : "")));
    });
    var us = data.users || {}, w = card(g, "Vad löpare önskar sig", "Öppna önskemål per tema, som coachen sorterade dem. Underlag för support-KB och nästa runda.");
    if (!(us.wish_themes || []).length) w.appendChild(el("p", "empty", "Inga öppna önskemål."));
    else kv(w, us.wish_themes.map(function (x) { return [x.k, f0(x.n)]; }));
    var rp = card(g, "Anmälda coachtexter, 30 d", "Varför löpare anmälde en text, som antal.");
    if (!(us.report_reasons || []).length) rp.appendChild(el("p", "empty", "Inga anmälningar."));
    else kv(rp, us.report_reasons.map(function (x) { return [x.k, f0(x.n)]; }));
    var q = card(g, "Återkommande frågor i mejlen", "Antal öppna mejl per kategori; underlag till support-KB.");
    var cnt = (data.mail && data.mail.counts) || {}, keys = Object.keys(cnt);
    if (!keys.length) q.appendChild(el("p", "empty", "Inga öppna mejl."));
    else kv(q, keys.sort(function (a, c) { return cnt[c] - cnt[a]; }).map(function (k) { var p2 = k.split(":"); return [(CAT[p2[1]] || p2[1]) + " · " + (BOX[p2[0]] || p2[0]), f0(cnt[k])]; }));
  }

  // ---- Juridik och bolag
  function drawLegal(b) {
    var l = data.legal || {}, cv = l.consent_versions || {}, g = el("div", "grid two"); b.appendChild(g);
    var gd = card(g, "GDPR-loggen", null), items = ((data.mail && data.mail.items) || []).filter(function (m) { return m.category === "gdpr"; });
    if (!items.length) gd.appendChild(el("p", "empty", "Inga öppna GDPR-begäranden."));
    else {
      var gl = el("ul", "rows");
      items.forEach(function (m) {
        var li = el("li", "row"), mark = el("span", "mark"); if (m.state !== "klar") mark.appendChild(dot("väntar på dig")); li.appendChild(mark);
        var o = el("button", "open"); o.type = "button"; o.appendChild(el("div", "t", m.subject || "Begäran"));
        o.appendChild(el("div", "d", "Kom " + dayText(String(m.received_at).slice(0, 10)) + (m.gdpr_due ? " · svara senast " + dayText(m.gdpr_due) : "") + (m.state === "klar" ? " · klar" : "")));
        o.addEventListener("click", function () { go("mejl", String(m.id)); }); li.appendChild(o); gl.appendChild(li);
      });
      gd.appendChild(gl);
    }
    var fo = el("details", "fold"); fo.appendChild(el("summary", null, "Om fristen"));
    fo.appendChild(el("p", "sub", "Fristen är en månad. Den får förlängas med högst två månader bara om begäran är komplicerad eller om de är många, och då ska personen få veta det och varför inom den första månaden. Varje åtgärd härifrån står i loggen under Inställningar."));
    gd.appendChild(fo);
    var c = card(g, "Samtycken", "Senaste versionen som någon löpare har godkänt.");
    kv(c, [["Coachen och AI", cv.ai ? "v" + cv.ai : "–"], ["Hälsodata", cv.health ? "v" + cv.health : "–"], ["Tillsammans", cv.social ? "v" + cv.social : "–"]]);
    c.appendChild(el("p", "sub", "Version 7 (Suunto, klimakteriestatus och allergier) byggs i bygge 32."));
    c.appendChild(el("p", "sub hand", "Raden ovan är skriven för hand 5 november och uppdateras inte av sig själv."));
    var site = data.ops && data.ops.site && data.ops.site.data, s = card(g, "Juridiska sidor", null);
    if (!site) s.appendChild(el("p", "empty", "Inte kontrollerade än."));
    else { kv(s, (site.checks || []).filter(function (x) { return /policy|Villkor|Support/i.test(x.name); }).map(function (x) { return [x.name, x.ok ? "publicerad" : "svarar inte"]; })); age(s, data.ops.site.at, "site"); }
    var pp = el("p", "note"); link(pp, "Integritetspolicy", "../privacy.html"); pp.appendChild(document.createTextNode(" · ")); link(pp, "Villkor", "../terms.html"); s.appendChild(pp);
    var dpa = card(g, "Personuppgiftsbiträden", "Kontrollera att avtalet (DPA) finns sparat för varje.");
    kv(dpa, [["Supabase (databas, EU/Irland)", "biträde"], ["Extern AI-tjänst (USA)", "underbiträde, EU:s standardavtalsklausuler"], ["Resend (e-post, USA)", "standardavtalsklausuler"], ["Apple (App Store, köp)", "eget ansvar"], ["GitHub Pages och Cloudflare (webb, DNS)", "ingen persondata utöver loggar"]]);
    var ds = card(g, "App Store: näringsidkare (DSA)", null);
    ds.appendChild(el("p", "note", "Mila säljs i EU, så App Store Connect ska visa Mila som näringsidkare med kontaktuppgifter (DSA). Kontrollera i App Store Connect att statusen är klar; tornet kan inte läsa den."));
    var bk = card(g, "Bokföring och skatt", "Inget bokföringssystem är kopplat. Det här är påminnelser, inte råd.", "span");
    var bl = el("ul", "rows");
    [["Moms", "Lägg in din momsperiods deklarationsdatum under Kalender; Skatteverket visar dem."],
      ["Köp från utländska tjänster", "Kontrollera varje faktura: när ett utländskt företag fakturerar utan moms redovisar du själv den svenska momsen (omvänd skattskyldighet) i momsdeklarationen. Det gäller till exempel AI-tjänsten, Resend, GitHub, Supabase och Cloudflare, beroende på vilket bolag som fakturerar."],
      ["Leverantörskvitton", "Spara månadens kvitton från varje tjänst i samma mapp."],
      ["Apples utbetalningar", "Apples försäljnings- och utbetalningsrapporter är underlaget för intäkterna."],
      ["F-skatt", "Kontrollera att F-skatten är aktiv innan lanseringen."]].forEach(function (x) { row(bl, x[0], [x[1]]); });
    bk.appendChild(bl);
  }

  // ---- Marknad
  // the site's own visit counter (besok-statistik, 2026-11-18; function besok, besok_summary): day counts only, page, source, device
  // and language each on its own, nothing about a visitor; "besök" are the views that came from outside the site
  var SV_LANG = { sv: "svenska", en: "engelska", de: "tyska", nb: "norska", da: "danska", fi: "finska", fr: "franska", es: "spanska", it: "italienska", nl: "nederländska",
    pl: "polska", pt: "portugisiska", is: "isländska", et: "estniska", lv: "lettiska", lt: "litauiska", cs: "tjeckiska", hu: "ungerska", ru: "ryska", uk: "ukrainska",
    tr: "turkiska", ar: "arabiska", ja: "japanska", zh: "kinesiska", ko: "koreanska", okant: "okänt", ovriga: "övriga" };
  // the site's folders (race_pages.ts: GUIDE_DIR, the race index per language, HUB_DIR), each with its language
  var GUIDE_ROOT = { "guider": "sv", "en/guides": "en", "de/ratgeber": "de", "nb/guider": "nb", "da/guides": "da", "fi/oppaat": "fi", "fr/guides": "fr", "es/guias": "es" };
  var RACE_ROOT = { "lopp": "sv", "en/races": "en", "de/laeufe": "de", "nb/lop": "nb", "da/lob": "da", "fi/kisat": "fi", "fr/courses": "fr", "es/carreras": "es" };
  var HUB = { stad: "Stad", city: "Stad", stadt: "Stad", by: "Stad", kaupunki: "Stad", ville: "Stad", ciudad: "Stad", distans: "Distans", distance: "Distans", distanz: "Distans",
    distanse: "Distans", matka: "Distans", distancia: "Distans", manad: "Månad", month: "Månad", monat: "Månad", maned: "Månad", maaned: "Månad", kuukausi: "Månad", mois: "Månad",
    mes: "Månad", land: "Land", country: "Land", maa: "Land", pays: "Land", pais: "Land" };
  function langName(x) { return SV_LANG[x] || x; }
  function slugName(x) { var t = x.replace(/-/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); }
  /** A counted page's name: what it is and its language; the path itself is shown beside it. */
  function pageName(p) {
    var m, rest, root;
    if (p === "ovriga") return "Övriga sidor";
    if (p === "/") return "Startsidan · engelska";
    if (p === "/sv.html") return "Startsidan · svenska";
    if ((m = /^\/index-([a-z]{2})\.html$/.exec(p))) return "Startsidan · " + langName(m[1]);
    if ((m = /^\/support(?:-([a-z]{2}))?\.html$/.exec(p))) return "Support · " + langName(m[1] || "en");
    if ((m = /^\/(privacy|terms)(?:-([a-z]{2}))?\.html$/.exec(p))) return (m[1] === "privacy" ? "Integritetspolicy" : "Villkor") + " · " + langName(m[2] || "sv");
    if (p === "/consumer-health-data.html") return "Hälsodatapolicy (USA)";
    for (root in GUIDE_ROOT) if (p.indexOf("/" + root + "/") === 0) {
      rest = p.slice(root.length + 2).replace(/\/$/, "");
      return (rest && rest.indexOf("/") < 0 ? "Guide: " + slugName(rest) : "Guider") + " · " + langName(GUIDE_ROOT[root]);
    }
    for (root in RACE_ROOT) if (p.indexOf("/" + root + "/") === 0) {
      var parts = p.slice(root.length + 2).replace(/\/$/, "").split("/").filter(Boolean), lang = " · " + langName(RACE_ROOT[root]);
      if (!parts.length) return "Loppregistret" + lang;
      if (parts.length === 1 && HUB[parts[0]]) return HUB[parts[0]] + ": alla" + lang;
      if (parts.length === 2 && HUB[parts[0]]) return HUB[parts[0]] + ": " + slugName(parts[1]) + lang;
      if (parts.length === 1) return "Lopp: " + slugName(parts[0]) + lang;
    }
    return p;
  }
  function sourceName(k) { return k === "direkt" ? "Direkt (ingen hänvisning)" : k === "okand" ? "Okänd" : k === "ovriga" ? "Övriga" : k; }
  /** One week against the week before, the same words everywhere: null when there is nothing to compare with. */
  function change(now, before) {
    if (!has(before) || !has(now)) return null;
    if (!num(before)) return num(now) ? "ny" : null;
    var d = Math.round((num(now) - num(before)) / num(before) * 100);
    return d === 0 ? "som veckan före" : (d > 0 ? "↑ " : "↓ ") + Math.abs(d) + " % mot veckan före";
  }
  function isoWeek(d) { var t = new Date(d + "T12:00:00Z"), day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3); var y = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - y) / 864e5 - 3 + ((y.getUTCDay() + 6) % 7)) / 7); }
  /** A count and its share of a whole (the whole is the total, never the shown top list). */
  function shareOf(total) { var t = num(total) || 1; return function (x) { return f0(x.n) + " · " + Math.round(num(x.n) / t * 100) + " %"; }; }
  function drawVisits(g, live) {
    var v = data.market && data.market.visits, c = card(g, "Besök på webbplatsen", "Egen räknare på milacoach.app: inga kakor, inga IP-adresser i statistiken, inget om en enskild besökare.", "span");
    if (!v || v.missing) { c.appendChild(el("p", "empty", "Räknaren är inte igång än: migrationen och funktionen besok är inte driftsatta.")); return; }
    if (v.error) { c.appendChild(el("p", "empty", "Siffrorna kunde inte hämtas just nu. Tornet försöker igen vid nästa uppdatering.")); return; }
    var first = v.first_day || null, today = data.today;
    // only the days the counter has been running: days before its first day are not zeros, they were never counted; and its first day
    // was only partly counted, so a whole day or week is one that starts after it
    var days = (v.days || []).filter(function (x) { return first && x.d >= first; });
    var e = function (xs) { return xs.reduce(function (a, x) { return a + num(x.e); }, 0); }, vv = function (xs) { return xs.reduce(function (a, x) { return a + num(x.v); }, 0); };
    var since = function (k) { var from = plusDays(today, -k); return days.filter(function (x) { return x.d >= from && x.d < today; }); };
    var full = function (d) { return !!first && first < d; };
    var last = days.length && days[days.length - 1].d === today ? days[days.length - 1] : null, yd = plusDays(today, -1), y = days.filter(function (x) { return x.d === yd; })[0] || null;
    if (!first) c.appendChild(el("p", "empty", "Inga besök räknade än. Siffrorna kommer när sidorna med räknaren är publicerade."));
    else {
      tiles(c, [{ v: y && full(yd) ? f0(y.e) : "–", l: "Besök i går", d: f0(last ? last.e : 0) + " hittills i dag" },
        { v: f0(e(since(7))), l: "Besök, 7 hela dagar", d: full(plusDays(today, -14)) ? change(e(since(7)), e(since(14)) - e(since(7))) : "räknas sedan " + dayText(first).replace(/\.$/, "") },
        { v: f0(vv(days.slice(-30))), l: "Sidvisningar, 30 dagar", d: f0(e(days.slice(-30))) + " av dem besök" }]);
      var span = days.slice(-28);
      if (span.length >= 2) bars(c, span.map(function (x) { return x.d; }), span.map(function (x) { return x.e; }), "Besök per dag sedan " + dayText(span[0].d));
      // whole weeks (Monday–Sunday) before this one that the counter covered in full, newest first
      var weeks = [], mon = plusDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
      for (var i = 1; i <= 6; i++) {
        var from = plusDays(mon, -7 * i), to = plusDays(from, 6), pf = plusDays(from, -7), pt = plusDays(from, -1);
        if (!full(from)) break;
        var n = e(days.filter(function (x) { return x.d >= from && x.d <= to; })), pn = e(days.filter(function (x) { return x.d >= pf && x.d <= pt; }));
        var ch = full(pf) ? change(n, pn) : null;
        weeks.push(["Vecka " + isoWeek(from) + " · " + dayText(from).replace(/^\S+ /, "") + "–" + dayText(to).replace(/^\S+ /, ""), f0(n) + (ch ? " · " + ch.replace(" mot veckan före", "").replace("som veckan före", "±0 %") : "")]);
      }
      if (weeks.length) { c.appendChild(el("h3", "minor", "Besök per vecka, ändring mot veckan före")); kv(c, weeks); }
      c.appendChild(el("p", "sub", "Ett besök är en sidvisning som kom utifrån, inte från en annan sida på milacoach.app. Unika besökare räknas inte: det skulle kräva något som känner igen en enhet. Räknas sedan " + dayText(first).replace(/\.$/, "") + "; 30 dagar är med i dag."
        + (num(v.stopped_30d) ? " " + f0(v.stopped_30d) + " visningar och klick de senaste 30 dagarna kom över dagstaket och räknades inte." : "")));
    }
    var tp = card(g, "Toppsidor", "Sidvisningar de senaste 30 dagarna.");
    if (!(v.pages || []).length) tp.appendChild(el("p", "empty", "Inget räknat än."));
    else { var ul = el("ul", "rows compact"); v.pages.slice(0, 10).forEach(function (x) { var li = el("li", "row"); li.appendChild(el("span", "mark")); var d = el("div"); d.appendChild(el("div", "t", pageName(x.k))); d.appendChild(el("div", "d", x.k + " · " + f0(x.n))); li.appendChild(d); ul.appendChild(li); }); tp.appendChild(ul); }
    // the windows below are the server's: the last 30 days including today
    var e30 = e(days.slice(-30)), v30 = vv(days.slice(-30));
    var src = card(g, "Varifrån", "Webbplatsen besöket kom från, bara domänen; andel av besöken, 30 dagar.");
    if (!(v.sources || []).length) src.appendChild(el("p", "empty", "Inget räknat än."));
    else { var sh = shareOf(e30); kv(src, v.sources.map(function (x) { return [sourceName(x.k), sh(x)]; })); }
    var dl = card(g, "Enheter och språk", "Grovt, de senaste 30 dagarna; språket är webbläsarens.");
    if (!(v.devices || []).length) dl.appendChild(el("p", "empty", "Inget räknat än."));
    else {
      var shv = shareOf(v30);
      kv(dl, v.devices.map(function (x) { return [{ mobil: "Mobil", dator: "Dator", surfplatta: "Surfplatta" }[x.k] || x.k, shv(x)]; }));
      dl.appendChild(el("h3", "minor", "Språk"));
      kv(dl, (v.langs || []).map(function (x) { var n = langName(x.k); return [n.charAt(0).toUpperCase() + n.slice(1), shv(x)]; }));
    }
    var st = card(g, "App Store-klick", "Klick på länken till App Store på sidorna.");
    var a = function (xs) { return xs.reduce(function (s, x) { return s + num(x.a); }, 0); };
    tiles(st, [{ v: f0(last ? last.a : 0), l: "I dag" }, { v: f0(a(days.slice(-7))), l: "7 dagar med i dag" }, { v: f0(a(days.slice(-30))), l: "30 dagar med i dag" }]);
    if ((v.store_pages || []).length) kv(st, v.store_pages.slice(0, 6).map(function (x) { return [pageName(x.k), f0(x.n)]; }));
    else st.appendChild(el("p", "sub", live ? "Inga klick de senaste 30 dagarna." : "Länken till App Store läggs in när Mila är ute; klicken räknas från första dagen."));
  }
  function drawMarket(b) {
    var cm = (data.money && data.money.dash && data.money.dash.common) || {}, g = el("div", "grid two"); b.appendChild(g);
    var live = data.app && data.app.asc && data.app.asc.data && data.app.asc.data.state === "READY_FOR_SALE";
    var r = card(g, "Loppregistret", null);
    tiles(r, [{ v: f0(cm.register), l: "Lopp", d: f0(cm.countries) + " länder" }, { v: f0(cm.with_course), l: "Med arrangörens bana" }, { v: f0(cm.coming), l: "Kommande" }]);
    var waiting = ((data.idag && data.idag.rows) || []).filter(function (x) { return x.kind === "lopp"; }).length;
    var wp = el("p", waiting ? "due-note" : "sub"); if (waiting) wp.appendChild(dot());
    wp.appendChild(document.createTextNode(waiting ? waiting + " väntar på ditt godkännande under I dag." : "Inget väntar på godkännande.")); r.appendChild(wp);
    if (waiting) button(r, "Öppna I dag", "soft", function () { go("idag"); });
    r.appendChild(el("p", "sub", "Upptäckten av nya lopp är pausad tills Mila drar in pengar."));
    var site = data.ops && data.ops.site && data.ops.site.data, w = card(g, "Webbplatsen", null);
    kv(w, [["Loppsidor i sitemap", site && has(site.race_pages) ? f0(site.race_pages) : "–"], ["Besöksstatistik", (function (v) { return !v || v.missing ? "inte igång än" : v.error ? "kunde inte hämtas" : "egen räknare, nedan"; })(data.market && data.market.visits)]]);
    drawVisits(g, live);
    var l = card(g, "Inför och efter lanseringen", live ? "Mila är ute i App Store." : "Mila är inte ute i App Store än.", "span");
    var ul = el("ul", "rows");
    [["Featuring-nominering", "Uppdateras per bygge i gruppen Apple nominering; texten i Featuring-nominering.md."],
      ["App Store-länken", live ? "Lägg in den riktiga länken på alla loppsidor och på webbplatsen nu." : "Läggs in på loppsidor och webbplatsen när Mila är ute."],
      ["Egna produktsidor", "Ungefär en vecka efter lanseringen: Lopp och Apple Watch; texterna godkänns av dig först."],
      ["Partnerutskick", "Efter lanseringen och de första användarna: 2–3 åt gången (Janji m.fl.), bara utkast."]].forEach(function (x) { row(ul, x[0], [x[1]]); });
    l.appendChild(ul);
  }

  // ---- Appen
  function drawApp(b) {
    var f = data.app && data.app.asc, a = f && f.data, g = el("div", "grid two"); b.appendChild(g);
    var c = card(g, "App Store", null);
    if (!a) { c.appendChild(el("p", "empty", "App Store Connect har inte lästs än (insamlaren på Macen).")); }
    else {
      tiles(c, [{ v: ASC[a.state] || a.state || "–", l: "Version " + (a.version || "?") }, { v: a.build || "–", l: "Bygge i versionen" },
        { v: a.phased ? (PHASED[a.phased.state] || a.phased.state) : "–", l: "Fasad lansering", d: a.phased && a.phased.day ? "dag " + a.phased.day + " av 7" : null }]);
      if (a.rating) kv(c, [["Betyg i App Store", a.rating.count ? nf2.format(a.rating.avg) + " av 5 (" + f0(a.rating.count) + " betyg)" : "inga betyg än"]]);
      age(c, f.at, "asc");
    }
    var r = card(g, "Releaserytm", data.rhythm ? data.rhythm.line : null);
    if (data.rhythm) kv(r, [["Nästa inskick", dayText(data.rhythm.nextSubmit)], ["Nästa fasade lansering", dayText(data.rhythm.nextRelease)], ["Aldrig", "fredag"]]);
    var t = card(g, "TestFlight", null);
    if (!a || !a.builds || !a.builds.length) t.appendChild(el("p", "empty", "Inga byggen hämtade."));
    else {
      var ul = el("ul", "rows");
      a.builds.forEach(function (x) { row(ul, "Bygge " + x.n + " · " + (ASC[x.state] || x.state || ""), [(x.groups && x.groups.length ? x.groups.join(", ") : "inga grupper") + (x.at ? " · uppladdat " + when(x.at) : "")]); });
      t.appendChild(ul);
    }
    var rv = card(g, "Recensioner", null);
    var list = a && a.reviews ? a.reviews : [];
    if (!list.length) rv.appendChild(el("p", "empty", a ? "Inga skrivna recensioner än." : "Inte hämtat."));
    else {
      var ul2 = el("ul", "rows");
      list.forEach(function (x) { row(ul2, x.rating + " av 5 · " + (x.title || ""), [(x.body || "").slice(0, 400), (x.territory || "") + " · " + (x.at ? when(x.at) : "") + (x.replied ? " · besvarad" : "")]); });
      rv.appendChild(ul2);
    }
    var k = card(g, "Krascher", null, "span");
    k.appendChild(el("p", "empty", a && a.crashes !== undefined && a.crashes !== null ? f0(a.crashes) + " kraschrapporter från TestFlight senaste 7 dagarna." : "Mäts inte här än: App Store Connects kraschloggar finns i Xcode Organizer."));
  }

  // ---- Pengar
  function drawMoney(b) {
    var m = data.money || {}, d = m.dash || {}, as = (d.envs && d.envs.as) || {}, tf = (d.envs && d.envs.tf) || {}, est = as.est || {}, mon = as.money || {}, g = el("div", "grid two"); b.appendChild(g);
    var c = card(g, "Prenumerationer i App Store", "Uppskattningar: listpris minus moms och Apples 15 %, inte Apples utbetalning.");
    // b41-kod-dash: of them, those who came in through an offer code
    tiles(c, [{ v: f0(est.payers || 0), l: "Betalande", d: "månad " + f0((mon.by_plan || {})["as:monthly"] || 0) + " · år " + f0(((mon.by_plan || {})["as:yearly"] || 0) + ((mon.by_plan || {})["as:other"] || 0)) + (num(as.via_code) > 0 ? " · varav via kod " + f0(as.via_code) : "") },
      { v: f0(sum(mon.trial)), l: "I provperiod" }, { v: est.mrr_sek ? kr(est.mrr_sek) : "0 kr", l: "≈ MRR netto", d: "159 kr/mån · 1 290 kr/år" }]);
    tiles(c, [{ v: mon.cohort_trials ? Math.round(num(mon.cohort_converted) / num(mon.cohort_trials) * 100) + " %" : "–", l: "Blev betalande", d: mon.cohort_trials ? f0(mon.cohort_converted) + " av " + f0(mon.cohort_trials) : "inga provperioder än" },
      { v: f0(mon.ended_30d), l: "Avslutade, 30 d" }, { v: f0(mon.refunded_30d), l: "Återbetalda, 30 d" }]);
    if (tf.money) c.appendChild(el("p", "sub", "TestFlight (sandlåda, inga pengar): " + f0(sum(tf.money.active)) + " aktiva köp."));
    var kd = d.envs && d.envs.kod;
    if (kd) c.appendChild(el("p", "sub", "Kod (erbjudandekoder" + (kd.small ? ", räknas ovan" : ", inte med ovan") + "): " + f0(kd.in_code) + " i kodperiod nu, " + f0((kd.outcome || {}).ended) + " där koden tog slut utan betalning."));
    var s = m.sales && m.sales.data;
    if (s) { kv(c, [["Apples försäljningsrapport, 7 d", s.units7 !== undefined ? f0(s.units7) + " enheter" : "–"], ["Senaste utbetalning", s.payout ? s.payout : "ingen än"]]); age(c, m.sales.at, "sales", 36 * 60); }
    else c.appendChild(el("p", "sub", "Apples försäljningsrapporter och utbetalningar: inte hämtade än."));
    var daily = aiDaily().slice(-30);
    var a = card(g, "AI-kostnad", "Per dag, alla konton. Spärren är $2 per konto och dag.");
    var cr = as.cost_runner && as.cost_runner.users ? as.cost_runner : tf.cost_runner;
    // b41-kod-dash: from 5 accounts Kod has its own cost; the dearest account is the dearest of both
    var kcr = d.envs && d.envs.kod && !d.envs.kod.small ? d.envs.kod.cost_runner : null;
    if (kcr && kcr.users && (!cr || !cr.users || num(kcr.max) > num(cr.max))) cr = { users: num(cr && cr.users) + num(kcr.users), max: kcr.max, median: cr && cr.users ? cr.median : kcr.median };
    var last7 = daily.slice(-7).reduce(function (s2, x) { return s2 + num(x.usd); }, 0);
    tiles(a, [{ v: usd(daily.length ? daily[daily.length - 1].usd : null), l: "I dag hittills" }, { v: usd(last7), l: "Senaste 7 dagarna" },
      { v: cr ? usd(cr.max) : "–", l: "Dyraste konto, 24 h", d: cr ? "median " + usd(cr.median) + " · av $2" : null }]);
    bars(a, daily.map(function (x) { return x.d; }), daily.map(function (x) { return x.usd; }), "AI-kostnad per dag i dollar");
    var al = (data.ops && data.ops.alerts_2d) || [];
    if (al.length) {
      var ap = el("p", "due-note"); ap.appendChild(dot());
      ap.appendChild(document.createTextNode("Passerat 80 %: " + al.map(function (x) { return (x.kind === "tokens" ? "ett konto, av dagsbudgeten" : "appen, av dagens AI-tak") + " " + dayText(x.day); }).join(", ") + ". Det är en varning i förväg.")); a.appendChild(ap);
    }
    var mg = card(g, "Marginal per betalande", null);
    tiles(mg, [{ v: est.rev_per_payer_sek ? kr(est.rev_per_payer_sek) : "–", l: "Intäkt/mån netto" }, { v: has(est.ai_sek_per_runner_month) ? kr(est.ai_sek_per_runner_month) : "–", l: "AI per löpare/mån", d: "från senaste dygnet × 30" },
      { v: has(est.margin_per_payer_sek) ? kr(est.margin_per_payer_sek) : "–", l: "Kvar per betalande" }]);
    mg.appendChild(el("p", "sub", "Inga prognoser: siffrorna är dagens läge, inte en spaning framåt."));
    var fx = card(g, "Fasta kostnader", null);
    if (!(m.fixed || []).length) fx.appendChild(el("p", "empty", "Inga fasta kostnader inlagda än (Supabase, Resend, domän, Apple Developer, GitHub)."));
    else { kv(fx, (m.fixed || []).map(function (x) { return [x.name, (x.currency === "SEK" ? kr(x.amount) : x.currency + " " + nf2.format(num(x.amount))) + (x.per === "ar" ? "/år" : "/mån")]; })); fx.appendChild(el("p", "sub", "≈ " + kr(m.fixed_month_sek) + " i månaden.")); }
    fx.appendChild(el("h3", "minor", "Lägg till eller ändra en kostnad"));
    var cf = el("form", "form"), cn = el("input"), ca = el("input"), cc = el("select"), cp = el("select"), cs = el("button", "soft", "Spara kostnad");
    cn.placeholder = "Namn, t.ex. Supabase"; cn.maxLength = 80; cn.required = true; cn.setAttribute("aria-label", "Namn");
    ca.placeholder = "Belopp"; ca.inputMode = "decimal"; ca.required = true; ca.setAttribute("aria-label", "Belopp");
    ["SEK", "USD", "EUR"].forEach(function (k) { var o = el("option", null, k); o.value = k; cc.appendChild(o); }); cc.setAttribute("aria-label", "Valuta");
    [["manad", "per månad"], ["ar", "per år"]].forEach(function (k) { var o = el("option", null, k[1]); o.value = k[0]; cp.appendChild(o); }); cp.setAttribute("aria-label", "Period");
    cs.type = "submit"; [cn, ca, cc, cp, cs].forEach(function (x) { cf.appendChild(x); });
    cf.addEventListener("submit", function (ev) { ev.preventDefault(); act("cost_set", cn.value.trim(), { amount: ca.value.replace(",", ".").replace(/\s/g, ""), currency: cc.value, per: cp.value }, "Kostnaden är sparad."); });
    fx.appendChild(cf);
  }

  // ---- Drift
  function drawOps(b) {
    var o = data.ops || {}, d = (data.money && data.money.dash) || {}, cm = d.common || {}, g = el("div", "grid two"); b.appendChild(g);
    // every source with its age: what is old or failed first, in words (the page never shows an old number as a new one)
    var src = sources(), bad = src.filter(function (s) { return s.trouble; });
    var ins = card(g, "Insamlingen", bad.length ? (bad.length === 1 ? "En källa är gammal eller gick inte att hämta." : bad.length + " källor är gamla eller gick inte att hämta.") : "Alla källor är färska.", "span");
    var sl = el("ul", "rows compact cols");
    bad.concat(src.filter(function (s) { return !s.trouble; })).forEach(function (s) {
      var fail = s.bad ? "senaste hämtningen misslyckades " + when(s.err.at) + " (" + (s.err.error || "fel") + ")" : "";
      var line = s.off ? "inte kopplat" : s.noAge ? (fail || "inga fel senaste dygnet")
        : (s.at ? ago(s.at) : s.optional ? "inte hämtat än" : "aldrig hämtat") + (s.old ? " · gammal" : "") + (fail ? " · " + fail : "");
      row(sl, s.name, [line], s.trouble);
    });
    ins.appendChild(sl);
    ins.appendChild(el("p", "sub", "Insamlaren på Macen går var 30:e minut och mejlen läses var tionde. Något räknas som gammalt efter tre missade rundor."));
    var ag = card(g, "Agenter och byggen", null), a = o.agents && o.agents.data;
    if (!a) ag.appendChild(el("p", "empty", "Inte hämtat (insamlaren på Macen)."));
    else {
      kv(ag, [["Slutprov pågår (release.focus)", a.focus ? "ja – inga byggen vid sidan av" : "nej"], ["Väntar på något", a.blocked ? a.blocked : "nej"]]);
      ag.appendChild(el("h3", "minor", "Platser")); ag.appendChild(el("p", "raw", a.slots || "–"));
      age(ag, o.agents.at, "agents");
    }
    var gr = card(g, "CI-grinden", null);
    var runs = gateRuns();
    if (!runs.length) gr.appendChild(el("p", "empty", "Inga körningar registrerade."));
    else { var r0 = runs[0]; kv(gr, [["Senaste", gateWord(r0.status) + (r0.step ? " · " + r0.step : "")], ["Gren", r0.branch || "–"], ["Start", r0.started_at ? when(r0.started_at) : "–"]]); }
    var st = card(g, "Webbplatsen", null), site = o.site && o.site.data;
    if (!site) st.appendChild(el("p", "empty", "Inte kontrollerad än."));
    else { kv(st, (site.checks || []).map(function (x) { return [x.name, x.ok ? "svarar" : "svarar inte (" + (x.status || "fel") + ")"]; })); age(st, o.site.at, "site"); }
    var sy = card(g, "Server", null);
    kv(sy, [["Senaste migrering", cm.migration || "–"], ["Morgonrapport mejlad", cm.report_sent ? when(cm.report_sent) : "–"], ["Larm, 30 d", f0(sum(cm.alerts_30d))],
      ["Närmar sig spärren, 2 d", (o.alerts_2d || []).length ? (o.alerts_2d || []).map(function (x) { return (x.kind === "tokens" ? "ett konto på 80 % av dagsbudgeten" : "appens AI-tak på 80 %") + " " + dayText(x.day); }).join(", ") : "ingen"],
      ["Anmälningar att granska", has(o.moderation) ? f0(o.moderation) : "–"], ["Önskemål öppna", has(o.wishes) ? f0(o.wishes) : "–"]]);
    var it = card(g, "Integrationer", null);
    kv(it, [["Suunto", "godkänd – byggs i bygge 32"], ["Garmin", "ansökt 30 okt, väntar"], ["Polar", "kopplad; fråga om strukturerade pass, följ upp ~15 nov"], ["COROS", "bara via Apple Hälsa"]]);
    it.appendChild(el("p", "sub hand", "Skrivet för hand 5 november; uppdateras inte av sig självt."));
    var l = card(g, "Fler siffror", null, "span");
    var p = el("p", "note"); p.appendChild(document.createTextNode("Driftpanelen med alla grafer finns kvar: "));
    link(p, "milacoach.app/dash", "../dash/"); p.appendChild(document.createTextNode(" ."));
    l.appendChild(p);
  }

  // ---- the sheet (a question, the keys): a dialog that keeps the focus inside it and gives it back
  var lastFocus = null, sheetOnClose = null;
  function sheet(title, fill, onClose) {
    lastFocus = document.activeElement; sheetOnClose = onClose || null; $("sheet-title").textContent = title; var body = clear($("sheet-body")); $("sheet").hidden = false; $("app").inert = true; fill(body); $("sheet-close").focus();
  }
  function closeSheet() {
    var cb = sheetOnClose; sheetOnClose = null; $("sheet").hidden = true; $("app").inert = false;
    // back to where the owner was; a browser that does not focus a clicked button (Safari) gets the page's content instead
    if (lastFocus && lastFocus !== document.body && lastFocus.focus && lastFocus.isConnected) lastFocus.focus(); else $("board").focus({ preventScroll: true });
    if (cb) cb();
  }
  $("sheet-close").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", function (ev) { if (ev.target === $("sheet")) closeSheet(); });
  addEventListener("keydown", function (ev) {
    if ($("sheet").hidden) return;
    if (ev.key === "Escape") { closeSheet(); return; }
    if (ev.key !== "Tab") return;
    var f = Array.prototype.filter.call($("sheet").querySelectorAll("button, textarea, input, select, a[href]"), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], lastEl = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); lastEl.focus(); }
    else if (!ev.shiftKey && document.activeElement === lastEl) { ev.preventDefault(); first.focus(); }
    else if (!$("sheet").contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
  });
  function showKeys() { sheet("Tangenter", function (body) { kv(body, KEYS); }); }
  function picks() { return Array.prototype.filter.call($("board").querySelectorAll("[data-pick]"), function (x) { return x.offsetParent !== null; }); }
  addEventListener("keydown", function (ev) {
    if (!data || ev.metaKey || ev.ctrlKey || ev.altKey || !$("sheet").hidden || $("app").hidden) return;
    var tg = ev.target && ev.target.tagName; if (tg === "INPUT" || tg === "TEXTAREA" || tg === "SELECT") return;
    if (ev.repeat) return;
    var n = Number(ev.key);
    if (/^[1-9]$/.test(ev.key) && n <= MODULES.length) { ev.preventDefault(); go(MODULES[n - 1][0]); return; }
    if (ev.key === "0") { ev.preventDefault(); go("mer"); return; }
    if (ev.key === "l") { ev.preventDefault(); go("laget"); return; }
    if (ev.key === "?") { ev.preventDefault(); showKeys(); return; }
    if (ev.key === "u") { load(); toast("Hämtar läget…"); return; }
    if (ev.key === "j" || ev.key === "k") {
      var p = picks(); if (!p.length) return;
      var at = p.indexOf(document.activeElement); if (at < 0) at = ev.key === "j" ? -1 : p.length;
      pick = Math.max(0, Math.min(p.length - 1, at + (ev.key === "j" ? 1 : -1))); ev.preventDefault(); p[pick].focus(); return;
    }
    if (module === "mejl") {
      if (ev.key === "e" && mailId && mails[mailId]) { ev.preventDefault(); setMailState(mails[mailId], "klar", "Markerat klart.", true); }
      return;
    }
    if (module !== "idag") return;
    var rows = (data.idag && data.idag.rows) || [], at0 = document.activeElement, li0 = at0 && at0.closest ? at0.closest("[data-pick]") : null, r = (li0 && li0.rowData) || rows[0];
    if (!r) return;
    if ((ev.key === "ö" || ev.key === "o") && r.open && NAME[r.open.module]) { ev.preventDefault(); go(r.open.module, r.open.module === "mejl" ? r.open.id : null); return; }
    // g: the row's yes (the same question as its button); s: put it off a week
    if (ev.key === "g") { ev.preventDefault(); if (!r.approve) { toast("Raden har inget att godkänna."); return; } if (r.approve.action === "decision") answer(r, "ja"); else approve(r, true); }
    var mr = r.open && r.open.module === "mejl" && r.open.id ? mailItem(r.open.id) : null;
    // r and x act only on a row chosen with j/k (never on the top row by default)
    if ((ev.key === "r" || ev.key === "x") && !li0) { ev.preventDefault(); toast("Välj en rad med j eller k först."); return; }
    if (ev.key === "r" && mr) { ev.preventDefault(); toggleReply(String(mr.id)); return; }
    if (ev.key === "x" && mr && r.kind === "mejl") { ev.preventDefault(); setMailState(mr, "klar", "Markerat klart.", false, true); return; }
    if (ev.key === "s" && r.kind !== "beslut") { ev.preventDefault(); ask({ title: "Skjut upp en vecka?", text: r.title, yes: "Skjut upp" }).then(function (ok) { if (ok) snooze(r, 7); }); }
  });

  // ---- sign-in and the session (the driftpanel's session.js; the same device key, so one sign-in covers both pages)
  var S = MilaDashSession({ url: SUPABASE, anon: ANON, fetch: function (u, i) { return fetch(u, i); }, locks: navigator.locks });
  var TICK = 120e3, RETRY = [15e3, 30e3, 60e3, 120e3], fails = 0;
  function auth(path, body) {
    return fetch(SUPABASE + "/auth/v1/" + path, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit", referrerPolicy: "no-referrer" });
  }
  function offline(on) { $("offline").hidden = !on; }
  function stopTimers() { clearInterval(timer); clearTimeout(retryT); timer = retryT = null; }
  function showLogin(msg) {
    stopTimers(); offline(false); data = null; mails = {}; drafts = {}; replyOpen = {}; handedToMail = {}; keptInline = {}; focusReply = null; sheetOnClose = null; $("sheet").hidden = true; $("app").inert = false; $("app").hidden = true; $("login").hidden = false; $("f-mail").hidden = false; $("f-code").hidden = true;
    $("msg1").textContent = msg || ""; $("mail").focus();
  }
  function lost(why) {
    if (why === "expired") return showLogin("30 dagar sedan inloggningen med kod: logga in igen.");
    if (why === "auth") return showLogin("Logga in igen.");
    offline(true); retrySoon();
  }
  function retrySoon() { clearTimeout(retryT); retryT = setTimeout(function () { retryT = null; load(); }, RETRY[Math.min(fails++, RETRY.length - 1)]); }
  $("f-mail").addEventListener("submit", function (ev) {
    ev.preventDefault(); mail = $("mail").value.trim(); $("msg1").textContent = "";
    auth("otp", { email: mail, create_user: false }).then(function (r) {
      if (r.status === 429) { $("msg1").textContent = "För många försök. Vänta en stund."; return; }
      $("f-mail").hidden = true; $("f-code").hidden = false; $("msg2").textContent = ""; $("code").value = ""; $("code").focus();
    }, function () { $("msg1").textContent = "Ingen anslutning."; });
  });
  $("f-code").addEventListener("submit", function (ev) {
    ev.preventDefault(); $("msg2").textContent = "";
    auth("verify", { type: "email", email: mail, token: $("code").value.trim() }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      if (!x.ok || !S.signedIn(x.j)) { $("msg2").textContent = "Fel eller för gammal kod."; return; }
      mail = ""; start();
    }, function () { $("msg2").textContent = "Ingen anslutning."; });
  });
  function logout() { S.logout(); showLogin("Utloggad."); }
  $("logout").addEventListener("click", logout);
  $("reload").addEventListener("click", function () { load(); toast("Hämtar läget…"); });

  /** One call to the function with a fresh token: the parsed answer, or null (and the page says so where it matters). */
  function call(method, query, body, retried) {
    if (DEMO) return fetch("demo-mail.json").then(function (r) { return r.json(); }, function () { return null; }).then(function (j) {
      // the demo's mails by id (a list), or the one mail an older demo file holds
      var id = /mail=(\d+)/.exec(query || ""); if (!Array.isArray(j)) return j;
      return j.filter(function (x) { return id && String(x.id) === id[1]; })[0] || { error: "gone", status: 404 };
    });
    return S.fresh(retried).then(function (x) {
      if (!x.ok) { lost(x.why); return null; }
      var init = { method: method, headers: { Authorization: "Bearer " + x.t, apikey: ANON }, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" };
      if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
      return fetch(FN + (query || ""), init).then(function (r) {
        if (r.status === 401 && !retried) return call(method, query, body, true);
        if (r.status === 401) { S.logout(); showLogin("Logga in igen."); return null; }
        if (r.status === 403) { S.logout(); showLogin("Kontot har inte behörighet."); return null; }
        return r.ok ? r.json() : r.json().then(function (j) { return j && j.error ? { error: j.error, status: r.status } : null; }, function () { return null; });
      }, function () { offline(true); return null; });
    });
  }
  var loading = null, again = false;
  function load() {
    if (DEMO) return fetch("demo.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { data = j; data.demo_now = j.at; render(); });
    if (loading) return loading;
    loading = call("GET", "").then(function (j) {
      loading = null;
      if (!j || j.error) { forceNext = false; again = false; }
      else if (again) { again = false; return load(); }
      if (!j) { if (!data) { clear($("board")).appendChild(el("p", "err", "Läget kunde inte hämtas. Försöker igen.")); } offline(true); return retrySoon(); }
      if (j.error) { offline(true); return retrySoon(); }
      data = j; lastLoad = Date.now(); fails = 0; offline(false); clearTimeout(retryT); render();
    }, function () { loading = null; forceNext = false; again = false; offline(true); retrySoon(); });
    return loading;
  }
  function start() { $("login").hidden = true; $("app").hidden = false; stopTimers(); load(); timer = setInterval(load, TICK); }
  function wake() { if (DEMO || $("app").hidden || document.visibilityState === "hidden") return; if (Date.now() - lastLoad > TICK || S.due()) load(); }
  document.addEventListener("visibilitychange", wake);
  addEventListener("focus", wake);
  addEventListener("pageshow", wake);
  addEventListener("online", function () { if (!$("app").hidden) load(); });
  addEventListener("storage", function (ev) { if (ev.key === S.DEVICE && ev.newValue === null && !$("app").hidden && !DEMO) { S.forget(); showLogin("Utloggad."); } });
  if (DEMO || S.resumable()) start(); else showLogin("");
})();
