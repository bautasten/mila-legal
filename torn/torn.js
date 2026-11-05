// Mila Kontrolltorn (milacoach.app/torn/, round kontrolltorn 2026-11-05): the owner's one page for running Mila. Signs in exactly as the
// driftpanel does (../dash/session.js: Supabase Auth's e-mail OTP, no account created here, the same 30-day session on this device), then
// asks the function `tower` for everything it shows. First what needs the owner today, then the state of things. Everything is drawn
// with the DOM's own text nodes: never markup from strings, no script from anywhere else. Calm: no scores, no red, no blinking numbers;
// a small orange dot marks what waits for the owner. Every number says how old it is when it is not live.
(function () {
  "use strict";
  var SUPABASE = "https://vfjofaniwtudzvadxpsd.supabase.co";
  // the project's public (anon) key, as the app ships it; written in by publish_torn.sh from Secrets.plist (never in git)
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmam9mYW5pd3R1ZHp2YWR4cHNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MDk2NzIsImV4cCI6MjEwNzI4NTY3Mn0.uENQuzKYjhjoy5XUydXC5mz_HmpIIxGCw4exqJxGBnc";
  var FN = SUPABASE + "/functions/v1/tower";
  var DRIFTPANEL = "https://claude.ai/artifact/4jTsoyZDyTfD7aKRTuxN2t";
  var LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var DEMO = LOCAL && /^#demo\b/.test(location.hash);
  var MODULES = [["idag", "I dag"], ["mejl", "Mejl"], ["appen", "Appen"], ["pengar", "Pengar"], ["drift", "Drift"], ["kalender", "Kalender"]];
  var nf = new Intl.NumberFormat("sv-SE"), nf2 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var $ = function (id) { return document.getElementById(id); };
  var data = null, mail = "", timer = null, retryT = null, lastLoad = 0, module = "idag", mailBox = "alla", mailCat = "alla";
  try { var saved = sessionStorage.getItem("mila-torn-module"); if (saved) module = saved; } catch (e) { /* none */ }

  // ---- helpers (text only through textContent)
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function num(x) { var v = Number(x); return isFinite(v) ? v : 0; }
  function has(x) { return x !== null && x !== undefined && x !== "" && isFinite(Number(x)); }
  function f0(x) { return has(x) ? nf.format(Math.round(num(x))) : "–"; }
  function usd(x) { return has(x) ? "$" + nf2.format(num(x)) : "–"; }
  function kr(x) { return has(x) ? nf.format(Math.round(num(x))) + " kr" : "–"; }
  function sum(o) { var s = 0; for (var k in (o || {})) s += num(o[k]); return s; }
  function ago(iso) {
    if (!iso) return "aldrig hämtat";
    var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (!isFinite(m)) return "";
    if (m < 2) return "hämtat nyss"; if (m < 60) return "hämtat för " + m + " min sedan";
    var h = Math.round(m / 60); if (h < 36) return "hämtat för " + h + " h sedan";
    return "hämtat för " + Math.round(h / 24) + " dagar sedan";
  }
  function dayText(d) { try { return new Date(d + "T12:00:00Z").toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" }); } catch (e) { return d; } }
  function longDay(d) { try { return new Date(d + "T12:00:00Z").toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" }); } catch (e) { return d || ""; } }
  function when(iso) { try { return new Date(iso).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; } }
  function card(parent, title, lead, cls) {
    var c = el("section", "card" + (cls ? " " + cls : "")); if (title) c.appendChild(el("h2", null, title)); if (lead) c.appendChild(el("p", "lead", lead)); parent.appendChild(c); return c;
  }
  function age(c, iso) { c.appendChild(el("p", "age", ago(iso))); }
  /** Three equal tiles per row (never a stretched single one: a missing third is left empty space). */
  function tiles(parent, items) {
    var t = el("div", "tiles");
    items.forEach(function (i) { var x = el("div", "tile"); x.appendChild(el("div", "v", i.v)); x.appendChild(el("div", "l", i.l)); if (i.d) x.appendChild(el("div", "d", i.d)); t.appendChild(x); });
    parent.appendChild(t); return t;
  }
  function kv(parent, pairs) {
    var d = el("dl", "kv"); pairs.forEach(function (p) { d.appendChild(el("dt", null, p[0])); d.appendChild(el("dd", null, p[1])); }); parent.appendChild(d); return d;
  }
  function bars(parent, xs, values, label) {
    var max = Math.max.apply(null, values.map(num).concat([0])) || 1;
    var b = el("div", "bars"); b.style.setProperty("--n", String(Math.max(xs.length, 1))); b.setAttribute("role", "img"); b.setAttribute("aria-label", label);
    values.forEach(function (v, i) { var bar = el("i"); bar.style.height = Math.max(1, Math.round(num(v) / max * 100)) + "%"; bar.title = xs[i] + ": " + v; b.appendChild(bar); });
    parent.appendChild(b);
    var x = el("div", "bars-x"); x.appendChild(el("span", null, xs[0] ? dayText(xs[0]) : "")); x.appendChild(el("span", null, xs.length ? dayText(xs[xs.length - 1]) : "")); parent.appendChild(x);
  }
  function link(parent, text, href) { var a = el("a", null, text); a.href = href; a.rel = "noopener"; a.target = "_blank"; parent.appendChild(a); return a; }

  // ---- words for the server's codes
  var KIND = { beslut: "Beslut", lopp: "Loppregistret", mejl: "Mejl", gdpr: "GDPR", support: "Support", kostnad: "Kostnad", frist: "Datum", app: "Appen", moderering: "Granskning", agent: "Agenter" };
  var CAT = { support: "Support", bugg: "Bugg", betalning: "Betalning", gdpr: "GDPR-begäran", partner: "Partner", press: "Press", leverantor: "Apple och leverantörer", juridik: "Juridik", skrap: "Skräp", ovrigt: "Övrigt" };
  var BOX = { alla: "Alla", egen: "Din adress", info: "info@", support: "support@", annan: "Annan" };
  var ASC = { READY_FOR_SALE: "Ute i App Store", WAITING_FOR_REVIEW: "Väntar på granskning", IN_REVIEW: "Granskas nu", PENDING_DEVELOPER_RELEASE: "Godkänd, väntar på dig",
    REJECTED: "Avslag", METADATA_REJECTED: "Avslag på texterna", DEVELOPER_REJECTED: "Tillbakadragen", PREPARE_FOR_SUBMISSION: "Förbereds", READY_FOR_REVIEW: "Redo att skickas in",
    PROCESSING_FOR_APP_STORE: "Bearbetas", PENDING_APPLE_RELEASE: "Släpps av Apple", DEVELOPER_ACTION_NEEDED: "Apple väntar på dig", INVALID_BINARY: "Ogiltigt bygge",
    VALID: "Klart", PROCESSING: "Bearbetas", FAILED: "Misslyckades", INVALID: "Ogiltigt" };
  var PHASED = { ACTIVE: "pågår", PAUSED: "pausad", COMPLETE: "klar", INACTIVE: "inte startad" };

  // ---- the tabs
  function drawTabs() {
    var t = clear($("tabs")), idag = data && data.idag ? data.idag.rows : [];
    MODULES.forEach(function (m) {
      var b = el("button", "tab", m[1]); b.type = "button";
      if (m[0] === module) b.setAttribute("aria-current", "true");
      if (m[0] === "idag" && idag.length) { var d = el("span", "dot"); d.setAttribute("aria-label", "väntar på dig"); b.appendChild(d); }
      b.addEventListener("click", function () { module = m[0]; try { sessionStorage.setItem("mila-torn-module", module); } catch (e) { /* none */ } render(); $("board").focus({ preventScroll: true }); scrollTo(0, 0); });
      t.appendChild(b);
    });
  }
  function go(m) { module = m; try { sessionStorage.setItem("mila-torn-module", module); } catch (e) { /* none */ } render(); scrollTo(0, 0); }

  function render() {
    if (!data) return;
    $("day").textContent = longDay(data.today);
    $("rhythm").textContent = data.rhythm ? data.rhythm.line : "";
    $("asof").textContent = "Läget " + when(data.at) + ". Inget skickas, publiceras eller godkänns utan ditt klick.";
    drawTabs();
    var b = clear($("board"));
    ({ idag: drawToday, mejl: drawMail, appen: drawApp, pengar: drawMoney, drift: drawOps, kalender: drawCalendar }[module] || drawToday)(b);
  }

  // ---- I dag – behöver dig
  function drawToday(b) {
    var t = data.idag || { rows: [], snoozed: 0 }, g = el("div", "grid"); b.appendChild(g);
    var c = card(g, "Behöver dig i dag", t.rows.length ? null : "Inget väntar på dig just nu.");
    var ul = el("ul", "rows");
    t.rows.forEach(function (r) {
      var li = el("li", "row" + (r.urgent ? " urgent" : "")), mark = el("span", "mark");
      if (r.urgent) mark.appendChild(el("span", "dot"));
      li.appendChild(mark);
      var body = el("div");
      body.appendChild(el("div", "label eyebrow", (r.urgent ? "Brådskande · " : "") + (KIND[r.kind] || r.kind)));
      body.appendChild(el("div", "t", r.title));
      if (r.detail) body.appendChild(el("div", "d", r.detail));
      li.appendChild(body);
      var acts = el("div", "acts");
      if (r.approve && r.approve.action === "decision") {
        button(acts, "Ja", "", function () { answer(r, "ja"); });
        button(acts, "Nej", "soft", function () { answer(r, "nej"); });
      } else if (r.approve) {
        button(acts, "Godkänn", "", function () { approve(r, true); });
        button(acts, "Avvisa", "soft", function () { approve(r, false); });
      }
      if (r.open && (r.open.module === "mejl" || MODULES.some(function (m) { return m[0] === r.open.module; }))) {
        button(acts, "Öppna", "soft", function () { if (r.open.module === "mejl" && r.open.id) openMail(r.open.id); else go(r.open.module); });
      }
      if (r.kind !== "beslut") button(acts, "Skjut upp en vecka", "quiet", function () { act("snooze", r.key, { until: plusDays(data.today, 7) }, "Uppskjutet till " + dayText(plusDays(data.today, 7)) + "."); });
      li.appendChild(acts);
      ul.appendChild(li);
    });
    if (t.rows.length) c.appendChild(ul);
    if (t.snoozed) c.appendChild(el("p", "sub", t.snoozed === 1 ? "En sak är uppskjuten." : t.snoozed + " saker är uppskjutna."));
    // the state at a glance, after what needs the owner
    var s = card(g, "Läget", null), asc = data.app && data.app.asc && data.app.asc.data, est = moneyEst();
    tiles(s, [{ v: asc ? (ASC[asc.state] || asc.state || "–") : "–", l: asc ? "Version " + (asc.version || "?") : "App Store", d: asc ? "bygge " + (asc.build || "?") : "inte hämtat" },
      { v: est && est.payers !== null ? f0(est.payers) : "0", l: "Betalande i App Store", d: est && est.mrr_sek ? "≈ " + kr(est.mrr_sek) + "/mån netto" : "inga än" },
      { v: f0(openMailCount()), l: "Mejl att läsa", d: data.mail && data.mail.configured ? "alla tre adresserna" : "mejl inte kopplat än" }]);
  }
  function button(parent, text, cls, fn) { var b = el("button", cls || null, text); b.type = "button"; b.addEventListener("click", fn); parent.appendChild(b); return b; }
  function plusDays(d, n) { return new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10); }
  /** One action: the server does it and logs it; then the page reloads. A refusal is said plainly, never hidden. */
  function act(action, target, args, done) {
    return call("POST", "", { action: action, target: target, args: args || {} }).then(function (x) {
      if (!x || x.error) { toast(x && x.error === "ai_off" ? "AI-utkast är avstängda." : "Det gick inte (" + ((x && x.error) || "ingen anslutning") + ")."); return null; }
      if (done) toast(done);
      load(); return x;
    });
  }
  function approve(r, yes) {
    var what = r.approve.action === "race" ? "race" : "pending";
    if (yes) { if (confirm("Godkänn: " + r.title + "?\nDet blir synligt för alla löpare.")) act(what + "_approve", r.approve.id, {}, "Godkänt."); return; }
    // a rejection removes the proposal: asked twice
    if (confirm("Avvisa: " + r.title + "?") && confirm("Säker? Förslaget tas bort och kan inte tas tillbaka härifrån.")) act(what + "_reject", r.approve.id, { confirmed: true }, "Avvisat.");
  }
  function answer(r, yn) {
    var note = prompt((yn === "ja" ? "Ja till: " : "Nej till: ") + r.title + "\n\nEn rad till den som frågade (valfritt):", "");
    if (note === null) return;
    act("decision_answer", r.approve.id, { answer: yn, note: note.slice(0, 1000) }, yn === "ja" ? "Svarat ja." : "Svarat nej.");
  }
  var toastT = null;
  function toast(text) { var t = $("toast"); t.textContent = text; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 4000); }
  function openMailCount() { return ((data.mail && data.mail.items) || []).filter(function (m) { return m.state === "ny" && m.category !== "skrap"; }).length; }

  // ---- Mejl
  function drawMail(b) {
    var m = data.mail || { items: [], counts: {} }, g = el("div", "grid"); b.appendChild(g);
    var c = card(g, "Mejl", "Din adress, info@ och support@. Sorterat automatiskt; flytta det som hamnat fel.");
    if (!m.configured) {
      c.appendChild(el("p", "note", "Inte kopplat än. När ett appspecifikt lösenord för iCloud ligger i Supabase Secrets (ICLOUD_MAIL_USER och ICLOUD_MAIL_PASSWORD) läses inkorgen var tionde minut, utan att något markeras som läst eller flyttas."));
      return;
    }
    var se = m.sync_error, ok = m.sync;
    if (se && (!ok || Date.parse(se.at) > Date.parse(ok.at))) c.appendChild(el("p", "age", "Senaste läsningen gick inte (" + ((se.data && se.data.error) || "fel") + ") " + when(se.at) + (ok ? " · senast läst " + when(ok.at) : "")));
    else if (ok) c.appendChild(el("p", "age", "Inkorgen lästes " + when(ok.at)));
    var boxes = el("div", "chips");
    ["alla", "support", "info", "egen"].forEach(function (k) {
      var n = k === "alla" ? (m.items || []).length : (m.items || []).filter(function (x) { return x.box === k; }).length;
      var ch = el("button", "chip", BOX[k] + " " + n); ch.type = "button"; ch.setAttribute("aria-pressed", String(mailBox === k));
      ch.addEventListener("click", function () { mailBox = k; render(); }); boxes.appendChild(ch);
    });
    c.appendChild(boxes);
    var cats = el("div", "chips"), present = {};
    (m.items || []).forEach(function (x) { if (mailBox === "alla" || x.box === mailBox) present[x.category] = (present[x.category] || 0) + 1; });
    ["alla"].concat(Object.keys(CAT)).forEach(function (k) {
      if (k !== "alla" && !present[k]) return;
      var ch = el("button", "chip", (k === "alla" ? "Alla" : CAT[k]) + (k === "alla" ? "" : " " + present[k])); ch.type = "button"; ch.setAttribute("aria-pressed", String(mailCat === k));
      ch.addEventListener("click", function () { mailCat = k; render(); }); cats.appendChild(ch);
    });
    c.appendChild(cats);
    var list = (m.items || []).filter(function (x) { return (mailBox === "alla" || x.box === mailBox) && (mailCat === "alla" || x.category === mailCat); });
    // one row per thread: the newest message, with how many there are
    var threads = {}, order = [];
    list.forEach(function (x) { if (!threads[x.thread]) { threads[x.thread] = { top: x, n: 0 }; order.push(x.thread); } threads[x.thread].n++; });
    if (!order.length) { c.appendChild(el("p", "empty", "Inga mejl här.")); return; }
    var ul = el("ul", "rows");
    order.forEach(function (k) {
      var th = threads[k], x = th.top, li = el("li", "row"), mark = el("span", "mark");
      if (x.state === "ny" && x.category !== "skrap") mark.appendChild(el("span", "dot"));
      li.appendChild(mark);
      var o = el("button", "open"); o.type = "button";
      o.appendChild(el("div", "label eyebrow", CAT[x.category] + " · " + BOX[x.box] + (x.sorted_by === "agaren" ? " · flyttad av dig" : "")));
      o.appendChild(el("div", "t", x.subject || "(utan ämne)"));
      o.appendChild(el("div", "d", (x.from_name || x.from_addr || "okänd") + " · " + when(x.received_at) + (th.n > 1 ? " · " + th.n + " i tråden" : "")));
      if (x.category === "gdpr" && x.gdpr_due) o.appendChild(el("div", "d", "Svara senast " + dayText(x.gdpr_due)));
      if (x.snippet) o.appendChild(el("div", "d", x.snippet.replace(/\s+/g, " ").slice(0, 160)));
      o.addEventListener("click", function () { openMail(String(x.id)); });
      li.appendChild(o); ul.appendChild(li);
    });
    c.appendChild(ul);
  }
  function openMail(id) {
    sheet("Mejl", function (body) {
      body.appendChild(el("p", "sub", "Hämtar…"));
      call("GET", "?mail=" + encodeURIComponent(id)).then(function (x) {
        clear(body);
        if (!x || x.error) { body.appendChild(el("p", "err", x && x.status === 404 ? "Mejlet finns inte längre (sparas i 13 månader)." : "Mejlet kunde inte hämtas.")); return; }
        $("sheet-title").textContent = x.subject || "(utan ämne)";
        kv(body, [["Från", (x.from_name ? x.from_name + " " : "") + (x.from_addr ? "<" + x.from_addr + ">" : "")], ["Till", BOX[x.box] || x.box], ["Kom", when(x.received_at)], ["Sorterat", CAT[x.category] || x.category]]
          .concat(x.gdpr_due ? [["Svara senast", dayText(x.gdpr_due)]] : []));
        body.appendChild(el("div", "mailtext", x.body || "(ingen text)"));
        mailTools(body, x);
      });
    });
  }

  /** Under a mail: move it, mark it, and a reply draft that is only ever sent from the owner's own Mail app. */
  function mailTools(body, x) {
    var row = el("div", "chips"), sel = el("select"); sel.setAttribute("aria-label", "Flytta till");
    Object.keys(CAT).forEach(function (k) { var o = el("option", null, CAT[k]); o.value = k; if (k === x.category) o.selected = true; sel.appendChild(o); });
    sel.addEventListener("change", function () { act("mail_category", String(x.id), { category: sel.value }, "Flyttat till " + CAT[sel.value] + "."); });
    var lab = el("label", "sub", "Sortera som "); lab.appendChild(sel); row.appendChild(lab); body.appendChild(row);
    var st = el("div", "acts");
    button(st, "Klar", "soft", function () { act("mail_state", String(x.id), { state: "klar" }, "Markerat klart."); closeSheet(); });
    button(st, "Väntar på svar", "quiet", function () { act("mail_state", String(x.id), { state: "vantar" }, "Markerat väntar."); });
    button(st, "Läst", "quiet", function () { act("mail_state", String(x.id), { state: "last" }, "Markerat läst."); });
    body.appendChild(st);
    if (x.category === "skrap" || !x.from_addr) return;
    body.appendChild(el("h3", null, "Svar"));
    body.appendChild(el("p", "sub", "Ett utkast. Inget skickas härifrån: Öppna i Mail lägger svaret i din egen e-post, och du skickar det själv."));
    var ta = el("textarea"); ta.rows = 9; ta.value = x.draft || ""; ta.setAttribute("aria-label", "Utkast till svar"); body.appendChild(ta);
    var note = el("p", "sub"); body.appendChild(note);
    var a = el("div", "acts");
    if (data.ai && data.ai.on) button(a, "Skriv utkast", "soft", function () {
      note.textContent = "Skriver…";
      call("POST", "", { action: "draft_ai", target: String(x.id) }).then(function (r) {
        if (!r || r.error) { note.textContent = "Utkastet kunde inte skrivas just nu."; return; }
        ta.value = r.draft; note.textContent = r.flagged ? "Obs: utkastet nämner något som aldrig får stå i ett svar. Ändra innan du skickar." : "Utkast skrivet. Läs och ändra.";
      });
    });
    button(a, "Börja med en mall", "quiet", function () { call("POST", "", { action: "draft_start", target: String(x.id) }).then(function (r) { if (r && r.draft && !ta.value) ta.value = r.draft; }); });
    button(a, "Spara utkast", "quiet", function () { act("mail_draft", String(x.id), { draft: ta.value.slice(0, 8000) }, "Utkastet sparat."); });
    button(a, "Öppna i Mail", "", function () {
      if (!ta.value.trim()) { note.textContent = "Skriv något först."; return; }
      if (!confirm("Öppna svaret till " + x.from_addr + " i Mail? Du skickar det själv därifrån.")) return;
      act("mail_draft", String(x.id), { draft: ta.value.slice(0, 8000) });
      act("mail_open_in_mail", String(x.id), {});
      var subj = x.subject && /^re:/i.test(x.subject) ? x.subject : "Re: " + (x.subject || "");
      location.href = "mailto:" + encodeURIComponent(x.from_addr) + "?subject=" + encodeURIComponent(subj.slice(0, 200)) + "&body=" + encodeURIComponent(ta.value.slice(0, 1800));
    });
    body.appendChild(a);
  }

  // ---- Kalender och utgångsdatum (varnar 30, 7 och 1 dag före)
  var LEVEL = { passerad: "Passerat", "1": "I dag eller i morgon", "7": "Inom en vecka", "30": "Inom en månad" };
  var DKIND = { apple: "Apple", doman: "Domän", nyckel: "Nyckel", partner: "Partner", juridik: "Juridik", skatt: "Skatt", release: "Release", ovrigt: "Övrigt" };
  function drawCalendar(b) {
    var g = el("div", "grid two"); b.appendChild(g);
    var c = card(g, "Datum att hålla koll på", "Du får en påminnelse 30, 7 och 1 dag före.", "span");
    var list = data.deadlines || [];
    if (!list.length) c.appendChild(el("p", "empty", "Inga datum inlagda."));
    var ul = el("ul", "rows");
    list.forEach(function (d) {
      var li = el("li", "row"), mark = el("span", "mark"); if (d.level === "1" || d.level === "passerad") mark.appendChild(el("span", "dot")); li.appendChild(mark);
      var body = el("div");
      body.appendChild(el("div", "label eyebrow", (DKIND[d.kind] || d.kind) + (d.level ? " · " + LEVEL[d.level] : "")));
      body.appendChild(el("div", "t", d.title));
      body.appendChild(el("div", "d", dayText(d.due) + (d.note ? " · " + d.note : "") + (d.source === "insamlare" ? " · från App Store Connect" : "")));
      li.appendChild(body);
      if (typeof d.id === "number") { var a = el("div", "acts"); button(a, "Klar", "quiet", function () { act("deadline_done", String(d.id), {}, "Markerat klart."); }); li.appendChild(a); }
      ul.appendChild(li);
    });
    c.appendChild(ul);
    var f = card(g, "Lägg till ett datum", null), form = el("form", "form");
    var ti = el("input"); ti.placeholder = "Vad"; ti.maxLength = 200; ti.required = true; ti.setAttribute("aria-label", "Vad");
    var du = el("input"); du.type = "date"; du.required = true; du.setAttribute("aria-label", "Datum");
    var kd = el("select"); kd.setAttribute("aria-label", "Typ"); Object.keys(DKIND).forEach(function (k) { var o = el("option", null, DKIND[k]); o.value = k; kd.appendChild(o); });
    var no = el("input"); no.placeholder = "Anteckning (valfritt)"; no.maxLength = 1000; no.setAttribute("aria-label", "Anteckning");
    var sb = el("button", null, "Lägg till"); sb.type = "submit";
    [ti, du, kd, no, sb].forEach(function (x) { form.appendChild(x); });
    form.addEventListener("submit", function (ev) { ev.preventDefault(); act("deadline_add", null, { title: ti.value.trim(), due: du.value, kind: kd.value, note: no.value.trim() }, "Datumet är inlagt."); });
    f.appendChild(form);
    var n = card(g, "Notiser", "Högst en sammanfattning på morgonen, och bara när något väntar. Direkt bara när det är akut. Allt går till din egen e-post.");
    var NAMES = { morgon: "Morgonsammanfattning", nere: "Webbplatsen svarar inte", kostnadsparr: "Kostnadsspärren slår till", avslag: "Avslag i App Review", gdpr_frist: "GDPR-frist inom 3 dagar", sakerhet: "Säkerhetshändelse (ingen källa kopplad än)" };
    var OFF = { morgon: "Av: du ser läget bara när du öppnar tornet.", nere: "Av: du märker det först när du öppnar tornet.", kostnadsparr: "Av: spärren skyddar ändå, men du får inte veta det direkt.", avslag: "Av: du ser avslaget i tornet och i Apples eget mejl.", gdpr_frist: "Av: fristen syns bara i I dag.", sakerhet: "Av: inget skickas." };
    Object.keys(NAMES).forEach(function (k) {
      var on = (data.notify || {})[k] !== false, row = el("label", "switch");
      var cb = el("input"); cb.type = "checkbox"; cb.checked = on;
      cb.addEventListener("change", function () { act("notify_set", k, { on: cb.checked }, NAMES[k] + (cb.checked ? ": på." : ": av. " + OFF[k])); });
      row.appendChild(cb); row.appendChild(el("span", null, NAMES[k])); n.appendChild(row);
    });
    var dq = (data.decisions && data.decisions.answered) || [];
    if (dq.length) {
      var h = card(g, "Senaste besluten", null);
      kv(h, dq.slice(0, 8).map(function (x) { return [x.title, (x.answer === "ja" ? "Ja" : "Nej") + " · " + when(x.answered_at)]; }));
    }
    var lg = card(g, "Loggen", "Det senaste du gjort härifrån.");
    if (!(data.audit || []).length) lg.appendChild(el("p", "empty", "Inget än."));
    else kv(lg, data.audit.slice(0, 12).map(function (x) { return [x.action + (x.target ? " · " + x.target : ""), when(x.at)]; }));
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
      age(c, f.at);
    }
    var r = card(g, "Releaserytm", data.rhythm ? data.rhythm.line : null);
    if (data.rhythm) kv(r, [["Nästa inskick", dayText(data.rhythm.nextSubmit)], ["Nästa fasade lansering", dayText(data.rhythm.nextRelease)], ["Aldrig", "fredag"]]);
    var t = card(g, "TestFlight", null, "span");
    if (!a || !a.builds || !a.builds.length) t.appendChild(el("p", "empty", "Inga byggen hämtade."));
    else {
      var ul = el("ul", "rows");
      a.builds.forEach(function (x) {
        var li = el("li", "row"); li.appendChild(el("span", "mark")); var d = el("div");
        d.appendChild(el("div", "t", "Bygge " + x.n + " · " + (ASC[x.state] || x.state || "")));
        d.appendChild(el("div", "d", (x.groups && x.groups.length ? x.groups.join(", ") : "inga grupper") + (x.at ? " · uppladdat " + when(x.at) : "")));
        li.appendChild(d); ul.appendChild(li);
      });
      t.appendChild(ul);
    }
    var rv = card(g, "Recensioner", null, "span");
    var list = a && a.reviews ? a.reviews : [];
    if (!list.length) rv.appendChild(el("p", "empty", a ? "Inga skrivna recensioner än." : "Inte hämtat."));
    else {
      var ul2 = el("ul", "rows");
      list.forEach(function (x) {
        var li = el("li", "row"); li.appendChild(el("span", "mark")); var d = el("div");
        d.appendChild(el("div", "t", x.rating + " av 5 · " + (x.title || "")));
        d.appendChild(el("div", "d", (x.body || "").slice(0, 400)));
        d.appendChild(el("div", "d", (x.territory || "") + " · " + (x.at ? when(x.at) : "") + (x.replied ? " · besvarad" : "")));
        li.appendChild(d); ul2.appendChild(li);
      });
      rv.appendChild(ul2);
    }
    var k = card(g, "Krascher", null, "span");
    k.appendChild(el("p", "empty", a && a.crashes !== undefined && a.crashes !== null ? f0(a.crashes) + " kraschrapporter från TestFlight senaste 7 dagarna." : "Mäts inte här än: App Store Connects kraschloggar finns i Xcode Organizer."));
  }

  // ---- Pengar
  function moneyEst() { var d = data.money && data.money.dash; return d && d.envs && d.envs.as ? d.envs.as.est : null; }
  function drawMoney(b) {
    var m = data.money || {}, d = m.dash || {}, as = (d.envs && d.envs.as) || {}, tf = (d.envs && d.envs.tf) || {}, est = as.est || {}, mon = as.money || {}, g = el("div", "grid two"); b.appendChild(g);
    var c = card(g, "Prenumerationer i App Store", "Uppskattningar: listpris minus moms och Apples 15 %, inte Apples utbetalning.");
    tiles(c, [{ v: f0(est.payers || 0), l: "Betalande", d: "månad " + f0((mon.by_plan || {})["as:monthly"] || 0) + " · år " + f0(((mon.by_plan || {})["as:yearly"] || 0) + ((mon.by_plan || {})["as:other"] || 0)) },
      { v: f0(sum(mon.trial)), l: "I provperiod" }, { v: est.mrr_sek ? kr(est.mrr_sek) : "0 kr", l: "≈ MRR netto", d: "159 kr/mån · 1 290 kr/år" }]);
    tiles(c, [{ v: mon.cohort_trials ? Math.round(num(mon.cohort_converted) / num(mon.cohort_trials) * 100) + " %" : "–", l: "Blev betalande", d: mon.cohort_trials ? f0(mon.cohort_converted) + " av " + f0(mon.cohort_trials) : "inga provperioder än" },
      { v: f0(mon.ended_30d), l: "Avslutade, 30 d" }, { v: f0(mon.refunded_30d), l: "Återbetalda, 30 d" }]);
    if (tf.money) c.appendChild(el("p", "sub", "TestFlight (sandlåda, inga pengar): " + f0(sum(tf.money.active)) + " aktiva köp."));
    var s = m.sales && m.sales.data;
    if (s) { kv(c, [["Apples försäljningsrapport, 7 d", s.units7 !== undefined ? f0(s.units7) + " enheter" : "–"], ["Senaste utbetalning", s.payout ? s.payout : "ingen än"]]); age(c, m.sales.at); }
    else c.appendChild(el("p", "sub", "Apples försäljningsrapporter och utbetalningar: inte hämtade än."));
    var ai = (d.common && d.common.ai) || {}, daily = (ai.daily || []).slice(-30);
    var a = card(g, "AI-kostnad", "Per dag, alla konton. Spärren är $2 per konto och dag.");
    var cr = as.cost_runner && as.cost_runner.users ? as.cost_runner : tf.cost_runner;
    var last7 = daily.slice(-7).reduce(function (s, x) { return s + num(x.usd); }, 0);
    tiles(a, [{ v: usd(daily.length ? daily[daily.length - 1].usd : null), l: "I dag hittills" }, { v: usd(last7), l: "Senaste 7 dagarna" },
      { v: cr ? usd(cr.max) : "–", l: "Dyraste konto, 24 h", d: cr ? "median " + usd(cr.median) + " · av $2" : null }]);
    bars(a, daily.map(function (x) { return x.d; }), daily.map(function (x) { return x.usd; }), "AI-kostnad per dag i dollar");
    var fx = card(g, "Fasta kostnader", null);
    if (!(m.fixed || []).length) fx.appendChild(el("p", "empty", "Inga fasta kostnader inlagda än (Supabase, Resend, domän, Apple Developer, GitHub)."));
    else { kv(fx, (m.fixed || []).map(function (x) { return [x.name, (x.currency === "SEK" ? kr(x.amount) : x.currency + " " + nf2.format(num(x.amount))) + (x.per === "ar" ? "/år" : "/mån")]; })); fx.appendChild(el("p", "sub", "≈ " + kr(m.fixed_month_sek) + " i månaden.")); }
    var cf = el("form", "form"), cn = el("input"), ca = el("input"), cc = el("select"), cp = el("select"), cs = el("button", null, "Spara kostnad");
    cn.placeholder = "Namn, t.ex. Supabase"; cn.maxLength = 80; cn.required = true; cn.setAttribute("aria-label", "Namn");
    ca.placeholder = "Belopp"; ca.inputMode = "decimal"; ca.required = true; ca.setAttribute("aria-label", "Belopp");
    ["SEK", "USD", "EUR"].forEach(function (k) { var o = el("option", null, k); o.value = k; cc.appendChild(o); }); cc.setAttribute("aria-label", "Valuta");
    [["manad", "per månad"], ["ar", "per år"]].forEach(function (k) { var o = el("option", null, k[1]); o.value = k[0]; cp.appendChild(o); }); cp.setAttribute("aria-label", "Period");
    cs.type = "submit"; [cn, ca, cc, cp, cs].forEach(function (x) { cf.appendChild(x); });
    cf.addEventListener("submit", function (ev) { ev.preventDefault(); act("cost_set", cn.value.trim(), { amount: ca.value.replace(",", ".").replace(/\s/g, ""), currency: cc.value, per: cp.value }, "Kostnaden är sparad."); });
    fx.appendChild(cf);
    var mg = card(g, "Marginal per betalande", null);
    tiles(mg, [{ v: est.rev_per_payer_sek ? kr(est.rev_per_payer_sek) : "–", l: "Intäkt/mån netto" }, { v: has(est.ai_sek_per_runner_month) ? kr(est.ai_sek_per_runner_month) : "–", l: "AI per löpare/mån", d: "från senaste dygnet × 30" },
      { v: has(est.margin_per_payer_sek) ? kr(est.margin_per_payer_sek) : "–", l: "Kvar per betalande" }]);
    mg.appendChild(el("p", "sub", "Inga prognoser: siffrorna är dagens läge, inte en spaning framåt."));
  }

  // ---- Drift
  function drawOps(b) {
    var o = data.ops || {}, d = (data.money && data.money.dash) || {}, cm = d.common || {}, g = el("div", "grid two"); b.appendChild(g);
    var ag = card(g, "Agenter och byggen", null), a = o.agents && o.agents.data;
    if (!a) ag.appendChild(el("p", "empty", "Inte hämtat (insamlaren på Macen)."));
    else {
      kv(ag, [["Slutprov pågår (release.focus)", a.focus ? "ja – inga byggen vid sidan av" : "nej"], ["Väntar på något", a.blocked ? a.blocked : "nej"], ["Platser", a.slots || "–"]]);
      age(ag, o.agents.at);
    }
    var gate = o.gate && (o.gate.runs || o.gate);
    var gr = card(g, "CI-grinden", null);
    var runs = Array.isArray(gate) ? gate : (gate && Array.isArray(gate.runs) ? gate.runs : []);
    if (!runs.length) gr.appendChild(el("p", "empty", "Inga körningar registrerade."));
    else { var r0 = runs[0]; kv(gr, [["Senaste", (r0.status || "?") + (r0.step ? " · " + r0.step : "")], ["Gren", r0.branch || "–"], ["Start", r0.started_at ? when(r0.started_at) : "–"]]); }
    var sy = card(g, "Server", null);
    kv(sy, [["Senaste migrering", cm.migration || "–"], ["Morgonrapport mejlad", cm.report_sent ? when(cm.report_sent) : "–"], ["Larm, 30 d", f0(sum(cm.alerts_30d))],
      ["Kostnadsspärr, 2 d", (o.alerts_2d || []).length ? (o.alerts_2d || []).map(function (x) { return (x.kind === "tokens" ? "dagsspärr för ett konto" : "appens AI-tak 80 %") + " " + dayText(x.day); }).join(", ") : "ingen"],
      ["Anmälningar att granska", has(o.moderation) ? f0(o.moderation) : "–"], ["Önskemål öppna", has(o.wishes) ? f0(o.wishes) : "–"]]);
    var st = card(g, "Webbplatsen", null), site = o.site && o.site.data;
    if (!site) st.appendChild(el("p", "empty", "Inte kontrollerad än."));
    else { kv(st, (site.checks || []).map(function (x) { return [x.name, x.ok ? "svarar" : "svarar inte (" + (x.status || "fel") + ")"]; })); age(st, o.site.at); }
    var it = card(g, "Integrationer", null);
    kv(it, [["Suunto", "godkänd – byggs i bygge 32"], ["Garmin", "ansökt 30 okt, väntar"], ["Polar", "kopplad; fråga om strukturerade pass, följ upp ~15 nov"], ["COROS", "bara via Apple Hälsa"]]);
    var l = card(g, "Fler siffror", null);
    var p = el("p", "note"); p.appendChild(document.createTextNode("Driftpanelen med alla grafer finns kvar: "));
    link(p, "milacoach.app/dash", "../dash/"); p.appendChild(document.createTextNode(" och ")); link(p, "panelen på claude.ai", DRIFTPANEL); p.appendChild(document.createTextNode("."));
    l.appendChild(p);
  }

  // ---- the sheet
  var lastFocus = null;
  function sheet(title, fill) {
    lastFocus = document.activeElement; $("sheet-title").textContent = title; var body = clear($("sheet-body")); $("sheet").hidden = false; fill(body); $("sheet-close").focus();
  }
  function closeSheet() { $("sheet").hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  $("sheet-close").addEventListener("click", closeSheet);
  $("sheet").addEventListener("click", function (ev) { if (ev.target === $("sheet")) closeSheet(); });
  addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !$("sheet").hidden) closeSheet(); });

  // ---- sign-in and the session (the driftpanel's session.js; the same device key, so one sign-in covers both pages)
  var S = MilaDashSession({ url: SUPABASE, anon: ANON, fetch: function (u, i) { return fetch(u, i); }, locks: navigator.locks });
  var TICK = 120e3, RETRY = [15e3, 30e3, 60e3, 120e3], fails = 0;
  function auth(path, body) {
    return fetch(SUPABASE + "/auth/v1/" + path, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit", referrerPolicy: "no-referrer" });
  }
  function offline(on) { $("offline").hidden = !on; }
  function stopTimers() { clearInterval(timer); clearTimeout(retryT); timer = retryT = null; }
  function showLogin(msg) {
    stopTimers(); offline(false); data = null; $("app").hidden = true; $("login").hidden = false; $("f-mail").hidden = false; $("f-code").hidden = true;
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
  $("logout").addEventListener("click", function () { S.logout(); showLogin("Utloggad."); });
  $("reload").addEventListener("click", function () { load(); });

  /** One call to the function with a fresh token: the parsed answer, or null (and the page says so where it matters). */
  function call(method, query, body, retried) {
    if (DEMO) return fetch("demo-mail.json").then(function (r) { return r.json(); }, function () { return null; });
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
  var loading = null;
  function load() {
    if (DEMO) return fetch("demo.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { data = j; data.at = new Date().toISOString(); render(); });
    if (loading) return loading;
    loading = call("GET", "").then(function (j) {
      loading = null;
      if (!j) { if (!data) { clear($("board")).appendChild(el("p", "err", "Läget kunde inte hämtas. Försöker igen.")); } offline(true); return retrySoon(); }
      if (j.error) { offline(true); return retrySoon(); }
      data = j; lastLoad = Date.now(); fails = 0; offline(false); clearTimeout(retryT); render();
    }, function () { loading = null; offline(true); retrySoon(); });
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
