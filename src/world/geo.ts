import * as THREE from 'three';
import type { Coords } from './mapData';

export type Pt = [number, number];

export function toPts(c: Coords): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < c.length; i += 2) out.push([c[i], c[i + 1]]);
  return out;
}

/** Shoelace area; positive when counter-clockwise with X right and Z up. */
export function signedArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

export function centroid(r: Pt[]): Pt {
  let x = 0,
    z = 0;
  for (const p of r) {
    x += p[0];
    z += p[1];
  }
  return [x / r.length, z / r.length];
}

export function pointInRing(x: number, z: number, r: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i],
      [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax,
    dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

export function ringDist(x: number, z: number, r: Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) best = Math.min(best, segDist(x, z, r[j][0], r[j][1], r[i][0], r[i][1]));
  return best;
}

export interface Bounds2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function ringBounds(r: Pt[]): Bounds2 {
  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const [x, z] of r) {
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

/** Minimum-area oriented rectangle of a ring (rotating edges). */
export function orientedBox(r: Pt[]): { cx: number; cz: number; w: number; d: number; angle: number } {
  let best = { area: Infinity, cx: 0, cz: 0, w: 0, d: 0, angle: 0 };
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i];
    const [bx, bz] = r[(i + 1) % r.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len,
      uz = (bz - az) / len;
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (const [x, z] of r) {
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const cu = (minU + maxU) / 2,
        cv = (minV + maxV) / 2;
      best = {
        area,
        w: maxU - minU,
        d: maxV - minV,
        cx: cu * ux - cv * uz,
        cz: cu * uz + cv * ux,
        // rotation.y that maps local +X onto the edge direction (ux, uz)
        angle: Math.atan2(-uz, ux),
      };
    }
  }
  return best;
}

/** Earcut triangulation of a ring with holes; returns triangles as point triples. */
export function triangulate(outer: Pt[], holes: Pt[][] = []): Pt[][] {
  const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
  const hs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  const faces = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = [...outer, ...holes.flat()];
  return faces.map((f) => [all[f[0]], all[f[1]], all[f[2]]]);
}

/**
 * Uniform grid over arbitrary items keyed by their bounding box, for fast
 * "what is near (x, z)" queries.
 */
export class SpatialGrid<T> {
  private readonly cells = new Map<number, T[]>();
  private stamp = 0;
  private readonly stamps = new Map<T, number>();

  constructor(private readonly cell: number) {}

  insert(item: T, b: Bounds2): void {
    const c = this.cell;
    for (let ix = Math.floor(b.minX / c); ix <= Math.floor(b.maxX / c); ix++) {
      for (let iz = Math.floor(b.minZ / c); iz <= Math.floor(b.maxZ / c); iz++) {
        const k = key(ix, iz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
    }
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: T[] = []): T[] {
    out.length = 0;
    const s = ++this.stamp;
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const list = this.cells.get(key(ix, iz));
        if (!list) continue;
        for (const it of list) {
          if (this.stamps.get(it) === s) continue;
          this.stamps.set(it, s);
          out.push(it);
        }
      }
    }
    return out;
  }
}

function key(ix: number, iz: number): number {
  return (ix + 5000) * 10000 + (iz + 5000);
}

/** A polyline segment with a half-width, stored in a SpatialGrid. */
export interface Segment<T> {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  hw: number;
  owner: T;
}

export function segmentsOf<T>(pts: Pt[], hw: number, owner: T): Segment<T>[] {
  const out: Segment<T>[] = [];
  for (let i = 1; i < pts.length; i++) out.push({ ax: pts[i - 1][0], az: pts[i - 1][1], bx: pts[i][0], bz: pts[i][1], hw, owner });
  return out;
}

export function segBounds(s: Segment<unknown>, pad: number): Bounds2 {
  return {
    minX: Math.min(s.ax, s.bx) - s.hw - pad,
    maxX: Math.max(s.ax, s.bx) + s.hw + pad,
    minZ: Math.min(s.az, s.bz) - s.hw - pad,
    maxZ: Math.max(s.az, s.bz) + s.hw + pad,
  };
}

/** Cheap deterministic hash in [0, 1) for per-feature variation. */
export function hash01(a: number, b = 0): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Splits 2D triangles until no edge is longer than `maxEdge`, so they can follow the terrain. */
export function subdivideTris(tris: Pt[][], maxEdge: number): Pt[][] {
  const out: Pt[][] = [];
  const stack = [...tris];
  while (stack.length) {
    const t = stack.pop()!;
    const [a, b, c] = t;
    const lab = Math.hypot(b[0] - a[0], b[1] - a[1]),
      lbc = Math.hypot(c[0] - b[0], c[1] - b[1]),
      lca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const longest = Math.max(lab, lbc, lca);
    if (longest <= maxEdge || stack.length + out.length > 2_000_000) {
      out.push(t);
      continue;
    }
    // Split the longest edge at its midpoint.
    const mid = (p: Pt, q: Pt): Pt => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (longest === lab) {
      const m = mid(a, b);
      stack.push([a, m, c], [m, b, c]);
    } else if (longest === lbc) {
      const m = mid(b, c);
      stack.push([a, b, m], [a, m, c]);
    } else {
      const m = mid(c, a);
      stack.push([a, b, m], [m, b, c]);
    }
  }
  return out;
}
