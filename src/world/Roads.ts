import * as THREE from 'three';
import { Layer } from '../physics/CollisionWorld';
import { CHUNK } from './Batcher';
import type { BuildContext } from './context';
import { type Pt, type Segment, SpatialGrid, segBounds, segDist, segmentsOf, toPts, triangulate } from './geo';
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
class FlatMesh {
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
    const ya = height(ax, az),
      yb = height(bx, bz);
    m.tri(ax + nx, ya, az + nz, bx + nx, yb, bz + nz, bx - nx, yb, bz - nz);
    m.tri(ax + nx, ya, az + nz, bx - nx, yb, bz - nz, ax - nx, ya, az - nz);
  }
  const fan = (x: number, z: number) => {
    const y = height(x, z);
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2,
        a1 = ((k + 1) / n) * Math.PI * 2;
      m.tri(x, y, z, x + Math.sin(a0) * hw, y, z + Math.cos(a0) * hw, x + Math.sin(a1) * hw, y, z + Math.cos(a1) * hw);
    }
  };
  for (let i = 1; i < pts.length - 1; i++) fan(pts[i][0], pts[i][1]);
  if (hw > 1.5) {
    fan(pts[0][0], pts[0][1]);
    fan(pts[pts.length - 1][0], pts[pts.length - 1][1]);
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
  // Atlas slots: 0 asphalt, 1 sidewalk, 2 paving, 3 dirt, 4 gravel, 5 white paint.
  const asphalt = new FlatMesh(8, 0);
  const sidewalk = new FlatMesh(2, 1);
  const paving = new FlatMesh(3, 2);
  const dirt = new FlatMesh(4, 3);
  const gravel = new FlatMesh(4, 4);
  const marks = new FlatMesh(1, 5);

  const ground = (y: number) => (x: number, z: number) => Math.max(terrain.base(x, z), 0) + y;
  const roads = [...ctx.map.roads].sort((a, b) => (RANK[a.k] ?? 0) - (RANK[b.k] ?? 0));
  for (const r of roads) {
    const pts = toPts(r.p);
    const bridge = !!r.b;
    const h = (y: number) => (bridge ? () => 0.35 + y : ground(y));
    const rank = RANK[r.k] ?? 0;
    // Layer heights keep junction overlaps free of z-fighting: paths < sidewalks < paving < asphalt < paint.
    if (r.sw && !bridge) ribbon(sidewalk, pts, r.w / 2 + SIDEWALK_W, ground(0.03));
    if (ASPHALT.has(r.k)) ribbon(asphalt, pts, r.w / 2, h(0.05 + rank * 0.004));
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
          const y = 0.09 + rank * 0.004;
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
    for (const [p, q, s] of triangulate(toPts(a.o), (a.h ?? []).map(toPts))) {
      paving.tri(p[0], 0.042, p[1], q[0], 0.042, q[1], s[0], 0.042, s[1]);
    }
  }

  // Zebra crossings at the OSM crossing nodes.
  const net = ctx.roads;
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
    const y = 0.09 + (hit ? (RANK[hit.road.k] ?? 0) * 0.004 : 0);
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

  addChunked(ctx, [sidewalk, asphalt, paving, dirt, gravel, marks], mats.roadAtlas);
}

/** Deck slab and parapets for bridges that actually cross the river or the pools. */
function buildBridge(ctx: BuildContext, r: MapRoad, pts: Pt[]): void {
  const { batch, mats, terrain, collision } = ctx;
  const overWater =
    pts.some(([x, z]) => terrain.base(x, z) < -0.2) ||
    pts.slice(1).some((p, i) => terrain.base((p[0] + pts[i][0]) / 2, (p[1] + pts[i][1]) / 2) < -0.2);
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
    batch.add(new THREE.BoxGeometry(r.w + 0.6, 0.6, len), wood ? mats.wood : mats.stone, mx, 0.05, mz, rot);
    const ux = (bx - ax) / len,
      uz = (bz - az) / len;
    for (const side of [-1, 1]) {
      const ox = uz * side * (r.w / 2 + 0.1),
        oz = -ux * side * (r.w / 2 + 0.1);
      const ph = wood ? 1.0 : 0.85;
      batch.add(new THREE.BoxGeometry(wood ? 0.1 : 0.4, ph, len), wood ? mats.wood : mats.stone, mx + ox, 0.35 + ph / 2, mz + oz, rot);
      // Box collider rotation: local X axis must follow the parapet direction (along the segment's Z).
      collision.addBox(mx + ox, mz + oz, wood ? 0.2 : 0.4, len, { rot, top: 0.35 + ph, mask: wood ? Layer.Bodies : Layer.Solid });
    }
  }
  if (wood) {
    // Bollards at both ends keep cars off footbridges.
    for (const [x, z] of [pts[0], pts[pts.length - 1]]) collision.addCircle(x, z, r.w / 2 + 0.2, { top: 1, mask: Layer.Vehicle });
  }
}
