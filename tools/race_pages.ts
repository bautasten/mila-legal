// Mila's public race pages: one page per race in Milas loppregister and language, an index per language, sitemap.xml and robots.txt,
// generated from the public race feed (function race-feed: approved races, public course facts only). No key and no secret: it runs
// anywhere, hourly in the Pages repo (bautasten/mila-legal, .github/workflows/race-pages.yml, as tools/race_pages.ts) and by hand here.
//
//   Swedish  https://milacoach.app/lopp/<slug>/         index /lopp/        (pages 2… /lopp/sida/2/)
//   English  https://milacoach.app/en/races/<slug>/     index /en/races/    (/en/races/page/2/)
//   German   https://milacoach.app/de/laeufe/<slug>/    index /de/laeufe/   (/de/laeufe/seite/2/)
//   the share image /lopp/<slug>/og.png (1200×630: the course's profile and shape over the race's scene, rendered with resvg-wasm),
//   the hero's scene drawn in the browser by /scene.js (scene.ts built by scene_js.sh) when the site has it, one default image per
//   language (<index>/og.png), sitemap.xml (the site's own pages too) and robots.txt
//
// Slugs are lower-case ASCII from the name and distance (the feed's suggestion) and never change once published: lopp/slugs.json in
// the output keeps every race's slug (and the lastmod of every page), so a renamed race keeps its address and a new race never takes
// the slug of one that left. A race needs a course for its first page; a race without a date gets its page without the event markup.
// A race that leaves the register keeps its page as "Loppet finns inte längre i registret" with noindex, out of the sitemap and the
// indexes; one that comes back gets its page back. A run that would drop many races at once (a broken feed) stops without writing.
// Files are only written when their content changes (the countdown is coarse and refined in the browser), so the hourly job seldom commits.
//
// The course description: Swedish pages show the coach's own description (races.comment, Mila's text); English and German pages show
// a short summary built here from the course's numbers (no AI at build time: no key in CI, no cost), never the Swedish text.
//
// Run here (a local preview in marketing-site/, git-ignored; serve it with `deno run -A jsr:@std/http/file-server marketing-site`):
//   cd backend && deno run --allow-net --allow-read=. --allow-write=marketing-site race_pages.ts [--feed <url or file.json>] [--no-png]
// Options: --out <dir> (default marketing-site next to this script), --feed (default the live feed), --today YYYY-MM-DD, --no-png,
// --allow-mass-removal (accept a run that drops more than a third of the published races).

import { raceSceneSpec, sceneLayers } from "./scene.ts";

export const SITE = "https://milacoach.app";
export const FEED_URL = "https://vfjofaniwtudzvadxpsd.supabase.co/functions/v1/race-feed";
/** The App Store link of every generated page's call to action. Byt till appens riktiga App Store-länk vid lansering: set "appStoreUrl"
 *  in race_pages.json next to this script (backend/race_pages.json, published as tools/race_pages.json in the Pages repo by
 *  backend/publish_legal.sh), which wins over this constant; the next run regenerates every page with it. */
export const APP_STORE_URL = "https://apps.apple.com/search?term=Mila%20Coach";
const RESVG_WASM = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
const FONT_URLS = ["https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf", "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf"];
/** Races per index page, nearby races per page, and when a run counts as dropping too many races (a share of the published ones, and at least). */
export const INDEX_PAGE_SIZE = 200, NEARBY_MAX = 6, MASS_REMOVAL_SHARE = 1 / 3, MASS_REMOVAL_MIN = 5;
const RESERVED_SLUGS = new Set(["sida", "page", "seite", "og", "index", "en", "de", "lopp", "races", "laeufe"]);

export type Lang = "sv" | "en" | "de";
export const LANGS: Lang[] = ["sv", "en", "de"];
/** [latitude, longitude, elevation m, km from the start] */
export type Point = [number, number, number, number];
export type Climb = { km: number; len: number; gain: number; grade: number; top: number };
export type Info = { starts?: { label: string; time: string; main?: boolean }[]; start_place?: { name: string; lat?: number; lon?: number };
  cutoffs?: { km: number; clock?: string; elapsed_min?: number }[]; kit?: string[]; source?: string; checked?: string };
export type Result = { year: number; finishers: number; overall: { p10: number; p25: number; p50: number; p75: number; p90: number }; source: string | null };
/** One race from the feed (supabase/functions/_shared/race_feed.ts), checked again here. */
export type Race = {
  id: string; slug: string; name: string; place: string | null; country: string | null; country_code: string | null; organizer: string | null;
  url: string | null; next_date: string | null; prelim: boolean; past_dates: string[]; km: number; ascent: number; descent: number | null; trail: boolean;
  min_ele: number | null; max_ele: number | null; climbs: Climb[]; aid_stations: { km: number; what: string[] }[] | null; info: Info | null;
  results: Result[]; comment: string | null; course_source: "official_gpx" | "upload" | null; ele_source: "dem" | null;
  start: [number, number] | null; course: { pts: Point[] } | null;
};
export type State = {
  version: 1;
  races: Record<string, { slug: string; name: string; first: string; removed: string | null; og?: string }>;
  pages: Record<string, { hash: string; lastmod: string }>;
  og: Record<string, string>;
};
export type PngRenderer = (svg: string) => Uint8Array | Promise<Uint8Array>;
export type Report = { races: number; active: number; removed: string[]; added: string[]; written: number; pngs: number };

// ------------------------------------------------------------------------------------------------------------- the feed, checked

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const str = (x: unknown, max = 300): string | null => (typeof x === "string" && x.trim() ? x.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max) : null);
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T12:00:00Z"));
const isClock = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/** An http(s) address safe to link: no spaces, quotes or angle brackets, a host with a dot, no login. */
export function safeUrl(x: unknown, httpsOnly = false): string | null {
  const s = typeof x === "string" ? x.trim() : "";
  if (!s || s.length > 500 || /[\s<>"'\\`]/.test(s)) return null;
  try { const u = new URL(s); return (u.protocol === "https:" || (!httpsOnly && u.protocol === "http:")) && u.hostname.includes(".") && !u.username && !u.password ? s : null; } catch { return null; }
}
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A race from the feed as the pages use it, or null when it lacks an id, a name or a distance. Every field checked and bounded. */
export function cleanRace(x: any): Race | null {
  if (!x || typeof x !== "object") return null;
  const id = typeof x.id === "string" && /^[0-9a-f-]{8,64}$/.test(x.id) ? x.id : null, name = str(x.name, 120), km = isNum(x.km) && x.km > 0 && x.km < 1000 ? x.km : null;
  if (!id || !name || !km) return null;
  const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const pts: Point[] = arr(x.course?.pts).filter((p) => Array.isArray(p) && p.length >= 4 && p.slice(0, 4).every(isNum) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)
    .slice(0, 400).map((p) => [p[0], p[1], p[2], p[3]] as Point);
  const i = x.info && typeof x.info === "object" && !Array.isArray(x.info) ? x.info : null;
  let info: Info | null = null;
  if (i) {
    info = {};
    const starts = arr(i.starts).filter((s) => s && isClock(s.time)).slice(0, 12).map((s) => ({ label: str(s.label, 40) ?? "", time: s.time as string, ...(s.main === true ? { main: true } : {}) }));
    if (starts.length) info.starts = starts;
    const sp = i.start_place, spName = str(sp?.name, 120);
    if (spName) info.start_place = { name: spName, ...(isNum(sp.lat) && isNum(sp.lon) && Math.abs(sp.lat) <= 90 && Math.abs(sp.lon) <= 180 ? { lat: sp.lat, lon: sp.lon } : {}) };
    const cutoffs = arr(i.cutoffs).filter((c) => c && isNum(c.km) && (isClock(c.clock) || (isNum(c.elapsed_min) && c.elapsed_min > 0))).slice(0, 20)
      .map((c) => ({ km: c.km as number, ...(isClock(c.clock) ? { clock: c.clock as string } : {}), ...(isNum(c.elapsed_min) && c.elapsed_min > 0 ? { elapsed_min: Math.round(c.elapsed_min) } : {}) }));
    if (cutoffs.length) info.cutoffs = cutoffs;
    const kit = arr(i.kit).map((k) => str(k, 80)).filter((k): k is string => !!k).slice(0, 25);
    if (kit.length) info.kit = kit;
    const source = safeUrl(i.source, true);
    if (source) info.source = source;
    if (isDay(i.checked)) info.checked = i.checked;
  }
  return {
    id, slug: typeof x.slug === "string" && SLUG.test(x.slug) && x.slug.length <= 80 ? x.slug : "", name, place: str(x.place, 80), country: str(x.country, 60),
    country_code: typeof x.country_code === "string" && /^[A-Z]{2}$/.test(x.country_code) ? x.country_code : null, organizer: str(x.organizer, 120), url: safeUrl(x.url),
    next_date: isDay(x.next_date) ? x.next_date : null, prelim: x.prelim !== false, past_dates: arr(x.past_dates).filter(isDay).sort().slice(-5), km,
    ascent: isNum(x.ascent) ? Math.max(0, Math.round(x.ascent)) : 0, descent: isNum(x.descent) ? Math.round(x.descent) : null, trail: x.trail !== false,
    min_ele: isNum(x.min_ele) ? Math.round(x.min_ele) : null, max_ele: isNum(x.max_ele) ? Math.round(x.max_ele) : null,
    climbs: arr(x.climbs).filter((c) => c && [c.km, c.len, c.gain, c.grade, c.top].every(isNum)).slice(0, 60).map((c) => ({ km: c.km, len: c.len, gain: c.gain, grade: c.grade, top: c.top })),
    aid_stations: Array.isArray(x.aid_stations) ? x.aid_stations.filter((s: any) => s && isNum(s.km)).slice(0, 40)
      .map((s: any) => ({ km: s.km, what: arr(s.what).filter((w) => typeof w === "string" && /^[a-z]{2,12}$/.test(w)) as string[] })) : null,
    info: info && Object.keys(info).length ? info : null,
    results: arr(x.results).filter((e) => e && Number.isInteger(e.year) && isNum(e.finishers) && e.overall && ["p10", "p25", "p50", "p75", "p90"].every((k) => isNum(e.overall[k]))).slice(0, 5)
      .map((e) => ({ year: e.year, finishers: e.finishers, overall: { p10: e.overall.p10, p25: e.overall.p25, p50: e.overall.p50, p75: e.overall.p75, p90: e.overall.p90 }, source: safeUrl(e.source, true) })),
    comment: typeof x.comment === "string" && x.comment.trim() ? x.comment.trim().slice(0, 6000) : null,
    course_source: x.course_source === "official_gpx" || x.course_source === "upload" ? x.course_source : null, ele_source: x.ele_source === "dem" ? "dem" : null,
    start: Array.isArray(x.start) && x.start.length === 2 && x.start.every(isNum) ? [x.start[0], x.start[1]] : pts.length ? [pts[0][0], pts[0][1]] : null,
    course: pts.length >= 2 ? { pts } : null,
  };
}

/** Every race in the feed, page by page (a URL), or from a file (a JSON object with "races", or a list). Throws on anything unexpected,
 *  so a run never mistakes a broken feed for an empty register. `ids`: every id the feed named, whether its race was usable or not. */
export async function readFeed(src: string, fetchFn: typeof fetch = fetch): Promise<{ races: Race[]; ids: Set<string> }> {
  const raw: unknown[] = [];
  if (/^https?:\/\//.test(src)) {
    let after: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= 500) throw new Error("feed: too many pages");
      const u = new URL(src);
      u.searchParams.set("limit", "100");
      if (after) u.searchParams.set("after", after);
      const body = await getJson(u.toString(), fetchFn);
      if (!body || body.version !== 1 || !Array.isArray(body.races)) throw new Error("feed: unexpected answer");
      raw.push(...body.races);
      after = typeof body.next === "string" && body.next ? body.next : null;
      if (!after) break;
    }
  } else {
    const body = JSON.parse(await Deno.readTextFile(src));
    const list = Array.isArray(body) ? body : body?.races;
    if (!Array.isArray(list)) throw new Error("feed file: no races");
    raw.push(...list);
  }
  const ids = new Set<string>(raw.map((r: any) => (typeof r?.id === "string" ? r.id : "")).filter(Boolean));
  return { races: raw.map(cleanRace).filter((r): r is Race => r !== null), ids };
}
async function getJson(url: string, fetchFn: typeof fetch): Promise<any> {
  for (let i = 0; ; i++) {
    let status = 0;
    try {
      const res = await fetchFn(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return await res.json();
      status = res.status;
      await res.body?.cancel();
    } catch (e) {
      if (i >= 3) throw e;
    }
    if (status && ((status < 500 && status !== 429) || i >= 3)) throw new Error(`feed: ${status}`);
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
}

// ------------------------------------------------------------------------------------------------------------- words

const LOCALE: Record<Lang, string> = { sv: "sv-SE", en: "en-GB", de: "de-DE" };
const OG_LOCALE: Record<Lang, string> = { sv: "sv_SE", en: "en_GB", de: "de_DE" };
/** Where each language lives: its folder, the pagination word, and the site's own pages in that language. */
const L: Record<Lang, { dir: string; pageWord: string; home: string; support: string; privacy: string; terms: string }> = {
  sv: { dir: "lopp", pageWord: "sida", home: "sv.html", support: "support-sv.html", privacy: "privacy.html", terms: "terms.html" },
  en: { dir: "en/races", pageWord: "page", home: "", support: "support.html", privacy: "privacy-en.html", terms: "terms-en.html" },
  de: { dir: "de/laeufe", pageWord: "seite", home: "index-de.html", support: "support-de.html", privacy: "privacy-de.html", terms: "terms-de.html" },
};

const T = {
  sv: {
    langName: "Svenska", langNav: "Språk", skip: "Hoppa till innehållet", crumbs: "Brödsmulor", home: "Mila", races: "Lopp", brandLine: "Rätt pass. Rätt dag.",
    titleTail: "bana, höjdprofil och tempoplan", indexTitle: "Lopp – banor, höjdprofiler och tempoplaner", indexH1: "Lopp att springa",
    indexLead: "Banor ur Milas loppregister med höjdprofil, klättringar, vätskekontroller och maxtider. Välj ditt lopp och få en personlig prognos, tempoplan och energiplan i Mila.",
    pageN: (n: number) => `sida ${n}`, count: (n: number) => `${n} lopp`,
    distance: "Distans", climbing: "Höjdmeter", highest: "Högsta punkt", terrain: "Underlag", character: "Karaktär", start: "Start", aid: "Vätskekontroller",
    trail: "Terräng och stig", road: "Väg", trailRace: "terränglopp", roadRace: "landsvägslopp", masl: "m ö.h.",
    hilly: ["flack", "lätt kuperad", "kuperad", "mycket kuperad", "bergig"], perKm: (x: string) => `${x} m per km`,
    profileH: "Höjdprofil", profileTitle: (n: string) => `Höjdprofil för ${n}`,
    profileDesc: (km: string, lo: string, hi: string, n: number) => `Höjden längs banans ${km}${n ? `, med ${n} ${n === 1 ? "vätskekontroll" : "vätskekontroller"} utmärkta` : ""}: från ${lo} till ${hi} m ö.h.`,
    dem: "Höjderna kommer från en höjdmodell, inte från banfilen.", routeH: "Banan", routeTitle: (n: string) => `Banans sträckning för ${n}`,
    routeDesc: (loop: boolean) => loop ? "Banans form sedd uppifrån, norr uppåt. Start och mål på samma plats." : "Banans form sedd uppifrån, norr uppåt, från start till mål.",
    legend: (loop: boolean, aid: boolean) => `${loop ? "Grön punkt: start och mål." : "Grön punkt: start. Vit punkt: mål."}${aid ? " Små gröna punkter: vätskekontroller." : ""}`,
    official: "Bana från arrangören", organiserPage: "arrangörens sida", upload: "Banan bygger på en banfil uppladdad i Mila och kan avvika från årets officiella bana.",
    aboutH: "Om banan", coachNote: "Beskrivningen är skriven av Milas coach utifrån banans data.",
    climbsH: "Klättringar", climbsCaption: "Klättringar på minst 25 höjdmeter. Lutningen är snittet från botten till toppen.",
    climbCols: ["Börjar vid", "Längd", "Höjdmeter", "Lutning", "Topp (m ö.h.)"], noClimbs: "Banan har inga sammanhängande klättringar på 25 höjdmeter eller mer.",
    aidH: "Vätskekontroller", aidOne: "Vätskekontroll", aidCaption: "Vätskekontroller enligt arrangören.", aidCols: ["Vid", "Här finns"], aidNone: "ej angivet",
    aidWords: { vatten: "vatten", sportdryck: "sportdryck", gel: "gel", mat: "mat", salt: "salt" } as Record<string, string>,
    practicalH: "Inför start", startsH: "Starttider", placeH: "Startplats", showMap: "Visa på karta", cutoffsH: "Maxtider", cutoffCaption: "Maxtider enligt arrangören.",
    cutoffCols: ["Vid", "Senast"], clock: (t: string) => `kl. ${t}`, elapsed: (h: number, m: number) => `${h} h${m ? ` ${m} min` : ""} efter start`,
    kitH: "Obligatorisk utrustning", source: "Källa", checked: (d: string) => `hämtat ${d}`, at: (km: string) => `km ${km}`,
    resultsH: "Resultat från tidigare upplagor",
    result: (y: number, n: string, p50: string, p25: string, p75: string, p10: string, p90: string) =>
      `${y} gick ${n} löpare i mål. Mediantiden var ${p50}; den mittersta hälften av fältet kom i mål mellan ${p25} och ${p75}, och 80 % mellan ${p10} och ${p90}.`,
    resultsNote: "Sammanfattat ur de officiella resultatlistorna: bara antal och tider, inga namn eller enskilda resultat.", resultSource: "resultatlistan",
    ctaH: (n: string) => `Få din personliga prognos, tempoplan och energiplan för ${n} i Mila`,
    ctaText: "Coachen planerar veckorna fram till start efter din form, och ger dig en tidsprognos, en tempoplan för varje del av banan och en plan för vätska och energi på just den här banan.",
    store: "Ladda ned på App Store", nearbyH: "Fler lopp i närheten", organizer: "Arrangör",
    disclaimer: "Uppgifterna kommer ur banfilen och arrangörens information. Kontrollera datum, starttider och regler hos arrangören.",
    prelim: "preliminärt datum", noDate: "Datum för nästa upplaga är inte klart än.", last: (d: string) => `Senast: ${d}.`,
    passed: (d: string) => `Loppet gick ${d}. Datum för nästa upplaga är inte klart än.`,
    cd: { today: "i dag", tomorrow: "i morgon", days: "om # dagar", weeks: "om # veckor", months: "om # månader", past: "har gått" },
    removedTitle: (n: string) => `${n} – finns inte längre i registret | Mila`, removed: "Loppet finns inte längre i Milas loppregister.", allRaces: "Se alla lopp",
    noDateGroup: "Datum ej klart", filterDistance: "Distans", filterCountry: "Land", all: "Alla distanser", allCountries: "Alla länder",
    buckets: ["Upp till 10 km", "11–21 km", "22–42 km", "Ultra, över 42 km"], noMatch: "Inga lopp matchar filtret.", pages: "Sidor", prev: "Föregående", next: "Nästa",
    ogAlt: (n: string) => `Höjdprofil och bana för ${n}`, ogDefault: "Lopp – bana, höjdprofil och tempoplan", support: "Support", privacy: "Integritetspolicy", terms: "Villkor",
    metaTail: "Se bana och höjdprofil och få din tempoplan i Mila.", metaAid: (n: number) => `${n} vätskekontroller`, metaClimb: (a: string) => `${a} höjdmeter`, metaHigh: (h: string) => `högsta punkt ${h} m`,
  },
  en: {
    langName: "English", langNav: "Language", skip: "Skip to content", crumbs: "Breadcrumbs", home: "Mila", races: "Races", brandLine: "The right run, on the right day.",
    titleTail: "course, elevation profile and pace plan", indexTitle: "Races – courses, elevation profiles and pace plans", indexH1: "Races to run",
    indexLead: "Courses from Mila's race register with elevation profile, climbs, aid stations and cut-off times. Pick your race and get a personal forecast, pace plan and fueling plan in Mila.",
    pageN: (n: number) => `page ${n}`, count: (n: number) => `${n} ${n === 1 ? "race" : "races"}`,
    distance: "Distance", climbing: "Elevation gain", highest: "Highest point", terrain: "Surface", character: "Profile", start: "Start", aid: "Aid stations",
    trail: "Trail", road: "Road", trailRace: "trail race", roadRace: "road race", masl: "m a.s.l.",
    hilly: ["flat", "gently rolling", "hilly", "very hilly", "mountainous"], perKm: (x: string) => `${x} m per km`,
    profileH: "Elevation profile", profileTitle: (n: string) => `Elevation profile of ${n}`,
    profileDesc: (km: string, lo: string, hi: string, n: number) => `Elevation along the ${km} course${n ? `, with ${n} aid ${n === 1 ? "station" : "stations"} marked` : ""}: from ${lo} to ${hi} m above sea level.`,
    dem: "Elevations come from an elevation model, not from the course file.", routeH: "The course", routeTitle: (n: string) => `Course map of ${n}`,
    routeDesc: (loop: boolean) => loop ? "The course seen from above, north up. Start and finish in the same place." : "The course seen from above, north up, from start to finish.",
    legend: (loop: boolean, aid: boolean) => `${loop ? "Green dot: start and finish." : "Green dot: start. White dot: finish."}${aid ? " Small green dots: aid stations." : ""}`,
    official: "Course from the organizer", organiserPage: "organizer's website", upload: "The course is based on a course file uploaded in Mila and may differ from this year's official course.",
    aboutH: "About the course", coachNote: "",
    climbsH: "Climbs", climbsCaption: "Climbs of at least 25 m elevation gain. The gradient is the average from bottom to top.",
    climbCols: ["Starts at", "Length", "Gain", "Gradient", "Top (m above sea level)"], noClimbs: "The course has no sustained climbs of 25 m or more.",
    aidH: "Aid stations", aidOne: "Aid station", aidCaption: "Aid stations per the organizer.", aidCols: ["At", "What's there"], aidNone: "not specified",
    aidWords: { vatten: "water", sportdryck: "sports drink", gel: "gels", mat: "food", salt: "salt" } as Record<string, string>,
    practicalH: "Before the start", startsH: "Start times", placeH: "Start location", showMap: "Show on map", cutoffsH: "Cut-off times", cutoffCaption: "Cut-off times per the organizer.",
    cutoffCols: ["At", "By"], clock: (t: string) => t, elapsed: (h: number, m: number) => `${h} h${m ? ` ${m} min` : ""} after the start`,
    kitH: "Mandatory gear", source: "Source", checked: (d: string) => `retrieved ${d}`, at: (km: string) => `km ${km}`,
    resultsH: "Results from earlier editions",
    result: (y: number, n: string, p50: string, p25: string, p75: string, p10: string, p90: string) =>
      `In ${y}, ${n} runners finished. The median finish time was ${p50}; the middle half of the field finished between ${p25} and ${p75}, and 80 % between ${p10} and ${p90}.`,
    resultsNote: "Summarised from the official results: counts and times only, no names or individual results.", resultSource: "results",
    ctaH: (n: string) => `Get your personal forecast, pace plan and fueling plan for ${n} in Mila`,
    ctaText: "The coach plans your weeks up to race day around your form, and gives you a finish-time forecast, a pace plan for every part of the course and a fueling plan for this very course.",
    store: "Download on the App Store", nearbyH: "More races nearby", organizer: "Organizer",
    disclaimer: "Details come from the course file and the organizer's information. Check the date, start times and rules with the organizer.",
    prelim: "preliminary date", noDate: "The date of the next edition is not set yet.", last: (d: string) => `Last held: ${d}.`,
    passed: (d: string) => `The race took place on ${d}. The date of the next edition is not set yet.`,
    cd: { today: "today", tomorrow: "tomorrow", days: "in # days", weeks: "in # weeks", months: "in # months", past: "has taken place" },
    removedTitle: (n: string) => `${n} – no longer in the register | Mila`, removed: "This race is no longer in Mila's race register.", allRaces: "See all races",
    noDateGroup: "Date not set", filterDistance: "Distance", filterCountry: "Country", all: "All distances", allCountries: "All countries",
    buckets: ["Up to 10 km", "11–21 km", "22–42 km", "Ultra, over 42 km"], noMatch: "No races match the filter.", pages: "Pages", prev: "Previous", next: "Next",
    ogAlt: (n: string) => `Elevation profile and course of ${n}`, ogDefault: "Races – course, elevation profile and pace plan", support: "Support", privacy: "Privacy policy", terms: "Terms of use",
    metaTail: "See the course and elevation profile and get your pace plan in Mila.", metaAid: (n: number) => `${n} aid stations`, metaClimb: (a: string) => `${a} m of climbing`, metaHigh: (h: string) => `highest point ${h} m`,
  },
  de: {
    langName: "Deutsch", langNav: "Sprache", skip: "Zum Inhalt springen", crumbs: "Brotkrümelnavigation", home: "Mila", races: "Läufe", brandLine: "Der richtige Lauf am richtigen Tag.",
    titleTail: "Strecke, Höhenprofil und Pace-Plan", indexTitle: "Läufe – Strecken, Höhenprofile und Pace-Pläne", indexH1: "Läufe zum Mitlaufen",
    indexLead: "Strecken aus Milas Laufregister mit Höhenprofil, Anstiegen, Verpflegungsstellen und Zeitlimits. Wähle deinen Lauf und hol dir in Mila deine persönliche Prognose, deinen Pace-Plan und deinen Verpflegungsplan.",
    pageN: (n: number) => `Seite ${n}`, count: (n: number) => `${n} ${n === 1 ? "Lauf" : "Läufe"}`,
    distance: "Distanz", climbing: "Höhenmeter", highest: "Höchster Punkt", terrain: "Untergrund", character: "Profil", start: "Start", aid: "Verpflegungsstellen",
    trail: "Trail und Gelände", road: "Straße", trailRace: "Traillauf", roadRace: "Straßenlauf", masl: "m ü. M.",
    hilly: ["flach", "leicht wellig", "hügelig", "sehr hügelig", "bergig"], perKm: (x: string) => `${x} m pro km`,
    profileH: "Höhenprofil", profileTitle: (n: string) => `Höhenprofil von ${n}`,
    profileDesc: (km: string, lo: string, hi: string, n: number) => `Die Höhe entlang der ${km} langen Strecke${n ? `, mit ${n} ${n === 1 ? "markierter Verpflegungsstelle" : "markierten Verpflegungsstellen"}` : ""}: von ${lo} bis ${hi} m ü. M.`,
    dem: "Die Höhen stammen aus einem Höhenmodell, nicht aus der Streckendatei.", routeH: "Die Strecke", routeTitle: (n: string) => `Streckenverlauf von ${n}`,
    routeDesc: (loop: boolean) => loop ? "Die Strecke von oben, Norden oben. Start und Ziel am selben Ort." : "Die Strecke von oben, Norden oben, vom Start bis ins Ziel.",
    legend: (loop: boolean, aid: boolean) => `${loop ? "Grüner Punkt: Start und Ziel." : "Grüner Punkt: Start. Weißer Punkt: Ziel."}${aid ? " Kleine grüne Punkte: Verpflegungsstellen." : ""}`,
    official: "Strecke vom Veranstalter", organiserPage: "Website des Veranstalters", upload: "Die Strecke beruht auf einer in Mila hochgeladenen Streckendatei und kann von der diesjährigen offiziellen Strecke abweichen.",
    aboutH: "Über die Strecke", coachNote: "",
    climbsH: "Anstiege", climbsCaption: "Anstiege ab 25 Höhenmetern. Die Steigung ist der Schnitt vom Fuß bis zum Gipfel.",
    climbCols: ["Beginnt bei", "Länge", "Höhenmeter", "Steigung", "Gipfel (m ü. M.)"], noClimbs: "Die Strecke hat keine zusammenhängenden Anstiege ab 25 Höhenmetern.",
    aidH: "Verpflegungsstellen", aidOne: "Verpflegungsstelle", aidCaption: "Verpflegungsstellen laut Veranstalter.", aidCols: ["Bei", "Angebot"], aidNone: "keine Angabe",
    aidWords: { vatten: "Wasser", sportdryck: "Sportgetränk", gel: "Gels", mat: "Essen", salt: "Salz" } as Record<string, string>,
    practicalH: "Vor dem Start", startsH: "Startzeiten", placeH: "Startort", showMap: "Auf der Karte zeigen", cutoffsH: "Zeitlimits", cutoffCaption: "Zeitlimits laut Veranstalter.",
    cutoffCols: ["Bei", "Spätestens"], clock: (t: string) => `${t} Uhr`, elapsed: (h: number, m: number) => `${h} h${m ? ` ${m} min` : ""} nach dem Start`,
    kitH: "Pflichtausrüstung", source: "Quelle", checked: (d: string) => `abgerufen am ${d}`, at: (km: string) => `km ${km}`,
    resultsH: "Ergebnisse früherer Ausgaben",
    result: (y: number, n: string, p50: string, p25: string, p75: string, p10: string, p90: string) =>
      `${y} kamen ${n} Läuferinnen und Läufer ins Ziel. Die Medianzeit lag bei ${p50}; die mittlere Hälfte des Feldes kam zwischen ${p25} und ${p75} ins Ziel, 80 % zwischen ${p10} und ${p90}.`,
    resultsNote: "Zusammengefasst aus den offiziellen Ergebnislisten: nur Anzahlen und Zeiten, keine Namen oder Einzelergebnisse.", resultSource: "Ergebnisliste",
    ctaH: (n: string) => `Hol dir deine persönliche Prognose, deinen Pace-Plan und deinen Verpflegungsplan für ${n} in Mila`,
    ctaText: "Der Coach plant deine Wochen bis zum Start nach deiner Form und gibt dir eine Zielzeitprognose, einen Pace-Plan für jeden Abschnitt und einen Verpflegungsplan für genau diese Strecke.",
    store: "Im App Store laden", nearbyH: "Weitere Läufe in der Nähe", organizer: "Veranstalter",
    disclaimer: "Die Angaben stammen aus der Streckendatei und den Informationen des Veranstalters. Prüfe Datum, Startzeiten und Regeln beim Veranstalter.",
    prelim: "vorläufiges Datum", noDate: "Das Datum der nächsten Ausgabe steht noch nicht fest.", last: (d: string) => `Zuletzt: ${d}.`,
    passed: (d: string) => `Der Lauf fand am ${d} statt. Das Datum der nächsten Ausgabe steht noch nicht fest.`,
    cd: { today: "heute", tomorrow: "morgen", days: "in # Tagen", weeks: "in # Wochen", months: "in # Monaten", past: "hat stattgefunden" },
    removedTitle: (n: string) => `${n} – nicht mehr im Register | Mila`, removed: "Dieser Lauf ist nicht mehr in Milas Laufregister.", allRaces: "Alle Läufe ansehen",
    noDateGroup: "Datum offen", filterDistance: "Distanz", filterCountry: "Land", all: "Alle Distanzen", allCountries: "Alle Länder",
    buckets: ["Bis 10 km", "11–21 km", "22–42 km", "Ultra, über 42 km"], noMatch: "Keine Läufe passen zum Filter.", pages: "Seiten", prev: "Zurück", next: "Weiter",
    ogAlt: (n: string) => `Höhenprofil und Strecke von ${n}`, ogDefault: "Läufe – Strecke, Höhenprofil und Pace-Plan", support: "Support", privacy: "Datenschutzerklärung", terms: "Nutzungsbedingungen",
    metaTail: "Strecke und Höhenprofil ansehen und deinen Pace-Plan in Mila holen.", metaAid: (n: number) => `${n} Verpflegungsstellen`, metaClimb: (a: string) => `${a} Höhenmeter`, metaHigh: (h: string) => `höchster Punkt ${h} m`,
  },
};

// ------------------------------------------------------------------------------------------------------------- formatting

/** Text for HTML and XML, in text and in attributes. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/** JSON-LD inside a script element: no "<", ">" or "&" that could end it, and no line separators. */
export function jsonLd(o: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")}</script>`;
}
const nf = new Map<string, Intl.NumberFormat>();
export function num(x: number, lang: Lang, dec = 0): string {
  const k = `${lang}${dec}`;
  if (!nf.has(k)) nf.set(k, new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: dec, maximumFractionDigits: dec }));
  return nf.get(k)!.format(x);
}
const nearInt = (x: number, tol: number) => Math.abs(x - Math.round(x)) < tol;
/** "21,1 km" (one decimal unless whole). */
export const kmText = (km: number, lang: Lang) => `${num(km, lang, nearInt(km, 0.05) ? 0 : 1)} km`;
/** The distance in a name: whole kilometres when within 150 m of one ("21 km"), else one decimal. */
const kmShort = (km: number, lang: Lang) => `${num(km, lang, nearInt(km, 0.15) ? 0 : 1)} km`;
const lenText = (m: number, lang: Lang) => (m >= 1000 ? kmText(m / 1000, lang) : `${num(Math.round(m / 10) * 10, lang)} m`);
/** The name already holds the distance ("Ultravasan 90", "Lidingöloppet 30 km"). */
export function nameHasKm(name: string, km: number): boolean {
  const d1 = String(Math.round(km * 10) / 10);
  return [String(Math.round(km)), d1, d1.replace(".", ",")].some((v) => new RegExp(`(^|[^0-9.,])${v.replace(".", "\\.")}(?![0-9])`).test(name));
}
/** The race's name as headlines show it: with the distance unless the name has it. */
export const raceTitle = (r: Pick<Race, "name" | "km">, lang: Lang) => (nameHasKm(r.name, r.km) ? r.name : `${r.name} ${kmShort(r.km, lang)}`);
const dayDate = (day: string) => new Date(`${day}T12:00:00Z`);
export const dateLong = (day: string, lang: Lang) => dayDate(day).toLocaleDateString(LOCALE[lang], { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const dateShort = (day: string, lang: Lang) => dayDate(day).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);
const monthLabel = (ym: string, lang: Lang) => cap(dayDate(`${ym}-15`).toLocaleDateString(LOCALE[lang], { month: "long", year: "numeric", timeZone: "UTC" }));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
/** The time left, coarse so a page changes seldom (months from 60 days, then weeks from 14, then days); the browser refines it the same way. */
export function countdown(day: string, today: string, lang: Lang): string {
  const n = daysBetween(today, day), w = T[lang].cd;
  if (n < 0) return w.past;
  if (n === 0) return w.today;
  if (n === 1) return w.tomorrow;
  if (n < 14) return w.days.replace("#", String(n));
  if (n < 60) return w.weeks.replace("#", String(Math.floor(n / 7)));
  return w.months.replace("#", String(Math.round(n / 30.44)));
}
const clockTime = (s: number) => {
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
const regionNames = new Map<Lang, Intl.DisplayNames>();
export function countryName(r: Pick<Race, "country" | "country_code">, lang: Lang): string | null {
  if (r.country_code) {
    try {
      if (!regionNames.has(lang)) regionNames.set(lang, new Intl.DisplayNames([LOCALE[lang]], { type: "region" }));
      const n = regionNames.get(lang)!.of(r.country_code);
      if (n && n !== r.country_code) return n;
    } catch { /* an unknown code: the register's own text */ }
  }
  return r.country;
}
const whereText = (r: Race, lang: Lang) => [r.place, countryName(r, lang)].filter(Boolean).join(", ");
/** 0 flat … 4 mountainous, from the climbing per km. */
export const hilliness = (r: Pick<Race, "ascent" | "km">) => { const x = r.ascent / r.km; return x < 6 ? 0 : x < 15 ? 1 : x < 30 ? 2 : x < 60 ? 3 : 4; };
const bucketOf = (km: number) => (km <= 10.5 ? "a" : km <= 21.5 ? "b" : km <= 42.5 ? "c" : "d");
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

// time zones of countries with a single zone (the start's UTC offset in the event markup); elsewhere local time without an offset
const TZ: Record<string, string> = { SE: "Europe/Stockholm", NO: "Europe/Oslo", DK: "Europe/Copenhagen", FI: "Europe/Helsinki", IS: "Atlantic/Reykjavik",
  DE: "Europe/Berlin", AT: "Europe/Vienna", CH: "Europe/Zurich", NL: "Europe/Amsterdam", BE: "Europe/Brussels", LU: "Europe/Luxembourg", FR: "Europe/Paris",
  IT: "Europe/Rome", GB: "Europe/London", IE: "Europe/Dublin", PL: "Europe/Warsaw", CZ: "Europe/Prague", SK: "Europe/Bratislava", SI: "Europe/Ljubljana",
  HR: "Europe/Zagreb", HU: "Europe/Budapest", EE: "Europe/Tallinn", LV: "Europe/Riga", LT: "Europe/Vilnius", GR: "Europe/Athens", AD: "Europe/Andorra",
  MC: "Europe/Monaco", JP: "Asia/Tokyo", ZA: "Africa/Johannesburg", NP: "Asia/Kathmandu", KE: "Africa/Nairobi" };
function offsetMin(ms: number, tz: string): number {
  const v = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d\d):(\d\d)/.exec(v);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
/** This distance's start time: the start marked as this race's, else the only one. */
const mainStart = (r: Race) => { const s = r.info?.starts ?? []; return (s.find((x) => x.main) ?? (s.length === 1 ? s[0] : undefined))?.time ?? null; };
/** The event's start for schema.org: the day, with the start time and the country's UTC offset when known. */
export function startDate(r: Race): string | null {
  if (!r.next_date) return null;
  const s = mainStart(r);
  if (!s) return r.next_date;
  const tz = r.country_code ? TZ[r.country_code] : undefined;
  if (!tz) return `${r.next_date}T${s}:00`;
  const guess = Date.parse(`${r.next_date}T${s}:00Z`), off = offsetMin(guess - offsetMin(guess, tz) * 60e3, tz), a = Math.abs(off);
  return `${r.next_date}T${s}:00${off < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------------------------------------------------------- addresses

/** Site paths without the leading slash; every page is a folder with index.html. */
export const racePath = (lang: Lang, slug: string) => `${L[lang].dir}/${slug}/`;
export const indexPath = (lang: Lang, page = 1) => (page <= 1 ? `${L[lang].dir}/` : `${L[lang].dir}/${L[lang].pageWord}/${page}/`);
export const abs = (path: string) => `${SITE}/${path}`;
const rel = (from: string, to: string) => "../".repeat(from.split("/").filter(Boolean).length) + to;
const ogPath = (slug: string) => `lopp/${slug}/og.png`;
const ogDefaultPath = (lang: Lang) => `${L[lang].dir}/og.png`;

// ------------------------------------------------------------------------------------------------------------- drawings

const f1 = (x: number) => String(Math.round(x * 10) / 10);
/** A round step for an axis: the smallest of `steps` with at most `n` steps over `span`. */
const step = (span: number, n: number, steps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) => steps.find((s) => span / s <= n) ?? steps[steps.length - 1];
function at(pts: Point[], km: number): Point {
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][3] >= km) { const a = pts[i - 1], b = pts[i], f = b[3] > a[3] ? (km - a[3]) / (b[3] - a[3]) : 0; return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2]), km]; }
  }
  return pts[pts.length - 1];
}
const havKm = (a: number[], b: number[]) => {
  const p1 = (a[0] * Math.PI) / 180, p2 = (b[0] * Math.PI) / 180, dl = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const isLoop = (pts: Point[]) => havKm(pts[0], pts[pts.length - 1]) < 0.3;
const eleRange = (pts: Point[]) => { const e = pts.map((p) => p[2]); return [Math.round(Math.min(...e)), Math.round(Math.max(...e))]; };

/** The elevation profile as inline SVG: the km axis, the height on the left, the organiser's aid stations marked. */
export function profileSvg(r: Race, lang: Lang): string {
  const pts = r.course!.pts, t = T[lang], W = 720, H = 236, L0 = 62, R0 = 14, T0 = 16, B0 = 36, pw = W - L0 - R0, ph = H - T0 - B0;
  const kmMax = Math.max(pts[pts.length - 1][3], 0.1), [eMin, eMax] = eleRange(pts);
  let lo = eMin, hi = eMax;
  if (hi - lo < 40) { const mid = (hi + lo) / 2; lo = mid - 20; hi = mid + 20; }
  const es = step(hi - lo, 4, [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]);
  lo = Math.floor(lo / es) * es; hi = Math.ceil(hi / es) * es;
  const X = (km: number) => L0 + (km / kmMax) * pw, Y = (e: number) => T0 + ((hi - e) / (hi - lo)) * ph;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${f1(X(p[3]))} ${f1(Y(p[2]))}`).join(""), base = f1(T0 + ph);
  let g = "";
  for (let e = lo; e <= hi + 1e-6; e += es) g += `<line class="gl" x1="${L0}" x2="${W - R0}" y1="${f1(Y(e))}" y2="${f1(Y(e))}"/><text class="ax" x="${L0 - 6}" y="${f1(Y(e) + 4)}" text-anchor="end">${esc(num(e, lang))}${e + es > hi + 1e-6 ? " m" : ""}</text>`;
  const ks = step(kmMax, 9);
  for (let k = 0; X(k) <= W - R0 - 72; k += ks) g += `<text class="ax" x="${f1(X(k))}" y="${H - 14}" text-anchor="middle">${esc(num(k, lang, nearInt(k, 0.01) ? 0 : 1))}</text>`;
  g += `<text class="ax" x="${W - R0}" y="${H - 14}" text-anchor="end">${esc(kmText(kmMax, lang))}</text>`;
  const aid = (r.aid_stations ?? []).map((s) => {
    const x = f1(X(Math.min(s.km, kmMax))), y = f1(Y(at(pts, s.km)[2]));
    const what = s.what.length ? s.what.map((w) => t.aidWords[w] ?? w).join(", ") : t.aidNone;
    return `<g><title>${esc(`${t.aidOne}, ${t.at(num(s.km, lang, 1))}: ${what}`)}</title><line class="aml" x1="${x}" x2="${x}" y1="${y}" y2="${base}"/><circle class="am" cx="${x}" cy="${y}" r="5"/></g>`;
  }).join("");
  const id = `prof-${lang}`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-t ${id}-d" xmlns="http://www.w3.org/2000/svg"><title id="${id}-t">${esc(t.profileTitle(raceTitle(r, lang)))}</title><desc id="${id}-d">${esc(t.profileDesc(kmText(r.km, lang), num(eMin, lang), num(eMax, lang), (r.aid_stations ?? []).length))}</desc>${g}<path class="pf" d="${line}L${f1(X(kmMax))} ${base}L${f1(X(0))} ${base}Z"/><path class="pl" d="${line}"/>${aid}</svg>`;
}

/** The course's shape as inline SVG, seen from above with north up (no map tiles): start, finish, aid stations and a scale bar. */
export function routeSvg(r: Race, lang: Lang): string {
  const pts = r.course!.pts, t = T[lang], W = 600, pad = 26, lat0 = (pts[0][0] * Math.PI) / 180;
  const xs = pts.map((p) => p[1] * Math.cos(lat0)), ys = pts.map((p) => -p[0]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), dx = Math.max(Math.max(...xs) - x0, 1e-4), dy = Math.max(Math.max(...ys) - y0, 1e-4);
  const s = Math.min((W - 2 * pad) / dx, (440 - 2 * pad) / dy), H = Math.max(Math.round(dy * s + 2 * pad + 30), 190);
  const ox = (W - dx * s) / 2, oy = 14 + (H - 30 - dy * s) / 2;
  const P = (lat: number, lon: number): [string, string] => [f1(ox + (lon * Math.cos(lat0) - x0) * s), f1(oy + (-lat - y0) * s)];
  const d = pts.map((p, i) => { const [x, y] = P(p[0], p[1]); return `${i ? "L" : "M"}${x} ${y}`; }).join("");
  const loop = isLoop(pts), [sx, sy] = P(pts[0][0], pts[0][1]), last = pts[pts.length - 1], [fx, fy] = P(last[0], last[1]);
  const aid = (r.aid_stations ?? []).map((a) => { const p = at(pts, a.km), [x, y] = P(p[0], p[1]); return `<circle class="am" cx="${x}" cy="${y}" r="4.5"/>`; }).join("");
  // a scale bar of a round length, at least 120 px
  const pxPerKm = s / 111.32, bar = step(120 / pxPerKm, 1, [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]), bw = bar * pxPerKm;
  const scale = `<line class="sb" x1="${pad}" x2="${f1(pad + bw)}" y1="${H - 10}" y2="${H - 10}"/><text class="ax" x="${pad}" y="${H - 16}">${esc(bar < 1 ? `${num(bar * 1000, lang)} m` : `${num(bar, lang)} km`)}</text>`;
  const ends = loop ? `<circle class="st" cx="${sx}" cy="${sy}" r="8"/>` : `<circle class="fi" cx="${fx}" cy="${fy}" r="7"/><circle class="st" cx="${sx}" cy="${sy}" r="7"/>`;
  const id = `route-${lang}`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-t ${id}-d" xmlns="http://www.w3.org/2000/svg"><title id="${id}-t">${esc(t.routeTitle(raceTitle(r, lang)))}</title><desc id="${id}-d">${esc(t.routeDesc(loop))}</desc><path class="rt" d="${d}"/>${aid}${ends}${scale}<text class="ax" x="${W - 10}" y="18" text-anchor="end">N ↑</text></svg>`;
}

/** Words into lines of about `max` characters, at most `lines` (the last cut with an ellipsis). */
function wrap(s: string, max: number, lines = 3): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(/ +/)) {
    if (cur && (cur + " " + w).length > max) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].slice(0, max - 1) + "…"; }
  return out.map((l) => (l.length > max + 6 ? l.slice(0, max + 5) + "…" : l));
}
/** The share image (1200×630) as SVG for resvg: the name, distance and climbing, the course's shape and its profile. One image per race
 *  for all three languages, so the only text on it is the name, the numbers and the place. */
export function ogSvg(r: Race): string {
  const lang: Lang = r.country_code && ["GB", "IE", "US", "CA", "AU", "NZ"].includes(r.country_code) ? "en" : "sv";
  const name = raceTitle(r, lang).replace(/ (?=km$)/, "\u00a0");
  let size = 64, lines = wrap(name, 17, 3);
  if (lines.length > 2) { size = 50; lines = wrap(name, 22, 3); }
  const sub = [kmText(r.km, lang), r.ascent ? `↑ ${num(r.ascent, lang)} m` : "", [r.place, r.country_code].filter(Boolean).join(", ")].filter(Boolean).join("  ·  ");
  let y = 186;
  const text = lines.map((l) => { const s = `<text x="64" y="${f1(y)}" font-size="${size}" font-weight="700" fill="#E8ECF3">${esc(l)}</text>`; y += size * 1.14; return s; }).join("");
  let art = "";
  if (r.course) {
    const pts = r.course.pts, [lo, top] = eleRange(pts), hi = Math.max(top, lo + 40), kmMax = Math.max(pts[pts.length - 1][3], 0.1);
    const X = (k: number) => 64 + (k / kmMax) * 1072, Y = (e: number) => 588 - ((e - lo) / (hi - lo)) * 120;
    const line = pts.map((p, i) => `${i ? "L" : "M"}${f1(X(p[3]))} ${f1(Y(p[2]))}`).join("");
    art += `<path d="${line}L1136 596L64 596Z" fill="#6E8FFF" fill-opacity="0.25"/><path d="${line}" fill="none" stroke="#6E8FFF" stroke-width="4" stroke-linejoin="round"/>`;
    const lat0 = (pts[0][0] * Math.PI) / 180, xs = pts.map((p) => p[1] * Math.cos(lat0)), ys = pts.map((p) => -p[0]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), dx = Math.max(Math.max(...xs) - x0, 1e-4), dy = Math.max(Math.max(...ys) - y0, 1e-4), s = Math.min(290 / dx, 260 / dy);
    const ox = 846 + (290 - dx * s) / 2, oy = 56 + (260 - dy * s) / 2;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${f1(ox + (xs[i] - x0) * s)} ${f1(oy + (ys[i] - y0) * s)}`).join("");
    art += `<path d="${d}" fill="none" stroke="#E8ECF3" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${f1(ox + (xs[0] - x0) * s)}" cy="${f1(oy + (ys[0] - y0) * s)}" r="9" fill="#3CCB7F"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${ogScene(r)}`
    + `<text x="64" y="92" font-size="30" font-weight="700" letter-spacing="5" fill="#6E8FFF">MILA</text>${text}`
    + `<text x="64" y="${f1(y + 6)}" font-size="32" fill="#AEB7C6">${esc(sub)}</text>${art}`
    + `<text x="1136" y="620" font-size="19" fill="#7F8A9C" text-anchor="end">milacoach.app</text></svg>`;
}
/** The race's scene behind its share image (scene.ts: the same picture as the page's hero), under a scrim heaviest behind the text on
 *  the left and along the bottom (the profile, the address); no grain, which only makes the PNG heavier at this size. */
export function ogScene(r: Race): string {
  const s = sceneLayers(raceSceneSpec(r, { startIso: startDate(r) }), { width: 1200, height: 630, idPrefix: "og", grain: false });
  return `<defs>${s.defs}<linearGradient id="ogScrim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0D1119" stop-opacity="0.88"/><stop offset="0.55" stop-color="#0D1119" stop-opacity="0.66"/><stop offset="1" stop-color="#0D1119" stop-opacity="0.45"/></linearGradient>`
    + `<linearGradient id="ogFoot" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#0D1119" stop-opacity="0"/><stop offset="1" stop-color="#0D1119" stop-opacity="0.7"/></linearGradient></defs>`
    + `<rect width="1200" height="630" fill="#0D1119"/><g transform="scale(${Math.round((1200 / s.unitsWide) * 1e6) / 1e6})">${s.body}</g>`
    + `<rect width="1200" height="630" fill="url(#ogScrim)"/><rect width="1200" height="630" fill="url(#ogFoot)"/>`;
}
/** The default share image of a language's race pages (the indexes, and races without their own image). */
export function ogDefaultSvg(lang: Lang): string {
  const t = T[lang];
  let y = 220;
  const text = wrap(t.ogDefault, 24, 3).map((l) => { const s = `<text x="64" y="${y}" font-size="60" font-weight="700" fill="#E8ECF3">${esc(l)}</text>`; y += 70; return s; }).join("");
  const wave = Array.from({ length: 61 }, (_, i) => `${i ? "L" : "M"}${f1(64 + i * (1072 / 60))} ${f1(540 - (Math.sin(i / 6) * 40 + Math.sin(i / 2.3) * 14))}`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0D1119"/>`
    + `<text x="64" y="110" font-size="34" font-weight="700" letter-spacing="6" fill="#6E8FFF">MILA</text>${text}<text x="64" y="${y + 10}" font-size="36" fill="#AEB7C6">${esc(t.brandLine)}</text>`
    + `<path d="${wave}L1136 600L64 600Z" fill="#6E8FFF" fill-opacity="0.25"/><path d="${wave}" fill="none" stroke="#6E8FFF" stroke-width="4"/><text x="1136" y="620" font-size="19" fill="#7F8A9C" text-anchor="end">milacoach.app</text></svg>`;
}

/** resvg (WebAssembly, no native code) with DejaVu Sans, both fetched from pinned CDN addresses; null when they cannot be had (the
 *  pages then use the images already there, or the default ones). */
export async function resvgRenderer(fetchFn: typeof fetch = fetch): Promise<PngRenderer | null> {
  try {
    const spec = ["npm:@resvg", "resvg-wasm@2.6.2"].join("/");   // built at run time, so tests and type checks never load it
    const m: any = await import(spec);
    await m.initWasm(fetchFn(RESVG_WASM));
    const fonts = await Promise.all(FONT_URLS.map(async (u) => { const r = await fetchFn(u); if (!r.ok) throw new Error(`font ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }));
    return (svg: string) => new m.Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: "DejaVu Sans", loadSystemFonts: false } }).render().asPng();
  } catch (e) {
    console.warn(`race pages: no PNG renderer (${String(e).slice(0, 120)}); existing or default images are used`);
    return null;
  }
}

// ------------------------------------------------------------------------------------------------------------- page parts

/** The course in a few sentences from its numbers alone, in the page's language (the English and German pages, and a Swedish page
 *  without the coach's description). */
export function aboutText(r: Race, lang: Lang): string[] {
  const t = T[lang], k = kmText(r.km, lang), where = whereText(r, lang), title = r.name, h = t.hilly[hilliness(r)];
  const perKm = num(r.ascent / r.km, lang, r.ascent / r.km < 10 ? 1 : 0), hasEle = r.max_ele !== null && r.min_ele !== null;
  const climbs = [...r.climbs].sort((a, b) => a.km - b.km), big = [...r.climbs].sort((a, b) => b.gain - a.gain)[0], lastC = climbs[climbs.length - 1];
  const out: string[] = [];
  if (lang === "sv") {
    out.push(`${title} är ett ${r.trail ? t.trailRace : t.roadRace}${where ? ` i ${where}` : ""} på ${k}. Banan har ${num(r.ascent, lang)} höjdmeter uppför${r.descent !== null ? ` och ${num(r.descent, lang)} nedför` : ""}, ${t.perKm(perKm)}, och räknas därmed som ${h}.${hasEle ? ` Högsta punkten ligger ${num(r.max_ele!, lang)} m ö.h. och den lägsta ${num(r.min_ele!, lang)} m ö.h.` : ""}`);
    out.push(big ? `Den största klättringen börjar vid km ${num(big.km, lang, 1)}: ${num(big.gain, lang)} höjdmeter på ${lenText(big.len, lang)} med ${num(big.grade, lang, 1)} % i snitt, upp till ${num(big.top, lang)} m ö.h.${climbs.length > 1 ? ` Totalt har banan ${climbs.length} klättringar på minst 25 höjdmeter; den sista börjar vid km ${num(lastC.km, lang, 1)}.` : ""}` : t.noClimbs);
  } else if (lang === "en") {
    out.push(`${title} is a ${r.trail ? t.trailRace : t.roadRace}${where ? ` in ${where}${where.includes(",") ? "," : ""}` : ""} over ${k}. The course climbs ${num(r.ascent, lang)} m${r.descent !== null ? ` and descends ${num(r.descent, lang)} m` : ""} in total, ${t.perKm(perKm)}, which makes it ${h}.${hasEle ? ` The highest point is ${num(r.max_ele!, lang)} m above sea level and the lowest ${num(r.min_ele!, lang)} m.` : ""}`);
    out.push(big ? `The biggest climb starts at km ${num(big.km, lang, 1)}: ${num(big.gain, lang)} m of ascent over ${lenText(big.len, lang)} at ${num(big.grade, lang, 1)} % on average, up to ${num(big.top, lang)} m.${climbs.length > 1 ? ` In total the course has ${climbs.length} climbs of at least 25 m; the last one starts at km ${num(lastC.km, lang, 1)}.` : ""}` : t.noClimbs);
  } else {
    out.push(`${title} ist ein ${r.trail ? t.trailRace : t.roadRace}${where ? ` in ${where}${where.includes(",") ? "," : ""}` : ""} über ${k}. Die Strecke hat insgesamt ${num(r.ascent, lang)} Höhenmeter bergauf${r.descent !== null ? ` und ${num(r.descent, lang)} bergab` : ""}, ${t.perKm(perKm)}, und ist damit ${h}.${hasEle ? ` Der höchste Punkt liegt auf ${num(r.max_ele!, lang)} m ü. M., der tiefste auf ${num(r.min_ele!, lang)} m.` : ""}`);
    out.push(big ? `Der größte Anstieg beginnt bei km ${num(big.km, lang, 1)}: ${num(big.gain, lang)} Höhenmeter auf ${lenText(big.len, lang)} mit durchschnittlich ${num(big.grade, lang, 1)} % Steigung, bis auf ${num(big.top, lang)} m.${climbs.length > 1 ? ` Insgesamt hat die Strecke ${climbs.length} Anstiege ab 25 Höhenmetern; der letzte beginnt bei km ${num(lastC.km, lang, 1)}.` : ""}` : t.noClimbs);
  }
  const aid = r.aid_stations ?? [], cuts = r.info?.cutoffs ?? [];
  const a0 = aid.length ? num(aid[0].km, lang, 1) : "", a1 = aid.length ? num(aid[aid.length - 1].km, lang, 1) : "";
  const p3 = lang === "sv"
    ? `${aid.length ? `Arrangören har ${aid.length === 1 ? `en vätskekontroll längs banan, vid km ${a0}` : `${aid.length} vätskekontroller längs banan, den första vid km ${a0} och den sista vid km ${a1}`}.` : ""}${cuts.length ? ` Det finns ${cuts.length === 1 ? "en maxtid" : `${cuts.length} maxtider`} längs banan.` : ""}`
    : lang === "en"
    ? `${aid.length ? `The organizer lists ${aid.length === 1 ? `one aid station, at km ${a0}` : `${aid.length} aid stations, the first at km ${a0} and the last at km ${a1}`}.` : ""}${cuts.length ? ` There ${cuts.length === 1 ? "is one cut-off time" : `are ${cuts.length} cut-off times`} along the course.` : ""}`
    : `${aid.length ? `Der Veranstalter nennt ${aid.length === 1 ? `eine Verpflegungsstelle bei km ${a0}` : `${aid.length} Verpflegungsstellen, die erste bei km ${a0} und die letzte bei km ${a1}`}.` : ""}${cuts.length ? ` Entlang der Strecke gibt es ${cuts.length === 1 ? "ein Zeitlimit" : `${cuts.length} Zeitlimits`}.` : ""}`;
  if (p3.trim()) out.push(p3.trim());
  if (lang === "en") out.push("In the Mila app, the coach describes the course in detail in your language and plans your pacing and fueling for it.");
  if (lang === "de") out.push("In der Mila-App beschreibt der Coach die Strecke ausführlich in deiner Sprache und plant dein Pacing und deine Verpflegung dafür.");
  return out;
}

function metaDescription(r: Race, lang: Lang): string {
  const t = T[lang], where = r.place ?? countryName(r, lang);
  const facts = [r.ascent ? t.metaClimb(num(r.ascent, lang)) : "", r.max_ele !== null ? t.metaHigh(num(r.max_ele, lang)) : "", r.aid_stations?.length ? t.metaAid(r.aid_stations.length) : ""].filter(Boolean).join(", ");
  const head = [raceTitle(r, lang), where, r.next_date ? dateShort(r.next_date, lang) : ""].filter(Boolean).join(", ");
  const s = `${head}${facts ? `: ${facts}` : ""}.`;
  if (s.length + t.metaTail.length < 160) return `${s} ${t.metaTail}`;
  return s.length <= 160 ? s : s.slice(0, 157).replace(/\s+\S*$/, "") + " …";
}
/** "Härnö Trail 21 km 2027 – bana, höjdprofil och tempoplan | Mila" */
export function pageTitle(r: Race, lang: Lang): string {
  const y = r.next_date?.slice(0, 4), name = raceTitle(r, lang);
  return `${name}${y && !name.includes(y) ? ` ${y}` : ""} – ${T[lang].titleTail} | Mila`;
}

function table(caption: string, cols: string[], rows: string[][], numeric: number[]): string {
  return `<div class="tw"><table><caption>${esc(caption)}</caption><thead><tr>${cols.map((c, i) => `<th scope="col"${numeric.includes(i) ? ' class="n"' : ""}>${esc(c)}</th>`).join("")}</tr></thead><tbody>`
    + rows.map((r) => `<tr>${r.map((c, i) => `<td${numeric.includes(i) ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`;
}

/** Same country, close dates: the nearest race days first (passed and undated races after them), filled from other countries when the
 *  country has fewer than three. */
export function nearby(r: Race, all: Race[], today: string): Race[] {
  const others = all.filter((x) => x.id !== r.id);
  const dist = (x: Race) => (r.next_date && x.next_date ? Math.abs(daysBetween(r.next_date, x.next_date)) : x.next_date ? 1e5 : 2e5) + (x.next_date && x.next_date < today ? 5e4 : 0);
  const order = (a: Race, b: Race) => dist(a) - dist(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const same = others.filter((x) => (x.country_code ?? x.country) === (r.country_code ?? r.country)).sort(order).slice(0, NEARBY_MAX);
  if (same.length >= 3) return same;
  return [...same, ...others.filter((x) => !same.includes(x)).sort(order)].slice(0, Math.min(NEARBY_MAX, Math.max(3, same.length)));
}

// ------------------------------------------------------------------------------------------------------------- the page frame

const RACE_CSS = `[hidden]{display:none!important}.skip{position:absolute;left:-9999px;top:0}.skip:focus{left:12px;top:12px;z-index:9;background:var(--surface);color:var(--ink);padding:8px 12px;border-radius:8px}
.crumbs ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px;font-size:14px;color:var(--muted)}.crumbs li+li:before{content:"›";margin-right:6px}.crumbs a{color:var(--ink2);text-decoration:none}
.race-hero{padding:22px 0 40px}.race-hero h1{margin-bottom:12px}
.race-hero.scened{position:relative;isolation:isolate;padding:28px 24px 30px;margin-top:8px;border-radius:22px;overflow:hidden}.race-hero.scened::before{content:"";position:absolute;inset:0;z-index:-2;background:var(--scene) center 60%/cover no-repeat}
.race-hero.scened::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,rgba(13,17,25,.88),rgba(13,17,25,.82) 60%,rgba(13,17,25,.7)),linear-gradient(0deg,rgba(13,17,25,.9),rgba(13,17,25,0) 45%)}.meta{font-size:18px;color:var(--ink2);margin:0 0 6px}.cd{color:var(--good);font-weight:600}
.badge{display:inline-block;font-size:13px;border:1px solid var(--line);border-radius:999px;padding:1px 10px;color:var(--ink2);margin-left:8px;vertical-align:2px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:26px 0 0}.facts div{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 16px}.facts dt{font-size:12.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;overflow-wrap:anywhere;hyphens:auto}.facts dd{margin:2px 0 0;font-size:18px;font-weight:700;line-height:1.35}
figure{margin:0}.chart{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:10px}.chart svg{display:block;width:100%;height:auto}figcaption{font-size:14px;color:var(--muted);margin-top:8px}
.pf{fill:rgba(110,143,255,.22)}.pl{fill:none;stroke:var(--accent);stroke-width:2.2;stroke-linejoin:round}.gl{stroke:var(--line);stroke-width:1}.ax{fill:var(--muted);font-size:12px}.am{fill:var(--good);stroke:var(--surface);stroke-width:2}.aml{stroke:var(--good);stroke-dasharray:3 4;opacity:.6}.rt{fill:none;stroke:var(--accent);stroke-width:3;stroke-linejoin:round;stroke-linecap:round}.st{fill:var(--good)}.fi{fill:var(--ink)}.sb{stroke:var(--ink2);stroke-width:2}
.two{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}.prose p{color:var(--ink2);max-width:42em}main h3{font-size:18px;margin:22px 0 8px}main ul{color:var(--ink2)}
.tw{overflow-x:auto;margin-bottom:10px}table{width:100%;border-collapse:collapse;font-size:15.5px}caption{text-align:left;color:var(--muted);font-size:14px;padding-bottom:6px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:14px}td{color:var(--ink2)}.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td:first-child{white-space:nowrap}
.ctabox{background:var(--surface);border:1px solid var(--accent);border-radius:20px;padding:28px;margin:0 0 44px}.ctabox h2{font-size:24px}.ctabox .ctas{margin-top:18px}.brandline{font-weight:800;font-size:20px;margin:18px 0 0;color:var(--ink)}
.list{list-style:none;margin:0;padding:0}.list li{padding:12px 0;border-bottom:1px solid var(--line)}.list a{font-weight:700;text-decoration:none}.list span{display:block;color:var(--ink2);font-size:15px}
.filter{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 10px}.filter label{flex:1 1 200px;margin:0;color:var(--ink2)}section.grp{padding:28px 0}.grp h3{font-size:14px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:20px 0 2px}
.pager{display:flex;gap:10px;flex-wrap:wrap;padding:30px 0}.pager a,.pager span{border:1px solid var(--line);border-radius:10px;padding:8px 14px;text-decoration:none}.pager [aria-current]{background:var(--surface);color:var(--ink)}
@media (max-width:820px){.two{grid-template-columns:1fr}.race-hero.scened{padding:22px 18px 26px;border-radius:18px}.race-hero.scened::after{background:rgba(13,17,25,.86)}}`;
/** Used when the output holds no site.css: the site's dark palette and frame. */
const FALLBACK_CSS = `:root{color-scheme:dark;--bg:#0D1119;--surface:#151B26;--ink:#E8ECF3;--ink2:#AEB7C6;--muted:#7F8A9C;--line:#263041;--accent:#6E8FFF;--good:#3CCB7F;--bad:#F2706B}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;line-height:1.6}a{color:var(--accent)}.wrap{max-width:1040px;margin:0 auto;padding:0 20px}header{display:flex;align-items:center;justify-content:space-between;padding:22px 0}.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:22px;color:var(--ink);text-decoration:none}.brand img{width:40px;height:40px;border-radius:10px}.lang{display:flex;gap:8px}.lang a{color:var(--ink2);text-decoration:none;font-size:15px;border:1px solid var(--line);padding:6px 12px;border-radius:999px}h1{font-size:clamp(34px,5.4vw,60px);line-height:1.06;margin:12px 0 18px}h2{font-size:26px;margin:0 0 10px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:13px;color:var(--accent);font-weight:700}.lead{font-size:19px;color:var(--ink2)}.cta{display:inline-block;background:var(--accent);color:#0D1119;padding:14px 22px;border-radius:12px;font-weight:700;text-decoration:none}.ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}.cta.alt{background:transparent;color:var(--ink);border:1px solid var(--line)}.note{font-size:14px;color:var(--muted)}section{padding:56px 0;border-top:1px solid var(--line)}.sub{color:var(--ink2)}select{width:100%;font:inherit;color:var(--ink);background:var(--surface);padding:11px;border:1px solid var(--line);border-radius:10px}footer{padding:34px 0 50px;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}footer a{color:var(--ink2);margin-right:16px}`;
const minCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "").replace(/\s{2,}/g, " ").trim();

type Frame = {
  lang: Lang; path: string; title: string; description: string; css: string; body: string; today: string;
  alternates?: Record<Lang, string> | null; noindex?: boolean; og?: { image: string; alt: string; large: boolean }; ld?: object[]; script?: string; module?: string;
  crumbs: { name: string; path?: string }[];
};
function frame(f: Frame): string {
  const t = T[f.lang], c = L[f.lang], root = rel(f.path, "");
  const alt = f.alternates ? LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(abs(f.alternates![l]))}">`).join("") + `<link rel="alternate" hreflang="x-default" href="${esc(abs(f.alternates.en))}">` : "";
  const og = f.og ? `<meta property="og:type" content="website"><meta property="og:site_name" content="Mila"><meta property="og:title" content="${esc(f.title)}"><meta property="og:description" content="${esc(f.description)}"><meta property="og:url" content="${esc(abs(f.path))}"><meta property="og:image" content="${esc(f.og.image)}">${f.og.large ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ""}<meta property="og:image:alt" content="${esc(f.og.alt)}"><meta property="og:locale" content="${OG_LOCALE[f.lang]}">${LANGS.filter((l) => l !== f.lang).map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}">`).join("")}
<meta name="twitter:card" content="${f.og.large ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${esc(f.title)}"><meta name="twitter:description" content="${esc(f.description)}"><meta name="twitter:image" content="${esc(f.og.image)}"><meta name="twitter:image:alt" content="${esc(f.og.alt)}">` : "";
  const switcher = f.alternates ? LANGS.filter((l) => l !== f.lang).map((l) => `<a href="${esc(rel(f.path, f.alternates![l]))}" hreflang="${l}" lang="${l}">${T[l].langName}</a>`).join("") : "";
  const crumbs = `<nav class="crumbs" aria-label="${esc(t.crumbs)}"><ol>${f.crumbs.map((x, i) => i === f.crumbs.length - 1 ? `<li aria-current="page">${esc(x.name)}</li>` : `<li><a href="${esc(rel(f.path, x.path ?? ""))}">${esc(x.name)}</a></li>`).join("")}</ol></nav>`;
  return `<!doctype html><html lang="${f.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(f.title)}</title><meta name="description" content="${esc(f.description)}">${f.noindex ? '<meta name="robots" content="noindex,follow">' : `<meta name="robots" content="max-image-preview:large"><link rel="canonical" href="${esc(abs(f.path))}">`}${alt}
${og}<meta name="theme-color" content="#0D1119"><link rel="icon" href="${root}logo.png"><style>${f.css}</style>${(f.ld ?? []).map(jsonLd).join("")}</head><body>
<a class="skip" href="#main">${esc(t.skip)}</a><div class="wrap"><header><a class="brand" href="${root}${c.home}"><img src="${root}logo.png" alt="" width="40" height="40">MILA</a>${switcher ? `<nav class="lang" aria-label="${esc(t.langNav)}">${switcher}</nav>` : ""}</header>
${crumbs}
<main id="main">${f.body}</main>
<footer><a href="${root}${c.support}">${esc(t.support)}</a><a href="${root}${c.privacy}">${esc(t.privacy)}</a><a href="${root}${c.terms}">${esc(t.terms)}</a><br><br>© ${f.today.slice(0, 4)} Mila</footer></div>${f.script ? `<script>${f.script}</script>` : ""}${f.module ? `<script type="module">${f.module}</script>` : ""}</body></html>
`;
}
const crumbsLd = (items: { name: string; path: string }[]) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.name, item: abs(x.path) })) });
/** The browser refines the countdown to exact days (the page itself says it in coarse steps). */
const cdScript = (lang: Lang) => `(()=>{const w=${JSON.stringify(T[lang].cd)};for(const e of document.querySelectorAll(".cd[data-day]")){const n=Math.round((Date.parse(e.dataset.day+"T12:00:00")-Date.now())/864e5),m=Math.round(n/30.44);e.textContent=n<0?w.past:n===0?w.today:n===1?w.tomorrow:n<14?w.days.replace("#",n):n<60?w.weeks.replace("#",Math.floor(n/7)):w.months.replace("#",m)}})();`;
/** The hero's scene, drawn in the browser by the site's scene.js (scene.ts) from the spec in data-scene, as wide as the hero is; the
 *  class "scened" turns on its frame and scrim (RACE_CSS). Without the script the hero stays as it is. */
export const sceneScript = (src: string) => "import{sceneSvg}from" + JSON.stringify(src)
  + ";const e=document.querySelector('.race-hero[data-scene]');if(e){const b=e.getBoundingClientRect(),h=Math.round(Math.min(1600,Math.max(500,1200*b.height/Math.max(1,b.width)))),"
  + "s=sceneSvg(JSON.parse(e.dataset.scene),{width:1200,height:h,idPrefix:'h'});e.style.setProperty('--scene','url(\"data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s)+'\")');e.classList.add('scened')}";
const filterScript = `(()=>{const f=document.querySelector("form.filter");if(!f)return;f.hidden=false;const items=[...document.querySelectorAll("li[data-km]")],groups=[...document.querySelectorAll(".grp")],none=document.getElementById("nomatch");const run=()=>{const d=f.elements.d.value,c=f.elements.c.value;let n=0;for(const li of items){const ok=(!c||li.dataset.c===c)&&(!d||li.dataset.b===d);li.hidden=!ok;if(ok)n++}for(const g of groups)g.hidden=!g.querySelector("li[data-km]:not([hidden])");none.hidden=n>0};f.addEventListener("change",run);run()})();`;

// ------------------------------------------------------------------------------------------------------------- the pages

type Ctx = { today: string; css: string; appStore: string; active: Race[]; slugs: Map<string, string>; ogImage: (r: Race | null, lang: Lang) => { image: string; large: boolean };
  /** The site has scene.js: the hero gets its scene in the browser. */
  sceneJs?: boolean };

/** One race's page in one language. */
export function racePage(r: Race, lang: Lang, ctx: Ctx): string {
  const t = T[lang], slug = ctx.slugs.get(r.id)!, path = racePath(lang, slug), title = raceTitle(r, lang), where = whereText(r, lang);
  const alternates = Object.fromEntries(LANGS.map((l) => [l, racePath(l, slug)])) as Record<Lang, string>;
  const c = r.course, today = ctx.today, country = countryName(r, lang), info = r.info;
  // the date line: a coming date with the countdown, a passed one, or none yet
  let when: string;
  if (r.next_date && r.next_date >= today) when = `<time datetime="${r.next_date}">${esc(cap(dateLong(r.next_date, lang)))}</time>${r.prelim ? `<span class="badge">${esc(t.prelim)}</span>` : ""}${where ? ` · ${esc(where)}` : ""} · <span class="cd" data-day="${r.next_date}">${esc(countdown(r.next_date, today, lang))}</span>`;
  else if (r.next_date) when = `${esc(t.passed(dateLong(r.next_date, lang)))}${where ? ` · ${esc(where)}` : ""}`;
  else when = `${esc(t.noDate)}${r.past_dates.length ? ` ${esc(t.last(dateShort(r.past_dates[r.past_dates.length - 1], lang)))}` : ""}${where ? ` · ${esc(where)}` : ""}`;
  const orgLink = r.url ? `<a href="${esc(r.url)}" rel="noopener">${esc(r.organizer ? t.organiserPage : cap(t.organiserPage))}</a>` : "";
  const org = r.organizer ? `<p class="meta">${esc(t.organizer)}: ${esc(r.organizer)}${orgLink ? ` · ${orgLink}` : ""}</p>` : orgLink ? `<p class="meta">${orgLink}</p>` : "";
  const start = mainStart(r);
  const facts: [string, string][] = [[t.distance, kmText(r.km, lang)], [t.climbing, `↑ ${num(r.ascent, lang)} m`]];
  if (r.max_ele !== null) facts.push([t.highest, `${num(r.max_ele, lang)} ${t.masl}`]);
  facts.push([t.terrain, r.trail ? t.trail : t.road], [t.character, cap(t.hilly[hilliness(r)])]);
  if (start && r.next_date && r.next_date >= today) facts.push([t.start, t.clock(start)]);
  if (r.aid_stations?.length) facts.push([t.aid, String(r.aid_stations.length)]);
  // the scene's spec for the browser (scene.ts): the profile to three decimals is plenty for a horizon
  const spec = raceSceneSpec(r, { startIso: startDate(r), today });
  const scene = ctx.sceneJs ? ` data-scene="${esc(JSON.stringify({ ...spec, profile: spec.profile.map((v) => Math.round(v * 1000) / 1000), relief: Math.round(spec.relief) }))}"` : "";
  const hero = `<div class="race-hero"${scene}><div class="eyebrow">${esc([t.races, country].filter(Boolean).join(" · "))}</div><h1>${esc(title)}</h1><p class="meta">${when}</p>${org}
<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>`;
  const button = `<div class="ctas"><a class="cta" href="${esc(ctx.appStore)}">${esc(t.store)}</a></div><p class="brandline">${esc(t.brandLine)}</p>`;
  const cta = `<div class="ctabox"><h2>${esc(t.ctaH(r.name))}</h2><p class="sub">${esc(t.ctaText)}</p>${button}</div>`;
  const sections: string[] = [];
  const about = (lang === "sv" && r.comment ? r.comment.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("") + `<p class="note">${esc(t.coachNote)}</p>` : aboutText(r, lang).map((p) => `<p>${esc(p)}</p>`).join(""));
  if (c) {
    const [eMin, eMax] = eleRange(c.pts);
    sections.push(`<section aria-labelledby="h-profile"><h2 id="h-profile">${esc(t.profileH)}</h2><figure><div class="chart">${profileSvg(r, lang)}</div><figcaption>${esc(t.profileDesc(kmText(r.km, lang), num(r.min_ele ?? eMin, lang), num(r.max_ele ?? eMax, lang), (r.aid_stations ?? []).length))}${r.ele_source === "dem" ? ` ${esc(t.dem)}` : ""}</figcaption></figure></section>`);
    const credit = r.course_source === "official_gpx" ? `${esc(t.official)}${r.url ? ` (<a href="${esc(r.url)}" rel="noopener">${esc(t.organiserPage)}</a>)` : ""}.` : esc(t.upload);
    sections.push(`<section aria-labelledby="h-route"><div class="two"><div><h2 id="h-route">${esc(t.routeH)}</h2><figure><div class="chart">${routeSvg(r, lang)}</div><figcaption>${esc(t.legend(isLoop(c.pts), !!r.aid_stations?.length))} ${credit}</figcaption></figure></div>
<div class="prose"><h2>${esc(t.aboutH)}</h2>${about}</div></div></section>`);
  } else sections.push(`<section aria-labelledby="h-about"><div class="prose"><h2 id="h-about">${esc(t.aboutH)}</h2>${about}</div></section>`);
  if (r.climbs.length) {
    const rows = [...r.climbs].sort((a, b) => a.km - b.km).slice(0, 30).map((x) => [esc(t.at(num(x.km, lang, 1))), esc(lenText(x.len, lang)), esc(`${num(x.gain, lang)} m`), esc(`${num(x.grade, lang, 1)} %`), esc(num(x.top, lang))]);
    sections.push(`<section aria-labelledby="h-climbs"><h2 id="h-climbs">${esc(t.climbsH)}</h2>${table(t.climbsCaption, t.climbCols, rows, [1, 2, 3, 4])}</section>`);
  }
  const prac: string[] = [];
  if (r.aid_stations?.length) prac.push(`<h3>${esc(t.aidH)}</h3>${table(t.aidCaption, t.aidCols, r.aid_stations.map((s) => [esc(t.at(num(s.km, lang, 1))), esc(s.what.length ? s.what.map((w) => t.aidWords[w] ?? w).join(", ") : t.aidNone)]), [])}`);
  if (info?.starts?.length && r.next_date && r.next_date >= today) prac.push(`<h3>${esc(t.startsH)}</h3><ul>${info.starts.map((s) => `<li>${s.label ? `${esc(s.label)}: ` : ""}${esc(t.clock(s.time))}</li>`).join("")}</ul>`);
  if (info?.start_place) {
    const p = info.start_place, map = p.lat !== undefined && p.lon !== undefined ? ` · <a href="https://www.openstreetmap.org/?mlat=${p.lat}&amp;mlon=${p.lon}#map=15/${p.lat}/${p.lon}" rel="noopener nofollow">${esc(t.showMap)}</a>` : "";
    prac.push(`<h3>${esc(t.placeH)}</h3><p>${esc(p.name)}${map}</p>`);
  }
  if (info?.cutoffs?.length) prac.push(`<h3>${esc(t.cutoffsH)}</h3>${table(t.cutoffCaption, t.cutoffCols, info.cutoffs.map((x) => [esc(t.at(num(x.km, lang, 1))), esc(x.clock ? t.clock(x.clock) : t.elapsed(Math.floor(x.elapsed_min! / 60), x.elapsed_min! % 60))]), [])}`);
  if (info?.kit?.length) prac.push(`<h3>${esc(t.kitH)}</h3><ul>${info.kit.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>`);
  if (prac.length) {
    const src = info?.source ? `<p class="note">${esc(t.source)}: <a href="${esc(info.source)}" rel="noopener">${esc(hostOf(info.source))}</a>${info.checked ? `, ${esc(t.checked(dateShort(info.checked, lang)))}` : ""}</p>` : "";
    sections.push(`<section aria-labelledby="h-practical"><h2 id="h-practical">${esc(t.practicalH)}</h2>${prac.join("")}${src}</section>`);
  }
  if (r.results.length) {
    const ps = r.results.slice(0, 3).map((e) => `<p>${esc(t.result(e.year, num(e.finishers, lang), clockTime(e.overall.p50), clockTime(e.overall.p25), clockTime(e.overall.p75), clockTime(e.overall.p10), clockTime(e.overall.p90)))}${e.source ? ` <a href="${esc(e.source)}" rel="nofollow noopener">${esc(t.resultSource)}</a>` : ""}</p>`).join("");
    sections.push(`<section aria-labelledby="h-results"><div class="prose"><h2 id="h-results">${esc(t.resultsH)}</h2>${ps}<p class="note">${esc(t.resultsNote)}</p></div></section>`);
  }
  const near = nearby(r, ctx.active, today);
  if (near.length) sections.push(`<section aria-labelledby="h-nearby"><h2 id="h-nearby">${esc(t.nearbyH)}</h2><ul class="list">${near.map((x) => `<li><a href="${esc(rel(path, racePath(lang, ctx.slugs.get(x.id)!)))}">${esc(raceTitle(x, lang))}</a><span>${esc([x.next_date ? dateShort(x.next_date, lang) : t.noDateGroup, whereText(x, lang)].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul></section>`);
  sections.push(`<section><p class="sub">${esc(t.ctaH(r.name))}</p>${button}<p class="note">${esc(t.disclaimer)}</p></section>`);

  const og = ctx.ogImage(r, lang), description = metaDescription(r, lang);
  const ld: object[] = [crumbsLd([{ name: t.home, path: L[lang].home }, { name: t.races, path: indexPath(lang) }, { name: title, path }])];
  const sd = startDate(r);
  if (sd) {
    const sp = info?.start_place, geo = sp?.lat !== undefined && sp?.lon !== undefined ? [sp.lat, sp.lon] : r.start;
    ld.unshift({
      "@context": "https://schema.org", "@type": "SportsEvent", name: title, sport: "Running", startDate: sd,
      eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      description, image: [og.image], ...(r.url ? { url: r.url } : {}),
      location: { "@type": "Place", name: sp?.name ?? (where || r.name),
        address: { "@type": "PostalAddress", ...(r.place ? { addressLocality: r.place } : {}), ...(r.country_code ? { addressCountry: r.country_code } : r.country ? { addressCountry: r.country } : {}) },
        ...(geo ? { geo: { "@type": "GeoCoordinates", latitude: geo[0], longitude: geo[1] } } : {}) },
      ...(r.organizer || r.url ? { organizer: { "@type": "Organization", ...(r.organizer ? { name: r.organizer } : {}), ...(r.url ? { url: r.url } : {}) } } : {}),
    });
  }
  return frame({ lang, path, title: pageTitle(r, lang), description, css: ctx.css, today, alternates, og: { ...og, alt: t.ogAlt(title) }, ld,
    body: `<article>${hero}${cta}${sections.join("\n")}</article>`, script: r.next_date && r.next_date >= today ? cdScript(lang) : undefined,
    module: ctx.sceneJs ? sceneScript(rel(path, "scene.js")) : undefined,
    crumbs: [{ name: t.home, path: L[lang].home }, { name: t.races, path: indexPath(lang) }, { name: title }] });
}

/** The page of a race no longer in the register: kept at its address so old links land somewhere, with noindex and no event. */
export function removedPage(name: string, slug: string, lang: Lang, ctx: Pick<Ctx, "css" | "today">): string {
  const t = T[lang], path = racePath(lang, slug);
  return frame({ lang, path, title: t.removedTitle(name), description: t.removed, css: ctx.css, today: ctx.today, noindex: true,
    body: `<div class="race-hero"><div class="eyebrow">${esc(t.races)}</div><h1>${esc(name)}</h1><p class="lead">${esc(t.removed)}</p><div class="ctas"><a class="cta alt" href="${esc(rel(path, indexPath(lang)))}">${esc(t.allRaces)}</a></div></div>`,
    crumbs: [{ name: t.home, path: L[lang].home }, { name: t.races, path: indexPath(lang) }, { name }] });
}

/** The races in index order: coming races by date, then those without a coming date; by name within a day. */
export function indexOrder(races: Race[], today: string): Race[] {
  const key = (r: Race) => (r.next_date && r.next_date >= today ? `0${r.next_date}` : "1");
  return [...races].sort((a, b) => key(a).localeCompare(key(b)) || a.name.localeCompare(b.name, "sv") || a.id.localeCompare(b.id));
}

/** One index page: its races grouped by month (coming races; the rest last) and country, a filter by distance and country that only
 *  shows with script (every link is in the HTML for crawlers), and links to the other pages. */
export function indexPage(lang: Lang, page: number, pages: number, races: Race[], total: number, ctx: Ctx): string {
  const t = T[lang], path = indexPath(lang, page), today = ctx.today;
  const alternates = Object.fromEntries(LANGS.map((l) => [l, indexPath(l, page)])) as Record<Lang, string>;
  const groups = new Map<string, Map<string, Race[]>>();
  for (const r of races) {
    const g = r.next_date && r.next_date >= today ? r.next_date.slice(0, 7) : "none", c = countryName(r, lang) ?? "–";
    if (!groups.has(g)) groups.set(g, new Map());
    const m = groups.get(g)!;
    if (!m.has(c)) m.set(c, []);
    m.get(c)!.push(r);
  }
  const item = (r: Race) => `<li data-km="${r.km}" data-b="${bucketOf(r.km)}" data-c="${esc(r.country_code ?? r.country ?? "")}"><a href="${esc(rel(path, racePath(lang, ctx.slugs.get(r.id)!)))}">${esc(raceTitle(r, lang))}</a><span>${esc([r.next_date && r.next_date >= today ? cap(dateLong(r.next_date, lang)) : null, r.place, kmText(r.km, lang), `↑ ${num(r.ascent, lang)} m`].filter(Boolean).join(" · "))}</span></li>`;
  const list = [...groups].map(([g, m]) => {
    const id = `g-${g}`, countries = [...m].sort((a, b) => a[0].localeCompare(b[0], LOCALE[lang]));
    return `<section class="grp" aria-labelledby="${id}"><h2 id="${id}">${esc(g === "none" ? t.noDateGroup : monthLabel(g, lang))}</h2>${countries.map(([c, rs]) => `<div class="grp"><h3>${esc(c)}</h3><ul class="list">${rs.map(item).join("")}</ul></div>`).join("")}</section>`;
  }).join("\n");
  const countries = [...new Map(ctx.active.map((r) => [r.country_code ?? r.country ?? "", countryName(r, lang) ?? ""])).entries()].filter(([k]) => k).sort((a, b) => a[1].localeCompare(b[1], LOCALE[lang]));
  const filter = `<form class="filter" hidden aria-label="Filter"><label>${esc(t.filterDistance)}<select name="d"><option value="">${esc(t.all)}</option>${["a", "b", "c", "d"].map((b, i) => `<option value="${b}">${esc(t.buckets[i])}</option>`).join("")}</select></label><label>${esc(t.filterCountry)}<select name="c"><option value="">${esc(t.allCountries)}</option>${countries.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join("")}</select></label></form><p id="nomatch" class="note" hidden>${esc(t.noMatch)}</p>`;
  const pager = pages > 1 ? `<nav class="pager" aria-label="${esc(t.pages)}">${page > 1 ? `<a href="${esc(rel(path, indexPath(lang, page - 1)))}" rel="prev">${esc(t.prev)}</a>` : ""}${Array.from({ length: pages }, (_, i) => i + 1).map((p) => p === page ? `<span aria-current="page">${p}</span>` : `<a href="${esc(rel(path, indexPath(lang, p)))}">${p}</a>`).join("")}${page < pages ? `<a href="${esc(rel(path, indexPath(lang, page + 1)))}" rel="next">${esc(t.next)}</a>` : ""}</nav>` : "";
  const hero = `<div class="race-hero"><div class="eyebrow">${esc(t.races)}</div><h1>${esc(t.indexH1)}${page > 1 ? ` – ${esc(t.pageN(page))}` : ""}</h1><p class="lead">${esc(t.indexLead)}</p><p class="meta">${esc(t.count(total))}</p><div class="ctas"><a class="cta" href="${esc(ctx.appStore)}">${esc(t.store)}</a></div><p class="brandline">${esc(t.brandLine)}</p></div>`;
  return frame({ lang, path, title: `${t.indexTitle}${page > 1 ? ` – ${t.pageN(page)}` : ""} | Mila`, description: t.indexLead, css: ctx.css, today, alternates,
    og: { ...ctx.ogImage(null, lang), alt: t.ogDefault }, ld: [crumbsLd([{ name: t.home, path: L[lang].home }, { name: t.races, path: indexPath(lang) }])],
    body: `${hero}${filter}\n${list}\n${pager}`, script: filterScript, crumbs: [{ name: t.home, path: L[lang].home }, { name: t.races }] });
}

// ------------------------------------------------------------------------------------------------------------- sitemap and robots

/** The site's own pages in each language (alternates in the sitemap); any other page at the root is listed on its own. */
const STATIC_GROUPS: Record<Lang, string>[] = [
  { sv: "sv.html", en: "index.html", de: "index-de.html" }, { sv: "support-sv.html", en: "support.html", de: "support-de.html" },
  { sv: "privacy.html", en: "privacy-en.html", de: "privacy-de.html" }, { sv: "terms.html", en: "terms-en.html", de: "terms-de.html" },
];
const staticUrl = (file: string) => (file === "index.html" ? `${SITE}/` : `${SITE}/${file}`);
export type SitemapEntry = { loc: string; lastmod?: string; alternates?: Record<string, string> };
export function sitemapXml(entries: SitemapEntry[]): string {
  const x = (e: SitemapEntry) => `<url><loc>${esc(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}${Object.entries(e.alternates ?? {}).map(([l, u]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(u)}"/>`).join("")}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.map(x).join("\n")}\n</urlset>\n`;
}
export const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`;

// ------------------------------------------------------------------------------------------------------------- the run

async function sha(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
}
/** A page's content for its lastmod: without the countdown and the footer's year, so a page counts as changed only when its facts did. */
const stable = (html: string) => html.replace(/<span class="cd"[^>]*>[^<]*<\/span>/g, "").replace(/© \d{4} Mila/, "");
async function readText(p: string): Promise<string | null> { try { return await Deno.readTextFile(p); } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; } }
async function readBytes(p: string): Promise<Uint8Array | null> { try { return await Deno.readFile(p); } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; } }
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Writes the race pages, the indexes, the share images, sitemap.xml, robots.txt and the slug map into `out` (the site's root). */
export async function generate(o: { out: string; races: Race[]; ids?: Set<string>; today: string; png?: PngRenderer | null; appStore?: string; allowMassRemoval?: boolean; log?: (s: string) => void }): Promise<Report> {
  const out = o.out.replace(/\/+$/, ""), today = o.today, log = o.log ?? (() => {});
  const prev = await readText(`${out}/lopp/slugs.json`);
  const state: State = prev ? JSON.parse(prev) : { version: 1, races: {}, pages: {}, og: {} };
  state.races ??= {}; state.pages ??= {}; state.og ??= {};
  const feedIds = o.ids ?? new Set(o.races.map((r) => r.id)), usable = new Set(o.races.map((r) => r.id));
  const report: Report = { races: o.races.length, active: 0, removed: [], added: [], written: 0, pngs: 0 };

  // 1. who left: published races the feed no longer names, and races it still names but whose row cleanRace refuses (their page goes
  //    noindex as a removed race's does, instead of staying up stale with facts the feed no longer stands behind). Many at once is a
  //    broken feed, not the register (or a feed whose rows no longer read), and nothing is written
  const published = Object.entries(state.races).filter(([, s]) => !s.removed);
  const gone = published.filter(([id]) => !usable.has(id));
  if (!o.allowMassRemoval && published.length && (feedIds.size === 0 || usable.size === 0 || (gone.length >= MASS_REMOVAL_MIN && gone.length > published.length * MASS_REMOVAL_SHARE))) {
    throw new Error(`race pages: the feed drops ${gone.length} of ${published.length} published races; nothing written (--allow-mass-removal accepts it)`);
  }
  // 2. slugs: a race keeps its own; a new race with a course gets the feed's suggestion, made unique among every slug ever used
  const used = new Set(Object.values(state.races).map((s) => s.slug));
  const fresh = o.races.filter((r) => !state.races[r.id] && r.course).sort((a, b) => (a.slug || "").localeCompare(b.slug || "") || a.id.localeCompare(b.id));
  for (const r of fresh) {
    const base = r.slug && !RESERVED_SLUGS.has(r.slug) ? r.slug : `lopp-${r.id.slice(0, 8)}`;
    let s = base;
    for (let i = 2; used.has(s); i++) s = `${base}-${i}`;
    used.add(s);
    state.races[r.id] = { slug: s, name: r.name, first: today, removed: null };
    report.added.push(s);
  }
  for (const [id] of gone) { state.races[id].removed = today; report.removed.push(state.races[id].slug); }
  const byId = new Map(o.races.map((r) => [r.id, r])), active: Race[] = [];
  for (const [id, s] of Object.entries(state.races)) {
    const r = byId.get(id);
    if (r) { s.removed = null; s.name = r.name; active.push(r); }
  }
  report.active = active.length;
  const slugs = new Map(Object.entries(state.races).map(([id, s]) => [id, s.slug]));
  const css = minCss((await readText(`${out}/site.css`)) ?? FALLBACK_CSS) + minCss(RACE_CSS);
  const appStore = safeUrl(o.appStore, true) ?? APP_STORE_URL;

  let written = 0;
  const put = async (rel: string, data: string | Uint8Array) => {
    const p = `${out}/${rel}`, bytes = typeof data === "string" ? new TextEncoder().encode(data) : data, old = await readBytes(p);
    if (old && sameBytes(old, bytes)) return;
    await Deno.mkdir(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    await Deno.writeFile(p, bytes);
    written++;
  };
  const exists = async (rel: string) => { try { await Deno.stat(`${out}/${rel}`); return true; } catch { return false; } };

  // 3. share images: one per race, rendered again only when its picture changes, and a default per language
  if (o.png) {
    for (const lang of LANGS) {
      const svg = ogDefaultSvg(lang), h = await sha(svg);
      if (state.og[lang] !== h || !(await exists(ogDefaultPath(lang)))) {
        try { await put(ogDefaultPath(lang), await o.png(svg)); state.og[lang] = h; report.pngs++; } catch (e) { log(`og ${lang}: ${String(e).slice(0, 100)}`); }
      }
    }
  }
  const hasOg = new Set<string>();
  for (const r of active) {
    const s = state.races[r.id], p = ogPath(s.slug);
    if (o.png && r.course) {
      const svg = ogSvg(r), h = await sha(svg);
      if (s.og !== h || !(await exists(p))) {
        try { await put(p, await o.png(svg)); s.og = h; report.pngs++; } catch (e) { log(`og ${s.slug}: ${String(e).slice(0, 100)}`); }
      }
    }
    if (await exists(p)) hasOg.add(r.id);
  }
  const defaults = new Map<Lang, boolean>();
  for (const l of LANGS) defaults.set(l, await exists(ogDefaultPath(l)));
  const ogImage = (r: Race | null, lang: Lang) => r && hasOg.has(r.id) ? { image: abs(ogPath(slugs.get(r.id)!)), large: true }
    : defaults.get(lang) ? { image: abs(ogDefaultPath(lang)), large: true } : { image: `${SITE}/logo.png`, large: false };
  const ctx: Ctx = { today, css, appStore, active, slugs, ogImage, sceneJs: await exists("scene.js") };

  // 4. the race pages, and the pages of races that left; every indexed page's lastmod moves only when its content does
  const pages: State["pages"] = {};
  const track = async (path: string, html: string) => {
    const h = await sha(stable(html)), was = state.pages[path];
    pages[path] = { hash: h, lastmod: was && was.hash === h ? was.lastmod : today };
    return pages[path].lastmod;
  };
  const raceEntries: SitemapEntry[] = [];
  for (const r of [...active].sort((a, b) => slugs.get(a.id)!.localeCompare(slugs.get(b.id)!))) {
    const slug = slugs.get(r.id)!, alt = Object.fromEntries([...LANGS.map((l) => [l, abs(racePath(l, slug))]), ["x-default", abs(racePath("en", slug))]]);
    for (const lang of LANGS) {
      const html = racePage(r, lang, ctx), path = racePath(lang, slug);
      await put(`${path}index.html`, html);
      raceEntries.push({ loc: abs(path), lastmod: await track(path, html), alternates: alt });
    }
  }
  for (const s of Object.values(state.races).filter((s) => s.removed)) {
    for (const lang of LANGS) await put(`${racePath(lang, s.slug)}index.html`, removedPage(s.name, s.slug, lang, ctx));
  }
  // 5. the indexes, page by page in the same order in every language, and no page left over from a longer list
  const ordered = indexOrder(active, today), count = Math.max(1, Math.ceil(ordered.length / INDEX_PAGE_SIZE)), indexEntries: SitemapEntry[] = [];
  for (let p = 1; p <= count; p++) {
    const chunk = ordered.slice((p - 1) * INDEX_PAGE_SIZE, p * INDEX_PAGE_SIZE);
    const alt = Object.fromEntries([...LANGS.map((l) => [l, abs(indexPath(l, p))]), ["x-default", abs(indexPath("en", p))]]);
    for (const lang of LANGS) {
      const html = indexPage(lang, p, count, chunk, ordered.length, ctx), path = indexPath(lang, p);
      await put(`${path}index.html`, html);
      indexEntries.push({ loc: abs(path), lastmod: await track(path, html), alternates: alt });
    }
  }
  for (const lang of LANGS) {
    const dir = `${out}/${L[lang].dir}/${L[lang].pageWord}`;
    try {
      for await (const e of Deno.readDir(dir)) if (e.isDirectory && /^\d+$/.test(e.name) && (Number(e.name) > count || Number(e.name) < 2)) { await Deno.remove(`${dir}/${e.name}`, { recursive: true }); written++; }
    } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  }
  // 6. the sitemap: the site's own pages (with their languages), the indexes and every race page; robots.txt points to it
  const roots: string[] = [], staticEntries: SitemapEntry[] = [];
  for await (const e of Deno.readDir(out)) if (e.isFile && e.name.endsWith(".html")) roots.push(e.name);
  for (const file of roots.sort()) {
    const html = (await readText(`${out}/${file}`)) ?? "";
    if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) continue;
    const g = STATIC_GROUPS.find((x) => Object.values(x).includes(file));
    const alt = g && LANGS.every((l) => roots.includes(g[l])) ? Object.fromEntries([...LANGS.map((l) => [l, staticUrl(g[l])]), ["x-default", staticUrl(g.en)]]) : undefined;
    staticEntries.push({ loc: staticUrl(file), lastmod: await track(`/${file}`, html), alternates: alt });
  }
  await put("sitemap.xml", sitemapXml([...staticEntries, ...indexEntries, ...raceEntries]));
  await put("robots.txt", ROBOTS);
  // 7. the slug map, sorted, so it only changes when something did
  state.pages = Object.fromEntries(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b)));
  state.races = Object.fromEntries(Object.entries(state.races).sort(([, a], [, b]) => a.slug.localeCompare(b.slug)));
  state.og = Object.fromEntries(Object.entries(state.og).sort(([a], [b]) => a.localeCompare(b)));
  await put("lopp/slugs.json", JSON.stringify(state, null, 1) + "\n");
  report.written = written;
  return report;
}

/** The App Store link: "appStoreUrl" in race_pages.json next to this script, else APP_STORE_URL. */
export async function configuredAppStore(file = new URL("./race_pages.json", import.meta.url)): Promise<string> {
  try { return safeUrl(JSON.parse(await Deno.readTextFile(file))?.appStoreUrl, true) ?? APP_STORE_URL; } catch { return APP_STORE_URL; }
}

if (import.meta.main) {
  const args = Deno.args, opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const out = opt("--out") ?? decodeURIComponent(new URL("./marketing-site", import.meta.url).pathname);
  const today = opt("--today") ?? new Date().toISOString().slice(0, 10);
  if (!isDay(today)) { console.error("--today: YYYY-MM-DD"); Deno.exit(2); }
  try {
    const feed = await readFeed(opt("--feed") ?? FEED_URL);
    const png = args.includes("--no-png") ? null : await resvgRenderer();
    const r = await generate({ out, races: feed.races, ids: feed.ids, today, png, appStore: await configuredAppStore(), allowMassRemoval: args.includes("--allow-mass-removal"), log: console.warn });
    console.log(`race pages: ${r.active} races (${r.races} in the feed), ${r.added.length} new, ${r.removed.length} removed, ${r.pngs} images, ${r.written} files written`);
  } catch (e) {
    console.error(String(e));
    Deno.exit(1);
  }
}
