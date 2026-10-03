import { clamp } from '../core/math';

import { type ColliderOptions, Layer, type StaticColliders } from './PhysicsWorld';

export type { ColliderOptions };
export { Layer };

/**
 * A static obstacle on the XZ plane with a vertical extent [bottom, top].
 * Boxes may be rotated around Y; circles are stored with hx = hz = r.
 */
export interface Collider {
  x: number;
  z: number;
  hx: number;
  hz: number;
  r: number;
  cos: number;
  sin: number;
  circle: boolean;
  bottom: number;
  top: number;
  mask: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  stamp: number;
}

export interface Contact {
  nx: number;
  nz: number;
  depth: number;
}

const CELL = 16;

/**
 * Legacy 2.5D collision world, kept only for the arcade vehicles until they
 * move to Rapier (the player, camera and queries already use PhysicsWorld).
 * Static colliders live in a uniform spatial hash and
 * dynamic bodies (player, vehicles) are approximated by circles that are
 * pushed out of overlapping colliders. Cheap, robust and good enough for an
 * arcade sandbox.
 */
export class CollisionWorld implements StaticColliders {
  readonly colliders: Collider[] = [];
  private readonly grid = new Map<number, Collider[]>();
  private stamp = 0;
  private readonly found: Collider[] = [];
  private readonly tmp: Contact = { nx: 0, nz: 0, depth: 0 };

  addBox(x: number, z: number, w: number, d: number, o: ColliderOptions): Collider {
    const rot = o.rot ?? 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const hx = w / 2;
    const hz = d / 2;
    const ex = Math.abs(cos) * hx + Math.abs(sin) * hz;
    const ez = Math.abs(sin) * hx + Math.abs(cos) * hz;
    return this.insert({
      x,
      z,
      hx,
      hz,
      r: 0,
      cos,
      sin,
      circle: false,
      bottom: o.bottom ?? -10,
      top: o.top,
      mask: o.mask ?? Layer.Solid,
      minX: x - ex,
      maxX: x + ex,
      minZ: z - ez,
      maxZ: z + ez,
      stamp: 0,
    });
  }

  addCircle(x: number, z: number, r: number, o: ColliderOptions): Collider {
    return this.insert({
      x,
      z,
      hx: r,
      hz: r,
      r,
      cos: 1,
      sin: 0,
      circle: true,
      bottom: o.bottom ?? -10,
      top: o.top,
      mask: o.mask ?? Layer.Bodies,
      minX: x - r,
      maxX: x + r,
      minZ: z - r,
      maxZ: z + r,
      stamp: 0,
    });
  }

  private insert(c: Collider): Collider {
    this.colliders.push(c);
    const ix0 = Math.floor(c.minX / CELL),
      ix1 = Math.floor(c.maxX / CELL);
    const iz0 = Math.floor(c.minZ / CELL),
      iz1 = Math.floor(c.maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = cellKey(ix, iz);
        let list = this.grid.get(key);
        if (!list) this.grid.set(key, (list = []));
        list.push(c);
      }
    }
    return c;
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Collider[]): Collider[] {
    out.length = 0;
    const s = ++this.stamp;
    const ix0 = Math.floor(minX / CELL),
      ix1 = Math.floor(maxX / CELL);
    const iz0 = Math.floor(minZ / CELL),
      iz1 = Math.floor(maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this.grid.get(cellKey(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c.stamp === s) continue;
          c.stamp = s;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /** Penetration of a circle into a collider; normal points out of the collider. */
  circleVs(c: Collider, x: number, z: number, r: number, out: Contact): boolean {
    const dx = x - c.x;
    const dz = z - c.z;
    if (c.circle) {
      const rr = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return false;
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        out.nx = 1;
        out.nz = 0;
        out.depth = rr;
      } else {
        out.nx = dx / d;
        out.nz = dz / d;
        out.depth = rr - d;
      }
      return true;
    }
    // World -> box local (box local X axis is (cos, -sin), Z axis is (sin, cos)).
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const cx = clamp(lx, -c.hx, c.hx);
    const cz = clamp(lz, -c.hz, c.hz);
    let nlx: number, nlz: number, depth: number;
    if (cx === lx && cz === lz) {
      const px = c.hx - Math.abs(lx);
      const pz = c.hz - Math.abs(lz);
      if (px < pz) {
        nlx = lx >= 0 ? 1 : -1;
        nlz = 0;
        depth = px + r;
      } else {
        nlx = 0;
        nlz = lz >= 0 ? 1 : -1;
        depth = pz + r;
      }
    } else {
      const ddx = lx - cx;
      const ddz = lz - cz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 >= r * r) return false;
      const d = Math.sqrt(d2);
      nlx = ddx / d;
      nlz = ddz / d;
      depth = r - d;
    }
    out.nx = nlx * c.cos + nlz * c.sin;
    out.nz = -nlx * c.sin + nlz * c.cos;
    out.depth = depth;
    return true;
  }

  /**
   * Pushes a vertical cylinder (circle + [feetY, feetY + height]) out of every
   * overlapping collider. Colliders whose top is within `step` of the feet are
   * ignored so bodies can walk onto curbs, steps and platforms.
   */
  resolveCircle(
    x: number,
    z: number,
    r: number,
    mask: number,
    feetY: number,
    height: number,
    step: number,
    contacts?: Contact[],
  ): { x: number; z: number } {
    const t = this.tmp;
    for (let it = 0; it < 4; it++) {
      const list = this.query(x - r, z - r, x + r, z + r, this.found);
      let moved = false;
      for (const c of list) {
        if ((c.mask & mask) === 0) continue;
        if (c.top <= feetY + step || c.bottom >= feetY + height) continue;
        if (!this.circleVs(c, x, z, r, t)) continue;
        x += t.nx * t.depth;
        z += t.nz * t.depth;
        contacts?.push({ nx: t.nx, nz: t.nz, depth: t.depth });
        moved = true;
      }
      if (!moved) break;
    }
    return { x, z };
  }

  /** Highest walkable collider top under the circle that is reachable from `feetY`. */
  supportHeight(x: number, z: number, r: number, mask: number, feetY: number, step: number): number {
    let best = -Infinity;
    const list = this.query(x - r, z - r, x + r, z + r, this.found);
    for (const c of list) {
      if ((c.mask & mask) === 0 || c.top > feetY + step || c.top <= best) continue;
      if (this.circleVs(c, x, z, r, this.tmp)) best = c.top;
    }
    return best;
  }

  /** Distance along a normalized ray to the first collider hit, or `maxT`. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, mask: number): number {
    const ex = ox + dx * maxT;
    const ez = oz + dz * maxT;
    const list = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), this.found);
    let best = maxT;
    for (const c of list) {
      if ((c.mask & mask) === 0) continue;
      const rx = ox - c.x;
      const rz = oz - c.z;
      const lox = rx * c.cos - rz * c.sin;
      const loz = rx * c.sin + rz * c.cos;
      const ldx = dx * c.cos - dz * c.sin;
      const ldz = dx * c.sin + dz * c.cos;
      let t0 = 0;
      let t1 = best;
      const slab = (o: number, d: number, mn: number, mx: number): boolean => {
        if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
        let a = (mn - o) / d;
        let b = (mx - o) / d;
        if (a > b) [a, b] = [b, a];
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        return t0 <= t1;
      };
      if (!slab(lox, ldx, -c.hx, c.hx)) continue;
      if (!slab(oy, dy, c.bottom, c.top)) continue;
      if (!slab(loz, ldz, -c.hz, c.hz)) continue;
      // Ignore colliders that contain the ray origin.
      if (t0 > 0 && t0 < best) best = t0;
    }
    return best;
  }
}

function cellKey(ix: number, iz: number): number {
  return (ix + 1000) * 2000 + (iz + 1000);
}
