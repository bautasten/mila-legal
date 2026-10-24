// Mila's public race pages: one page per race in Milas loppregister and language, an index per language, sitemap.xml and robots.txt,
// generated from the public race feed (function race-feed: approved races, public course facts only). No key and no secret: it runs
// anywhere, hourly in the Pages repo (bautasten/mila-legal, .github/workflows/race-pages.yml, as tools/race_pages.ts) and by hand here.
//
//   Swedish  https://milacoach.app/lopp/<slug>/         index /lopp/        (pages 2… /lopp/sida/2/)
//   English  https://milacoach.app/en/races/<slug>/     index /en/races/    (/en/races/page/2/)
//   German   https://milacoach.app/de/laeufe/<slug>/    index /de/laeufe/   (/de/laeufe/seite/2/)
//   Norwegian /nb/lop/<slug>/, Danish /da/lob/<slug>/, Finnish /fi/kisat/<slug>/, French /fr/courses/<slug>/, Spanish /es/carreras/<slug>/
//            (pages 2… /nb/lop/side/2/, /da/lob/side/2/, /fi/kisat/sivu/2/, /fr/courses/page/2/, /es/carreras/pagina/2/)
//   the share image /lopp/<slug>/og.png (1200×630: the course's profile and shape over the race's scene, rendered with resvg-wasm),
//   the hero's scene drawn in the browser by /scene.js (scene.ts built by scene_js.sh) when the site has it, one default image per
//   language (<index>/og.png), sitemap.xml (the site's own pages too) and robots.txt
//
// Slugs are lower-case ASCII from the race's name without its sponsors (displayName: a watch, shoe or title sponsor in front, "presented
// by …" at the end) and distance, and do not change once published: lopp/slugs.json in the output keeps every race's slug (and the
// lastmod of every page), so a renamed race keeps its address. The one exception (review round 24, item 3): a slug published with a
// sponsor in front ("adidas-stockholm-marathon") moves once to the name without it, and the old address stays as a page that sends the
// reader on (movedPage, noindex). Titles, headings and share images say the name without its sponsors; the official name stays in the
// page's text ("Officiellt namn: …"). Every page says Mila is not affiliated with the organiser or the race's sponsors (the race page,
// the index and the footer), and offers organisers and rights holders the way to ask for a change or a removal (the support form's
// topic "rights"). A race needs a course for its first page, unless it is an official race whose organiser publishes no course
// file (the feed's has_course false: asked for with features=nocourse): its page has the facts, the organiser's aid stations and start,
// and "Banan publiceras inte som fil av arrangören" with the organiser's link instead of the profile and the route; its share image the
// scene and the text alone. A course the organiser offered says where ("Bana publicerad av arrangören på <domän>"); heights from the
// elevation model carry its attribution. A race without a date gets its page without the event markup.
// A race that leaves the register leaves the site: its pages (every language, its share image, its old addresses) are deleted, so the
// host answers "not found" with no name (GitHub Pages cannot send 410 Gone; a proxy in front could), and its name and slug leave the
// slug map, which keeps only a hash of each slug (retired) so a later race never takes the address. A run that would drop many races at
// once (a broken feed) stops without writing.
// Files are only written when their content changes (the countdown is coarse and refined in the browser), so the hourly job seldom commits.
//
// The course description: Swedish pages show the coach's own description (races.comment, Mila's text); the other languages' pages show
// a short summary built here from the course's numbers (no AI at build time: no key in CI, no cost), never the Swedish text.
//
// Run here (a local preview in marketing-site/, git-ignored; serve it with `deno run -A jsr:@std/http/file-server marketing-site`):
//   cd backend && deno run --allow-net --allow-read=. --allow-write=marketing-site race_pages.ts [--feed <url or file.json>] [--no-png]
// Options: --out <dir> (default marketing-site next to this script), --feed (default the live feed), --today YYYY-MM-DD, --no-png,
// --allow-mass-removal (accept a run that drops more than a third of the published races).

import { raceSceneSpec, sceneLayers } from "./scene.ts";
import { securityMeta } from "./site_csp.ts";

export const SITE = "https://milacoach.app";
export const FEED_URL = "https://vfjofaniwtudzvadxpsd.supabase.co/functions/v1/race-feed";
/** The App Store link of every generated page's call to action. Byt till appens riktiga App Store-länk vid lansering: set "appStoreUrl"
 *  in race_pages.json next to this script (backend/race_pages.json, published as tools/race_pages.json in the Pages repo by
 *  backend/publish_legal.sh), which wins over this constant; the next run regenerates every page with it. */
export const APP_STORE_URL = "https://apps.apple.com/search?term=Mila%20Coach";
/** The renderer's downloads, each with the SHA-256 of the file at that pinned address (review round 24): a file that is not exactly that
 *  one is never run or used, whatever the CDN serves. The wasm's hash is the npm package's own index_bg.wasm, the fonts' those jsDelivr
 *  lists for the package version. */
export const RESVG_WASM = { url: "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm", sha256: "22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70" };
export const FONT_FILES = [
  { url: "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf", sha256: "7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954" },
  { url: "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf", sha256: "e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724" },
];
/** A pinned download, only when its SHA-256 is the one expected; otherwise it throws (the renderer is then left out). */
export async function fetchPinned(f: { url: string; sha256: string }, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  const r = await fetchFn(f.url);
  if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error(`${f.url.split("/").pop()} ${r.status}`); }
  const b = new Uint8Array(await r.arrayBuffer());
  const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (h !== f.sha256) throw new Error(`${f.url.split("/").pop()}: SHA-256 does not match`);
  return b;
}
/** Races per index page, nearby races per page, and when a run counts as dropping too many races (a share of the published ones, and at least). */
export const INDEX_PAGE_SIZE = 200, NEARBY_MAX = 6, MASS_REMOVAL_SHARE = 1 / 3, MASS_REMOVAL_MIN = 5;
const RESERVED_SLUGS = new Set(["sida", "page", "seite", "og", "index", "en", "de", "lopp", "races", "laeufe",
  // the hub pages' folders (seo): /lopp/stad/…, /en/races/city/…, /de/laeufe/stadt/…
  "stad", "distans", "manad", "land", "city", "distance", "month", "country", "stadt", "distanz", "monat",
  // sprak5: nb, da, fi, fr, es (language codes, race folders, pagination and hub folders)
  "nb", "da", "fi", "fr", "es", "lop", "lob", "kisat", "courses", "carreras", "side", "sivu", "pagina",
  "by", "distanse", "maned", "maaned", "kaupunki", "matka", "kuukausi", "maa", "ville", "mois", "pays", "ciudad", "distancia", "mes", "pais"]);

export type Lang = "sv" | "en" | "de" | "nb" | "da" | "fi" | "fr" | "es";
export const LANGS: Lang[] = ["sv", "en", "de", "nb", "da", "fi", "fr", "es"];
/** [latitude, longitude, elevation m, km from the start] */
export type Point = [number, number, number, number];
export type Climb = { km: number; len: number; gain: number; grade: number; top: number };
export type Info = { starts?: { label: string; time: string; main?: boolean }[]; start_place?: { name: string; lat?: number; lon?: number };
  cutoffs?: { km: number; clock?: string; elapsed_min?: number }[]; kit?: string[]; source?: string; checked?: string };
/** The organiser's dates for the coming edition (deadline): registration closes, the last day of each price, bib pickup days and where. */
export type Entry = { entry_closes?: string; price_steps?: { last_day: string; price?: string }[]; pickup?: { day: string; from?: string; to?: string }[];
  pickup_where?: string; source?: string; checked?: string };
export type Result = { year: number; finishers: number; overall: { p10: number; p25: number; p50: number; p75: number; p90: number }; source: string | null };
/** One race from the feed (supabase/functions/_shared/race_feed.ts), checked again here. */
export type Race = {
  id: string; slug: string; name: string; place: string | null; country: string | null; country_code: string | null; organizer: string | null;
  url: string | null; next_date: string | null; prelim: boolean; past_dates: string[]; km: number; ascent: number; descent: number | null; trail: boolean;
  min_ele: number | null; max_ele: number | null; climbs: Climb[]; aid_stations: { km: number; what: string[] }[] | null; info: Info | null;
  /** deadline: the organiser's dates for the coming edition, null when none are known (an older feed has no field). */
  entry: Entry | null;
  results: Result[]; comment: string | null; course_source: "official_gpx" | "upload" | null; ele_source: "dem" | "runners" | null;
  /** The organiser's file: the site it was offered on and that page ("Bana publicerad av arrangören på <domän>"). */
  course_host: string | null; course_page: string | null;
  /** How many Mila runners' measurements the heights rest on (ele_source "runners"). */
  ele_runners: number | null;
  /** False: an official race whose organiser publishes no course file (no course; ascent is the organiser's stated climb, 0 unknown). */
  has_course: boolean;
  start: [number, number] | null; course: { pts: Point[] } | null;
};
export type State = {
  version: 1;
  /** The races on the site: their slug, name, first day, share image's hash, and the slugs they had before (each a page that sends the
   *  reader on). A race that left is not here (`removed` is only read from an older map, and purged). */
  races: Record<string, { slug: string; name: string; first: string; removed?: string | null; og?: string; old?: string[] }>;
  pages: Record<string, { hash: string; lastmod: string }>;
  og: Record<string, string>;
  /** A hash of every slug a race that left had (slugHash): never given to another race, never a name in the map. */
  retired?: string[];
};
export type PngRenderer = (svg: string) => Uint8Array | Promise<Uint8Array>;
export type Report = { races: number; active: number; removed: string[]; added: string[]; moved: string[]; written: number; pngs: number;
  /** seo: the indexed addresses whose content changed in this run (new, edited or gone), for IndexNow; and the hub pages made. */
  changed: string[]; hubs: number };

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
    entry: cleanEntry(x.entry),
    results: arr(x.results).filter((e) => e && Number.isInteger(e.year) && isNum(e.finishers) && e.overall && ["p10", "p25", "p50", "p75", "p90"].every((k) => isNum(e.overall[k]))).slice(0, 5)
      .map((e) => ({ year: e.year, finishers: e.finishers, overall: { p10: e.overall.p10, p25: e.overall.p25, p50: e.overall.p50, p75: e.overall.p75, p90: e.overall.p90 }, source: safeUrl(e.source, true) })),
    comment: typeof x.comment === "string" && x.comment.trim() ? x.comment.trim().slice(0, 6000) : null,
    course_source: x.course_source === "official_gpx" || x.course_source === "upload" ? x.course_source : null, ele_source: x.ele_source === "dem" || x.ele_source === "runners" ? x.ele_source : null,
    course_host: x.course_source === "official_gpx" && typeof x.course_host === "string" && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(x.course_host) && x.course_host.length <= 120 ? x.course_host : null,
    course_page: x.course_source === "official_gpx" ? safeUrl(x.course_page, true) : null,
    ele_runners: x.ele_source === "runners" ? (isNum(x.ele_runners) && x.ele_runners >= 1 ? Math.min(999, Math.round(x.ele_runners)) : 1) : null,
    has_course: x.has_course !== false,
    start: Array.isArray(x.start) && x.start.length === 2 && x.start.every(isNum) ? [x.start[0], x.start[1]] : pts.length ? [pts[0][0], pts[0][1]] : null,
    course: pts.length >= 2 ? { pts } : null,
  };
}
/** The organiser's dates from the feed, checked again: real days, the prices' and the place's words bounded, the source https; null when
 *  nothing reads. */
export function cleanEntry(x: unknown): Entry | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const e = x as any, out: Entry = {};
  if (isDay(e.entry_closes)) out.entry_closes = e.entry_closes;
  const steps = (Array.isArray(e.price_steps) ? e.price_steps : []).filter((s: any) => s && isDay(s.last_day)).slice(0, 8)
    .map((s: any) => ({ last_day: s.last_day as string, ...(str(s.price, 40) ? { price: str(s.price, 40)! } : {}) }));
  if (steps.length) out.price_steps = steps;
  const pk = (Array.isArray(e.pickup) ? e.pickup : []).filter((p: any) => p && isDay(p.day)).slice(0, 5)
    .map((p: any) => ({ day: p.day as string, ...(isClock(p.from) ? { from: p.from as string } : {}), ...(isClock(p.to) ? { to: p.to as string } : {}) }));
  if (pk.length) { out.pickup = pk; const w = str(e.pickup_where, 160); if (w) out.pickup_where = w; }
  if (!Object.keys(out).length) return null;
  const source = safeUrl(e.source, true); if (source) out.source = source;
  if (isDay(e.checked)) out.checked = e.checked;
  return out;
}
/** A race whose organiser publishes no course file: it gets a page of its own without the profile and the route. */
export const courseless = (r: Pick<Race, "has_course" | "course">) => !r.has_course && !r.course;

/** Every race in the feed, page by page (a URL), or from a file (a JSON object with "races", or a list). Throws on anything unexpected,
 *  so a run never mistakes a broken feed for an empty register. `ids`: every id the feed named, whether its race was usable or not. */
export async function readFeed(src: string, fetchFn: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<{ races: Race[]; ids: Set<string> }> {
  const raw: unknown[] = [];
  if (/^https?:\/\//.test(src)) {
    let after: string | null = null;
    const waits = { left: FEED_WAITS };
    for (let page = 0; ; page++) {
      if (page >= 500) throw new Error("feed: too many pages");
      const u = new URL(src);
      // the official races without a course too (the feed leaves them out for older readers)
      u.searchParams.set("features", "nocourse");
      u.searchParams.set("limit", "100");
      if (after) u.searchParams.set("after", after);
      const body = await getJson(u.toString(), fetchFn, sleep, waits);
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
/** How many times one walk of the feed waits out its rate limit (FEED_RATE_PER_MIN, 60 requests a minute per address): a register past
 *  about 6 000 races needs more pages than a minute allows, and the hourly build must still read every page (500 pages, at most 50 000
 *  races, need about eight waits). */
export const FEED_WAITS = 20;
/** One page: a 5xx or a dropped connection is tried again after 2, 4 and 6 s; a 429 waits as long as Retry-After says (at most 65 s)
 *  and is asked again, at most FEED_WAITS times in a walk. */
async function getJson(url: string, fetchFn: typeof fetch, sleep: (ms: number) => Promise<void>, waits: { left: number }): Promise<any> {
  for (let i = 0; ; i++) {
    let status = 0, retryAfter = NaN;
    try {
      const res = await fetchFn(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return await res.json();
      status = res.status; retryAfter = Number(res.headers.get("retry-after") ?? "");
      await res.body?.cancel();
    } catch (e) {
      if (i >= 3) throw e;
    }
    if (status === 429 && waits.left > 0) { waits.left--; i--; await sleep(Math.min(65, retryAfter > 0 ? retryAfter : 60) * 1000); continue; }
    if (status && ((status < 500 && status !== 429) || i >= 3)) throw new Error(`feed: ${status}`);
    await sleep(2000 * (i + 1));
  }
}

// ------------------------------------------------------------------------------------------------------------- words

const LOCALE: Record<Lang, string> = { sv: "sv-SE", en: "en-GB", de: "de-DE", nb: "nb-NO", da: "da-DK", fi: "fi-FI", fr: "fr-FR", es: "es-ES" };
const OG_LOCALE: Record<Lang, string> = { sv: "sv_SE", en: "en_GB", de: "de_DE", nb: "nb_NO", da: "da_DK", fi: "fi_FI", fr: "fr_FR", es: "es_ES" };
/** Where each language lives: its folder, the pagination word, and the site's own pages in that language. */
const L: Record<Lang, { dir: string; pageWord: string; home: string; support: string; privacy: string; terms: string }> = {
  sv: { dir: "lopp", pageWord: "sida", home: "sv.html", support: "support-sv.html", privacy: "privacy.html", terms: "terms.html" },
  en: { dir: "en/races", pageWord: "page", home: "", support: "support.html", privacy: "privacy-en.html", terms: "terms-en.html" },
  de: { dir: "de/laeufe", pageWord: "seite", home: "index-de.html", support: "support-de.html", privacy: "privacy-de.html", terms: "terms-de.html" },
  nb: { dir: "nb/lop", pageWord: "side", home: "index-nb.html", support: "support-nb.html", privacy: "privacy-nb.html", terms: "terms-nb.html" },
  da: { dir: "da/lob", pageWord: "side", home: "index-da.html", support: "support-da.html", privacy: "privacy-da.html", terms: "terms-da.html" },
  fi: { dir: "fi/kisat", pageWord: "sivu", home: "index-fi.html", support: "support-fi.html", privacy: "privacy-fi.html", terms: "terms-fi.html" },
  fr: { dir: "fr/courses", pageWord: "page", home: "index-fr.html", support: "support-fr.html", privacy: "privacy-fr.html", terms: "terms-fr.html" },
  es: { dir: "es/carreras", pageWord: "pagina", home: "index-es.html", support: "support-es.html", privacy: "privacy-es.html", terms: "terms-es.html" },
};
/** A clock time as French writes it: "9 h 30". */
const frClock = (t: string) => `${Number(t.slice(0, 2))} h ${t.slice(3)}`;
/** The colon and semicolon between a label and its value, a list's items: French puts a non-breaking space before them. */
const cl = (lang: Lang) => (lang === "fr" ? "\u00a0: " : ": "), sc = (lang: Lang) => (lang === "fr" ? "\u00a0; " : "; ");

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
    dem: "Höjderna kommer från en höjdmodell, inte från banfilen.",
    runners: (n: number) => n === 1 ? "Höjderna är uppmätta av en löpare som sprungit loppet med Mila, inte hämtade ur en höjdmodell." : `Höjderna är uppmätta av ${n} löpare som sprungit loppet med Mila, inte hämtade ur en höjdmodell.`,
    routeH: "Banan", routeTitle: (n: string) => `Banans sträckning för ${n}`,
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
    ctaH: "Förbered dig med Mila",
    ctaText: "Mila är en löpcoach i appen. Lägger du till ett lopp i din plan planerar coachen veckorna fram till start efter din form, och ger dig en tidsprognos och en plan för tempo, vätska och energi på banan.",
    notAffiliated: "Mila är inte kopplad till, sponsrad av eller godkänd av arrangören eller loppets sponsorer. Namn och varumärken tillhör sina ägare.",
    notAffiliatedAll: "Mila är inte kopplad till, sponsrad av eller godkänd av loppens arrangörer eller sponsorer. Namn och varumärken tillhör sina ägare.",
    rights: "Arrangör eller rättighetsinnehavare? Begär ändring eller borttagning", officialName: "Officiellt namn",
    published: "Bana publicerad av arrangören på", elevAttribution: "Höjddata: Terrain Tiles (AWS Open Data) med data från bland annat SRTM, ArcticDEM, EU-DEM, GMTED2010, ETOPO1, NED och 3DEP.",
    movedTitle: "Sidan har flyttat | Mila", moved: "Sidan har flyttat.", movedLink: "Till sidan",
    store: "Hämta i App Store", nearbyH: "Fler lopp i närheten", organizer: "Arrangör",
    disclaimer: "Uppgifterna kommer ur banfilen och arrangörens information. Kontrollera datum, starttider och regler hos arrangören.",
    disclaimerNoCourse: "Uppgifterna kommer från arrangörens information. Kontrollera datum, starttider och regler hos arrangören.",
    noCourse: "Banan publiceras inte som fil av arrangören, så här finns ingen karta eller höjdprofil. Banans sträckning finns hos arrangören.",
    aboutRaceH: "Om loppet", titleTailNoCourse: "datum, distans och tempoplan", metaTailNoCourse: "Se datum och distans och få din tempoplan i Mila.", ogAltNoCourse: (n: string) => `${n} – lopp i Milas loppregister`,
    prelim: "preliminärt datum", noDate: "Datum för nästa upplaga är inte klart än.", last: (d: string) => `Senast: ${d}.`,
    passed: (d: string) => `Loppet gick ${d}. Datum för nästa upplaga är inte klart än.`,
    cd: { today: "i dag", tomorrow: "i morgon", days: "om # dagar", weeks: "om # veckor", months: "om # månader", past: "har gått" },
    allRaces: "Se alla lopp",
    noDateGroup: "Datum ej klart", filterDistance: "Distans", filterCountry: "Land", all: "Alla distanser", allCountries: "Alla länder",
    buckets: ["Upp till 10 km", "11–21 km", "22–42 km", "Ultra, över 42 km"], noMatch: "Inga lopp matchar filtret.", pages: "Sidor", prev: "Föregående", next: "Nästa",
    ogAlt: (n: string) => `Höjdprofil och bana för ${n}`, ogDefault: "Lopp – bana, höjdprofil och tempoplan", support: "Support", privacy: "Integritetspolicy", terms: "Villkor", contact: "Om Mila och kontakt", report: "Rapportera",
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
    dem: "Elevations come from an elevation model, not from the course file.",
    runners: (n: number) => n === 1 ? "Elevations were measured by a runner who ran the race with Mila, not taken from an elevation model." : `Elevations were measured by ${n} runners who ran the race with Mila, not taken from an elevation model.`,
    routeH: "The course", routeTitle: (n: string) => `Course map of ${n}`,
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
    ctaH: "Prepare with Mila",
    ctaText: "Mila is a running coach app. Add a race to your plan and the coach plans your weeks up to race day around your form, and gives you a finish-time forecast and a plan for pacing, drinks and fuel on the course.",
    notAffiliated: "Mila is not affiliated with, sponsored by or endorsed by the organizer or the race's sponsors. Names and trademarks belong to their owners.",
    notAffiliatedAll: "Mila is not affiliated with, sponsored by or endorsed by the races' organizers or sponsors. Names and trademarks belong to their owners.",
    rights: "Organizer or rights holder? Ask for a change or a removal", officialName: "Official name",
    published: "Course published by the organizer on", elevAttribution: "Elevation data: Terrain Tiles (AWS Open Data), with data from SRTM, ArcticDEM, EU-DEM, GMTED2010, ETOPO1, NED and 3DEP, among others.",
    movedTitle: "This page has moved | Mila", moved: "This page has moved.", movedLink: "Go to the page",
    store: "Download on the App Store", nearbyH: "More races nearby", organizer: "Organizer",
    disclaimer: "Details come from the course file and the organizer's information. Check the date, start times and rules with the organizer.",
    disclaimerNoCourse: "Details come from the organizer's information. Check the date, start times and rules with the organizer.",
    noCourse: "The organizer does not publish the course as a file, so there is no map or elevation profile here. The organizer has the route.",
    aboutRaceH: "About the race", titleTailNoCourse: "date, distance and pace plan", metaTailNoCourse: "See the date and distance and get your pace plan in Mila.", ogAltNoCourse: (n: string) => `${n} – race in Mila's race register`,
    prelim: "preliminary date", noDate: "The date of the next edition is not set yet.", last: (d: string) => `Last held: ${d}.`,
    passed: (d: string) => `The race took place on ${d}. The date of the next edition is not set yet.`,
    cd: { today: "today", tomorrow: "tomorrow", days: "in # days", weeks: "in # weeks", months: "in # months", past: "has taken place" },
    allRaces: "See all races",
    noDateGroup: "Date not set", filterDistance: "Distance", filterCountry: "Country", all: "All distances", allCountries: "All countries",
    buckets: ["Up to 10 km", "11–21 km", "22–42 km", "Ultra, over 42 km"], noMatch: "No races match the filter.", pages: "Pages", prev: "Previous", next: "Next",
    ogAlt: (n: string) => `Elevation profile and course of ${n}`, ogDefault: "Races – course, elevation profile and pace plan", support: "Support", privacy: "Privacy policy", terms: "Terms of use", contact: "About Mila and contact", report: "Report",
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
    dem: "Die Höhen stammen aus einem Höhenmodell, nicht aus der Streckendatei.",
    runners: (n: number) => n === 1 ? "Die Höhen wurden von einer Person gemessen, die den Lauf mit Mila gelaufen ist, nicht aus einem Höhenmodell übernommen." : `Die Höhen wurden von ${n} Läuferinnen und Läufern gemessen, die den Lauf mit Mila gelaufen sind, nicht aus einem Höhenmodell übernommen.`,
    routeH: "Die Strecke", routeTitle: (n: string) => `Streckenverlauf von ${n}`,
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
    ctaH: "Mit Mila vorbereiten",
    ctaText: "Mila ist eine Lauf-Coach-App. Nimmst du einen Lauf in deinen Plan auf, plant der Coach deine Wochen bis zum Start nach deiner Form und gibt dir eine Zielzeitprognose und einen Plan für Tempo, Getränke und Verpflegung auf der Strecke.",
    notAffiliated: "Mila ist nicht mit dem Veranstalter oder den Sponsoren des Laufs verbunden und wird von ihnen weder gesponsert noch empfohlen. Namen und Marken gehören ihren Inhabern.",
    notAffiliatedAll: "Mila ist nicht mit den Veranstaltern oder Sponsoren der Läufe verbunden und wird von ihnen weder gesponsert noch empfohlen. Namen und Marken gehören ihren Inhabern.",
    rights: "Veranstalter oder Rechteinhaber? Änderung oder Entfernung beantragen", officialName: "Offizieller Name",
    published: "Strecke vom Veranstalter veröffentlicht auf", elevAttribution: "Höhendaten: Terrain Tiles (AWS Open Data) mit Daten unter anderem aus SRTM, ArcticDEM, EU-DEM, GMTED2010, ETOPO1, NED und 3DEP.",
    movedTitle: "Diese Seite ist umgezogen | Mila", moved: "Diese Seite ist umgezogen.", movedLink: "Zur Seite",
    store: "Laden im App Store", nearbyH: "Weitere Läufe in der Nähe", organizer: "Veranstalter",
    disclaimer: "Die Angaben stammen aus der Streckendatei und den Informationen des Veranstalters. Prüfe Datum, Startzeiten und Regeln beim Veranstalter.",
    disclaimerNoCourse: "Die Angaben stammen aus den Informationen des Veranstalters. Prüfe Datum, Startzeiten und Regeln beim Veranstalter.",
    noCourse: "Der Veranstalter veröffentlicht die Strecke nicht als Datei, daher gibt es hier keine Karte und kein Höhenprofil. Den Streckenverlauf findest du beim Veranstalter.",
    aboutRaceH: "Über den Lauf", titleTailNoCourse: "Datum, Distanz und Pace-Plan", metaTailNoCourse: "Datum und Distanz ansehen und deinen Pace-Plan in Mila holen.", ogAltNoCourse: (n: string) => `${n} – Lauf in Milas Laufregister`,
    prelim: "vorläufiges Datum", noDate: "Das Datum der nächsten Ausgabe steht noch nicht fest.", last: (d: string) => `Zuletzt: ${d}.`,
    passed: (d: string) => `Der Lauf fand am ${d} statt. Das Datum der nächsten Ausgabe steht noch nicht fest.`,
    cd: { today: "heute", tomorrow: "morgen", days: "in # Tagen", weeks: "in # Wochen", months: "in # Monaten", past: "hat stattgefunden" },
    allRaces: "Alle Läufe ansehen",
    noDateGroup: "Datum offen", filterDistance: "Distanz", filterCountry: "Land", all: "Alle Distanzen", allCountries: "Alle Länder",
    buckets: ["Bis 10 km", "11–21 km", "22–42 km", "Ultra, über 42 km"], noMatch: "Keine Läufe passen zum Filter.", pages: "Seiten", prev: "Zurück", next: "Weiter",
    ogAlt: (n: string) => `Höhenprofil und Strecke von ${n}`, ogDefault: "Läufe – Strecke, Höhenprofil und Pace-Plan", support: "Support", privacy: "Datenschutzerklärung", terms: "Nutzungsbedingungen", contact: "Über Mila und Kontakt", report: "Melden",
    metaTail: "Strecke und Höhenprofil ansehen und deinen Pace-Plan in Mila holen.", metaAid: (n: number) => `${n} Verpflegungsstellen`, metaClimb: (a: string) => `${a} Höhenmeter`, metaHigh: (h: string) => `höchster Punkt ${h} m`,
  },
  nb: {
    langName: "Norsk", langNav: "Språk", skip: "Hopp til innholdet", crumbs: "Brødsmuler", home: "Mila", races: "Løp", brandLine: "Rett økt. Rett dag.",
    titleTail: "løype, høydeprofil og tempoplan", indexTitle: "Løp – løyper, høydeprofiler og tempoplaner", indexH1: "Finn ditt neste løp",
    indexLead: "Løyper fra Milas løpsregister med høydeprofil, stigninger, drikkestasjoner og makstider. Velg løpet ditt og få en personlig prognose, tempoplan og energiplan i Mila.",
    pageN: (n: number) => `side ${n}`, count: (n: number) => `${n} løp`,
    distance: "Distanse", climbing: "Høydemeter", highest: "Høyeste punkt", terrain: "Underlag", character: "Karakter", start: "Start", aid: "Drikkestasjoner",
    trail: "Terreng og sti", road: "Vei", trailRace: "terrengløp", roadRace: "gateløp", masl: "moh.",
    hilly: ["flat", "lett kupert", "kupert", "svært kupert", "fjellpreget"], perKm: (x: string) => `${x} m per km`,
    profileH: "Høydeprofil", profileTitle: (n: string) => `Høydeprofil for ${n}`,
    profileDesc: (km: string, lo: string, hi: string, n: number) => `Høyden langs løypas ${km}${n ? `, med ${n} ${n === 1 ? "drikkestasjon" : "drikkestasjoner"} markert` : ""}: fra ${lo} til ${hi} moh.`,
    dem: "Høydene kommer fra en høydemodell, ikke fra løypefilen.",
    runners: (n: number) => n === 1 ? "Høydene er målt av en løper som har løpt løpet med Mila, ikke hentet fra en høydemodell." : `Høydene er målt av ${n} løpere som har løpt løpet med Mila, ikke hentet fra en høydemodell.`,
    routeH: "Løypa", routeTitle: (n: string) => `Løypetraseen for ${n}`,
    routeDesc: (loop: boolean) => loop ? "Løypa sett ovenfra, nord opp. Start og mål på samme sted." : "Løypa sett ovenfra, nord opp, fra start til mål.",
    legend: (loop: boolean, aid: boolean) => `${loop ? "Grønt punkt: start og mål." : "Grønt punkt: start. Hvitt punkt: mål."}${aid ? " Små grønne punkter: drikkestasjoner." : ""}`,
    official: "Løype fra arrangøren", organiserPage: "arrangørens side", upload: "Løypa bygger på en løypefil lastet opp i Mila og kan avvike fra årets offisielle løype.",
    aboutH: "Om løypa", coachNote: "",
    climbsH: "Stigninger", climbsCaption: "Stigninger på minst 25 høydemeter. Stigningsgraden er snittet fra bunn til topp.",
    climbCols: ["Starter ved", "Lengde", "Høydemeter", "Stigning", "Topp (moh.)"], noClimbs: "Løypa har ingen sammenhengende stigninger på 25 høydemeter eller mer.",
    aidH: "Drikkestasjoner", aidOne: "Drikkestasjon", aidCaption: "Drikkestasjoner ifølge arrangøren.", aidCols: ["Ved", "Her finnes"], aidNone: "ikke oppgitt",
    aidWords: { vatten: "vann", sportdryck: "sportsdrikk", gel: "gel", mat: "mat", salt: "salt" } as Record<string, string>,
    practicalH: "Før start", startsH: "Starttider", placeH: "Startsted", showMap: "Vis på kart", cutoffsH: "Makstider", cutoffCaption: "Makstider ifølge arrangøren.",
    cutoffCols: ["Ved", "Senest"], clock: (t: string) => `kl. ${t}`, elapsed: (h: number, m: number) => `${h} t${m ? ` ${m} min` : ""} etter start`,
    kitH: "Obligatorisk utstyr", source: "Kilde", checked: (d: string) => `hentet ${d}`, at: (km: string) => `km ${km}`,
    resultsH: "Resultater fra tidligere år",
    result: (y: number, n: string, p50: string, p25: string, p75: string, p10: string, p90: string) =>
      `I ${y} fullførte ${n} løpere. Mediantiden var ${p50}; den midterste halvdelen av feltet kom i mål mellom ${p25} og ${p75}, og 80 % mellom ${p10} og ${p90}.`,
    resultsNote: "Oppsummert fra de offisielle resultatlistene: bare antall og tider, ingen navn eller enkeltresultater.", resultSource: "resultatlisten",
    ctaH: "Forbered deg med Mila",
    ctaText: "Mila er en løpecoach i en app. Legger du et løp inn i planen din, planlegger coachen ukene fram til start etter formen din, og gir deg en tidsprognose og en plan for tempo, drikke og energi i løypa.",
    notAffiliated: "Mila er ikke tilknyttet, sponset av eller godkjent av arrangøren eller løpets sponsorer. Navn og varemerker tilhører sine eiere.",
    notAffiliatedAll: "Mila er ikke tilknyttet, sponset av eller godkjent av løpenes arrangører eller sponsorer. Navn og varemerker tilhører sine eiere.",
    rights: "Arrangør eller rettighetshaver? Be om endring eller fjerning", officialName: "Offisielt navn",
    published: "Løype publisert av arrangøren på", elevAttribution: "Høydedata: Terrain Tiles (AWS Open Data) med data fra blant annet SRTM, ArcticDEM, EU-DEM, GMTED2010, ETOPO1, NED og 3DEP.",
    movedTitle: "Siden har flyttet | Mila", moved: "Siden har flyttet.", movedLink: "Til siden",
    store: "Last ned fra App Store", nearbyH: "Flere løp i nærheten", organizer: "Arrangør",
    disclaimer: "Opplysningene kommer fra løypefilen og arrangørens informasjon. Sjekk dato, starttider og regler hos arrangøren.",
    disclaimerNoCourse: "Opplysningene kommer fra arrangørens informasjon. Sjekk dato, starttider og regler hos arrangøren.",
    noCourse: "Arrangøren publiserer ikke løypa som fil, så her finnes verken kart eller høydeprofil. Løypetraseen finner du hos arrangøren.",
    aboutRaceH: "Om løpet", titleTailNoCourse: "dato, distanse og tempoplan", metaTailNoCourse: "Se dato og distanse og få tempoplanen din i Mila.", ogAltNoCourse: (n: string) => `${n} – løp i Milas løpsregister`,
    prelim: "foreløpig dato", noDate: "Datoen for neste utgave er ikke klar ennå.", last: (d: string) => `Sist: ${d}.`,
    passed: (d: string) => `Løpet gikk ${d}. Datoen for neste utgave er ikke klar ennå.`,
    cd: { today: "i dag", tomorrow: "i morgen", days: "om # dager", weeks: "om # uker", months: "om # måneder", past: "er gjennomført" },
    allRaces: "Se alle løp",
    noDateGroup: "Dato ikke klar", filterDistance: "Distanse", filterCountry: "Land", all: "Alle distanser", allCountries: "Alle land",
    buckets: ["Opptil 10 km", "11–21 km", "22–42 km", "Ultra, over 42 km"], noMatch: "Ingen løp passer filteret.", pages: "Sider", prev: "Forrige", next: "Neste",
    ogAlt: (n: string) => `Høydeprofil og løype for ${n}`, ogDefault: "Løp – løype, høydeprofil og tempoplan", support: "Support", privacy: "Personvernerklæring", terms: "Vilkår", contact: "Om Mila og kontakt", report: "Rapporter",
    metaTail: "Se løype og høydeprofil og få tempoplanen din i Mila.", metaAid: (n: number) => `${n} drikkestasjoner`, metaClimb: (a: string) => `${a} høydemeter`, metaHigh: (h: string) => `høyeste punkt ${h} m`,
  },
  da: {
    langName: "Dansk", langNav: "Sprog", skip: "Spring til indholdet", crumbs: "Brødkrummer", home: "Mila", races: "Løb", brandLine: "Den rette træning. Den rette dag.",
    titleTail: "rute, højdeprofil og tempoplan", indexTitle: "Løb – ruter, højdeprofiler og tempoplaner", indexH1: "Find dit næste løb",
    indexLead: "Ruter fra Milas løbskalender med højdeprofil, stigninger, væskedepoter og maksimaltider. Vælg dit løb, og få en personlig prognose, tempoplan og energiplan i Mila.",
    pageN: (n: number) => `side ${n}`, count: (n: number) => `${n} løb`,
    distance: "Distance", climbing: "Højdemeter", highest: "Højeste punkt", terrain: "Underlag", character: "Karakter", start: "Start", aid: "Væskedepoter",
    trail: "Terræn og sti", road: "Vej", trailRace: "trailløb", roadRace: "vejløb", masl: "m o.h.",
    hilly: ["flad", "let kuperet", "kuperet", "meget kuperet", "bjergrig"], perKm: (x: string) => `${x} m pr. km`,
    profileH: "Højdeprofil", profileTitle: (n: string) => `Højdeprofil for ${n}`,
    profileDesc: (km: string, lo: string, hi: string, n: number) => `Højden langs rutens ${km}${n ? `, med ${n} ${n === 1 ? "væskedepot" : "væskedepoter"} markeret` : ""}: fra ${lo} til ${hi} m o.h.`,
    dem: "Højderne kommer fra en højdemodel, ikke fra rutefilen.",
    runners: (n: number) => n === 1 ? "Højderne er målt af en løber, der har gennemført løbet med Mila, ikke hentet fra en højdemodel." : `Højderne er målt af ${n} løbere, der har gennemført løbet med Mila, ikke hentet fra en højdemodel.`,
    routeH: "Ruten", routeTitle: (n: string) => `Rutens forløb for ${n}`,
    routeDesc: (loop: boolean) => loop ? "Ruten set oppefra, nord opad. Start og mål samme sted." : "Ruten set oppefra, nord opad, fra start til mål.",
    legend: (loop: boolean, aid: boolean) => `${loop ? "Grøn prik: start og mål." : "Grøn prik: start. Hvid prik: mål."}${aid ? " Små grønne prikker: væskedepoter." : ""}`,
    official: "Rute fra arrangøren", organiserPage: "arrangørens side", upload: "Ruten bygger på en rutefil uploadet i Mila og kan afvige fra årets officielle rute.",
    aboutH: "Om ruten", coachNote: "",
    climbsH: "Stigninger", climbsCaption: "Stigninger på mindst 25 højdemeter. Hældningen er gennemsnittet fra bund til top.",
    climbCols: ["Begynder ved", "Længde", "Højdemeter", "Hældning", "Top (m o.h.)"], noClimbs: "Ruten har ingen sammenhængende stigninger på 25 højdemeter eller mere.",
    aidH: "Væskedepoter", aidOne: "Væskedepot", aidCaption: "Væskedepoter ifølge arrangøren.", aidCols: ["Ved", "Her er"], aidNone: "ikke oplyst",
    aidWords: { vatten: "vand", sportdryck: "sportsdrik", gel: "gel", mat: "mad", salt: "salt" } as Record<string, string>,
    practicalH: "Før start", startsH: "Starttider", placeH: "Startsted", showMap: "Vis på kort", cutoffsH: "Maksimaltider", cutoffCaption: "Maksimaltider ifølge arrangøren.",
    cutoffCols: ["Ved", "Senest"], clock: (t: string) => `kl. ${t}`, elapsed: (h: number, m: number) => `${h} t${m ? ` ${m} min` : ""} efter start`,
    kitH: "Obligatorisk udstyr", source: "Kilde", checked: (d: string) => `hentet ${d}`, at: (km: string) => `km ${km}`,
    resultsH: "Resultater fra tidligere år",
    result: (y: number, n: string, p50: string, p25: string, p75: string, p10: string, p90: string) =>
      `I ${y} gennemførte ${n} løbere. Mediantiden var ${p50}; den midterste halvdel af feltet kom i mål mellem ${p25} og ${p75}, og 80 % mellem ${p10} og ${p90}.`,
    resultsNote: "Opsummeret fra de officielle resultatlister: kun antal og tider, ingen navne eller enkeltresultater.", resultSource: "resultatlisten",
    ctaH: "Forbered dig med Mila",
    ctaText: "Mila er en løbecoach i en app. Lægger du et løb ind i din plan, planlægger coachen ugerne frem til start efter din form og giver dig en tidsprognose og en plan for tempo, væske og energi på ruten.",
    notAffiliated: "Mila er ikke tilknyttet, sponsoreret af eller godkendt af arrangøren eller løbets sponsorer. Navne og varemærker tilhører deres ejere.",
    notAffiliatedAll: "Mila er ikke tilknyttet, sponsoreret af eller godkendt af løbenes arrangører eller sponsorer. Navne og varemærker tilhører deres ejere.",
    rights: "Arrangør eller rettighedshaver? Bed om ændring eller fjernelse", officialName: "Officielt navn",
    published: "Rute offentliggjort af arrangøren på", elevAttribution: "Højdedata: Terrain Tiles (AWS Open Data) med data fra bl.a. SRTM, ArcticDEM, EU-DEM, GMTED2010, ETOPO1, NED og 3DEP.",
    movedTitle: "Siden er flyttet | Mila", moved: "Siden er flyttet.", movedLink: "Til siden",
    store: "Hent i App Store", nearbyH: "Flere løb i nærheden", organizer: "Arrangør",
    disclaimer: "Oplysningerne kommer fra rutefilen og arrangørens information. Tjek dato, starttider og regler hos arrangøren.",
    disclaimerNoCourse: "Oplysningerne kommer fra arrangørens information. Tjek dato, starttider og regler hos arrangøren.",
    noCourse: "Arrangøren offentliggør ikke ruten som fil, så her er hverken kort eller højdeprofil. Rutens forløb finder du hos arrangøren.",
    aboutRaceH: "Om løbet", titleTailNoCourse: "dato, distance og tempoplan", metaTailNoCourse: "Se dato og distance, og få din tempoplan i Mila.", ogAltNoCourse: (n: string) => `${n} – løb i Milas løbskalender`,
    prelim: "foreløbig dato", noDate: "Datoen for næste udgave er ikke fastlagt endnu.", last: (d: string) => `Senest: ${d}.`,
    passed: (d: string) => `Løbet blev afviklet ${d}. Datoen for næste udgave er ikke fastlagt endnu.`,
    cd: { today: "i dag", tomorrow: "i morgen", days: "om # dage", weeks: "om # uger", months: "om # måneder", past: "er afviklet" },
    allRaces: "Se alle løb",
    noDateGroup: "Dato ikke fastlagt", filterDistance: "Distance", filterCountry: "Land", all: "Alle distancer", allCountries: "Alle lande",
    buckets: ["Op til 10 km", "11–21 km", "22–42 km", "Ultra, over 42 km"], noMatch: "Ingen løb passer til filteret.", pages: "Sider", prev: "Forrige", next: "Næste",
    ogAlt: (n: string) => `Højdeprofil og rute for ${n}`, ogDefault: "Løb – rute, højdeprofil og tempoplan", support: "Support", privacy: "Privatlivspolitik", terms: "Vilkår", contact: "Om Mila og kontakt", report: "Rapportér",
    metaTail: "Se rute og højdeprofil, og få din tempoplan i Mila.", metaAid: (n: number) => `${n} væskedepoter`, metaClimb: (a: string) => `${a} højdemeter`, metaHigh: (h: string) => `højeste punkt ${h} m`,
  },
  fi: {
    langName: "Suomi", langNav: "Kieli", skip: "Siirry sisältöön", crumbs: "Murupolku", home: "Mila", races: "Kisat", brandLine: "Oikea harjoitus. Oikea päivä.",
    titleTail: "reitti, korkeusprofiili ja vauhtisuunnitelma", indexTitle: "Kisat – reitit, korkeusprofiilit ja vauhtisuunnitelmat", indexH1: "Löydä seuraava kisasi",
    indexLead: "Reitit Milan kisakalenterista: korkeusprofiili, nousut, juomapisteet ja maksimiajat. Valitse kisasi, niin saat Milasta henkilökohtaisen ennusteen, vauhtisuunnitelman ja energiasuunnitelman.",
    pageN: (n: number) => `sivu ${n}`, count: (n: number) => `${n} ${n === 1 ? "kisa" : "kisaa"}`,
    distance: "Matka", climbing: "Nousumetrit", highest: "Korkein kohta", terrain: "Alusta", character: "Luonne", start: "Lähtö", aid: "Juomapisteet",
    trail: "Maasto ja polku", road: "Maantie", trailRace: "polkujuoksu", roadRace: "maantiejuoksu", masl: "m mpy",
    hilly: ["tasainen", "loivasti mäkinen", "mäkinen", "hyvin mäkinen", "vuoristoinen"], perKm: (x: string) => `${x} m/km`,
    profileH: "Korkeusprofiili", profileTitle: (n: string) => `Korkeusprofiili: ${n}`,
    profileDesc: (km: string, lo: string, hi: string, n: number) => `Korkeus ${km}:n reitin varrella${n ? `, ${n} ${n === 1 ? "juomapiste" : "juomapistettä"} merkitty` : ""}: ${lo}–${hi} m mpy.`,
    dem: "Korkeudet ovat korkeusmallista, eivät reittitiedostosta.",
    runners: (n: number) => n === 1 ? "Korkeudet on mitannut juoksija, joka on juossut kisan Milan kanssa; niitä ei ole otettu korkeusmallista." : `Korkeudet on mitannut ${n} juoksijaa, jotka ovat juosseet kisan Milan kanssa; niitä ei ole otettu korkeusmallista.`,
    routeH: "Reitti", routeTitle: (n: string) => `Reitin kulku: ${n}`,
    routeDesc: (loop: boolean) => loop ? "Reitti ylhäältä nähtynä, pohjoinen ylhäällä. Lähtö ja maali samassa paikassa." : "Reitti ylhäältä nähtynä, pohjoinen ylhäällä, lähdöstä maaliin.",
    legend: (loop: boolean, aid: boolean) => `${loop ? "Vihreä piste: lähtö ja maali." : "Vihreä piste: lähtö. Valkoinen piste: maali."}${aid ? " Pienet vihreät pisteet: juomapisteet." : ""}`,
    official: "Järjestäjän reitti", organiserPage: "järjestäjän sivu", upload: "Reitti perustuu Milaan ladattuun reittitiedostoon ja voi poiketa tämän vuoden virallisesta reitistä.",
    aboutH: "Tietoa reitistä", coachNote: "",
    climbsH: "Nousut", climbsCaption: "Vähintään 25 nousumetrin nousut. Jyrkkyys on keskiarvo alhaalta huipulle.",
    climbCols: ["Alkaa kohdassa", "Pituus", "Nousumetrit", "Jyrkkyys", "Huippu (m mpy)"], noClimbs: "Reitillä ei ole yhtenäisiä vähintään 25 nousumetrin nousuja.",
    aidH: "Juomapisteet", aidOne: "Juomapiste", aidCaption: "Juomapisteet järjestäjän mukaan.", aidCols: ["Kohta", "Tarjolla"], aidNone: "ei ilmoitettu",
    aidWords: { vatten: "vesi", sportdryck: "urheilujuoma", gel: "geeli", mat: "ruoka", salt: "suola" } as Record<string, string>,
    practicalH: "Ennen lähtöä", startsH: "Lähtöajat", placeH: "Lähtöpaikka", showMap: "Näytä kartalla", cutoffsH: "Maksimiajat", cutoffCaption: "Maksimiajat järjestäjän mukaan.",
    cutoffCols: ["Kohta", "Viimeistään"], clock: (t: string) => `klo ${t}`, elapsed: (h: number, m: number) => `${h} h${m ? ` ${m} min` : ""} lähdöstä`,
    kitH: "Pakolliset varusteet", source: "Lähde", checked: (d: string) => `haettu ${d}`, at: (km: string) => `km ${km}`,
    resultsH: "Tuloksia aiemmista kisoista",
    result: (y: number, n: string, p50: string, p25: string, p75: string, p10: string, p90: string) =>
      `Vuonna ${y} maaliin tuli ${n} juoksijaa. Mediaaniaika oli ${p50}; kentän keskimmäinen puolikas tuli maaliin ajassa ${p25}–${p75} ja 80 % ajassa ${p10}–${p90}.`,
    resultsNote: "Koottu virallisista tulosluetteloista: vain määrät ja ajat, ei nimiä eikä yksittäisiä tuloksia.", resultSource: "tulosluettelo",
    ctaH: "Valmistaudu Milan kanssa",
    ctaText: "Mila on juoksuvalmentaja sovelluksessa. Kun lisäät kisan suunnitelmaasi, valmentaja suunnittelee viikot starttiin asti kuntosi mukaan ja antaa sinulle loppuaikaennusteen sekä suunnitelman vauhdista, juomisesta ja energiasta reitillä.",
    notAffiliated: "Mila ei ole yhteydessä järjestäjään eikä kisan sponsoreihin, eivätkä ne sponsoroi tai suosittele Milaa. Nimet ja tavaramerkit kuuluvat omistajilleen.",
    notAffiliatedAll: "Mila ei ole yhteydessä kisojen järjestäjiin eikä sponsoreihin, eivätkä ne sponsoroi tai suosittele Milaa. Nimet ja tavaramerkit kuuluvat omistajilleen.",
    rights: "Järjestäjä tai oikeuksien haltija? Pyydä muutosta tai poistoa", officialName: "Virallinen nimi",
    published: "Järjestäjän julkaisema reitti sivustolla", elevAttribution: "Korkeustiedot: Terrain Tiles (AWS Open Data), aineistoina muun muassa SRTM, ArcticDEM, EU-DEM, GMTED2010, ETOPO1, NED ja 3DEP.",
    movedTitle: "Sivu on siirtynyt | Mila", moved: "Sivu on siirtynyt.", movedLink: "Siirry sivulle",
    store: "Lataa App Storesta", nearbyH: "Lisää kisoja lähellä", organizer: "Järjestäjä",
    disclaimer: "Tiedot ovat reittitiedostosta ja järjestäjän tiedoista. Tarkista päivä, lähtöajat ja säännöt järjestäjältä.",
    disclaimerNoCourse: "Tiedot ovat järjestäjän tiedoista. Tarkista päivä, lähtöajat ja säännöt järjestäjältä.",
    noCourse: "Järjestäjä ei julkaise reittiä tiedostona, joten tässä ei ole karttaa eikä korkeusprofiilia. Reitin kulku löytyy järjestäjältä.",
    aboutRaceH: "Tietoa kisasta", titleTailNoCourse: "päivä, matka ja vauhtisuunnitelma", metaTailNoCourse: "Katso päivä ja matka ja hae vauhtisuunnitelmasi Milasta.", ogAltNoCourse: (n: string) => `${n} – kisa Milan kisakalenterissa`,
    prelim: "alustava päivä", noDate: "Seuraavan kisan päivä ei ole vielä selvillä.", last: (d: string) => `Viimeksi: ${d}.`,
    passed: (d: string) => `Kisa juostiin ${d}. Seuraavan kisan päivä ei ole vielä selvillä.`,
    cd: { today: "tänään", tomorrow: "huomenna", days: "# päivän päästä", weeks: "# viikon päästä", months: "# kuukauden päästä", past: "on jo juostu" },
    allRaces: "Katso kaikki kisat",
    noDateGroup: "Päivä ei selvillä", filterDistance: "Matka", filterCountry: "Maa", all: "Kaikki matkat", allCountries: "Kaikki maat",
    buckets: ["Enintään 10 km", "11–21 km", "22–42 km", "Ultra, yli 42 km"], noMatch: "Yksikään kisa ei vastaa suodatinta.", pages: "Sivut", prev: "Edellinen", next: "Seuraava",
    ogAlt: (n: string) => `Korkeusprofiili ja reitti: ${n}`, ogDefault: "Kisat – reitti, korkeusprofiili ja vauhtisuunnitelma", support: "Tuki", privacy: "Tietosuojaseloste", terms: "Käyttöehdot", contact: "Tietoa Milasta ja yhteystiedot", report: "Ilmoita",
    metaTail: "Katso reitti ja korkeusprofiili ja hae vauhtisuunnitelmasi Milasta.", metaAid: (n: number) => `${n} juomapistettä`, metaClimb: (a: string) => `${a} nousumetriä`, metaHigh: (h: string) => `korkein kohta ${h} m`,
  },
  fr: {
    langName: "Français", langNav: "Langue", skip: "Aller au contenu", crumbs: "Fil d’Ariane", home: "Mila", races: "Courses", brandLine: "La bonne séance. Le bon jour.",
    titleTail: "parcours, profil d’altitude et plan d’allure", indexTitle: "Courses – parcours, profils d’altitude et plans d’allure", indexH1: "Trouve ta prochaine course",
    indexLead: "Les parcours du calendrier des courses de Mila, avec profil d’altitude, montées, ravitaillements et barrières horaires. Choisis ta course et obtiens dans Mila un pronostic personnel, un plan d’allure et un plan de ravitaillement.",
    pageN: (n: number) => `page ${n}`, count: (n: number) => `${n} ${n === 1 ? "course" : "courses"}`,
    distance: "Distance", climbing: "Dénivelé positif", highest: "Point culminant", terrain: "Terrain", character: "Profil", start: "Départ", aid: "Ravitaillements",
    trail: "Trail et sentiers", road: "Route", trailRace: "un trail", roadRace: "une course sur route", masl: "m d’altitude",
    hilly: ["plat", "légèrement vallonné", "vallonné", "très vallonné", "montagneux"], perKm: (x: string) => `${x} m par km`,
    profileH: "Profil d’altitude", profileTitle: (n: string) => `Profil d’altitude : ${n}`,
    profileDesc: (km: string, lo: string, hi: string, n: number) => `L’altitude le long des ${km} du parcours${n ? `, avec ${n} ${n === 1 ? "ravitaillement indiqué" : "ravitaillements indiqués"}` : ""} : de ${lo} à ${hi} m d’altitude.`,
    dem: "Les altitudes proviennent d’un modèle d’élévation, pas du fichier du parcours.",
    runners: (n: number) => n === 1 ? "Les altitudes ont été mesurées par une personne qui a couru l’épreuve avec Mila, et non tirées d’un modèle d’élévation." : `Les altitudes ont été mesurées par ${n} coureurs qui ont couru l’épreuve avec Mila, et non tirées d’un modèle d’élévation.`,
    routeH: "Le parcours", routeTitle: (n: string) => `Tracé du parcours : ${n}`,
    routeDesc: (loop: boolean) => loop ? "Le parcours vu du dessus, nord en haut. Départ et arrivée au même endroit." : "Le parcours vu du dessus, nord en haut, du départ à l’arrivée.",
    legend: (loop: boolean, aid: boolean) => `${loop ? "Point vert : départ et arrivée." : "Point vert : départ. Point blanc : arrivée."}${aid ? " Petits points verts : ravitaillements." : ""}`,
    official: "Parcours fourni par l’organisateur", organiserPage: "site de l’organisateur", upload: "Le parcours s’appuie sur un fichier importé dans Mila et peut différer du parcours officiel de cette année.",
    aboutH: "À propos du parcours", coachNote: "",
    climbsH: "Montées", climbsCaption: "Montées d’au moins 25 m de dénivelé. La pente est la moyenne du bas jusqu’au sommet.",
    climbCols: ["Début", "Longueur", "Dénivelé", "Pente", "Sommet (m d’altitude)"], noClimbs: "Le parcours ne compte aucune montée continue de 25 m ou plus.",
    aidH: "Ravitaillements", aidOne: "Ravitaillement", aidCaption: "Ravitaillements selon l’organisateur.", aidCols: ["Au", "Ce qu’on y trouve"], aidNone: "non précisé",
    aidWords: { vatten: "eau", sportdryck: "boisson énergétique", gel: "gels", mat: "nourriture", salt: "sel" } as Record<string, string>,
    practicalH: "Avant le départ", startsH: "Heures de départ", placeH: "Lieu de départ", showMap: "Voir sur la carte", cutoffsH: "Barrières horaires", cutoffCaption: "Barrières horaires selon l’organisateur.",
    cutoffCols: ["Au", "Au plus tard"], clock: (t: string) => frClock(t), elapsed: (h: number, m: number) => `${h} h${m ? ` ${m} min` : ""} après le départ`,
    kitH: "Matériel obligatoire", source: "Source", checked: (d: string) => `consulté le ${d}`, at: (km: string) => `km ${km}`,
    resultsH: "Résultats des éditions précédentes",
    result: (y: number, n: string, p50: string, p25: string, p75: string, p10: string, p90: string) =>
      `En ${y}, ${n} coureurs ont franchi la ligne d’arrivée. Le temps médian était de ${p50} ; la moitié centrale du peloton a terminé entre ${p25} et ${p75}, et 80 % entre ${p10} et ${p90}.`,
    resultsNote: "Résumé à partir des résultats officiels : uniquement des effectifs et des temps, ni noms ni résultats individuels.", resultSource: "résultats",
    ctaH: "Prépare-toi avec Mila",
    ctaText: "Mila est une app avec un coach de course à pied. Ajoute une course à ton plan : le coach planifie tes semaines jusqu’au départ selon ta forme, et te donne un pronostic de temps et un plan pour l’allure, l’hydratation et l’énergie sur le parcours.",
    notAffiliated: "Mila n’est ni affiliée à l’organisateur ou aux sponsors de la course, ni sponsorisée ou approuvée par eux. Les noms et les marques appartiennent à leurs propriétaires.",
    notAffiliatedAll: "Mila n’est ni affiliée aux organisateurs ou aux sponsors des courses, ni sponsorisée ou approuvée par eux. Les noms et les marques appartiennent à leurs propriétaires.",
    rights: "Organisateur ou ayant droit ? Demander une modification ou un retrait", officialName: "Nom officiel",
    published: "Parcours publié par l’organisateur sur", elevAttribution: "Données d’altitude : Terrain Tiles (AWS Open Data), avec notamment des données SRTM, ArcticDEM, EU-DEM, GMTED2010, ETOPO1, NED et 3DEP.",
    movedTitle: "Cette page a été déplacée | Mila", moved: "Cette page a été déplacée.", movedLink: "Aller à la page",
    store: "Télécharger dans l’App Store", nearbyH: "Autres courses à proximité", organizer: "Organisateur",
    disclaimer: "Les informations proviennent du fichier du parcours et de l’organisateur. Vérifie la date, les heures de départ et le règlement auprès de l’organisateur.",
    disclaimerNoCourse: "Les informations proviennent de l’organisateur. Vérifie la date, les heures de départ et le règlement auprès de l’organisateur.",
    noCourse: "L’organisateur ne publie pas le parcours sous forme de fichier, il n’y a donc ici ni carte ni profil d’altitude. Le tracé est disponible auprès de l’organisateur.",
    aboutRaceH: "À propos de la course", titleTailNoCourse: "date, distance et plan d’allure", metaTailNoCourse: "Consulte la date et la distance, et obtiens ton plan d’allure dans Mila.", ogAltNoCourse: (n: string) => `${n} – course du calendrier de Mila`,
    prelim: "date provisoire", noDate: "La date de la prochaine édition n’est pas encore fixée.", last: (d: string) => `Dernière édition : ${d}.`,
    passed: (d: string) => `La course a eu lieu le ${d}. La date de la prochaine édition n’est pas encore fixée.`,
    cd: { today: "aujourd’hui", tomorrow: "demain", days: "dans # jours", weeks: "dans # semaines", months: "dans # mois", past: "a eu lieu" },
    allRaces: "Voir toutes les courses",
    noDateGroup: "Date non fixée", filterDistance: "Distance", filterCountry: "Pays", all: "Toutes les distances", allCountries: "Tous les pays",
    buckets: ["Jusqu’à 10 km", "11–21 km", "22–42 km", "Ultra, plus de 42 km"], noMatch: "Aucune course ne correspond au filtre.", pages: "Pages", prev: "Précédente", next: "Suivante",
    ogAlt: (n: string) => `Profil d’altitude et parcours : ${n}`, ogDefault: "Courses – parcours, profil d’altitude et plan d’allure", support: "Assistance", privacy: "Politique de confidentialité", terms: "Conditions d’utilisation", contact: "À propos de Mila et contact", report: "Signaler",
    metaTail: "Consulte le parcours et le profil d’altitude, et obtiens ton plan d’allure dans Mila.", metaAid: (n: number) => `${n} ravitaillements`, metaClimb: (a: string) => `${a} m de D+`, metaHigh: (h: string) => `point culminant ${h} m`,
  },
  es: {
    langName: "Español", langNav: "Idioma", skip: "Saltar al contenido", crumbs: "Ruta de navegación", home: "Mila", races: "Carreras", brandLine: "La sesión justa. El día justo.",
    titleTail: "recorrido, perfil de altitud y plan de ritmo", indexTitle: "Carreras – recorridos, perfiles de altitud y planes de ritmo", indexH1: "Encuentra tu próxima carrera",
    indexLead: "Recorridos del calendario de carreras de Mila con perfil de altitud, subidas, avituallamientos y tiempos de corte. Elige tu carrera y consigue en Mila un pronóstico personal, un plan de ritmo y un plan de avituallamiento.",
    pageN: (n: number) => `página ${n}`, count: (n: number) => `${n} ${n === 1 ? "carrera" : "carreras"}`,
    distance: "Distancia", climbing: "Desnivel positivo", highest: "Punto más alto", terrain: "Superficie", character: "Perfil", start: "Salida", aid: "Avituallamientos",
    trail: "Trail y sendero", road: "Asfalto", trailRace: "una carrera de trail", roadRace: "una carrera en ruta", masl: "m s. n. m.",
    hilly: ["llano", "ligeramente ondulado", "ondulado", "muy ondulado", "montañoso"], perKm: (x: string) => `${x} m por km`,
    profileH: "Perfil de altitud", profileTitle: (n: string) => `Perfil de altitud de ${n}`,
    profileDesc: (km: string, lo: string, hi: string, n: number) => `La altitud a lo largo de los ${km} del recorrido${n ? `, con ${n} ${n === 1 ? "avituallamiento marcado" : "avituallamientos marcados"}` : ""}: de ${lo} a ${hi} m s. n. m.`,
    dem: "Las altitudes proceden de un modelo de elevación, no del archivo del recorrido.",
    runners: (n: number) => n === 1 ? "Las altitudes las ha medido una persona que corrió la carrera con Mila; no proceden de un modelo de elevación." : `Las altitudes las han medido ${n} corredores que corrieron la carrera con Mila; no proceden de un modelo de elevación.`,
    routeH: "El recorrido", routeTitle: (n: string) => `Trazado del recorrido de ${n}`,
    routeDesc: (loop: boolean) => loop ? "El recorrido visto desde arriba, con el norte arriba. Salida y meta en el mismo lugar." : "El recorrido visto desde arriba, con el norte arriba, de la salida a la meta.",
    legend: (loop: boolean, aid: boolean) => `${loop ? "Punto verde: salida y meta." : "Punto verde: salida. Punto blanco: meta."}${aid ? " Puntos verdes pequeños: avituallamientos." : ""}`,
    official: "Recorrido del organizador", organiserPage: "web del organizador", upload: "El recorrido se basa en un archivo subido a Mila y puede diferir del recorrido oficial de este año.",
    aboutH: "Sobre el recorrido", coachNote: "",
    climbsH: "Subidas", climbsCaption: "Subidas de al menos 25 m de desnivel. La pendiente es la media de abajo arriba.",
    climbCols: ["Empieza en", "Longitud", "Desnivel", "Pendiente", "Cima (m s. n. m.)"], noClimbs: "El recorrido no tiene subidas continuas de 25 m o más.",
    aidH: "Avituallamientos", aidOne: "Avituallamiento", aidCaption: "Avituallamientos según el organizador.", aidCols: ["En", "Qué hay"], aidNone: "sin especificar",
    aidWords: { vatten: "agua", sportdryck: "bebida isotónica", gel: "geles", mat: "comida", salt: "sal" } as Record<string, string>,
    practicalH: "Antes de la salida", startsH: "Horas de salida", placeH: "Lugar de salida", showMap: "Ver en el mapa", cutoffsH: "Tiempos de corte", cutoffCaption: "Tiempos de corte según el organizador.",
    cutoffCols: ["En", "Como muy tarde"], clock: (t: string) => `${t} h`, elapsed: (h: number, m: number) => `${h} h${m ? ` ${m} min` : ""} desde la salida`,
    kitH: "Material obligatorio", source: "Fuente", checked: (d: string) => `consultado el ${d}`, at: (km: string) => `km ${km}`,
    resultsH: "Resultados de ediciones anteriores",
    result: (y: number, n: string, p50: string, p25: string, p75: string, p10: string, p90: string) =>
      `En ${y} terminaron ${n} corredores. El tiempo mediano fue ${p50}; la mitad central del pelotón llegó a meta entre ${p25} y ${p75}, y el 80 % entre ${p10} y ${p90}.`,
    resultsNote: "Resumido a partir de las clasificaciones oficiales: solo cifras y tiempos, sin nombres ni resultados individuales.", resultSource: "clasificación",
    ctaH: "Prepárate con Mila",
    ctaText: "Mila es un coach de running en una app. Si añades una carrera a tu plan, el coach planifica tus semanas hasta la salida según tu forma y te da un pronóstico de tiempo y un plan de ritmo, hidratación y energía para el recorrido.",
    notAffiliated: "Mila no está vinculada al organizador ni a los patrocinadores de la carrera, ni está patrocinada o avalada por ellos. Los nombres y las marcas pertenecen a sus propietarios.",
    notAffiliatedAll: "Mila no está vinculada a los organizadores ni a los patrocinadores de las carreras, ni está patrocinada o avalada por ellos. Los nombres y las marcas pertenecen a sus propietarios.",
    rights: "¿Organizador o titular de derechos? Solicitar un cambio o la retirada", officialName: "Nombre oficial",
    published: "Recorrido publicado por el organizador en", elevAttribution: "Datos de altitud: Terrain Tiles (AWS Open Data), con datos de SRTM, ArcticDEM, EU-DEM, GMTED2010, ETOPO1, NED y 3DEP, entre otros.",
    movedTitle: "Esta página se ha trasladado | Mila", moved: "Esta página se ha trasladado.", movedLink: "Ir a la página",
    store: "Descárgalo en el App Store", nearbyH: "Más carreras cerca", organizer: "Organizador",
    disclaimer: "Los datos proceden del archivo del recorrido y de la información del organizador. Comprueba la fecha, las horas de salida y el reglamento con el organizador.",
    disclaimerNoCourse: "Los datos proceden de la información del organizador. Comprueba la fecha, las horas de salida y el reglamento con el organizador.",
    noCourse: "El organizador no publica el recorrido como archivo, así que aquí no hay mapa ni perfil de altitud. El trazado está en la web del organizador.",
    aboutRaceH: "Sobre la carrera", titleTailNoCourse: "fecha, distancia y plan de ritmo", metaTailNoCourse: "Consulta la fecha y la distancia y consigue tu plan de ritmo en Mila.", ogAltNoCourse: (n: string) => `${n} – carrera del calendario de Mila`,
    prelim: "fecha provisional", noDate: "La fecha de la próxima edición aún no está fijada.", last: (d: string) => `Última edición: ${d}.`,
    passed: (d: string) => `La carrera se celebró el ${d}. La fecha de la próxima edición aún no está fijada.`,
    cd: { today: "hoy", tomorrow: "mañana", days: "dentro de # días", weeks: "dentro de # semanas", months: "dentro de # meses", past: "ya se celebró" },
    allRaces: "Ver todas las carreras",
    noDateGroup: "Fecha sin fijar", filterDistance: "Distancia", filterCountry: "País", all: "Todas las distancias", allCountries: "Todos los países",
    buckets: ["Hasta 10 km", "11–21 km", "22–42 km", "Ultra, más de 42 km"], noMatch: "Ninguna carrera coincide con el filtro.", pages: "Páginas", prev: "Anterior", next: "Siguiente",
    ogAlt: (n: string) => `Perfil de altitud y recorrido de ${n}`, ogDefault: "Carreras – recorrido, perfil de altitud y plan de ritmo", support: "Soporte", privacy: "Política de privacidad", terms: "Condiciones de uso", contact: "Sobre Mila y contacto", report: "Denunciar",
    metaTail: "Consulta el recorrido y el perfil de altitud y consigue tu plan de ritmo en Mila.", metaAid: (n: number) => `${n} avituallamientos`, metaClimb: (a: string) => `${a} m de desnivel`, metaHigh: (h: string) => `punto más alto ${h} m`,
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
/** The race's name as headlines show it: without its sponsors (displayName), with the distance unless the name has it. */
export const raceTitle = (r: Pick<Race, "name" | "km">, lang: Lang) => { const n = displayName(r.name); return nameHasKm(n, r.km) ? n : `${n} ${kmShort(r.km, lang)}`; };

// ---- sponsors: a race's title, address and share image without them (review round 24, item 3: Mila never co-brands a race or a sponsor)

/** Watch, shoe and sportswear brands, and the big races' title sponsors, as they stand in front of a race's name (lower case). */
export const SPONSORS = ["garmin", "polar", "suunto", "coros", "apple", "fitbit", "wahoo", "amazfit", "huawei", "samsung", "tomtom",
  "adidas", "nike", "asics", "hoka one one", "hoka", "brooks", "saucony", "new balance", "puma", "salomon", "mizuno", "altra", "inov-8", "la sportiva",
  "merrell", "under armour", "reebok", "skechers", "on running", "icebug", "dynafit", "the north face", "compressport", "2xu",
  "bmw", "tcs", "bank of america", "schneider electric", "generali", "haspa", "volkswagen"];
/** Words after "Polar" that make it part of the race's own name ("Polar Night Halfmarathon", "Polar Circle Marathon"), not the brand. */
const POLAR_NAME = /^(night|nights|circle|bear|ice|star|express|fox|light)\b/i;
/** Words that say nothing about which race it is: what is left without the sponsor must hold another word. */
const GENERIC_NAME = new Set(["marathon", "maraton", "marathonet", "maratonet", "halvmarathon", "halvmaraton", "halfmarathon", "half", "halv", "trail", "trails",
  "run", "running", "race", "racing", "lopp", "loppet", "ultra", "city", "the", "by", "and", "och", "of", "km", "mil", "lauf", "halbmarathon"]);
const meaningful = (rest: string) => rest.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => [...w].length >= 3 && !GENERIC_NAME.has(w) && !/^\d+$/.test(w));
/** The race's name without its sponsors: a sponsor in front ("adidas Stockholm Marathon" → "Stockholm Marathon", "HOKA UTMB Mont-Blanc"
 *  → "UTMB Mont-Blanc"; up to three, as "BMW Berlin" behind another), and "presented by …" at the end. Only as whole words, and only
 *  when a name of its own is left ("adidas Marathon" stays). The official name stays in the page's text. */
export function displayName(name: string): string {
  let n = name.replace(/\s*[-–,]?\s*\b(?:presented|powered|sponsored)\s+by\s+.+$/i, "").trim() || name;
  for (let i = 0; i < 3; i++) {
    const low = n.toLowerCase();
    const hit = SPONSORS.filter((sp) => low.startsWith(sp) && /^[\s\-–:]/.test(n.slice(sp.length))).sort((a, b) => b.length - a.length)[0];
    if (!hit) break;
    const rest = n.slice(hit.length).replace(/^[\s\-–:]+/, "");
    if ((hit === "polar" && POLAR_NAME.test(rest)) || !meaningful(rest)) break;
    n = rest;
  }
  return n;
}
/** Lower-case ASCII for an address, as the feed makes its suggestion (race_feed.ts slugify). */
export function slugify(x: string): string {
  return x.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[øØ]/g, "o").replace(/[æÆ]/g, "ae").replace(/ß/g, "ss").replace(/[đĐ]/g, "d")
    .replace(/[łŁ]/g, "l").replace(/[þÞ]/g, "th").replace(/[œŒ]/g, "oe").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
/** A race's address from its name without sponsors and its distance (unless the name says it), as the feed's raceSlug. */
export function pageSlug(r: Pick<Race, "name" | "km">): string {
  const base = slugify(displayName(r.name)).slice(0, 70).replace(/-+$/, "") || "lopp", k = Math.round(r.km);
  if (!(k > 0) || new RegExp(`(^|-)${k}(k|km)?(-|$)`).test(base) || /(^|-)\d+(-\d+)?-?(k|km|mi|mil)(-|$)/.test(base)) return base;
  return `${base}-${k}k`;
}
/** A published address that starts with a sponsor ("adidas-stockholm-marathon"), which the race's name without sponsors does not: it
 *  moves once (movedPage at the old address). */
export function sponsorSlug(slug: string, r: Pick<Race, "name">): boolean {
  const own = slugify(displayName(r.name));
  return SPONSORS.some((sp) => { const p = slugify(sp) + "-"; return slug.startsWith(p) && !own.startsWith(p); });
}
const dayDate = (day: string) => new Date(`${day}T12:00:00Z`);
/** deadline: the words of the "Anmälan och nummerlapp" section, per language. */
const ENTRY_WORDS: Record<Lang, { h: string; closes: (d: string) => string; price: (d: string, p?: string) => string; pickupH: string; between: (a: string, b: string) => string; from: (a: string) => string; source: string; checked: (d: string) => string }> = {
  sv: { h: "Anmälan och nummerlapp", closes: (d) => `Anmälan stänger ${d}.`, price: (d, p) => p ? `${p} till och med ${d}.` : `Priset höjs efter ${d}.`, pickupH: "Nummerlappsutdelning",
    between: (a, b) => `kl. ${a}–${b}`, from: (a) => `från kl. ${a}`, source: "Källa", checked: (d) => `hämtat ${d}` },
  en: { h: "Registration and bib pickup", closes: (d) => `Registration closes ${d}.`, price: (d, p) => p ? `${p} until ${d}.` : `The price goes up after ${d}.`, pickupH: "Bib pickup",
    between: (a, b) => `${a}–${b}`, from: (a) => `from ${a}`, source: "Source", checked: (d) => `retrieved ${d}` },
  de: { h: "Anmeldung und Startnummer", closes: (d) => `Anmeldeschluss ist am ${d}.`, price: (d, p) => p ? `${p} bis einschließlich ${d}.` : `Der Preis steigt nach dem ${d}.`, pickupH: "Startnummernausgabe",
    between: (a, b) => `${a}–${b} Uhr`, from: (a) => `ab ${a} Uhr`, source: "Quelle", checked: (d) => `abgerufen am ${d}` },
  nb: { h: "Påmelding og startnummer", closes: (d) => `Påmeldingen stenger ${d}.`, price: (d, p) => p ? `${p} til og med ${d}.` : `Prisen øker etter ${d}.`, pickupH: "Utdeling av startnummer",
    between: (a, b) => `kl. ${a}–${b}`, from: (a) => `fra kl. ${a}`, source: "Kilde", checked: (d) => `hentet ${d}` },
  da: { h: "Tilmelding og startnummer", closes: (d) => `Tilmeldingen lukker ${d}.`, price: (d, p) => p ? `${p} til og med ${d}.` : `Prisen stiger efter ${d}.`, pickupH: "Udlevering af startnumre",
    between: (a, b) => `kl. ${a}–${b}`, from: (a) => `fra kl. ${a}`, source: "Kilde", checked: (d) => `hentet ${d}` },
  fi: { h: "Ilmoittautuminen ja numerolappu", closes: (d) => `Ilmoittautuminen sulkeutuu ${d}.`, price: (d, p) => p ? `${p} ${d} asti.` : `Hinta nousee ${d} jälkeen.`, pickupH: "Numerolappujen jako",
    between: (a, b) => `klo ${a}–${b}`, from: (a) => `klo ${a} alkaen`, source: "Lähde", checked: (d) => `haettu ${d}` },
  fr: { h: "Inscription et dossard", closes: (d) => `Clôture des inscriptions le ${d}.`, price: (d, p) => p ? `${p} jusqu’au ${d} inclus.` : `Hausse du tarif après le ${d}.`, pickupH: "Retrait des dossards",
    between: (a, b) => `de ${frClock(a)} à ${frClock(b)}`, from: (a) => `à partir de ${frClock(a)}`, source: "Source", checked: (d) => `consulté le ${d}` },
  es: { h: "Inscripción y dorsal", closes: (d) => `La inscripción cierra el ${d}.`, price: (d, p) => p ? `${p} hasta el ${d} incluido.` : `El precio sube después del ${d}.`, pickupH: "Recogida de dorsales",
    between: (a, b) => `de ${a} a ${b} h`, from: (a) => `desde las ${a} h`, source: "Fuente", checked: (d) => `consultado el ${d}` },
};
/** deadline: the organiser's dates for the coming edition as their own section, only the ones still ahead (registration and prices from
 *  today, pickup days from today to the race); with the source page. Null when nothing is ahead or the race has no coming date. */
export function entrySection(r: Pick<Race, "entry" | "next_date">, lang: Lang, today: string): string | null {
  const e = r.entry, w = ENTRY_WORDS[lang];
  if (!e || !r.next_date || r.next_date < today) return null;
  const items: string[] = [];
  if (e.entry_closes && e.entry_closes >= today) items.push(`<li>${esc(w.closes(dateShort(e.entry_closes, lang)))}</li>`);
  for (const s of (e.price_steps ?? []).filter((x) => x.last_day >= today)) items.push(`<li>${esc(w.price(dateShort(s.last_day, lang), s.price))}</li>`);
  const pk = (e.pickup ?? []).filter((p) => p.day >= today && p.day <= r.next_date!);
  const pick = pk.length ? `<h3>${esc(w.pickupH)}</h3><ul>${pk.map((p) => `<li>${esc(cap(dateLong(p.day, lang)))}${p.from ? `, ${esc(p.to ? w.between(p.from, p.to) : w.from(p.from))}` : ""}</li>`).join("")}</ul>${e.pickup_where ? `<p>${esc(e.pickup_where)}</p>` : ""}` : "";
  if (!items.length && !pick) return null;
  const src = e.source ? `<p class="note">${esc(w.source)}${cl(lang)}<a href="${esc(e.source)}" rel="noopener nofollow">${esc(hostOf(e.source))}</a>${e.checked ? `, ${esc(w.checked(dateShort(e.checked, lang)))}` : ""}</p>` : "";
  return `<section aria-labelledby="h-entry"><h2 id="h-entry">${esc(w.h)}</h2>${items.length ? `<ul>${items.join("")}</ul>` : ""}${pick}${src}</section>`;
}
export const dateLong = (day: string, lang: Lang) => first(dayDate(day).toLocaleDateString(LOCALE[lang], { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }), lang);
export const dateShort = (day: string, lang: Lang) => first(dayDate(day).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }), lang);
/** French writes the first of a month as "1er mai". */
const first = (d: string, lang: Lang) => (lang === "fr" ? d.replace(/(^|\s)1 (?=\p{L})/u, (_, sp) => `${sp}1er `) : d);
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
    return `<g><title>${esc(`${t.aidOne}, ${t.at(num(s.km, lang, 1))}${cl(lang)}${what}`)}</title><line class="aml" x1="${x}" x2="${x}" y1="${y}" y2="${base}"/><circle class="am" cx="${x}" cy="${y}" r="5"/></g>`;
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
/** The share image's number style by the race's country (one image serves every language). */
const OG_LANG: Record<string, Lang> = { NO: "nb", DK: "da", FI: "fi", FR: "fr", ES: "es" };
/** The share image (1200×630) as SVG for resvg: the name, distance and climbing, the course's shape and its profile. One image per race
 *  for all three languages, so the only text on it is the name, the numbers and the place. */
export function ogSvg(r: Race): string {
  const lang: Lang = r.country_code && ["GB", "IE", "US", "CA", "AU", "NZ"].includes(r.country_code) ? "en" : (r.country_code && OG_LANG[r.country_code]) || "sv";
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
    art += `<path d="${line}L1136 596L64 596Z" fill="#5C91FF" fill-opacity="0.25"/><path d="${line}" fill="none" stroke="#5C91FF" stroke-width="4" stroke-linejoin="round"/>`;
    const lat0 = (pts[0][0] * Math.PI) / 180, xs = pts.map((p) => p[1] * Math.cos(lat0)), ys = pts.map((p) => -p[0]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), dx = Math.max(Math.max(...xs) - x0, 1e-4), dy = Math.max(Math.max(...ys) - y0, 1e-4), s = Math.min(290 / dx, 260 / dy);
    const ox = 846 + (290 - dx * s) / 2, oy = 56 + (260 - dy * s) / 2;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${f1(ox + (xs[i] - x0) * s)} ${f1(oy + (ys[i] - y0) * s)}`).join("");
    art += `<path d="${d}" fill="none" stroke="#E8ECF3" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${f1(ox + (xs[0] - x0) * s)}" cy="${f1(oy + (ys[0] - y0) * s)}" r="9" fill="#3CCB7F"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${ogScene(r)}`
    + `<text x="64" y="92" font-size="30" font-weight="700" letter-spacing="5" fill="#5C91FF">MILA</text>${text}`
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
    + `<text x="64" y="110" font-size="34" font-weight="700" letter-spacing="6" fill="#5C91FF">MILA</text>${text}<text x="64" y="${y + 10}" font-size="36" fill="#AEB7C6">${esc(t.brandLine)}</text>`
    + `<path d="${wave}L1136 600L64 600Z" fill="#5C91FF" fill-opacity="0.25"/><path d="${wave}" fill="none" stroke="#5C91FF" stroke-width="4"/><text x="1136" y="620" font-size="19" fill="#7F8A9C" text-anchor="end">milacoach.app</text></svg>`;
}

/** resvg (WebAssembly, no native code) with DejaVu Sans, all fetched from pinned CDN addresses and checked against their SHA-256
 *  (fetchPinned); null when they cannot be had or do not match (the pages then use the images already there, or the default ones). */
export async function resvgRenderer(fetchFn: typeof fetch = fetch): Promise<PngRenderer | null> {
  try {
    // every file first, checked, before anything is loaded or run
    const [wasm, ...fonts] = await Promise.all([fetchPinned(RESVG_WASM, fetchFn), ...FONT_FILES.map((f) => fetchPinned(f, fetchFn))]);
    const spec = ["npm:@resvg", "resvg-wasm@2.6.2"].join("/");   // built at run time, so tests and type checks never load it
    const m: any = await import(spec);
    await m.initWasm(wasm);
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
  if (courseless(r)) return aboutNoCourse(r, lang);
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
  } else if (lang !== "de") {
    const p = PROSE[lang]!;
    out.push(`${p.intro(title, r.trail ? t.trailRace : t.roadRace, where, k)}${p.climb(num(r.ascent, lang), r.descent !== null ? num(r.descent, lang) : null, t.perKm(perKm), h, hasEle ? num(r.max_ele!, lang) : null, hasEle ? num(r.min_ele!, lang) : null)}`);
    out.push(big ? p.big(num(big.km, lang, 1), num(big.gain, lang), lenText(big.len, lang), num(big.grade, lang, 1), num(big.top, lang), climbs.length, num(lastC.km, lang, 1)) : t.noClimbs);
  } else {
    out.push(`${title} ist ein ${r.trail ? t.trailRace : t.roadRace}${where ? ` in ${where}${where.includes(",") ? "," : ""}` : ""} über ${k}. Die Strecke hat insgesamt ${num(r.ascent, lang)} Höhenmeter bergauf${r.descent !== null ? ` und ${num(r.descent, lang)} bergab` : ""}, ${t.perKm(perKm)}, und ist damit ${h}.${hasEle ? ` Der höchste Punkt liegt auf ${num(r.max_ele!, lang)} m ü. M., der tiefste auf ${num(r.min_ele!, lang)} m.` : ""}`);
    out.push(big ? `Der größte Anstieg beginnt bei km ${num(big.km, lang, 1)}: ${num(big.gain, lang)} Höhenmeter auf ${lenText(big.len, lang)} mit durchschnittlich ${num(big.grade, lang, 1)} % Steigung, bis auf ${num(big.top, lang)} m.${climbs.length > 1 ? ` Insgesamt hat die Strecke ${climbs.length} Anstiege ab 25 Höhenmetern; der letzte beginnt bei km ${num(lastC.km, lang, 1)}.` : ""}` : t.noClimbs);
  }
  out.push(...aidText(r, lang));
  return out;
}
/** A race without a course in a few sentences: the kind, the place and the distance, the organiser's stated climb when there is one,
 *  the aid stations and cut-offs; never a word about a profile nobody has. */
export function aboutNoCourse(r: Race, lang: Lang): string[] {
  const t = T[lang], k = kmText(r.km, lang), where = whereText(r, lang), title = r.name, a = num(r.ascent, lang), out: string[] = [];
  if (lang === "sv") out.push(`${title} är ett ${r.trail ? t.trailRace : t.roadRace}${where ? ` i ${where}` : ""} på ${k}.${r.ascent ? ` Arrangören anger ${a} höjdmeter.` : ""}`);
  else if (lang === "en") out.push(`${title} is a ${r.trail ? t.trailRace : t.roadRace}${where ? ` in ${where}${where.includes(",") ? "," : ""}` : ""} over ${k}.${r.ascent ? ` The organizer states ${a} m of climbing.` : ""}`);
  else if (lang === "de") out.push(`${title} ist ein ${r.trail ? t.trailRace : t.roadRace}${where ? ` in ${where}${where.includes(",") ? "," : ""}` : ""} über ${k}.${r.ascent ? ` Der Veranstalter gibt ${a} Höhenmeter an.` : ""}`);
  else { const p = PROSE[lang]!; out.push(`${p.intro(title, r.trail ? t.trailRace : t.roadRace, where, k)}${r.ascent ? p.orgClimb(a) : ""}`); }
  out.push(...aidText(r, lang));
  return out;
}
/** The summary's sentences in the languages added in sprak5 (the Swedish, English and German ones are written out above): the race, the
 *  climbing, the biggest climb, the organiser's aid stations and cut-offs, and the app's line. */
const PROSE: Partial<Record<Lang, {
  intro: (title: string, kind: string, where: string, k: string) => string;
  climb: (up: string, down: string | null, perKm: string, h: string, hi: string | null, lo: string | null) => string;
  big: (km: string, gain: string, len: string, grade: string, top: string, count: number, lastKm: string) => string;
  orgClimb: (a: string) => string; aid: (n: number, a0: string, a1: string) => string; cuts: (n: number) => string; app: string; appNoCourse: string;
}>> = {
  nb: {
    intro: (title, kind, where, k) => `${title} er et ${kind} på ${k}${where ? ` i ${where}` : ""}.`,
    climb: (up, down, perKm, h, hi, lo) => ` Løypa har ${up} høydemeter oppover${down ? ` og ${down} nedover` : ""}, ${perKm}, og regnes dermed som ${h}.${hi ? ` Høyeste punkt ligger ${hi} moh. og laveste ${lo} moh.` : ""}`,
    big: (km, gain, len, grade, top, count, lastKm) => `Den største stigningen starter ved km ${km}: ${gain} høydemeter på ${len} med ${grade} % i snitt, opp til ${top} moh.${count > 1 ? ` Totalt har løypa ${count} stigninger på minst 25 høydemeter; den siste starter ved km ${lastKm}.` : ""}`,
    orgClimb: (a) => ` Arrangøren oppgir ${a} høydemeter.`,
    aid: (n, a0, a1) => n === 1 ? `Arrangøren har én drikkestasjon langs løypa, ved km ${a0}.` : `Arrangøren har ${n} drikkestasjoner langs løypa, den første ved km ${a0} og den siste ved km ${a1}.`,
    cuts: (n) => ` Det er ${n === 1 ? "én makstid" : `${n} makstider`} langs løypa.`,
    app: "I Mila-appen beskriver coachen løypa i detalj på ditt språk og planlegger tempo og energi for den.",
    appNoCourse: "I Mila-appen planlegger coachen tempo og energi for dette løpet.",
  },
  da: {
    intro: (title, kind, where, k) => `${title} er et ${kind} på ${k}${where ? ` i ${where}` : ""}.`,
    climb: (up, down, perKm, h, hi, lo) => ` Ruten har ${up} højdemeter stigning${down ? ` og ${down} højdemeter fald` : ""}, ${perKm}, og regnes dermed som ${h}.${hi ? ` Det højeste punkt ligger ${hi} m o.h. og det laveste ${lo} m o.h.` : ""}`,
    big: (km, gain, len, grade, top, count, lastKm) => `Den største stigning begynder ved km ${km}: ${gain} højdemeter på ${len} med ${grade} % i snit, op til ${top} m o.h.${count > 1 ? ` I alt har ruten ${count} stigninger på mindst 25 højdemeter; den sidste begynder ved km ${lastKm}.` : ""}`,
    orgClimb: (a) => ` Arrangøren oplyser ${a} højdemeter.`,
    aid: (n, a0, a1) => n === 1 ? `Arrangøren har ét væskedepot langs ruten, ved km ${a0}.` : `Arrangøren har ${n} væskedepoter langs ruten, det første ved km ${a0} og det sidste ved km ${a1}.`,
    cuts: (n) => ` Der er ${n === 1 ? "én maksimaltid" : `${n} maksimaltider`} langs ruten.`,
    app: "I Mila-appen beskriver coachen ruten i detaljer på dit sprog og planlægger dit tempo og din energi til den.",
    appNoCourse: "I Mila-appen planlægger coachen dit tempo og din energi til dette løb.",
  },
  fi: {
    intro: (title, kind, where, k) => `${title} on ${k}:n ${kind}${where ? ` (${where})` : ""}.`,
    climb: (up, down, perKm, h, hi, lo) => ` Reitillä on nousua ${up} m${down ? ` ja laskua ${down} m` : ""}, ${perKm}, joten reitti on ${h}.${hi ? ` Korkein kohta on ${hi} m ja matalin ${lo} m merenpinnan yläpuolella.` : ""}`,
    big: (km, gain, len, grade, top, count, lastKm) => `Suurin nousu alkaa kohdassa km ${km}: ${gain} nousumetriä ${len}:n matkalla, keskimäärin ${grade} %, ja huippu on ${top} m mpy.${count > 1 ? ` Reitillä on yhteensä ${count} vähintään 25 nousumetrin nousua; viimeinen alkaa kohdassa km ${lastKm}.` : ""}`,
    orgClimb: (a) => ` Järjestäjän mukaan nousua on ${a} m.`,
    aid: (n, a0, a1) => n === 1 ? `Järjestäjällä on reitin varrella yksi juomapiste, kohdassa km ${a0}.` : `Järjestäjällä on reitin varrella ${n} juomapistettä, ensimmäinen kohdassa km ${a0} ja viimeinen kohdassa km ${a1}.`,
    cuts: (n) => ` Reitillä on ${n === 1 ? "yksi maksimiaika" : `${n} maksimiaikaa`}.`,
    app: "Mila-sovelluksessa valmentaja kuvailee reitin tarkasti omalla kielelläsi ja suunnittelee vauhtisi ja energiasi sille.",
    appNoCourse: "Mila-sovelluksessa valmentaja suunnittelee vauhtisi ja energiasi tähän kisaan.",
  },
  fr: {
    intro: (title, kind, where, k) => `${title} est ${kind} de ${k}${where ? ` (${where})` : ""}.`,
    climb: (up, down, perKm, h, hi, lo) => ` Le parcours compte ${up} m de dénivelé positif${down ? ` et ${down} m de dénivelé négatif` : ""}, soit ${perKm}\u00a0: il est donc ${h}.${hi ? ` Le point culminant est à ${hi} m d’altitude et le point le plus bas à ${lo} m.` : ""}`,
    big: (km, gain, len, grade, top, count, lastKm) => `La plus grande montée commence au km ${km}\u00a0: ${gain} m de dénivelé sur ${len}, à ${grade} % de moyenne, jusqu’à ${top} m d’altitude.${count > 1 ? ` Au total, le parcours compte ${count} montées d’au moins 25 m\u00a0; la dernière commence au km ${lastKm}.` : ""}`,
    orgClimb: (a) => ` L’organisateur annonce ${a} m de dénivelé positif.`,
    aid: (n, a0, a1) => n === 1 ? `L’organisateur prévoit un ravitaillement, au km ${a0}.` : `L’organisateur prévoit ${n} ravitaillements, le premier au km ${a0} et le dernier au km ${a1}.`,
    cuts: (n) => ` Le parcours compte ${n === 1 ? "une barrière horaire" : `${n} barrières horaires`}.`,
    app: "Dans l’app Mila, le coach décrit le parcours en détail dans ta langue et planifie ton allure et ton ravitaillement.",
    appNoCourse: "Dans l’app Mila, le coach planifie ton allure et ton ravitaillement pour cette course.",
  },
  es: {
    intro: (title, kind, where, k) => `${title} es ${kind} de ${k}${where ? ` (${where})` : ""}.`,
    climb: (up, down, perKm, h, hi, lo) => ` El recorrido acumula ${up} m de desnivel positivo${down ? ` y ${down} m de desnivel negativo` : ""}, ${perKm}, así que es ${h}.${hi ? ` El punto más alto está a ${hi} m sobre el nivel del mar y el más bajo a ${lo} m.` : ""}`,
    big: (km, gain, len, grade, top, count, lastKm) => `La subida más grande empieza en el km ${km}: ${gain} m de desnivel en ${len}, con un ${grade} % de media, hasta los ${top} m.${count > 1 ? ` En total, el recorrido tiene ${count} subidas de al menos 25 m; la última empieza en el km ${lastKm}.` : ""}`,
    orgClimb: (a) => ` El organizador indica ${a} m de desnivel positivo.`,
    aid: (n, a0, a1) => n === 1 ? `El organizador prevé un avituallamiento, en el km ${a0}.` : `El organizador prevé ${n} avituallamientos, el primero en el km ${a0} y el último en el km ${a1}.`,
    cuts: (n) => ` Hay ${n === 1 ? "un tiempo de corte" : `${n} tiempos de corte`} a lo largo del recorrido.`,
    app: "En la app Mila, el coach describe el recorrido en detalle en tu idioma y planifica tu ritmo y tu avituallamiento.",
    appNoCourse: "En la app Mila, el coach planifica tu ritmo y tu avituallamiento para esta carrera.",
  },
};
/** The organiser's aid stations and cut-offs in a sentence, and the app's line on every page but the Swedish one. */
function aidText(r: Race, lang: Lang): string[] {
  const out: string[] = [];
  const aid = r.aid_stations ?? [], cuts = r.info?.cutoffs ?? [];
  const a0 = aid.length ? num(aid[0].km, lang, 1) : "", a1 = aid.length ? num(aid[aid.length - 1].km, lang, 1) : "";
  const p3 = lang === "sv"
    ? `${aid.length ? `Arrangören har ${aid.length === 1 ? `en vätskekontroll längs banan, vid km ${a0}` : `${aid.length} vätskekontroller längs banan, den första vid km ${a0} och den sista vid km ${a1}`}.` : ""}${cuts.length ? ` Det finns ${cuts.length === 1 ? "en maxtid" : `${cuts.length} maxtider`} längs banan.` : ""}`
    : PROSE[lang]
    ? `${aid.length ? PROSE[lang]!.aid(aid.length, a0, a1) : ""}${cuts.length ? PROSE[lang]!.cuts(cuts.length) : ""}`
    : lang === "en"
    ? `${aid.length ? `The organizer lists ${aid.length === 1 ? `one aid station, at km ${a0}` : `${aid.length} aid stations, the first at km ${a0} and the last at km ${a1}`}.` : ""}${cuts.length ? ` There ${cuts.length === 1 ? "is one cut-off time" : `are ${cuts.length} cut-off times`} along the course.` : ""}`
    : `${aid.length ? `Der Veranstalter nennt ${aid.length === 1 ? `eine Verpflegungsstelle bei km ${a0}` : `${aid.length} Verpflegungsstellen, die erste bei km ${a0} und die letzte bei km ${a1}`}.` : ""}${cuts.length ? ` Entlang der Strecke gibt es ${cuts.length === 1 ? "ein Zeitlimit" : `${cuts.length} Zeitlimits`}.` : ""}`;
  if (p3.trim()) out.push(p3.trim());
  if (courseless(r)) {
    if (lang === "en") out.push("In the Mila app, the coach plans your pacing and fueling for this race.");
    if (lang === "de") out.push("In der Mila-App plant der Coach dein Pacing und deine Verpflegung für diesen Lauf.");
    if (PROSE[lang]) out.push(PROSE[lang]!.appNoCourse);
    return out;
  }
  if (lang === "en") out.push("In the Mila app, the coach describes the course in detail in your language and plans your pacing and fueling for it.");
  if (lang === "de") out.push("In der Mila-App beschreibt der Coach die Strecke ausführlich in deiner Sprache und plant dein Pacing und deine Verpflegung dafür.");
  if (PROSE[lang]) out.push(PROSE[lang]!.app);
  return out;
}

function metaDescription(r: Race, lang: Lang): string {
  const t = T[lang], where = r.place ?? countryName(r, lang);
  const facts = [r.ascent ? t.metaClimb(num(r.ascent, lang)) : "", r.max_ele !== null ? t.metaHigh(num(r.max_ele, lang)) : "", r.aid_stations?.length ? t.metaAid(r.aid_stations.length) : ""].filter(Boolean).join(", ");
  const head = [raceTitle(r, lang), where, r.next_date ? dateShort(r.next_date, lang) : ""].filter(Boolean).join(", ");
  const s = `${head}${facts ? `: ${facts}` : ""}.`, tail = courseless(r) ? t.metaTailNoCourse : t.metaTail;
  if (s.length + tail.length < 160) return `${s} ${tail}`;
  return s.length <= 160 ? s : s.slice(0, 157).replace(/\s+\S*$/, "") + " …";
}
/** "Härnö Trail 21 km 2027 – bana, höjdprofil och tempoplan | Mila" */
export function pageTitle(r: Race, lang: Lang, withPlace = false): string {
  const y = r.next_date?.slice(0, 4), name = raceTitle(r, lang), place = withPlace && r.place && !name.includes(r.place) ? `, ${r.place}` : "";
  return `${name}${place}${y && !name.includes(y) ? ` ${y}` : ""} – ${courseless(r) ? T[lang].titleTailNoCourse : T[lang].titleTail} | Mila`;
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
.hubs{display:flex;flex-wrap:wrap;gap:8px 18px;list-style:none;margin:0 0 8px;padding:0}.faq h3{margin-top:18px}.faq p{color:var(--ink2);max-width:42em;margin:4px 0}
.pager{display:flex;gap:10px;flex-wrap:wrap;padding:30px 0}.pager a,.pager span{border:1px solid var(--line);border-radius:10px;padding:8px 14px;text-decoration:none}.pager [aria-current]{background:var(--surface);color:var(--ink)}
@media (max-width:820px){.two{grid-template-columns:1fr}.race-hero.scened{padding:22px 18px 26px;border-radius:18px}.race-hero.scened::after{background:rgba(13,17,25,.86)}}`;
/** Used when the output holds no site.css: the site's dark palette and frame. */
const FALLBACK_CSS = `:root{color-scheme:dark;--bg:#0D1119;--surface:#151B26;--ink:#E8ECF3;--ink2:#AEB7C6;--muted:#7F8A9C;--line:#263041;--accent:#5C91FF;--good:#3CCB7F;--bad:#F2706B}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;line-height:1.6}a{color:var(--accent)}.wrap{max-width:1040px;margin:0 auto;padding:0 20px}header{display:flex;align-items:center;justify-content:space-between;padding:22px 0}.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:22px;color:var(--ink);text-decoration:none}.brand img{width:40px;height:40px;border-radius:10px}.lang{display:flex;gap:8px}.lang a{color:var(--ink2);text-decoration:none;font-size:15px;border:1px solid var(--line);padding:6px 12px;border-radius:999px}h1{font-size:clamp(34px,5.4vw,60px);line-height:1.06;margin:12px 0 18px}h2{font-size:26px;margin:0 0 10px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:13px;color:var(--accent);font-weight:700}.lead{font-size:19px;color:var(--ink2)}.cta{display:inline-block;background:var(--accent);color:#0D1119;padding:14px 22px;border-radius:12px;font-weight:700;text-decoration:none}.ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}.cta.alt{background:transparent;color:var(--ink);border:1px solid var(--line)}.note{font-size:14px;color:var(--muted)}section{padding:56px 0;border-top:1px solid var(--line)}.sub{color:var(--ink2)}select{width:100%;font:inherit;color:var(--ink);background:var(--surface);padding:11px;border:1px solid var(--line);border-radius:10px}footer{padding:34px 0 50px;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}footer a{color:var(--ink2);margin-right:16px}`;
const minCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "").replace(/\s{2,}/g, " ").trim();

type Frame = {
  lang: Lang; path: string; title: string; description: string; css: string; body: string; today: string;
  alternates?: Partial<Record<Lang, string>> | null; noindex?: boolean; og?: { image: string; alt: string; large: boolean }; ld?: object[]; script?: string; module?: string;
  crumbs: { name: string; path?: string }[];
  /** The app's App Store id: Apple's Smart App Banner on the page (seo; off while it is not set). */
  appId?: string | null;
};
function frame(f: Frame): string {
  const t = T[f.lang], c = L[f.lang], root = rel(f.path, "");
  // the languages the page has (a guide may lack one); x-default the English page, else the first there is
  const langs = f.alternates ? LANGS.filter((l) => f.alternates![l]) : [], xDefault = f.alternates ? f.alternates.en ?? f.alternates[langs[0]] : undefined;
  const alt = f.alternates && langs.length > 1 ? langs.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(abs(f.alternates![l]!))}">`).join("") + `<link rel="alternate" hreflang="x-default" href="${esc(abs(xDefault!))}">` : "";
  const og = f.og ? `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(BRAND[f.lang])}"><meta property="og:title" content="${esc(f.title)}"><meta property="og:description" content="${esc(f.description)}"><meta property="og:url" content="${esc(abs(f.path))}"><meta property="og:image" content="${esc(f.og.image)}">${f.og.large ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ""}<meta property="og:image:alt" content="${esc(f.og.alt)}"><meta property="og:locale" content="${OG_LOCALE[f.lang]}">${langs.filter((l) => l !== f.lang).map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}">`).join("")}
<meta name="twitter:card" content="${f.og.large ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${esc(f.title)}"><meta name="twitter:description" content="${esc(f.description)}"><meta name="twitter:image" content="${esc(f.og.image)}"><meta name="twitter:image:alt" content="${esc(f.og.alt)}">` : "";
  const switcher = f.alternates ? langs.filter((l) => l !== f.lang).map((l) => `<a href="${esc(rel(f.path, f.alternates![l]!))}" hreflang="${l}" lang="${l}">${T[l].langName}</a>`).join("") : "";
  const crumbs = `<nav class="crumbs" aria-label="${esc(t.crumbs)}"><ol>${f.crumbs.map((x, i) => i === f.crumbs.length - 1 ? `<li aria-current="page">${esc(x.name)}</li>` : `<li><a href="${esc(rel(f.path, x.path ?? ""))}">${esc(x.name)}</a></li>`).join("")}</ol></nav>`;
  // the page's own policy: scripts from the site, and this page's inline ones by their hash (site_csp.ts)
  const security = securityMeta([f.script, f.module].filter((x): x is string => !!x));
  return `<!doctype html><html lang="${f.lang}"><head><meta charset="utf-8">${security}<meta name="viewport" content="width=device-width,initial-scale=1">${smartBannerMeta(f.appId)}
<title>${esc(f.title)}</title><meta name="description" content="${esc(f.description)}">${f.noindex ? '<meta name="robots" content="noindex,follow">' : `<meta name="robots" content="max-image-preview:large"><link rel="canonical" href="${esc(abs(f.path))}">`}${alt}
${og}<meta name="theme-color" content="#0D1119"><link rel="icon" href="${root}logo.png"><style>${f.css}</style>${(f.ld ?? []).map(jsonLd).join("")}</head><body>
<a class="skip" href="#main">${esc(t.skip)}</a><div class="wrap"><header><a class="brand" href="${root}${c.home}"><img src="${root}logo.png" alt="" width="40" height="40">MILA</a>${switcher ? `<nav class="lang" aria-label="${esc(t.langNav)}">${switcher}</nav>` : ""}</header>
${crumbs}
<main id="main">${f.body}</main>
<footer><a href="${root}${c.support}">${esc(t.support)}</a><a href="${root}${c.privacy}">${esc(t.privacy)}</a><a href="${root}${c.terms}">${esc(t.terms)}</a><a href="${root}${c.support}#provider">${esc(t.contact)}</a><a href="${root}${c.support}?topic=report&amp;ref=${encodeURIComponent(abs(f.path))}#kontakt" rel="nofollow">${esc(t.report)}</a><br><br>${esc(t.notAffiliatedAll)}<br><br>© ${f.today.slice(0, 4)} Mila</footer></div>${f.script ? `<script>${f.script}</script>` : ""}${f.module ? `<script type="module">${f.module}</script>` : ""}</body></html>
`;
}
/** Apple's App Store badge linking to the app: Apple's own localized artwork (the site's badges/, from Apple's marketing tools), never a
 *  button of our own that reads like it; its alt text is the badge's words (t.store). 50 px high, as on the product page. */
const storeBadge = (path: string, lang: Lang, url: string) => {
  const b = BADGE_LANGS.includes(lang) ? lang : "en";
  return `<a class="store" href="${esc(url)}"><img src="${esc(rel(path, `badges/app-store-${b}.svg`))}" alt="${esc(T[b].store)}" width="150" height="50"></a>`;
};
/** The languages whose badge artwork from Apple is in the site's badges/ (app-store-<lang>.svg); the others show the English badge, with
 *  its own words as the alt text, until Apple's localized artwork for them is added there (then add the language here). */
const BADGE_LANGS: Lang[] = ["sv", "en", "de"];
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
  sceneJs?: boolean;
  /** seo: the App Store id for the Smart App Banner (none until launch), the hubs, and the races whose title another race shares (their
   *  titles say the place too, so every title on the site is its own). */
  appId?: string | null; hubs?: Hub[]; titleClash?: Set<string> };

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
  const orgLink = r.url ? `<a href="${esc(r.url)}" rel="noopener nofollow">${esc(r.organizer ? t.organiserPage : cap(t.organiserPage))}</a>` : "";
  const org = r.organizer ? `<p class="meta">${esc(t.organizer)}${cl(lang)}${esc(r.organizer)}${orgLink ? ` · ${orgLink}` : ""}</p>` : orgLink ? `<p class="meta">${orgLink}</p>` : "";
  const start = mainStart(r);
  // a race without a course: the climb only as the organiser states it, and no character a profile would give
  const bare = courseless(r), climbKnown = !bare || r.ascent > 0;
  const facts: [string, string][] = [[t.distance, kmText(r.km, lang)], ...(climbKnown ? [[t.climbing, `↑ ${num(r.ascent, lang)} m`] as [string, string]] : [])];
  if (r.max_ele !== null) facts.push([t.highest, `${num(r.max_ele, lang)} ${t.masl}`]);
  facts.push([t.terrain, r.trail ? t.trail : t.road], ...(climbKnown ? [[t.character, cap(t.hilly[hilliness(r)])] as [string, string]] : []));
  if (start && r.next_date && r.next_date >= today) facts.push([t.start, t.clock(start)]);
  if (r.aid_stations?.length) facts.push([t.aid, String(r.aid_stations.length)]);
  // the scene's spec for the browser (scene.ts): the profile to three decimals is plenty for a horizon
  const spec = raceSceneSpec(r, { startIso: startDate(r), today });
  const scene = ctx.sceneJs ? ` data-scene="${esc(JSON.stringify({ ...spec, profile: spec.profile.map((v) => Math.round(v * 1000) / 1000), relief: Math.round(spec.relief) }))}"` : "";
  // the name in the headings is without its sponsors; the official name stays here when it differs
  const official = displayName(r.name) !== r.name ? `<p class="meta">${esc(t.officialName)}${cl(lang)}${esc(r.name)}</p>` : "";
  const hero = `<div class="race-hero"${scene}><div class="eyebrow">${esc([t.races, country].filter(Boolean).join(" · "))}</div><h1>${esc(title)}</h1><p class="meta">${when}</p>${official}${org}
<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>`;
  const button = `<div class="ctas">${storeBadge(path, lang, ctx.appStore)}</div><p class="brandline">${esc(t.brandLine)}</p>`;
  const cta = `<div class="ctabox"><h2>${esc(t.ctaH)}</h2><p class="sub">${esc(t.ctaText)}</p>${button}</div>`;
  const sections: string[] = [];
  const about = (lang === "sv" && r.comment ? r.comment.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("") + `<p class="note">${esc(t.coachNote)}</p>` : aboutText(r, lang).map((p) => `<p>${esc(p)}</p>`).join(""));
  if (c) {
    const [eMin, eMax] = eleRange(c.pts);
    sections.push(`<section aria-labelledby="h-profile"><h2 id="h-profile">${esc(t.profileH)}</h2><figure><div class="chart">${profileSvg(r, lang)}</div><figcaption>${esc(t.profileDesc(kmText(r.km, lang), num(r.min_ele ?? eMin, lang), num(r.max_ele ?? eMax, lang), (r.aid_stations ?? []).length))}${r.ele_source === "dem" ? ` ${esc(t.dem)} ${esc(t.elevAttribution)}` : r.ele_source === "runners" ? ` ${esc(t.runners(r.ele_runners ?? 1))}` : ""}</figcaption></figure></section>`);
    // where the organiser offered the course (decision 3), else the organiser's page as before
    const credit = r.course_source === "official_gpx"
      ? r.course_host ? `${esc(t.published)} <a href="${esc(r.course_page ?? r.url ?? `https://${r.course_host}`)}" rel="noopener nofollow">${esc(r.course_host)}</a>.`
        : `${esc(t.official)}${r.url ? ` (<a href="${esc(r.url)}" rel="noopener nofollow">${esc(t.organiserPage)}</a>)` : ""}.`
      : esc(t.upload);
    sections.push(`<section aria-labelledby="h-route"><div class="two"><div><h2 id="h-route">${esc(t.routeH)}</h2><figure><div class="chart">${routeSvg(r, lang)}</div><figcaption>${esc(t.legend(isLoop(c.pts), !!r.aid_stations?.length))} ${credit}</figcaption></figure></div>
<div class="prose"><h2>${esc(t.aboutH)}</h2>${about}</div></div></section>`);
  } else if (bare) {
    sections.push(`<section aria-labelledby="h-route"><div class="two"><div><h2 id="h-route">${esc(t.routeH)}</h2><p class="sub">${esc(t.noCourse)}</p>${orgLink ? `<p>${orgLink}</p>` : ""}</div>
<div class="prose"><h2>${esc(t.aboutRaceH)}</h2>${about}</div></div></section>`);
  } else sections.push(`<section aria-labelledby="h-about"><div class="prose"><h2 id="h-about">${esc(t.aboutH)}</h2>${about}</div></section>`);
  if (r.climbs.length) {
    const rows = [...r.climbs].sort((a, b) => a.km - b.km).slice(0, 30).map((x) => [esc(t.at(num(x.km, lang, 1))), esc(lenText(x.len, lang)), esc(`${num(x.gain, lang)} m`), esc(`${num(x.grade, lang, 1)} %`), esc(num(x.top, lang))]);
    sections.push(`<section aria-labelledby="h-climbs"><h2 id="h-climbs">${esc(t.climbsH)}</h2>${table(t.climbsCaption, t.climbCols, rows, [1, 2, 3, 4])}</section>`);
  }
  const prac: string[] = [];
  if (r.aid_stations?.length) prac.push(`<h3>${esc(t.aidH)}</h3>${table(t.aidCaption, t.aidCols, r.aid_stations.map((s) => [esc(t.at(num(s.km, lang, 1))), esc(s.what.length ? s.what.map((w) => t.aidWords[w] ?? w).join(", ") : t.aidNone)]), [])}`);
  if (info?.starts?.length && r.next_date && r.next_date >= today) prac.push(`<h3>${esc(t.startsH)}</h3><ul>${info.starts.map((s) => `<li>${s.label ? `${esc(s.label)}${cl(lang)}` : ""}${esc(t.clock(s.time))}</li>`).join("")}</ul>`);
  if (info?.start_place) {
    const p = info.start_place, map = p.lat !== undefined && p.lon !== undefined ? ` · <a href="https://www.openstreetmap.org/?mlat=${p.lat}&amp;mlon=${p.lon}#map=15/${p.lat}/${p.lon}" rel="noopener nofollow">${esc(t.showMap)}</a>` : "";
    prac.push(`<h3>${esc(t.placeH)}</h3><p>${esc(p.name)}${map}</p>`);
  }
  if (info?.cutoffs?.length) prac.push(`<h3>${esc(t.cutoffsH)}</h3>${table(t.cutoffCaption, t.cutoffCols, info.cutoffs.map((x) => [esc(t.at(num(x.km, lang, 1))), esc(x.clock ? t.clock(x.clock) : t.elapsed(Math.floor(x.elapsed_min! / 60), x.elapsed_min! % 60))]), [])}`);
  if (info?.kit?.length) prac.push(`<h3>${esc(t.kitH)}</h3><ul>${info.kit.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>`);
  // deadline: the organiser's dates for the coming edition, while they are ahead (entrySection)
  const entryHtml = entrySection(r, lang, today);
  if (entryHtml) sections.push(entryHtml);
  if (prac.length) {
    const src = info?.source ? `<p class="note">${esc(t.source)}${cl(lang)}<a href="${esc(info.source)}" rel="noopener nofollow">${esc(hostOf(info.source))}</a>${info.checked ? `, ${esc(t.checked(dateShort(info.checked, lang)))}` : ""}</p>` : "";
    sections.push(`<section aria-labelledby="h-practical"><h2 id="h-practical">${esc(t.practicalH)}</h2>${prac.join("")}${src}</section>`);
  }
  if (r.results.length) {
    const ps = r.results.slice(0, 3).map((e) => `<p>${esc(t.result(e.year, num(e.finishers, lang), clockTime(e.overall.p50), clockTime(e.overall.p25), clockTime(e.overall.p75), clockTime(e.overall.p10), clockTime(e.overall.p90)))}${e.source ? ` <a href="${esc(e.source)}" rel="nofollow noopener">${esc(t.resultSource)}</a>` : ""}</p>`).join("");
    sections.push(`<section aria-labelledby="h-results"><div class="prose"><h2 id="h-results">${esc(t.resultsH)}</h2>${ps}<p class="note">${esc(t.resultsNote)}</p></div></section>`);
  }
  // seo: the pace table and the questions, then the hubs the race is in
  const pace = paceSection(r, lang);
  if (pace) sections.push(pace);
  const faq = faqSection(r, lang, today);
  sections.push(faq.html);
  const mine = (ctx.hubs ?? []).filter((h) => h.races.some((x) => x.id === r.id));
  if (mine.length) sections.push(`<section aria-labelledby="h-hubs"><h2 id="h-hubs">${esc(S[lang].seeAlso)}</h2><ul class="hubs">${mine.map((h) => `<li><a href="${esc(rel(path, hubPath(lang, h)))}">${esc(h.name[lang])}</a></li>`).join("")}</ul></section>`);
  const near = nearby(r, ctx.active, today);
  if (near.length) sections.push(`<section aria-labelledby="h-nearby"><h2 id="h-nearby">${esc(t.nearbyH)}</h2><ul class="list">${near.map((x) => `<li><a href="${esc(rel(path, racePath(lang, ctx.slugs.get(x.id)!)))}">${esc(raceTitle(x, lang))}</a><span>${esc([x.next_date ? dateShort(x.next_date, lang) : t.noDateGroup, whereText(x, lang)].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul></section>`);
  const rights = `${L[lang].support}?topic=rights&ref=${encodeURIComponent(abs(path))}#kontakt`;
  sections.push(`<section><p class="sub">${esc(t.ctaH)}</p>${button}<p class="note">${esc(bare ? t.disclaimerNoCourse : t.disclaimer)}</p><p class="note">${esc(t.notAffiliated)} <a href="${esc(rel(path, rights))}" rel="nofollow">${esc(t.rights)}</a></p></section>`);

  const og = ctx.ogImage(r, lang), description = metaDescription(r, lang);
  const ld: object[] = [crumbsLd([{ name: t.home, path: L[lang].home }, { name: t.races, path: indexPath(lang) }, { name: title, path }]), faq.ld];
  const sd = startDate(r);
  // the event only with a real date from the register (a preliminary one says so in the description and as a property); the page is
  // its url, the organiser's site its organizer's; the distance and the climbing as properties
  if (sd) {
    const sp = info?.start_place, geo = sp?.lat !== undefined && sp?.lon !== undefined ? [sp.lat, sp.lon] : r.start;
    ld.unshift({
      "@context": "https://schema.org", "@type": "SportsEvent", name: title, sport: "Running", startDate: sd, inLanguage: lang, url: abs(path),
      eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      description: r.prelim ? `${cap(t.prelim)}. ${description}` : description, image: [og.image],
      additionalProperty: [{ "@type": "PropertyValue", name: "distance", value: Math.round(r.km * 100) / 100, unitCode: "KMT", unitText: "km" },
        ...(climbKnown ? [{ "@type": "PropertyValue", name: "elevationGain", value: r.ascent, unitCode: "MTR", unitText: "m" }] : []),
        ...(r.prelim ? [{ "@type": "PropertyValue", name: "dateStatus", value: "preliminary" }] : [])],
      location: { "@type": "Place", name: sp?.name ?? (where || r.name),
        address: { "@type": "PostalAddress", ...(r.place ? { addressLocality: r.place } : {}), ...(r.country_code ? { addressCountry: r.country_code } : r.country ? { addressCountry: r.country } : {}) },
        ...(geo ? { geo: { "@type": "GeoCoordinates", latitude: geo[0], longitude: geo[1] } } : {}) },
      // the organiser by name (with its site); a site alone names nobody, so it stays on the page only
      ...(r.organizer ? { organizer: { "@type": "Organization", name: r.organizer, ...(r.url ? { url: r.url } : {}) } } : {}),
    });
  }
  return frame({ lang, path, title: pageTitle(r, lang, ctx.titleClash?.has(r.id)), description, css: ctx.css, today, alternates, appId: ctx.appId, og: { ...og, alt: bare ? t.ogAltNoCourse(title) : t.ogAlt(title) }, ld,
    body: `<article>${hero}${cta}${sections.join("\n")}</article>`, script: r.next_date && r.next_date >= today ? cdScript(lang) : undefined,
    module: ctx.sceneJs ? sceneScript(rel(path, "scene.js")) : undefined,
    crumbs: [{ name: t.home, path: L[lang].home }, { name: t.races, path: indexPath(lang) }, { name: title }] });
}

/** A race's old address (a slug that had a sponsor in front): a page with noindex that sends the reader on to the race's page (a refresh
 *  at once, the canonical link, and a plain link), with no name of its own. */
export function movedPage(fromSlug: string, toSlug: string, lang: Lang, ctx: Pick<Ctx, "css" | "today">): string {
  const t = T[lang], path = racePath(lang, fromSlug), to = racePath(lang, toSlug), href = rel(path, to);
  const html = frame({ lang, path, title: t.movedTitle, description: t.moved, css: ctx.css, today: ctx.today, noindex: true,
    body: `<div class="race-hero"><div class="eyebrow">${esc(t.races)}</div><p class="lead">${esc(t.moved)}</p><div class="ctas"><a class="cta" href="${esc(href)}">${esc(t.movedLink)}</a><a class="cta alt" href="${esc(rel(path, indexPath(lang)))}">${esc(t.allRaces)}</a></div></div>`,
    crumbs: [{ name: t.home, path: L[lang].home }, { name: t.races, path: indexPath(lang) }, { name: t.moved }] });
  return html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${esc(href)}"><link rel="canonical" href="${esc(abs(to))}">`);
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
  const item = (r: Race) => `<li data-km="${r.km}" data-b="${bucketOf(r.km)}" data-c="${esc(r.country_code ?? r.country ?? "")}"><a href="${esc(rel(path, racePath(lang, ctx.slugs.get(r.id)!)))}">${esc(raceTitle(r, lang))}</a><span>${esc([r.next_date && r.next_date >= today ? cap(dateLong(r.next_date, lang)) : null, r.place, kmText(r.km, lang), courseless(r) && !r.ascent ? null : `↑ ${num(r.ascent, lang)} m`].filter(Boolean).join(" · "))}</span></li>`;
  const list = [...groups].map(([g, m]) => {
    const id = `g-${g}`, countries = [...m].sort((a, b) => a[0].localeCompare(b[0], LOCALE[lang]));
    return `<section class="grp" aria-labelledby="${id}"><h2 id="${id}">${esc(g === "none" ? t.noDateGroup : monthLabel(g, lang))}</h2>${countries.map(([c, rs]) => `<div class="grp"><h3>${esc(c)}</h3><ul class="list">${rs.map(item).join("")}</ul></div>`).join("")}</section>`;
  }).join("\n");
  const countries = [...new Map(ctx.active.map((r) => [r.country_code ?? r.country ?? "", countryName(r, lang) ?? ""])).entries()].filter(([k]) => k).sort((a, b) => a[1].localeCompare(b[1], LOCALE[lang]));
  const filter = `<form class="filter" hidden aria-label="Filter"><label>${esc(t.filterDistance)}<select name="d"><option value="">${esc(t.all)}</option>${["a", "b", "c", "d"].map((b, i) => `<option value="${b}">${esc(t.buckets[i])}</option>`).join("")}</select></label><label>${esc(t.filterCountry)}<select name="c"><option value="">${esc(t.allCountries)}</option>${countries.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join("")}</select></label></form><p id="nomatch" class="note" hidden>${esc(t.noMatch)}</p>`;
  const pager = pages > 1 ? `<nav class="pager" aria-label="${esc(t.pages)}">${page > 1 ? `<a href="${esc(rel(path, indexPath(lang, page - 1)))}" rel="prev">${esc(t.prev)}</a>` : ""}${Array.from({ length: pages }, (_, i) => i + 1).map((p) => p === page ? `<span aria-current="page">${p}</span>` : `<a href="${esc(rel(path, indexPath(lang, p)))}">${p}</a>`).join("")}${page < pages ? `<a href="${esc(rel(path, indexPath(lang, page + 1)))}" rel="next">${esc(t.next)}</a>` : ""}</nav>` : "";
  const hero = `<div class="race-hero"><div class="eyebrow">${esc(t.races)}</div><h1>${esc(t.indexH1)}${page > 1 ? ` – ${esc(t.pageN(page))}` : ""}</h1><p class="lead">${esc(t.indexLead)}</p><p class="meta">${esc(t.count(total))}</p><div class="ctas">${storeBadge(path, lang, ctx.appStore)}</div><p class="brandline">${esc(t.brandLine)}</p><p class="note">${esc(t.notAffiliatedAll)}</p></div>`;
  // seo: the hubs on the first page (every other page reaches them through it)
  const browse = page === 1 ? hubNav(ctx.hubs ?? [], lang, path, S[lang].browseH) : "";
  return frame({ lang, path, title: `${t.indexTitle}${page > 1 ? ` – ${t.pageN(page)}` : ""} | Mila`, description: page > 1 ? `${S[lang].indexDesc} (${t.pageN(page)})` : S[lang].indexDesc, css: ctx.css, today, alternates, appId: ctx.appId,
    og: { ...ctx.ogImage(null, lang), alt: t.ogDefault }, ld: [crumbsLd([{ name: t.home, path: L[lang].home }, { name: t.races, path: indexPath(lang) }])],
    body: `${hero}${browse}${filter}\n${list}\n${pager}`, script: filterScript, crumbs: [{ name: t.home, path: L[lang].home }, { name: t.races }] });
}

// ------------------------------------------------------------------------------------------------------------- seo: hubs, FAQ, pace table, guides, banner, IndexNow
//
// Package "seo" (2026-10-16). Everything here is built from the register's own facts, with plain arithmetic and plain sentences: no
// forecast, no coaching rule, nothing about how the coach judges.
//   hubs        the races by city (a place with at least two races), by distance (5 km, 10 km, half marathon, marathon, ultra, trail), by
//               month (the coming twelve) and by country, in every language, in the sitemap, linked from the index and every race page;
//               a hub with fewer than two races is never made (no thin pages), and one that falls below two leaves the site
//   FAQ         per race page from the data there is (date and start, distance and climbing, the course in words, aid stations, cut-offs,
//               how to pace it: even effort, the climbs named), with FAQPage markup holding exactly the page's text
//   pace table  a few common target times at even pace: time per km and splits, labelled as arithmetic, never a forecast
//   guides      pages from a data file (race_pages_guides.json next to this script), only entries marked approved: none yet
//   banner      Apple's Smart App Banner once race_pages.json has the app's App Store id ("appStoreId"; empty until launch)
//   IndexNow    the key file at the root, and the addresses that changed in a run, pinged to api.indexnow.org by the workflow

/** The brand as each language writes it (og:site_name, the product's name in markup). */
export const BRAND: Record<Lang, string> = { sv: "Mila – löpcoach", en: "Mila – running coach", de: "Mila – Laufcoach", nb: "Mila – løpecoach", da: "Mila – løbecoach",
  fi: "Mila – juoksuvalmentaja", fr: "Mila – coach de course à pied", es: "Mila – coach de running" };
/** Apple's Smart App Banner, only for an App Store id (digits); nothing while the id is not set. */
export function smartBannerMeta(id: string | null | undefined): string {
  return typeof id === "string" && /^\d{6,12}$/.test(id) ? `<meta name="apple-itunes-app" content="app-id=${id}">` : "";
}

const S = {
  sv: {
    indexDesc: "Loppen i Milas loppregister med bana, höjdprofil, klättringar, vätskekontroller och tempotabell. Välj ditt lopp och få din tempoplan i Mila.",
    faqH: "Vanliga frågor", qWhen: (n: string) => `När går ${n}?`, qStart: (n: string) => `Vilken tid startar ${n}?`,
    qDist: (n: string) => `Hur lång är ${n} och hur många höjdmeter är det?`, qCourse: (n: string) => `Hur ser banan på ${n} ut?`,
    qAid: (n: string) => `Finns det vätskekontroller på ${n}?`, qCut: (n: string) => `Finns det maxtider på ${n}?`, qPace: (n: string) => `Hur lägger jag upp farten på ${n}?`,
    aWhen: (n: string, d: string, prelim: boolean) => `${n} går ${d}${prelim ? " (preliminärt datum)" : ""}. Kontrollera datum och starttid hos arrangören.`,
    aNoDate: (last: string | null) => `Datum för nästa upplaga är inte klart än.${last ? ` Senast gick loppet ${last}.` : ""}`,
    aPassed: (d: string) => `Loppet gick ${d}. Datum för nästa upplaga är inte klart än.`,
    aStart: (list: string) => `Enligt arrangören: ${list}.`, clock: (t: string) => `kl. ${t}`,
    aDist: (k: string, up: string | null, down: string | null, hi: string | null) => `Loppet är ${k} långt${up ? ` med ${up} höjdmeter uppför${down ? ` och ${down} nedför` : ""}` : ""}.${hi ? ` Högsta punkten ligger ${hi} m ö.h.` : ""}`,
    aDistNoClimb: (k: string) => `Loppet är ${k} långt. Arrangören anger inga höjdmeter.`, aDistOrg: (k: string, a: string) => `Loppet är ${k} långt. Arrangören anger ${a} höjdmeter.`,
    aCourse: (h: string, perKm: string, loop: boolean | null, trail: boolean, climbs: string) => `Banan räknas som ${h}, med ${perKm} höjdmeter per km i snitt. ${climbs} ${loop === null ? "" : loop ? "Start och mål ligger på samma plats. " : "Banan går från start till ett mål på en annan plats. "}Underlaget är ${trail ? "terräng och stig" : "väg"}.`,
    aClimbs: (n: number, km: string, gain: string, len: string) => n === 1 ? `Den har en klättring på minst 25 höjdmeter, vid km ${km}: ${gain} höjdmeter på ${len}.` : `Den har ${n} klättringar på minst 25 höjdmeter; den största börjar vid km ${km}: ${gain} höjdmeter på ${len}.`,
    aNoClimbs: "Den har inga sammanhängande klättringar på 25 höjdmeter eller mer.",
    aAid: (n: number, list: string) => `Ja. Arrangören har ${n === 1 ? "en vätskekontroll" : `${n} vätskekontroller`}: ${list}.`,
    aCut: (list: string) => `Ja, enligt arrangören: ${list}.`,
    aPaceEven: "Sikta på en jämn ansträngning hela vägen, och håll igen de första kilometrarna när benen känns pigga och fältet drar iväg.",
    aPaceFlat: (h: string) => `Banan är ${h}, så ett jämnt tempo per kilometer fungerar bra.`,
    aPaceHills: (kms: string) => `Sikta på en jämn ansträngning snarare än ett jämnt tempo: låt farten gå ner i uppförsbackarna, hämta tillbaka den när det planar ut, och håll igen de första kilometrarna. De största klättringarna börjar vid ${kms}.`, and: "och",
    aPaceTail: "I Mila får du en tempoplan för just den här banan efter din egen form.",
    paceH: "Tempotabell", paceRow: (n: string, t: string) => `${n} på ${t} – tid per km och mellantider`, perKm: "per km", finish: "mål",
    paceNote: "Tiderna förutsätter jämnt tempo hela vägen. Det är ren räkning, ingen prognos: i backar, i trängsel och vid vätskekontroller varierar tempot.",
    seeAlso: "Fler lopp som det här", browseH: "Hitta lopp", browseKinds: { city: "Orter", distance: "Distanser", month: "Månader", country: "Länder" },
    hubName: { city: (p: string) => `Lopp i ${p}`, month: (m: string) => `Lopp i ${m}`, country: (c: string) => `Lopp i ${c}` },
    distName: { "5k": "5 km-lopp", "10k": "10 km-lopp", half: "Halvmaraton", marathon: "Maraton", ultra: "Ultralopp", trail: "Traillopp" } as Record<string, string>,
    distAbout: { "5k": "Lopp på omkring 5 km.", "10k": "Lopp på omkring 10 km.", half: "Ett halvmaraton är 21,1 km.", marathon: "Ett maraton är 42,195 km.", ultra: "Ett ultralopp är längre än ett maraton.", trail: "Traillopp går i terräng och på stig, ofta med fler höjdmeter än på väg." } as Record<string, string>,
    hubTail: "banor, datum och höjdprofiler", hubIntro: (n: number) => `${n} lopp ur Milas loppregister. Varje lopp har en egen sida med bana, höjdprofil, fakta från arrangören och en tempotabell.`,
    hubNext: (d: string, n: string) => `Närmast på tur: ${n}, ${d}.`, hubClimb: (lo: string, hi: string) => `Höjdmetrarna varierar från ${lo} till ${hi}.`,
    hubMore: "Fler sätt att hitta lopp", hubDesc: (name: string, n: number) => `${name}: ${n} lopp med bana, datum, höjdprofil och tempotabell. Välj ditt lopp och få din tempoplan i Mila.`,
    guidesCrumb: "Guider",
  },
  en: {
    indexDesc: "The races in Mila's race register with course, elevation profile, climbs, aid stations and pace table. Pick your race and get your pace plan in Mila.",
    faqH: "Frequently asked questions", qWhen: (n: string) => `When is ${n}?`, qStart: (n: string) => `What time does ${n} start?`,
    qDist: (n: string) => `How long is ${n} and how much climbing is there?`, qCourse: (n: string) => `What is the course of ${n} like?`,
    qAid: (n: string) => `Are there aid stations at ${n}?`, qCut: (n: string) => `Are there cut-off times at ${n}?`, qPace: (n: string) => `How should I pace ${n}?`,
    aWhen: (n: string, d: string, prelim: boolean) => `${n} takes place on ${d}${prelim ? " (preliminary date)" : ""}. Check the date and start time with the organizer.`,
    aNoDate: (last: string | null) => `The date of the next edition is not set yet.${last ? ` The race was last held on ${last}.` : ""}`,
    aPassed: (d: string) => `The race took place on ${d}. The date of the next edition is not set yet.`,
    aStart: (list: string) => `According to the organizer: ${list}.`, clock: (t: string) => t,
    aDist: (k: string, up: string | null, down: string | null, hi: string | null) => `The race is ${k}${up ? ` with ${up} m of climbing${down ? ` and ${down} m of descent` : ""}` : ""}.${hi ? ` The highest point is ${hi} m above sea level.` : ""}`,
    aDistNoClimb: (k: string) => `The race is ${k}. The organizer states no climbing.`, aDistOrg: (k: string, a: string) => `The race is ${k}. The organizer states ${a} m of climbing.`,
    aCourse: (h: string, perKm: string, loop: boolean | null, trail: boolean, climbs: string) => `The course is ${h}, with ${perKm} m of climbing per km on average. ${climbs} ${loop === null ? "" : loop ? "Start and finish are in the same place. " : "It runs from the start to a finish in another place. "}The surface is ${trail ? "trail" : "road"}.`,
    aClimbs: (n: number, km: string, gain: string, len: string) => n === 1 ? `It has one climb of at least 25 m, at km ${km}: ${gain} m over ${len}.` : `It has ${n} climbs of at least 25 m; the biggest starts at km ${km}: ${gain} m over ${len}.`,
    aNoClimbs: "It has no sustained climbs of 25 m or more.",
    aAid: (n: number, list: string) => `Yes. The organizer lists ${n === 1 ? "one aid station" : `${n} aid stations`}: ${list}.`,
    aCut: (list: string) => `Yes, according to the organizer: ${list}.`,
    aPaceEven: "Aim for an even effort the whole way, and hold back in the first kilometres when your legs feel fresh and the field pulls away.",
    aPaceFlat: (h: string) => `The course is ${h}, so an even pace per kilometre works well.`,
    aPaceHills: (kms: string) => `Aim for an even effort rather than an even pace: let the pace drop on the climbs, win it back where it levels out, and hold back in the first kilometres. The biggest climbs start at ${kms}.`, and: "and",
    aPaceTail: "In Mila you get a pace plan for this course, based on your own form.",
    paceH: "Pace table", paceRow: (n: string, t: string) => `${n} in ${t} – pace per km and splits`, perKm: "per km", finish: "finish",
    paceNote: "The times assume an even pace the whole way. This is plain arithmetic, not a forecast: on climbs, in crowds and at aid stations the pace varies.",
    seeAlso: "More races like this", browseH: "Find races", browseKinds: { city: "Places", distance: "Distances", month: "Months", country: "Countries" },
    hubName: { city: (p: string) => `Races in ${p}`, month: (m: string) => `Races in ${m}`, country: (c: string) => `Races in ${c}` },
    distName: { "5k": "5K races", "10k": "10K races", half: "Half marathons", marathon: "Marathons", ultra: "Ultra races", trail: "Trail races" } as Record<string, string>,
    distAbout: { "5k": "Races of about 5 km.", "10k": "Races of about 10 km.", half: "A half marathon is 21.1 km.", marathon: "A marathon is 42.195 km.", ultra: "An ultra is any race longer than a marathon.", trail: "Trail races run on trails and off-road, often with more climbing than on the road." } as Record<string, string>,
    hubTail: "courses, dates and elevation profiles", hubIntro: (n: number) => `${n} ${n === 1 ? "race" : "races"} from Mila's race register. Every race has its own page with the course, elevation profile, the organizer's facts and a pace table.`,
    hubNext: (d: string, n: string) => `Next up: ${n}, ${d}.`, hubClimb: (lo: string, hi: string) => `Elevation gain ranges from ${lo} to ${hi} m.`,
    hubMore: "More ways to find races", hubDesc: (name: string, n: number) => `${name}: ${n} races with course, date, elevation profile and pace table. Pick your race and get your pace plan in Mila.`,
    guidesCrumb: "Guides",
  },
  de: {
    indexDesc: "Die Läufe in Milas Laufregister mit Strecke, Höhenprofil, Anstiegen, Verpflegung und Pace-Tabelle. Wähle deinen Lauf und hol dir deinen Pace-Plan in Mila.",
    faqH: "Häufige Fragen", qWhen: (n: string) => `Wann findet ${n} statt?`, qStart: (n: string) => `Wann ist der Start bei ${n}?`,
    qDist: (n: string) => `Wie lang ist ${n} und wie viele Höhenmeter hat die Strecke?`, qCourse: (n: string) => `Wie ist die Strecke von ${n}?`,
    qAid: (n: string) => `Gibt es Verpflegungsstellen bei ${n}?`, qCut: (n: string) => `Gibt es Zeitlimits bei ${n}?`, qPace: (n: string) => `Wie teile ich mir ${n} ein?`,
    aWhen: (n: string, d: string, prelim: boolean) => `${n} findet am ${d} statt${prelim ? " (vorläufiges Datum)" : ""}. Prüfe Datum und Startzeit beim Veranstalter.`,
    aNoDate: (last: string | null) => `Das Datum der nächsten Ausgabe steht noch nicht fest.${last ? ` Zuletzt fand der Lauf am ${last} statt.` : ""}`,
    aPassed: (d: string) => `Der Lauf fand am ${d} statt. Das Datum der nächsten Ausgabe steht noch nicht fest.`,
    aStart: (list: string) => `Laut Veranstalter: ${list}.`, clock: (t: string) => `${t} Uhr`,
    aDist: (k: string, up: string | null, down: string | null, hi: string | null) => `Der Lauf ist ${k} lang${up ? ` mit ${up} Höhenmetern bergauf${down ? ` und ${down} bergab` : ""}` : ""}.${hi ? ` Der höchste Punkt liegt auf ${hi} m ü. M.` : ""}`,
    aDistNoClimb: (k: string) => `Der Lauf ist ${k} lang. Der Veranstalter nennt keine Höhenmeter.`, aDistOrg: (k: string, a: string) => `Der Lauf ist ${k} lang. Der Veranstalter gibt ${a} Höhenmeter an.`,
    aCourse: (h: string, perKm: string, loop: boolean | null, trail: boolean, climbs: string) => `Die Strecke ist ${h}, mit durchschnittlich ${perKm} Höhenmetern pro km. ${climbs} ${loop === null ? "" : loop ? "Start und Ziel liegen am selben Ort. " : "Sie führt vom Start zu einem Ziel an einem anderen Ort. "}Der Untergrund ist ${trail ? "Trail und Gelände" : "Straße"}.`,
    aClimbs: (n: number, km: string, gain: string, len: string) => n === 1 ? `Sie hat einen Anstieg ab 25 Höhenmetern, bei km ${km}: ${gain} Höhenmeter auf ${len}.` : `Sie hat ${n} Anstiege ab 25 Höhenmetern; der größte beginnt bei km ${km}: ${gain} Höhenmeter auf ${len}.`,
    aNoClimbs: "Sie hat keine zusammenhängenden Anstiege ab 25 Höhenmetern.",
    aAid: (n: number, list: string) => `Ja. Der Veranstalter nennt ${n === 1 ? "eine Verpflegungsstelle" : `${n} Verpflegungsstellen`}: ${list}.`,
    aCut: (list: string) => `Ja, laut Veranstalter: ${list}.`,
    aPaceEven: "Lauf mit gleichmäßiger Anstrengung und halte dich auf den ersten Kilometern zurück, wenn die Beine frisch sind und das Feld davonzieht.",
    aPaceFlat: (h: string) => `Die Strecke ist ${h}, ein gleichmäßiges Tempo pro Kilometer passt deshalb gut.`,
    aPaceHills: (kms: string) => `Lauf eher mit gleichmäßiger Anstrengung als mit gleichmäßigem Tempo: Lass das Tempo an den Anstiegen sinken, hol es zurück, wo es flacher wird, und halte dich auf den ersten Kilometern zurück. Die größten Anstiege beginnen bei ${kms}.`, and: "und",
    aPaceTail: "In Mila bekommst du einen Pace-Plan für genau diese Strecke, passend zu deiner Form.",
    paceH: "Pace-Tabelle", paceRow: (n: string, t: string) => `${n} in ${t} – Pace pro km und Zwischenzeiten`, perKm: "pro km", finish: "Ziel",
    paceNote: "Die Zeiten setzen ein gleichmäßiges Tempo auf der ganzen Strecke voraus. Das ist reine Rechnung, keine Prognose: an Anstiegen, im Gedränge und an Verpflegungsstellen schwankt das Tempo.",
    seeAlso: "Ähnliche Läufe", browseH: "Läufe finden", browseKinds: { city: "Orte", distance: "Distanzen", month: "Monate", country: "Länder" },
    hubName: { city: (p: string) => `Läufe in ${p}`, month: (m: string) => `Läufe im ${m}`, country: (c: string) => `Läufe in ${c}` },
    distName: { "5k": "5-km-Läufe", "10k": "10-km-Läufe", half: "Halbmarathons", marathon: "Marathons", ultra: "Ultraläufe", trail: "Trailläufe" } as Record<string, string>,
    distAbout: { "5k": "Läufe über rund 5 km.", "10k": "Läufe über rund 10 km.", half: "Ein Halbmarathon ist 21,1 km lang.", marathon: "Ein Marathon ist 42,195 km lang.", ultra: "Ein Ultralauf ist länger als ein Marathon.", trail: "Trailläufe führen über Pfade und durchs Gelände, oft mit mehr Höhenmetern als auf der Straße." } as Record<string, string>,
    hubTail: "Strecken, Termine und Höhenprofile", hubIntro: (n: number) => `${n} ${n === 1 ? "Lauf" : "Läufe"} aus Milas Laufregister. Jeder Lauf hat eine eigene Seite mit Strecke, Höhenprofil, Angaben des Veranstalters und einer Pace-Tabelle.`,
    hubNext: (d: string, n: string) => `Als Nächstes: ${n}, ${d}.`, hubClimb: (lo: string, hi: string) => `Die Höhenmeter reichen von ${lo} bis ${hi}.`,
    hubMore: "Weitere Wege zu deinem Lauf", hubDesc: (name: string, n: number) => `${name}: ${n} Läufe mit Strecke, Datum, Höhenprofil und Pace-Tabelle. Wähle deinen Lauf und hol dir deinen Pace-Plan in Mila.`,
    guidesCrumb: "Ratgeber",
  },
  nb: {
    indexDesc: "Løpene i Milas løpsregister med løype, høydeprofil, stigninger, drikkestasjoner og tempotabell. Velg løpet ditt og få tempoplanen din i Mila.",
    faqH: "Vanlige spørsmål", qWhen: (n: string) => `Når går ${n}?`, qStart: (n: string) => `Når starter ${n}?`,
    qDist: (n: string) => `Hvor langt er ${n}, og hvor mange høydemeter er det?`, qCourse: (n: string) => `Hvordan er løypa i ${n}?`,
    qAid: (n: string) => `Er det drikkestasjoner i ${n}?`, qCut: (n: string) => `Er det makstider i ${n}?`, qPace: (n: string) => `Hvordan legger jeg opp farten i ${n}?`,
    aWhen: (n: string, d: string, prelim: boolean) => `${n} går ${d}${prelim ? " (foreløpig dato)" : ""}. Sjekk dato og starttid hos arrangøren.`,
    aNoDate: (last: string | null) => `Datoen for neste utgave er ikke klar ennå.${last ? ` Løpet gikk sist ${last}.` : ""}`,
    aPassed: (d: string) => `Løpet gikk ${d}. Datoen for neste utgave er ikke klar ennå.`,
    aStart: (list: string) => `Ifølge arrangøren: ${list}.`, clock: (t: string) => `kl. ${t}`,
    aDist: (k: string, up: string | null, down: string | null, hi: string | null) => `Løpet er ${k} langt${up ? ` med ${up} høydemeter oppover${down ? ` og ${down} nedover` : ""}` : ""}.${hi ? ` Høyeste punkt ligger ${hi} moh.` : ""}`,
    aDistNoClimb: (k: string) => `Løpet er ${k} langt. Arrangøren oppgir ingen høydemeter.`, aDistOrg: (k: string, a: string) => `Løpet er ${k} langt. Arrangøren oppgir ${a} høydemeter.`,
    aCourse: (h: string, perKm: string, loop: boolean | null, trail: boolean, climbs: string) => `Løypa regnes som ${h}, med ${perKm} høydemeter per km i snitt. ${climbs} ${loop === null ? "" : loop ? "Start og mål ligger på samme sted. " : "Løypa går fra start til et mål på et annet sted. "}Underlaget er ${trail ? "terreng og sti" : "vei"}.`,
    aClimbs: (n: number, km: string, gain: string, len: string) => n === 1 ? `Den har én stigning på minst 25 høydemeter, ved km ${km}: ${gain} høydemeter på ${len}.` : `Den har ${n} stigninger på minst 25 høydemeter; den største starter ved km ${km}: ${gain} høydemeter på ${len}.`,
    aNoClimbs: "Den har ingen sammenhengende stigninger på 25 høydemeter eller mer.",
    aAid: (n: number, list: string) => `Ja. Arrangøren har ${n === 1 ? "én drikkestasjon" : `${n} drikkestasjoner`}: ${list}.`,
    aCut: (list: string) => `Ja, ifølge arrangøren: ${list}.`,
    aPaceEven: "Sikt på en jevn innsats hele veien, og hold igjen de første kilometerne når beina føles friske og feltet drar fra.",
    aPaceFlat: (h: string) => `Løypa er ${h}, så et jevnt tempo per kilometer fungerer godt.`,
    aPaceHills: (kms: string) => `Sikt på en jevn innsats heller enn et jevnt tempo: la farten gå ned i motbakkene, hent den inn igjen når det flater ut, og hold igjen de første kilometerne. De største stigningene starter ved ${kms}.`, and: "og",
    aPaceTail: "I Mila får du en tempoplan for akkurat denne løypa etter din egen form.",
    paceH: "Tempotabell", paceRow: (n: string, t: string) => `${n} på ${t} – tid per km og mellomtider`, perKm: "per km", finish: "mål",
    paceNote: "Tidene forutsetter jevnt tempo hele veien. Det er ren regning, ingen prognose: i bakker, i trengsel og ved drikkestasjoner varierer tempoet.",
    seeAlso: "Flere løp som dette", browseH: "Finn løp", browseKinds: { city: "Steder", distance: "Distanser", month: "Måneder", country: "Land" },
    hubName: { city: (p: string) => `Løp i ${p}`, month: (m: string) => `Løp i ${m}`, country: (c: string) => `Løp i ${c}` },
    distName: { "5k": "5 km-løp", "10k": "10 km-løp", half: "Halvmaraton", marathon: "Maraton", ultra: "Ultraløp", trail: "Terrengløp" } as Record<string, string>,
    distAbout: { "5k": "Løp på omtrent 5 km.", "10k": "Løp på omtrent 10 km.", half: "Et halvmaraton er 21,1 km.", marathon: "Et maraton er 42,195 km.", ultra: "Et ultraløp er lengre enn et maraton.", trail: "Terrengløp går i terreng og på sti, ofte med flere høydemeter enn på vei." } as Record<string, string>,
    hubTail: "løyper, datoer og høydeprofiler", hubIntro: (n: number) => `${n} løp fra Milas løpsregister. Hvert løp har en egen side med løype, høydeprofil, fakta fra arrangøren og en tempotabell.`,
    hubNext: (d: string, n: string) => `Nærmest for tur: ${n}, ${d}.`, hubClimb: (lo: string, hi: string) => `Høydemeterne varierer fra ${lo} til ${hi}.`,
    hubMore: "Flere måter å finne løp på", hubDesc: (name: string, n: number) => `${name}: ${n} løp med løype, dato, høydeprofil og tempotabell. Velg løpet ditt og få tempoplanen din i Mila.`,
    guidesCrumb: "Guider",
  },
  da: {
    indexDesc: "Løbene i Milas løbskalender med rute, højdeprofil, stigninger, væskedepoter og tempotabel. Vælg dit løb, og få din tempoplan i Mila.",
    faqH: "Ofte stillede spørgsmål", qWhen: (n: string) => `Hvornår løbes ${n}?`, qStart: (n: string) => `Hvornår starter ${n}?`,
    qDist: (n: string) => `Hvor langt er ${n}, og hvor mange højdemeter er der?`, qCourse: (n: string) => `Hvordan er ruten på ${n}?`,
    qAid: (n: string) => `Er der væskedepoter på ${n}?`, qCut: (n: string) => `Er der maksimaltider på ${n}?`, qPace: (n: string) => `Hvordan fordeler jeg farten på ${n}?`,
    aWhen: (n: string, d: string, prelim: boolean) => `${n} løbes ${d}${prelim ? " (foreløbig dato)" : ""}. Tjek dato og starttid hos arrangøren.`,
    aNoDate: (last: string | null) => `Datoen for næste udgave er ikke fastlagt endnu.${last ? ` Løbet blev senest afviklet ${last}.` : ""}`,
    aPassed: (d: string) => `Løbet blev afviklet ${d}. Datoen for næste udgave er ikke fastlagt endnu.`,
    aStart: (list: string) => `Ifølge arrangøren: ${list}.`, clock: (t: string) => `kl. ${t}`,
    aDist: (k: string, up: string | null, down: string | null, hi: string | null) => `Løbet er ${k} langt${up ? ` med ${up} højdemeter stigning${down ? ` og ${down} højdemeter fald` : ""}` : ""}.${hi ? ` Det højeste punkt ligger ${hi} m o.h.` : ""}`,
    aDistNoClimb: (k: string) => `Løbet er ${k} langt. Arrangøren oplyser ingen højdemeter.`, aDistOrg: (k: string, a: string) => `Løbet er ${k} langt. Arrangøren oplyser ${a} højdemeter.`,
    aCourse: (h: string, perKm: string, loop: boolean | null, trail: boolean, climbs: string) => `Ruten regnes som ${h}, med ${perKm} højdemeter pr. km i snit. ${climbs} ${loop === null ? "" : loop ? "Start og mål ligger samme sted. " : "Ruten går fra start til et mål et andet sted. "}Underlaget er ${trail ? "terræn og sti" : "vej"}.`,
    aClimbs: (n: number, km: string, gain: string, len: string) => n === 1 ? `Den har én stigning på mindst 25 højdemeter, ved km ${km}: ${gain} højdemeter på ${len}.` : `Den har ${n} stigninger på mindst 25 højdemeter; den største begynder ved km ${km}: ${gain} højdemeter på ${len}.`,
    aNoClimbs: "Den har ingen sammenhængende stigninger på 25 højdemeter eller mere.",
    aAid: (n: number, list: string) => `Ja. Arrangøren har ${n === 1 ? "ét væskedepot" : `${n} væskedepoter`}: ${list}.`,
    aCut: (list: string) => `Ja, ifølge arrangøren: ${list}.`,
    aPaceEven: "Gå efter en jævn indsats hele vejen, og hold igen de første kilometer, når benene føles friske, og feltet trækker fra.",
    aPaceFlat: (h: string) => `Ruten er ${h}, så et jævnt tempo pr. kilometer fungerer godt.`,
    aPaceHills: (kms: string) => `Gå efter en jævn indsats frem for et jævnt tempo: lad farten falde på stigningerne, hent den igen, når det flader ud, og hold igen de første kilometer. De største stigninger begynder ved ${kms}.`, and: "og",
    aPaceTail: "I Mila får du en tempoplan til netop denne rute efter din egen form.",
    paceH: "Tempotabel", paceRow: (n: string, t: string) => `${n} på ${t} – tid pr. km og mellemtider`, perKm: "pr. km", finish: "mål",
    paceNote: "Tiderne forudsætter et jævnt tempo hele vejen. Det er ren regning, ingen prognose: på stigninger, i trængsel og ved væskedepoter svinger tempoet.",
    seeAlso: "Flere løb som dette", browseH: "Find løb", browseKinds: { city: "Byer", distance: "Distancer", month: "Måneder", country: "Lande" },
    hubName: { city: (p: string) => `Løb i ${p}`, month: (m: string) => `Løb i ${m}`, country: (c: string) => `Løb i ${c}` },
    distName: { "5k": "5 km-løb", "10k": "10 km-løb", half: "Halvmaraton", marathon: "Maraton", ultra: "Ultraløb", trail: "Trailløb" } as Record<string, string>,
    distAbout: { "5k": "Løb på omkring 5 km.", "10k": "Løb på omkring 10 km.", half: "Et halvmaraton er 21,1 km.", marathon: "Et maraton er 42,195 km.", ultra: "Et ultraløb er længere end et maraton.", trail: "Trailløb foregår i terræn og på stier, ofte med flere højdemeter end på vej." } as Record<string, string>,
    hubTail: "ruter, datoer og højdeprofiler", hubIntro: (n: number) => `${n} løb fra Milas løbskalender. Hvert løb har sin egen side med rute, højdeprofil, fakta fra arrangøren og en tempotabel.`,
    hubNext: (d: string, n: string) => `Næste løb: ${n}, ${d}.`, hubClimb: (lo: string, hi: string) => `Højdemeterne går fra ${lo} til ${hi}.`,
    hubMore: "Flere måder at finde løb på", hubDesc: (name: string, n: number) => `${name}: ${n} løb med rute, dato, højdeprofil og tempotabel. Vælg dit løb, og få din tempoplan i Mila.`,
    guidesCrumb: "Guides",
  },
  fi: {
    indexDesc: "Milan kisakalenterin kisat: reitti, korkeusprofiili, nousut, juomapisteet ja vauhtitaulukko. Valitse kisasi ja hae vauhtisuunnitelmasi Milasta.",
    faqH: "Usein kysyttyä", qWhen: (n: string) => `${n}: milloin kisa juostaan?`, qStart: (n: string) => `${n}: mihin aikaan lähtö on?`,
    qDist: (n: string) => `${n}: kuinka pitkä matka on ja paljonko nousua on?`, qCourse: (n: string) => `${n}: millainen reitti on?`,
    qAid: (n: string) => `${n}: onko reitillä juomapisteitä?`, qCut: (n: string) => `${n}: onko kisassa maksimiaikoja?`, qPace: (n: string) => `${n}: miten jaan vauhtini?`,
    aWhen: (n: string, d: string, prelim: boolean) => `${n} juostaan ${d}${prelim ? " (alustava päivä)" : ""}. Tarkista päivä ja lähtöaika järjestäjältä.`,
    aNoDate: (last: string | null) => `Seuraavan kisan päivä ei ole vielä selvillä.${last ? ` Viimeksi kisa juostiin ${last}.` : ""}`,
    aPassed: (d: string) => `Kisa juostiin ${d}. Seuraavan kisan päivä ei ole vielä selvillä.`,
    aStart: (list: string) => `Järjestäjän mukaan: ${list}.`, clock: (t: string) => `klo ${t}`,
    aDist: (k: string, up: string | null, down: string | null, hi: string | null) => `Matka on ${k}${up ? `, nousua ${up} m${down ? ` ja laskua ${down} m` : ""}` : ""}.${hi ? ` Korkein kohta on ${hi} m mpy.` : ""}`,
    aDistNoClimb: (k: string) => `Matka on ${k}. Järjestäjä ei ilmoita nousumetrejä.`, aDistOrg: (k: string, a: string) => `Matka on ${k}. Järjestäjän mukaan nousua on ${a} m.`,
    aCourse: (h: string, perKm: string, loop: boolean | null, trail: boolean, climbs: string) => `Reitti on ${h}, nousua keskimäärin ${perKm} m kilometrillä. ${climbs} ${loop === null ? "" : loop ? "Lähtö ja maali ovat samassa paikassa. " : "Reitti kulkee lähdöstä maaliin, joka on eri paikassa. "}Alusta on ${trail ? "maastoa ja polkua" : "maantietä"}.`,
    aClimbs: (n: number, km: string, gain: string, len: string) => n === 1 ? `Reitillä on yksi vähintään 25 nousumetrin nousu, kohdassa km ${km}: ${gain} m ${len}:n matkalla.` : `Reitillä on ${n} vähintään 25 nousumetrin nousua; suurin alkaa kohdassa km ${km}: ${gain} m ${len}:n matkalla.`,
    aNoClimbs: "Reitillä ei ole yhtenäisiä vähintään 25 nousumetrin nousuja.",
    aAid: (n: number, list: string) => `Kyllä. Järjestäjällä on ${n === 1 ? "yksi juomapiste" : `${n} juomapistettä`}: ${list}.`,
    aCut: (list: string) => `Kyllä, järjestäjän mukaan: ${list}.`,
    aPaceEven: "Pyri tasaiseen rasitukseen koko matkan, ja jarruttele ensimmäisillä kilometreillä, kun jalat tuntuvat kevyiltä ja muut karkaavat edelle.",
    aPaceFlat: (h: string) => `Reitti on ${h}, joten tasainen vauhti kilometriä kohden toimii hyvin.`,
    aPaceHills: (kms: string) => `Pyri tasaiseen rasitukseen mieluummin kuin tasaiseen vauhtiin: anna vauhdin hidastua ylämäissä, ota se takaisin, kun maasto tasaantuu, ja jarruttele ensimmäisillä kilometreillä. Suurimmat nousut alkavat kohdissa ${kms}.`, and: "ja",
    aPaceTail: "Milasta saat juuri tälle reitille vauhtisuunnitelman oman kuntosi mukaan.",
    paceH: "Vauhtitaulukko", paceRow: (n: string, t: string) => `${n} ajassa ${t} – vauhti kilometrillä ja väliajat`, perKm: "min/km", finish: "maali",
    paceNote: "Ajat olettavat tasaisen vauhdin koko matkan. Tämä on pelkkää laskentaa, ei ennuste: mäissä, ruuhkassa ja juomapisteillä vauhti vaihtelee.",
    seeAlso: "Lisää samanlaisia kisoja", browseH: "Löydä kisa", browseKinds: { city: "Paikkakunnat", distance: "Matkat", month: "Kuukaudet", country: "Maat" },
    hubName: { city: (p: string) => `Juoksukisat: ${p}`, month: (m: string) => `Juoksukisat: ${m}`, country: (c: string) => `Juoksukisat: ${c}` },
    distName: { "5k": "5 km:n kisat", "10k": "10 km:n kisat", half: "Puolimaratonit", marathon: "Maratonit", ultra: "Ultrajuoksut", trail: "Polkujuoksut" } as Record<string, string>,
    distAbout: { "5k": "Noin 5 km:n kisoja.", "10k": "Noin 10 km:n kisoja.", half: "Puolimaraton on 21,1 km.", marathon: "Maraton on 42,195 km.", ultra: "Ultrajuoksu on maratonia pidempi.", trail: "Polkujuoksut kulkevat maastossa ja poluilla, usein mäkisemmin kuin maantiellä." } as Record<string, string>,
    hubTail: "reitit, päivät ja korkeusprofiilit", hubIntro: (n: number) => `${n} ${n === 1 ? "kisa" : "kisaa"} Milan kisakalenterista. Jokaisella kisalla on oma sivu, jossa on reitti, korkeusprofiili, järjestäjän tiedot ja vauhtitaulukko.`,
    hubNext: (d: string, n: string) => `Seuraavana vuorossa: ${n}, ${d}.`, hubClimb: (lo: string, hi: string) => `Nousua on ${lo}–${hi} m.`,
    hubMore: "Lisää tapoja löytää kisoja", hubDesc: (name: string, n: number) => `${name}: ${n} kisaa, joissa on reitti, päivä, korkeusprofiili ja vauhtitaulukko. Valitse kisasi ja hae vauhtisuunnitelmasi Milasta.`,
    guidesCrumb: "Oppaat",
  },
  fr: {
    indexDesc: "Les courses du calendrier de Mila avec parcours, profil d’altitude, montées, ravitaillements et tableau d’allures. Choisis ta course et obtiens ton plan d’allure dans Mila.",
    faqH: "Questions fréquentes", qWhen: (n: string) => `Quand a lieu ${n} ?`, qStart: (n: string) => `À quelle heure part ${n} ?`,
    qDist: (n: string) => `${n} : quelle distance et quel dénivelé ?`, qCourse: (n: string) => `${n} : à quoi ressemble le parcours ?`,
    qAid: (n: string) => `${n} : y a-t-il des ravitaillements ?`, qCut: (n: string) => `${n} : y a-t-il des barrières horaires ?`, qPace: (n: string) => `${n} : comment gérer mon allure ?`,
    aWhen: (n: string, d: string, prelim: boolean) => `${n} a lieu le ${d}${prelim ? " (date provisoire)" : ""}. Vérifie la date et l’heure de départ auprès de l’organisateur.`,
    aNoDate: (last: string | null) => `La date de la prochaine édition n’est pas encore fixée.${last ? ` La dernière édition a eu lieu le ${last}.` : ""}`,
    aPassed: (d: string) => `La course a eu lieu le ${d}. La date de la prochaine édition n’est pas encore fixée.`,
    aStart: (list: string) => `Selon l’organisateur : ${list}.`, clock: (t: string) => frClock(t),
    aDist: (k: string, up: string | null, down: string | null, hi: string | null) => `La course fait ${k}${up ? `, avec ${up} m de dénivelé positif${down ? ` et ${down} m de dénivelé négatif` : ""}` : ""}.${hi ? ` Le point culminant est à ${hi} m d’altitude.` : ""}`,
    aDistNoClimb: (k: string) => `La course fait ${k}. L’organisateur n’indique pas de dénivelé.`, aDistOrg: (k: string, a: string) => `La course fait ${k}. L’organisateur annonce ${a} m de dénivelé positif.`,
    aCourse: (h: string, perKm: string, loop: boolean | null, trail: boolean, climbs: string) => `Le parcours est ${h}, avec ${perKm} m de dénivelé par km en moyenne. ${climbs} ${loop === null ? "" : loop ? "Le départ et l’arrivée sont au même endroit. " : "Il va du départ à une arrivée située ailleurs. "}On y court ${trail ? "sur sentiers et en nature" : "sur route"}.`,
    aClimbs: (n: number, km: string, gain: string, len: string) => n === 1 ? `Il compte une montée d’au moins 25 m, au km ${km} : ${gain} m sur ${len}.` : `Il compte ${n} montées d’au moins 25 m ; la plus grande commence au km ${km} : ${gain} m sur ${len}.`,
    aNoClimbs: "Il ne compte aucune montée continue de 25 m ou plus.",
    aAid: (n: number, list: string) => `Oui. L’organisateur prévoit ${n === 1 ? "un ravitaillement" : `${n} ravitaillements`} : ${list}.`,
    aCut: (list: string) => `Oui, selon l’organisateur : ${list}.`,
    aPaceEven: "Vise un effort régulier du début à la fin, et retiens-toi sur les premiers kilomètres, quand les jambes sont fraîches et que le peloton part vite.",
    aPaceFlat: (h: string) => `Le parcours est ${h}, une allure régulière au kilomètre convient donc bien.`,
    aPaceHills: (kms: string) => `Vise un effort régulier plutôt qu’une allure régulière : laisse l’allure baisser dans les montées, reprends-la quand le terrain s’aplanit, et retiens-toi sur les premiers kilomètres. Les plus grandes montées commencent au ${kms}.`, and: "et",
    aPaceTail: "Dans Mila, tu obtiens un plan d’allure pour ce parcours, adapté à ta forme.",
    paceH: "Tableau d’allures", paceRow: (n: string, t: string) => `${n} en ${t} – allure au km et temps de passage`, perKm: "min/km", finish: "arrivée",
    paceNote: "Les temps supposent une allure régulière du début à la fin. C’est un simple calcul, pas un pronostic : dans les montées, dans la foule et aux ravitaillements, l’allure varie.",
    seeAlso: "D’autres courses de ce type", browseH: "Trouver une course", browseKinds: { city: "Villes", distance: "Distances", month: "Mois", country: "Pays" },
    hubName: { city: (p: string) => `Courses à ${p}`, month: (m: string) => `Courses en ${m}`, country: (c: string) => /^(au|aux|à|en) /.test(c) ? `Courses ${c}` : `Courses en ${c}` },
    distName: { "5k": "Courses de 5 km", "10k": "Courses de 10 km", half: "Semi-marathons", marathon: "Marathons", ultra: "Ultras", trail: "Trails" } as Record<string, string>,
    distAbout: { "5k": "Des courses d’environ 5 km.", "10k": "Des courses d’environ 10 km.", half: "Un semi-marathon fait 21,1 km.", marathon: "Un marathon fait 42,195 km.", ultra: "Un ultra est une course plus longue qu’un marathon.", trail: "Les trails se courent sur sentiers et en nature, souvent avec plus de dénivelé que sur route." } as Record<string, string>,
    hubTail: "parcours, dates et profils d’altitude", hubIntro: (n: number) => `${n} ${n === 1 ? "course" : "courses"} du calendrier de Mila. Chaque course a sa propre page avec le parcours, le profil d’altitude, les informations de l’organisateur et un tableau d’allures.`,
    hubNext: (d: string, n: string) => `Prochaine course : ${n}, le ${d}.`, hubClimb: (lo: string, hi: string) => `Le dénivelé positif va de ${lo} à ${hi} m.`,
    hubMore: "D’autres façons de trouver une course", hubDesc: (name: string, n: number) => `${name} : ${n} courses avec parcours, date, profil d’altitude et tableau d’allures. Choisis ta course et obtiens ton plan d’allure dans Mila.`,
    guidesCrumb: "Guides",
  },
  es: {
    indexDesc: "Las carreras del calendario de Mila con recorrido, perfil de altitud, subidas, avituallamientos y tabla de ritmos. Elige tu carrera y consigue tu plan de ritmo en Mila.",
    faqH: "Preguntas frecuentes", qWhen: (n: string) => `¿Cuándo es ${n}?`, qStart: (n: string) => `¿A qué hora sale ${n}?`,
    qDist: (n: string) => `¿Cuánto mide ${n} y cuánto desnivel tiene?`, qCourse: (n: string) => `¿Cómo es el recorrido de ${n}?`,
    qAid: (n: string) => `¿Hay avituallamientos en ${n}?`, qCut: (n: string) => `¿Hay tiempos de corte en ${n}?`, qPace: (n: string) => `¿Cómo reparto el ritmo en ${n}?`,
    aWhen: (n: string, d: string, prelim: boolean) => `${n} se celebra el ${d}${prelim ? " (fecha provisional)" : ""}. Comprueba la fecha y la hora de salida con el organizador.`,
    aNoDate: (last: string | null) => `La fecha de la próxima edición aún no está fijada.${last ? ` La última edición se celebró el ${last}.` : ""}`,
    aPassed: (d: string) => `La carrera se celebró el ${d}. La fecha de la próxima edición aún no está fijada.`,
    aStart: (list: string) => `Según el organizador: ${list}.`, clock: (t: string) => `${t} h`,
    aDist: (k: string, up: string | null, down: string | null, hi: string | null) => `La carrera tiene ${k}${up ? `, con ${up} m de desnivel positivo${down ? ` y ${down} m de desnivel negativo` : ""}` : ""}.${hi ? ` El punto más alto está a ${hi} m sobre el nivel del mar.` : ""}`,
    aDistNoClimb: (k: string) => `La carrera tiene ${k}. El organizador no indica desnivel.`, aDistOrg: (k: string, a: string) => `La carrera tiene ${k}. El organizador indica ${a} m de desnivel positivo.`,
    aCourse: (h: string, perKm: string, loop: boolean | null, trail: boolean, climbs: string) => `El recorrido es ${h}, con ${perKm} m de desnivel por km de media. ${climbs} ${loop === null ? "" : loop ? "La salida y la meta están en el mismo lugar. " : "Va de la salida a una meta situada en otro lugar. "}Se corre ${trail ? "por senderos y caminos" : "sobre asfalto"}.`,
    aClimbs: (n: number, km: string, gain: string, len: string) => n === 1 ? `Tiene una subida de al menos 25 m, en el km ${km}: ${gain} m en ${len}.` : `Tiene ${n} subidas de al menos 25 m; la mayor empieza en el km ${km}: ${gain} m en ${len}.`,
    aNoClimbs: "No tiene subidas continuas de 25 m o más.",
    aAid: (n: number, list: string) => `Sí. El organizador prevé ${n === 1 ? "un avituallamiento" : `${n} avituallamientos`}: ${list}.`,
    aCut: (list: string) => `Sí, según el organizador: ${list}.`,
    aPaceEven: "Busca un esfuerzo constante de principio a fin y contente en los primeros kilómetros, cuando las piernas van frescas y el pelotón sale rápido.",
    aPaceFlat: (h: string) => `El recorrido es ${h}, así que un ritmo constante por kilómetro funciona bien.`,
    aPaceHills: (kms: string) => `Busca un esfuerzo constante más que un ritmo constante: deja que el ritmo baje en las subidas, recupéralo cuando el terreno se allane y contente en los primeros kilómetros. Las subidas más grandes empiezan en el ${kms}.`, and: "y",
    aPaceTail: "En Mila tienes un plan de ritmo para este recorrido, según tu propia forma.",
    paceH: "Tabla de ritmos", paceRow: (n: string, t: string) => `${n} en ${t} – ritmo por km y tiempos de paso`, perKm: "min/km", finish: "meta",
    paceNote: "Los tiempos suponen un ritmo constante de principio a fin. Es pura aritmética, no un pronóstico: en las subidas, entre la gente y en los avituallamientos el ritmo varía.",
    seeAlso: "Más carreras como esta", browseH: "Buscar carreras", browseKinds: { city: "Ciudades", distance: "Distancias", month: "Meses", country: "Países" },
    hubName: { city: (p: string) => `Carreras en ${p}`, month: (m: string) => `Carreras en ${m}`, country: (c: string) => `Carreras en ${c}` },
    distName: { "5k": "Carreras de 5 km", "10k": "Carreras de 10 km", half: "Medias maratones", marathon: "Maratones", ultra: "Ultras", trail: "Carreras de trail" } as Record<string, string>,
    distAbout: { "5k": "Carreras de unos 5 km.", "10k": "Carreras de unos 10 km.", half: "Una media maratón tiene 21,1 km.", marathon: "Una maratón tiene 42,195 km.", ultra: "Una ultra es cualquier carrera más larga que una maratón.", trail: "Las carreras de trail van por senderos y caminos, a menudo con más desnivel que en asfalto." } as Record<string, string>,
    hubTail: "recorridos, fechas y perfiles de altitud", hubIntro: (n: number) => `${n} ${n === 1 ? "carrera" : "carreras"} del calendario de Mila. Cada carrera tiene su propia página con el recorrido, el perfil de altitud, los datos del organizador y una tabla de ritmos.`,
    hubNext: (d: string, n: string) => `La próxima: ${n}, el ${d}.`, hubClimb: (lo: string, hi: string) => `El desnivel positivo va de ${lo} a ${hi} m.`,
    hubMore: "Más formas de buscar carreras", hubDesc: (name: string, n: number) => `${name}: ${n} carreras con recorrido, fecha, perfil de altitud y tabla de ritmos. Elige tu carrera y consigue tu plan de ritmo en Mila.`,
    guidesCrumb: "Guías",
  },
};

// ---- hubs

export type HubKind = "city" | "distance" | "month" | "country";
export const HUB_KINDS: HubKind[] = ["distance", "country", "city", "month"];
/** Each kind's folder under the language's race folder: /lopp/stad/umea/, /en/races/city/umea/, /de/laeufe/stadt/umea/. */
const HUB_DIR: Record<Lang, Record<HubKind, string>> = {
  sv: { city: "stad", distance: "distans", month: "manad", country: "land" },
  en: { city: "city", distance: "distance", month: "month", country: "country" },
  de: { city: "stadt", distance: "distanz", month: "monat", country: "land" },
  nb: { city: "by", distance: "distanse", month: "maned", country: "land" },
  da: { city: "by", distance: "distance", month: "maaned", country: "land" },
  fi: { city: "kaupunki", distance: "matka", month: "kuukausi", country: "maa" },
  fr: { city: "ville", distance: "distance", month: "mois", country: "pays" },
  es: { city: "ciudad", distance: "distancia", month: "mes", country: "pais" },
};
/** The distance classes: the common race distances (within a few hundred metres), every race past a marathon, and every trail race. */
export const DISTANCES: { key: string; test: (r: Pick<Race, "km" | "trail">) => boolean; slug: Record<Lang, string> }[] = [
  { key: "5k", test: (r) => r.km >= 4.5 && r.km <= 5.5, slug: { sv: "5-km", en: "5k", de: "5-km", nb: "5-km", da: "5-km", fi: "5-km", fr: "5-km", es: "5-km" } },
  { key: "10k", test: (r) => r.km >= 9.5 && r.km <= 10.5, slug: { sv: "10-km", en: "10k", de: "10-km", nb: "10-km", da: "10-km", fi: "10-km", fr: "10-km", es: "10-km" } },
  { key: "half", test: (r) => r.km >= 20.6 && r.km <= 21.7, slug: { sv: "halvmaraton", en: "half-marathon", de: "halbmarathon", nb: "halvmaraton", da: "halvmaraton", fi: "puolimaraton", fr: "semi-marathon", es: "media-maraton" } },
  { key: "marathon", test: (r) => r.km >= 41.7 && r.km <= 42.8, slug: { sv: "maraton", en: "marathon", de: "marathon", nb: "maraton", da: "maraton", fi: "maraton", fr: "marathon", es: "maraton" } },
  { key: "ultra", test: (r) => r.km > 42.8, slug: { sv: "ultra", en: "ultra", de: "ultra", nb: "ultra", da: "ultra", fi: "ultra", fr: "ultra", es: "ultra" } },
  { key: "trail", test: (r) => r.trail, slug: { sv: "trail", en: "trail", de: "trail", nb: "terrenglop", da: "trail", fi: "polkujuoksu", fr: "trail", es: "trail" } },
];
/** The fewest races a hub needs: fewer is a thin page, never made. */
export const HUB_MIN = 2;
export type Hub = { kind: HubKind; key: string; slug: Record<Lang, string>; name: Record<Lang, string>; races: Race[]; about?: string };
export const hubPath = (lang: Lang, h: Pick<Hub, "kind" | "slug">) => `${L[lang].dir}/${HUB_DIR[lang][h.kind]}/${h.slug[lang]}/`;
/** Country names that read better with an article after "in" (en) or "in"/"im" (de); in French the whole "au/aux/à …" where "en …" is wrong. */
const COUNTRY_IN: Partial<Record<Lang, Record<string, string>>> = {
  en: { US: "the United States", GB: "the United Kingdom", NL: "the Netherlands", PH: "the Philippines", AE: "the United Arab Emirates", CZ: "the Czech Republic" },
  de: { CH: "der Schweiz", NL: "den Niederlanden", US: "den USA", TR: "der Türkei", SK: "der Slowakei", PH: "den Philippinen", AE: "den Vereinigten Arabischen Emiraten" },
  fr: { DK: "au Danemark", PT: "au Portugal", LU: "au Luxembourg", LI: "au Liechtenstein", GB: "au Royaume-Uni", JP: "au Japon", CA: "au Canada", MX: "au Mexique",
    BR: "au Brésil", CL: "au Chili", PE: "au Pérou", MA: "au Maroc", KE: "au Kenya", NP: "au Népal", VN: "au Vietnam", US: "aux États-Unis", NL: "aux Pays-Bas",
    PH: "aux Philippines", AE: "aux Émirats arabes unis", MC: "à Monaco", SG: "à Singapour" },
};
/** "juni 2027" in a Swedish (Norwegian, Danish, Finnish, French, Spanish) sentence; English and German keep the capital ("June 2027", "Juni 2027"). */
const monthName = (ym: string, lang: Lang) => { const m = monthLabel(ym, lang); return lang !== "en" && lang !== "de" ? m.charAt(0).toLocaleLowerCase(LOCALE[lang]) + m.slice(1) : m; };
const addMonths = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number), t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };

/** Every hub with at least HUB_MIN races, in a stable order (kind, then key); the races in index order. */
export function buildHubs(active: Race[], today: string): Hub[] {
  const out: Hub[] = [], order = (rs: Race[]) => indexOrder(rs, today);
  for (const d of DISTANCES) {
    const rs = active.filter(d.test);
    if (rs.length >= HUB_MIN) out.push({ kind: "distance", key: d.key, slug: d.slug, name: Object.fromEntries(LANGS.map((l) => [l, S[l].distName[d.key]])) as Record<Lang, string>, races: order(rs), about: d.key });
  }
  // countries: by their code (or the register's own name); the slug from the country's name in each language
  const byCountry = new Map<string, Race[]>();
  for (const r of active) { const k = r.country_code ?? (r.country ? `x-${slugify(r.country)}` : ""); if (k) byCountry.set(k, [...(byCountry.get(k) ?? []), r]); }
  for (const [k, rs] of [...byCountry].sort(([a], [b]) => a.localeCompare(b))) {
    if (rs.length < HUB_MIN) continue;
    const nm = (l: Lang) => countryName(rs[0], l) ?? k, slug = Object.fromEntries(LANGS.map((l) => [l, slugify(nm(l)) || k.toLowerCase()])) as Record<Lang, string>;
    out.push({ kind: "country", key: k, slug, name: Object.fromEntries(LANGS.map((l) => [l, S[l].hubName.country(COUNTRY_IN[l]?.[k] ?? nm(l))])) as Record<Lang, string>, races: order(rs) });
  }
  // places: the place's name within its country; the same name in two countries gets the country's code in its address
  const byCity = new Map<string, Race[]>();
  for (const r of active) { const p = r.place ? slugify(r.place) : ""; if (p) { const k = `${r.country_code ?? r.country ?? ""}|${p}`; byCity.set(k, [...(byCity.get(k) ?? []), r]); } }
  const cities = [...byCity].filter(([, rs]) => rs.length >= HUB_MIN).sort(([a], [b]) => a.localeCompare(b));
  const seen = new Map<string, number>();
  for (const [k] of cities) { const p = k.split("|")[1]; seen.set(p, (seen.get(p) ?? 0) + 1); }
  for (const [k, rs] of cities) {
    const [cc, p] = k.split("|"), slug = seen.get(p)! > 1 && cc ? `${p}-${slugify(cc)}` : p, place = rs[0].place!;
    out.push({ kind: "city", key: k, slug: Object.fromEntries(LANGS.map((l) => [l, slug])) as Record<Lang, string>, name: Object.fromEntries(LANGS.map((l) => [l, S[l].hubName.city(place)])) as Record<Lang, string>, races: order(rs) });
  }
  // the coming twelve months, this one first
  for (let i = 0; i < 12; i++) {
    const ym = addMonths(today.slice(0, 7), i), rs = active.filter((r) => r.next_date && r.next_date >= today && r.next_date.startsWith(ym));
    if (rs.length >= HUB_MIN) out.push({ kind: "month", key: ym, slug: Object.fromEntries(LANGS.map((l) => [l, ym])) as Record<Lang, string>, name: Object.fromEntries(LANGS.map((l) => [l, S[l].hubName.month(monthName(ym, l))])) as Record<Lang, string>, races: order(rs) });
  }
  return out;
}

/** The hubs as links, grouped by kind (the index's "Hitta lopp", a hub's "Fler sätt att hitta lopp"); `skip` leaves one hub out. */
function hubNav(hubs: Hub[], lang: Lang, from: string, title: string, skip?: Hub): string {
  const s = S[lang], groups = HUB_KINDS.map((k) => [k, hubs.filter((h) => h.kind === k && h !== skip)] as const).filter(([, hs]) => hs.length);
  if (!groups.length) return "";
  return `<section aria-labelledby="h-browse"><h2 id="h-browse">${esc(title)}</h2>${groups.map(([k, hs]) => `<h3>${esc(s.browseKinds[k])}</h3><ul class="hubs">${hs.map((h) => `<li><a href="${esc(rel(from, hubPath(lang, h)))}">${esc(h.name[lang])}</a> <span class="note">(${h.races.length})</span></li>`).join("")}</ul>`).join("")}</section>`;
}

/** One hub page: a short intro from the races' own facts, the list with date, place, distance and climbing, and links on. */
export function hubPage(h: Hub, lang: Lang, ctx: Ctx): string {
  const t = T[lang], s = S[lang], path = hubPath(lang, h), today = ctx.today, rs = h.races;
  const alternates = Object.fromEntries(LANGS.map((l) => [l, hubPath(l, h)])) as Record<Lang, string>;
  const next = rs.find((r) => r.next_date && r.next_date >= today), climbs = rs.filter((r) => !courseless(r) || r.ascent > 0).map((r) => r.ascent);
  const intro = [s.hubIntro(rs.length), h.about ? s.distAbout[h.about] : "", next ? s.hubNext(dateShort(next.next_date!, lang), raceTitle(next, lang)) : "",
    climbs.length >= 2 ? s.hubClimb(num(Math.min(...climbs), lang), num(Math.max(...climbs), lang)) : ""].filter(Boolean).join(" ");
  const item = (r: Race) => `<li><a href="${esc(rel(path, racePath(lang, ctx.slugs.get(r.id)!)))}">${esc(raceTitle(r, lang))}</a><span>${esc([r.next_date && r.next_date >= today ? cap(dateLong(r.next_date, lang)) : t.noDateGroup, whereText(r, lang), kmText(r.km, lang), courseless(r) && !r.ascent ? null : `↑ ${num(r.ascent, lang)} m`].filter(Boolean).join(" · "))}</span></li>`;
  const hero = `<div class="race-hero"><div class="eyebrow">${esc(t.races)}</div><h1>${esc(h.name[lang])}</h1><p class="lead">${esc(intro)}</p><div class="ctas">${storeBadge(path, lang, ctx.appStore)}</div><p class="brandline">${esc(t.brandLine)}</p></div>`;
  const list = `<section aria-labelledby="h-list"><h2 id="h-list">${esc(t.count(rs.length))}</h2><ul class="list">${rs.map(item).join("")}</ul></section>`;
  const more = hubNav((ctx.hubs ?? []).filter((x) => x.kind !== "city" || x.races[0].country_code === rs[0].country_code), lang, path, s.hubMore, h);
  const back = `<section><p><a href="${esc(rel(path, indexPath(lang)))}">${esc(t.allRaces)}</a></p><p class="note">${esc(t.notAffiliatedAll)}</p></section>`;
  const ld = [crumbsLd([{ name: t.home, path: L[lang].home }, { name: t.races, path: indexPath(lang) }, { name: h.name[lang], path }]),
    { "@context": "https://schema.org", "@type": "ItemList", name: h.name[lang], numberOfItems: rs.length,
      itemListElement: rs.slice(0, 100).map((r, i) => ({ "@type": "ListItem", position: i + 1, url: abs(racePath(lang, ctx.slugs.get(r.id)!)), name: raceTitle(r, lang) })) }];
  return frame({ lang, path, title: `${h.name[lang]} – ${s.hubTail} | Mila`, description: s.hubDesc(h.name[lang], rs.length), css: ctx.css, today, alternates, appId: ctx.appId,
    og: { ...ctx.ogImage(null, lang), alt: h.name[lang] }, ld, body: `${hero}${list}${more}${back}`,
    crumbs: [{ name: t.home, path: L[lang].home }, { name: t.races, path: indexPath(lang) }, { name: h.name[lang] }] });
}

// ---- the race page's FAQ and pace table

/** The race page's questions and answers, from the data there is; the same text goes into the FAQPage markup. */
export function faqItems(r: Race, lang: Lang, today: string): { q: string; a: string }[] {
  const t = T[lang], s = S[lang], n = raceTitle(r, lang), out: { q: string; a: string }[] = [];
  if (r.next_date && r.next_date >= today) out.push({ q: s.qWhen(n), a: s.aWhen(n, dateLong(r.next_date, lang), r.prelim) });
  else if (r.next_date) out.push({ q: s.qWhen(n), a: s.aPassed(dateLong(r.next_date, lang)) });
  else out.push({ q: s.qWhen(n), a: s.aNoDate(r.past_dates.length ? dateShort(r.past_dates[r.past_dates.length - 1], lang) : null) });
  const starts = r.info?.starts ?? [];
  if (starts.length && r.next_date && r.next_date >= today) out.push({ q: s.qStart(n), a: s.aStart(starts.map((x) => `${x.label ? `${x.label}${cl(lang)}` : ""}${s.clock(x.time)}`).join(", ")) });
  const bare = courseless(r), k = kmText(r.km, lang);
  // a race without a course: the climb only as the organiser states it, never a word about a profile nobody has
  out.push({ q: s.qDist(n), a: bare ? (r.ascent ? s.aDistOrg(k, num(r.ascent, lang)) : s.aDistNoClimb(k)) : s.aDist(k, num(r.ascent, lang), r.descent !== null ? num(r.descent, lang) : null, r.max_ele !== null ? num(r.max_ele, lang) : null) });
  const climbs = [...r.climbs].sort((a, b) => a.km - b.km);
  if (!bare) {
    const big = [...r.climbs].sort((a, b) => b.gain - a.gain)[0], perKm = num(r.ascent / r.km, lang, r.ascent / r.km < 10 ? 1 : 0);
    out.push({ q: s.qCourse(n), a: s.aCourse(t.hilly[hilliness(r)], perKm, r.course ? isLoop(r.course.pts) : null, r.trail, big ? s.aClimbs(climbs.length, num(big.km, lang, 1), num(big.gain, lang), lenText(big.len, lang)) : s.aNoClimbs) });
  }
  if (r.aid_stations?.length) out.push({ q: s.qAid(n), a: s.aAid(r.aid_stations.length, r.aid_stations.map((x) => `${t.at(num(x.km, lang, 1))}${x.what.length ? ` (${x.what.map((w) => t.aidWords[w] ?? w).join(", ")})` : ""}`).join(sc(lang))) });
  const cuts = r.info?.cutoffs ?? [];
  if (cuts.length) out.push({ q: s.qCut(n), a: s.aCut(cuts.map((x) => `${t.at(num(x.km, lang, 1))}${cl(lang)}${x.clock ? t.clock(x.clock) : t.elapsed(Math.floor(x.elapsed_min! / 60), x.elapsed_min! % 60)}`).join(sc(lang))) });
  // pacing in general words: even effort, the climbs where they are; nothing of the coach's own way
  const hills = [...r.climbs].sort((a, b) => b.gain - a.gain).slice(0, 4).sort((a, b) => a.km - b.km).map((c) => t.at(num(c.km, lang, 1)));
  const listed = hills.length > 1 ? `${hills.slice(0, -1).join(", ")} ${s.and} ${hills[hills.length - 1]}` : hills.join("");
  out.push({ q: s.qPace(n), a: `${bare ? s.aPaceEven : hills.length && hilliness(r) >= 1 ? s.aPaceHills(listed) : `${s.aPaceEven} ${s.aPaceFlat(t.hilly[hilliness(r)])}`} ${s.aPaceTail}` });
  return out;
}

/** Target times for the pace table: the common ones for the classic distances, else round times from a spread of paces. Seconds. */
export function paceTargets(km: number): number[] {
  if (km >= 4.5 && km <= 5.5) return [20, 25, 30, 35].map((m) => m * 60);
  if (km >= 9.5 && km <= 10.5) return [40, 50, 60, 70].map((m) => m * 60);
  if (km >= 20.6 && km <= 21.7) return [90, 105, 120, 135].map((m) => m * 60);
  if (km >= 41.7 && km <= 42.8) return [180, 210, 240, 270].map((m) => m * 60);
  const round = (s: number) => { const u = s >= 3600 ? 900 : s >= 1200 ? 300 : 60; return Math.round(s / u) * u; };
  return [...new Set([300, 360, 420, 480].map((p) => round(p * km)))];
}
/** Where the splits fall: round kilometres (and halfway on a marathon), at most four before the finish. */
export function splitPoints(km: number): number[] {
  if (km >= 41.7 && km <= 42.8) return [10, 21.1, 30, 40];
  const stepKm = km <= 6 ? 1 : km <= 12 ? 2.5 : km <= 25 ? 5 : 10, out: number[] = [];
  for (let x = stepKm; x < km - stepKm * 0.4 && out.length < 4; x += stepKm) out.push(Math.round(x * 10) / 10);
  return out;
}
/** "4:59" (minutes and seconds) or "1:45:00". */
const paceText = (secPerKm: number) => { const s = Math.round(secPerKm); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export const finishText = (s: number) => clockTime(s);
/** The pace table: per target time the pace per km and the splits at even pace, arithmetic only. Races past 60 km get none (an even
 *  pace over an ultra says nothing useful). */
export function paceSection(r: Race, lang: Lang): string {
  if (r.km > 60) return "";
  const s = S[lang], t = T[lang], n = raceTitle(r, lang), splits = splitPoints(r.km);
  const rows = paceTargets(r.km).map((sec) => {
    const per = sec / r.km;
    return `<h3>${esc(s.paceRow(n, finishText(sec)))}</h3><p>${esc(`${paceText(per)} ${s.perKm}`)} · ${splits.map((k) => esc(`${t.at(num(k, lang, nearInt(k, 0.01) ? 0 : 1))}${cl(lang)}${clockTime(per * k)}`)).join(" · ")} · ${esc(`${s.finish}${cl(lang)}${finishText(sec)}`)}</p>`;
  }).join("");
  return `<section aria-labelledby="h-pace"><h2 id="h-pace">${esc(s.paceH)}</h2>${rows}<p class="note">${esc(s.paceNote)}</p></section>`;
}
/** The FAQ section and its FAQPage markup. */
export function faqSection(r: Race, lang: Lang, today: string): { html: string; ld: object } {
  const items = faqItems(r, lang, today);
  return {
    html: `<section aria-labelledby="h-faq" class="faq"><h2 id="h-faq">${esc(S[lang].faqH)}</h2>${items.map((x) => `<h3>${esc(x.q)}</h3><p>${esc(x.a)}</p>`).join("")}</section>`,
    ld: { "@context": "https://schema.org", "@type": "FAQPage", inLanguage: lang, mainEntity: items.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) },
  };
}

// ---- guides (drafts until Patrik approves them: only entries with "approved": true are ever rendered)

export type GuideBlock = { h?: string; p?: string; ul?: string[] };
export type GuideText = { title: string; description: string; blocks: GuideBlock[] };
export type Guide = { approved: boolean; slug: Partial<Record<Lang, string>>; updated?: string } & Partial<Record<Lang, GuideText>>;
const GUIDE_DIR: Record<Lang, string> = { sv: "guider", en: "en/guides", de: "de/ratgeber", nb: "nb/guider", da: "da/guides", fi: "fi/oppaat", fr: "fr/guides", es: "es/guias" };
export const guidePath = (lang: Lang, slug: string) => `${GUIDE_DIR[lang]}/${slug}/`;
/** The languages a guide can be published in: approved, with a text and a valid slug. */
export const guideLangs = (g: Guide): Lang[] => (g.approved === true ? LANGS.filter((l) => g[l]?.title && g[l]?.blocks?.length && typeof g.slug?.[l] === "string" && SLUG.test(g.slug[l]!)) : []);
/** One guide in one language: its text, then how Mila helps (the same call to action as the race pages). */
export function guidePage(g: Guide, lang: Lang, ctx: Ctx): string {
  const t = T[lang], doc = g[lang]!, path = guidePath(lang, g.slug[lang]!), langs = guideLangs(g);
  const alternates = Object.fromEntries(langs.map((l) => [l, guidePath(l, g.slug[l]!)])) as Partial<Record<Lang, string>>;
  const body = doc.blocks.map((b) => `${b.h ? `<h2>${esc(b.h)}</h2>` : ""}${b.p ? `<p>${esc(b.p)}</p>` : ""}${b.ul?.length ? `<ul>${b.ul.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`).join("");
  const cta = `<div class="ctabox"><h2>${esc(t.ctaH)}</h2><p class="sub">${esc(t.ctaText)}</p><div class="ctas">${storeBadge(path, lang, ctx.appStore)}</div><p class="brandline">${esc(t.brandLine)}</p></div>`;
  const ld = [{ "@context": "https://schema.org", "@type": "Article", headline: doc.title, description: doc.description, inLanguage: lang, url: abs(path),
    ...(g.updated && isDay(g.updated) ? { dateModified: g.updated } : {}), image: [ctx.ogImage(null, lang).image],
    author: { "@type": "Organization", name: "Mila", url: `${SITE}/` }, publisher: { "@type": "Organization", name: "Mila", url: `${SITE}/`, logo: { "@type": "ImageObject", url: `${SITE}/logo.png` } } },
    crumbsLd([{ name: t.home, path: L[lang].home }, { name: S[lang].guidesCrumb, path }, { name: doc.title, path }])];
  return frame({ lang, path, title: `${doc.title} | Mila`, description: doc.description, css: ctx.css, today: ctx.today, alternates, appId: ctx.appId,
    og: { ...ctx.ogImage(null, lang), alt: doc.title }, ld, body: `<article class="prose"><h1>${esc(doc.title)}</h1>${body}</article>${cta}`,
    crumbs: [{ name: t.home, path: L[lang].home }, { name: doc.title }] });
}

// ---- IndexNow: the key is public by design (the file at the root proves the site owns it); only changed addresses are sent

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** At most this many addresses a run (the rest are in the sitemap); IndexNow takes 10 000 a request. */
export const INDEXNOW_MAX = 2000;
export const isIndexNowKey = (k: unknown): k is string => typeof k === "string" && /^[a-f0-9]{32}$/.test(k);
/** Sends the changed addresses (only the site's own, at most INDEXNOW_MAX) to IndexNow; returns how many were sent and the answer. */
export async function indexNowPing(urls: string[], key: string, fetchFn: typeof fetch = fetch): Promise<{ sent: number; status: number | null }> {
  if (!isIndexNowKey(key)) throw new Error("indexnow: no valid key");
  const list = [...new Set(urls.map((u) => u.trim()).filter((u) => u.startsWith(`${SITE}/`) && !/[\s<>"']/.test(u)))].slice(0, INDEXNOW_MAX);
  if (!list.length) return { sent: 0, status: null };
  const res = await fetchFn(INDEXNOW_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${key}.txt`, urlList: list }), signal: AbortSignal.timeout(30_000) });
  await res.body?.cancel().catch(() => {});
  return { sent: list.length, status: res.status };
}

// ------------------------------------------------------------------------------------------------------------- sitemap and robots

/** The site's own pages in each language (alternates in the sitemap); any other page at the root is listed on its own. */
const STATIC_GROUPS: Record<Lang, string>[] = [
  { sv: "sv.html", en: "index.html", de: "index-de.html", nb: "index-nb.html", da: "index-da.html", fi: "index-fi.html", fr: "index-fr.html", es: "index-es.html" },
  { sv: "support-sv.html", en: "support.html", de: "support-de.html", nb: "support-nb.html", da: "support-da.html", fi: "support-fi.html", fr: "support-fr.html", es: "support-es.html" },
  { sv: "privacy.html", en: "privacy-en.html", de: "privacy-de.html", nb: "privacy-nb.html", da: "privacy-da.html", fi: "privacy-fi.html", fr: "privacy-fr.html", es: "privacy-es.html" },
  { sv: "terms.html", en: "terms-en.html", de: "terms-de.html", nb: "terms-nb.html", da: "terms-da.html", fi: "terms-fi.html", fr: "terms-fr.html", es: "terms-es.html" },
];
const staticUrl = (file: string) => (file === "index.html" ? `${SITE}/` : `${SITE}/${file}`);
export type SitemapEntry = { loc: string; lastmod?: string; alternates?: Record<string, string> };
export function sitemapXml(entries: SitemapEntry[]): string {
  const x = (e: SitemapEntry) => `<url><loc>${esc(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}${Object.entries(e.alternates ?? {}).map(([l, u]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(u)}"/>`).join("")}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.map(x).join("\n")}\n</urlset>\n`;
}
export const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`;

// ------------------------------------------------------------------------------------------------------------- the run

/** A retired slug as the map keeps it: a hash, never the name the slug spells. */
export async function slugHash(slug: string): Promise<string> { return (await sha(`retired-slug:${slug}`)).slice(0, 16); }
async function sha(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
}
/** A page's content for its lastmod: without the countdown and the footer's year, so a page counts as changed only when its facts did. */
const stable = (html: string) => html.replace(/<span class="cd"[^>]*>[^<]*<\/span>/g, "").replace(/© \d{4} Mila/, "");
async function readText(p: string): Promise<string | null> { try { return await Deno.readTextFile(p); } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; } }
async function readBytes(p: string): Promise<Uint8Array | null> { try { return await Deno.readFile(p); } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; } }
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Writes the race pages, the indexes, the share images, sitemap.xml, robots.txt and the slug map into `out` (the site's root). */
export async function generate(o: { out: string; races: Race[]; ids?: Set<string>; today: string; png?: PngRenderer | null; appStore?: string; allowMassRemoval?: boolean; log?: (s: string) => void;
  /** seo: the App Store id (Smart App Banner), the IndexNow key (its file at the root), the guides (only approved ones are rendered). */
  appStoreId?: string | null; indexNowKey?: string | null; guides?: Guide[] }): Promise<Report> {
  const out = o.out.replace(/\/+$/, ""), today = o.today, log = o.log ?? (() => {});
  const prev = await readText(`${out}/lopp/slugs.json`);
  const state: State = prev ? JSON.parse(prev) : { version: 1, races: {}, pages: {}, og: {} };
  state.races ??= {}; state.pages ??= {}; state.og ??= {}; state.retired ??= [];
  const feedIds = o.ids ?? new Set(o.races.map((r) => r.id)), usable = new Set(o.races.map((r) => r.id));
  const report: Report = { races: o.races.length, active: 0, removed: [], added: [], moved: [], written: 0, pngs: 0, changed: [], hubs: 0 };

  // 1. who left: published races the feed no longer names, and races it still names but whose row cleanRace refuses (their pages leave
  //    rather than stay up stale with facts the feed no longer stands behind). Many at once is a broken feed, not the register (or a feed
  //    whose rows no longer read), and nothing is written
  const published = Object.entries(state.races).filter(([, s]) => !s.removed);
  const gone = published.filter(([id]) => !usable.has(id));
  if (!o.allowMassRemoval && published.length && (feedIds.size === 0 || usable.size === 0 || (gone.length >= MASS_REMOVAL_MIN && gone.length > published.length * MASS_REMOVAL_SHARE))) {
    throw new Error(`race pages: the feed drops ${gone.length} of ${published.length} published races; nothing written (--allow-mass-removal accepts it)`);
  }
  // their pages, old addresses and share images are deleted below, and their names and slugs leave the map (a hash of each slug stays,
  // retired, so no later race takes the address); a race an older map kept as removed (with its name) goes the same way
  const leaving: string[] = [];
  for (const [id, s] of Object.entries(state.races)) {
    if (usable.has(id) && !gone.some(([g]) => g === id)) continue;
    if (!s.removed) report.removed.push(s.slug);
    for (const slug of [s.slug, ...(s.old ?? [])]) { leaving.push(slug); state.retired.push(await slugHash(slug)); }
    delete state.races[id];
  }
  const retired = new Set(state.retired);
  // 2. slugs: a race keeps its own; a new race with a course (or an official one whose organiser publishes none) gets the feed's
  //    suggestion, or one from its name without sponsors (pageSlug) when the suggestion starts with a sponsor, made unique among every slug
  //    in use and never a retired one. A published slug with a sponsor in front moves once to the name without it; the old one is kept as
  //    a page that sends the reader on (movedPage)
  const used = new Set(Object.values(state.races).flatMap((s) => [s.slug, ...(s.old ?? [])]));
  const free = async (base: string) => { let x = base; for (let i = 2; used.has(x) || retired.has(await slugHash(x)); i++) x = `${base}-${i}`; used.add(x); return x; };
  const baseOf = (r: Race) => { const own = r.slug && sponsorSlug(r.slug, r) ? pageSlug(r) : r.slug; return own && !RESERVED_SLUGS.has(own) ? own : `lopp-${r.id.slice(0, 8)}`; };
  const fresh = o.races.filter((r) => !state.races[r.id] && (r.course || courseless(r))).sort((a, b) => baseOf(a).localeCompare(baseOf(b)) || a.id.localeCompare(b.id));
  for (const r of fresh) {
    const slug = await free(baseOf(r));
    state.races[r.id] = { slug, name: r.name, first: today };
    report.added.push(slug);
  }
  const byId = new Map(o.races.map((r) => [r.id, r])), active: Race[] = [];
  for (const [id, s] of Object.entries(state.races)) {
    const r = byId.get(id);
    if (!r) continue;
    delete s.removed; s.name = r.name; active.push(r);
    if (sponsorSlug(s.slug, r)) {
      const own = pageSlug(r), base = own && !RESERVED_SLUGS.has(own) ? own : `lopp-${r.id.slice(0, 8)}`;
      s.old = [...new Set([...(s.old ?? []), s.slug])]; s.slug = await free(base); delete s.og;
      report.moved.push(s.slug);
    }
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
    if (o.png && (r.course || courseless(r))) {
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
  // seo: the hubs, and the races whose page title another race's would repeat (their titles add the place)
  const hubs = buildHubs(active, today), titles = new Map<string, string[]>();
  for (const r of active) { const k = pageTitle(r, "sv"); titles.set(k, [...(titles.get(k) ?? []), r.id]); }
  const titleClash = new Set([...titles.values()].filter((ids) => ids.length > 1).flat());
  const ctx: Ctx = { today, css, appStore, active, slugs, ogImage, sceneJs: await exists("scene.js"), appId: smartBannerMeta(o.appStoreId) ? o.appStoreId : null, hubs, titleClash };

  // 4. the race pages, and the pages of races that left; every indexed page's lastmod moves only when its content does
  const pages: State["pages"] = {};
  const track = async (path: string, html: string) => {
    const h = await sha(stable(html)), was = state.pages[path];
    pages[path] = { hash: h, lastmod: was && was.hash === h ? was.lastmod : today };
    if (!was || was.hash !== h) report.changed.push(path.startsWith("/") ? staticUrl(path.slice(1)) : abs(path));
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
  // a race's old addresses send the reader on (their share image goes); the pages of races that left are deleted, every language and
  // their share images, so the host answers "not found" with no name
  for (const s of Object.values(state.races)) {
    for (const old of s.old ?? []) {
      for (const lang of LANGS) await put(`${racePath(lang, old)}index.html`, movedPage(old, s.slug, lang, ctx));
      if (await exists(ogPath(old))) { await Deno.remove(`${out}/${ogPath(old)}`); written++; }
    }
  }
  for (const slug of leaving) {
    for (const lang of LANGS) {
      const dir = `${out}/${racePath(lang, slug)}`.replace(/\/$/, "");
      try { await Deno.remove(dir, { recursive: true }); written++; report.changed.push(abs(racePath(lang, slug))); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
    }
  }
  // seo: the hubs, every language; a hub folder that is no longer a hub (below two races, a month gone by) is deleted
  const hubEntries: SitemapEntry[] = [], keepHub = new Set<string>();
  for (const h of hubs) {
    const alt = Object.fromEntries([...LANGS.map((l) => [l, abs(hubPath(l, h))]), ["x-default", abs(hubPath("en", h))]]);
    for (const lang of LANGS) {
      const html = hubPage(h, lang, ctx), path = hubPath(lang, h);
      keepHub.add(path);
      await put(`${path}index.html`, html);
      hubEntries.push({ loc: abs(path), lastmod: await track(path, html), alternates: alt });
    }
  }
  report.hubs = hubs.length;
  for (const lang of LANGS) for (const kind of HUB_KINDS) {
    const base = `${L[lang].dir}/${HUB_DIR[lang][kind]}`;
    try {
      for await (const e of Deno.readDir(`${out}/${base}`)) {
        if (!e.isDirectory || keepHub.has(`${base}/${e.name}/`)) continue;
        await Deno.remove(`${out}/${base}/${e.name}`, { recursive: true }); written++; report.changed.push(abs(`${base}/${e.name}/`));
      }
    } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  }
  // seo: the approved guides (none until Patrik approves the drafts); a guide no longer approved leaves
  const guideEntries: SitemapEntry[] = [], keepGuide = new Set<string>();
  for (const g of o.guides ?? []) {
    const langs = guideLangs(g);
    const alt = langs.length > 1 ? Object.fromEntries([...langs.map((l) => [l, abs(guidePath(l, g.slug[l]!))]), ["x-default", abs(guidePath(langs.includes("en") ? "en" : langs[0], g.slug[langs.includes("en") ? "en" : langs[0]]!))]]) : undefined;
    for (const lang of langs) {
      const html = guidePage(g, lang, ctx), path = guidePath(lang, g.slug[lang]!);
      keepGuide.add(path);
      await put(`${path}index.html`, html);
      guideEntries.push({ loc: abs(path), lastmod: await track(path, html), alternates: alt });
    }
  }
  for (const lang of LANGS) {
    try {
      for await (const e of Deno.readDir(`${out}/${GUIDE_DIR[lang]}`)) {
        if (!e.isDirectory || keepGuide.has(`${GUIDE_DIR[lang]}/${e.name}/`)) continue;
        await Deno.remove(`${out}/${GUIDE_DIR[lang]}/${e.name}`, { recursive: true }); written++; report.changed.push(abs(`${GUIDE_DIR[lang]}/${e.name}/`));
      }
    } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
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
  await put("sitemap.xml", sitemapXml([...staticEntries, ...indexEntries, ...hubEntries, ...guideEntries, ...raceEntries]));
  await put("robots.txt", ROBOTS);
  // seo: IndexNow's key file at the root (the key is public by design)
  if (isIndexNowKey(o.indexNowKey)) await put(`${o.indexNowKey}.txt`, o.indexNowKey);
  // 7. the slug map, sorted, so it only changes when something did
  state.pages = Object.fromEntries(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b)));
  state.races = Object.fromEntries(Object.entries(state.races).sort(([, a], [, b]) => a.slug.localeCompare(b.slug)));
  state.og = Object.fromEntries(Object.entries(state.og).sort(([a], [b]) => a.localeCompare(b)));
  state.retired = [...new Set(state.retired)].sort();
  await put("lopp/slugs.json", JSON.stringify(state, null, 1) + "\n");
  // 8. the app's map (package dela): which races have a page and their slug, so the app shares a race's page only when it is published
  await put("lopp/app.json", appMap(state));
  report.written = written;
  return report;
}

/** lopp/app.json, what the app reads before it offers a register race's page to share (MomentShare.swift RacePageLinks): every race on
 *  the site with its slug, nothing else (no names, no hashes, no pages), sorted, so it changes only when a page comes or goes. */
export function appMap(state: Pick<State, "races">): string {
  const races = Object.fromEntries(Object.entries(state.races).filter(([, s]) => !s.removed && s.slug).sort(([a], [b]) => a.localeCompare(b)).map(([id, s]) => [id, { slug: s.slug }]));
  return JSON.stringify({ version: 1, races }) + "\n";
}

/** race_pages.json next to this script (published as tools/race_pages.json): the App Store link and id, and the IndexNow key. */
export async function siteConfig(file = new URL("./race_pages.json", import.meta.url)): Promise<{ appStoreId: string | null; indexNowKey: string | null }> {
  try {
    const c = JSON.parse(await Deno.readTextFile(file));
    return { appStoreId: smartBannerMeta(String(c?.appStoreId ?? "")) ? String(c.appStoreId) : null, indexNowKey: isIndexNowKey(c?.indexNowKey) ? c.indexNowKey : null };
  } catch { return { appStoreId: null, indexNowKey: null }; }
}
/** The guides' data file next to this script (race_pages_guides.json: a list of Guide); none when it is not there. Only entries with
 *  "approved": true ever become pages. */
export async function configuredGuides(file = new URL("./race_pages_guides.json", import.meta.url)): Promise<Guide[]> {
  try { const g = JSON.parse(await Deno.readTextFile(file)); return Array.isArray(g) ? g.filter((x) => x && typeof x === "object") : []; } catch { return []; }
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
    const cfg = await siteConfig();
    // the workflow's last step: send the addresses the build changed to IndexNow (--indexnow-ping <file>, one address a line)
    const ping = opt("--indexnow-ping");
    if (ping) {
      if (!cfg.indexNowKey) { console.log("indexnow: no key in race_pages.json"); Deno.exit(0); }
      const urls = (await readText(ping) ?? "").split("\n").filter(Boolean);
      const r = await indexNowPing(urls, cfg.indexNowKey);
      console.log(`indexnow: ${r.sent} addresses${r.status === null ? "" : `, answer ${r.status}`}`);
      Deno.exit(0);
    }
    const feed = await readFeed(opt("--feed") ?? FEED_URL);
    const png = args.includes("--no-png") ? null : await resvgRenderer();
    const r = await generate({ out, races: feed.races, ids: feed.ids, today, png, appStore: await configuredAppStore(), allowMassRemoval: args.includes("--allow-mass-removal"), log: console.warn,
      appStoreId: cfg.appStoreId, indexNowKey: cfg.indexNowKey, guides: await configuredGuides() });
    // the changed addresses for the IndexNow step (--changed <file>: outside what the workflow commits)
    const changed = opt("--changed");
    if (changed) await Deno.writeTextFile(changed, r.changed.join("\n") + (r.changed.length ? "\n" : ""));
    console.log(`race pages: ${r.active} races (${r.races} in the feed), ${r.added.length} new, ${r.moved.length} moved, ${r.removed.length} removed, ${r.hubs} hubs, ${r.pngs} images, ${r.written} files written, ${r.changed.length} changed`);
  } catch (e) {
    console.error(String(e));
    Deno.exit(1);
  }
}
