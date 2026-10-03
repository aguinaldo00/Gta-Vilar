/**
 * OSM → game map converter.
 *
 *   node scripts/osm-to-map.ts [input.osm] [output.json]
 *
 * Reads an OpenStreetMap XML export (data/villarcayo.osm by default) and
 * writes the simplified, projected map the game loads
 * (public/maps/villarcayo.json, fetched at runtime). The browser never parses OSM.
 *
 * Projection: equirectangular around the centroid of the Plaza Mayor
 * (place=square, name=Plaza Mayor). +X = east, +Z = south, metres.
 * x = (lon - lon0) · cos(lat0) · π/180 · R,  z = -(lat - lat0) · π/180 · R
 *
 * Map data © OpenStreetMap contributors, ODbL 1.0.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type Tags = Record<string, string>;
type Pt = [number, number];
type Ring = Pt[];

const IN = process.argv[2] ?? 'data/villarcayo.osm';
const OUT = process.argv[3] ?? 'public/maps/villarcayo.json';
const EARTH_R = 6371008.8;

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

const kx = Math.cos((lat0 * Math.PI) / 180) * (Math.PI / 180) * EARTH_R;
const kz = (Math.PI / 180) * EARTH_R;
const q = (v: number) => Math.round(v * 10) / 10;
const project = (lat: number, lon: number): Pt => [(lon - lon0) * kx, -(lat - lat0) * kz];
const nodePt = (id: string): Pt | null => {
  const n = nodes.get(id);
  return n ? project(n.lat, n.lon) : null;
};

const [bx0, bz1] = project(+bnd.minlat, +bnd.minlon);
const [bx1, bz0] = project(+bnd.maxlat, +bnd.maxlon);
const B = { minX: q(bx0), maxX: q(bx1), minZ: q(bz0), maxZ: q(bz1) };
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

// ---------------------------------------------------------- polygon source

interface Poly {
  id: string;
  tags: Tags;
  outer: Ring;
  holes: Ring[];
}

/** Every closed way and multipolygon relation as polygons (clipped to bounds). */
function collectPolygons(): Poly[] {
  const out: Poly[] = [];
  for (const [id, w] of ways) {
    if (w.nds.length < 4 || w.nds[0] !== w.nds[w.nds.length - 1]) continue;
    const ring = cleanRing(wayPts(id), 0.25);
    if (!ring) continue;
    const clipped = clipRing(ring);
    if (clipped) out.push({ id: `w${id}`, tags: w.tags, outer: clipped, holes: [] });
  }
  for (const [id, r] of rels) {
    if (r.tags.type !== 'multipolygon') continue;
    const outerIds = r.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => m.ref);
    const innerIds = r.members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => m.ref);
    let tags = r.tags;
    // Old-style multipolygons keep their tags on the outer way.
    if (Object.keys(tags).length <= 1 && outerIds.length === 1) tags = ways.get(outerIds[0])?.tags ?? tags;
    const holes = assembleRings(innerIds)
      .map((h) => cleanRing(h, 0.25))
      .filter((h): h is Ring => !!h);
    for (const o of assembleRings(outerIds)) {
      const ring = cleanRing(o, 0.25);
      const clipped = ring && clipRing(ring);
      if (!clipped) continue;
      out.push({ id: `r${id}`, tags, outer: clipped, holes: holes.filter((h) => pointInRing(h[0], clipped)) });
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
  ids: string[];
  bottom: number;
  top: number;
}
const partsTmp: PartTmp[] = [];
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
  partsTmp.push({ out, ids, bottom: mlv, top: ht ?? mlv + lv });
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
  p: number[];
  k: string;
  w: number;
  n?: string;
  b?: 1;
  sw?: number;
  j?: number[];
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

for (const [id, n] of nodes) {
  if (!n.tags) continue;
  const p = project(n.lat, n.lon);
  if (!inB(p)) continue;
  const t = n.tags;
  if (t.natural === 'tree' && t.leaf_type === 'needleleaved') pines.push(q(p[0]), q(p[1]));
  else if (t.natural === 'tree') trees.push(q(p[0]), q(p[1]));
  else if (t.highway === 'street_lamp') lamps.push(q(p[0]), q(p[1]));
  else if (t.amenity === 'bench' && !t.historic) benches.push(q(p[0]), q(p[1]));
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
  let n = (t.short_name ?? t.name ?? fallback).trim();
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
  for (let i = 0; i < ring.length; i++) {
    if (hid.has(i)) continue;
    const a = ring[i],
      c = ring[(i + 1) % ring.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 2.5) continue;
    // Outward normal: right of the edge for CCW rings (X right, Z up), left otherwise.
    const dx = (c[0] - a[0]) / len,
      dz = (c[1] - a[1]) / len;
    const n: Pt = ccw ? [dz, -dx] : [-dz, dx];
    const w: Wall = { a, b: c, n, len, key: `${bi}:${i}` };
    const k = `${Math.floor((a[0] + c[0]) / 2 / WG)},${Math.floor((a[1] + c[1]) / 2 / WG)}`;
    (wallGrid.get(k) ?? wallGrid.set(k, []).get(k)!).push(w);
  }
});
const roadSegGrid = new Map<string, { a: Pt; b: Pt; w: number }[]>();
for (const r of roads) {
  if (!VEHICLE.has(r.k) && r.k !== 'pedestrian' && r.k !== 'footway') continue;
  for (let i = 2; i < r.p.length; i += 2) {
    const a: Pt = [r.p[i - 2], r.p[i - 1]],
      b: Pt = [r.p[i], r.p[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / WG));
    const keys = new Set<string>();
    for (let s = 0; s <= n; s++)
      keys.add(`${Math.floor((a[0] + ((b[0] - a[0]) * s) / n) / WG)},${Math.floor((a[1] + ((b[1] - a[1]) * s) / n) / WG)}`);
    for (const k of keys) (roadSegGrid.get(k) ?? roadSegGrid.set(k, []).get(k)!).push({ a, b, w: r.w });
  }
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

interface ShopOut {
  x: number;
  z: number;
  a: number;
  w: number;
  c: string;
  n: string;
}
const shops: ShopOut[] = [];
const usedOnWall = new Map<string, [number, number][]>();
function placeShop(p: Pt, t: Tags): void {
  const cat = shopCategory(t);
  if (!cat || !inB(p)) return;
  const label = shortName(t, cat.label);
  let best: { w: Wall; s: number; t: number } | null = null;
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
        const open = gap < 10 || (plazaRing && pointInRing(m, plazaRing));
        const score = d + (open ? 0 : 30) + (w.len < 4 ? 6 : 0) + Math.max(0, gap) * 0.3;
        if (!best || score < best.s) best = { w, s: score, t: tt };
      }
    }
  if (!best || best.s > 45) return;
  const { w } = best;
  const width = Math.min(w.len - 0.8, Math.max(3.2, Math.min(7, 1.6 + label.length * 0.32)));
  if (width < 2) return;
  // Keep the front inside the wall and clear of fronts already on it.
  const half = width / 2 / w.len;
  const used = usedOnWall.get(w.key) ?? [];
  const free = (c: number) => used.every(([u0, u1]) => c + half < u0 || c - half > u1);
  const lo = 0.4 / w.len + half,
    hi = 1 - 0.4 / w.len - half;
  let tc = Math.max(lo, Math.min(hi, best.t));
  if (!free(tc)) {
    const options = [];
    for (let k = 0; k <= 20; k++) options.push(lo + ((hi - lo) * k) / 20);
    const ok = options.filter(free).sort((x, y) => Math.abs(x - best!.t) - Math.abs(y - best!.t));
    if (!ok.length) return;
    tc = ok[0];
  }
  used.push([tc - half, tc + half]);
  usedOnWall.set(w.key, used);
  shops.push({
    x: q(w.a[0] + (w.b[0] - w.a[0]) * tc),
    z: q(w.a[1] + (w.b[1] - w.a[1]) * tc),
    a: Math.round(Math.atan2(w.n[0], w.n[1]) * 1000) / 1000,
    w: q(width),
    c: cat.c,
    n: label,
  });
}
for (const n of nodes.values()) if (n.tags) placeShop(project(n.lat, n.lon), n.tags);
for (const p of polygons) {
  if (p.tags.amenity === 'place_of_worship' || p.tags.amenity === 'townhall' || p.tags.amenity === 'school') continue;
  if (shopCategory(p.tags) && Math.abs(signedArea(p.outer)) < 6000) placeShop(centroid(p.outer), p.tags);
}

// Picnic tables: mapped ones plus a few around each picnic site (the riverside "mesas" in El Soto).
const tables: number[] = [];
const isClear = (p: Pt) =>
  streetGap(p) > 2.5 &&
  !rivers.some((r) => {
    for (let i = 2; i < r.p.length; i += 2) if (segDist(p, [r.p[i - 2], r.p[i - 1]], [r.p[i], r.p[i + 1]]) < r.w / 2 + 4) return true;
    return false;
  }) &&
  !buildingCentroids.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < 8);
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const n of nodes.values()) {
  const t = n.tags;
  if (!t) continue;
  const p = project(n.lat, n.lon);
  if (!inB(p)) continue;
  if (t.leisure === 'picnic_table') tables.push(q(p[0]), q(p[1]), Math.round(rnd() * 314) / 100, t.material === 'stone' ? 1 : 0);
  if (t.tourism === 'picnic_site') {
    for (let k = 0, placed = 0; k < 60 && placed < 7; k++) {
      const a = rnd() * Math.PI * 2,
        r = 4 + rnd() * 22;
      const c: Pt = [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r];
      if (!isClear(c) || tables.some((_, i) => i % 4 === 0 && Math.hypot(tables[i] - c[0], tables[i + 1] - c[1]) < 5)) continue;
      tables.push(q(c[0]), q(c[1]), Math.round(rnd() * 314) / 100, 0);
      placed++;
    }
  }
}
for (const p of polygons) {
  if (p.tags.tourism !== 'picnic_site') continue;
  const xs = p.outer.map((v) => v[0]),
    zs = p.outer.map((v) => v[1]);
  const area = Math.abs(signedArea(p.outer));
  const want = Math.max(2, Math.min(10, Math.round(area / 500)));
  for (let k = 0, placed = 0; k < 200 && placed < want; k++) {
    const c: Pt = [
      Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)),
      Math.min(...zs) + rnd() * (Math.max(...zs) - Math.min(...zs)),
    ];
    if (!pointInRing(c, p.outer) || !isClear(c)) continue;
    if (tables.some((_, i) => i % 4 === 0 && Math.hypot(tables[i] - c[0], tables[i + 1] - c[1]) < 6)) continue;
    tables.push(q(c[0]), q(c[1]), Math.round(rnd() * 314) / 100, 0);
    placed++;
  }
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

const out = {
  meta: {
    source: 'OpenStreetMap contributors (ODbL 1.0)',
    file: IN,
    origin: { lat: +lat0.toFixed(8), lon: +lon0.toFixed(8), note: 'Centroid of the Plaza Mayor (place=square)' },
    projection: 'equirectangular; x east, z south, metres',
    bounds: B,
  },
  buildings,
  areas,
  roads,
  rails,
  rivers,
  streams,
  weirs,
  trees,
  pines,
  lamps,
  benches,
  crossings,
  pois,
  shops,
  tables,
  playgrounds,
};
mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify(out);
writeFileSync(OUT, json);
console.log(`origin ${lat0.toFixed(6)}, ${lon0.toFixed(6)}  bounds ${JSON.stringify(B)}`);
console.log(
  `buildings ${buildings.length} (parts ${partsTmp.length}, outlines with parts ${outlines.filter((o) => o.b.hp).length})  areas ${areas.length}  roads ${roads.length}  rails ${rails.length}  rivers ${rivers.length}  streams ${streams.length}  weirs ${weirs.length}`,
);
console.log(
  `trees ${trees.length / 2}  lamps ${lamps.length / 2}  benches ${benches.length / 2}  crossings ${crossings.length / 3}  pois ${pois.length}`,
);
console.log(`shops ${shops.length}  picnic tables ${tables.length / 4}  playgrounds ${playgrounds.length / 2}`);
console.log(`→ ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
