import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import { CHUNK } from './Batcher';
import type { BuildContext } from './context';
import { type Pt, type Segment, SpatialGrid, segBounds, segDist, segmentsOf, subdivideTris, toPts, triangulate } from './geo';
import type { MapData, MapRoad } from './mapData';

export const VEHICLE_ROADS = new Set([
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
const ASPHALT = new Set([...VEHICLE_ROADS, 'cycleway']);
const PAVED = new Set(['pedestrian', 'footway', 'steps']);
const RANK: Record<string, number> = {
  primary: 6,
  secondary: 5,
  tertiary: 4,
  residential: 3,
  unclassified: 3,
  living_street: 2,
  service: 1,
};
const SIDEWALK_W = 2.2;

export interface RoadHit {
  road: MapRoad;
  d: number;
  /** Closest point and road direction. */
  x: number;
  z: number;
  dx: number;
  dz: number;
}

/** Spatial index over all road segments (nearest road, street names, spawn points). */
export class RoadNetwork {
  private readonly grid = new SpatialGrid<Segment<MapRoad>>(48);
  private readonly found: Segment<MapRoad>[] = [];

  constructor(map: MapData) {
    for (const r of map.roads) {
      for (const s of segmentsOf(toPts(r.p), r.w / 2, r)) this.grid.insert(s, segBounds(s, 2));
    }
  }

  nearest(x: number, z: number, radius: number, filter?: (r: MapRoad) => boolean): RoadHit | null {
    let best: RoadHit | null = null;
    for (const s of this.grid.query(x - radius, z - radius, x + radius, z + radius, this.found)) {
      if (filter && !filter(s.owner)) continue;
      const d = segDist(x, z, s.ax, s.az, s.bx, s.bz) - s.hw;
      if (d > radius || (best && d >= best.d)) continue;
      const dx = s.bx - s.ax,
        dz = s.bz - s.az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
      const len = Math.sqrt(l2);
      best = { road: s.owner, d, x: s.ax + dx * t, z: s.az + dz * t, dx: dx / len, dz: dz / len };
    }
    return best;
  }
}

/** Accumulates flat triangles with world-aligned UVs, forcing every face to point up. */
export class FlatMesh {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly cells: number[] = [];
  /** `cell` is the slot of this surface in the road texture atlas (see Materials.roadAtlas). */
  constructor(
    private readonly tile: number,
    private readonly cell = 0,
  ) {}

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    // Upward normal requires (b - a) × (c - a) to have positive Y.
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny < 0) [bx, by, bz, cx, cy, cz] = [cx, cy, cz, bx, by, bz];
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    const t = this.tile;
    this.uv.push(ax / t, -az / t, bx / t, -bz / t, cx / t, -cz / t);
    this.cells.push(this.cell, this.cell, this.cell);
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(
        new Float32Array(this.pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)),
        3,
      ),
    );
    g.setAttribute('atlasCell', new THREE.Float32BufferAttribute(this.cells, 1));
    return g;
  }
}

/** Quads along a polyline plus round joints, so bends and junctions have no gaps. */
function ribbon(m: FlatMesh, pts: Pt[], hw: number, height: (x: number, z: number) => number): void {
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1],
      [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const nx = (-(bz - az) / len) * hw,
      nz = ((bx - ax) / len) * hw;
    // Short slices so the surface follows the relief (and bridge decks) instead of cutting through it.
    const n = Math.max(1, Math.ceil(len / 4));
    for (let k = 0; k < n; k++) {
      const x0 = ax + ((bx - ax) * k) / n,
        z0 = az + ((bz - az) * k) / n;
      const x1 = ax + ((bx - ax) * (k + 1)) / n,
        z1 = az + ((bz - az) * (k + 1)) / n;
      const y0l = height(x0 + nx, z0 + nz),
        y0r = height(x0 - nx, z0 - nz);
      const y1l = height(x1 + nx, z1 + nz),
        y1r = height(x1 - nx, z1 - nz);
      m.tri(x0 + nx, y0l, z0 + nz, x1 + nx, y1l, z1 + nz, x1 - nx, y1r, z1 - nz);
      m.tri(x0 + nx, y0l, z0 + nz, x1 - nx, y1r, z1 - nz, x0 - nx, y0r, z0 - nz);
    }
  }
  const fan = (x: number, z: number) => {
    const y = height(x, z);
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2,
        a1 = ((k + 1) / n) * Math.PI * 2;
      const px0 = x + Math.sin(a0) * hw,
        pz0 = z + Math.cos(a0) * hw;
      const px1 = x + Math.sin(a1) * hw,
        pz1 = z + Math.cos(a1) * hw;
      m.tri(x, y, z, px0, height(px0, pz0), pz0, px1, height(px1, pz1), pz1);
    }
  };
  for (let i = 1; i < pts.length - 1; i++) fan(pts[i][0], pts[i][1]);
  if (hw > 1.5) {
    fan(pts[0][0], pts[0][1]);
    fan(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  }
}

/** Kerb height: sidewalks stand this much above the carriageway. */
export const KERB = 0.13;

/**
 * Sidewalks as two strips beside the carriageway (never under it), raised by
 * a kerb with its face along the road edge. Pieces that would run into the
 * carriageway of another street (junctions) are left out, and the outer side
 * of bends is filled with a fan.
 */
export function sidewalks(
  m: FlatMesh,
  kerb: FlatMesh,
  pts: Pt[],
  hw: number,
  sw: number,
  road: (x: number, z: number) => number,
  onOtherCarriageway: (x: number, z: number) => boolean,
): void {
  const top = (x: number, z: number) => road(x, z) + KERB;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1],
      [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const ux = (bx - ax) / len,
      uz = (bz - az) / len;
    const n = Math.max(1, Math.ceil(len / 3));
    for (const side of [1, -1]) {
      const nx = -uz * side,
        nz = ux * side;
      const p = (t: number, o: number): [number, number] => [ax + ux * t + nx * o, az + uz * t + nz * o];
      /** Part of [t0, t1] along offset o that is off other streets' carriageways (one crossing per slice). */
      const free = (t0: number, t1: number, o: number): [number, number] | null => {
        const a = onOtherCarriageway(...p(t0, o)),
          b = onOtherCarriageway(...p(t1, o));
        if (a && b) return null;
        if (!a && !b) return [t0, t1];
        let lo = t0,
          hi = t1;
        for (let it = 0; it < 12; it++) {
          const mid = (lo + hi) / 2;
          if (onOtherCarriageway(...p(mid, o)) === a) lo = mid;
          else hi = mid;
        }
        return a ? [hi, t1] : [t0, lo];
      };
      const slice = (t0: number, t1: number, depth: number): void => {
        // A narrow street can fit inside one slice with both ends clear: split around it.
        const tm = (t0 + t1) / 2;
        const inside = (o: number) =>
          !onOtherCarriageway(...p(t0, o)) && !onOtherCarriageway(...p(t1, o)) && onOtherCarriageway(...p(tm, o));
        if (depth < 3 && (inside(hw) || inside(hw + sw))) {
          slice(t0, tm, depth + 1);
          slice(tm, t1, depth + 1);
          return;
        }
        // Clip the slice where it runs into another street: inner and outer edges separately,
        // so the cut follows that street's kerb line even when it crosses at an angle.
        const fi = free(t0, t1, hw),
          fo = free(t0, t1, hw + sw);
        if (!fi || !fo) return;
        const [x0i, z0i] = p(fi[0], hw),
          [x1i, z1i] = p(fi[1], hw),
          [x0o, z0o] = p(fo[0], hw + sw),
          [x1o, z1o] = p(fo[1], hw + sw);
        m.tri(x0i, top(x0i, z0i), z0i, x1i, top(x1i, z1i), z1i, x1o, top(x1o, z1o), z1o);
        m.tri(x0i, top(x0i, z0i), z0i, x1o, top(x1o, z1o), z1o, x0o, top(x0o, z0o), z0o);
        // Kerb face, wound to face the road on either side.
        const [ka, kb, kaz, kbz] = side === 1 ? [x1i, x0i, z1i, z0i] : [x0i, x1i, z0i, z1i];
        kerb.tri(ka, road(ka, kaz), kaz, kb, road(kb, kbz), kbz, kb, top(kb, kbz), kbz);
        kerb.tri(ka, road(ka, kaz), kaz, kb, top(kb, kbz), kbz, ka, top(ka, kaz), kaz);
      };
      for (let k = 0; k < n; k++) slice((len * k) / n, (len * (k + 1)) / n, 0);
    }
  }
  // Outer side of bends: an annular wedge closes the gap between the two strips.
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, pz] = pts[i - 1],
      [cx, cz] = pts[i],
      [qx, qz] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cz - pz),
      l2 = Math.hypot(qx - cx, qz - cz);
    if (l1 < 0.01 || l2 < 0.01) continue;
    const d1 = [(cx - px) / l1, (cz - pz) / l1],
      d2 = [(qx - cx) / l2, (qz - cz) / l2];
    for (const side of [1, -1]) {
      const n1 = [-d1[1] * side, d1[0] * side],
        n2 = [-d2[1] * side, d2[0] * side];
      if (n1[0] * d2[0] + n1[1] * d2[1] >= 0) continue; // inner side: the strips overlap there
      const a1 = Math.atan2(n1[1], n1[0]);
      let da = Math.atan2(n2[1], n2[0]) - a1;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const steps = Math.max(1, Math.ceil(Math.abs(da) / 0.3));
      for (let k = 0; k < steps; k++) {
        const b0 = a1 + (da * k) / steps,
          b1 = a1 + (da * (k + 1)) / steps;
        const q = (a: number, r: number): [number, number] => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
        const [ix0, iz0] = q(b0, hw),
          [ix1, iz1] = q(b1, hw),
          [ox0, oz0] = q(b0, hw + sw),
          [ox1, oz1] = q(b1, hw + sw);
        if (onOtherCarriageway((ix0 + ox1) / 2, (iz0 + oz1) / 2)) continue;
        m.tri(ix0, top(ix0, iz0), iz0, ix1, top(ix1, iz1), iz1, ox1, top(ox1, oz1), oz1);
        m.tri(ix0, top(ix0, iz0), iz0, ox1, top(ox1, oz1), oz1, ox0, top(ox0, oz0), oz0);
      }
    }
  }
}

/** Splits flat triangle soup (all surfaces together) into chunk-sized pieces for the batcher. */
function addChunked(ctx: BuildContext, surfaces: FlatMesh[], mat: THREE.Material): void {
  const buckets = new Map<string, FlatMesh>();
  for (const m of surfaces) {
    for (let i = 0; i < m.pos.length; i += 9) {
      const cx = Math.floor((m.pos[i] + m.pos[i + 3] + m.pos[i + 6]) / 3 / CHUNK);
      const cz = Math.floor((m.pos[i + 2] + m.pos[i + 5] + m.pos[i + 8]) / 3 / CHUNK);
      const k = `${cx},${cz}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = new FlatMesh(1)));
      for (let j = 0; j < 9; j++) b.pos.push(m.pos[i + j]);
      for (let j = 0; j < 6; j++) b.uv.push(m.uv[(i / 3) * 2 + j]);
      for (let j = 0; j < 3; j++) b.cells.push(m.cells[i / 3 + j]);
    }
  }
  for (const b of buckets.values()) {
    const g = b.geometry();
    if (g) ctx.batch.addWorld(g, mat);
  }
}

export function buildRoads(ctx: BuildContext): void {
  const { mats, terrain } = ctx;
  // Atlas slots: 0 asphalt, 1 sidewalk, 2 paving, 3 dirt, 4 gravel, 5 white paint, 6 red paving.
  const asphalt = new FlatMesh(8, 0);
  const sidewalk = new FlatMesh(2, 1);
  const paving = new FlatMesh(3, 2);
  const dirt = new FlatMesh(4, 3);
  const gravel = new FlatMesh(4, 4);
  const marks = new FlatMesh(1, 5);
  const kerbs = new FlatMesh(1, 1);
  const redPaving = new FlatMesh(2, 6);
  const net = ctx.roads;
  // A point on the carriageway of any street (the sidewalk of one street must not cover another).
  const onCarriageway = (x: number, z: number) => {
    const hit = net.nearest(x, z, 0, (r) => VEHICLE_ROADS.has(r.k));
    return hit !== null && hit.d < -0.2;
  };

  // Every surface sits on the terrain (bridge decks included) plus its layer offset.
  const ground = (y: number) => (x: number, z: number) => terrain.heightAt(x, z) + y;
  const roads = [...ctx.map.roads].sort((a, b) => (RANK[a.k] ?? 0) - (RANK[b.k] ?? 0));
  for (const r of roads) {
    const pts = toPts(r.p);
    const bridge = !!r.b;
    const h = ground;
    const rank = RANK[r.k] ?? 0;
    // Layer heights keep junction overlaps free of z-fighting: paths < sidewalks < paving < asphalt < paint.
    const roadY = 0.05 + rank * 0.004;
    if (r.sw && !bridge) sidewalks(sidewalk, kerbs, pts, r.w / 2, SIDEWALK_W, ground(roadY), onCarriageway);
    if (ASPHALT.has(r.k)) ribbon(asphalt, pts, r.w / 2, h(roadY));
    else if (PAVED.has(r.k)) ribbon(paving, pts, r.w / 2, h(0.04));
    else if (r.k === 'viaverde') ribbon(gravel, pts, r.w / 2, h(0.025));
    else ribbon(dirt, pts, r.w / 2, h(0.02));

    // Centre-line dashes on main roads, skipping junctions.
    if (rank >= 4 && r.w >= 6 && !bridge) {
      const junctions = (r.j ?? []).map((i) => pts[i]);
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1],
          [bx, bz] = pts[i];
        const len = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / len,
          uz = (bz - az) / len;
        for (let s = 2; s + 3 < len; s += 7) {
          const x = ax + ux * (s + 1.5),
            z = az + uz * (s + 1.5);
          if (junctions.some(([jx, jz]) => Math.hypot(jx - x, jz - z) < r.w + 4)) continue;
          const y = terrain.heightAt(ax + ux * (s + 1.5), az + uz * (s + 1.5)) + 0.09 + rank * 0.004;
          const px = -uz * 0.08,
            pz = ux * 0.08;
          const x0 = ax + ux * s,
            z0 = az + uz * s,
            x1 = x0 + ux * 3,
            z1 = z0 + uz * 3;
          marks.tri(x0 + px, y, z0 + pz, x1 + px, y, z1 + pz, x1 - px, y, z1 - pz);
          marks.tri(x0 + px, y, z0 + pz, x1 - px, y, z1 - pz, x0 - px, y, z0 - pz);
        }
      }
    }

    if (bridge) buildBridge(ctx, r, pts);
  }

  // Pedestrian areas (Plaza Mayor, Plaza de España...) as paving.
  for (const a of ctx.map.areas) {
    if (a.k !== 'pedestrian') continue;
    const y = ground(0.042);
    for (const [p, q, s] of subdivideTris(triangulate(toPts(a.o), (a.h ?? []).map(toPts)), 4)) {
      paving.tri(p[0], y(p[0], p[1]), p[1], q[0], y(q[0], q[1]), q[1], s[0], y(s[0], s[1]), s[1]);
    }
  }

  // Red paving (car parks and squares checked on photos), just over the grey paving.
  for (const a of ctx.map.areas) {
    if (a.pv !== 'red') continue;
    const y = ground(0.046);
    for (const [p, q, s] of subdivideTris(triangulate(toPts(a.o), (a.h ?? []).map(toPts)), 4)) {
      redPaving.tri(p[0], y(p[0], p[1]), p[1], q[0], y(q[0], q[1]), q[1], s[0], y(s[0], s[1]), s[1]);
    }
  }

  // Zebra crossings at the OSM crossing nodes.
  for (let i = 0; i < ctx.map.crossings.length; i += 3) {
    const x = ctx.map.crossings[i],
      z = ctx.map.crossings[i + 1],
      a = ctx.map.crossings[i + 2];
    const hit = net.nearest(x, z, 3, (r) => VEHICLE_ROADS.has(r.k));
    const w = hit ? hit.road.w : 5;
    const ux = Math.sin(a),
      uz = Math.cos(a); // along the road
    const px = uz,
      pz = -ux; // across the road
    const y = terrain.heightAt(x, z) + 0.09 + (hit ? (RANK[hit.road.k] ?? 0) * 0.004 : 0);
    for (let s = -w / 2 + 0.5; s <= w / 2 - 0.4; s += 1.0) {
      const cx = x + px * s,
        cz = z + pz * s;
      const hx = px * 0.25,
        hz = pz * 0.25,
        lx = ux * 1.5,
        lz = uz * 1.5;
      marks.tri(cx - hx - lx, y, cz - hz - lz, cx + hx - lx, y, cz + hz - lz, cx + hx + lx, y, cz + hz + lz);
      marks.tri(cx - hx - lx, y, cz - hz - lz, cx + hx + lx, y, cz + hz + lz, cx - hx + lx, y, cz - hz + lz);
    }
  }

  addChunked(ctx, [sidewalk, kerbs, asphalt, paving, redPaving, dirt, gravel, marks], mats.roadAtlas);
}

/** Deck slab and parapets for bridges that actually cross the river or the pools. */
function buildBridge(ctx: BuildContext, r: MapRoad, pts: Pt[]): void {
  const { batch, mats, terrain, collision } = ctx;
  const overWater =
    pts.some(([x, z]) => terrain.waterAt(x, z) !== null) ||
    pts.slice(1).some((p, i) => terrain.waterAt((p[0] + pts[i][0]) / 2, (p[1] + pts[i][1]) / 2) !== null);
  if (!overWater) return;
  const vehicle = VEHICLE_ROADS.has(r.k) || r.k === 'track';
  const wood = !vehicle;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1],
      [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) continue;
    const mx = (ax + bx) / 2,
      mz = (az + bz) / 2;
    const rot = Math.atan2(bx - ax, bz - az);
    const deck = terrain.deck(mx, mz) > -Infinity ? terrain.deck(mx, mz) : terrain.heightAt(mx, mz);
    batch.add(new THREE.BoxGeometry(r.w + 0.6, 0.6, len), wood ? mats.wood : mats.stone, mx, deck - 0.3, mz, rot);
    const ux = (bx - ax) / len,
      uz = (bz - az) / len;
    for (const side of [-1, 1]) {
      const ox = uz * side * (r.w / 2 + 0.1),
        oz = -ux * side * (r.w / 2 + 0.1);
      const ph = wood ? 1.0 : 0.85;
      batch.add(new THREE.BoxGeometry(wood ? 0.1 : 0.4, ph, len), wood ? mats.wood : mats.stone, mx + ox, deck + ph / 2, mz + oz, rot);
      // Box collider rotation: local X axis must follow the parapet direction (along the segment's Z).
      collision.addBox(mx + ox, mz + oz, wood ? 0.2 : 0.4, len, {
        rot,
        bottom: deck - 1,
        top: deck + ph,
        mask: wood ? Layer.Bodies : Layer.Solid,
        absolute: true,
      });
    }
  }
  if (wood) {
    // Bollards at both ends keep cars off footbridges.
    for (const [x, z] of [pts[0], pts[pts.length - 1]]) {
      const y = terrain.heightAt(x, z);
      collision.addCircle(x, z, r.w / 2 + 0.2, { bottom: y - 1, top: y + 1, mask: Layer.Vehicle, absolute: true });
    }
  }
}
