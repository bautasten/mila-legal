// Place-based scenes as SVG for the web: the race pages' hero background and the backdrop of their share image (og.png, through
// resvg). The same pictures as the app's share cards (Mila/Share/SceneGenerator.swift, itself the family of the app's weather
// backdrops in make_backdrops.swift): a Nordic scene of sky, sun or moon, the course's own elevation profile as the farthest ridge,
// spruce and pine, birches, a winding gravel trail, out of focus like a photo with a shallow depth of field (feGaussianBlur per layer),
// a little film grain (feTurbulence). Same spec, same seed hash and random stream, same palettes and the same big choices as the app;
// the details are drawn more sparingly so the SVG stays small (about 60–150 kB, much less gzipped).
//
// Pure: no I/O, no globals, deterministic per spec. `sceneSvg` gives a whole <svg>; `sceneLayers` its defs and body for embedding in
// another SVG (the share image); `raceSceneSpec` classifies a race from the feed's public facts (rules below, as in the app's
// SceneClassifier.swift where the facts are the same).
//
// Coordinates: every scene is drawn in units where the picture is 1300 high and as wide as the format asks (a 1200 × 630 share image
// is 2476 wide), y downwards; the viewBox maps that to the pixels.

export type Landscape = "forest" | "mountain" | "lake" | "coast" | "city" | "field";
export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
export type Weather = "clear" | "cloudy" | "rain" | "snow" | "fog";
export type Season = "spring" | "summer" | "autumn" | "lateAutumn" | "winter";
export type SceneSpec = {
  landscape: Landscape;
  /** The elevation profile resampled, smoothed and scaled 0 (lowest) … 1 (highest) by makeProfile; empty: a ridge from the seed. */
  profile: number[];
  /** Metres between the profile's lowest and highest point: how tall the ridge stands. */
  relief: number;
  time: TimeOfDay;
  weather: Weather;
  season: Season;
  /** Snow on the ground and the branches. */
  snowCover: boolean;
  seed: number;
};

// ------------------------------------------------------------------------------------------------------------- seed and randomness

/** The seed for an id (a race's id): FNV-1a over its UTF-8 bytes, the same as SceneSpec.seed in the app. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (const b of new TextEncoder().encode(id)) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** mulberry32, the same stream as SceneRNG in the app. */
export class Rng {
  s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), this.s | 1) >>> 0;
    t = ((t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  r(a: number, b: number): number { return a + (b - a) * this.next(); }
  pick<T>(a: T[]): T { return a[Math.floor(this.next() * a.length) % a.length]; }
}

// ------------------------------------------------------------------------------------------------------------- the profile

/** A moving average over ±half samples (fewer at the ends). */
export function smooth(v: number[], half: number): number[] {
  if (v.length <= 2) return v.slice();
  return v.map((_, i) => {
    const a = Math.max(0, i - half), b = Math.min(v.length - 1, i + half);
    let s = 0;
    for (let k = a; k <= b; k++) s += v[k];
    return s / (b - a + 1);
  });
}

/** The horizon from an elevation profile, as in the app: `count` points evenly over the distance (`distances` in metres, else evenly
 *  spaced samples), smoothed twice over about 1/16 of the route, scaled 0 … 1. Fewer than two values: none; under a metre of relief:
 *  a flat line at 0.5. */
export function makeProfile(elevations: number[], distances?: number[] | null, count = 64): { profile: number[]; relief: number } {
  const pts: [number, number][] = [];
  elevations.forEach((e, i) => { if (Number.isFinite(e)) pts.push([distances && Number.isFinite(distances[i]) ? distances[i] : i, e]); });
  if (pts.length < 2 || count < 2) return { profile: [], relief: 0 };
  pts.sort((a, b) => a[0] - b[0]);
  const d0 = pts[0][0], d1 = pts[pts.length - 1][0];
  let even: number[] = new Array(count).fill(0);
  if (d1 - d0 <= 0) { const m = pts.reduce((s, p) => s + p[1], 0) / pts.length; even = even.map(() => m); }
  else {
    let j = 0;
    for (let i = 0; i < count; i++) {
      const d = d0 + ((d1 - d0) * i) / (count - 1);
      while (j < pts.length - 2 && pts[j + 1][0] < d) j++;
      const a = pts[j], b = pts[j + 1], f = b[0] > a[0] ? Math.min(1, Math.max(0, (d - a[0]) / (b[0] - a[0]))) : 0;
      even[i] = a[1] + (b[1] - a[1]) * f;
    }
  }
  const half = Math.max(1, Math.floor(count / 32));
  for (let k = 0; k < 2; k++) even = smooth(even, half);
  const lo = Math.min(...even), hi = Math.max(...even), relief = hi - lo;
  if (relief < 1) return { profile: new Array(count).fill(0.5), relief };
  return { profile: even.map((e) => (e - lo) / relief), relief };
}
function profileAt(p: number[], t: number): number | null {
  if (p.length === 0) return null;
  if (p.length === 1) return p[0];
  const x = Math.min(1, Math.max(0, t)) * (p.length - 1), i = Math.min(p.length - 2, Math.floor(x)), f = x - i;
  return p[i] * (1 - f) + p[i + 1] * f;
}

// ------------------------------------------------------------------------------------------------------------- classification

/** The sun's height in degrees at `ms` seen from (lat, lon), and whether it is before solar noon (as SceneSun in the app). */
export function sunPosition(ms: number, lat: number, lon: number): { elevation: number; morning: boolean } {
  const rad = Math.PI / 180, d = ms / 864e5 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)), dec = Math.asin(Math.sin(e) * Math.sin(l));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  let ha = (gmst * 15 + lon) * rad - ra;
  ha = Math.atan2(Math.sin(ha), Math.cos(ha));
  const alt = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha));
  return { elevation: alt / rad, morning: ha < 0 };
}
/** night below −6°, dawn or dusk below 8°, else day. */
export function timeOfDay(ms: number, lat: number, lon: number): TimeOfDay {
  const s = sunPosition(ms, lat, lon);
  return s.elevation < -6 ? "night" : s.elevation < 8 ? (s.morning ? "dawn" : "dusk") : "day";
}
/** The season of a month (1–12) at a latitude, as in the app: spring Mar–May, summer Jun–Aug, autumn Sep–Oct, late autumn Nov,
 *  winter Dec–Feb; north of 63° winter Nov–Apr, spring May, summer Jun–Aug, autumn Sep, late autumn Oct; six months on in the south. */
export function seasonOf(month: number, lat: number | null): Season {
  let m = month;
  if (lat !== null && lat < 0) m = ((m + 5) % 12) + 1;
  if (Math.abs(lat ?? 59) >= 63) return m === 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m === 9 ? "autumn" : m === 10 ? "lateAutumn" : "winter";
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m === 9 || m === 10 ? "autumn" : m === 11 ? "lateAutumn" : "winter";
}
/** Snow on the ground: when it falls; in winter unless known to be mild, and without a temperature in the fjäll and north of 57°. */
export function snowCoverOf(season: Season, weather: Weather, lat: number | null, landscape: Landscape, temperature?: number | null): boolean {
  if (weather === "snow") return true;
  if (season !== "winter") return false;
  if (temperature !== undefined && temperature !== null) return temperature <= (landscape === "mountain" ? 6 : 2);
  return landscape === "mountain" || Math.abs(lat ?? 60) >= 57;
}

const metres = (a: number[], b: number[]) => {
  const r = 6371000, la1 = (a[0] * Math.PI) / 180, la2 = (b[0] * Math.PI) / 180, dla = la2 - la1, dlo = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
};
/** Turns of 45° or more per km, the track walked in `leg` metre steps (as SceneRoute.turnsPerKm in the app); null under 500 m. */
export function turnsPerKm(track: number[][], leg = 50): number | null {
  if (track.length < 3) return null;
  const pts = [track[0]];
  let acc = 0, total = 0;
  for (let i = 1; i < track.length; i++) { const d = metres(track[i - 1], track[i]); acc += d; total += d; if (acc >= leg) { pts.push(track[i]); acc = 0; } }
  if (total < 500 || pts.length < 3) return null;
  const bearing = (a: number[], b: number[]) => (Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI;
  const bs = pts.slice(1).map((p, i) => bearing(pts[i], p));
  let turns = 0, i = 1;
  while (i < bs.length) {
    let d = Math.abs(bs[i] - bs[i - 1]) % 360;
    if (d > 180) d = 360 - d;
    if (d >= 45) { turns++; i += 2; } else i++;
  }
  return turns / (total / 1000);
}

/** What a race page knows about a race (a subset of race_pages.ts's Race, the feed's public facts). */
export type SceneRace = {
  id: string; name: string; place: string | null; next_date: string | null; past_dates?: string[]; km: number; ascent: number; trail: boolean;
  max_ele: number | null; start: [number, number] | null; course: { pts: number[][] } | null;
  info?: { starts?: { time: string; main?: boolean }[] } | null;
};
export const MOUNTAIN_ELEVATION = 700, MOUNTAIN_CLIMB_PER_KM = 40, FLAT_CLIMB_PER_KM = 8, CITY_TURNS_PER_KM = 1.5, STRAIGHT_TURNS_PER_KM = 1.0;
const COAST_WORDS = /(kust|coast|küste|\bhav\b|havet|strand|beach|skärgård|archipelago|fjord|\bsea\b|\bmeer\b|seaside|udde)/i;
const LAKE_WORDS = /(sjö|lake|\bsee\b|\bloch\b|järvi|innsjø|\bvatn\b|\bvann\b|sø\b)/i;

/** A race's landscape, from the feed alone (the first rule that holds wins):
 *  1. mountain: the course reaches above 700 m, or climbs at least 40 m per km;
 *  2. a trail race is in the forest;
 *  3. water only when the name or the place says so: coast for kust/coast/küste/hav/strand/skärgård/fjord/sea…, lake for
 *     sjö/lake/see/järvi/vatn… (the feed has no map, and a guess would put lakes where there are none);
 *  4. a flat road race (under 8 m per km) is a town's streets and parks (city), unless its course runs straight (under 1 turn per
 *     km): then a road between fields;
 *  5. otherwise forest. */
export function raceLandscape(r: SceneRace): Landscape {
  const pts = r.course?.pts ?? [];
  const maxE = r.max_ele ?? (pts.length ? Math.max(...pts.map((p) => p[2])) : 0);
  const perKm = r.km > 0 ? r.ascent / r.km : 0;
  if (maxE > MOUNTAIN_ELEVATION || perKm >= MOUNTAIN_CLIMB_PER_KM) return "mountain";
  if (r.trail) return "forest";
  const words = `${r.name} ${r.place ?? ""}`;
  if (COAST_WORDS.test(words)) return "coast";
  if (LAKE_WORDS.test(words)) return "lake";
  if (perKm < FLAT_CLIMB_PER_KM) {
    const t = pts.length ? turnsPerKm(pts) : null;
    return t !== null && t < STRAIGHT_TURNS_PER_KM ? "field" : "city";
  }
  return "forest";
}

/** The start's moment: `startIso` when the caller has it with its offset (race_pages' startDate), else the main start's clock on
 *  the race day at an offset guessed from the longitude (and summer time in Europe), else midday. */
function raceStartMs(r: SceneRace, day: string, startIso?: string | null): number {
  if (startIso && /T\d\d:\d\d/.test(startIso)) { const ms = Date.parse(startIso); if (Number.isFinite(ms)) return ms; }
  const s = r.info?.starts ?? [], main = s.find((x) => x.main) ?? (s.length === 1 ? s[0] : undefined);
  const clock = main && /^\d\d:\d\d$/.test(main.time) ? main.time : "12:00";
  const lon = r.start?.[1] ?? 15, lat = r.start?.[0] ?? 60, m = Number(day.slice(5, 7));
  const dst = lat > 35 && lon > -25 && lon < 45 && m >= 4 && m <= 10 ? 1 : 0;
  return Date.parse(`${day}T${clock}:00Z`) - (Math.round(lon / 15) + dst) * 3600e3;
}

/** The scene of a race page: its landscape, its course's profile, the light at its start, the season of its date, clear weather
 *  (a race page cannot know the day's weather). */
export function raceSceneSpec(r: SceneRace, o: { startIso?: string | null; today?: string; weather?: Weather } = {}): SceneSpec {
  const pts = r.course?.pts ?? [];
  const { profile, relief } = makeProfile(pts.map((p) => p[2]), pts.map((p) => p[3] * 1000));
  const landscape = raceLandscape(r);
  const day = r.next_date ?? r.past_dates?.[r.past_dates.length - 1] ?? o.today ?? new Date().toISOString().slice(0, 10);
  const lat = r.start?.[0] ?? (pts.length ? pts[0][0] : null), lon = r.start?.[1] ?? (pts.length ? pts[0][1] : null);
  const time = lat !== null && lon !== null ? timeOfDay(raceStartMs(r, day, o.startIso), lat, lon) : "day";
  const season = seasonOf(Number(day.slice(5, 7)), lat), weather = o.weather ?? "clear";
  return { landscape, profile, relief, time, weather, season, snowCover: snowCoverOf(season, weather, lat, landscape), seed: seedOf(r.id) };
}

// ------------------------------------------------------------------------------------------------------------- colours

const mix = (a: number, b: number, t: number) => {
  const ch = (v: number, s: number) => (v >> s) & 255;
  const m = (s: number) => Math.max(0, Math.min(255, Math.round(ch(a, s) * (1 - t) + ch(b, s) * t))) << s;
  return (m(16) | m(8) | m(0)) >>> 0;
};
const hex = (c: number) => `#${(c >>> 0).toString(16).padStart(6, "0")}`;

type CloudKind = "none" | "cumulus" | "stratus" | "streak";
type Clouds = { kind: CloudKind; n: number; light: number; shade: number; alpha: number; top: number; bottom: number };
type Palette = {
  sky: [number, number][]; sun: { glow: number; color: number; alpha: number; disk: number } | null; rays: boolean; moon: boolean; stars: number;
  clouds: Clouds; hills: [number, number]; haze: [number, number]; forest: { far: number; mid: number; near: number };
  lit: { color: number; alpha: number; side: number } | null; ground: [number, number]; tex: [number, number]; grass: number;
  path: [number, number]; wear: number; leaves: number[]; crowns: number[]; bark: number; light: [number, number];
  fog: number; mist: number; vignette: number;
  water: { far: number; near: number }; rock: [number, number]; snowTone: number; warm: number; crop: [number, number];
  barn: { wall: number; trim: number; roof: number };
};
const NO_CLOUDS: Clouds = { kind: "none", n: 0, light: 0, shade: 0, alpha: 0, top: 0, bottom: 0 };
function base(p: Partial<Palette> & Pick<Palette, "sky" | "hills" | "haze" | "forest" | "ground" | "tex" | "grass" | "path" | "wear">): Palette {
  return { sun: null, rays: false, moon: false, stars: 0, clouds: NO_CLOUDS, lit: null, leaves: [], crowns: [], bark: 0xE9ECE6, light: [0xFFFFFF, 0],
    fog: 0, mist: 0, vignette: 0.16, water: { far: 0, near: 0 }, rock: [0, 0], snowTone: 0xF4F8FC, warm: 0xFFD9A0, crop: [0, 0],
    barn: { wall: 0, trim: 0, roof: 0 }, ...p };
}
// the backdrops' eight palettes (make_backdrops.swift), as in SceneGenerator.swift
const PAL: Record<string, Palette> = {
  clearMorning: base({ sky: [[0, 0x8296BA], [0.38, 0xB4ADC4], [0.7, 0xEBC3A8], [1, 0xF8D7A8]], sun: { glow: 520, color: 0xFFDDA4, alpha: 0.95, disk: 20 }, rays: true,
    clouds: { kind: "streak", n: 7, light: 0xF8D4C0, shade: 0xB79AAF, alpha: 0.45, top: 0.08, bottom: 0.36 },
    hills: [0xC0A6A8, 0xA48E92], haze: [0xF5D2AA, 0.5], forest: { far: 0x75656A, mid: 0x4A514D, near: 0x353C39 }, lit: { color: 0xF2B072, alpha: 0.42, side: 1 },
    ground: [0x8C7A5C, 0x535A44], tex: [0xCFAA78, 0x2E3528], grass: 0x6F7A4A, path: [0xE8C493, 0x9E8466], wear: 0xFFE2B8,
    leaves: [0xB8B56A, 0xD3C27C, 0x8E9C58, 0xE0C98A], bark: 0xF2E4D4, light: [0xA06C68, 0.45], mist: 0.28 }),
  clearDay: base({ sky: [[0, 0x4C87CF], [0.55, 0x88B7E3], [1, 0xD2E5EF]], sun: { glow: 320, color: 0xFFFDF2, alpha: 0.8, disk: 16 },
    clouds: { kind: "cumulus", n: 5, light: 0xFBFDFF, shade: 0xB4C5D8, alpha: 0.72, top: 0.09, bottom: 0.36 },
    hills: [0x93B3B8, 0x739A93], haze: [0xD2E5EF, 0.4], forest: { far: 0x52795C, mid: 0x3B6543, near: 0x2F5336 }, lit: { color: 0x9CC466, alpha: 0.3, side: 1 },
    ground: [0x6F9148, 0x46663A], tex: [0x9DB866, 0x26401E], grass: 0x4E7430, path: [0xE6DABF, 0xC2AF8A], wear: 0xF4ECD8,
    leaves: [0x86B44E, 0xA9CD63, 0x5F903A, 0xC4DD7C] }),
  cloudy: base({ sky: [[0, 0x8592A2], [0.6, 0xA9B3BE], [1, 0xC5CCD3]], clouds: { kind: "stratus", n: 16, light: 0xD3D9DF, shade: 0x7C8898, alpha: 0.5, top: 0, bottom: 0.42 },
    hills: [0x9AA5A7, 0x86928F], haze: [0xC5CCD3, 0.42], forest: { far: 0x6A796C, mid: 0x52625A, near: 0x435048 },
    ground: [0x7F8D72, 0x5A6750], tex: [0xA4AF8E, 0x384432], grass: 0x5F6E4C, path: [0xBAB6A8, 0x8E897B], wear: 0xD0CCBF,
    leaves: [0x7E9460, 0x92A670, 0x6A8250], light: [0x8F8A9C, 0.45] }),
  rain: base({ sky: [[0, 0x55616E], [0.6, 0x74808C], [1, 0x95A0A9]], clouds: { kind: "stratus", n: 18, light: 0x8A95A1, shade: 0x414B57, alpha: 0.5, top: 0, bottom: 0.44 },
    hills: [0x808C90, 0x6C797C], haze: [0x95A0A9, 0.6], forest: { far: 0x5A6760, mid: 0x415048, near: 0x34403A },
    ground: [0x55604E, 0x3A4439], tex: [0x77846B, 0x212922], grass: 0x46553F, path: [0x77766E, 0x403D38], wear: 0x8E949A,
    leaves: [0x6E8456, 0x7F9464, 0x5C7448], bark: 0xC9CFCC, light: [0x404858, 0.5], mist: 0.18 }),
  snow: base({ sky: [[0, 0x9AAFC8], [0.6, 0xC4D2E2], [1, 0xE4EBF3]], sun: { glow: 380, color: 0xFFF6E8, alpha: 0.4, disk: 0 },
    clouds: { kind: "stratus", n: 10, light: 0xEEF2F6, shade: 0xA9B7C6, alpha: 0.4, top: 0.02, bottom: 0.38 },
    hills: [0xC6D2DE, 0xB0C0CF], haze: [0xE4EBF3, 0.5], forest: { far: 0x7A8A9C, mid: 0x56676E, near: 0x48575E },
    ground: [0x8C9A84, 0x5E6B58], tex: [0xB4BEB0, 0x3E4A3C], grass: 0x6E7C6A, path: [0xC9CCC6, 0x9EA39C], wear: 0xDADDD8,
    leaves: [0x9AA58C], bark: 0xE4E8EC, light: [0xC4D2E2, 0.35], vignette: 0.1 }),
  fog: base({ sky: [[0, 0xB9C0C3], [0.7, 0xD1D5D5], [1, 0xDBDDDB]], sun: { glow: 380, color: 0xF4F3EE, alpha: 0.45, disk: 0 },
    hills: [0xCCD0CE, 0xC2C7C4], haze: [0xDBDDDB, 0.8], forest: { far: 0xA8B0AB, mid: 0x7F8B83, near: 0x66736B },
    ground: [0xAAB1A4, 0x7A8475], tex: [0xC2C7BA, 0x667060], grass: 0x7A8770, path: [0xCFD0C6, 0xA6A79B], wear: 0xDCDCD3,
    leaves: [0x9AA58C, 0xA8B098], bark: 0xC9CCC6, light: [0xDCDCE0, 0.55], fog: 0.3, mist: 0.5, vignette: 0.08 }),
  dusk: base({ sky: [[0, 0x2E2F5E], [0.4, 0x6C4D80], [0.75, 0xCE7969], [1, 0xF0A262]], sun: { glow: 460, color: 0xFFB46A, alpha: 0.9, disk: 0 },
    clouds: { kind: "streak", n: 7, light: 0xF29C82, shade: 0x553E6E, alpha: 0.5, top: 0.1, bottom: 0.4 },
    hills: [0x7C5569, 0x5D4359], haze: [0xE8986A, 0.32], forest: { far: 0x3E2E46, mid: 0x221E2B, near: 0x16141C }, lit: { color: 0xF0A070, alpha: 0.16, side: -1 },
    ground: [0x3C3038, 0x1A1820], tex: [0x6A4E52, 0x120F16], grass: 0x2E2830, path: [0xA8715F, 0x3E3040], wear: 0xD08E70,
    leaves: [0x6A5A52, 0x7E6A58, 0x5A4A4A], bark: 0xB89C9C, light: [0x2A1E2E, 0.72] }),
  night: base({ sky: [[0, 0x081022], [0.6, 0x111B36], [1, 0x1F2C4C]], moon: true, stars: 150,
    clouds: { kind: "streak", n: 4, light: 0x2C3A5E, shade: 0x0C1326, alpha: 0.35, top: 0.22, bottom: 0.42 },
    hills: [0x18213F, 0x131B35], haze: [0x223050, 0.3], forest: { far: 0x10172C, mid: 0x0B1120, near: 0x080C17 }, lit: { color: 0x6A80B0, alpha: 0.16, side: 1 },
    ground: [0x161D31, 0x090D18], tex: [0x28324E, 0x05070E], grass: 0x111829, path: [0x2A3550, 0x141A2C], wear: 0x37456A,
    leaves: [0x151D36, 0x1B2440, 0x111830], bark: 0x5A6680, light: [0x0E1428, 0.88], vignette: 0.1 }),
};
function skyAt(p: Palette, t: number): number {
  const i = p.sky.findIndex((s) => s[0] >= t);
  if (i < 0) return p.sky[p.sky.length - 1][1];
  if (i === 0) return p.sky[0][1];
  const a = p.sky[i - 1], b = p.sky[i];
  return mix(a[1], b[1], (t - a[0]) / Math.max(0.0001, b[0] - a[0]));
}
function blend(a: Palette, b: Palette, t: number): Palette {
  const m = (x: number, y: number) => mix(x, y, t);
  return { ...a, sky: [0, 0.4, 0.75, 1].map((s) => [s, m(skyAt(a, s), skyAt(b, s))] as [number, number]),
    hills: [m(a.hills[0], b.hills[0]), m(a.hills[1], b.hills[1])], haze: [m(a.haze[0], b.haze[0]), a.haze[1] + (b.haze[1] - a.haze[1]) * t],
    forest: { far: m(a.forest.far, b.forest.far), mid: m(a.forest.mid, b.forest.mid), near: m(a.forest.near, b.forest.near) },
    ground: [m(a.ground[0], b.ground[0]), m(a.ground[1], b.ground[1])], tex: [m(a.tex[0], b.tex[0]), m(a.tex[1], b.tex[1])], grass: m(a.grass, b.grass),
    path: [m(a.path[0], b.path[0]), m(a.path[1], b.path[1])], wear: m(a.wear, b.wear),
    leaves: a.leaves.map((c, i) => m(c, b.leaves.length ? b.leaves[i % b.leaves.length] : c)), bark: m(a.bark, b.bark),
    clouds: { ...a.clouds, light: m(a.clouds.light, b.clouds.light || a.clouds.light), shade: m(a.clouds.shade, b.clouds.shade || a.clouds.shade) },
    light: [m(a.light[0], b.light[0]), a.light[1] + (b.light[1] - a.light[1]) * t] };
}

/** The seed's big choices, in the same order as ScenePlan.make in the app. */
export type Plan = { horizon: number; sunX: number; trailX: number; trailAmp: number; trailK: number; trailPh: number; flip: boolean; cloudScale: number; birches: number; detail: number };
export function plan(s: SceneSpec): Plan {
  const r = new Rng(s.seed);
  const flip = r.next() < 0.5;
  let sunX = s.time === "dawn" ? r.r(0.55, 0.72) : s.time === "dusk" ? r.r(0.28, 0.45) : s.time === "day" ? r.r(0.66, 0.86) : r.r(0.6, 0.8);
  if (flip) sunX = 1 - sunX;
  const trailX = r.r(0.44, 0.52), trailAmp = r.r(0.26, 0.36) * (r.next() < 0.5 ? -1 : 1), trailK = r.r(0.36, 0.48), trailPh = r.r(0.5, 1.0);
  const cloudScale = r.r(0.7, 1.3), birches = 2 + Math.floor(r.next() * 3);
  let horizon = { forest: 0.48, mountain: 0.5, lake: 0.44, coast: 0.46, city: 0.5, field: 0.52 }[s.landscape];
  if (s.time === "dusk" || s.time === "night") horizon += 0.015;
  const detail = Math.floor(r.next() * 4294967295) >>> 0;
  return { horizon, sunX, trailX, trailAmp, trailK, trailPh, flip, cloudScale, birches, detail };
}

/** The palette for a spec, as ScenePalette.make in the app: the hour and the weather, the season, the landscape. */
export function palette(s: SceneSpec, pl: Plan): Palette {
  const w = s.weather === "clear" ? null : PAL[s.weather];
  let p: Palette;
  if (!w) p = { ...PAL[{ dawn: "clearMorning", day: "clearDay", dusk: "dusk", night: "night" }[s.time]] };
  else if (s.time === "day") p = { ...w };
  else if (s.time === "dawn") { p = blend(w, PAL.clearMorning, 0.3); p.sun = s.weather === "fog" ? { glow: 420, color: 0xF8DCC0, alpha: 0.5, disk: 0 } : null; }
  else if (s.time === "dusk") {
    p = blend(w, PAL.dusk, 0.55); p.sun = s.weather === "fog" ? { glow: 420, color: 0xE8A07A, alpha: 0.4, disk: 0 } : null;
    p.clouds = { ...p.clouds, light: mix(p.clouds.light, 0xC78A86, 0.35) };
  } else {
    p = { ...PAL.night, stars: 0, moon: s.weather === "cloudy", clouds: { kind: "stratus", n: 14, light: 0x26314F, shade: 0x0A1020, alpha: 0.6, top: 0, bottom: 0.42 } };
    if (s.weather === "fog") { p.haze = [0x2A3654, 0.6]; p.fog = 0.22; p.mist = 0.4; p.clouds = { ...p.clouds, n: 0 }; }
    if (s.weather === "rain" || s.weather === "snow") p.haze = [0x26324E, 0.45];
  }
  if (p.lit) p.lit = { ...p.lit, side: pl.sunX >= 0.5 ? 1 : -1 };
  const tint = (c: number, k = 1) => mix(c, p.light[0], p.light[1] * k);
  p.snowTone = mix(0xF4F8FC, p.light[0], p.light[1] * 0.8);
  p.warm = s.time === "night" ? 0xFFC979 : 0xFFD9A0;
  let crowns = [0x4F7F3A, 0x5E8F42, 0x3F6B31, 0x76A04E, 0x6A9A46];
  if (s.season === "spring") {
    p.leaves = [0xA8CF6A, 0xC4DE84, 0x8DBE55, 0xD8E89A].map((c) => tint(c)); crowns = [0x8DBE55, 0xA8CF6A, 0x76A84A, 0xB9D978, 0x9CC860];
    p.grass = mix(p.grass, tint(0x8FC24A), 0.35); p.tex = [mix(p.tex[0], tint(0xB5D27A), 0.3), p.tex[1]];
  } else if (s.season === "summer") { if (!p.leaves.length) p.leaves = [0x86B44E, 0xA9CD63, 0x5F903A].map((c) => tint(c)); }
  else if (s.season === "autumn") {
    p.leaves = [0xE3A33B, 0xD7782E, 0xF2C350, 0xB9532B, 0xC9A04A].map((c) => tint(c)); crowns = [0xE3A33B, 0xD7782E, 0xF2C350, 0xB9532B, 0xC98A3A];
    p.ground = [mix(p.ground[0], tint(0x9A7A45), 0.35), p.ground[1]]; p.tex = [mix(p.tex[0], tint(0xC98B3E), 0.45), p.tex[1]]; p.grass = mix(p.grass, tint(0xA88A44), 0.5);
  } else {
    p.leaves = []; crowns = [];
    p.ground = [mix(p.ground[0], tint(0x6E6450), 0.4), p.ground[1]]; p.tex = [mix(p.tex[0], tint(0x8C7B5A), 0.4), p.tex[1]]; p.grass = mix(p.grass, tint(0x8A7F5E), 0.55);
  }
  p.crowns = crowns.map((c) => tint(c));
  if (s.snowCover) {
    const k = 0.85;
    p.ground = [tint(0xEDF2F7, k), tint(0xD2DCE7, k)]; p.tex = [tint(0xFFFFFF, k), tint(0xA9BBCF, k)]; p.grass = tint(0x8C9A98, k);
    p.path = [tint(0xD5DEE8, k), tint(0xAEBCCC, k)]; p.wear = tint(0xC2CFDD, k); p.vignette = Math.min(p.vignette, 0.1);
  }
  const sea = s.landscape === "coast";
  p.water = { far: mix(skyAt(p, 1), skyAt(p, 0), sea ? 0.35 : 0.2), near: mix(mix(skyAt(p, 0), p.forest.near, 0.45), tint(sea ? 0x2F5D7E : 0x34503E), 0.3) };
  if (s.snowCover && s.landscape === "lake") p.water = { far: tint(0xDCE6EE, 0.85), near: tint(0xBCCAD8, 0.85) };
  if (s.landscape === "mountain") {
    p.rock = [mix(p.hills[0], tint(0x8C8FA0), 0.35), mix(p.hills[1], tint(0x5E6070), 0.4)];
    if (!s.snowCover) {
      if (s.season === "autumn") { p.ground = [tint(0x9C5A32), tint(0x5E4030)]; p.tex = [tint(0xC7783A), tint(0x6E2F22)]; p.grass = tint(0xB0703A); }
      else if (s.season === "lateAutumn" || s.season === "winter") { p.ground = [tint(0x7A6E58), tint(0x4C4636)]; p.tex = [tint(0x9A8C6E), tint(0x3A3428)]; p.grass = tint(0x8A7A58); }
      else { p.ground = [tint(0x7E8452), tint(0x4F5A3A)]; p.tex = [tint(0xA49A62), tint(0x37402A)]; p.grass = tint(0x6E7A44); }
      p.path = [tint(0xB9B2A2), tint(0x857D70)]; p.wear = tint(0xD2CBBB);
    }
  } else if (s.landscape === "coast") {
    p.rock = [tint(0xB4ACA4, 0.6), tint(0x77706A, 0.6)];
  } else if (s.landscape === "city") {
    if (!s.snowCover) {
      p.path = [tint(0xD8D2C4), tint(0xA8A091)]; p.wear = tint(0xE8E4DA);
      if (s.season === "summer" || s.season === "spring") p.ground = [mix(p.ground[0], tint(0x6F9A48), 0.5), mix(p.ground[1], tint(0x4A7038), 0.5)];
    }
  } else if (s.landscape === "field") {
    p.crop = s.season === "spring" ? [tint(0x9CC25A), tint(0x6B5340)] : s.season === "summer" ? (pl.flip ? [tint(0xD9BE6A), tint(0x8DB04E)] : [tint(0x8DB04E), tint(0xD9BE6A)])
      : s.season === "autumn" ? [tint(0xC8A766), tint(0x6E5240)] : [tint(0x6E5A44), tint(0x5E4A3A)];
    if (s.snowCover) p.crop = [p.ground[0], p.ground[1]];
    else { p.path = [tint(0xD6C7A6), tint(0xA8936E)]; p.wear = tint(0xEADFC6); }
    p.barn = { wall: tint(0x9B2D20), trim: tint(0xF2EEE6), roof: tint(0x3A3A3E) };
  }
  return p;
}

// ------------------------------------------------------------------------------------------------------------- the SVG canvas

// coordinates in whole units (a unit is about 1.5 px on a 1920 px story, and every layer is blurred); small sizes to a tenth
const f = (n: number) => { const v = Math.round(n); return v === 0 ? "0" : String(v); };
const f1 = (n: number) => { const v = Math.round(n * 10) / 10; return v === 0 ? "0" : String(v); };
const ell = (x: number, y: number, w: number, h: number) => {
  const rx = w / 2, ry = h / 2;
  return `M${f1(x)} ${f1(y + ry)}a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(w)} 0a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(-w)} 0`;
};
const poly = (pts: number[][], close = true) => pts.map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(p[1])}`).join("") + (close ? "Z" : "");
const q1 = (a: number) => Math.round(a * 10) / 10;   // opacity in steps of 0.1, so shapes batch

/** Shapes in painting order, consecutive ones of the same style merged into one path; `bucket` groups a run of texture by style. */
class Canvas {
  out: string[] = [];
  defs: string[] = [];
  private cur: { key: string; open: string; d: string[] } | null = null;
  private buckets: Map<string, { open: string; d: string[] }> | null = null;
  private n = 0;
  constructor(readonly id: string) {}
  uid(k: string) { return `${this.id}${k}${this.n++}`; }
  private add(key: string, open: string, d: string) {
    if (this.buckets) { const b = this.buckets.get(key); if (b) b.d.push(d); else this.buckets.set(key, { open, d: [d] }); return; }
    if (this.cur && this.cur.key === key) { this.cur.d.push(d); return; }
    this.flush(); this.cur = { key, open, d: [d] };
  }
  flush() { if (this.cur) { this.out.push(`${this.cur.open} d="${this.cur.d.join("")}"/>`); this.cur = null; } }
  fill(d: string, color: number, a = 1) {
    const o = q1(a); if (o <= 0) return;
    this.add(`f${color}|${o}`, `<path fill="${hex(color)}"${o < 1 ? ` fill-opacity="${o}"` : ""}`, d);
  }
  stroke(d: string, color: number, a: number, width: number) {
    const o = q1(a), w = width < 2 ? Math.max(0.3, Math.round(width * 2) / 2) : width < 8 ? Math.round(width) : Math.round(width / 2) * 2; if (o <= 0) return;
    this.add(`s${color}|${o}|${w}`, `<path fill="none" stroke="${hex(color)}"${o < 1 ? ` stroke-opacity="${o}"` : ""} stroke-width="${w}" stroke-linecap="round"`, d);
  }
  /** An ellipse in the box (x, y, w, h); a small one as a round-capped stroke (a dot or a capsule: the same after the blur, a tenth of
   *  the bytes). */
  ellipse(x: number, y: number, w: number, h: number, color: number, a = 1) {
    if (Math.max(w, h) > 40) { this.fill(ell(x, y, w, h), color, a); return; }
    const t = Math.min(w, h), len = Math.abs(w - h), cx = x + w / 2, cy = y + h / 2;
    this.stroke(w >= h ? `M${f1(cx - len / 2)} ${f1(cy)}h${len < 0.1 ? ".1" : f1(len)}` : `M${f1(cx)} ${f1(cy - len / 2)}v${len < 0.1 ? ".1" : f1(len)}`, color, a, t);
  }
  raw(el: string) { this.flush(); this.out.push(el); }
  bucket(fn: () => void) {
    this.flush(); this.buckets = new Map();
    try { fn(); } finally {
      const b = this.buckets; this.buckets = null;
      for (const v of b.values()) this.out.push(`${v.open} d="${v.d.join("")}"/>`);
    }
  }
  /** A gradient along (x1, y1) → (x2, y2): its id, for a fill. Stops: [offset, colour, opacity]. */
  linear(stops: [number, number, number][], x1: number, y1: number, x2: number, y2: number): string {
    const id = this.uid("g");
    this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${stops.map(([o, c, a]) => `<stop offset="${Math.round(o * 1000) / 1000}" stop-color="${hex(c)}"${a < 1 ? ` stop-opacity="${Math.round(a * 1000) / 1000}"` : ""}/>`).join("")}</linearGradient>`);
    return id;
  }
  radial(cx: number, cy: number, r: number, color: number, a: number, falloff = 0.35, sy = 1) {
    const id = this.uid("r");
    this.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${sy !== 1 ? ` gradientTransform="translate(0 ${f(cy * (1 - sy))}) scale(1 ${sy})"` : ""}><stop offset="0" stop-color="${hex(color)}" stop-opacity="${Math.round(a * 1000) / 1000}"/><stop offset="0.35" stop-color="${hex(color)}" stop-opacity="${Math.round(a * falloff * 1000) / 1000}"/><stop offset="1" stop-color="${hex(color)}" stop-opacity="0"/></radialGradient>`);
    this.raw(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(r)}" ry="${f(r * sy)}" fill="url(#${id})"/>`);
  }
  clip(d: string): string { const id = this.uid("c"); this.defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`); return id; }
  group(attrs: string, fn: () => void) { this.raw(`<g ${attrs}>`); fn(); this.raw("</g>"); }
}

// ------------------------------------------------------------------------------------------------------------- the painter

type Trail = { vy: number; vx: number; amp: number; k: number; ph: number; ref: number; bottom: number; width: number };
const ty = (t: Trail, d: number) => t.vy + d * (t.bottom - t.vy);
const tcx = (t: Trail, d: number) => { const z = Math.min(1 / Math.max(d, 0.01) - 1, 12); return t.vx + t.ref * t.amp * d * Math.sin(t.k * z + t.ph); };
const thw = (t: Trail, d: number) => 1.2 + d * t.width * (1 + 0.06 * Math.sin(d * 40));
function outline(t: Trail, scale: number, d0 = 0): string {
  const ds: number[] = [];
  for (let d = d0; d < 1; d += 0.006 + d * 0.03) ds.push(d);
  ds.push(1);
  const left = ds.map((d) => [tcx(t, d) - thw(t, d) * scale, ty(t, d)]), right = ds.slice().reverse().map((d) => [tcx(t, d) + thw(t, d) * scale, ty(t, d)]);
  return poly([[tcx(t, ds[0]), ty(t, ds[0])], ...left, ...right]);
}

class Painter {
  readonly H = 1300; readonly P = 60;
  readonly pl: Plan; readonly pal: Palette; readonly rng: Rng; readonly hz: number; readonly groundTop: number; readonly tr: Trail; readonly snow: boolean;
  readonly L: Landscape; readonly sigmas = new Set<number>();
  c: Canvas;
  /** Level of detail: 1 at a phone story's 1.5 px per unit, down to 0.35 for a wide web image where a unit is under a pixel (fewer
   *  pebbles, leaves and blades of grass nobody could see, so the SVG stays small). */
  readonly lod: number;
  constructor(readonly spec: SceneSpec, readonly W: number, id: string, pxPerUnit = 1.48) {
    this.c = new Canvas(id);
    this.lod = Math.min(1, Math.max(0.35, pxPerUnit / 1.48));
    this.L = spec.landscape;
    this.pl = plan(spec); this.pal = palette(spec, this.pl); this.snow = spec.snowCover;
    this.rng = new Rng(this.pl.detail);
    this.hz = this.H * this.pl.horizon;
    this.groundTop = this.L === "lake" ? this.hz + 130 : this.L === "coast" ? this.hz + 150 : this.hz + 6;
    const amp = this.pl.trailAmp * (this.L === "city" ? 0.55 : this.L === "field" ? 0.22 : this.L === "lake" || this.L === "coast" ? 0.8 : 1);
    this.tr = { vy: this.groundTop + 4, vx: W * this.pl.trailX, amp, k: this.pl.trailK, ph: this.pl.trailPh, ref: Math.min(W, 780), bottom: this.H + this.P, width: this.L === "city" ? 190 : 175 };
  }
  get ref() { return Math.min(this.W, this.H * 0.6); }
  tint(c: number, k = 1) { return mix(c, this.pal.light[0], this.pal.light[1] * k); }
  /** A layer blurred by sigma (picture units). */
  layer(sigma: number, fn: () => void, extra = "") {
    const s = Math.round(sigma * 10) / 10;
    if (s > 0) this.sigmas.add(s);
    this.c.raw(`<g${s > 0 ? ` filter="url(#${this.c.id}b${String(s).replace(".", "_")})"` : ""}${extra ? ` ${extra}` : ""}>`);
    fn();
    this.c.raw("</g>");
  }
  band(color: number, alpha: number, center: number, up: number, down: number) {
    const a = center - up, b = center + down, m = (center - a) / (b - a);
    const g = this.c.linear([[0, color, 0], [m * 0.5, color, alpha * 0.45], [m, color, alpha], [Math.min(1, m + (1 - m) * 0.5), color, alpha * 0.5], [1, color, 0]], 0, a, 0, b);
    this.c.raw(`<rect x="${f(-this.P)}" y="${f(a)}" width="${f(this.W + 2 * this.P)}" height="${f(b - a)}" fill="url(#${g})"/>`);
  }
  get sun(): [number, number] {
    const s = this.spec, y = s.time === "dawn" ? this.hz - this.H * 0.075 : s.time === "dusk" ? this.hz + 4 : s.time === "day" ? (s.weather === "clear" ? this.H * 0.065 : this.H * 0.27) : this.H * 0.17;
    return [this.W * this.pl.sunX, y];
  }

  // ridges
  ridge(base: number, amp: number, color: number) {
    const r = this.rng, f1 = r.r(0.8, 1.6), f2 = r.r(2.5, 4.5), ph = r.r(0, 6), ph2 = r.r(0, 6), pts: number[][] = [[-this.P, base + 40]];
    for (let x = -this.P; x <= this.W + this.P; x += 6) {
      const t = x / this.ref;
      pts.push([x, base - amp * (0.55 + 0.45 * Math.sin(t * Math.PI * f1 + ph)) - amp * 0.22 * Math.sin(t * Math.PI * f2 + ph2) - r.r(0, amp * 0.05)]);
    }
    pts.push([this.W + this.P, base + 40]);
    this.c.fill(poly(pts), color);
  }
  profileRidge(base: number, amp: number, color: number, rough: boolean, span: [number, number] | null = null): string {
    const r = this.rng, ph = r.r(0, 6), ph2 = r.r(0, 6), pts: number[][] = [[-this.P, base + 40]];
    const x0 = span ? span[0] : -this.P * 0.5, x1 = span ? span[1] : this.W + this.P * 0.5;
    for (let x = -this.P; x <= this.W + this.P; x += 4) {
      const t = (x - x0) / Math.max(1, x1 - x0);
      const h = profileAt(this.spec.profile, t) ?? 0.55 + 0.3 * Math.sin(t * 2.6 + ph) + 0.15 * Math.sin(t * 7.1 + ph2);
      let y = base - amp * h;
      if (span) { const e = Math.min(1, Math.max(0, t * 5), Math.max(0, (1 - t) * 5)); y = base + 6 - (base + 6 - y) * Math.sin((e * Math.PI) / 2); if (t < 0 || t > 1) y = base + 8; }
      y -= rough ? amp * (0.035 * Math.sin(x * 0.09 + ph) + 0.02 * Math.sin(x * 0.23 + ph2)) + r.r(0, amp * 0.025) : r.r(0, 2.6) + 1.2 * Math.sin(x * 0.5 + ph);
      pts.push([x, y]);
    }
    pts.push([this.W + this.P, base + 40]);
    const d = poly(pts);
    this.c.fill(d, color);
    if (rough) {
      const cl = this.c.clip(d), green = this.snow ? mix(color, this.pal.snowTone, 0.4) : mix(color, mix(this.pal.ground[0], this.pal.forest.far, 0.5), 0.55);
      const g = this.c.linear([[0, green, 0], [1, green, 0.85]], 0, base - amp * 0.55, 0, base);
      this.c.group(`clip-path="url(#${cl})"`, () => {
        this.c.raw(`<rect x="${f(-this.P)}" y="${f(base - amp)}" width="${f(this.W + 2 * this.P)}" height="${f(amp + 40)}" fill="url(#${g})"/>`);
        for (let i = 0; i < (this.W / 18) * this.lod; i++) {
          const gx = r.r(-this.P, this.W + this.P), top = base - amp * r.r(0.3, 1);
          this.c.stroke(`M${f(gx)} ${f(top)}l${f(r.r(-12, 12))} ${f(amp * r.r(0.15, 0.4))}`, mix(color, 0x101418, 0.35), 0.2, 2);
        }
        this.c.flush();
      });
    }
    return d;
  }
  snowCaps(outlineD: string, line: number, color: number) {
    const r = this.rng, pts: number[][] = [[-this.P, -this.P]];
    for (let x = -this.P; x <= this.W + this.P; x += 8) pts.push([x, line + 10 * Math.sin(x * 0.05) + r.r(-6, 6)]);
    pts.push([this.W + this.P, -this.P]);
    const cl = this.c.clip(outlineD);
    this.c.group(`clip-path="url(#${cl})"`, () => {
      this.c.fill(poly(pts), color, 0.92);
      for (let i = 0; i < this.W / 40; i++) {
        const gx = r.r(-20, this.W + 20), len = r.r(20, 70), w = r.r(3, 8);
        this.c.fill(poly([[gx - w, line - 4], [gx + w, line - 4], [gx + r.r(-6, 6), line + len]]), color, 0.7);
      }
      const g = this.c.linear([[0, 0x000000, 0], [1, 0x1A2030, 0.18]], this.pl.sunX * this.W, 0, (1 - this.pl.sunX) * this.W, 0);
      this.c.raw(`<rect x="${f(-this.P)}" y="${f(-this.P)}" width="${f(this.W + 2 * this.P)}" height="${f(this.hz + 40)}" fill="url(#${g})"/>`);
    });
  }

  // trees
  spruce(x: number, base: number, h: number, w: number, color: number, lit: Palette["lit"], snow: boolean, detail = 1) {
    detail *= Math.pow(this.lod, 0.7);
    const r = this.rng, tiers = Math.max(4, Math.min(Math.round(12 * detail), Math.floor(h / (14 / detail))));
    const top = base - h, lean = r.r(-0.025, 0.025) * h, sp = (h * 0.9) / tiers, right: number[][] = [], left: number[][] = [], loads: string[] = [];
    for (let i = 0; i < tiers; i++) {
      const t = (i + 1) / tiers, y0 = top + h * 0.05 + h * 0.88 * t, ax = x + lean * (1 - t), full = (w / 2) * (0.1 + 0.9 * Math.pow(t, 0.8));
      for (const side of [1, -1]) {
        const y = y0 + (side < 0 ? sp * r.r(0.3, 0.6) : r.r(-0.15, 0.15) * sp), reach = full * r.r(0.68, 1.12) * (r.next() < 0.1 ? 0.6 : 1), droop = sp * r.r(0.3, 0.75);
        const pts = [[ax + side * reach * 0.5, y - sp * 0.2], [ax + side * reach, y + droop], [ax + side * reach * r.r(0.25, 0.45), y + sp * 0.5]];
        (side > 0 ? right : left).push(...pts);
        if (snow && h * this.lod >= 120 && r.next() < 0.85) {
          const th = sp * r.r(0.25, 0.45);
          loads.push(poly([[ax + side * reach * 0.12, y - sp * 0.32], [ax + side * reach * 0.55, y - sp * 0.22], [ax + side * reach * 0.95, y + droop * 0.9], [ax + side * reach * 0.45, y - sp * 0.22 + th], [ax + side * reach * 0.1, y - sp * 0.3 + th]]));
        }
      }
    }
    const d = poly([[x + lean, top], ...right, [x + w * 0.035, base], [x - w * 0.035, base], ...left.reverse()]);
    this.c.fill(d, snow && h * this.lod < 120 ? mix(color, this.pal.snowTone, 0.3) : color);
    if (lit && h > 250) {
      const g = this.c.linear([[0, lit.color, lit.alpha], [1, lit.color, 0]], x + lit.side * w * 0.55, 0, x - lit.side * w * 0.05, 0);
      this.c.raw(`<path d="${d}" fill="url(#${g})"/>`);
    }
    if (snow) { for (const l of loads) this.c.fill(l, this.pal.snowTone, 0.9); this.c.ellipse(x + lean - w * 0.04, top - 1, w * 0.08, sp * 0.6, this.pal.snowTone, 0.9); }
  }
  pine(x: number, base: number, h: number, w: number, color: number, trunk: number, snow: boolean, leanBias = 0, spread = 1) {
    const r = this.rng, tw = Math.max(1, w * 0.04), lean = (r.r(-0.04, 0.04) + leanBias) * h;
    this.c.fill(poly([[x - tw, base], [x + lean - tw * 0.4, base - h * 0.93], [x + lean + tw * 0.4, base - h * 0.93], [x + tw, base]]), trunk);
    const clumps: [number, number, number][] = [[x + lean, base - h * 0.93, w * 0.34]];
    for (let i = 0; i < 4; i++) clumps.push([x + lean * 0.95 + r.r(-0.22, 0.22) * w * spread, base - h * r.r(0.8, 0.92), w * r.r(0.24, 0.32)]);
    clumps.push([x + lean * 0.7 + r.r(-0.2, 0.2) * w, base - h * r.r(0.66, 0.74), w * r.r(0.14, 0.2)]);
    if (spread > 1) for (let i = 0; i < 2; i++) clumps.push([x + lean * 0.5 + r.r(-0.3, 0.3) * w, base - h * r.r(0.5, 0.65), w * r.r(0.18, 0.26)]);
    for (const [cx, cy, cw] of clumps) {
      const ax = x + (lean * (base - cy)) / h;
      this.c.stroke(`M${f(ax)} ${f(cy + cw * 0.3)}L${f(cx)} ${f(cy)}`, trunk, 1, Math.max(0.7, tw * 0.55));
      for (let i = 0; i < 8; i++) { const rr = cw * r.r(0.3, 0.5); this.c.ellipse(cx + r.r(-0.6, 0.6) * cw - rr, cy + r.r(-0.4, 0.3) * cw - rr * 0.7, rr * 2, rr * 1.5, color); }
      if (snow) this.c.ellipse(cx - cw * 0.75, cy - cw * 0.32, cw * 1.5, cw * 0.28, this.pal.snowTone, 0.85);
    }
  }
  /** A far row of trees as simple spires on a forest wall (blurred, nobody counts the tiers), or real spruces when near. */
  treeRow(o: { base: number; jitter: number; hMin: number; hMax: number; spacing: number; edge: number; color: number; trunk: number; lit: Palette["lit"]; pines: number; mass?: boolean; keep?: (x: number) => boolean }) {
    const r = this.rng, trees: { x: number; b: number; h: number; pine: boolean }[] = [];
    for (let x = -this.P * 0.8; x < this.W + this.P * 0.8; x += (o.spacing * r.r(0.5, 1.1)) / Math.sqrt(this.lod)) {
      const d = Math.min(1, Math.abs(x / this.W - 0.5) * 2), h = (o.hMin + (o.hMax - o.hMin) * Math.pow(r.next(), 1.7)) * (1 + o.edge * d * d);
      const b = o.base + r.r(-o.jitter, o.jitter), pine = r.next() < o.pines;
      if (h > 4 && (o.keep?.(x) ?? true)) trees.push({ x, b, h, pine });
    }
    if (o.mass) {
      const pts: number[][] = [[-this.P, o.base + 6]];
      for (let x = -this.P; x <= this.W + this.P; x += 8) pts.push([x, (o.keep?.(x) ?? true) ? o.base - o.hMin * r.r(0.35, 0.55) : o.base + 4]);
      pts.push([this.W + this.P, o.base + 6]);
      this.c.fill(poly(pts), o.color);
    }
    for (const t of trees.sort((a, b) => a.b - b.b)) {
      if (t.h < 80) {   // a far spire: two tiers of ragged edges (snowy ones paler)
        const w = t.h * r.r(0.26, 0.36), y = t.b - t.h;
        this.c.fill(poly([[t.x, y], [t.x + w * 0.3, y + t.h * 0.45], [t.x + w * 0.16, y + t.h * 0.47], [t.x + w * 0.5, t.b],
          [t.x - w * 0.5, t.b], [t.x - w * 0.16, y + t.h * 0.5], [t.x - w * 0.3, y + t.h * 0.47]]), this.snow ? mix(o.color, this.pal.snowTone, 0.3) : o.color);
      } else if (t.pine) this.pine(t.x, t.b, t.h * 1.15, t.h * r.r(0.26, 0.34), o.color, o.trunk, this.snow);
      else this.spruce(t.x, t.b, t.h, t.h * r.r(0.26, 0.38), o.color, o.lit, this.snow, t.h < 45 ? 0.5 : 1);
    }
  }
  crownRow(base: number, hMin: number, hMax: number, spacing: number, color: number, keep: (x: number) => boolean = () => true) {
    const r = this.rng, tops: string[] = [];
    this.c.bucket(() => { for (let x = -this.P; x < this.W + this.P; x += (spacing * r.r(0.6, 1.2)) / Math.sqrt(this.lod)) {
      const h = r.r(hMin, hMax), ok = keep(x);
      if (ok) this.c.fill(`M${f(x - h * 0.03)} ${f(base)}h${f(h * 0.06)}v${f(-h * 0.5)}h${f(-h * 0.06)}Z`, color);
      for (let i = 0; i < 4; i++) {
        const rr = h * r.r(0.24, 0.34), ex = x + r.r(-0.25, 0.25) * h - rr, ey = base - h * 0.68 + r.r(-0.2, 0.15) * h - rr * 0.85;
        if (ok) { this.c.ellipse(ex, ey, 2 * rr, 1.7 * rr, color); if (this.snow) tops.push(ell(ex + rr * 0.3, ey, rr * 1.4, rr * 0.5)); }
      }
    } });
    for (const t of tops) this.c.fill(t, this.pal.snowTone, 0.55);
  }
  branches(x: number, y: number, angle: number, len: number, width: number, depth: number, color: number, droop = false) {
    const bend = droop ? 0.35 * (3 - Math.min(3, depth)) : 0, a = angle + bend * (angle > -Math.PI / 2 ? 1 : -1);
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    this.c.stroke(`M${f(x)} ${f(y)}L${f(ex)} ${f(ey)}`, color, 0.9, Math.max(0.35, width));
    if (this.snow && width > 0.9) this.c.stroke(`M${f(x)} ${f(y - width * 0.5)}L${f(ex)} ${f(ey - width * 0.5)}`, this.pal.snowTone, 0.75, width * 0.45);
    if (depth <= 0) return;
    for (let i = 0; i < (depth > 1 ? 3 : 2); i++) {
      const k = i === 0 ? 1 : this.rng.r(0.45, 0.85);
      this.branches(x + (ex - x) * k, y + (ey - y) * k, angle + this.rng.r(-0.65, 0.65), len * this.rng.r(0.55, 0.75), width * 0.6, depth - 1, color, droop);
    }
  }
  birch(x: number, base: number, h: number, bark: number, mark: number, leaves: number[], shadeSide: number, crooked = false) {
    const r = this.rng, bw = h * (crooked ? 0.035 : 0.024), lean = r.r(-0.04, 0.04) * h * (crooked ? 4 : 1);
    const at = (t: number) => x + lean * t + Math.sin(t * (crooked ? 6 : 3)) * bw * (crooked ? 1.6 : 0.6);
    const ts = Array.from({ length: 11 }, (_, i) => (i / 10) * 0.9);
    const d = poly([...ts.map((t) => [at(t) - bw * (0.5 - 0.38 * t), base - h * t]), ...ts.slice().reverse().map((t) => [at(t) + bw * (0.5 - 0.38 * t), base - h * t])]);
    if (!leaves.length) {
      const twig = mix(this.tint(0x5E5052), this.pal.haze[0], this.snow ? 0.35 : 0.2);
      for (let k = 0; k < 8; k++) { const t = r.r(0.5, 0.95), cx = at(t) + r.r(-0.1, 0.1) * h * (k ? 1 : 0), cy = base - h * t, rr = h * r.r(0.07, 0.11); this.c.ellipse(cx - rr * 1.2, cy - rr * 0.7, rr * 2.4, rr * 1.9, twig, 0.11); }
      for (let k = 0; k < 5; k++) { const t = 0.5 + k * 0.09, side = k % 2 ? 1 : -1; this.branches(at(t), base - h * t, -Math.PI / 2 + side * r.r(0.5, 0.9), h * r.r(0.07, 0.11), Math.max(0.5, bw * 0.3), 2, mix(mark, twig, 0.4), true); }
    } else {
      for (let i = 0; i < 6; i++) {
        const t = r.r(0.4, 0.88), side = r.next() < 0.5 ? -1 : 1, len = h * r.r(0.06, 0.13), sx = at(t), sy = base - h * t;
        this.c.stroke(`M${f(sx)} ${f(sy)}Q${f(sx + side * len * 0.5)} ${f(sy - len * 0.6)} ${f(sx + side * len)} ${f(sy - len * r.r(0.1, 0.5))}`, mark, 0.5, Math.max(0.6, bw * 0.2 * (1 - t * 0.5)));
      }
    }
    this.c.fill(d, bark);
    const g1 = this.c.linear([[0, mark, 0], [0.55, mark, 0], [1, mark, 0.4]], x - shadeSide * bw, 0, x + shadeSide * bw, 0);
    const g2 = this.c.linear([[0, mark, 0], [0.6, mark, 0.25], [1, mark, 0.85]], 0, base - h * 0.16, 0, base);
    this.c.raw(`<path d="${d}" fill="url(#${g1})"/><path d="${d}" fill="url(#${g2})"/>`);
    for (let i = 0; i < 20; i++) { const t = Math.pow(r.next(), 1.3) * 0.95, w = bw * r.r(0.25, 0.85); this.c.fill(`M${f(at(t) + r.r(-0.4, 0.4) * bw - w / 2)} ${f(base - h * t)}h${f(w)}v${f(r.r(0.8, 2.4))}h${f(-w)}Z`, mark, 0.75); }
    if (!leaves.length) return;
    this.c.bucket(() => {
      for (let k = 0; k < (crooked ? 6 : 9); k++) {
        const t = r.r(0.5, 1), cx = at(t) + r.r(-0.12, 0.12) * h * (k ? 1 : 0), cy = base - h * t, rr = h * r.r(0.06, 0.1);
        for (let i = 0; i < (crooked ? 26 : 38) * this.lod; i++) {
          const a = r.r(0, 2 * Math.PI), dist = rr * Math.sqrt(r.next()), s = (r.r(2.4, 5.2) * Math.max(0.6, Math.min(1.4, h / 300))) / Math.sqrt(this.lod);
          this.c.ellipse(cx + Math.cos(a) * dist * 1.2 - s, cy + Math.sin(a) * dist * 0.8 + rr * 0.35 * r.next() - s * 0.7, s * 2, s * 1.4, r.pick(leaves), 0.75);
        }
      }
    });
  }
  parkTree(x: number, base: number, h: number, trunk: number) {
    const r = this.rng, lean = r.r(-0.03, 0.03) * h, tw = h * 0.04, bare = !this.pal.crowns.length, top = bare ? 0.42 : 0.6;
    this.c.fill(poly([[x - tw, base], [x + lean - tw * 0.5, base - h * top], [x + lean + tw * 0.5, base - h * top], [x + tw, base]]), trunk);
    const cx = x + lean, cy = base - h * 0.66, rx = h * 0.34, ry = h * 0.3;
    if (bare) {
      this.c.ellipse(cx - rx, cy - ry * 1.05, rx * 2, ry * 2, mix(trunk, this.pal.haze[0], 0.35), 0.14);
      for (let k = 0; k < 5; k++) this.branches(x + lean, base - h * top, -Math.PI / 2 + (k - 2) * 0.38 + r.r(-0.12, 0.12), h * r.r(0.24, 0.32), tw * 0.7, 2, trunk);
      return;
    }
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.45; this.c.stroke(`M${f(x + lean)} ${f(base - h * top)}l${f(Math.cos(a) * rx * 0.7)} ${f(Math.sin(a) * ry * 0.9)}`, trunk, 1, Math.max(0.5, tw * 0.5)); }
    const shade = mix(this.pal.crowns[0], this.pal.forest.near, 0.5);
    for (let i = 0; i < 7; i++) { const a = r.r(0, 2 * Math.PI), d = Math.sqrt(r.next()) * 0.55, rr = rx * r.r(0.5, 0.62); this.c.ellipse(cx + Math.cos(a) * d * rx - rr, cy + Math.sin(a) * d * ry - rr * 0.8, rr * 2, rr * 1.65, shade, 0.95); }
    const lit = this.pal.lit?.side ?? 1;
    this.c.bucket(() => {
      for (let k = 0; k < 9; k++) {
        const a = r.r(0, 2 * Math.PI), d = Math.sqrt(r.next()) * 0.8, qx = cx + Math.cos(a) * d * rx + lit * rx * 0.12, qy = cy + Math.sin(a) * d * ry - ry * 0.12, rr = rx * r.r(0.24, 0.36);
        for (let i = 0; i < 22 * this.lod; i++) { const b = r.r(0, 2 * Math.PI), q = rr * Math.sqrt(r.next()), sz = Math.max(1.2, h * r.r(0.014, 0.03)) / Math.sqrt(this.lod); this.c.ellipse(qx + Math.cos(b) * q * 1.15 - sz, qy + Math.sin(b) * q * 0.9 - sz * 0.7, sz * 2, sz * 1.4, r.pick(this.pal.crowns), 0.8); }
      }
    });
  }
  lamp(x: number, base: number, h: number, glow: boolean) {
    const w = Math.max(0.8, h * 0.022), post = mix(this.pal.forest.near, 0x000000, 0.3);
    this.c.fill(`M${f(x - w / 2)} ${f(base)}h${f(w)}v${f(-h)}h${f(-w)}ZM${f(x - w * 1.4)} ${f(base)}h${f(w * 2.8)}v${f(-h * 0.06)}h${f(-w * 2.8)}Z`, post);
    if (glow) { this.c.radial(x, base - h * 1.03, h * 0.35, this.pal.warm, 0.55); this.c.radial(x, base, h * 0.9, this.pal.warm, this.snow ? 0.3 : 0.18, 0.5, 0.22); }
    this.c.ellipse(x - w * 2.2, base - h * 1.08, w * 4.4, h * 0.09, glow ? this.pal.warm : mix(post, 0xFFFFFF, 0.25));
  }

  // sky
  clouds() {
    // as many clouds as the app's over a story's width; a wide picture gets a few more, not proportionally more
    const r = this.rng, cl = this.pal.clouds, y0 = this.H * cl.top, y1 = this.H * cl.bottom, n = Math.round(cl.n * this.pl.cloudScale * Math.sqrt(this.W / 600));
    if (cl.kind === "cumulus") {
      for (let i = 0; i < n; i++) {
        const cx = r.r(-40, this.W + 40), cy = r.r(y0 + 70, y1), scale = 0.5 + 0.5 * (1 - (cy - y0) / Math.max(1, y1 - y0)), w = r.r(170, 300) * scale;
        const puffs: [number, number, number][] = [];
        for (let k = 0; k < 13; k++) { const u = (r.r(-1, 1) + r.r(-1, 1)) / 2, rr = w * r.r(0.12, 0.24) * (1.1 - Math.abs(u)); puffs.push([cx + u * w * 0.6, cy - rr * r.r(0.3, 1.6) - (1 - Math.abs(u)) * w * 0.12, rr]); }
        const cid = this.c.clip(`M${f(-this.P)} ${f(-this.P)}H${f(this.W + this.P)}V${f(cy + 3)}H${f(-this.P)}Z`);
        this.c.group(`clip-path="url(#${cid})"`, () => {
          for (const [x, y, rr] of puffs) this.c.ellipse(x - rr, y - rr, 2 * rr, 2 * rr, cl.shade, cl.alpha * 0.85);
          for (const [x, y, rr] of puffs) { const q = rr * 0.86; this.c.ellipse(x - q - rr * 0.05, y - rr * 0.3 - q, 2 * q, 2 * q, cl.light, cl.alpha * 0.85); }
          this.c.flush();
        });
      }
      for (let i = 0; i < 5; i++) { const y = r.r(y0, y1 * 0.6), x = r.r(-100, this.W), w = r.r(120, 260); this.c.ellipse(x, y, w, w * 0.05, cl.light, 0.25); }
    } else if (cl.kind !== "none") {
      const thin = cl.kind === "streak";
      this.c.bucket(() => {
        for (let i = 0; i < n; i++) {
          const y = r.r(y0, y1), depth = 0.55 + 0.45 * (1 - (y - y0) / Math.max(1, y1 - y0)), len = r.r(260, 640) * (thin ? 0.8 : 1), x0 = r.r(-260, this.W - 80), segs = thin ? 8 : 12;
          for (let pass = 0; pass < 2; pass++) for (let j = 0; j < segs; j++) {
            const ew = r.r(70, 180) * depth, eh = ew * (thin ? r.r(0.07, 0.13) : r.r(0.22, 0.42)), ex = x0 + (len * j) / segs + r.r(-20, 20), ey = y + r.r(-0.35, 0.35) * eh * (thin ? 1 : 1.6);
            if (pass === 0) this.c.ellipse(ex, ey + eh * 0.35, ew, eh, cl.shade, cl.alpha * 0.5);
            else this.c.ellipse(ex, ey, ew, eh * 0.85, cl.light, cl.alpha * 0.65);
          }
        }
      });
    }
  }

  // the landscape's own things
  skyline(base: number, color: number, windows: boolean) {
    const r = this.rng, centre = this.pl.flip ? 0.38 : 0.62, lights: string[] = [];
    for (let x = -this.P; x < this.W + this.P;) {
      const w = r.r(14, 46), t = x / this.W, cluster = Math.exp(-(((t - centre) / 0.2) ** 2));
      if (r.next() < 0.1) { x += w * 0.6; continue; }
      const h = r.r(14, 34) + 80 * cluster * r.r(0.3, 1);
      this.c.fill(`M${f(x)} ${f(base + 12)}V${f(base - h)}${r.next() < 0.3 ? `L${f(x + w / 2)} ${f(base - h - w * 0.35)}` : ""}L${f(x + w + 0.5)} ${f(base - h)}V${f(base + 12)}Z`, color);
      if (windows) for (let wy = base - h + 4; wy < base - 2; wy += 7) for (let wx = x + 2.5; wx < x + w - 4; wx += 5.5) if (r.next() < 0.3) lights.push(`M${f(wx)} ${f(wy)}h2.4v3.2h-2.4Z`);
      x += w * r.r(0.85, 1.02);
    }
    for (let i = 0; i < 2; i++) {
      const sx = this.W * centre + r.r(-0.3, 0.3) * this.W, sh = r.r(60, 110), sw = r.r(8, 13);
      this.c.fill(poly([[sx - sw / 2, base + 10], [sx - sw / 2, base - sh * 0.55], [sx, base - sh], [sx + sw / 2, base - sh * 0.55], [sx + sw / 2, base + 10]]), color);
    }
    if (lights.length) this.c.fill(lights.join(""), this.pal.warm, 0.9);
  }
  fellSide() {
    const r = this.rng, left = !this.pl.flip, x0 = left ? -this.P : this.W * 0.5, x1 = left ? this.W * 0.5 : this.W + this.P, peak = this.hz - r.r(50, 95);
    const pts: number[][] = [[x0, this.hz + 14]];
    for (let x = x0; x <= x1; x += 6) { const t = (x - x0) / (x1 - x0), u = left ? 1 - t : t; pts.push([x, this.hz + 10 - (this.hz + 10 - peak) * Math.pow(Math.sin((Math.min(1, u * 1.15) * Math.PI) / 2), 1.6) - r.r(0, 2)]); }
    pts.push([x1, this.hz + 14]);
    const d = poly(pts);
    this.c.fill(d, mix(this.snow ? this.pal.snowTone : mix(this.pal.ground[0], this.pal.ground[1], 0.4), this.pal.haze[0], 0.3));
    const cl = this.c.clip(d);
    this.c.group(`clip-path="url(#${cl})"`, () => {
      this.c.bucket(() => { for (let i = 0; i < 60 * this.lod; i++) { const w = r.r(10, 60); this.c.ellipse(r.r(x0, x1), r.r(peak, this.hz + 10), w, w * 0.18, mix(r.next() < 0.5 ? this.pal.tex[0] : this.pal.tex[1], this.pal.haze[0], 0.4), 0.25); } });
      if (!this.snow && this.spec.season !== "summer") for (let i = 0; i < 14; i++) { const w = r.r(8, 40); this.c.ellipse(r.r(x0, x1), r.r(peak, peak + 40), w, w * 0.2, mix(this.pal.snowTone, this.pal.haze[0], 0.2), 0.65); }
      this.c.flush();
    });
  }
  shoreY(x: number) { const a = (this.pl.detail % 997) / 97, b = (this.pl.detail % 991) / 61; return this.groundTop + 2 + 6 * Math.sin(x * 0.013 + a) + 4 * Math.sin(x * 0.037 + b); }
  islands(top: number) {
    const r = this.rng;
    for (let i = 0; i < 3; i++) {
      const near = i / 2, y = top + 4 + near * 52, w = r.r(60, 160) * (0.6 + near), h = w * r.r(0.08, 0.16), x = this.pl.flip ? r.r(this.W * 0.5, this.W * 0.95) : r.r(this.W * 0.05, this.W * 0.5);
      this.c.fill(`M${f(x - w / 2)} ${f(y)}C${f(x - w * 0.35)} ${f(y - h * 0.9)} ${f(x - w * 0.15)} ${f(y - h)} ${f(x + w * 0.1)} ${f(y - h)}C${f(x + w * 0.3)} ${f(y - h)} ${f(x + w * 0.42)} ${f(y - h * 0.5)} ${f(x + w / 2)} ${f(y)}Z`,
        mix(mix(this.pal.rock[1], this.pal.forest.far, 0.5), this.pal.haze[0], 0.5 - near * 0.3));
      if (w > 90) for (let k = 0; k < w / 40; k++) this.spruce(x + r.r(-0.25, 0.2) * w, y - h * 0.7, h * r.r(0.6, 1), h * 0.45, mix(this.pal.forest.far, this.pal.haze[0], 0.4 - near * 0.2), null, this.snow, 0.5);
    }
  }
  water(top: number, bottom: number) {
    const r = this.rng, p = this.pal, frozen = this.snow && this.L === "lake";
    const g = this.c.linear([[0, p.water.far, 1], [1, p.water.near, 1]], 0, top, 0, bottom);
    this.c.raw(`<rect x="${f(-this.P)}" y="${f(top)}" width="${f(this.W + 2 * this.P)}" height="${f(bottom - top + 20)}" fill="url(#${g})"/>`);
    if (frozen) {
      this.c.bucket(() => { for (let i = 0; i < this.W / 12; i++) { const y = r.r(top, bottom), w = r.r(40, 180) * (0.4 + (y - top) / (bottom - top)); this.c.ellipse(r.r(-60, this.W), y, w, w * 0.06, p.snowTone, 0.4); } });
      return;
    }
    const lightCol = mix(p.water.far, 0xFFFFFF, 0.25), darkCol = mix(p.water.near, 0x000000, 0.2);
    this.c.bucket(() => {
      for (let y = top + 2; y < bottom; y += 3.5 + ((y - top) / Math.max(1, bottom - top)) * 11) {
        const fr = (y - top) / Math.max(1, bottom - top);
        for (let i = 0; i < (3 + this.W / 160) * this.lod; i++) { const x = r.r(-40, this.W + 40), len = r.r(10, 60) * (0.3 + fr * 1.4); this.c.stroke(`M${f(x)} ${f(y)}h${f(len)}`, r.next() < 0.5 ? lightCol : darkCol, 0.2, 0.6 + fr * 1.4); }
      }
      const src = p.sun ? [p.sun.color, this.spec.time === "day" ? 0.35 : 0.6] : p.moon ? [0xC8D4F0, 0.4] : null;
      if (src) {
        const [sx] = this.sun;
        for (let y = top + 1; y < bottom; y += 3 + ((y - top) / Math.max(1, bottom - top)) * 8) {
          const fr = (y - top) / Math.max(1, bottom - top), spread = 10 + fr * 70;
          for (let i = 0; i < 2; i++) { const len = r.r(6, 26) * (0.4 + fr), x = sx + r.r(-1, 1) * spread; this.c.stroke(`M${f(x - len / 2)} ${f(y)}h${f(len)}`, mix(src[0], 0xFFFFFF, 0.4), src[1] * 0.6 * (1 - fr * 0.6), 0.8 + fr * 1.6); }
        }
      }
      if (this.L === "coast") for (let i = 0; i < this.W / 8; i++) { const x = r.r(-20, this.W + 20), w = r.r(8, 40); this.c.ellipse(x, this.shoreY(x + w / 2) - r.r(1, 8), w, w * 0.12, mix(p.water.far, 0xFFFFFF, 0.6), 0.35); }
    });
  }
  reeds() {
    if (this.snow) return;
    const r = this.rng, col = this.spec.season === "autumn" || this.spec.season === "lateAutumn" ? this.tint(0xB89A5A) : this.pal.grass;
    this.c.bucket(() => {
      for (let x = -this.P; x < this.W + this.P; x += r.r(18, 40) / this.lod) {
        if (r.next() >= 0.5) continue;
        const n = 5 + Math.floor(r.next() * 7), h = r.r(14, 34);
        for (let i = 0; i < n; i++) { const rx = x + r.r(-10, 10), y = this.shoreY(rx) + 5; this.c.stroke(`M${f(rx)} ${f(y)}l${f(r.r(-4, 4))} ${f(-h * r.r(0.6, 1.1))}`, col, 0.7, 1); }
      }
    });
  }
  barn(x: number, base: number, h: number) {
    const w = h * 1.7, roof = h * 0.55, b = this.pal.barn;
    this.c.fill(`M${f(x - w / 2)} ${f(base)}h${f(w)}v${f(-h)}h${f(-w)}Z`, b.wall);
    this.c.fill(poly([[x - w / 2 - 3, base - h + 1], [x - w / 2 + roof * 0.6, base - h - roof], [x + w / 2 - roof * 0.6, base - h - roof], [x + w / 2 + 3, base - h + 1]]), b.roof);
    this.c.fill(`M${f(x - w / 2)} ${f(base)}h2v${f(-h)}h-2ZM${f(x + w / 2 - 2)} ${f(base)}h2v${f(-h)}h-2Z`, b.trim, 0.9);
    this.c.stroke(`M${f(x - h * 0.25)} ${f(base)}V${f(base - h * 0.62)}H${f(x + h * 0.25)}V${f(base)}M${f(x - h * 0.25)} ${f(base - h * 0.62)}L${f(x + h * 0.25)} ${f(base)}`, b.trim, 0.9, 1.6);
  }

  // the ground and the trail
  ground(): string {
    const r = this.rng, p = this.pal, tr = this.tr, top = this.groundTop + 2, L = this.L, P = this.P, W = this.W, H = this.H;
    let region: string;
    if (L === "lake" || L === "coast") {
      const pts: number[][] = [[-P, H + P]];
      for (let x = -P; x <= W + P; x += 8) pts.push([x, this.shoreY(x)]);
      pts.push([W + P, H + P]); region = poly(pts);
    } else region = `M${f(-P)} ${f(top)}H${f(W + P)}V${f(H + P)}H${f(-P)}Z`;
    const cl = this.c.clip(region);
    this.c.group(`clip-path="url(#${cl})"`, () => {
      const g = this.c.linear([[0, p.ground[0], 1], [1, p.ground[1], 1]], 0, top, 0, H);
      this.c.raw(`<path d="${region}" fill="url(#${g})"/>`);
      if (L === "field") this.fields(top);
      this.c.bucket(() => {
        for (let i = 0; i < ((300 * (W + 2 * P)) / 720) * this.lod; i++) {
          const d = Math.pow(r.next(), 0.7), y = ty(tr, d), size = 4 + d * 70, x = r.r(-P, W + P);
          this.c.ellipse(x - size / 2, y - size * 0.15, size, size * 0.3, r.next() < 0.5 ? p.tex[0] : p.tex[1], r.r(0.1, 0.3) * (L === "field" ? 0.5 : 1));
        }
        if (this.spec.season === "spring" && !this.snow && L !== "field" && L !== "mountain") {
          for (let k = 0; k < 10; k++) {
            const d = r.r(0.05, 0.6), side = r.next() < 0.5 ? -1 : 1, cx = tcx(tr, d) + side * (thw(tr, d) + r.r(20, 300) * d);
            for (let i = 0; i < 14; i++) { const rr = 0.8 + d * 3.5; this.c.ellipse(cx + r.r(-40, 40) * d * 2, ty(tr, d) + r.r(-6, 6) * d * 2, rr * 2, rr, this.tint(0xF6F4EC, 0.8), 0.75); }
          }
        }
        if ((this.spec.season === "autumn" || this.spec.season === "lateAutumn") && !this.snow && L !== "mountain" && L !== "field") {
          const fallen = p.leaves.length ? p.leaves : [this.tint(0x9A6A3A), this.tint(0x7E5A34)];
          for (let i = 0; i < 220 * this.lod; i++) { const d = Math.pow(r.next(), 0.6), y = ty(tr, d), rr = 0.8 + d * 5; this.c.ellipse(r.r(-P, W + P) - rr, y - rr * 0.3, rr * 2, rr * 0.7, r.pick(fallen), 0.5); }
        }
        if (L === "mountain" && !this.snow) {
          const shrub = this.spec.season === "autumn" ? this.tint(0xA8452A) : this.spec.season === "summer" ? this.tint(0x4E5E2E) : this.tint(0x6A5A44);
          const heather = this.spec.season === "autumn" ? this.tint(0xC0783A) : this.tint(0x7A5E48);
          for (let i = 0; i < ((220 * W) / 600) * this.lod; i++) {
            const d = Math.pow(r.next(), 0.7), size = 6 + d * 90 * r.r(0.5, 1.2), k = r.next();
            this.c.ellipse(r.r(-P, W + P) - size / 2, ty(tr, d) - size * 0.15, size, size * 0.3, k < 0.35 ? this.tint(0xD6D4BC) : k < 0.7 ? shrub : heather, r.r(0.15, 0.32));
          }
        }
      });
      if (L === "mountain") this.rocks();
      if (L === "forest" || L === "mountain") this.band(p.forest.near, this.snow ? 0.18 : 0.35, top + 30, 30, 110);
    });
    if (L === "coast") this.slabs();
    // the trail
    const path = outline(tr, 1, 0.04), tcl = this.c.clip(path);
    this.c.group(`clip-path="url(#${tcl})"`, () => {
      const g = this.c.linear([[0, p.path[0], 1], [1, p.path[1], 1]], 0, tr.vy, 0, H);
      this.c.raw(`<path d="${path}" fill="url(#${g})"/>`);
      this.c.fill(outline(tr, 0.55, 0.045), p.wear, 0.14); this.c.fill(outline(tr, 0.3, 0.045), p.wear, 0.16);
      if (L === "field" && !this.snow) this.c.fill(outline(tr, 0.09, 0.05), p.grass, 0.55);
      const light = mix(p.wear, 0xFFFFFF, 0.3), dark = mix(p.path[1], 0x000000, 0.35);
      this.c.bucket(() => {
        for (let i = 0; i < (L === "city" ? 180 : 320) * this.lod; i++) {
          const d = Math.pow(r.next(), 0.55), y = ty(tr, d), x = tcx(tr, d) + r.r(-0.95, 0.95) * thw(tr, d), rr = 0.6 + d * r.r(1.2, L === "mountain" ? 6 : 4.4);
          this.c.ellipse(x - rr, y - rr * 0.5, rr * 2, rr, r.next() < 0.5 ? light : dark, 0.3);
        }
      });
      if (this.spec.weather === "rain") {
        for (const d0 of [0.16, 0.3, 0.52, 0.8]) {
          const d = d0 * r.r(0.9, 1.1), w = thw(tr, d) * r.r(0.35, 0.8), x = tcx(tr, d) + r.r(-0.5, 0.3) * thw(tr, d), h = w * r.r(0.12, 0.2), y = ty(tr, d);
          this.c.ellipse(x - w / 2 - w * 0.04, y - w * 0.01, w * 1.08, h + w * 0.02, mix(p.path[1], 0x000000, 0.2), 0.5);
          this.c.ellipse(x - w / 2, y, w, h, p.sky[p.sky.length - 1][1], 0.45);
        }
        this.c.fill(outline(tr, 0.28, 0.03), 0xB4C0CA, 0.16);
      }
      if (this.snow) {
        const track = mix(p.tex[1], 0x8FA2B8, 0.5);
        for (const off of [-0.22, 0.22]) {
          const pts: number[][] = [];
          for (let d = 0.03; d <= 1; d += 0.02) pts.push([tcx(tr, d) + off * thw(tr, d), ty(tr, d)]);
          this.c.stroke(poly(pts, false), track, 0.35, 2.5);
        }
      }
      this.c.flush();
    });
    // the verges: grass tufts (or snow banks) spilling over both edges
    this.c.bucket(() => {
      for (const side of [-1, 1]) for (let i = 0; i < 120 * this.lod; i++) {
        const d = Math.pow(r.next(), 0.6), y = ty(tr, d), x = tcx(tr, d) + side * thw(tr, d) * r.r(0.9, 1.12);
        if (this.snow) { const rr = 2 + d * 26; this.c.ellipse(x - rr, y - rr * 0.35, rr * 2, rr * 0.6, r.next() < 0.6 ? p.snowTone : p.tex[1], 0.7); }
        else {
          const len = (2 + d * 26) * (L === "city" ? 0.5 : 1);
          this.c.stroke(`M${f(x)} ${f(y)}l${f(r.r(-0.45, 0.45) * len)} ${f(-len * r.r(0.6, 1))}M${f(x)} ${f(y)}l${f(r.r(-0.45, 0.45) * len)} ${f(-len * r.r(0.6, 1))}`,
            r.next() < 0.5 ? p.grass : mix(p.grass, p.tex[0], 0.5), 0.65, Math.round((0.5 + d * 1.6) * 2) / 2);
        }
      }
    });
    return region;
  }
  rocks() {
    const r = this.rng, tr = this.tr, col = mix(this.tint(0x9A9A96), this.pal.ground[0], 0.25);
    for (let i = 0; i < 20; i++) {
      const d = Math.pow(r.next(), 0.8), y = ty(tr, d), rad = 4 + d * 46 * r.r(0.5, 1), side = r.next() < 0.5 ? -1 : 1;
      const x = tcx(tr, d) + side * (thw(tr, d) + rad * 0.7 + r.r(0, 260) * Math.max(0.15, d)), stone = this.snow ? mix(col, this.pal.snowTone, 0.55) : col;
      this.c.ellipse(x - rad * 1.15, y - rad * 0.12, rad * 2.3, rad * 0.4, this.pal.ground[1], 0.35);
      const pts = Array.from({ length: 7 }, (_, k) => { const a = (k / 7) * 2 * Math.PI + r.r(-0.3, 0.3), rr = rad * r.r(0.75, 1.15); return [x + Math.cos(a) * rr, Math.min(y, y - rad * 0.4 + Math.sin(a) * rr * 0.55)]; });
      const mid = (k: number) => { const a = pts[k % 7], b = pts[(k + 1) % 7]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
      const d0 = mid(6);
      const dd = `M${f(d0[0])} ${f(d0[1])}` + pts.map((p, k) => { const m = mid(k); return `Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`; }).join("") + "Z";
      this.c.fill(dd, stone);
      const g = this.c.linear([[0, 0xFFFFFF, this.snow ? 0.35 : 0.22], [0.5, 0xFFFFFF, 0], [1, 0x000000, 0.25]], 0, y - rad * 0.95, 0, y);
      this.c.raw(`<path d="${dd}" fill="url(#${g})"/>`);
    }
  }
  slabs() {
    const r = this.rng, tr = this.tr, p = this.pal;
    [0, 0.012, 0.03, 0.75].forEach((d0, i) => {
      const d = d0 * r.r(0.85, 1.15), side = (i % 2 === 0) === this.pl.flip ? 1 : -1, atShore = i < 3;
      const w = atShore ? r.r(200, 320) : 80 + d * 900 * r.r(0.8, 1.1), hgt = w * r.r(0.06, 0.09);
      const x = tcx(tr, d) + side * (thw(tr, d) + w * 0.42 + r.r(10, 90) * Math.max(d, 0.1)), y = atShore ? this.shoreY(x) + hgt * 0.5 : ty(tr, d) + hgt * 0.4;
      const dip = r.r(0.55, 0.85);
      const dd = `M${f(x - w / 2)} ${f(y)}C${f(x - w * 0.46)} ${f(y - hgt * 0.6)} ${f(x - w * 0.34)} ${f(y - hgt)} ${f(x - w * 0.18)} ${f(y - hgt)}Q${f(x - w * 0.03)} ${f(y - hgt * dip)} ${f(x + w * 0.12)} ${f(y - hgt * 0.95)}C${f(x + w * 0.3)} ${f(y - hgt * 0.95)} ${f(x + w * 0.44)} ${f(y - hgt * 0.4)} ${f(x + w / 2)} ${f(y)}Z`;
      this.c.ellipse(x - w * 0.52, y - hgt * 0.12, w * 1.04, hgt * 0.4, p.ground[1], 0.35);
      this.c.fill(dd, this.snow ? mix(p.rock[1], p.snowTone, 0.5) : p.rock[1]);
      const g = this.c.linear([[0, this.snow ? p.snowTone : p.rock[0], 0.95], [0.55, p.rock[0], 0.4], [1, p.rock[1], 0]], 0, y - hgt, 0, y);
      this.c.raw(`<path d="${dd}" fill="url(#${g})"/>`);
      for (let k = 0; k < 3; k++) { const cx = x + r.r(-0.4, 0.4) * w; this.c.stroke(`M${f(cx)} ${f(y - hgt * 0.95)}Q${f(cx + r.r(-0.06, 0.06) * w)} ${f(y - hgt * 0.5)} ${f(cx + r.r(-0.1, 0.1) * w)} ${f(y)}`, mix(p.rock[1], 0x000000, 0.3), 0.35, 0.6 + d * 2); }
    });
    for (let i = 0; i < 7; i++) {
      const d = r.r(0.08, 0.5), side = r.next() < 0.5 ? -1 : 1, h = 16 + d * 200, x = tcx(tr, d) + side * (thw(tr, d) + r.r(30, 260) * d + h * 0.3), y = ty(tr, d);
      this.c.ellipse(x - h * 0.3, y - h * 0.06, h * 0.6, h * 0.12, p.ground[1], 0.3);
      this.spruce(x, y, h, h * r.r(0.4, 0.55), mix(p.forest.mid, this.tint(0x3C5A40), 0.5), p.lit, this.snow);
    }
  }
  fields(top: number) {
    const r = this.rng, p = this.pal, tr = this.tr, mid = top + 70, P = this.P, W = this.W, H = this.H;
    this.c.fill(`M${f(-P)} ${f(top)}H${f(W + P)}V${f(mid)}H${f(-P)}Z`, p.crop[0]);
    this.c.fill(`M${f(-P)} ${f(mid)}H${f(W + P)}V${f(H + P)}H${f(-P)}Z`, p.crop[1]);
    const g = this.c.linear([[0, p.ground[1], 0], [1, p.ground[1], 0.35]], 0, mid, 0, H);
    this.c.raw(`<rect x="${f(-P)}" y="${f(mid)}" width="${f(W + 2 * P)}" height="${f(H + P - mid)}" fill="url(#${g})"/>`);
    const a = mix(p.crop[1], 0xFFFFFF, 0.18), b = mix(p.crop[1], 0x000000, 0.25), da: string[] = [], db: string[] = [];
    for (let i = -60; i <= 60; i++) (i % 2 === 0 ? da : db).push(`M${f(tr.vx + i * 0.9)} ${f(mid)}L${f(tr.vx + i * 24)} ${f(H + P)}`);
    this.c.raw(`<path d="${da.join("")}" stroke="${hex(a)}" stroke-opacity="0.22" stroke-width="3" fill="none"/><path d="${db.join("")}" stroke="${hex(b)}" stroke-opacity="0.22" stroke-width="3" fill="none"/>`);
    const hedge = mix(p.forest.mid, p.haze[0], 0.15);
    for (let x = -P; x < W + P;) { const rr = r.r(4, 9); this.c.ellipse(x, mid - rr * 1.2, rr * 2.4, rr * 1.4, hedge, 0.95); x += rr * 1.4; }
    if (!this.snow && (this.spec.season === "summer" || this.spec.season === "autumn")) {
      const col = r.next() < 0.6 ? this.tint(0xF1F1EC, 0.9) : this.tint(0xD9B86A);
      for (let i = 0; i < 3 + Math.floor(r.next() * 4); i++) {
        const y = r.r(top + 14, mid - 10), rr = 2.5 + (y - top) * 0.09, bx = this.pl.flip ? r.r(W * 0.08, W * 0.4) : r.r(W * 0.6, W * 0.92), shade = mix(col, p.forest.near, 0.35);
        this.c.ellipse(bx - rr * 1.3, y - rr * 0.15, rr * 2.6, rr * 0.5, p.forest.near, 0.25);
        this.c.fill(`M${f(bx - rr * 0.6)} ${f(y)}h${f(rr * 1.2)}v${f(-rr * 1.6)}h${f(-rr * 1.2)}Z`, shade);
        this.c.ellipse(bx - rr, y - rr * 1.6, rr * 0.8, rr * 1.6, shade); this.c.ellipse(bx + rr * 0.2, y - rr * 1.6, rr * 0.8, rr * 1.6, col);
      }
    }
  }

  // trees beside the trail
  sideRow(d: number, density: number, o: { hScale?: number; pines?: number; edges?: number } = {}) {
    const r = this.rng, tr = this.tr, p = this.pal, hBase = d * 1700 * (o.hScale ?? 1), t = Math.min(1, d / 0.45);
    const color = mix(mix(p.forest.mid, p.forest.near, t), p.haze[0], (1 - t) * 0.12);
    const trunkTone = mix(p.forest.mid, 0xA0603A, p.lit && this.spec.time !== "night" ? 0.35 : 0.1);
    const open = this.L === "lake" || this.L === "coast", opening = open ? this.W * 0.42 * Math.max(0, 1 - d / 0.4) : this.L === "forest" ? this.W * 0.1 * Math.max(0, 1 - d / 0.2) : 0;
    const trees: { x: number; b: number; h: number; w: number; pine: boolean }[] = [];
    for (let x = -this.P; x < this.W + this.P;) {
      let h = hBase * r.r(0.6, 1.15);
      const w = h * r.r(0.27, 0.36), b = ty(tr, d) + r.r(-0.04, 0.04) * hBase, minTop = (x < this.W * 0.5 ? this.H * 0.21 : this.H * 0.12) * r.r(1, 1.3);
      if (b - h < minTop) h = b - minTop;
      const keep = r.next() > 0.18, pine = r.next() < (o.pines ?? 0);
      let ok = Math.abs(x - tcx(tr, d)) > thw(tr, d) * 1.15 + w * 0.3 + opening && keep && h > 4;
      if (o.edges !== undefined) ok = ok && (x < this.W * o.edges || x > this.W * (1 - o.edges));
      if (ok) trees.push({ x, b, h, w, pine });
      x += (w * r.r(0.4, 0.75)) / density;
    }
    for (const q of trees) this.c.ellipse(q.x - q.w * 0.3, q.b - q.w * 0.05, q.w * 0.6, q.w * 0.12, p.forest.near, this.snow ? 0.12 : 0.22);
    for (const q of trees.sort((a, b) => a.b - b.b)) {
      if (q.pine && this.L === "coast") this.pine(q.x, q.b, q.h * 0.7, q.w * 1.1, color, trunkTone, this.snow, this.pl.flip ? -0.1 : 0.1, 1.8);
      else if (q.pine) this.pine(q.x, q.b, q.h * 1.1, q.w * 1.1, color, trunkTone, this.snow);
      else this.spruce(q.x, q.b, q.h, q.w, color, p.lit, this.snow);
    }
  }

  paint(): { defs: string; body: string } {
    const p = this.pal, s = this.spec, L = this.L, r = this.rng, W = this.W, H = this.H, P = this.P, hz = this.hz, tr = this.tr, c = this.c;
    const [sx, sy] = this.sun, dark = s.time === "night" || s.time === "dusk", rel = s.relief, clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    const trunkTone = mix(p.forest.mid, 0xA0603A, p.lit && s.time !== "night" ? 0.35 : 0.1);

    // the sky
    this.layer(0, () => {
      const g = c.linear(p.sky.map(([o, col]) => [o, col, 1] as [number, number, number]), 0, 0, 0, hz);
      c.raw(`<rect x="${f(-P)}" y="${f(-P)}" width="${f(W + 2 * P)}" height="${f(H + 2 * P)}" fill="url(#${g})"/>`);
      if (p.sun) c.radial(sx, sy, p.sun.glow, p.sun.color, p.sun.alpha);
      if (p.moon) c.radial(sx, sy, 260, 0x9FB4E2, 0.3, 0.25);
    });
    if (p.stars > 0) this.layer(0.6, () => c.bucket(() => {
      for (let i = 0; i < ((p.stars * W) / 600) * this.lod; i++) { const y = Math.pow(r.next(), 1.4) * hz * 0.85, rr = r.r(0.6, 1.5); c.ellipse(r.r(0, W), y, rr * 2, rr * 2, 0xDDE6FF, r.r(0.2, 0.75) * (1 - (y / hz) * 0.6)); }
    }));
    if (p.moon) this.layer(1.2, () => { c.ellipse(sx - 17, sy - 17, 34, 34, 0xE4EAF6); for (let i = 0; i < 5; i++) { const q = r.r(3, 7); c.ellipse(sx + r.r(-10, 6), sy + r.r(-10, 6), q, q, 0xB9C4DA, 0.5); } });
    if (p.clouds.kind !== "none" && p.clouds.n > 0) this.layer(p.clouds.kind === "cumulus" ? 12 : 10, () => this.clouds());
    if (p.sun && p.sun.disk > 0) { const sun = p.sun; this.layer(5, () => { c.radial(sx, sy, sun.disk * 3, 0xFFFFFF, 0.6); c.ellipse(sx - sun.disk, sy - sun.disk, 2 * sun.disk, 2 * sun.disk, mix(sun.color, 0xFFFFFF, 0.6)); }); }

    // the distance (kept as groups, so the water can mirror them)
    const distance = () => {
      if (L === "mountain") {
        const amp = 170 + 210 * clamp01((rel - 150) / 900), o = this.profileRidge(hz - 6, amp, p.rock[0], true);
        this.snowCaps(o, hz - 6 - amp * (this.snow ? 0.35 : s.season === "summer" ? 0.8 : 0.62), mix(p.snowTone, p.haze[0], 0.15));
        this.band(p.haze[0], p.haze[1] * 0.7, hz - 10, 220, 60);
        const near = this.profileRidge(hz + 10, 70, p.rock[1], true);
        if (this.snow) this.snowCaps(near, hz - 30, mix(p.snowTone, p.haze[0], 0.25));
        this.band(p.haze[0], p.haze[1] * 0.6, hz, 120, 50);
      } else if (L === "coast") {
        this.profileRidge(hz + 2, 40 + 110 * clamp01(rel / 250), mix(p.hills[1], p.forest.far, 0.3), false, this.pl.flip ? [-W * 0.05, W * 0.55] : [W * 0.45, W * 1.05]);
        this.band(p.haze[0], p.haze[1] * 0.55, hz - 6, 160, 30);
      } else if (L === "city") {
        this.profileRidge(hz + 2, 25 + 45 * clamp01(rel / 100), p.hills[0], false);
        this.band(p.haze[0], p.haze[1] * 0.8, hz - 10, 200, 60);
      } else {
        const amp = L === "field" ? 35 + 80 * clamp01(rel / 150) : L === "lake" ? 45 + 120 * clamp01(rel / 250) : 60 + 170 * clamp01(rel / 250);
        this.profileRidge(L === "forest" ? hz - 42 : hz - 16, amp, p.hills[0], false);
        this.band(p.haze[0], p.haze[1] * 0.55, hz - 10, 200, 60);
        this.ridge(hz + 10, 45, p.hills[1]);
        this.band(p.haze[0], p.haze[1] * 0.7, hz, 120, 50);
      }
      c.flush();
    };
    const edge = () => {
      if (L === "mountain") {
        this.fellSide();
        this.crownRow(hz + 8, 8, 22, 6, mix(p.crowns.length ? mix(p.crowns[0], p.forest.far, 0.45) : p.forest.far, p.haze[0], 0.3));
        this.treeRow({ base: hz + 12, jitter: 3, hMin: 10, hMax: 30, spacing: 26, edge: 0.3, color: mix(p.forest.far, p.haze[0], 0.2), trunk: p.forest.far, lit: null, pines: 0 });
        this.band(p.haze[0], p.haze[1] * 0.35, hz + 6, 40, 20);
      } else if (L === "city") {
        this.skyline(hz + 8, mix(p.hills[1], p.haze[0], 0.3), dark);
        this.band(p.haze[0], p.haze[1] * 0.5, hz + 4, 90, 20);
        this.crownRow(hz + 18, 12, 30, 10, mix(p.crowns.length ? mix(p.crowns[0], p.forest.far, 0.5) : mix(p.forest.far, p.haze[0], 0.2), p.haze[0], 0.3), (x) => Math.sin(x * 0.012 + 1.3) > -0.35);
        this.band(p.haze[0], p.haze[1] * 0.4, hz + 14, 60, 20);
      } else if (L !== "coast") {
        const k = L === "lake" ? 0.75 : 1;
        this.treeRow({ base: hz + 4, jitter: 3, hMin: 12 * k, hMax: 38 * k, spacing: 6, edge: 0.4, color: mix(p.forest.far, p.haze[0], 0.35), trunk: mix(p.forest.far, p.haze[0], 0.35), lit: null, pines: 0, mass: true });
        this.band(p.haze[0], p.haze[1] * 0.5, hz + 4, 60, 20);
        this.treeRow({ base: hz + 14, jitter: 4, hMin: 22 * k, hMax: 70 * k, spacing: 8, edge: 0.6, color: p.forest.far, trunk: p.forest.far, lit: null, pines: 0, mass: true });
        this.band(p.haze[0], p.haze[1] * 0.55, hz + 10, 90, 30);
      }
      if (L === "field") this.barn(this.pl.flip ? W * 0.8 : W * 0.2, hz + 16, 30);
      c.flush();
    };
    const distId = c.uid("dist"), edgeId = c.uid("edge");
    this.layer(7, () => { c.raw(`<g id="${distId}">`); distance(); c.raw("</g>"); });
    this.layer(4.5, () => { c.raw(`<g id="${edgeId}">`); edge(); c.raw("</g>"); });
    if (p.rays && p.sun && (L === "forest" || L === "lake")) {
      const sun = p.sun;
      this.layer(16, () => { for (let i = 0; i < 11; i++) { const a = r.r(0.15, Math.PI - 0.15) + (r.next() < 0.5 ? 0 : Math.PI), w = r.r(0.02, 0.05); c.fill(poly([[sx, sy], [sx + Math.cos(a - w) * 1100, sy + Math.sin(a - w) * 1100], [sx + Math.cos(a + w) * 1100, sy + Math.sin(a + w) * 1100]]), sun.color, r.r(0.05, 0.11)); } });
    }
    if (L === "lake" || L === "coast") {
      const top = L === "lake" ? hz + 12 : hz + 1, bottom = this.groundTop + 16;
      this.layer(2.2, () => { this.water(top, bottom); if (L === "coast") this.islands(top); });
      if (!(this.snow && L === "lake")) {
        const cl = c.clip(`M${f(-P)} ${f(top)}H${f(W + P)}V${f(bottom)}H${f(-P)}Z`);
        this.layer(L === "lake" ? 4 : 6, () => c.raw(`<g clip-path="url(#${cl})"><g opacity="${L === "lake" ? 0.55 : 0.3}" transform="matrix(1 0 0 -1 0 ${f(2 * top)})"><use href="#${distId}"/><use href="#${edgeId}"/></g></g>`));
      }
      if (L === "lake") this.layer(1.6, () => this.reeds());
    }
    if (p.mist > 0 || (L === "lake" && (s.time === "dawn" || s.time === "dusk") && s.weather !== "rain")) {
      const mist = Math.max(p.mist, L === "lake" ? 0.3 : 0);
      this.layer(12, () => { for (let i = 0; i < (9 * W) / 600; i++) { const w = r.r(200, 460), y = (L === "lake" ? hz + 40 : hz) + r.r(-40, 40); c.ellipse(r.r(-200, W - 100), y, w, r.r(18, 40), p.haze[0], mist * r.r(0.5, 1)); } });
    }

    // the ground, sharp beyond the middle, softer towards the bottom (a blurred copy fading in)
    const gId = c.uid("gnd"), fade = c.linear([[0, 0xFFFFFF, 0], [1, 0xFFFFFF, 1]], 0, this.groundTop + 244, 0, H), mId = c.uid("m");
    c.defs.push(`<mask id="${mId}" maskUnits="userSpaceOnUse" x="${f(-P)}" y="${f(-P)}" width="${f(W + 2 * P)}" height="${f(H + 2 * P)}"><rect x="${f(-P)}" y="${f(-P)}" width="${f(W + 2 * P)}" height="${f(H + 2 * P)}" fill="url(#${fade})"/></mask>`);
    this.layer(2.2, () => { c.raw(`<g id="${gId}">`); this.ground(); c.flush(); c.raw("</g>"); });
    this.layer(6, () => c.raw(`<use href="#${gId}"/>`), `mask="url(#${mId})"`);

    // the trees beside the trail
    const avenue = (d0: number, d1: number) => {
      const side = this.pl.flip ? -1 : 1, glow = dark || s.weather === "rain" || s.weather === "fog";
      for (let d = 0.05; d < 0.6; d *= 1.4) if (d >= d0 && d < d1) {
        this.parkTree(tcx(tr, d) + side * (thw(tr, d) + 120 * d + 16), ty(tr, d), d * 900, mix(p.forest.near, 0x3A2A20, 0.3));
        this.lamp(tcx(tr, d) - side * (thw(tr, d) + 26 * d + 6), ty(tr, d), d * 360, glow);
      }
    };
    if (L === "forest") {
      this.layer(3, () => {
        this.treeRow({ base: hz + 46, jitter: 8, hMin: 48, hMax: 115, spacing: 22, edge: 1.9, color: mix(p.forest.mid, p.haze[0], 0.12), trunk: trunkTone, lit: p.lit, pines: 0, mass: true });
        if (s.season === "autumn" && p.crowns.length) for (let i = 0; i < W / 60; i++) {
          const x = r.r(-20, W + 20), y = hz + 46 + r.r(-30, 10), rr = r.r(14, 30);
          if (Math.abs(x - tcx(tr, 0.03)) < 60) continue;
          for (let k = 0; k < 10; k++) { const a = r.r(0, 2 * Math.PI), q = rr * Math.sqrt(r.next()), e = rr * r.r(0.3, 0.5); c.ellipse(x + Math.cos(a) * q - e, y - rr + Math.sin(a) * q * 0.9 - e, e * 2, e * 1.7, r.pick(p.crowns), 0.85); }
        }
        this.band(p.haze[0], p.haze[1] * 0.2, hz + 16, 120, 40);
      });
      this.layer(3.2, () => { this.sideRow(0.08, 1); this.sideRow(0.115, 0.9); });
      this.layer(3.8, () => this.sideRow(0.165, 0.8));
      this.layer(4.6, () => this.sideRow(0.25, 0.7));
    } else if (L === "mountain") {
      this.layer(3.6, () => this.sideRow(0.165, 0.16, { hScale: 0.5 }));
      this.layer(4.6, () => this.sideRow(0.25, 0.18, { hScale: 0.55 }));
    } else if (L === "lake") {
      this.layer(3.8, () => this.sideRow(0.165, 0.8));
      this.layer(4.6, () => this.sideRow(0.25, 0.7));
    } else if (L === "coast") {
      this.layer(4.2, () => this.sideRow(0.2, 0.3, { hScale: 0.75, pines: 0.9 }));
    } else if (L === "city") {
      this.layer(3, () => {
        for (let i = 0; i < 4; i++) {
          const fr = i / 3, y = hz + 26 + fr * 70 + r.r(-8, 8), side = (i % 2 === 0) === this.pl.flip ? 1 : -1;
          this.parkTree(tcx(tr, 0.05) + side * r.r(W * 0.18, W * 0.5), y, 46 + (y - hz) * 1.1, mix(p.forest.mid, 0x3A2A20, 0.3));
        }
        this.band(p.haze[0], p.haze[1] * 0.15, hz + 20, 100, 30);
      });
      this.layer(3.4, () => avenue(0, 0.2));
      this.layer(5.5, () => avenue(0.2, 1));
    } else {
      this.layer(3.2, () => this.parkTree(this.pl.flip ? W * 0.22 : W * 0.8, hz + 60, 120, mix(p.forest.near, 0x3A2A20, 0.3)));
      this.layer(5, () => this.sideRow(0.3, 0.5, { edges: 0.1 }));
    }
    const birches = L === "forest" ? this.pl.birches : L === "lake" ? 2 : L === "mountain" ? this.pl.birches + 2 : 0;
    if (birches > 0) this.layer(3.4, () => {
      for (let i = 0; i < birches; i++) {
        const side = i % 2 === 0 ? -1 : 1, d = L === "mountain" ? r.r(0.12, 0.3) : L === "lake" ? r.r(0.14, 0.2) : r.r(0.18, 0.22);
        const x = tcx(tr, d) + side * (thw(tr, d) + r.r(25, L === "lake" ? 60 : 110) + (L === "lake" ? W * 0.3 * (1 - d / 0.4) : 0));
        const h = L === "mountain" ? d * r.r(700, 1000) : Math.min(d * r.r(2000, 2400), ty(tr, d) - H * 0.24);
        this.birch(x, ty(tr, d), h, p.bark, mix(p.forest.near, 0x000000, 0.4), p.leaves, -(p.lit?.side ?? 1), L === "mountain");
      }
    });
    if (L !== "city" && L !== "field") this.layer(6.5, () => {
      if (L === "forest") { this.sideRow(0.36, 0.6); this.sideRow(0.52, 0.55); }
      else if (L === "lake") { this.sideRow(0.36, 0.5); this.sideRow(0.52, 0.5); }
      else if (L === "mountain") this.sideRow(0.42, 0.18, { hScale: 0.5 });
      else this.sideRow(0.45, 0.22, { hScale: 0.7, pines: 0.9 });
      for (const side of [0, 1]) c.radial(side * W, hz + 420, 300, p.forest.near, L === "forest" || L === "lake" ? 0.4 : 0.2);
    });

    // weather over everything
    if (p.fog > 0 || p.mist > 0.3) this.layer(24, () => {
      const g = c.linear([[0, p.haze[0], p.fog * 0.4], [0.42, p.haze[0], Math.min(1, p.fog * 1.1)], [0.6, p.haze[0], p.fog * 0.8], [1, p.haze[0], p.fog * 0.3]], 0, 0, 0, H);
      c.raw(`<rect x="${f(-P)}" y="${f(-P)}" width="${f(W + 2 * P)}" height="${f(H + 2 * P)}" fill="url(#${g})"/>`);
      for (let i = 0; i < 5; i++) { const w = r.r(400, 800), y = r.r(hz - 80, hz + 300); c.ellipse(r.r(-300, W - 100), y, w, r.r(30, 80), p.haze[0], p.mist * r.r(0.25, 0.45)); }
    });
    if (s.weather === "rain") {
      this.layer(14, () => this.band(p.haze[0], 0.3, hz, 300, 300));
      const streak = mix(0xDDE6EE, p.light[0], p.light[1] * 0.5);
      this.layer(1.1, () => c.bucket(() => { for (let i = 0; i < ((300 * W) / 600) * this.lod; i++) { const x = r.r(-60, W + 60), y = r.r(-P, H), l = r.r(28, 80); c.stroke(`M${f(x)} ${f(y)}l${f(-l * 0.16)} ${f(l)}`, streak, r.r(0.1, 0.3), 1.1); } }));
    }
    if (s.weather === "snow") {
      const flake = mix(0xFFFFFF, p.light[0], p.light[1] * 0.4);
      this.layer(0.7, () => c.bucket(() => { for (let i = 0; i < ((260 * W) / 600) * this.lod; i++) { const rr = r.r(1.2, 2.8) / Math.sqrt(this.lod); c.ellipse(r.r(0, W), r.r(0, H), rr, rr, flake, r.r(0.45, 0.9)); } }));
      this.layer(3.5, () => { for (let i = 0; i < (26 * W) / 600; i++) { const rr = r.r(5, 10); c.ellipse(r.r(0, W), r.r(H * 0.3, H), rr, rr, flake, 0.45); } });
    }
    if (p.vignette > 0) {
      const id = c.uid("v"), rad = Math.hypot(W / 2, H / 2) * 1.12;
      c.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(W / 2)}" cy="${f(H / 2)}" r="${f(rad)}"><stop offset="0" stop-opacity="0"/><stop offset="0.55" stop-opacity="0"/><stop offset="1" stop-opacity="${p.vignette}"/></radialGradient>`);
      c.raw(`<rect x="${f(-P)}" y="${f(-P)}" width="${f(W + 2 * P)}" height="${f(H + 2 * P)}" fill="url(#${id})"/>`);
    }
    c.flush();
    const filters = [...this.sigmas].map((sg) => `<filter id="${c.id}b${String(sg).replace(".", "_")}" filterUnits="userSpaceOnUse" x="${f(-P)}" y="${f(-P)}" width="${f(W + 2 * P)}" height="${f(H + 2 * P)}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${sg}"/></filter>`);
    return { defs: filters.join("") + c.defs.join(""), body: c.out.join("") };
  }
}

// ------------------------------------------------------------------------------------------------------------- output

export type SceneOptions = {
  /** The picture's size in pixels (the viewBox keeps the scene's own units). */
  width: number; height: number;
  /** A prefix for every id (gradients, clips, filters), so several scenes and other inline SVGs can share a page. Default "s". */
  idPrefix?: string;
  /** Film grain (feTurbulence, overlaid). Default true. */
  grain?: boolean;
};

/** The scene's defs and body in its own units (0 … width, 0 … 1300), for embedding: `<g transform="scale(k)">body</g>` with the
 *  defs in the host's <defs>. `unitsWide` is the width in scene units. */
export function sceneLayers(spec: SceneSpec, o: SceneOptions): { defs: string; body: string; unitsWide: number } {
  const W = (1300 * o.width) / Math.max(1, o.height), id = (o.idPrefix ?? "s").replace(/[^A-Za-z0-9_-]/g, "");
  const { defs, body } = new Painter(spec, W, id, o.height / 1300).paint();
  if (o.grain === false) return { defs, body, unitsWide: W };
  const gid = `${id}grain`;
  const grain = `<filter id="${gid}" filterUnits="userSpaceOnUse" x="0" y="0" width="${f(W)}" height="1300" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="${spec.seed % 1000}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1"/></filter>`;
  return { defs: defs + grain, body: body + `<rect width="${f(W)}" height="1300" filter="url(#${gid})" opacity="0.07" style="mix-blend-mode:overlay"/>`, unitsWide: W };
}

/** The scene as a whole SVG document at width × height pixels. `preserveAspectRatio="xMidYMid slice"`, so as a CSS background or an
 *  <img> with object-fit it covers any box, keeping the trail in the middle. */
export function sceneSvg(spec: SceneSpec, o: SceneOptions): string {
  const { defs, body, unitsWide } = sceneLayers(spec, o);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${f(unitsWide)} 1300" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;
}
