/**
 * OSM → game map converter.
 *
 *   node scripts/osm-to-map.ts [input.osm] [output.json]
 *
 * Reads an OpenStreetMap XML export (data/villarcayo.osm by default) and
 * writes the simplified, projected map the game loads
 * (public/maps/villarcayo.json, fetched at runtime). The browser never parses OSM.
 *
 * Projection: ETRS89 / UTM zone 30N (EPSG:25830), the CRS of every Spanish
 * dataset used by the baker (PNOA LiDAR, MDT, orthophoto, Catastro), shifted
 * so the centroid of the Plaza Mayor is the origin (rounded to the metre).
 * Game axes: +X = east (E - E0), +Z = south (N0 - N), metres. OSM's WGS84 and
 * ETRS89 differ by well under a metre here.
 *
 * Map data © OpenStreetMap contributors, ODbL 1.0.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import polygonClipping, { type MultiPolygon as ClipMulti } from 'polygon-clipping';

/**
 * Corrections checked against street-level photos (data/corrections.json):
 * shop points moved onto their real facade, renamed shops, and street
 * furniture and railings that OSM does not map.
 */
interface Corrections {
  shops?: Record<
    string,
    {
      at?: [number, number];
      name?: string;
      w?: number;
      street?: string;
      front?: [number, number, number, number];
      terrace?: boolean;
      awning?: string;
      back?: [number, number, number, number];
    }
  >;
  furniture?: { k: string; x: number; z: number; a: number; t?: string; replaces?: [number, number] }[];
  barriers?: { p: number[]; k: string; h?: number; cut?: boolean; hedge?: number }[];
  barrierKinds?: { near: [number, number]; k: string; h?: number; c?: string }[];
  /** Openings checked on photos that OSM lacks (cut like barrier=gate). */
  gates?: { at: [number, number] }[];
  /** Ways under a building checked on photos: clear height and width (a footway that cars use). */
  passages?: { near: [number, number]; tp?: number; w?: number }[];
  /** Ways checked on photos: a new one (`p`), or the one through `near`; width, kind, passage height, surface. */
  ways?: { near?: [number, number]; p?: number[]; k?: string; w?: number; tp?: number; sf?: string; bs?: string }[];
  redPaving?: { near?: [number, number]; k?: string; p?: number[] }[];
  extraShops?: { n: string; c: string; x: number; z: number; a: number; w: number }[];
}
const corrections: Corrections = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../data/corrections.json', import.meta.url), 'utf8'));
  } catch {
    return {};
  }
})();

type Tags = Record<string, string>;
type Pt = [number, number];
type Ring = Pt[];

const IN = process.argv[2] ?? 'data/villarcayo.osm';
const OUT = process.argv[3] ?? 'public/maps/villarcayo.json';

// ---------------------------------------------------------------- parsing

interface OsmNode {
  lat: number;
  lon: number;
  tags: Tags | null;
}
interface OsmWay {
  nds: string[];
  tags: Tags;
}
interface OsmRel {
  members: { type: string; ref: string; role: string }[];
  tags: Tags;
}

const xml = readFileSync(IN, 'utf8');
const nodes = new Map<string, OsmNode>();
const ways = new Map<string, OsmWay>();
const rels = new Map<string, OsmRel>();

function attrs(s: string): Tags {
  const out: Tags = {};
  for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function childTags(body: string): Tags {
  const t: Tags = {};
  for (const m of body.matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g)) t[decode(m[1])] = decode(m[2]);
  return t;
}

const elementRe = /<(node|way|relation)\b([^>]*?)(\/?)>/g;
let em: RegExpExecArray | null;
while ((em = elementRe.exec(xml))) {
  const [, kind, attrText, selfClosing] = em;
  const a = attrs(attrText);
  let body = '';
  if (!selfClosing) {
    const close = `</${kind}>`;
    const end = xml.indexOf(close, elementRe.lastIndex);
    body = xml.slice(elementRe.lastIndex, end);
    elementRe.lastIndex = end + close.length;
  }
  if (a.visible === 'false') continue;
  if (kind === 'node') {
    const tags = body ? childTags(body) : {};
    nodes.set(a.id, { lat: +a.lat, lon: +a.lon, tags: Object.keys(tags).length ? tags : null });
  } else if (kind === 'way') {
    ways.set(a.id, { nds: [...body.matchAll(/<nd\s+ref="(\d+)"/g)].map((m) => m[1]), tags: childTags(body) });
  } else {
    const members = [...body.matchAll(/<member\s+([^>]*)\/>/g)].map((m) => {
      const ma = attrs(m[1]);
      return { type: ma.type, ref: ma.ref, role: ma.role ?? '' };
    });
    rels.set(a.id, { members, tags: childTags(body) });
  }
}
const boundsMatch = /<bounds\s+([^>]*)\/>/.exec(xml);
if (!boundsMatch) throw new Error('No <bounds> element in the OSM file');
const bnd = attrs(boundsMatch[1]);

// ------------------------------------------------------------- projection

const plazaWay = [...ways.values()].find((w) => w.tags.place === 'square' && w.tags.name === 'Plaza Mayor');
const townhall = [...nodes.values()].find((n) => n.tags?.amenity === 'townhall');
let lat0: number, lon0: number;
if (plazaWay) {
  const ring = plazaWay.nds
    .slice(0, -1)
    .map((id) => nodes.get(id)!)
    .filter(Boolean);
  lat0 = ring.reduce((s, n) => s + n.lat, 0) / ring.length;
  lon0 = ring.reduce((s, n) => s + n.lon, 0) / ring.length;
} else if (townhall) {
  lat0 = townhall.lat;
  lon0 = townhall.lon;
} else throw new Error('Cannot find the Plaza Mayor or the town hall to use as origin');

/** Transverse Mercator (GRS80) — UTM zone 30N easting/northing in metres. */
function utm30(lat: number, lon: number): [number, number] {
  const a = 6378137,
    f = 1 / 298.257222101,
    k0 = 0.9996;
  const e2 = f * (2 - f),
    ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180,
    lam = (lon * Math.PI) / 180,
    lam0 = (-3 * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2,
    C = ep2 * Math.cos(phi) ** 2,
    A = Math.cos(phi) * (lam - lam0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  const Nn =
    k0 *
    (M +
      N *
        Math.tan(phi) *
        ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [E, Nn];
}
const [E0, N0] = utm30(lat0, lon0).map(Math.round);
const q = (v: number) => Math.round(v * 10) / 10;
const project = (lat: number, lon: number): Pt => {
  const [e, n] = utm30(lat, lon);
  return [e - E0, N0 - n];
};
const nodePt = (id: string): Pt | null => {
  const n = nodes.get(id);
  return n ? project(n.lat, n.lon) : null;
};

// The lat/lon box is slightly rotated in UTM: keep the axis-aligned rectangle inside it.
const corners = [
  project(+bnd.minlat, +bnd.minlon),
  project(+bnd.minlat, +bnd.maxlon),
  project(+bnd.maxlat, +bnd.minlon),
  project(+bnd.maxlat, +bnd.maxlon),
];
const B = {
  minX: Math.ceil(Math.max(corners[0][0], corners[2][0])),
  maxX: Math.floor(Math.min(corners[1][0], corners[3][0])),
  minZ: Math.ceil(Math.max(corners[2][1], corners[3][1])),
  maxZ: Math.floor(Math.min(corners[0][1], corners[1][1])),
};
const inB = (p: Pt, pad = 0) => p[0] >= B.minX - pad && p[0] <= B.maxX + pad && p[1] >= B.minZ - pad && p[1] <= B.maxZ + pad;

// --------------------------------------------------------------- geometry

function wayPts(id: string): Pt[] {
  const w = ways.get(id);
  if (!w) return [];
  return w.nds.map(nodePt).filter((p): p is Pt => !!p);
}

function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

function centroid(r: Ring): Pt {
  let x = 0,
    z = 0;
  for (const p of r) {
    x += p[0];
    z += p[1];
  }
  return [x / r.length, z / r.length];
}

function pointInRing(p: Pt, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i],
      [xj, zj] = r[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/** Douglas–Peucker simplification. */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1,
      bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Closed ring without the duplicated last vertex, simplified, CCW-normalised optional. */
function cleanRing(pts: Pt[], tol: number): Ring | null {
  let r = pts.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  if (r.length < 3) return null;
  r = simplify([...r, r[0]], tol);
  r.pop();
  return r.length >= 3 ? r : null;
}

/** Sutherland–Hodgman clip of a ring against the bounds rectangle. */
function clipRing(r: Ring): Ring | null {
  const edges: ((p: Pt) => number)[] = [(p) => p[0] - B.minX, (p) => B.maxX - p[0], (p) => p[1] - B.minZ, (p) => B.maxZ - p[1]];
  let out = r;
  for (const f of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i],
        prev = input[(i + input.length - 1) % input.length];
      const fc = f(cur),
        fp = f(prev);
      if (fc >= 0) {
        if (fp < 0) out.push(lerpPt(prev, cur, fp / (fp - fc)));
        out.push(cur);
      } else if (fp >= 0) out.push(lerpPt(prev, cur, fp / (fp - fc)));
    }
    if (out.length < 3) return null;
  }
  return out;
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Splits a polyline into the parts inside the bounds (with interpolated end points). */
function clipLine(pts: Pt[]): Pt[][] {
  const parts: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const inside = inB(p);
    if (i > 0) {
      const prev = pts[i - 1];
      const prevIn = inB(prev);
      if (inside !== prevIn) {
        // Binary search for the boundary crossing.
        let a = prev,
          b = p;
        for (let k = 0; k < 20; k++) {
          const m = lerpPt(a, b, 0.5);
          if (inB(m) === prevIn) a = m;
          else b = m;
        }
        const x = prevIn ? a : b;
        if (prevIn) {
          cur.push(x);
          parts.push(cur);
          cur = [];
        } else cur.push(x);
      }
    }
    if (inside) cur.push(p);
  }
  if (cur.length > 1) parts.push(cur);
  return parts.filter((pp) => pp.length > 1);
}

/** Joins member ways of a multipolygon into closed rings. */
function assembleRings(wayIds: string[]): Pt[][] {
  const segs = wayIds.map((id) => ways.get(id)?.nds.slice() ?? []).filter((s) => s.length > 1);
  const rings: Pt[][] = [];
  while (segs.length) {
    let ring = segs.shift()!;
    let guard = 0;
    while (ring[0] !== ring[ring.length - 1] && guard++ < 1000) {
      const last = ring[ring.length - 1];
      const i = segs.findIndex((s) => s[0] === last || s[s.length - 1] === last);
      if (i < 0) break;
      const s = segs.splice(i, 1)[0];
      ring = ring.concat((s[0] === last ? s : s.slice().reverse()).slice(1));
    }
    if (ring[0] === ring[ring.length - 1]) rings.push(ring.map(nodePt).filter((p): p is Pt => !!p));
  }
  return rings;
}

const flat = (r: Pt[]) => r.flatMap(([x, z]) => [q(x), q(z)]);
const unflat = (o: number[]): Pt[] => Array.from({ length: o.length / 2 }, (_, i) => [o[2 * i], o[2 * i + 1]] as Pt);

// ---------------------------------------------------------- polygon source

interface Poly {
  id: string;
  tags: Tags;
  outer: Ring;
  holes: Ring[];
  /** Crossed the map edge and was clipped. */
  cut?: boolean;
}

/** Every closed way and multipolygon relation as polygons (clipped to bounds). */
/** True if two non-adjacent edges of the ring cross. */
function selfIntersects(r: Ring): boolean {
  const n = r.length;
  const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = r[i],
      b = r[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = r[j],
        d = r[(j + 1) % n];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
}

/** Simplified ring, falling back to a finer tolerance when simplifying makes it cross itself. */
function cleanSimple(pts: Pt[]): Ring | null {
  const r = cleanRing(pts, 0.25);
  return r && selfIntersects(r) ? cleanRing(pts, 0.03) : r;
}

function collectPolygons(): Poly[] {
  const out: Poly[] = [];
  for (const [id, w] of ways) {
    if (w.nds.length < 4 || w.nds[0] !== w.nds[w.nds.length - 1]) continue;
    const ring = cleanSimple(wayPts(id));
    if (!ring) continue;
    const clipped = clipRing(ring);
    if (clipped) out.push({ id: `w${id}`, tags: w.tags, outer: clipped, holes: [], cut: !ring.every((p) => inB(p)) });
  }
  for (const [id, r] of rels) {
    if (r.tags.type !== 'multipolygon') continue;
    const outerIds = r.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => m.ref);
    const innerIds = r.members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => m.ref);
    let tags = r.tags;
    // Old-style multipolygons keep their tags on the outer way.
    if (Object.keys(tags).length <= 1 && outerIds.length === 1) tags = ways.get(outerIds[0])?.tags ?? tags;
    const holes = assembleRings(innerIds)
      .map((h) => cleanSimple(h))
      .filter((h): h is Ring => !!h);
    for (const o of assembleRings(outerIds)) {
      const ring = cleanSimple(o);
      const clipped = ring && clipRing(ring);
      if (!clipped) continue;
      out.push({
        id: `r${id}`,
        tags,
        outer: clipped,
        holes: holes.filter((h) => pointInRing(h[0], clipped)),
        cut: !ring.every((p) => inB(p)),
      });
    }
  }
  return out;
}

const polygons = collectPolygons();
// Multipolygon relations re-use their outer ways; skip those ways as standalone polygons.
const relOuterWays = new Set<string>();
for (const r of rels.values()) {
  if (r.tags.type !== 'multipolygon') continue;
  for (const m of r.members) if (m.type === 'way' && m.role !== 'inner') relOuterWays.add(`w${m.ref}`);
}

// ---------------------------------------------------------------- buildings

/**
 * Buildings come in two flavours in Villarcayo's OSM data:
 * - outlines (building=*), often without levels;
 * - parts (building:part=*, from the Spanish cadastre) that split an outline
 *   into bodies with their own building:levels (Simple 3D Buildings).
 * When an outline has parts, the game renders the parts and uses the outline
 * only for the map (`hp`). Part walls shared with an equal or taller part are
 * listed in `hid` so the game does not build invisible walls.
 */
interface BuildingOut {
  o: number[];
  h?: number[][];
  lv?: number;
  mlv?: number;
  ht?: number;
  t: string;
  n?: string;
  mat?: string;
  /** Outline whose volume is described by parts. */ hp?: 1;
  /** This is a part. */ part?: 1;
  /** Hidden wall indices (edge i joins vertex i and i+1). */ hid?: number[];
  /** Rest of an outline its parts leave uncovered (kept by the bake only where the LiDAR sees a roof). */ fill?: 1;
}
const buildings: BuildingOut[] = [];
const buildingCentroids: Pt[] = [];

const townhallPt = townhall ? project(townhall.lat, townhall.lon) : null;

function buildingType(t: Tags): string {
  const b = t.building;
  if (t.name === 'Torre del Corregimiento') return 'torre';
  if (t['historic'] === 'railway_station' || t['disused:railway'] === 'station') return 'station';
  if (b === 'church' || b === 'chapel' || b === 'cathedral' || b === 'monastery') return 'church';
  if (b === 'roof' || b === 'carport' || b === 'grandstand' || t.location === 'roof') return 'canopy';
  if (b === 'ruins') return 'ruins';
  if (b === 'greenhouse') return 'greenhouse';
  if (
    [
      'industrial',
      'warehouse',
      'factory',
      'manufacture',
      'barn',
      'farm_auxiliary',
      'hangar',
      'storage_tank',
      'silo',
      'livestock',
      'farm',
    ].includes(b)
  )
    return 'industrial';
  if (['garage', 'garages', 'shed', 'hut', 'kiosk', 'cabin', 'toilets', 'service', 'transformer_tower'].includes(b)) return 'small';
  if (b === 'tower') return 'tower';
  if (
    [
      'apartments',
      'retail',
      'commercial',
      'office',
      'public',
      'government',
      'civic',
      'school',
      'hospital',
      'sports_hall',
      'supermarket',
      'hotel',
    ].includes(b)
  )
    return 'block';
  return 'house';
}

const num = (v: string | undefined) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : undefined;
};

const outlines: { b: BuildingOut; ring: Ring; bb: [number, number, number, number] }[] = [];
for (const p of polygons) {
  const t = p.tags;
  if (!t.building || t.building === 'no' || t['building:part'] || t.leisure === 'bandstand') continue;
  // Buildings cut by the map edge would get a wall along the cut (and a broken outline): leave them out.
  if (p.cut) continue;
  if (p.id.startsWith('w') && relOuterWays.has(p.id) && rels.size) {
    // Prefer the relation version (with courtyards) when it exists and is itself a building.
    const owner = [...rels.entries()].find(
      ([, r]) => r.tags.type === 'multipolygon' && r.members.some((m) => `w${m.ref}` === p.id && m.role !== 'inner'),
    );
    if (owner && (owner[1].tags.building || Object.keys(owner[1].tags).length <= 1)) continue;
  }
  const area = Math.abs(signedArea(p.outer));
  if (area < 6) continue;
  let type = buildingType(t);
  if (townhallPt && pointInRing(townhallPt, p.outer)) type = 'townhall';
  const b: BuildingOut = { o: flat(p.outer), t: type };
  if (p.holes.length) b.h = p.holes.map(flat);
  const lv = num(t['building:levels']);
  if (lv && lv > 0) b.lv = lv;
  const ht = num(t.height);
  if (ht && ht > 0) b.ht = ht;
  if (t.name) b.n = t.name;
  if (t['building:material']) b.mat = t['building:material'];
  buildings.push(b);
  buildingCentroids.push(centroid(p.outer));
  const xs = p.outer.map((q) => q[0]),
    zs = p.outer.map((q) => q[1]);
  outlines.push({ b, ring: p.outer, bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] });
}

// Parts: exact cadastral geometry (no simplification) so shared walls can be matched by node id.
interface PartTmp {
  out: BuildingOut;
  parent?: BuildingOut;
  ids: string[];
  bottom: number;
  top: number;
}
const partsTmp: PartTmp[] = [];
const orphanParts = new Set<BuildingOut>();
const CUSTOM_MODELS = new Set(['townhall', 'torre']);
for (const [, w] of ways) {
  const t = w.tags;
  if (!t['building:part'] || t['building:part'] === 'no') continue;
  if (w.nds.length < 4 || w.nds[0] !== w.nds[w.nds.length - 1]) continue;
  const ids = w.nds.slice(0, -1);
  const pts = ids.map(nodePt);
  if (pts.some((q) => !q) || !(pts as Pt[]).every((q) => inB(q))) continue;
  const ring = pts as Pt[];
  if (Math.abs(signedArea(ring)) < 2) continue;
  const c = centroid(ring);
  const parent = outlines.find((o) => c[0] >= o.bb[0] && c[0] <= o.bb[2] && c[1] >= o.bb[1] && c[1] <= o.bb[3] && pointInRing(c, o.ring));
  if (parent && CUSTOM_MODELS.has(parent.b.t)) continue;
  if (parent) parent.b.hp = 1;
  const lv = num(t['building:levels']) ?? 1;
  const mlv = num(t['building:min_level']) ?? 0;
  const out: BuildingOut = { o: flat(ring), t: parent?.b.t ?? buildingType({ ...t, building: t['building:part'] }), lv, part: 1 };
  if (mlv > 0) out.mlv = mlv;
  const ht = num(t.height);
  if (ht) out.ht = ht;
  if (parent?.b.mat) out.mat = parent.b.mat;
  if (parent?.b.n) out.n = parent.b.n;
  // A tiny part with no building around it (the stair head of a building OSM lacks): it holds shop
  // fronts, but is left out of the output (the LiDAR traces the real building).
  if (!parent && Math.abs(signedArea(ring)) < 15) orphanParts.add(out);
  partsTmp.push({ out, parent: parent?.b, ids, bottom: mlv, top: ht ?? mlv + lv });
}
const edgeOwners = new Map<string, PartTmp[]>();
const edgeKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);
for (const p of partsTmp) {
  for (let i = 0; i < p.ids.length; i++) {
    const k = edgeKey(p.ids[i], p.ids[(i + 1) % p.ids.length]);
    (edgeOwners.get(k) ?? edgeOwners.set(k, []).get(k)!).push(p);
  }
}
for (const p of partsTmp) {
  const hid: number[] = [];
  for (let i = 0; i < p.ids.length; i++) {
    const others = edgeOwners.get(edgeKey(p.ids[i], p.ids[(i + 1) % p.ids.length]))!.filter((q) => q !== p);
    if (others.some((q) => q.top >= p.top && q.bottom <= p.bottom)) hid.push(i);
  }
  if (hid.length) p.out.hid = hid;
  buildings.push(p.out);
}

/**
 * Outlines that their parts only partly describe. The cadastre import often
 * maps a few small bodies (a stairwell, a rear annex) as parts and leaves the
 * main block to the outline: since the game draws the parts instead of the
 * outline, the main block vanished (Plaza Mayor 10, 6 storeys, had 50 of its
 * 551 m2). The uncovered rest of the outline becomes a part of its own, with
 * the outline's levels (heights are measured by the LiDAR in the bake).
 */
let filledOutlines = 0,
  filledArea = 0;
{
  const byParent = new Map<BuildingOut, PartTmp[]>();
  for (const p of partsTmp) if (p.parent) (byParent.get(p.parent) ?? byParent.set(p.parent, []).get(p.parent)!).push(p);
  const ringOf = (o: number[]): [number, number][] => {
    const r: [number, number][] = [];
    for (let i = 0; i < o.length; i += 2) r.push([o[i], o[i + 1]]);
    r.push([o[0], o[1]]);
    return r;
  };
  for (const [outline, parts] of byParent) {
    // Landmarks with their own model (Santa Marina, the Ayuntamiento...) are built from their parts as they are.
    if (['church', 'townhall', 'torre'].includes(outline.t)) continue;
    const outer = [ringOf(outline.o), ...(outline.h ?? []).map(ringOf)];
    let rest: ClipMulti;
    try {
      rest = polygonClipping.difference(outer, ...parts.map((p) => [ringOf(p.out.o)]));
    } catch {
      continue;
    }
    let added = false;
    for (const poly of rest) {
      const ring = poly[0].slice(0, -1) as Pt[];
      const area = Math.abs(signedArea(ring));
      let perim = 0;
      for (let i = 0; i < ring.length; i++)
        perim += Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1]);
      // Leftover slivers along shared walls are not buildings.
      if (area < 8 || area / perim < 0.8) continue;
      const out: BuildingOut = { o: flat(ring), t: outline.t, lv: outline.lv ?? Math.max(...parts.map((p) => p.top)), part: 1, fill: 1 };
      if (poly.length > 1) out.h = poly.slice(1).map((h) => flat(h.slice(0, -1) as Pt[]));
      if (outline.ht) out.ht = outline.ht;
      if (outline.mat) out.mat = outline.mat;
      if (outline.n) out.n = outline.n;
      buildings.push(out);
      filledArea += area;
      added = true;
    }
    if (added) filledOutlines++;
  }
}

// ---------------------------------------------------------------- areas

const AREA_KIND: [string, string, string][] = [
  ['natural', 'water', 'water'],
  ['leisure', 'swimming_area', 'water'],
  ['leisure', 'swimming_pool', 'pool'],
  ['amenity', 'parking', 'parking'],
  ['highway', 'pedestrian', 'pedestrian'],
  ['place', 'square', 'pedestrian'],
  ['leisure', 'pitch', 'pitch'],
  ['leisure', 'playground', 'playground'],
  ['leisure', 'track', 'track'],
  ['leisure', 'park', 'park'],
  ['leisure', 'garden', 'garden'],
  ['leisure', 'sports_centre', 'sports'],
  ['tourism', 'camp_site', 'camp'],
  ['amenity', 'marketplace', 'pedestrian'],
  ['amenity', 'school', 'school'],
  ['landuse', 'cemetery', 'cemetery'],
  ['landuse', 'village_green', 'park'],
  ['landuse', 'recreation_ground', 'park'],
  ['landuse', 'grass', 'grass'],
  ['landuse', 'meadow', 'meadow'],
  ['natural', 'grassland', 'meadow'],
  ['landuse', 'farmland', 'farmland'],
  ['landuse', 'farmyard', 'farmyard'],
  ['landuse', 'orchard', 'orchard'],
  ['landuse', 'allotments', 'allotments'],
  ['landuse', 'forest', 'forest'],
  ['natural', 'wood', 'forest'],
  ['landuse', 'logging', 'forest'],
  ['natural', 'scrub', 'scrub'],
  ['natural', 'beach', 'beach'],
  ['landuse', 'residential', 'residential'],
  ['landuse', 'industrial', 'industrial'],
  ['landuse', 'commercial', 'industrial'],
  ['landuse', 'retail', 'industrial'],
  ['landuse', 'brownfield', 'brownfield'],
  ['landuse', 'construction', 'brownfield'],
  ['landuse', 'greenfield', 'meadow'],
  ['landuse', 'education', 'school'],
  ['leisure', 'festival_grounds', 'park'],
  ['amenity', 'bus_station', 'busstation'],
  ['amenity', 'fuel', 'fuel'],
];

interface AreaOut {
  k: string;
  o: number[];
  h?: number[][];
  n?: string;
  s?: string;
  c?: 1;
  l?: 'n' | 'b';
  /** Red concrete paving (photos / orthophoto). */
  pv?: 'red';
}
const areas: AreaOut[] = [];
for (const p of polygons) {
  const t = p.tags;
  if (t.building && t.leisure !== 'pitch') continue;
  const match = AREA_KIND.find(([key, val]) => t[key] === val);
  if (!match) continue;
  if (match[2] === 'pedestrian' && t.highway === 'pedestrian' && t.area !== 'yes' && p.id.startsWith('w') && !relOuterWays.has(p.id)) {
    // A closed pedestrian *street* loop, not an area.
    continue;
  }
  const a: AreaOut = { k: match[2], o: flat(simplify([...p.outer, p.outer[0]], 0.4).slice(0, -1)) };
  if (p.holes.length) a.h = p.holes.map(flat);
  const name = t.name ?? (t.leisure === 'swimming_area' ? 'Piscinas naturales' : undefined);
  if (name) a.n = name;
  if (match[2] === 'pitch') {
    // Sport (first value) decides the court markings and equipment; c = covered.
    a.s = (t.sport ?? 'multi').split(';')[0];
    if (t.building === 'roof' || t.covered === 'yes') a.c = 1;
  }
  // Woods: needle-leaved (the pine plantations) or broad-leaved.
  if (t.leaf_type === 'needleleaved') a.l = 'n';
  else if (t.leaf_type === 'broadleaved') a.l = 'b';
  // Parking layout: parallel / perpendicular / diagonal bays.
  if (match[2] === 'parking' && t.orientation) a.s = t.orientation;
  areas.push(a);
}
// Red paving checked on photos: a mapped area containing `near`, or an outline of its own (`p`).
for (const r of corrections.redPaving ?? []) {
  if (r.p) {
    areas.push({ k: 'paving', o: r.p, pv: 'red' });
    continue;
  }
  const hit = r.near && areas.filter((a) => a.k === r.k && pointInRing(r.near!, unflat(a.o)));
  if (!hit?.length) console.warn(`redPaving: no ${r.k} area at ${r.near}`);
  else for (const a of hit) a.pv = 'red';
}

// ---------------------------------------------------------------- roads

const ROAD_WIDTH: Record<string, number> = {
  motorway: 10,
  trunk: 9,
  primary: 7.5,
  secondary: 7,
  tertiary: 6.5,
  unclassified: 5,
  residential: 5.5,
  living_street: 4.5,
  service: 3.5,
  track: 3,
  pedestrian: 4,
  footway: 2,
  path: 1.5,
  cycleway: 2.5,
  bridleway: 2,
  steps: 2,
};
const VEHICLE = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
]);
const URBAN = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street']);

// Vía Verde (old Santander–Mediterráneo railway) members.
const viaVerdeWays = new Set<string>();
for (const r of rels.values()) {
  if (/Vía Verde Santander/.test(r.tags.name ?? '') && r.tags.type === 'route') {
    for (const m of r.members) if (m.type === 'way') viaVerdeWays.add(m.ref);
  }
}

const nodeUse = new Map<string, number>();
for (const w of ways.values()) {
  if (!w.tags.highway || !ROAD_WIDTH[w.tags.highway]) continue;
  for (const id of new Set(w.nds)) nodeUse.set(id, (nodeUse.get(id) ?? 0) + 1);
}

// Building-centroid grid to infer sidewalks in built-up streets.
const bGrid = new Map<string, Pt[]>();
for (const c of buildingCentroids) {
  const k = `${Math.floor(c[0] / 50)},${Math.floor(c[1] / 50)}`;
  (bGrid.get(k) ?? bGrid.set(k, []).get(k)!).push(c);
}
function buildingsNear(p: Pt, r: number): number {
  let n = 0;
  const cx = Math.floor(p[0] / 50),
    cz = Math.floor(p[1] / 50);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      for (const c of bGrid.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(c[0] - p[0], c[1] - p[1]) < r) n++;
    }
  return n;
}

interface RoadOut {
  /** Passage under a building: clear height (m). */
  tp?: number;
  p: number[];
  k: string;
  w: number;
  n?: string;
  b?: 1;
  sw?: number;
  j?: number[];
  /** Surface checked on photos (gravel: the agglomerated stone paths of El Soto). */
  sf?: string;
  /** Bridge structure checked on photos (metal: the dark green iron bridge of Villacanes). */
  bs?: string;
}
const roads: RoadOut[] = [];
const rails: { p: number[] }[] = [];
for (const [id, w] of ways) {
  const t = w.tags;
  const isVia = viaVerdeWays.has(id) || t.railway === 'abandoned' || t.railway === 'disused';
  if (t.railway === 'abandoned' || t.railway === 'disused' || t.railway === 'rail') {
    for (const part of clipLine(wayPts(id))) rails.push({ p: flat(simplify(part, 0.3)) });
  }
  const hw = t.highway;
  if (!hw || !ROAD_WIDTH[hw] || t.area === 'yes' || t.tunnel === 'yes' || t.tunnel === 'culvert') continue;
  if (hw === 'pedestrian' && w.nds[0] === w.nds[w.nds.length - 1] && polygons.some((p) => p.id === `w${id}` && p.tags.area === 'yes'))
    continue;
  const kind = isVia ? 'viaverde' : hw;
  let width = isVia ? 4 : ROAD_WIDTH[hw];
  const tw = parseFloat(t.width);
  const lanes = parseFloat(t.lanes);
  if (Number.isFinite(tw) && tw > 1 && tw < 30) width = tw;
  else if (VEHICLE.has(hw) && Number.isFinite(lanes)) width = Math.max(width, lanes * 3.2);
  const pts = w.nds.map((nid) => ({ id: nid, p: nodePt(nid) })).filter((x): x is { id: string; p: Pt } => !!x.p);
  for (const part of clipLine(pts.map((x) => x.p))) {
    const simp = simplify(part, 0.3);
    const r: RoadOut = { p: flat(simp), k: kind, w: width };
    if (t.name) r.n = t.name;
    if (t.bridge && t.bridge !== 'no') r.b = 1;
    // Streets and paths through or under a building (tunnel=building_passage, covered=yes):
    // tp = clear height, so the baker can open the passage in the building above.
    if (t.tunnel === 'building_passage' || t.covered === 'yes') {
      const mh = parseFloat(t.maxheight);
      r.tp = Number.isFinite(mh) && mh > 2 ? mh : VEHICLE.has(hw) ? 4.5 : 3.2;
    }
    if (VEHICLE.has(hw)) {
      // Junction vertices (shared with another highway) — no centre-line dashes there.
      const j: number[] = [];
      simp.forEach((sp, i) => {
        const src = pts.find((x) => x.p[0] === sp[0] && x.p[1] === sp[1]);
        if (src && (nodeUse.get(src.id) ?? 0) > 1) j.push(i);
      });
      if (j.length) r.j = j;
    }
    // Sidewalks: tagged, or inferred for streets lined with buildings.
    const sw = t.sidewalk ?? t['sidewalk:both'];
    let side = 0;
    if (sw === 'both') side = 3;
    else if (sw === 'left') side = 1;
    else if (sw === 'right') side = 2;
    else if (!sw && URBAN.has(hw)) {
      const mid = simp[Math.floor(simp.length / 2)];
      if (buildingsNear(mid, 40) >= 3) side = 3;
    }
    if (side) r.sw = side;
    roads.push(r);
  }
}

// Passages checked on photos: the Uni-Dos entry from Calle Laín Calvo is a vehicle way
// into the yard, though OSM maps it as a 2 m footway.
for (const fix of corrections.passages ?? []) {
  let best: RoadOut | null = null,
    bestD = 1.5;
  for (const r of roads) {
    for (let i = 2; i < r.p.length; i += 2) {
      const d = segDist(fix.near, [r.p[i - 2], r.p[i - 1]], [r.p[i], r.p[i + 1]]);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
  }
  if (!best) continue;
  if (fix.tp) best.tp = fix.tp;
  if (fix.w) best.w = fix.w;
}
for (const fix of corrections.ways ?? []) {
  if (fix.p) {
    roads.push({ p: fix.p, k: fix.k ?? 'footway', w: fix.w ?? 2, ...(fix.tp ? { tp: fix.tp } : {}), ...(fix.sf ? { sf: fix.sf } : {}) });
    continue;
  }
  let best: RoadOut | null = null,
    bestD = 1.5;
  for (const r of roads)
    for (let i = 2; i < r.p.length; i += 2) {
      const d = segDist(fix.near!, [r.p[i - 2], r.p[i - 1]], [r.p[i], r.p[i + 1]]);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
  if (!best) {
    console.warn(`ways: nothing at ${fix.near}`);
    continue;
  }
  if (fix.k) best.k = fix.k;
  if (fix.w) best.w = fix.w;
  if (fix.tp) best.tp = fix.tp;
  if (fix.sf) best.sf = fix.sf;
  if (fix.bs) best.bs = fix.bs;
}

// ---------------------------------------------------------------- water

const rivers: { p: number[]; w: number; n?: string }[] = [];
const streams: { p: number[]; w: number }[] = [];
const weirs: { p: number[]; n?: string }[] = [];
for (const [id, w] of ways) {
  const t = w.tags;
  if (!t.waterway) continue;
  if (t.tunnel && t.tunnel !== 'no') continue;
  const pts = wayPts(id);
  if (t.waterway === 'weir' || t.waterway === 'dam') {
    if (pts.some((p) => inB(p))) weirs.push({ p: flat(pts), ...(t.name ? { n: t.name } : {}) });
    continue;
  }
  for (const part of clipLine(pts)) {
    if (t.waterway === 'river')
      rivers.push({ p: flat(simplify(part, 0.5)), w: parseFloat(t.width) || 16, ...(t.name ? { n: t.name } : {}) });
    else if (['stream', 'canal', 'ditch', 'drain'].includes(t.waterway))
      streams.push({ p: flat(simplify(part, 0.5)), w: t.waterway === 'canal' ? 4 : 2 });
  }
}

// ------------------------------------------------------------- barriers

/**
 * Walls, fences and hedges as polylines; gates (barrier=gate on the way) leave
 * a 3 m opening. Bollards are points. tools/geodata/walls.py adds the plot
 * walls and fences that only the LiDAR sees.
 */
const BARRIER_KIND: Record<string, string> = {
  wall: 'wall',
  city_wall: 'wall',
  retaining_wall: 'retaining_wall',
  fence: 'fence',
  guard_rail: 'fence',
  hedge: 'hedge',
};
const GATES = new Set(['gate', 'sliding_gate', 'swing_gate', 'lift_gate', 'entrance']);
const gateNodes: Pt[] = [];
for (const n of nodes.values()) if (n.tags && GATES.has(n.tags.barrier ?? '')) gateNodes.push(project(n.lat, n.lon));
for (const g of corrections.gates ?? []) gateNodes.push(g.at);
const barriers: { p: number[]; k: string; h?: number; fix?: 1; hedge?: number; c?: string }[] = [];
const bollards: number[] = [];
for (const { cut, ...b } of corrections.barriers ?? []) barriers.push(cut ? b : { ...b, fix: 1 });
for (const [id, w] of ways) {
  const kind = BARRIER_KIND[w.tags.barrier ?? ''];
  if (!kind || w.tags.building) continue;
  let pts = wayPts(id);
  // Openings around gates: split the line at gate nodes.
  const gates = w.nds
    .map((n) => nodes.get(n))
    .filter((n) => n?.tags && GATES.has(n.tags.barrier ?? ''))
    .map((n) => project(n!.lat, n!.lon));
  // Entrances mapped on the line but not joined to it (the Colegio car park's gate onto the
  // frontón): a vertex there, so the opening is cut all the same.
  for (const g of gateNodes) {
    if (pts.some((p) => Math.hypot(p[0] - g[0], p[1] - g[1]) < 1.5)) continue;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1],
        [bx, bz] = pts[i];
      const L2 = (bx - ax) ** 2 + (bz - az) ** 2;
      if (L2 < 1) continue;
      const t = ((g[0] - ax) * (bx - ax) + (g[1] - az) * (bz - az)) / L2;
      if (t <= 0 || t >= 1) continue;
      if (Math.hypot(ax + (bx - ax) * t - g[0], az + (bz - az) * t - g[1]) > 0.6) continue;
      pts = [...pts.slice(0, i), g, ...pts.slice(i)];
      gates.push(g);
      break;
    }
  }
  let runs: Pt[][] = [pts];
  for (const g of gates) {
    const next: Pt[][] = [];
    for (const run of runs) {
      let cur: Pt[] = [];
      for (let i = 0; i < run.length; i++) {
        const p = run[i];
        if (Math.hypot(p[0] - g[0], p[1] - g[1]) < 1.5) {
          // Stop 1.5 m before the gate and restart 1.5 m after it.
          const prev = run[i - 1],
            nxt = run[i + 1];
          if (prev) cur.push(lerpPt(g, prev, Math.min(1, 1.5 / (Math.hypot(prev[0] - g[0], prev[1] - g[1]) || 1))));
          if (cur.length > 1) next.push(cur);
          cur = nxt ? [lerpPt(g, nxt, Math.min(1, 1.5 / (Math.hypot(nxt[0] - g[0], nxt[1] - g[1]) || 1)))] : [];
        } else cur.push(p);
      }
      if (cur.length > 1) next.push(cur);
    }
    runs = next;
  }
  const height = num(w.tags.height);
  for (const run of runs)
    for (const part of clipLine(run)) {
      if (part.length < 2) continue;
      barriers.push({ p: flat(simplify(part, 0.2)), k: kind, ...(height ? { h: height } : {}) });
    }
}
// Kind of a mapped barrier checked against photos (OSM only says "fence").
for (const fix of corrections.barrierKinds ?? []) {
  for (const b of barriers) {
    if (b.fix) continue;
    let near = false;
    for (let i = 0; i < b.p.length; i += 2) if (Math.hypot(b.p[i] - fix.near[0], b.p[i + 1] - fix.near[1]) < 3) near = true;
    if (!near) continue;
    // 'none': a barrier the photos and the orthophoto do not show (dropped below).
    b.k = fix.k;
    if (fix.h) b.h = fix.h;
    if (fix.c) b.c = fix.c;
  }
}
for (let i = barriers.length - 1; i >= 0; i--) if (barriers[i].k === 'none') barriers.splice(i, 1);
for (const n of nodes.values()) {
  if (n.tags?.barrier !== 'bollard') continue;
  const p = project(n.lat, n.lon);
  if (inB(p)) bollards.push(q(p[0]), q(p[1]));
}

// ---------------------------------------------------------------- points

const trees: number[] = [];
const pines: number[] = [];
const lamps: number[] = [];
const benches: number[] = [];
const crossings: number[] = [];
const pois: { k: string; n?: string; x: number; z: number; o?: number[]; ht?: number; a?: number }[] = [];

function roadAngleAt(nid: string): number | null {
  for (const w of ways.values()) {
    if (!w.tags.highway || !VEHICLE.has(w.tags.highway)) continue;
    const i = w.nds.indexOf(nid);
    if (i < 0) continue;
    const a = nodePt(w.nds[Math.max(0, i - 1)]),
      b = nodePt(w.nds[Math.min(w.nds.length - 1, i + 1)]);
    if (!a || !b) continue;
    return Math.atan2(b[0] - a[0], b[1] - a[1]);
  }
  return null;
}

/**
 * Tree species codes shared with the bake (tools/geodata/trees.py) and the game
 * (src/world/TreeSpecies.ts): 1 plane, 2 pollarded plane, 3 Lombardy poplar, 4 black poplar,
 * 5 white poplar, 6 willow, 7 alder, 8 ash, 9 false acacia, 10 horse chestnut, 11 lime,
 * 12 catalpa, 13 oak, 14 holm oak, 15 pine, 16 cypress, 17 yew, 18 fruit tree, 19 purple plum.
 */
const SPECIES_CODE: [RegExp, number][] = [
  [/^Platanus/, 1],
  [/^Populus nigra.*[Ii]talica/, 3],
  [/^Populus alba/, 5],
  [/^Populus/, 4],
  [/^Salix/, 6],
  [/^Alnus/, 7],
  [/^Fraxinus|^Ulmus/, 8],
  [/^Robinia/, 9],
  [/^Aesculus/, 10],
  [/^Tilia/, 11],
  [/^Catalpa/, 12],
  [/^Quercus ilex/, 14],
  [/^Quercus/, 13],
  [/^Pinus/, 15],
  [/^Cupressus|^Chamaecyparis|^Thuja|^Cupressocyparis/, 16],
  [/^Taxus/, 17],
  [/^Prunus cerasifera/, 19],
  [/^Malus|^Pyrus|^Prunus|^Juglans|^Ficus/, 18],
];
/** Shrub codes: 0 generic, 1 box, 2 cherry laurel, 3 purple barberry, 4 pampas grass (5: found in the LiDAR by the bake); shrubs are [x, z, code, height]. */
const SHRUB_CODE: [RegExp, number][] = [
  [/^Buxus/, 1],
  [/^Prunus laurocerasus|^Laurus|^Photinia|^Ligustrum/, 2],
  [/^Berberis/, 3],
  [/^Cortaderia/, 4],
];
const codeOf = (table: [RegExp, number][], t: Tags) => {
  const name = t.species ?? t.genus ?? t.taxon ?? '';
  return table.find(([re]) => re.test(name))?.[1] ?? 0;
};
const treeSpecies: number[] = [];
const shrubs: number[] = [];

for (const [id, n] of nodes) {
  if (!n.tags) continue;
  const p = project(n.lat, n.lon);
  if (!inB(p)) continue;
  const t = n.tags;
  if (t.natural === 'tree') {
    const code = codeOf(SPECIES_CODE, t) || (t.leaf_type === 'needleleaved' ? 15 : 0);
    if (code) treeSpecies.push(q(p[0]), q(p[1]), code);
  }
  if (t.natural === 'shrub' || (t.natural === 'plant' && /^Cortaderia/.test(t.species ?? ''))) {
    const code = codeOf(SHRUB_CODE, t);
    shrubs.push(q(p[0]), q(p[1]), code, code === 4 ? 2 : 1.3);
  }
  if (t.natural === 'tree' && t.leaf_type === 'needleleaved') pines.push(q(p[0]), q(p[1]));
  else if (t.natural === 'tree') trees.push(q(p[0]), q(p[1]));
  else if (t.highway === 'street_lamp') {
    // Some lamps are mapped once per lantern: one post per 2.5 m.
    let dup = false;
    for (let i = 0; i < lamps.length && !dup; i += 2) dup = Math.hypot(lamps[i] - p[0], lamps[i + 1] - p[1]) < 2.5;
    if (!dup) lamps.push(q(p[0]), q(p[1]));
  } else if (t.amenity === 'bench' && !t.historic) benches.push(q(p[0]), q(p[1]));
  else if (t.highway === 'crossing' && t.crossing !== 'no') {
    const a = roadAngleAt(id);
    if (a !== null) crossings.push(q(p[0]), q(p[1]), Math.round(a * 1000) / 1000);
  }
  if (t.amenity === 'townhall') pois.push({ k: 'townhall', n: t.name, x: q(p[0]), z: q(p[1]) });
  if (t.historic === 'locomotive') pois.push({ k: 'locomotive', n: t.name, x: q(p[0]), z: q(p[1]) });
  if (t.man_made === 'tower' && t['tower:type'] === 'bell_tower')
    pois.push({ k: 'belltower', x: q(p[0]), z: q(p[1]), ht: parseFloat(t.height) || 0 });
  if (t.historic === 'memorial' && t.memorial === 'bench') pois.push({ k: 'statue', n: t.name, x: q(p[0]), z: q(p[1]) });
  if (t.amenity === 'fuel') pois.push({ k: 'fuel', n: t.name, x: q(p[0]), z: q(p[1]) });
  if (t.highway === 'bus_stop') pois.push({ k: 'bus_stop', n: t.name, x: q(p[0]), z: q(p[1]) });
  if (t.amenity === 'drinking_water' && t.name) pois.push({ k: 'drinking_water', n: t.name, x: q(p[0]), z: q(p[1]) });
}

// Tree rows: one tree every ~7 m along the line.
for (const [id, w] of ways) {
  if (w.tags.natural !== 'tree_row') continue;
  const pts = wayPts(id);
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < len; s += 7) {
      const p = lerpPt(a, b, s / len);
      if (inB(p)) trees.push(q(p[0]), q(p[1]));
    }
  }
}

for (const p of polygons) {
  const t = p.tags;
  const c = centroid(p.outer);
  if (t.leisure === 'bandstand') pois.push({ k: 'bandstand', x: q(c[0]), z: q(c[1]), o: flat(p.outer) });
  if (t.amenity === 'fountain') pois.push({ k: 'fountain', x: q(c[0]), z: q(c[1]), o: flat(p.outer), ht: parseFloat(t.height) || 3 });
}

// ------------------------------------------------------------ establishments

/**
 * Shops, bars, offices and public services, snapped to the street-facing wall
 * of the building that holds them so the game can dress the ground floor
 * (shop window, awning and a sign with the real name).
 */
const SHOP_LABEL: Record<string, string> = {
  hairdresser: 'Peluquería',
  butcher: 'Carnicería',
  car_repair: 'Taller',
  clothes: 'Moda',
  variety_store: 'Bazar',
  supermarket: 'Supermercado',
  seafood: 'Pescadería',
  greengrocer: 'Frutería',
  bakery: 'Panadería',
  tobacco: 'Estanco',
  stationery: 'Papelería',
  shoes: 'Calzados',
  mobile_phone: 'Telefonía',
  massage: 'Masajes',
  lottery: 'Loterías',
  hardware: 'Ferretería',
  electronics: 'Electrónica',
  convenience: 'Alimentación',
  confectionery: 'Confitería',
  beauty: 'Estética',
  pastry: 'Pastelería',
  optician: 'Óptica',
  laundry: 'Lavandería',
  jewelry: 'Joyería',
  florist: 'Floristería',
  deli: 'Charcutería',
  furniture: 'Muebles',
  pet: 'Mascotas',
  photo: 'Fotografía',
  gift: 'Regalos',
  herbalist: 'Herbolario',
  haberdashery: 'Mercería',
  dry_cleaning: 'Tintorería',
  computer: 'Informática',
  chemist: 'Droguería',
  kiosk: 'Kiosco',
  food: 'Alimentación',
  copyshop: 'Copistería',
  garden_centre: 'Jardinería',
  bar: 'Bar',
  pub: 'Pub',
  restaurant: 'Restaurante',
  cafe: 'Cafetería',
  fast_food: 'Comida rápida',
  bank: 'Banco',
  pharmacy: 'Farmacia',
  post_office: 'Correos',
  library: 'Biblioteca',
  cinema: 'Cine',
  theatre: 'Teatro',
  police: 'Guardia Civil',
  courthouse: 'Juzgados',
  veterinary: 'Veterinario',
  dentist: 'Clínica dental',
  clinic: 'Centro de salud',
  nightclub: 'Discoteca',
  community_centre: 'Centro cívico',
  social_facility: 'Residencia',
  school: 'Colegio',
  music_school: 'Escuela de música',
  language_school: 'Academia',
  driving_school: 'Autoescuela',
  arts_centre: 'Casa de cultura',
  fuel: 'Gasolinera',
  conference_centre: 'Centro de congresos',
  events_venue: 'Salón de eventos',
  hotel: 'Hotel',
  hostel: 'Albergue',
  guest_house: 'Casa rural',
  fitness_centre: 'Gimnasio',
  physiotherapist: 'Fisioterapia',
  lawyer: 'Abogados',
  insurance: 'Seguros',
  estate_agent: 'Inmobiliaria',
  architect: 'Arquitectura',
  government: 'Oficina',
  notary: 'Notaría',
  association: 'Asociación',
  bus_station: 'Autobuses',
};
const SHOP_AMENITY = new Set([
  'bar',
  'pub',
  'restaurant',
  'cafe',
  'fast_food',
  'bank',
  'pharmacy',
  'post_office',
  'library',
  'cinema',
  'theatre',
  'police',
  'courthouse',
  'veterinary',
  'dentist',
  'clinic',
  'nightclub',
  'community_centre',
  'social_facility',
  'music_school',
  'language_school',
  'driving_school',
  'arts_centre',
  'events_venue',
  'conference_centre',
  'bus_station',
]);

/** Category used by the game for colours and dressing. */
function shopCategory(tags: Tags): { c: string; label: string } | null {
  // Closed businesses keep their sign (e.g. Bar Capitol): treat disused:* like the live tag.
  const t: Tags = { ...tags };
  if (!t.amenity && t['disused:amenity']) t.amenity = t['disused:amenity'];
  if (!t.shop && t['disused:shop'] && !t.leisure) t.shop = t['disused:shop'];
  if (t.amenity === 'fuel') return { c: 'shop', label: 'Gasolinera' };
  if (t.amenity && SHOP_AMENITY.has(t.amenity)) {
    const a = t.amenity;
    const c = ['bar', 'pub', 'nightclub'].includes(a)
      ? 'bar'
      : ['restaurant', 'fast_food'].includes(a)
        ? 'food'
        : a === 'cafe'
          ? 'cafe'
          : a === 'bank'
            ? 'bank'
            : a === 'pharmacy'
              ? 'pharmacy'
              : a === 'police'
                ? 'police'
                : ['dentist', 'clinic', 'veterinary'].includes(a)
                  ? 'health'
                  : 'civic';
    return { c, label: SHOP_LABEL[a] ?? a };
  }
  if (t.shop && t.shop !== 'vacant') {
    const s = t.shop;
    const c = [
      'butcher',
      'bakery',
      'pastry',
      'confectionery',
      'greengrocer',
      'seafood',
      'deli',
      'supermarket',
      'convenience',
      'food',
    ].includes(s)
      ? 'grocery'
      : ['hairdresser', 'beauty', 'massage'].includes(s)
        ? 'beauty'
        : s === 'car_repair' || s === 'car'
          ? 'garage'
          : 'shop';
    return { c, label: SHOP_LABEL[s] ?? 'Tienda' };
  }
  if (t.tourism && ['hotel', 'hostel', 'guest_house'].includes(t.tourism)) return { c: 'hotel', label: SHOP_LABEL[t.tourism] };
  if (t.leisure === 'fitness_centre') return { c: 'shop', label: 'Gimnasio' };
  if (t.healthcare) return { c: 'health', label: SHOP_LABEL[t.healthcare] ?? 'Clínica' };
  if (t.office) return { c: 'office', label: SHOP_LABEL[t.office] ?? 'Oficina' };
  if (t.craft) return { c: 'garage', label: 'Taller' };
  return null;
}

/** Sign text: official long names are cut down to what a facade sign would say. */
function shortName(t: Tags, fallback: string): string {
  if (t.amenity === 'police') return 'Casa Cuartel Guardia Civil';
  if (t.inscription) return t.inscription;
  // A closed business keeps the name it had (old_name), e.g. Pan Casero Bercedo.
  let n = (t.short_name ?? t.name ?? t.old_name ?? fallback).trim();
  n = n.replace(/ de Villarcayo( de Merindad de Castilla la Vieja)?$/i, '').replace(/ de Merindad de Castilla la Vieja$/i, '');
  while (n.length > 30 && n.lastIndexOf(' de ') > 10) n = n.slice(0, n.lastIndexOf(' de '));
  return n;
}

// Walls that can hold a shop front: ground-level outlines and parts.
interface Wall {
  a: Pt;
  b: Pt;
  n: Pt;
  len: number;
  key: string;
  /** The footprint the wall belongs to (index in `buildings`). */
  bi: number;
  /** Last ring edge merged into this wall (the key holds the first). */
  end: number;
}
const wallGrid = new Map<string, Wall[]>();
const WG = 30;
buildings.forEach((b, bi) => {
  // Only walls the game actually draws: parts replace their outline (hp).
  if (['townhall', 'torre', 'church', 'canopy', 'ruins', 'greenhouse'].includes(b.t) || (b.mlv ?? 0) > 0 || b.hp) return;
  const ring: Pt[] = [];
  for (let i = 0; i < b.o.length; i += 2) ring.push([b.o[i], b.o[i + 1]]);
  const ccw = signedArea(ring) > 0;
  const hid = new Set(b.hid ?? []);
  // Cadastral outlines split a straight facade at every party wall: runs of nearly
  // collinear visible edges are merged so short pieces still make one facade.
  const dirOf = (i: number) => {
    const a = ring[i],
      c = ring[(i + 1) % ring.length];
    return Math.atan2(c[1] - a[1], c[0] - a[0]);
  };
  const sameDir = (i: number, j: number) => Math.abs(Math.atan2(Math.sin(dirOf(i) - dirOf(j)), Math.cos(dirOf(i) - dirOf(j)))) < 0.14;
  let start = 0;
  while (
    start < ring.length &&
    !hid.has((start + ring.length - 1) % ring.length) &&
    sameDir((start + ring.length - 1) % ring.length, start) &&
    start < ring.length - 1
  )
    start++;
  for (let s = 0; s < ring.length; s++) {
    const i = (start + s) % ring.length;
    if (hid.has(i)) continue;
    let e = i;
    while (s + 1 < ring.length && !hid.has((e + 1) % ring.length) && sameDir(i, (e + 1) % ring.length)) {
      e = (e + 1) % ring.length;
      s++;
    }
    const a = ring[i],
      c = ring[(e + 1) % ring.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 2.5) continue;
    // Outward normal: right of the edge for CCW rings (X right, Z up), left otherwise.
    const dx = (c[0] - a[0]) / len,
      dz = (c[1] - a[1]) / len;
    const n: Pt = ccw ? [dz, -dx] : [-dz, dx];
    const w: Wall = { a, b: c, n, len, key: `${bi}:${i}`, bi, end: e };
    const k = `${Math.floor((a[0] + c[0]) / 2 / WG)},${Math.floor((a[1] + c[1]) / 2 / WG)}`;
    (wallGrid.get(k) ?? wallGrid.set(k, []).get(k)!).push(w);
  }
});
const roadSegGrid = new Map<string, { a: Pt; b: Pt; w: number; n?: string }[]>();
for (const r of roads) {
  if (!VEHICLE.has(r.k) && r.k !== 'pedestrian' && r.k !== 'footway') continue;
  for (let i = 2; i < r.p.length; i += 2) {
    const a: Pt = [r.p[i - 2], r.p[i - 1]],
      b: Pt = [r.p[i], r.p[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / WG));
    const keys = new Set<string>();
    for (let s = 0; s <= n; s++)
      keys.add(`${Math.floor((a[0] + ((b[0] - a[0]) * s) / n) / WG)},${Math.floor((a[1] + ((b[1] - a[1]) * s) / n) / WG)}`);
    for (const k of keys) (roadSegGrid.get(k) ?? roadSegGrid.set(k, []).get(k)!).push({ a, b, w: r.w, n: r.n });
  }
}
/** Street name normalised for comparisons ("C/ San Roque" = "Calle de San Roque" = "san roque"). */
function streetKey(n: string | undefined): string {
  return (n ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(c\/|c\.|calle|avenida|avda\.?|av\.|plaza|pza\.?|paseo|camino|carretera|ctra\.?|travesia|ronda|glorieta)\s+/, '')
    .replace(/^(de|del|de la|de los|de las)\s+/, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}
/** Name of the nearest named street within `max` m of p (beyond its kerb). */
function nearestStreetName(p: Pt, max: number): string | undefined {
  let best = max,
    name: string | undefined;
  const cx = Math.floor(p[0] / WG),
    cz = Math.floor(p[1] / WG);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (const s of roadSegGrid.get(`${cx + i},${cz + j}`) ?? []) {
        const d = segDist(p, s.a, s.b) - s.w / 2;
        if (s.n && d < best) {
          best = d;
          name = s.n;
        }
      }
  return name;
}
function streetGap(p: Pt): number {
  let best = Infinity;
  const cx = Math.floor(p[0] / WG),
    cz = Math.floor(p[1] / WG);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      for (const s of roadSegGrid.get(`${cx + i},${cz + j}`) ?? []) best = Math.min(best, segDist(p, s.a, s.b) - s.w / 2);
    }
  return best;
}
const plazaRing = plazaWay
  ? plazaWay.nds
      .slice(0, -1)
      .map(nodePt)
      .filter((p): p is Pt => !!p)
  : null;

/** Normalised name of the street (or the Plaza Mayor) a point in front of a facade looks onto. */
function facingStreet(p: Pt): string {
  if (plazaRing && pointInRing(p, plazaRing)) return streetKey('Plaza Mayor');
  return streetKey(nearestStreetName(p, 12));
}

interface ShopOut {
  /** Secondary front of a corner shop (no terrace). */
  s?: 1;
  /** No terrace in front (photos). */
  nt?: 1;
  /** Terrace in front (photos). */
  tr?: 1;
  /** Awning colour (photos). */
  aw?: string;
  /** Raised door (photos). */
  dy?: number;
  /** Lit sign (photos). */
  lit?: 1;
  x: number;
  z: number;
  a: number;
  w: number;
  c: string;
  n: string;
}
const shops: ShopOut[] = [];
/** Widest front of an ordinary shop, bar or office (the big stores may take up to MAX_FRONT). */
const SMALL_FRONT = 8;
const shopStats = { onAddressStreet: 0, otherStreet: 0, noStreetNear: 0, ownBuilding: 0, neighbourBuilding: 0, cornerFronts: 0 };
// Building footprints on a grid, to tell walls that look onto a street from courtyard and party walls.
// Arcades (soportales: parts raised above the ground) and canopies are open at street level.
const footGrid = new Map<string, { ring: Pt[]; open: boolean; outline: boolean }[]>();
for (const b of buildings) {
  if (b.t === 'canopy') continue;
  const ring: Pt[] = [];
  for (let k = 0; k < b.o.length; k += 2) ring.push([b.o[k], b.o[k + 1]]);
  const open = (b.mlv ?? 0) > 0;
  const xs = ring.map((p) => p[0]),
    zs = ring.map((p) => p[1]);
  for (let gx = Math.floor(Math.min(...xs) / WG); gx <= Math.floor(Math.max(...xs) / WG); gx++)
    for (let gz = Math.floor(Math.min(...zs) / WG); gz <= Math.floor(Math.max(...zs) / WG); gz++) {
      const k = `${gx},${gz}`;
      (footGrid.get(k) ?? footGrid.set(k, []).get(k)!).push({ ring, open, outline: !!b.hp });
    }
}
/** 'solid' inside a ground-level building or part; 'outline' only inside the outline of a building drawn by its parts; 'free' otherwise. */
const groundAt = (p: Pt): 'solid' | 'outline' | 'free' => {
  const cell = (footGrid.get(`${Math.floor(p[0] / WG)},${Math.floor(p[1] / WG)}`) ?? []).filter((f) => pointInRing(p, f.ring));
  if (cell.some((f) => f.open)) return 'free';
  if (cell.some((f) => !f.outline)) return 'solid';
  return cell.length ? 'outline' : 'free';
};

/**
 * True if, walking out from the middle of the wall, a street or the Plaza
 * Mayor is reached before any building: a shop front cannot be on a
 * courtyard wall or on a wall shared with the house next door.
 */
function looksOntoStreet(w: Wall): boolean {
  const mx = (w.a[0] + w.b[0]) / 2,
    mz = (w.a[1] + w.b[1]) / 2;
  // Up to 3.5 m inside an outline but outside all of its parts is an arcade or a porch
  // (soportal); any further it is the building's courtyard or interior.
  let underOutline = 0;
  for (let d = 0.6; d <= 16; d += 0.6) {
    const p: Pt = [mx + w.n[0] * d, mz + w.n[1] * d];
    const g = groundAt(p);
    if (g === 'solid') return false;
    if (g === 'outline' && (underOutline += 0.6) > 3.5) return false;
    if (streetGap(p) <= 0.5 || (plazaRing && pointInRing(p, plazaRing))) return true;
  }
  return false;
}

/** Footprints (outline and its parts) that contain p: the shop's own building. */
function buildingsAt(p: Pt): Set<number> {
  const out = new Set<number>();
  buildings.forEach((b, bi) => {
    const xs = b.o.filter((_, k) => k % 2 === 0),
      zs = b.o.filter((_, k) => k % 2 === 1);
    if (p[0] < Math.min(...xs) - 1 || p[0] > Math.max(...xs) + 1 || p[1] < Math.min(...zs) - 1 || p[1] > Math.max(...zs) + 1) return;
    const ring: Pt[] = [];
    for (let k = 0; k < b.o.length; k += 2) ring.push([b.o[k], b.o[k + 1]]);
    if (pointInRing(p, ring)) out.add(bi);
  });
  // A point inside an outline drawn by its parts belongs to every part of that outline.
  for (const bi of [...out]) {
    if (!buildings[bi].hp) continue;
    const ring: Pt[] = [];
    for (let k = 0; k < buildings[bi].o.length; k += 2) ring.push([buildings[bi].o[k], buildings[bi].o[k + 1]]);
    buildings.forEach((b, pi) => {
      if (!b.part) return;
      const pr: Pt[] = [];
      for (let k = 0; k < b.o.length; k += 2) pr.push([b.o[k], b.o[k + 1]]);
      if (pointInRing(centroid(pr), ring)) out.add(pi);
    });
  }
  return out;
}

/**
 * Shop front on the wall of the shop's own building that faces its address
 * street. Candidates are the exposed ground-floor walls within 30 m, scored by
 * distance, with a strong preference for the building that contains the
 * point and for walls that face the street named in addr:street (a shop is
 * never moved to the other side of the street because that facade is closer).
 */
function placeShop(p: Pt, t: Tags, frontage?: number): void {
  const cat = shopCategory(t);
  if (!cat || !inB(p)) return;
  const label = shortName(t, cat.label);
  const own = buildingsAt(p);
  const street = streetKey(t['addr:street']);
  const cands: { w: Wall; s: number; t: number }[] = [];
  const cx = Math.floor(p[0] / WG),
    cz = Math.floor(p[1] / WG);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      for (const w of wallGrid.get(`${cx + i},${cz + j}`) ?? []) {
        const d = segDist(p, w.a, w.b);
        if (d > 30) continue;
        const tt = Math.max(0, Math.min(1, ((p[0] - w.a[0]) * (w.b[0] - w.a[0]) + (p[1] - w.a[1]) * (w.b[1] - w.a[1])) / (w.len * w.len)));
        const m: Pt = [w.a[0] + (w.b[0] - w.a[0]) * tt + w.n[0] * 2.5, w.a[1] + (w.b[1] - w.a[1]) * tt + w.n[1] * 2.5];
        const gap = streetGap(m);
        const open = (gap < 10 || (plazaRing && pointInRing(m, plazaRing))) && looksOntoStreet(w);
        const facing = street ? facingStreet(m) : '';
        const streetScore = !street || !facing ? 0 : facing === street ? -10 : 12;
        const score =
          d + (open ? 0 : 30) + (w.len < 3 ? 6 : 0) + Math.max(0, gap) * 0.3 + (own.size && !own.has(w.bi) ? 15 : 0) + streetScore;
        if (score <= 45) cands.push({ w, s: score, t: tt });
      }
    }
  if (!cands.length) return;
  cands.sort((x, y) => x.s - y.s);
  if (process.env.SHOPDBG && label.includes(process.env.SHOPDBG))
    console.error(
      label,
      p.map((v) => v.toFixed(1)),
      [...own],
      cands
        .slice(0, 6)
        .map((c) => [
          c.w.bi,
          c.s.toFixed(1),
          c.w.a.map((v) => v.toFixed(0)).join(','),
          c.w.b.map((v) => v.toFixed(0)).join(','),
          looksOntoStreet(c.w),
        ]),
    );
  const big = ['supermarket', 'department_store', 'doityourself', 'hardware', 'furniture', 'car', 'garden_centre', 'trade'].includes(
    t.shop ?? '',
  );
  pending.push({
    w: cands[0].w,
    t: cands[0].t,
    s: cands[0].s,
    cands: cands.slice(0, 5),
    c: cat.c,
    n: label,
    frontage: frontage ?? (big ? undefined : SMALL_FRONT),
    street,
    own,
  });
}

interface PendingShop {
  w: Wall;
  /** Position of the shop's point along the wall (0..1). */
  t: number;
  s: number;
  /** Best walls, best first. */
  cands: { w: Wall; s: number; t: number }[];
  c: string;
  n: string;
  frontage?: number;
  street: string;
  own: Set<number>;
}
const pending: PendingShop[] = [];
/** Free-standing kiosks (newspapers, the ONCE lottery booth): built as kiosks, not as shop fronts. */
const kiosks: { x: number; z: number; t: string }[] = [];
const liveNames = new Set<string>();
for (const n of nodes.values()) if (n.tags?.name && (n.tags.shop || n.tags.amenity)) liveNames.add(n.tags.name);
for (const n of nodes.values()) {
  if (!n.tags) continue;
  const fix = n.tags.name ? corrections.shops?.[n.tags.name] : undefined;
  const p = fix?.at ?? project(n.lat, n.lon);
  let tags = n.tags;
  if (fix?.name) {
    tags = { ...tags, name: fix.name };
    delete tags.brand;
  }
  // The street a corrected shop really opens onto (a corner bank's postal address can be the side street).
  if (fix?.street !== undefined) tags = { ...tags, 'addr:street': fix.street };
  // A business that moved (Mercería la Goya) leaves its old premises: no sign at both addresses.
  if (!tags.name && tags.old_name && liveNames.has(tags.old_name)) continue;
  const isKiosk = tags.shop === 'kiosk' || (tags.shop === 'lottery' && /ONCE/.test(tags.brand ?? tags.name ?? ''));
  if (isKiosk && inB(p) && buildingsAt(p).size === 0) {
    kiosks.push({ x: q(p[0]), z: q(p[1]), t: tags.name ?? (tags.shop === 'lottery' ? 'ONCE' : 'Prensa') });
    continue;
  }
  if (fix?.front) {
    // A front checked on photos on a building OSM lacks (traced from the LiDAR later on).
    const cat = shopCategory(tags);
    if (cat) {
      const [x, z, a, w] = fix.front;
      shops.push({ x, z, a, w, c: cat.c, n: shortName(tags, cat.label) });
    }
    continue;
  }
  placeShop(p, tags, fix?.w);
}
for (const e of corrections.extraShops ?? []) shops.push({ x: e.x, z: e.z, a: e.a, w: e.w, c: e.c, n: e.n });
for (const p of polygons) {
  if (p.tags.amenity === 'place_of_worship' || p.tags.amenity === 'townhall' || p.tags.amenity === 'school') continue;
  if (!shopCategory(p.tags) || Math.abs(signedArea(p.outer)) >= 6000) continue;
  // Keyed by the OSM name or by the label it is shown with (the courthouse area is "Juzgados").
  const cat0 = shopCategory(p.tags)!;
  const pfix = (p.tags.name ? corrections.shops?.[p.tags.name] : undefined) ?? corrections.shops?.[shortName(p.tags, cat0.label)];
  if (pfix?.front) {
    // A front checked on photos (the Juzgados, mapped as an area): only there.
    const cat = cat0;
    const [x, z, a, w] = pfix.front;
    shops.push({ x, z, a, w, c: cat.c, n: shortName(p.tags, cat.label) });
    continue;
  }
  // Frontage: the longest side of the mapped unit.
  let side = 0;
  for (let i = 0; i < p.outer.length; i++) {
    const a = p.outer[i],
      b = p.outer[(i + 1) % p.outer.length];
    side = Math.max(side, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  placeShop(centroid(p.outer), p.tags, side);
}

/**
 * Each facade is shared out among the shops mapped along it, in their order
 * along the wall: a shop's front runs from halfway to the previous shop to
 * halfway to the next one (or to the end of the wall), so a shop alone in
 * its unit takes the whole frontage. Corner shops turn the corner when the
 * next wall of their building also looks onto a street and has no shop.
 */
const wallByKey = new Map<string, Wall>();
const wallByEnd = new Map<string, Wall>();
for (const ws of wallGrid.values())
  for (const w of ws) {
    wallByKey.set(w.key, w);
    wallByEnd.set(`${w.bi}:${w.end}`, w);
  }
const byWall = new Map<string, PendingShop[]>();
// Best-fitting shops first; a wall holds one front per 2.6 m, the rest go to their next best wall.
const MIN_FRONT = 2.6;
for (const ps of [...pending].sort((x, y) => x.s - y.s)) {
  const c = ps.cands.find((c) => (byWall.get(c.w.key)?.length ?? 0) < Math.max(1, Math.floor((c.w.len - 0.8) / MIN_FRONT)));
  if (!c) continue;
  ps.w = c.w;
  ps.t = c.t;
  (byWall.get(c.w.key) ?? byWall.set(c.w.key, []).get(c.w.key)!).push(ps);
}
const MARGIN = 0.4;
const MAX_FRONT = 14;
function emit(w: Wall, t0: number, t1: number, ps: PendingShop, main: boolean): void {
  const width = (t1 - t0) * w.len;
  if (width < 1.6) return;
  const tc = (t0 + t1) / 2;
  shops.push({
    x: q(w.a[0] + (w.b[0] - w.a[0]) * tc),
    z: q(w.a[1] + (w.b[1] - w.a[1]) * tc),
    a: Math.round(Math.atan2(w.n[0], w.n[1]) * 1000) / 1000,
    w: q(width),
    c: ps.c,
    n: ps.n,
    ...(main ? {} : { s: 1 }),
  });
}
for (const [key, list] of byWall) {
  const w = wallByKey.get(key)!;
  list.sort((x, y) => x.t - y.t);
  const m = MARGIN / w.len;
  // Shops whose points crowd together (or project past the same end) share the wall evenly, in order.
  const crowded = list.some((ps, i) => i > 0 && (ps.t - list[i - 1].t) * w.len < MIN_FRONT);
  if (crowded)
    list.forEach((ps, i) => {
      ps.t = (i + 0.5) / list.length;
    });
  list.forEach((ps, i) => {
    let lo = i === 0 ? m : (list[i - 1].t + ps.t) / 2 + m / 2;
    let hi = i === list.length - 1 ? 1 - m : (ps.t + list[i + 1].t) / 2 - m / 2;
    // Never wider than the mapped unit, nor than a typical large shop.
    const cap = Math.min(ps.frontage ?? MAX_FRONT, MAX_FRONT) / w.len;
    if (hi - lo > cap) {
      const c = Math.max(lo + cap / 2, Math.min(hi - cap / 2, ps.t));
      lo = c - cap / 2;
      hi = c + cap / 2;
    }
    emit(w, lo, hi, ps, true);
    if (ps.street) {
      const f = facingStreet([w.a[0] + (w.b[0] - w.a[0]) * ps.t + w.n[0] * 2.5, w.a[1] + (w.b[1] - w.a[1]) * ps.t + w.n[1] * 2.5]);
      shopStats[f === ps.street ? 'onAddressStreet' : f ? 'otherStreet' : 'noStreetNear']++;
    }
    if (ps.own.size) shopStats[ps.own.has(w.bi) ? 'ownBuilding' : 'neighbourBuilding']++;
    // Corner: the front reaches a wall end, and the building's next wall looks onto a street too.
    for (const [atEnd, step] of [
      [hi >= 1 - m - 1e-6, 1],
      [lo <= m + 1e-6, -1],
    ] as [boolean, number][]) {
      if (!atEnd || (step === 1 ? (1 - ps.t) * w.len : ps.t * w.len) > 5) continue;
      const n = buildings[w.bi].o.length / 2;
      const ei = Number(w.key.split(':')[1]);
      const next = step === 1 ? wallByKey.get(`${w.bi}:${(w.end + 1) % n}`) : wallByEnd.get(`${w.bi}:${(ei - 1 + n) % n}`);
      if (!next || byWall.has(next.key) || !looksOntoStreet(next)) continue;
      const len = Math.min(next.len - MARGIN, 5);
      if (step === 1) emit(next, MARGIN / next.len, MARGIN / next.len + len / next.len, ps, false);
      else emit(next, 1 - MARGIN / next.len - len / next.len, 1 - MARGIN / next.len, ps, false);
      shopStats.cornerFronts++;
    }
  });
}

/** Direction (radians, rotation about Y) of the nearest street or path segment, for unoriented street furniture. */
function roadAngleNear(p: Pt): number {
  let best = Infinity,
    ang = 0;
  const cx = Math.floor(p[0] / WG),
    cz = Math.floor(p[1] / WG);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (const s of roadSegGrid.get(`${cx + i},${cz + j}`) ?? []) {
        const d = segDist(p, s.a, s.b);
        if (d < best) {
          best = d;
          ang = Math.atan2(-(s.b[1] - s.a[1]), s.b[0] - s.a[0]);
        }
      }
  return ang;
}

// ------------------------------------------------------- street furniture

/**
 * Street furniture at its mapped position: traffic signs (STOP and give way
 * stand on the right-hand kerb facing the traffic that approaches the
 * junction), recycling containers by type, bins, planters, fountains,
 * hydrants, information panels, cameras, cabinets, post boxes, defibrillators,
 * chargers, billboards (the Ayuntamiento's digital screen: animated) and the
 * poles of the overhead power lines, with the lines themselves.
 */
interface FurnitureOut {
  k: string;
  x: number;
  z: number;
  /** Heading the item faces (rotation about Y; local +Z). */
  a: number;
  /** Subtype: recycling streams ("glass,paper"), sign code, "digital" screens. */
  t?: string;
}
const furniture: FurnitureOut[] = [];
const highwayWaysOf = new Map<string, string[]>();
for (const [id, w] of ways) {
  if (!w.tags.highway || !ROAD_WIDTH[w.tags.highway]) continue;
  for (const n of w.nds) (highwayWaysOf.get(n) ?? highwayWaysOf.set(n, []).get(n)!).push(id);
}
const roadWidthOf = (wid: string) => {
  const t = ways.get(wid)!.tags;
  const tw = parseFloat(t.width);
  return Number.isFinite(tw) && tw > 1 && tw < 30 ? tw : (ROAD_WIDTH[t.highway] ?? 5);
};
/** Sign on the kerb: right-hand side of the traffic heading to the nearer junction of its way, facing it. */
function signPose(nid: string, p: Pt, tags: Tags): { x: number; z: number; a: number } {
  const wid = highwayWaysOf.get(nid)?.[0];
  if (!wid) {
    // A standalone sign beside the road: face along the nearest street.
    const a = roadAngleNear(p);
    return { x: p[0], z: p[1], a };
  }
  const nds = ways.get(wid)!.nds;
  const i = nds.indexOf(nid);
  const pts = nds.map(nodePt);
  // Traffic flows towards the closer end (the junction), unless the sign says otherwise.
  const toEnd = i >= nds.length / 2;
  let forward = toEnd;
  if (tags.direction === 'forward') forward = true;
  else if (tags.direction === 'backward') forward = false;
  const a0 = pts[Math.max(0, forward ? i - 1 : i)] ?? p,
    b0 = pts[Math.min(nds.length - 1, forward ? i : i + 1)] ?? p;
  let dx = (forward ? b0[0] - a0[0] : a0[0] - b0[0]) || 0,
    dz = (forward ? b0[1] - a0[1] : a0[1] - b0[1]) || 0;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const off = roadWidthOf(wid) / 2 + 0.7;
  // Right of travel (Spain drives on the right) is (-dz, dx); the face looks back at the traffic.
  return { x: p[0] - dz * off, z: p[1] + dx * off, a: Math.atan2(-dx, -dz) };
}
const RECYCLING: [RegExp, string][] = [
  [/^recycling:(glass|glass_bottles)$/, 'glass'],
  [/^recycling:(paper|cardboard)$/, 'paper'],
  [/^recycling:(plastic|plastic_packaging|plastic_bottles|plastic_bottle_tops|cans|pmd|beverage_cartons)$/, 'plastic'],
  [/^recycling:(organic|food_waste)$/, 'organic'],
  [/^recycling:(clothes|shoes)$/, 'clothes'],
  [/^recycling:(batteries)$/, 'batteries'],
];
for (const [nid, n] of nodes) {
  const t = n.tags;
  if (!t) continue;
  const p = project(n.lat, n.lon);
  if (!inB(p)) continue;
  const put = (k: string, extra: Partial<FurnitureOut> = {}) =>
    furniture.push({ k, x: q(p[0]), z: q(p[1]), a: Math.round(roadAngleNear(p) * 1000) / 1000, ...extra });
  if (t.highway === 'stop' || t.traffic_sign === 'ES:R2' || t.highway === 'give_way' || t.traffic_sign === 'ES:R1') {
    const k = t.highway === 'stop' || t.traffic_sign === 'ES:R2' ? 'stop' : 'give_way';
    const pose = signPose(nid, p, t);
    furniture.push({ k, x: q(pose.x), z: q(pose.z), a: Math.round(pose.a * 1000) / 1000 });
  } else if (t.amenity === 'recycling') {
    const streams = [
      ...new Set(
        Object.keys(t)
          .filter((k) => t[k] === 'yes')
          .map((k) => RECYCLING.find(([re]) => re.test(k))?.[1])
          .filter((v): v is string => !!v),
      ),
    ];
    // Without recycling:* tags the container's colour tells the stream.
    const byColour: Record<string, string> = { blue: 'paper', yellow: 'plastic', green: 'glass', brown: 'organic', orange: 'organic' };
    if (!streams.length && byColour[t.colour]) streams.push(byColour[t.colour]);
    put('recycling', { t: (streams.length ? streams : ['other']).join(',') });
  } else if (t.amenity === 'waste_basket') put('bin');
  else if (t.amenity === 'waste_disposal') put('container');
  else if (t.man_made === 'planter') put('planter');
  else if (t.amenity === 'drinking_water' || t.man_made === 'water_tap') put('fountain');
  else if (t.emergency === 'fire_hydrant') put('hydrant');
  else if (t.tourism === 'information' && ['board', 'map', 'guidepost'].includes(t.information)) put('info', { t: t.information });
  else if (t.man_made === 'surveillance') put('camera');
  else if (t.man_made === 'street_cabinet') put('cabinet');
  else if (t.amenity === 'post_box') put('postbox');
  else if (t.emergency === 'defibrillator') put('aed');
  else if (t.amenity === 'charging_station') put('charger');
  else if (t.advertising === 'billboard' || t.advertising === 'screen' || t.advertising === 'column')
    put('billboard', t.animated || t.advertising === 'screen' ? { t: 'digital' } : {});
  else if (t.power === 'pole' || t.power === 'tower') put(t.power);
  else if (t.man_made === 'flagpole') put('flagpole', { t: (t.country ?? t['flag:name'] ?? 'ES').slice(0, 2).toUpperCase() });
  else if (t.tourism === 'artwork' && t.artwork_type === 'statue') put('statue', t.name ? { t: t.name } : {});
  else if (t.highway === 'milestone' && t.ref) put('milestone', { t: `${t.ref}|${t.distance ?? ''}` });
  // Spanish S-13 pedestrian-crossing sign on both kerbs of every zebra on a street with traffic.
  if (t.highway === 'crossing' && t.crossing !== 'no' && t.crossing !== 'unmarked') {
    const wid = highwayWaysOf.get(nid)?.find((w) => VEHICLE.has(ways.get(w)!.tags.highway) && ways.get(w)!.tags.highway !== 'service');
    if (wid) {
      const nds = ways.get(wid)!.nds;
      const i = nds.indexOf(nid);
      const a0 = nodePt(nds[Math.max(0, i - 1)]),
        b0 = nodePt(nds[Math.min(nds.length - 1, i + 1)]);
      if (a0 && b0) {
        const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1;
        const dx = (b0[0] - a0[0]) / len,
          dz = (b0[1] - a0[1]) / len;
        const off = roadWidthOf(wid) / 2 + 0.6;
        // Right-hand kerb of each direction, a metre before the zebra, facing the traffic.
        for (const s of [1, -1]) {
          const x = p[0] - dz * off * s - dx * 1.2 * s,
            z = p[1] + dx * off * s - dz * 1.2 * s;
          furniture.push({ k: 'sign', x: q(x), z: q(z), a: Math.round(Math.atan2(-dx * s, -dz * s) * 1000) / 1000, t: 'S-13' });
        }
      }
    }
  }
}
for (const k of kiosks) furniture.push({ k: 'kiosk', x: k.x, z: k.z, a: Math.round(roadAngleNear([k.x, k.z]) * 1000) / 1000, t: k.t });
// Checked furniture: first take out every piece a correction replaces (the closest one within 2 m),
// then add the corrected ones, so a correction never removes another correction's piece.
const furnitureFixes = corrections.furniture ?? [];
for (const { replaces, k } of furnitureFixes) {
  if (!replaces) continue;
  let best = -1,
    bestD = 2;
  furniture.forEach((g, i) => {
    const d = Math.hypot(g.x - replaces[0], g.z - replaces[1]);
    if (g.k === k && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  if (best >= 0) furniture.splice(best, 1);
}
for (const { replaces, ...f } of furnitureFixes) furniture.push(f);
// Overhead power lines, pole to pole.
const powerlines: { p: number[]; k: string }[] = [];
for (const [id, w] of ways) {
  const pw = w.tags.power;
  if (pw !== 'line' && pw !== 'minor_line') continue;
  for (const part of clipLine(wayPts(id))) if (part.length > 1) powerlines.push({ p: flat(part), k: pw === 'line' ? 'line' : 'minor' });
}

// Picnic tables: only the ones mapped in OSM (none are invented around picnic sites).
const tables: number[] = [];
for (const n of nodes.values()) {
  const t = n.tags;
  if (!t || t.leisure !== 'picnic_table') continue;
  const p = project(n.lat, n.lon);
  if (!inB(p)) continue;
  // Orientation is not mapped: face the nearest street, like the benches.
  const a = roadAngleNear(p);
  tables.push(q(p[0]), q(p[1]), Math.round(a * 100) / 100, t.material === 'stone' ? 1 : 0);
}

// Playground equipment points (centroid of each mapped playground).
const playgrounds: number[] = [];
for (const p of polygons)
  if (p.tags.leisure === 'playground') {
    const c = centroid(p.outer);
    playgrounds.push(q(c[0]), q(c[1]));
  }
for (const n of nodes.values())
  if (n.tags?.leisure === 'playground') {
    const p = project(n.lat, n.lon);
    if (inB(p)) playgrounds.push(q(p[0]), q(p[1]));
  }

// ---------------------------------------------------------------- output

// Checked on photos (corrections.shops[name]): terrace or none (terrace: true / false), awning
// colour, and a back door on the other street (`back`, a second front without terrace).
for (const [key, f] of Object.entries(corrections.shops ?? {})) {
  const name = f.name ?? key;
  const mine = shops.filter((sh) => sh.n === name);
  for (const sh of mine) {
    if (f.terrace === false) sh.nt = 1;
    if (f.terrace === true && !sh.s) sh.tr = 1;
    if (f.awning) sh.aw = f.awning;
    if (f.dy && !sh.s) sh.dy = f.dy;
    if (f.lit) sh.lit = 1;
  }
  if (f.back && mine.length) {
    const [x, z, a, w] = f.back;
    shops.push({ s: 1, x, z, a, w, c: mine[0].c, n: name, ...(f.awning ? { aw: f.awning } : {}), ...(f.lit ? { lit: 1 } : {}) });
  }
}

// The same business mapped twice (two "Las Acacias" nodes) with a checked front: one sign.
{
  const seen = new Set<string>();
  for (let i = shops.length - 1; i >= 0; i--) {
    const k = `${shops[i].n}|${shops[i].x}|${shops[i].z}`;
    if (seen.has(k)) shops.splice(i, 1);
    else seen.add(k);
  }
}

const out = {
  meta: {
    source: 'OpenStreetMap contributors (ODbL 1.0)',
    file: IN,
    origin: { lat: +lat0.toFixed(8), lon: +lon0.toFixed(8), note: 'Centroid of the Plaza Mayor (place=square)' },
    crs: 'EPSG:25830',
    /** UTM 30N easting/northing of the local origin: E = x + E0, N = N0 - z. */
    utmOrigin: { E: E0, N: N0 },
    projection: 'ETRS89 / UTM 30N shifted to the origin; x east, z south, metres',
    bounds: B,
  },
  buildings: buildings.filter((b) => !orphanParts.has(b)),
  areas,
  roads,
  rails,
  rivers,
  streams,
  weirs,
  trees,
  pines,
  treeSpecies,
  shrubs,
  lamps,
  benches,
  crossings,
  pois,
  shops,
  tables,
  playgrounds,
  barriers,
  bollards,
  furniture,
  powerlines,
};
mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify(out);
writeFileSync(OUT, json);
console.log(`origin ${lat0.toFixed(6)}, ${lon0.toFixed(6)}  bounds ${JSON.stringify(B)}`);
console.log(
  `buildings ${buildings.length} (parts ${partsTmp.length}, outlines with parts ${outlines.filter((o) => o.b.hp).length}, ${filledOutlines} completed with ${Math.round(filledArea)} m2 the parts left out)  areas ${areas.length}  roads ${roads.length}  rails ${rails.length}  rivers ${rivers.length}  streams ${streams.length}  weirs ${weirs.length}`,
);
console.log(
  `trees ${trees.length / 2}  lamps ${lamps.length / 2}  benches ${benches.length / 2}  crossings ${crossings.length / 3}  pois ${pois.length}`,
);
console.log('shop fronts', JSON.stringify(shopStats));
console.log(
  `barriers ${barriers.length} (OSM)  bollards ${bollards.length / 2}  furniture ${furniture.length}  power lines ${powerlines.length}`,
);
console.log(`shops ${shops.length}  picnic tables ${tables.length / 4}  playgrounds ${playgrounds.length / 2}`);
console.log(`→ ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
