// Course maps for the race pages (site-calm, Patrik 2026-11-02: "det går inte få en karta här"): a calm, dark map under each published
// course line, drawn at build time and served as the site's own WebP. The visitor's browser asks no map provider for anything (the CSP
// and the no-third-party rule stay): only this build reads map data.
//
// Data: OpenStreetMap through Protomaps' daily basemap build (a PMTiles archive, ODbL, "© OpenStreetMap contributors" on the page).
// The build is read with range requests for the few tiles a new or changed course needs (as `pmtiles extract` does), never by a visitor;
// a course's map is drawn again only when its course or this style changes (the hash in lopp/slugs.json), not when OSM does.
// Drawing: the tiles' roads, paths, water, forest and parks and a few place names become SVG in the race page's own route frame (the
// same equirectangular frame as routeSvg, so the page's course line lies exactly on top), rasterised with resvg and encoded with cwebp
// at 1x (600 wide) and 2x. Pure parts (frame, projection, tiles, drawing) are tested in tests/race_maps_test.ts without network.

/** Bumped when the drawing changes: every map is drawn again. */
export const MAP_STYLE = "calm-2";
/** Where the daily builds are listed and served. */
export const PROTOMAPS_BUILDS = "https://build-metadata.protomaps.dev/builds.json";
export const PROTOMAPS_BASE = "https://build.protomaps.com/";
/** The longest one course's map may take (tiles, two renders, two encodes; normally 2–5 s). */
export const MAP_TIMEOUT_MS = 60_000;

type Pt = [number, number, ...number[]];

/** The route figure's frame: 600 wide, as tall as the course needs (190 … ~470), the course fitted with padding and room for the
 *  scale bar below. routeSvg draws in it, and the map is drawn in exactly the same frame. */
export type Frame = { W: number; H: number; lat0: number; s: number; x0: number; y0: number; ox: number; oy: number; pad: number };
export function routeFrame(pts: Pt[]): Frame {
  const W = 600, pad = 26, lat0 = (pts[0][0] * Math.PI) / 180;
  const xs = pts.map((p) => p[1] * Math.cos(lat0)), ys = pts.map((p) => -p[0]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), dx = Math.max(Math.max(...xs) - x0, 1e-4), dy = Math.max(Math.max(...ys) - y0, 1e-4);
  const s = Math.min((W - 2 * pad) / dx, (440 - 2 * pad) / dy), H = Math.max(Math.round(dy * s + 2 * pad + 30), 190);
  const ox = (W - dx * s) / 2, oy = 14 + (H - 30 - dy * s) / 2;
  return { W, H, lat0, s, x0, y0, ox, oy, pad };
}
/** A point (degrees) in the frame (pixels at 1x). */
export const project = (f: Frame, lat: number, lon: number): [number, number] => [f.ox + (lon * Math.cos(f.lat0) - f.x0) * f.s, f.oy + (-lat - f.y0) * f.s];
/** A frame pixel back to degrees. */
export const unproject = (f: Frame, x: number, y: number): [number, number] => [-((y - f.oy) / f.s + f.y0), ((x - f.ox) / f.s + f.x0) / Math.cos(f.lat0)];
/** The frame's corners in degrees. */
export function frameBounds(f: Frame): { s: number; w: number; n: number; e: number } {
  const [n, w] = unproject(f, 0, 0), [s, e] = unproject(f, f.W, f.H);
  return { s, w, n, e };
}

/** Web Mercator tile of a point at zoom z (fractional). */
const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat: number, z: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const lonOf = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latOf = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** The tile zoom for the frame drawn at `scale` (2 for the 2x image): the coarsest zoom whose 512 px tiles hold at least half the
 *  detail drawn (vector tiles scale well), 6 … 15 (the build's deepest), and at most `maxTiles` tiles. */
export function mapZoom(f: Frame, scale = 2, maxTiles = 36): number {
  const pxPerDegLon = f.s * Math.cos(f.lat0) * scale;
  let z = Math.min(15, Math.max(6, Math.ceil(Math.log2((pxPerDegLon / 2) * 360 / 512))));
  while (z > 6 && tilesFor(frameBounds(f), z).length > maxTiles) z--;
  return z;
}
/** Whether the frame can be drawn from Web Mercator tiles: within ±85° latitude and not across the antimeridian. */
export function mappable(f: Frame): boolean {
  const b = frameBounds(f);
  return b.n < 85 && b.s > -85 && b.w > -180 && b.e < 180 && b.w < b.e;
}
/** The tiles covering the bounds at zoom z, as [z, x, y]. */
export function tilesFor(b: { s: number; w: number; n: number; e: number }, z: number): [number, number, number][] {
  const n = 2 ** z, x1 = Math.max(0, Math.floor(tileX(b.w, z))), x2 = Math.min(n - 1, Math.floor(tileX(b.e, z)));
  const y1 = Math.max(0, Math.floor(tileY(b.n, z))), y2 = Math.min(n - 1, Math.floor(tileY(b.s, z)));
  const out: [number, number, number][] = [];
  for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) out.push([z, x, y]);
  return out;
}

/** One decoded vector-tile feature: its geometry type (1 point, 2 line, 3 polygon), its kind and name, and its rings or lines in the
 *  tile's own coordinates (0 … extent). */
export type MapFeature = { type: 1 | 2 | 3; kind: string; name?: string; rank?: number; geom: [number, number][][] };
export type MapTile = { z: number; x: number; y: number; extent: number; layers: Record<string, MapFeature[]> };

// the palette: the old dark site's surface (a dark picture in both of design-31's schemes; the page keeps its overlay dark), everything muted; the course (the page's own SVG) is the only bright line
const C = { land: "#151B26", water: "#152E47", forest: "#16241E", park: "#172420", urban: "#181E2A", minor: "#283244", major: "#334059",
  highway: "#3B4963", path: "#38475E", label: "#8792A4", halo: "#151B26" };
const FOREST = new Set(["forest", "wood"]), PARK = new Set(["park", "grass", "grassland", "meadow", "nature_reserve", "golf_course", "recreation_ground", "garden", "village_green", "scrub", "heath", "protected_area", "national_park"]);
const URBAN = new Set(["urban_area"]);
const PLACES = new Set(["locality", "neighbourhood", "macrohood", "suburb", "town", "village", "hamlet"]);
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The map as SVG in the frame (viewBox 0 0 W H), drawn `scale` times as large: land, water, forest and parks, roads and paths (fine
 *  to bold), then at most five place names that keep their distance, also from the course (`line`, its points in the frame: no name
 *  under the line, none near its start and finish). No course: the page draws its own on top. */
export function mapSvg(f: Frame, tiles: MapTile[], scale = 1, line: [number, number][] = []): string {
  const fills: Record<string, string[]> = { water: [], forest: [], park: [], urban: [] };
  const lines: Record<string, string[]> = { river: [], path: [], minor: [], major: [], highway: [] };
  const labels: { x: number; y: number; name: string; rank: number }[] = [];
  const box = { x1: -40, y1: -40, x2: f.W + 40, y2: f.H + 40 };
  for (const t of tiles) {
    const P = (px: number, py: number) => project(f, latOf(t.y + py / t.extent, t.z), lonOf(t.x + px / t.extent, t.z));
    const path = (g: [number, number][][], close: boolean) => {
      // kept when its extent overlaps the frame (a forest or lake that covers the whole frame, a road straight across it); points
      // closer than half a pixel to the last one drawn are left out (dense city tiles)
      let d = "", any = false;
      for (const ring of g) {
        const ps = ring.map(([x, y]) => P(x, y));
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const [x, y] of ps) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
        if (x2 < box.x1 || x1 > box.x2 || y2 < box.y1 || y1 > box.y2) continue;
        any = true;
        let lx = NaN, ly = NaN;
        ps.forEach(([x, y], i) => {
          if (i && i < ps.length - 1 && Math.abs(x - lx) < 0.5 && Math.abs(y - ly) < 0.5) return;
          d += `${i ? "L" : "M"}${f1(x)} ${f1(y)}`; lx = x; ly = y;
        });
        if (close) d += "Z";
      }
      return any ? d : "";
    };
    for (const ft of t.layers.water ?? []) {
      const d = path(ft.geom, ft.type === 3);
      if (d) (ft.type === 3 ? fills.water : lines.river).push(d);
    }
    for (const layer of ["landcover", "landuse"]) for (const ft of t.layers[layer] ?? []) {
      if (ft.type !== 3) continue;
      const k = FOREST.has(ft.kind) ? "forest" : PARK.has(ft.kind) ? "park" : URBAN.has(ft.kind) ? "urban" : null;
      if (!k) continue;
      const d = path(ft.geom, true);
      if (d) fills[k].push(d);
    }
    for (const ft of t.layers.roads ?? []) {
      if (ft.type !== 2) continue;
      const k = ft.kind === "highway" ? "highway" : ft.kind === "major_road" ? "major" : ft.kind === "minor_road" ? "minor" : ft.kind === "path" || ft.kind === "other" ? "path" : null;
      if (!k) continue;
      const d = path(ft.geom, false);
      if (d) lines[k].push(d);
    }
    for (const ft of t.layers.places ?? []) {
      if (ft.type !== 1 || !ft.name || !PLACES.has(ft.kind)) continue;
      const [x, y] = P(ft.geom[0][0][0], ft.geom[0][0][1]);
      if (x > 60 && x < f.W - 60 && y > 24 && y < f.H - 40) labels.push({ x, y, name: ft.name, rank: ft.rank ?? 0 });
    }
  }
  // the names: the most important first, none closer than 110 px to another, one per name
  const kept: typeof labels = [], seen = new Set<string>();
  for (const l of labels.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))) {
    const halfW = l.name.length * 3.4 + 6, ends = line.length ? [line[0], line[line.length - 1]] : [];
    if (kept.length >= 5 || seen.has(l.name) || kept.some((k) => Math.hypot(k.x - l.x, k.y - l.y) < 110)
      || ends.some(([x, y]) => Math.hypot(x - l.x, y - l.y) < 70) || line.some(([x, y]) => Math.abs(x - l.x) < halfW && y > l.y - 16 && y < l.y + 8)) continue;
    kept.push(l); seen.add(l.name);
  }
  const fill = (k: string, c: string) => fills[k].length ? `<path fill="${c}" fill-rule="nonzero" d="${fills[k].join("")}"/>` : "";
  const stroke = (k: string, c: string, w: number, dash = "") => lines[k].length ? `<path fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""} d="${lines[k].join("")}"/>` : "";
  const text = kept.map((l) => `<text x="${f1(l.x)}" y="${f1(l.y)}" text-anchor="middle" font-size="11" fill="${C.label}" stroke="${C.halo}" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${esc(l.name)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f.W * scale}" height="${f.H * scale}" viewBox="0 0 ${f.W} ${f.H}">`
    + `<rect width="${f.W}" height="${f.H}" fill="${C.land}"/>${fill("urban", C.urban)}${fill("park", C.park)}${fill("forest", C.forest)}${fill("water", C.water)}`
    + `${stroke("river", C.water, 1.4)}${stroke("path", C.path, 0.9, "2.5 2")}${stroke("minor", C.minor, 0.9)}${stroke("major", C.major, 1.5)}${stroke("highway", C.highway, 2.2)}`
    + `${text}</svg>`;
}

/** What a course's map depends on: the course as drawn (the frame), its points, and the style. Same hash, same map. */
export async function mapHash(pts: Pt[]): Promise<string> {
  const d = new TextEncoder().encode(`${MAP_STYLE}|${pts.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(";")}`);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", d))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Draws a course's map: { x1, x2 } WebP bytes (600 and 1200 wide) for its points. */
export type MapRenderer = (pts: Pt[]) => Promise<{ x1: Uint8Array; x2: Uint8Array }>;
/** The build-time renderer: the newest Protomaps build (read by range), the tile decoders, resvg (`png`, the share images' renderer)
 *  and cwebp. Null when any of them is missing: the pages then keep their plain course drawing. `tmp` is a folder for cwebp's files
 *  (one is made when none is given). */
export async function mapRenderer(png: (svg: string) => Uint8Array | Promise<Uint8Array>, tmp?: string, fetchFn: typeof fetch = fetch): Promise<MapRenderer | null> {
  try {
    const dir = tmp ?? await Deno.makeTempDir();
    await new Deno.Command("cwebp", { args: ["-version"], stdout: "null", stderr: "null" }).output();
    const builds = await (await fetchFn(PROTOMAPS_BUILDS, { signal: AbortSignal.timeout(20_000) })).json() as { key: string }[];
    const key = builds.map((b) => b.key).filter((k) => /^\d{8}\.pmtiles$/.test(k)).sort().pop();
    if (!key) throw new Error("no build");
    // built at run time, so tests and type checks never load them
    const [pm, vt, pbf]: any[] = await Promise.all([["npm:pmtiles", "4.3.0"], ["npm:@mapbox/vector-tile", "1.3.1"], ["npm:pbf", "3.3.0"]].map(([n, v]) => import(`${n}@${v}`)));
    const archive = new pm.PMTiles(new pm.FetchSource(PROTOMAPS_BASE + key));
    const VectorTile = vt.VectorTile ?? vt.default?.VectorTile, Pbf = pbf.default ?? pbf;
    const tile = async (z: number, x: number, y: number): Promise<MapTile> => {
      const r = await archive.getZxy(z, x, y), layers: MapTile["layers"] = {};
      let extent = 4096;
      if (r?.data) {
        const t = new VectorTile(new Pbf(new Uint8Array(r.data)));
        for (const name of ["water", "landcover", "landuse", "roads", "places"]) {
          const l = t.layers[name];
          if (!l) continue;
          extent = l.extent;
          const fs: MapFeature[] = [];
          for (let i = 0; i < l.length; i++) {
            const ft = l.feature(i), g = ft.loadGeometry().map((ring: { x: number; y: number }[]) => ring.map((p) => [p.x, p.y] as [number, number]));
            const p = ft.properties;
            fs.push({ type: ft.type, kind: String(p.kind ?? p.pmap_kind ?? ""), name: typeof p.name === "string" ? p.name : undefined, rank: Number(p.population_rank ?? 0), geom: g });
          }
          layers[name] = fs;
        }
      }
      return { z, x, y, extent, layers };
    };
    const webp = async (svg: string, name: string) => {
      const p = `${dir}/${name}.png`, w = `${dir}/${name}.webp`;
      try {
        await Deno.writeFile(p, await png(svg));
        const r = await new Deno.Command("cwebp", { args: ["-quiet", "-q", "78", "-m", "6", p, "-o", w] }).output();
        if (!r.success) throw new Error("cwebp failed");
        return await Deno.readFile(w);
      } finally {
        for (const x of [p, w]) await Deno.remove(x).catch(() => {});
      }
    };
    console.log(`race maps: Protomaps build ${key}`);
    // one course's map within MAP_TIMEOUT_MS (a slow or stuck source fails that map, which is tried again the next day)
    const draw = async (pts: Pt[]) => {
      const f = routeFrame(pts);
      if (!mappable(f)) throw new Error("outside what Web Mercator tiles map (±85°, the antimeridian)");
      const z = mapZoom(f), tiles = await Promise.all(tilesFor(frameBounds(f), z).map(([z, x, y]) => tile(z, x, y)));
      const id = crypto.randomUUID(), line = pts.map((p) => project(f, p[0], p[1]));
      // one drawing, rasterised at two sizes
      const svg = mapSvg(f, tiles, 1, line), x2 = svg.replace(`width="${f.W}" height="${f.H}"`, `width="${f.W * 2}" height="${f.H * 2}"`);
      return { x1: await webp(svg, `${id}-1`), x2: await webp(x2, `${id}-2`) };
    };
    return (pts) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error("map took too long")), MAP_TIMEOUT_MS); });
      return Promise.race([draw(pts), late]).finally(() => clearTimeout(timer));
    };
  } catch (e) {
    console.warn(`race pages: no map renderer (${String(e).slice(0, 120)}); pages keep the plain course drawing`);
    return null;
  }
}
