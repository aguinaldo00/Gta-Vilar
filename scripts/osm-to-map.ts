/**
 * OSM → game map converter.
 *
 *   node scripts/osm-to-map.ts [input.osm] [output.json]
 *
 * Reads an OpenStreetMap XML export (data/villarcayo.osm by default) and
 * writes the simplified, projected map the game loads
 * (src/world/data/villarcayo.json). The browser never parses OSM.
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
const OUT = process.argv[3] ?? 'src/world/data/villarcayo.json';
const EARTH_R = 6371008.8;

// ---------------------------------------------------------------- parsing

interface OsmNode { lat: number; lon: number; tags: Tags | null }
interface OsmWay { nds: string[]; tags: Tags }
interface OsmRel { members: { type: string; ref: string; role: string }[]; tags: Tags }

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
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
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
  const ring = plazaWay.nds.slice(0, -1).map((id) => nodes.get(id)!).filter(Boolean);
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
  let x = 0, z = 0;
  for (const p of r) {
    x += p[0];
    z += p[1];
  }
  return [x / r.length, z / r.length];
}

function pointInRing(p: Pt, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
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
    let best = -1, bestD = tol;
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
  const edges: ((p: Pt) => number)[] = [
    (p) => p[0] - B.minX, (p) => B.maxX - p[0], (p) => p[1] - B.minZ, (p) => B.maxZ - p[1],
  ];
  let out = r;
  for (const f of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const fc = f(cur), fp = f(prev);
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
        let a = prev, b = p;
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

interface Poly { id: string; tags: Tags; outer: Ring; holes: Ring[] }

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
    const holes = assembleRings(innerIds).map((h) => cleanRing(h, 0.25)).filter((h): h is Ring => !!h);
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

interface BuildingOut { o: number[]; h?: number[][]; lv?: number; ht?: number; t: string; n?: string; mat?: string }
const buildings: BuildingOut[] = [];
const buildingCentroids: Pt[] = [];

const townhallPt = townhall ? project(townhall.lat, townhall.lon) : null;

function buildingType(t: Tags): string {
  const b = t.building;
  if (t.name === 'Torre del Corregimiento') return 'torre';
  if (t['historic'] === 'railway_station' || t['disused:railway'] === 'station') return 'station';
  if (b === 'church' || b === 'chapel' || b === 'cathedral') return 'church';
  if (['industrial', 'warehouse', 'factory', 'manufacture', 'barn', 'farm_auxiliary', 'hangar', 'storage_tank'].includes(b)) return 'industrial';
  if (['garage', 'garages', 'shed', 'roof', 'carport', 'hut', 'kiosk', 'cabin', 'toilets', 'service', 'transformer_tower'].includes(b)) return 'small';
  if (b === 'tower') return 'tower';
  if (['apartments', 'retail', 'commercial', 'office', 'public', 'government', 'civic', 'school', 'hospital', 'sports_hall', 'supermarket', 'hotel'].includes(b)) return 'block';
  return 'house';
}

for (const p of polygons) {
  const t = p.tags;
  if (!t.building || t.building === 'no' || t['building:part'] || t.leisure === 'bandstand') continue;
  if (p.id.startsWith('w') && relOuterWays.has(p.id) && rels.size) {
    // Prefer the relation version (with courtyards) when it exists and is itself a building.
    const owner = [...rels.entries()].find(([, r]) => r.tags.type === 'multipolygon' && r.members.some((m) => `w${m.ref}` === p.id && m.role !== 'inner'));
    if (owner && (owner[1].tags.building || Object.keys(owner[1].tags).length <= 1)) continue;
  }
  const area = Math.abs(signedArea(p.outer));
  if (area < 6) continue;
  let type = buildingType(t);
  if (townhallPt && pointInRing(townhallPt, p.outer)) type = 'townhall';
  const b: BuildingOut = { o: flat(p.outer), t: type };
  if (p.holes.length) b.h = p.holes.map(flat);
  const lv = parseFloat(t['building:levels']);
  if (Number.isFinite(lv) && lv > 0) b.lv = lv;
  const ht = parseFloat(t.height);
  if (Number.isFinite(ht) && ht > 0) b.ht = ht;
  if (t.name) b.n = t.name;
  if (t['building:material']) b.mat = t['building:material'];
  buildings.push(b);
  buildingCentroids.push(centroid(p.outer));
}

// ---------------------------------------------------------------- areas

const AREA_KIND: [string, string, string][] = [
  ['natural', 'water', 'water'], ['leisure', 'swimming_area', 'water'], ['leisure', 'swimming_pool', 'pool'],
  ['amenity', 'parking', 'parking'], ['highway', 'pedestrian', 'pedestrian'], ['place', 'square', 'pedestrian'],
  ['leisure', 'pitch', 'pitch'], ['leisure', 'playground', 'playground'], ['leisure', 'track', 'track'],
  ['leisure', 'park', 'park'], ['leisure', 'garden', 'garden'], ['leisure', 'sports_centre', 'sports'],
  ['tourism', 'camp_site', 'camp'], ['amenity', 'marketplace', 'pedestrian'], ['amenity', 'school', 'school'],
  ['landuse', 'cemetery', 'cemetery'], ['landuse', 'village_green', 'park'], ['landuse', 'recreation_ground', 'park'],
  ['landuse', 'grass', 'grass'], ['landuse', 'meadow', 'meadow'], ['natural', 'grassland', 'meadow'],
  ['landuse', 'farmland', 'farmland'], ['landuse', 'farmyard', 'farmyard'], ['landuse', 'orchard', 'orchard'],
  ['landuse', 'allotments', 'allotments'], ['landuse', 'forest', 'forest'], ['natural', 'wood', 'forest'],
  ['landuse', 'logging', 'forest'], ['natural', 'scrub', 'scrub'], ['natural', 'beach', 'beach'],
  ['landuse', 'residential', 'residential'], ['landuse', 'industrial', 'industrial'], ['landuse', 'commercial', 'industrial'],
  ['landuse', 'retail', 'industrial'], ['landuse', 'brownfield', 'brownfield'], ['landuse', 'construction', 'brownfield'],
  ['landuse', 'greenfield', 'meadow'], ['landuse', 'education', 'school'], ['leisure', 'festival_grounds', 'park'],
];

interface AreaOut { k: string; o: number[]; h?: number[][]; n?: string }
const areas: AreaOut[] = [];
for (const p of polygons) {
  const t = p.tags;
  if (t.building) continue;
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
  areas.push(a);
}

// ---------------------------------------------------------------- roads

const ROAD_WIDTH: Record<string, number> = {
  motorway: 10, trunk: 9, primary: 7.5, secondary: 7, tertiary: 6.5, unclassified: 5, residential: 5.5,
  living_street: 4.5, service: 3.5, track: 3, pedestrian: 4, footway: 2, path: 1.5, cycleway: 2.5, bridleway: 2, steps: 2,
};
const VEHICLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
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
  const cx = Math.floor(p[0] / 50), cz = Math.floor(p[1] / 50);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    for (const c of bGrid.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(c[0] - p[0], c[1] - p[1]) < r) n++;
  }
  return n;
}

interface RoadOut { p: number[]; k: string; w: number; n?: string; b?: 1; sw?: number; j?: number[] }
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
  if (hw === 'pedestrian' && w.nds[0] === w.nds[w.nds.length - 1] && polygons.some((p) => p.id === `w${id}` && p.tags.area === 'yes')) continue;
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
    if (t.waterway === 'river') rivers.push({ p: flat(simplify(part, 0.5)), w: parseFloat(t.width) || 16, ...(t.name ? { n: t.name } : {}) });
    else if (['stream', 'canal', 'ditch', 'drain'].includes(t.waterway)) streams.push({ p: flat(simplify(part, 0.5)), w: t.waterway === 'canal' ? 4 : 2 });
  }
}

// ---------------------------------------------------------------- points

const trees: number[] = [];
const lamps: number[] = [];
const benches: number[] = [];
const crossings: number[] = [];
const pois: { k: string; n?: string; x: number; z: number; o?: number[]; ht?: number; a?: number }[] = [];

function roadAngleAt(nid: string): number | null {
  for (const w of ways.values()) {
    if (!w.tags.highway || !VEHICLE.has(w.tags.highway)) continue;
    const i = w.nds.indexOf(nid);
    if (i < 0) continue;
    const a = nodePt(w.nds[Math.max(0, i - 1)]), b = nodePt(w.nds[Math.min(w.nds.length - 1, i + 1)]);
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
  if (t.natural === 'tree') trees.push(q(p[0]), q(p[1]));
  else if (t.highway === 'street_lamp') lamps.push(q(p[0]), q(p[1]));
  else if (t.amenity === 'bench' && !t.historic) benches.push(q(p[0]), q(p[1]));
  else if (t.highway === 'crossing' && t.crossing !== 'no') {
    const a = roadAngleAt(id);
    if (a !== null) crossings.push(q(p[0]), q(p[1]), Math.round(a * 1000) / 1000);
  }
  if (t.amenity === 'townhall') pois.push({ k: 'townhall', n: t.name, x: q(p[0]), z: q(p[1]) });
  if (t.historic === 'locomotive') pois.push({ k: 'locomotive', n: t.name, x: q(p[0]), z: q(p[1]) });
  if (t.man_made === 'tower' && t['tower:type'] === 'bell_tower') pois.push({ k: 'belltower', x: q(p[0]), z: q(p[1]), ht: parseFloat(t.height) || 0 });
  if (t.historic === 'memorial' && t.memorial === 'bench') pois.push({ k: 'statue', n: t.name, x: q(p[0]), z: q(p[1]) });
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

// ---------------------------------------------------------------- output

const out = {
  meta: {
    source: 'OpenStreetMap contributors (ODbL 1.0)',
    file: IN,
    origin: { lat: +lat0.toFixed(8), lon: +lon0.toFixed(8), note: 'Centroid of the Plaza Mayor (place=square)' },
    projection: 'equirectangular; x east, z south, metres',
    bounds: B,
  },
  buildings, areas, roads, rails, rivers, streams, weirs,
  trees, lamps, benches, crossings, pois,
};
mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify(out);
writeFileSync(OUT, json);
console.log(`origin ${lat0.toFixed(6)}, ${lon0.toFixed(6)}  bounds ${JSON.stringify(B)}`);
console.log(`buildings ${buildings.length}  areas ${areas.length}  roads ${roads.length}  rails ${rails.length}  rivers ${rivers.length}  streams ${streams.length}  weirs ${weirs.length}`);
console.log(`trees ${trees.length / 2}  lamps ${lamps.length / 2}  benches ${benches.length / 2}  crossings ${crossings.length / 3}  pois ${pois.length}`);
console.log(`→ ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
