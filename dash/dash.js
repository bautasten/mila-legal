// Driftpanelen (milacoach.app/dash/): Mila's numbers for the admins only. Sign-in with a code by e-mail (Supabase Auth's e-mail OTP; no
// account is ever created here), the session's access token kept in this tab only (sessionStorage, gone with the tab, an hour at most;
// no refresh token is kept), then the function `dashboard` answers aggregates only (_shared/dashboard.ts). Everything is drawn with the
// DOM's own text nodes and hand-made SVG: never markup from strings, no script from anywhere else. Four tabs (dash-flikar): Produktion,
// TestFlight, Morgonrapport and Övrigt; the last one chosen is remembered in this tab only (sessionStorage), the mail's link (#dag=) opens
// the Morgonrapport.
(function () {
  "use strict";
  var SUPABASE = "https://vfjofaniwtudzvadxpsd.supabase.co";
  // the project's public (anon) key, as the app ships it; written in by publish_legal.sh from Secrets.plist (never in git)
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmam9mYW5pd3R1ZHp2YWR4cHNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MDk2NzIsImV4cCI6MjEwNzI4NTY3Mn0.uENQuzKYjhjoy5XUydXC5mz_HmpIIxGCw4exqJxGBnc";
  var FN = SUPABASE + "/functions/v1/dashboard";
  var STORE = "mila-dash-session";
  var LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var DEMO = LOCAL && /^#demo\b/.test(location.hash);
  var SVGNS = "http://www.w3.org/2000/svg";
  var ENVS = [["as", "App Store", "--s1"], ["tf", "TestFlight", "--s2"], ["gr", "Granskning", "--s3"], ["okand", "Okänd", "--s4"]];
  var nf = new Intl.NumberFormat("sv-SE"), nf1 = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 }), nf2 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var $ = function (id) { return document.getElementById(id); };
  var data = null, mail = "", timer = null, chosenDay = null, cardW = 600;

  // ---- small helpers (text only through textContent)
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  function sv(tag, attrs) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function num(x) { var v = Number(x); return isFinite(v) ? v : 0; }
  function has(x) { return x !== null && x !== undefined && isFinite(Number(x)); }
  function f0(x) { return has(x) ? nf.format(Math.round(num(x))) : "–"; }
  function f1(x) { return has(x) ? nf1.format(num(x)) : "–"; }
  function usd(x) { return has(x) ? "$" + nf2.format(num(x)) : "–"; }
  function pct(x) { return has(x) ? nf.format(Math.round(num(x) * 100)) + " %" : "–"; }
  function kr(x) { return has(x) ? nf.format(Math.round(num(x))) + " kr" : "–"; }
  function sum(o) { var s = 0; for (var k in (o || {})) s += num(o[k]); return s; }
  function envColor(e) { for (var i = 0; i < ENVS.length; i++) if (ENVS[i][0] === e) return css(ENVS[i][2]); return css("--s4"); }
  function short(d) { return typeof d === "string" && d.length === 10 ? d.slice(8, 10) + "/" + String(Number(d.slice(5, 7))) : String(d); }
  function ratio(a, b) { return num(b) > 0 ? num(a) / num(b) : null; }

  // ---- the tooltip
  var tip = $("tip");
  function showTip(ev, head, rows) {
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    tip.appendChild(el("div", "h", head));
    rows.forEach(function (r) {
      var row = el("div", "r"), name = el("span");
      if (r.color) { var i = el("i"); i.style.background = r.color; name.appendChild(i); }
      name.appendChild(document.createTextNode(r.label));
      row.appendChild(name); row.appendChild(el("b", null, r.value)); tip.appendChild(row);
    });
    tip.hidden = false;
    var x = ev.clientX + 14, y = ev.clientY + 14, w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { tip.hidden = true; }

  // ---- charts (hand-made SVG; thin marks, one axis, hairline grid, a crosshair with every series)
  function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  /** Columns per x (stacked when several series) or lines; series: [{label, color, values[]}]. */
  function chart(xs, series, o) {
    o = o || {};
    var W = Math.max(240, cardW), H = o.h || 150, L = 34, R = 8, T = 8, B = 20, pw = W - L - R, ph = H - T - B;
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "chart", role: "img", "aria-label": o.label || "" });
    var max = 0;
    xs.forEach(function (_, i) {
      if (o.kind === "line") series.forEach(function (s) { max = Math.max(max, num(s.values[i])); });
      else max = Math.max(max, series.reduce(function (a, s) { return a + num(s.values[i]); }, 0));
    });
    max = o.max || niceMax(max);
    var y = function (v) { return T + ph - (v / max) * ph; }, step = pw / Math.max(xs.length, 1);
    for (var g = 0; g <= 4; g++) {
      var gv = max * g / 4, gy = y(gv);
      svg.appendChild(sv("line", { x1: L, x2: W - R, y1: gy, y2: gy, class: g === 0 ? "base" : "grid" }));
      var t = sv("text", { x: L - 5, y: gy + 3.5, "text-anchor": "end" }); t.textContent = o.fmt ? o.fmt(gv, true) : (max < 4 ? f1(gv) : f0(gv)); svg.appendChild(t);
    }
    var every = Math.ceil(xs.length / 10);
    xs.forEach(function (x, i) {
      if (i % every !== 0 && i !== xs.length - 1) return;
      var t = sv("text", { x: L + step * i + step / 2, y: H - 5, "text-anchor": "middle" }); t.textContent = o.xfmt ? o.xfmt(x) : short(x); svg.appendChild(t);
    });
    if (o.kind === "line") {
      series.forEach(function (s) {
        var d = xs.map(function (_, i) { return (i ? "L" : "M") + (L + step * i + step / 2).toFixed(1) + " " + y(num(s.values[i])).toFixed(1); }).join(" ");
        svg.appendChild(sv("path", { d: d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        var li = xs.length - 1;
        if (li >= 0) svg.appendChild(sv("circle", { cx: L + step * li + step / 2, cy: y(num(s.values[li])), r: 4, fill: s.color, stroke: css("--surface"), "stroke-width": 2 }));
      });
    } else {
      var bw = Math.min(24, Math.max(2, step - 2));
      xs.forEach(function (_, i) {
        var base = 0, cx = L + step * i + (step - bw) / 2, segs = series.filter(function (s) { return num(s.values[i]) > 0; });
        segs.forEach(function (s, j) {
          var v = num(s.values[i]), y0 = y(base), y1 = y(base + v), top = j === segs.length - 1, h = Math.max(0, y0 - y1 - (j ? 2 : 0));
          var r = top ? Math.min(4, bw / 2, h) : 0;
          var p = "M" + cx + " " + (y0 - (j ? 2 : 0)) + "V" + (y1 + r) + (r ? "Q" + cx + " " + y1 + " " + (cx + r) + " " + y1 : "") + "H" + (cx + bw - r) + (r ? "Q" + (cx + bw) + " " + y1 + " " + (cx + bw) + " " + (y1 + r) : "") + "V" + (y0 - (j ? 2 : 0)) + "Z";
          svg.appendChild(sv("path", { d: p, fill: s.color, class: "bar" }));
          base += v;
        });
      });
    }
    // the crosshair: the nearest x, every series' value
    var hair = sv("line", { y1: T, y2: T + ph, class: "hair", visibility: "hidden" }); svg.appendChild(hair);
    var hit = sv("rect", { x: L, y: T, width: pw, height: ph, class: "hit" }); svg.appendChild(hit);
    hit.addEventListener("pointermove", function (ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width, i = Math.max(0, Math.min(xs.length - 1, Math.floor((px - L) / step)));
      var hx = L + step * i + step / 2; hair.setAttribute("x1", hx); hair.setAttribute("x2", hx); hair.setAttribute("visibility", "visible");
      var rows = series.map(function (s) { return { label: s.label, color: s.color, value: o.fmt ? o.fmt(num(s.values[i])) : f1(s.values[i]) }; });
      if (series.length > 1 && o.kind !== "line") rows.push({ label: "Totalt", value: o.fmt ? o.fmt(series.reduce(function (a, s) { return a + num(s.values[i]); }, 0)) : f1(series.reduce(function (a, s) { return a + num(s.values[i]); }, 0)) });
      showTip(ev, o.xfmt ? o.xfmt(xs[i]) : String(xs[i]), rows);
    });
    hit.addEventListener("pointerleave", function () { hair.setAttribute("visibility", "hidden"); hideTip(); });
    return svg;
  }
  /** Horizontal bars, largest first: [{label, value, note}]. */
  function hbars(items, o) {
    o = o || {};
    items = items.filter(function (x) { return num(x.value) > 0; }).sort(function (a, b) { return num(b.value) - num(a.value); }).slice(0, o.top || 10);
    if (!items.length) return el("p", "empty", "Inget än.");
    var W = Math.max(240, cardW), row = 18, LW = o.lw || 130, H = items.length * row + 2, max = niceMax(num(items[0].value));
    var reserve = 16 + 6 * Math.max.apply(null, items.map(function (it) { return ((o.fmt ? o.fmt(it.value) : f0(it.value)) + (it.note ? " · " + it.note : "")).length; }));
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "chart", role: "img", "aria-label": o.label || "" });
    items.forEach(function (it, i) {
      var yy = i * row + 3, w = Math.max(2, (num(it.value) / max) * (W - LW - reserve));
      var t = sv("text", { x: LW - 6, y: yy + 11, "text-anchor": "end" }); t.textContent = it.label; svg.appendChild(t);
      svg.appendChild(sv("path", { d: "M" + LW + " " + yy + "H" + (LW + w - 4) + "Q" + (LW + w) + " " + yy + " " + (LW + w) + " " + (yy + 4) + "V" + (yy + 10) + "Q" + (LW + w) + " " + (yy + 14) + " " + (LW + w - 4) + " " + (yy + 14) + "H" + LW + "Z", fill: o.color || css("--s1"), class: "bar" }));
      var v = sv("text", { x: LW + w + 6, y: yy + 11 }); v.textContent = (o.fmt ? o.fmt(it.value) : f0(it.value)) + (it.note ? " · " + it.note : ""); svg.appendChild(v);
      var hit = sv("rect", { x: 0, y: yy - 3, width: W, height: row, class: "hit" }); svg.appendChild(hit);
      hit.addEventListener("pointermove", function (ev) { showTip(ev, it.label, [{ label: o.unit || "Antal", value: o.fmt ? o.fmt(it.value) : f0(it.value) }].concat(it.note ? [{ label: "", value: it.note }] : [])); });
      hit.addEventListener("pointerleave", hideTip);
    });
    return svg;
  }
  function legend(series, line) {
    var l = el("div", "legend");
    series.forEach(function (s) { var k = el("span", "key"), sw = el("span", line ? "ln" : "sw"); sw.style.background = s.color; k.appendChild(sw); k.appendChild(document.createTextNode(s.label)); l.appendChild(k); });
    return l;
  }
  function envSeries(days, key) {
    return ENVS.map(function (e) { return { label: e[1], color: css(e[2]), values: days.map(function (d) { return num((d[key] || {})[e[0]]); }) }; })
      .filter(function (s) { return s.values.some(function (v) { return v > 0; }); });
  }

  // ---- cards
  var board;
  function card(title, tag, w) {
    var c = el("section", "card" + (w ? " w" + w : "")), h = el("h2");
    h.appendChild(el("span", null, title)); if (tag) h.appendChild(el("span", "tag", tag));
    c.appendChild(h); board.appendChild(c); cardW = c.clientWidth - 30; return c;
  }
  function tiles(parent, list) {
    var t = el("div", "tiles");
    list.forEach(function (x) {
      var d = el("div", "tile"); d.title = x.title || "";
      d.appendChild(el("div", "v", x.v)); d.appendChild(el("div", "l", x.l));
      if (x.d) d.appendChild(el("div", "d" + (x.dir ? " " + x.dir : ""), x.d));
      t.appendChild(d);
    });
    parent.appendChild(t); return t;
  }
  function note(parent, text) { parent.appendChild(el("p", "note", text)); }
  function missing(parent) { parent.appendChild(el("p", "empty", "Kunde inte hämtas just nu.")); }
  function envSplit(o) { return ENVS.filter(function (e) { return num((o || {})[e[0]]) > 0; }).map(function (e) { return e[1] + " " + f0(o[e[0]]); }).join(" · ") || "inga"; }
  function table(parent, head, rows) {
    var t = el("table", "t"), tr = el("tr");
    head.forEach(function (h) { tr.appendChild(el("th", null, h)); }); t.appendChild(tr);
    rows.forEach(function (r) { var row = el("tr"); r.forEach(function (c) { var td = el("td", c && c.cls ? c.cls : null, c && typeof c === "object" ? c.t : c); if (c && c.bg) td.style.background = c.bg; row.appendChild(td); }); t.appendChild(row); });
    var wrap = el("div", "tw"); wrap.appendChild(t); parent.appendChild(wrap);
  }

  // the names of the server's own vocabulary, in plain Swedish where the page shows them
  var NAMES = {
    daily: "Dagens pass", review: "Veckogenomgång", plan: "Veckoplan", challenge: "Utmaning", gait: "Löpsteg", support: "Support", raceplan: "Loppplan",
    racereadiness: "Loppberedskap", patterns: "Mönster", year: "Året", shoelife: "Skoliv", racepicks: "Loppförslag", mealplan: "Matplan", recipe: "Recept",
    recipesaved: "Sparade recept", meal: "Måltid", runpair: "Duo: passpar", dailyprerun: "Duo: före passet", racejourney: "Loppresan", followq: "Följdfrågor",
    workout: "Pass", race: "Lopp", show: "Visa för någon", moment_shoe: "Sko", moment_milestone: "Milstolpe", moment_record: "Bästa insats", moment_mountain: "VO₂max-berget",
    moment_group: "Gruppmål", moment_journey: "Din resa", shopping: "Inköpslista", invite_buddy: "Kompisinbjudan", invite_group: "Gruppinbjudan", racepage: "Loppsida",
    year_link: "Årslänk", dish: "Rätt", year_food: "Årets favoriter", heatmap: "Värmekarta",
    en_mila: "En mil – en Mila", pi: "π-löparen", stjarnfall: "Stjärnfall", soluppgang: "Soluppgång", nyar: "Årets första km", logo: "Solen över fjällen", pheidippides: "Pheidippides",
    polar: "Polar", file: "Fil", manual: "Manuellt", strava: "Strava", coros: "COROS",
    sick: "Sjuk", injured: "Skadad", travel: "Resa", busy: "Upptagen", recovered: "Frisk igen", other: "Annat",
    unchanged: "Oförändrade", corrected: "Rättade", rejected: "Stoppade", error: "Utan svar",
    heavy: "Konton som drar mycket", tokens: "Nära tokenbudgeten", cap80: "AI-taket 80 %", support_form_cap: "Formulärets tak", support_reserved_cap: "Reserverat tak",
    support_mail_cap: "Supportmejlens tak", support_reserved_mail: "Reserverade mejl", billing_iap_key: "Betalning: nyckel", billing_iap_auth: "Betalning: inloggning", billing_notify_sig: "Betalning: signatur",
    production: "Produktion", development: "Utveckling", queued: "I kö", submitting: "Skickas", submitted: "Skickade", collecting: "Hämtas", done: "Klara", failed: "Misslyckade",
    new: "Nya", skipped: "Hoppade över", pending: "Väntar", course: "Bana", url: "Länk", asking: "Frågar", open: "Öppna",
    health: "Hälsodata", ai: "Coachen", social: "Kompisregler", okand: "Okänd", "övriga": "Övriga"
  };
  var nm = function (k) { return NAMES[k] || String(k).replace(/_/g, " "); };
  var MARKS = [["onb_health", "Apple Hälsa"], ["onb_sources", "Klockor och appar"], ["onb_consent", "Godkänna coachen"], ["onb_profile", "Berätta om dig"],
    ["onb_paywall", "Erbjudandet"], ["onb_loading", "Väntan på första veckan"], ["onb_done", "Introduktionen klar"], ["start_trial", "Gratisvecka"], ["start_paid", "Betalt direkt"],
    ["back_d2", "Tillbaka dag 2"], ["back_d7", "Tillbaka dag 7"], ["converted", "Betalande efter gratisveckan"]];
  var NOT_MEASURED = { watch_sends: "pass skickade till klockan", lock_screen_taps: "knapptryck på låsskärmen", results_views: "visningar av Mina resultat", duo_device_use: "Duo-skärmens användning",
    call_latency: "svarstid för direkta coachanrop", push_failures: "misslyckade pushnotiser", function_errors: "fel i funktionerna (bara larmen syns)", auto_renew_off: "avstängd förnyelse",
    installs: "installationer (finns i App Store Connect)", eval_runs: "busfröets utvärdering (körs lokalt)", deploys: "senaste driftsättningar" };

  // ---- the tabs (dash-flikar, Patrik 2026-10-19): Produktion (the App Store's runners), TestFlight (the testers'), Morgonrapport (the
  // daily report, both builds side by side) and Övrigt (App Review's likely accounts and the unknown build). Every per-runner number on a
  // tab is that tab's builds' only (the server asks per build); what has no runner behind it is shown once per tab under "Gemensamt".
  var TABS = [["as", "Produktion", "App Store"], ["tf", "TestFlight", "TestFlight"], ["rapport", "Morgonrapport", ""], ["ovr", "Övrigt", "Granskning och okänd"]];
  var TABKEY = "mila-dash-tab";
  function tabColor(t) { return css(t === "tf" ? "--s2" : t === "ovr" ? "--s4" : "--s1"); }
  function savedTab() { try { var t = sessionStorage.getItem(TABKEY); return TABS.some(function (x) { return x[0] === t; }) ? t : null; } catch (e) { return null; } }
  // a link may name the tab (#flik=tf); the mail's #dag= opens the report; else the last one chosen, else Produktion
  var hashTab = /[#&]flik=(as|tf|rapport|ovr)\b/.exec(location.hash);
  var tab = hashTab ? hashTab[1] : /#dag=/.test(location.hash) ? "rapport" : savedTab() || "as";
  function setTab(t) {
    tab = t; try { sessionStorage.setItem(TABKEY, t); } catch (e) { /* memory only */ }
    if (/#dag=|flik=/.test(location.hash)) history.replaceState(null, "", location.pathname + (DEMO ? "#demo" : ""));
    render(); scrollTo(0, 0);
  }
  function drawTabs() {
    var nav = $("tabs"); while (nav.firstChild) nav.removeChild(nav.firstChild);
    TABS.forEach(function (t) {
      var b = el("button", t[0] === tab ? "on" : null); b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", t[0] === tab ? "true" : "false");
      if (t[0] === "as" || t[0] === "tf") { var sw = el("span", "sw"); sw.style.background = tabColor(t[0]); b.appendChild(sw); }
      b.appendChild(document.createTextNode(t[1]));
      b.addEventListener("click", function () { if (tab !== t[0]) setTab(t[0]); });
      nav.appendChild(b);
    });
  }
  // keys 1–4 switch tabs (not while typing)
  addEventListener("keydown", function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || !data || /input|textarea/i.test((ev.target && ev.target.tagName) || "")) return;
    var i = "1234".indexOf(ev.key); if (i >= 0) setTab(TABS[i][0]);
  });

  /** A section: its heading, then its own grid (so dense packing never pulls a card above its heading). */
  function section(title, tag) {
    var root = $("board"), h = el("h3", "section"); h.appendChild(el("span", null, title)); if (tag) h.appendChild(el("span", "tag", tag)); root.appendChild(h);
    board = el("div", "grid"); root.appendChild(board);
  }

  // ---- the panels
  function render() {
    var root = $("board");
    while (root.firstChild) root.removeChild(root.firstChild);
    board = el("div", "grid"); root.appendChild(board);
    var d = data || {}, envs = d.envs || {};
    $("asof").textContent = d.at ? "Uppdaterad " + new Date(d.at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }) : "";
    drawTabs();
    if (tab === "rapport") return reportTab(d.reports);
    var e = envs[tab] || {}, name = TABS.filter(function (t) { return t[0] === tab; })[0][2];
    if (tab === "ovr") {
      var o = card("Övrigt", "granskning och okänd byggtyp", 2);
      note(o, "Granskning = troliga konton från Apples granskning (bara sandlådeköp, versioner som inte släppts). Okänd = kontot har inte rapporterat någon byggtyp än. Ingen av dem räknas i Produktion eller TestFlight; här finns allt om dem, så inget försvinner.");
    }
    section(name, tab === "ovr" ? "bara dessa konton" : "bara " + name + "s löpare");
    growthPanels(e.growth);
    moneyPanels(e.money, e.est);
    aiPanels(e.ai, e.est, e.cost_runner, d.common, d.reports);
    coachPanels(e.coach);
    usagePanels(e.usage);
    racesPanel(e.races);
    supportPanels(e.support);
    systemPanels(e.system);
    section("Gemensamt", "samma för alla byggen: utan löpare bakom");
    commonPanels(d.common || null, d.not_measured);
  }

  // the report's counts: a cell per build ({tf, as, okand, gr, na}); "na" has no account and is common
  function cellOf(r, k) { return (((r || {}).numbers || {}).counts || {})[k] || {}; }
  var KEYS = [["active_day", "Aktiva löpare, dygnet"], ["active_7d", "Aktiva löpare, 7 dagar"], ["active_30d", "Aktiva löpare, 30 dagar"], ["accounts_new", "Nya konton"],
    ["accounts_total", "Konton totalt"], ["subs_active", "Aktiva prenumerationer"], ["subs_trial_active", "I gratisveckan nu"], ["subs_trial_started", "Gratisveckor startade"],
    ["subs_started", "Prenumerationer startade"], ["subs_cancelled", "Avslutade eller utgångna"], ["texts_total", "Coachtexter skrivna"], ["texts_failed", "Misslyckade coachjobb"],
    ["calls_total", "AI-anrop (liggaren)"], ["queue_stuck", "Coachjobb som fastnat"], ["support_chat_threads", "Supporttrådar i appen"], ["support_escalations", "Eskaleringar"],
    ["support_form", "Supportformuläret (webben)"], ["shares_total", "Delningar"], ["consent_ai_given", "Coachen: godkänt"], ["consent_ai_withdrawn", "Coachen: återkallat"]];

  function reportTab(reports) {
    if (!reports) return missing(card("Morgonrapporten", null, 2));
    if (!reports.length) { var e0 = card("Morgonrapporten", null, 2); e0.appendChild(el("p", "empty", "Ingen sparad rapport än: den första sparas nästa morgon kl 07.")); return; }
    var hashDay = /#dag=(\d{4}-\d{2}-\d{2})/.exec(location.hash);
    var day = chosenDay || (hashDay && hashDay[1]) || reports[0].day, idx = 0;
    reports.forEach(function (x, i) { if (x.day === day) idx = i; });
    var r = reports[idx], prev = reports[idx + 1] || null;
    // the conclusions, large, with the day picker
    var c = card("Coachens slutsatser", "dygnet " + r.day, 4); c.classList.add("lead");
    var days = el("div", "days");
    reports.slice(0, 21).forEach(function (x) {
      var b = el("button", x.day === r.day ? "on" : null, short(x.day)); b.type = "button"; b.title = x.day;
      b.addEventListener("click", function () { chosenDay = x.day; history.replaceState(null, "", "#dag=" + x.day); render(); });
      days.appendChild(b);
    });
    c.appendChild(days);
    c.appendChild(el("p", "analysis big", r.analysis || "Ingen analys den dagen (coachen kunde inte tillfrågas)."));
    note(c, "Dygnet " + r.day + " i svensk tid. Coachen skrev slutsatserna från siffrorna för båda byggena; de gäller hela rapporten (gemensamt). Admin- och granskarkonton är inte med. Önskemålens citat och korrläsningens exempel står bara i mejlet.");
    // the key numbers, App Store and TestFlight side by side
    [["as", "App Store", "Produktion"], ["tf", "TestFlight", "testare, inte marknaden"]].forEach(function (b) {
      var k = card(b[1], b[2], 2); k.classList.add("env-" + b[0]);
      var v = function (key) { return num(cellOf(r, key)[b[0]]); }, pv = function (key) { return prev ? num(cellOf(prev, key)[b[0]]) : null; };
      var delta = function (key) { var p = pv(key); if (p === null) return ""; var dd = v(key) - p; return (dd > 0 ? "+" : dd < 0 ? "−" : "±") + f0(Math.abs(dd)) + " mot dagen före"; };
      var cost = (((r.numbers || {}).aiCost) || {})[b[0]];
      tiles(k, [{ v: f0(v("active_day")), l: "Aktiva löpare", d: delta("active_day") }, { v: f0(v("accounts_new")), l: "Nya konton", d: delta("accounts_new") },
        { v: f0(v("subs_trial_started")), l: "Gratisveckor startade", d: delta("subs_trial_started") }, { v: f0(v("subs_started")), l: "Prenumerationer startade", d: delta("subs_started") },
        { v: f0(v("subs_active")), l: "Aktiva prenumerationer", d: b[0] === "tf" ? "sandlåda" : delta("subs_active") }, { v: f0(v("texts_total")), l: "Coachtexter", d: delta("texts_total") },
        { v: f0(v("texts_failed")), l: "Misslyckade jobb", dir: v("texts_failed") ? "down" : "" }, { v: f0(v("support_escalations")), l: "Eskaleringar i appen" },
        { v: cost ? usd(cost.total) : "–", l: "AI-kostnad (uppsk.)", d: cost ? f0(cost.users) + " löpare · median " + usd(cost.median) : "" }]);
    });
    // every key number in one table: the builds as columns, what has no account as "gemensamt"
    var t = card("Nyckeltal", "per bygge", 2), rows = [];
    KEYS.forEach(function (k) {
      var x = cellOf(r, k[0]); if (!Object.keys(x).length) return;
      rows.push([k[1], f0(x.as), f0(x.tf), f0(num(x.okand) + num(x.gr)), num(x.na) ? f0(x.na) : "–"]);
    });
    var ac = (r.numbers || {}).aiCost || {};
    rows.push(["AI-kostnad (USD, uppsk.)", ac.as ? usd(ac.as.total) : "–", ac.tf ? usd(ac.tf.total) : "–", ac.okand ? usd(ac.okand.total) : "–", usd((r.numbers || {}).costUsd)]);
    table(t, ["Mått", "App Store", "TestFlight", "Övrigt", "Gemensamt"], rows);
    note(t, "Gemensamt = sådant utan konto bakom (webbformuläret, appens larm) och dygnets hela AI-kostnad. Övrigt = okänd byggtyp och granskning.");
    var all = Object.keys(((r.numbers || {}).counts) || {}).filter(function (k) { return !KEYS.some(function (x) { return x[0] === k; }); }).sort();
    if (all.length) {
      var det = el("details", "more"); det.appendChild(el("summary", null, "Alla " + all.length + " övriga mått"));
      var holder = el("div"); det.appendChild(holder); t.appendChild(det);
      table(holder, ["Mått", "App Store", "TestFlight", "Övrigt", "Gemensamt"], all.map(function (k) { var x = cellOf(r, k); return [nm(k), f0(x.as), f0(x.tf), f0(num(x.okand) + num(x.gr)), num(x.na) ? f0(x.na) : "–"]; }));
    }
    // the history, both builds
    var hist = reports.slice(0, 60).slice().reverse(), xs = hist.map(function (x) { return x.day; });
    var per = function (key, b) { return hist.map(function (x) { return num(cellOf(x, key)[b]); }); };
    var two = function (key) { return [{ label: "App Store", color: tabColor("as"), values: per(key, "as") }, { label: "TestFlight", color: tabColor("tf"), values: per(key, "tf") }]; };
    [["active_day", "Aktiva löpare per dygn", "line"], ["accounts_new", "Nya konton per dygn", "bar"], ["texts_total", "Coachtexter per dygn", "line"], ["subs_trial_started", "Gratisveckor startade per dygn", "bar"]].forEach(function (h) {
      var k = card(h[1], hist.length + " dagar", 2), s = two(h[0]);
      k.appendChild(legend(s, h[2] === "line")); k.appendChild(chart(xs, s, { kind: h[2] === "line" ? "line" : null, label: h[1] }));
    });
    var cc = card("AI-kostnad per dygn", "USD, uppskattning", 2);
    var cs = [{ label: "App Store", color: tabColor("as"), values: hist.map(function (x) { return num((((x.numbers || {}).aiCost || {}).as || {}).total); }) },
      { label: "TestFlight", color: tabColor("tf"), values: hist.map(function (x) { return num((((x.numbers || {}).aiCost || {}).tf || {}).total); }) },
      { label: "Hela appen (gemensamt)", color: css("--s4"), values: hist.map(function (x) { return num((x.numbers || {}).costUsd); }) }];
    cc.appendChild(legend(cs, true)); cc.appendChild(chart(xs, cs, { kind: "line", fmt: function (v, axis) { return axis ? "$" + f0(v) : usd(v); }, label: "AI-kostnad per dygn" }));
    note(cc, "Per bygge: löparnas kostnad enligt rapporten (per inloggning, admin och granskning inte med). Hela appen: allt, även det utan löpare bakom.");
    var fj = card("Misslyckade jobb och eskaleringar", hist.length + " dagar", 2);
    var fs = [{ label: "Misslyckade, App Store", color: tabColor("as"), values: per("texts_failed", "as") }, { label: "Misslyckade, TestFlight", color: tabColor("tf"), values: per("texts_failed", "tf") },
      { label: "Eskaleringar (alla)", color: css("--s3"), values: hist.map(function (x) { var o = cellOf(x, "support_escalations"); return num(o.as) + num(o.tf) + num(o.okand) + num(o.gr) + num(o.na); }) }];
    fj.appendChild(legend(fs)); fj.appendChild(chart(xs, fs, { label: "Misslyckade jobb och eskaleringar" }));
  }

  function growthPanels(g) {
    var c = card("Tillväxt", "konton och aktiva", 1);
    if (!g) return missing(c);
    var dau = sum(g.active_1d), wau = sum(g.active_7d), mau = sum(g.active_30d), split = Object.keys(g.accounts || {}).length > 1;
    tiles(c, [{ v: f0(sum(g.accounts)), l: "Konton totalt", d: split ? envSplit(g.accounts) : "" }, { v: f0(sum(g.new_1d)), l: "Nya, 24 h", d: "7 d: " + f0(sum(g.new_7d)) },
      { v: f0(dau), l: "Aktiva 1 d (DAU)", d: split ? envSplit(g.active_1d) : "" }, { v: f0(wau), l: "Aktiva 7 d (WAU)" },
      { v: f0(mau), l: "Aktiva 30 d (MAU)" }, { v: pct(ratio(dau, mau)), l: "DAU / MAU", d: "WAU/MAU " + pct(ratio(wau, mau)) }]);
    note(c, "Aktiv = något på servern från kontot (coachtext, avbockat pass, samtycke, support, notisregistrering).");
    var days = g.daily || [], xs = days.map(function (x) { return x.d; });
    var n = card("Nya konton per dag", xs.length + " dagar", 2), ns = envSeries(days, "new");
    n.appendChild(legend(ns)); n.appendChild(chart(xs, ns, { label: "Nya konton per dag" }));
    var a = card("Aktiva löpare per dag", xs.length + " dagar", 2), as = envSeries(days, "dau");
    a.appendChild(legend(as, true)); a.appendChild(chart(xs, as, { kind: "line", label: "Aktiva löpare per dag" }));
    note(a, "Äldre dagar räknas lägre: liggaren sparas 9 dagar, därefter syns bara texter, avbockningar, samtycken och support.");
    var co = card("Land", "App Store-land, minst 3 per land", 1);
    co.appendChild(hbars((g.countries || []).map(function (x) { return { label: nm(x.c), value: x.n }; }), { label: "Konton per land", lw: 80, color: tabColor(tab) }));
    note(co, "Landet från App Store-kontot vid senaste samtycket, för den här flikens konton. Länder med färre än 3 konton här ligger i Övriga, som bara visas när de är minst 3.");
    var f = card("Första veckan", "tratten, 30 dagar", 1), marks = (g.funnel || {}).marks || {}, acc = num((g.funnel || {}).accounts);
    var items = [{ label: "Nya konton", value: acc }].concat(MARKS.map(function (m) { return { label: m[1], value: num(marks[m[0]]) }; }));
    var W = Math.max(240, cardW), row = 18, H = items.length * row, svg = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "chart", role: "img", "aria-label": "Tratten" }), top = Math.max(1, acc, num(marks.onb_health));
    items.forEach(function (it, i) {
      var yy = i * row + 2, w = Math.max(it.value ? 2 : 0, it.value / top * (W - 230));
      var t = sv("text", { x: 164, y: yy + 11, "text-anchor": "end" }); t.textContent = it.label; svg.appendChild(t);
      if (w) svg.appendChild(sv("rect", { x: 170, y: yy, width: w, height: 14, rx: 3, fill: i < 8 ? tabColor(tab) : css("--s3"), class: "bar" }));
      var v = sv("text", { x: 176 + w, y: yy + 11 }); v.textContent = f0(it.value) + (i && acc ? " · " + pct(it.value / acc) : ""); svg.appendChild(v);
    });
    f.appendChild(svg);
    note(f, "Varje steg första gången det nåddes de senaste 30 dagarna; andel av nya konton. Installationer finns bara i App Store Connect.");
    var k = card("Kohorter", "tillbaka dag 1, 7 och 30", 1), rows = (g.cohorts || []).slice().reverse().map(function (x) {
      var cell = function (v) { if (!has(v)) return { t: "–" }; var p = ratio(v, x.n); return { t: pct(p), cls: "heat", bg: "color-mix(in srgb, " + tabColor(tab) + " " + Math.round((p || 0) * 70) + "%, transparent)" }; };
      return [x.w, f0(x.n), cell(x.d1), cell(x.d7), cell(x.d30)];
    });
    if (rows.length) table(k, ["Vecka", "Startade", "Dag 1", "Dag 7", "Dag 30"], rows); else k.appendChild(el("p", "empty", "Inga kohorter än."));
    note(k, "Kontots startvecka; andel med något på servern just den dagen. – = kohorten är inte gammal nog.");
  }

  function moneyPanels(m, est) {
    var sandbox = tab !== "as";
    var c = card("Pengar", sandbox ? "sandlådeköp, inga riktiga pengar" : "prenumerationer", 2);
    if (!m) return missing(c);
    est = est || {};
    var conv = ratio(m.cohort_converted, m.cohort_trials);
    tiles(c, [{ v: f0(sum(m.active)), l: sandbox ? "Betalande (sandlåda)" : "Betalande nu" }, { v: f0(sum(m.trial)), l: "I gratisveckan" },
      { v: sandbox ? "–" : kr(est.mrr_sek), l: "MRR (uppsk., netto)", d: sandbox ? "sandlådan ger inga pengar" : "ARR " + kr(est.arr_sek) }, { v: pct(conv), l: "Gratisvecka → betalt", d: f0(m.cohort_converted) + " av " + f0(m.cohort_trials) },
      { v: f0(m.ended_30d), l: "Avslutade, 30 d" }, { v: f0(m.refunded_30d), l: "Återbetalda, 30 d" }, { v: f0(m.retry), l: "Betalningsproblem nu", d: "grace eller nytt försök" }]);
    var plans = m.by_plan || {}, pl = [["monthly", "Månad"], ["yearly", "År (och år betalt per månad)"], ["other", "Annan"]].map(function (p) {
      return { label: p[1], value: ENVS.reduce(function (a, e) { return a + num(plans[e[0] + ":" + p[0]]); }, 0) };
    });
    c.appendChild(el("p", "sub", "Betalande per plan"));
    c.appendChild(hbars(pl, { label: "Betalande per plan", lw: 190, color: tabColor(tab) }));
    note(c, sandbox ? "TestFlight och granskning köper i sandlådan: siffrorna visar att köpflödet fungerar, inte intäkter."
      : "Uppskattning: listpris " + f0(est.price_monthly) + " kr/mån och " + f0(est.price_yearly) + " kr/år, minus moms 25 % och Apples 15 %. År betalt per månad kan inte skiljas från år. Betalningslarmen ligger under Gemensamt.");
    var w = m.weekly || [], xs = w.map(function (x) { return x.w; }), xf = function (x) { return String(x).replace(/^\d{4}-/, ""); };
    var s = card("Prenumerationer per vecka", "12 veckor", 1);
    var ser = [{ label: "Gratisveckor", color: css("--s1"), values: w.map(function (x) { return x.trials; }) }, { label: "Betalt direkt", color: css("--s2"), values: w.map(function (x) { return x.paid; }) },
      { label: "Blev betalande", color: css("--s3"), values: w.map(function (x) { return x.converted; }) }, { label: "Avslutade", color: css("--s4"), values: w.map(function (x) { return x.ended; }) }];
    s.appendChild(legend(ser, true)); s.appendChild(chart(xs, ser, { kind: "line", xfmt: xf, label: "Prenumerationer per vecka" }));
    note(s, "Återbetalda per vecka: " + w.slice(-6).map(function (x) { return xf(x.w) + " " + f0(x.refunded); }).join(", ") + ". Avstängd förnyelse sparas inte: avslut syns när perioden gått ut.");
  }

  function aiPanels(ai, est, runner, common, reports) {
    var c = card("AI-kostnad", "flikens löpare, uppskattning", 2);
    if (!ai) return missing(c);
    est = est || {}; runner = runner || null;
    var cap = num(((common || {}).ai || {}).cap);
    tiles(c, [{ v: runner ? usd(runner.total) : "–", l: "Senaste 24 h (USD)", d: runner ? f0(runner.users) + " löpare använde coachen" : "ingen använde coachen" },
      { v: runner ? usd(runner.median) : "–", l: "Median per löpare, 24 h", d: runner ? "p90 " + usd(runner.p90) + " · max " + usd(runner.max) : "" },
      { v: has(est.ai_usd_per_runner_day) ? usd(est.ai_usd_per_runner_day) : "–", l: "Snitt per löpare och dygn" },
      { v: kr(est.ai_sek_per_runner_month), l: "Per löpare och månad", d: "dygnet × 30 · " + f1(est.usd_sek) + " kr/USD" },
      tab === "as" ? { v: kr(est.margin_per_payer_sek), l: "Marginal per betalande/mån", d: "netto " + kr(est.rev_per_payer_sek) + " − AI", dir: num(est.margin_per_payer_sek) < 0 ? "down" : "up" }
        : { v: "–", l: "Marginal", d: "bara i Produktion" },
      { v: f0(ai.calls_24h), l: "AI-anrop, 24 h", d: "liggaren" }, { v: cap ? pct(ratio(ai.cap_used_24h, cap)) : "–", l: "Andel av AI-taket, 24 h", d: f0(ai.cap_used_24h) + " av " + f0(cap) + " (taket är gemensamt)" }]);
    var days = ai.daily || [], xs = days.map(function (x) { return x.d; });
    c.appendChild(el("p", "sub", "AI-anrop per dag (liggaren sparas 9 dagar)"));
    c.appendChild(chart(xs, [{ label: "Anrop", color: tabColor(tab), values: days.map(function (x) { return x.calls; }) }], { h: 110, label: "AI-anrop per dag" }));
    var key = tab === "ovr" ? "okand" : tab, hist = (reports || []).slice(0, 60).slice().reverse();
    var k = card("AI-kostnad per dygn", "enligt morgonrapporten", 1);
    if (hist.length) {
      k.appendChild(chart(hist.map(function (x) { return x.day; }), [{ label: "USD", color: tabColor(tab), values: hist.map(function (x) { return num((((x.numbers || {}).aiCost || {})[key] || {}).total); }) }],
        { fmt: function (v, axis) { return axis ? "$" + f1(v) : usd(v); }, label: "AI-kostnad per dygn" }));
    } else k.appendChild(el("p", "empty", "Ingen sparad rapport än."));
    note(k, "Flikens löpare, per inloggning, admin- och granskarkonton inte med. Kostnad per anropstyp, cache och batch saknar löpare: se Gemensamt.");
  }

  function coachPanels(co) {
    var c = card("Coachen", "texter och kö", 2);
    if (!co) return missing(c);
    var days = co.daily || [], d7 = days.slice(-7), s = function (k) { return d7.reduce(function (a, x) { return a + num(x[k]); }, 0); }, pr = co.proofread_7d || {}, q = co.queue || {};
    tiles(c, [{ v: f0(s("texts")), l: "Texter, 7 d" }, { v: f0(s("failed")), l: "Misslyckade, 7 d", dir: s("failed") ? "down" : "" }, { v: f0(co.stuck), l: "Fastnat > 6 h", dir: num(co.stuck) ? "down" : "" },
      { v: f0(co.waiting), l: "I kön nu", d: Object.keys(q).map(function (k) { return nm(k) + " " + f0(q[k]); }).join(" · ") }, { v: has(co.queue_min_p50) ? f1(co.queue_min_p50) + " min" : "–", l: "Kötid median", d: "p90 " + (has(co.queue_min_p90) ? f1(co.queue_min_p90) + " min" : "–") },
      { v: f0(co.route_7d), l: "Säg till coachen, 7 d" }, { v: f0(co.notices_30d), l: "Ändrade veckor, 30 d", d: "bara utkast: " + f0(co.notices_outline_30d) },
      { v: f0(co.moves_7d), l: "Flyttade pass, 7 d" }, { v: f0(co.followq_7d), l: "Följdfrågor, 7 d" },
      { v: f0(pr.corrected), l: "Korrläsning rättade, 7 d", d: f0(sum(pr)) + " lästa · " + f0(pr.rejected) + " stoppade" }]);
    var xs = days.map(function (x) { return x.d; }), ser = [{ label: "Texter", color: tabColor(tab), values: days.map(function (x) { return x.texts; }) }, { label: "Misslyckade", color: css("--bad"), values: days.map(function (x) { return x.failed; }) }];
    c.appendChild(legend(ser)); c.appendChild(chart(xs, ser, { label: "Coachtexter per dag" }));
    note(c, "Texter räknas per text: en omskrivning flyttar textens dag. Kötid gäller batchkön (från köad till klar); direkta anrops svarstid sparas inte.");
    var k = card("Texter per slag", "7 dagar", 1), kinds = co.kinds_7d || {};
    k.appendChild(hbars(Object.keys(kinds).map(function (x) { return { label: nm(x), value: kinds[x] }; }), { top: 14, color: tabColor(tab) }));
    var f = card("Misslyckade och veckoändringar", "7 / 30 dagar", 1), fk = co.failed_kinds_7d || {}, nr = co.notice_reasons_30d || {};
    f.appendChild(el("p", "sub", "Misslyckade jobb per slag, 7 d"));
    f.appendChild(hbars(Object.keys(fk).map(function (x) { return { label: nm(x), value: fk[x] }; }), { color: css("--bad") }));
    f.appendChild(el("p", "sub", "Ändrade veckor per skäl, 30 d"));
    f.appendChild(hbars(Object.keys(nr).map(function (x) { return { label: nm(x), value: nr[x] }; }), { color: css("--s3") }));
  }

  function usagePanels(u) {
    var c = card("Användning", "det servern ser", 2);
    if (!u) return missing(c);
    var days = u.daily || [], t30 = u.texts_30d || {}, s = function (k) { return days.reduce(function (a, x) { return a + num(x[k]); }, 0); };
    tiles(c, [{ v: f0(s("workouts")), l: "Synkade pass, 30 d" }, { v: f0(s("ticks")), l: "Avbockade pass, 30 d" }, { v: f0(sum(u.shares_30d)), l: "Delningar, 30 d", d: f0(u.sharers_30d) + " löpare" },
      { v: f0(t30.mealplan), l: "Matplaner, 30 d" }, { v: f0(u.recipes_saved), l: "Sparade recept", d: "30 d: " + f0(t30.recipesaved) }, { v: f0(u.meals_30d), l: "Måltider loggade, 30 d" },
      { v: f0(u.lock_screen_phones), l: "Dagens pass på låsskärmen", d: "telefoner med den på" }, { v: f0(num(t30.runpair) + num(t30.dailyprerun)), l: "Duo-texter, 30 d" },
      { v: f0(t30.racejourney), l: "Loppresor, 30 d" }, { v: f0(u.buddies), l: "Löparkompisar", d: "grupper " + f0(u.groups) + " · medlemmar " + f0(u.group_members) },
      { v: f0(sum(u.connections)), l: "Kopplingar", d: Object.keys(u.connections || {}).map(function (k) { return nm(k) + " " + f0(u.connections[k]); }).join(" · ") || "inga" },
      { v: f0(u.year_shares), l: "Delade årssidor" }]);
    var xs = days.map(function (x) { return x.d; }), ser = [{ label: "Synkade pass", color: css("--s1"), values: days.map(function (x) { return x.workouts; }) }, { label: "Avbockade pass", color: css("--s2"), values: days.map(function (x) { return x.ticks; }) }];
    c.appendChild(legend(ser, true)); c.appendChild(chart(xs, ser, { kind: "line", label: "Pass per dag" }));
    var sh = card("Delningar per slag", "30 dagar", 1), so = u.shares_30d || {};
    sh.appendChild(hbars(Object.keys(so).map(function (k) { return { label: nm(k), value: so[k] }; }), { top: 14, color: tabColor(tab) }));
    var e = card("Påskägg hittade", "totalt", 1), eg = u.eggs || {};
    e.appendChild(hbars(Object.keys(eg).map(function (k) { return { label: nm(k), value: eg[k] }; }), { color: css("--s3") }));
    var w = card("Passkällor", "30 dagar", 1), ws = u.workouts_by_source_30d || {};
    w.appendChild(hbars(Object.keys(ws).map(function (k) { return { label: nm(k), value: ws[k] }; }), { color: tabColor(tab) }));
    note(w, "Pass från Apple Hälsa stannar på telefonen och syns inte här.");
  }

  function racesPanel(r) {
    var c = card("Lopp", "flikens löpare", 1);
    if (!r) return missing(c);
    tiles(c, [{ v: f0(r.user_races), l: "Lopp i löparnas planer", d: "från registret " + f0(r.user_races_register) }, { v: f0(r.results_30d), l: "Resultat hämtade, 30 d", d: "totalt " + f0(r.results) }]);
    note(c, "Registret och upptäckten har inga löpare bakom: se Gemensamt.");
  }

  function supportPanels(s) {
    var c = card("Support och trygghet", "räknat, aldrig läst", 2);
    if (!s) return missing(c);
    var wi = s.wishes || {};
    tiles(c, [{ v: f0(s.threads_7d), l: "Supporttrådar, 7 d", d: f0(s.messages_7d) + " meddelanden" }, { v: f0(s.escalations_30d), l: "Eskaleringar, 30 d" }, { v: f0(s.form_30d), l: "Formuläret inloggad, 30 d" },
      { v: f0(s.reports_30d), l: "Anmälningar, 30 d", d: "obehandlade " + f0(s.reports_open), dir: num(s.reports_open) ? "down" : "" },
      { v: f0(s.ugc_held_now), l: "Fri text som hålls nu" }, { v: f0(s.crisis_7d), l: "Krisstöd visat, 7 d", d: "högst så många gånger" },
      { v: f0(num(wi.open) + num(wi.asking)), l: "Öppna önskemål", d: "klara " + f0(wi.done) }]);
    var days = s.daily || [], xs = days.map(function (x) { return x.d; });
    var ser = [{ label: "Meddelanden i appen", color: css("--s1"), values: days.map(function (x) { return x.messages; }) }, { label: "Formuläret inloggad", color: css("--s2"), values: days.map(function (x) { return x.form; }) },
      { label: "Eskaleringar", color: css("--s3"), values: days.map(function (x) { return x.escalations; }) }];
    c.appendChild(legend(ser)); c.appendChild(chart(xs, ser, { label: "Support per dag" }));
    note(c, "Anmälningar räknas på den som anmälde. Webbformuläret utan konto och granskningen av fri text per dag ligger under Gemensamt.");
  }

  function systemPanels(sy) {
    var c = card("Telefoner", "notiser", 1);
    if (!sy) return missing(c);
    var ph = sy.phones || {};
    tiles(c, [{ v: f0(sum(ph)), l: "Telefoner med notiser", d: Object.keys(ph).map(function (k) { return nm(k) + " " + f0(ph[k]); }).join(" · ") || "inga" }, { v: f0(sy.push_held), l: "Notiser som väntar" }]);
    var k = card("Samtycken", "per slag och version", 1), rows = (sy.consent || []).map(function (x) { return [nm(x.kind) + " v" + x.version, f0(x.given_30d), f0(x.withdrawn_30d), f0(x.given), f0(x.withdrawn)]; });
    if (rows.length) table(k, ["Slag", "Ja 30 d", "Nej 30 d", "Ja totalt", "Nej totalt"], rows); else k.appendChild(el("p", "empty", "Inga samtycken än."));
    var now = sy.consent_now || {};
    note(k, "Ja = godkänt, nej = återkallat. Gäller nu: " + ["ai", "health", "social"].map(function (x) { var o = now[x] || {}; return nm(x) + " " + (Object.keys(o).map(function (v) { return v + ": " + f0(o[v]); }).join(", ") || "0"); }).join(" · "));
  }

  // ---- gemensamt: what has no runner behind it, the same on every tab
  function commonCard(title, tag, w) { var c = card(title, tag ? tag + " · gemensamt" : "gemensamt", w); c.classList.add("common"); return c; }
  function commonPanels(cm, notMeasured) {
    if (!cm) return missing(commonCard("Gemensamt", null, 1));
    var ai = cm.ai;
    var c = commonCard("AI, hela appen", "listpris, uppskattning", 2);
    if (!ai) missing(c);
    else {
      var days = ai.daily || [], last = days[days.length - 1] || {}, d7 = days.slice(-7), d30 = days.slice(-30);
      var s = function (arr, k) { return arr.reduce(function (a, x) { return a + num(x[k]); }, 0); }, calls7 = s(d7, "calls"), usd7 = s(d7, "usd");
      tiles(c, [{ v: usd(last.usd), l: "I dag (USD)", d: f0(last.calls) + " anrop" }, { v: usd(usd7), l: "7 dagar (USD)" }, { v: usd(s(d30, "usd")), l: "30 dagar (USD)" },
        { v: calls7 ? "$" + (usd7 / calls7).toFixed(4).replace(".", ",") : "–", l: "Per anrop, 7 d" },
        { v: pct(ratio(s(d7, "tok_read"), s(d7, "tok_all"))), l: "Cache-träff, 7 d", d: "i dag " + pct(ratio(last.tok_read, last.tok_all)) },
        { v: pct(ratio(s(d7, "batch_calls"), calls7)), l: "Batch-andel, 7 d" }, { v: pct(ratio(ai.cap_used_24h, ai.cap)), l: "AI-taket, 24 h", d: f0(ai.cap_used_24h) + " av " + f0(ai.cap) },
        { v: f0(ai.cap80_30d), l: "Taket 80 %, 30 d" }, { v: f0(ai.heavy_7d), l: "Tunga konton, 7 d", d: "nära tokenbudget: " + f0(ai.tokens_7d) }]);
      var xs = days.map(function (x) { return x.d; });
      c.appendChild(chart(xs, [{ label: "USD", color: css("--s4"), values: days.map(function (x) { return x.usd; }) }], { h: 120, fmt: function (v, axis) { return axis ? "$" + f1(v) : usd(v); }, label: "AI-kostnad per dag, hela appen" }));
      var ch = [{ label: "Cache-träff", color: css("--s1"), values: days.map(function (x) { return ratio(x.tok_read, x.tok_all) || 0; }) }, { label: "Batch-andel", color: css("--s2"), values: days.map(function (x) { return ratio(x.batch_calls, x.calls) || 0; }) }];
      c.appendChild(legend(ch, true)); c.appendChild(chart(xs, ch, { kind: "line", h: 100, max: 1, fmt: pct, label: "Cache-träff och batch-andel" }));
      note(c, "Kostnaden per anropstyp sparas utan löpare, för alla byggen och admin tillsammans; taket och larmen gäller hela appen.");
      var t = commonCard("Dyraste anropstyperna", "7 dagar", 1);
      t.appendChild(hbars((ai.kinds_7d || []).map(function (x) { return { label: x.kind, value: x.usd, note: f0(x.calls) + " anrop · cache " + pct(x.cache) }; }), { fmt: usd, unit: "USD", top: 12, lw: 120, color: css("--s4") }));
    }
    var al = cm.alerts_30d || {}, alarms = sum(al);
    var a = commonCard("Larm", "30 dagar", 1);
    var st = el("p"); st.appendChild(el("span", "status " + (alarms ? "warn" : "ok"), alarms ? f0(alarms) + " larm de senaste 30 dagarna" : "Inga larm de senaste 30 dagarna")); a.appendChild(st);
    a.appendChild(hbars(Object.keys(al).map(function (k) { return { label: nm(k), value: al[k] }; }), { color: css("--s2"), lw: 170 }));
    tiles(a, [{ v: f0(cm.billing_alerts_30d), l: "Betalningslarm, 30 d" }]);
    var pend = cm.pending || {}, seeds = cm.seeds || {};
    var r = commonCard("Loppregistret", null, 1);
    tiles(r, [{ v: f0(cm.register), l: "Lopp i registret", d: f0(cm.countries) + " länder" }, { v: f0(cm.with_course), l: "Med arrangörens bana" }, { v: f0(cm.coming), l: "Kommande" },
      { v: f0(sum(pend) + num(cm.unapproved)), l: "Väntar på granskning", d: "banor " + f0(pend.course) + " · länkar " + f0(pend.url) + " · lopp " + f0(cm.unapproved) }]);
    r.appendChild(el("p", "sub", "Upptäckten (pausad tills Mila drar in pengar): frön per läge"));
    r.appendChild(hbars(Object.keys(seeds).map(function (k) { return { label: nm(k), value: seeds[k] }; }), { color: css("--s4"), lw: 110 }));
    var u = cm.ugc_30d || {}, pn = cm.proofread_noaccount_7d || {};
    var f = commonCard("Utan konto", "webbformuläret och granskningen", 1);
    tiles(f, [{ v: f0(cm.form_30d), l: "Webbformuläret, 30 d", d: "utan inloggning" }, { v: f0(cm.escalations_30d), l: "Eskaleringar utan konto, 30 d" },
      { v: f0(u.held), l: "Stoppad fri text, 30 d", d: f0(u.reviewed) + " granskade · " + f0(u.released) + " släppta · " + f0(u.removed) + " borttagna" },
      { v: f0(sum(pn)), l: "Korrläsning utan konto, 7 d", d: "rättade " + f0(pn.corrected) }]);
    var fd = cm.form_daily || [];
    f.appendChild(chart(fd.map(function (x) { return x.d; }), [{ label: "Webbformuläret", color: css("--s4"), values: fd.map(function (x) { return x.form; }) }], { h: 90, label: "Webbformuläret per dag" }));
    var sy = commonCard("Drift", null, 1);
    tiles(sy, [{ v: cm.migration ? String(cm.migration).slice(0, 8) : "–", l: "Senaste migrering", d: cm.migration ? String(cm.migration) : "" },
      { v: cm.report_sent ? new Date(cm.report_sent).toLocaleDateString("sv-SE") : "–", l: "Morgonrapport mejlad" }, { v: cm.report_kept || "–", l: "Morgonrapport sparad" }]);
    sy.appendChild(el("p", "note", "Mäts inte (ingen ny insamling): " + (notMeasured || []).map(function (x) { return NOT_MEASURED[x] || x; }).join(", ") + "."));
  }

  // ---- sign-in (Supabase Auth's e-mail OTP; no account is created from here)
  function session() { try { var s = JSON.parse(sessionStorage.getItem(STORE) || "null"); return s && s.t && s.exp > Date.now() + 30e3 ? s : null; } catch (e) { return null; } }
  function keep(t, secs) { try { sessionStorage.setItem(STORE, JSON.stringify({ t: t, exp: Date.now() + Math.min(Number(secs) || 3600, 3600) * 1000 })); } catch (e) { /* memory only */ } mem = { t: t, exp: Date.now() + Math.min(Number(secs) || 3600, 3600) * 1000 }; }
  var mem = null;
  function token() { var s = session() || (mem && mem.exp > Date.now() + 30e3 ? mem : null); return s ? s.t : null; }
  function forget() { mem = null; try { sessionStorage.removeItem(STORE); } catch (e) { /* none */ } }
  function auth(path, body) {
    return fetch(SUPABASE + "/auth/v1/" + path, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit", referrerPolicy: "no-referrer" });
  }
  function showLogin(msg) {
    clearInterval(timer); $("app").hidden = true; $("login").hidden = false; $("f-mail").hidden = false; $("f-code").hidden = true;
    $("msg1").textContent = msg || ""; $("mail").focus();
  }
  $("f-mail").addEventListener("submit", function (ev) {
    ev.preventDefault(); mail = $("mail").value.trim(); $("msg1").textContent = "";
    auth("otp", { email: mail, create_user: false }).then(function (r) {
      // the same answer whether the address has an account or not
      if (r.status === 429) { $("msg1").textContent = "För många försök. Vänta en stund."; return; }
      $("f-mail").hidden = true; $("f-code").hidden = false; $("msg2").textContent = ""; $("code").value = ""; $("code").focus();
    }, function () { $("msg1").textContent = "Ingen anslutning."; });
  });
  $("f-code").addEventListener("submit", function (ev) {
    ev.preventDefault(); $("msg2").textContent = "";
    auth("verify", { type: "email", email: mail, token: $("code").value.trim() }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      if (!x.ok || !x.j || !x.j.access_token) { $("msg2").textContent = "Fel eller för gammal kod."; return; }
      keep(x.j.access_token, x.j.expires_in); mail = ""; start();
    }, function () { $("msg2").textContent = "Ingen anslutning."; });
  });
  $("logout").addEventListener("click", function () {
    var t = token(); forget();
    if (t) fetch(SUPABASE + "/auth/v1/logout", { method: "POST", headers: { apikey: ANON, Authorization: "Bearer " + t }, credentials: "omit" }).catch(function () {});
    showLogin("Utloggad.");
  });
  $("reload").addEventListener("click", function () { load(); });
  function subOf(t) { try { var p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return typeof p.sub === "string" ? p.sub : ""; } catch (e) { return ""; } }

  function load() {
    if (DEMO) return fetch("demo.json").then(function (r) { return r.json(); }).then(function (j) { data = j; render(); });
    var t = token();
    if (!t) return showLogin("");
    $("board").style.opacity = data ? ".6" : "1";
    return fetch(FN, { headers: { Authorization: "Bearer " + t, apikey: ANON }, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" }).then(function (r) {
      $("board").style.opacity = "1";
      if (r.status === 401) { forget(); return showLogin("Logga in igen."); }
      if (r.status === 403) { forget(); return showLogin("Kontot har inte behörighet. Konto-id att lägga i ADMIN_USER_IDS: " + subOf(t)); }
      if (r.status === 429) { return; }
      if (!r.ok) { var b = $("board"); while (b.firstChild) b.removeChild(b.firstChild); b.appendChild(el("p", "err", "Siffrorna kunde inte hämtas (" + r.status + "). Försök igen om en stund.")); return; }
      return r.json().then(function (j) { data = j; render(); });
    }, function () { $("board").style.opacity = "1"; });
  }
  function start() {
    $("login").hidden = true; $("app").hidden = false;
    load(); clearInterval(timer); timer = setInterval(function () { if (!DEMO && !token()) return showLogin("Sessionen har gått ut."); load(); }, 120e3);
  }
  var resizeT;
  addEventListener("resize", function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if (data) render(); }, 200); });
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (data) render(); });
  if (DEMO || token()) start(); else showLogin("");
})();
