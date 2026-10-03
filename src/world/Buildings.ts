import * as THREE from 'three';
import { Layer } from '../physics/CollisionWorld';
import type { BuildContext } from './context';
import { type Pt, centroid, hash01, signedArea, toPts, triangulate } from './geo';
import { FLOOR_H } from './Materials';
import { MAP, type MapBuilding } from './mapData';
import { VEHICLE_ROADS } from './Roads';

/** Landmarks get dedicated models instead of a generic extrusion. */
const CUSTOM = new Set(['townhall', 'torre']);
const OLD_TOWN_RADIUS = 450;

const FACADE_TINTS = ['#f3eee3', '#e8d7b5', '#f7f5f0', '#dcc39b', '#ead0bb', '#d9d1c1', '#e3dccb'].map((c) => new THREE.Color(c));
const MODERN_TINTS = ['#e9e6df', '#cfc8bb', '#d8cdb8', '#bfb6a6'].map((c) => new THREE.Color(c));
const STONE_TINT = new THREE.Color('#d8c49c');
const WHITE = new THREE.Color('#ffffff');
const FLAT_ROOF = new THREE.Color('#8f8a84');
const TERRACE = new THREE.Color('#b3a998');
const INDUSTRIAL_TINTS = ['#e4e6e1', '#d8d4c8', '#c9d0d4', '#e8e0cf'].map((c) => new THREE.Color(c));

/** Height in metres from OSM tags, with sensible defaults per building type. */
export function buildingHeight(b: MapBuilding, distToCentre: number): number {
  if (b.ht) return b.ht;
  const lv = b.lv;
  switch (b.t) {
    case 'church': return Math.max(11, (lv ?? 1) * 4);
    case 'industrial': return lv ? lv * 4.5 : 7;
    case 'small': return lv ? lv * 2.8 : 2.8;
    case 'tower': return (lv ?? 4) * 4.5;
    default: {
      const levels = lv ?? (distToCentre < 350 ? 3 : 2);
      return levels * FLOOR_H + 0.5;
    }
  }
}

/** Geometry accumulator with explicit normals, UVs and colours. */
class Mesh3 {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  /** Triangle; flipped if needed so its normal agrees with (nx, ny, nz). */
  tri(a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[], n: number[], color: THREE.Color): void {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
    }
    const len = Math.hypot(cx, cy, cz) || 1;
    const fn = cx * n[0] + cy * n[1] + cz * n[2] < 0 ? [-cx / len, -cy / len, -cz / len] : [cx / len, cy / len, cz / len];
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(fn[0], fn[1], fn[2]);
      this.uv.push(u[0], u[1]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[], n: number[], color: THREE.Color): void {
    this.tri(a, b, c, ua, ub, uc, n, color);
    this.tri(a, c, d, ua, uc, ud, n, color);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }
}

/** Ring with outer CCW / hole CW so that the outward normal of edge (dx, dz) is (dz, -dx). */
function oriented(r: Pt[], hole: boolean): Pt[] {
  const ccw = signedArea(r) > 0;
  return ccw !== hole ? r : r.slice().reverse();
}

/** Edge i (vertex i → i+1) of a ring becomes edge n-2-i once the ring is reversed. */
function remapEdges(edges: number[] | undefined, n: number, reversed: boolean): Set<number> {
  return new Set((edges ?? []).map((i) => (reversed ? (n - 2 - i + n) % n : i)));
}

function walls(m: Mesh3, ring: Pt[], y0: number, y1: number, color: THREE.Color, tileU: number, tileV: number, hidden?: Set<number>): void {
  let u = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    if (!hidden?.has(i)) {
      const n = [(bz - az) / len, 0, -(bx - ax) / len];
      const u0 = u / tileU, u1 = (u + len) / tileU, v0 = y0 / tileV, v1 = y1 / tileV;
      m.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [u0, v0], [u1, v0], [u1, v1], [u0, v1], n, color);
    }
    u += len;
  }
}

/** Hip roof on a convex quad: ridge along the long axis, triangles at the short ends. */
function hipRoof(m: Mesh3, q: Pt[], h: number, rise: number, color: THREE.Color): boolean {
  const e = [0, 1, 2, 3].map((i) => Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1]));
  const longFirst = e[0] + e[2] >= e[1] + e[3];
  // Short edges: (1,2) and (3,0) when edges 0 and 2 are the long ones.
  const [s1a, s1b, s2a, s2b] = longFirst ? [1, 2, 3, 0] : [0, 1, 2, 3];
  const mid = (a: number, b: number): Pt => [(q[a][0] + q[b][0]) / 2, (q[a][1] + q[b][1]) / 2];
  const m1 = mid(s1a, s1b), m2 = mid(s2a, s2b);
  const axisLen = Math.hypot(m2[0] - m1[0], m2[1] - m1[1]);
  const shortLen = (e[longFirst ? 1 : 0] + e[longFirst ? 3 : 2]) / 2;
  const inset = Math.min(shortLen / 2, axisLen / 2);
  const ux = (m2[0] - m1[0]) / axisLen, uz = (m2[1] - m1[1]) / axisLen;
  const top = h + rise;
  const r1 = [m1[0] + ux * inset, top, m1[1] + uz * inset];
  const r2 = [m2[0] - ux * inset, top, m2[1] - uz * inset];
  const P = (i: number) => [q[i][0], h, q[i][1]];
  const uvOf = (p: number[]) => [p[0] / 2, -p[2] / 2 + p[1]];
  const up = (a: number[], b: number[], c: number[]) => {
    // Outward-and-up normal: away from the quad centre.
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    const mx = (a[0] + b[0] + c[0]) / 3 - cx, mz = (a[2] + b[2] + c[2]) / 3 - cz;
    m.tri(a, b, c, uvOf(a), uvOf(b), uvOf(c), [mx, 2, mz], color);
  };
  // Long sides: trapezoids between a long edge and the ridge.
  const nearR = (p: number[]) => (Math.hypot(p[0] - r1[0], p[2] - r1[2]) < Math.hypot(p[0] - r2[0], p[2] - r2[2]) ? r1 : r2);
  for (const [a, b] of [[s1b, s2a], [s2b, s1a]]) {
    const A = P(a), Bv = P(b);
    const ra = nearR(A), rb = nearR(Bv);
    up(A, Bv, rb);
    if (ra !== rb) up(A, rb, ra);
  }
  up(P(s1a), P(s1b), r1);
  up(P(s2a), P(s2b), r2);
  return true;
}

/** Inward offset of a ring by `d` (miter), or null if it degenerates. */
function inset(ring: Pt[], d: number): Pt[] | null {
  const n = ring.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n], c = ring[i], nx = ring[(i + 1) % n];
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(nx[0] - c[0], nx[1] - c[1]);
    if (l1 < 1e-3 || l2 < 1e-3) return null;
    // Inward normals for a CCW ring are (-dz, dx).
    const n1 = [-(c[1] - p[1]) / l1, (c[0] - p[0]) / l1], n2 = [-(nx[1] - c[1]) / l2, (nx[0] - c[0]) / l2];
    const bx = n1[0] + n2[0], bz = n1[1] + n2[1];
    const bl = Math.hypot(bx, bz);
    if (bl < 0.3) return null;
    const k = d / ((bx * n1[0] + bz * n1[1]) / bl);
    if (k > d * 3) return null;
    out.push([c[0] + (bx / bl) * k, c[1] + (bz / bl) * k]);
  }
  const a0 = signedArea(ring), a1 = signedArea(out);
  return a1 > 0 && a1 > a0 * 0.15 ? out : null;
}

/** Tiled roof skirt sloping up from the eaves to a flat top (irregular footprints). */
function skirtRoof(m: Mesh3, ring: Pt[], holes: Pt[][], h: number, color: THREE.Color, flatColor: THREE.Color): void {
  const inner = holes.length ? null : inset(ring, 2.2);
  const uvOf = (p: number[]) => [p[0] / 2, -p[2] / 2 + p[1]];
  if (!inner) {
    for (const [a, b, c] of triangulate(ring, holes)) {
      const A = [a[0], h, a[1]], B = [b[0], h, b[1]], C = [c[0], h, c[1]];
      m.tri(A, B, C, uvOf(A), uvOf(B), uvOf(C), [0, 1, 0], flatColor);
    }
    return;
  }
  const rise = 1.3;
  const c = centroid(ring);
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const A = [ring[i][0], h, ring[i][1]], B = [ring[j][0], h, ring[j][1]];
    const C = [inner[j][0], h + rise, inner[j][1]], D = [inner[i][0], h + rise, inner[i][1]];
    const n = [(A[0] + B[0]) / 2 - c[0], 2, (A[2] + B[2]) / 2 - c[1]];
    m.quad(A, B, C, D, uvOf(A), uvOf(B), uvOf(C), uvOf(D), n, color);
  }
  for (const [a, b, cc] of triangulate(inner)) {
    const A = [a[0], h + rise, a[1]], B = [b[0], h + rise, b[1]], C = [cc[0], h + rise, cc[1]];
    m.tri(A, B, C, uvOf(A), uvOf(B), uvOf(C), [0, 1, 0], color);
  }
}

function isConvexQuad(r: Pt[]): boolean {
  if (r.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = r[i], b = r[(i + 1) % 4], c = r[(i + 2) % 4];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== 0 && s !== sign) return false;
  }
  return true;
}

/**
 * Real footprints from OSM, extruded to building:levels. Walls carry a
 * per-building tint (vertex colour) on a shared window texture; roofs are
 * hipped on rectangular plots and skirted elsewhere. Collision follows the
 * footprint with one thin box per wall.
 */
export function buildBuildings(ctx: BuildContext): void {
  const { batch, mats, collision, roads } = ctx;
  let idx = 0;
  for (const b of MAP.buildings) {
    idx++;
    // Landmarks get their own models; outlines described by parts are drawn through their parts.
    if (CUSTOM.has(b.t) || b.hp) continue;
    const raw = toPts(b.o);
    const reversed = signedArea(raw) <= 0;
    const outer = oriented(raw, false);
    const hidden = remapEdges(b.hid, outer.length, reversed);
    const holes = (b.h ?? []).map((h) => oriented(toPts(h), true));
    const [cx, cz] = centroid(outer);
    const distC = Math.hypot(cx, cz);
    const y0 = (b.mlv ?? 0) * FLOOR_H;
    const h = y0 + buildingHeight(b, distC);
    const area = signedArea(outer);
    const rnd = hash01(idx);

    if (b.t === 'canopy') {
      canopy(ctx, outer, h > 6 ? 3.2 : h);
      continue;
    }
    const industrial = b.t === 'industrial';
    const ruins = b.t === 'ruins';
    const church = b.t === 'church' || b.mat === 'stone' || b.t === 'station' || ruins;
    const wallsMesh = new Mesh3();
    const roofMesh = new Mesh3();
    let tint: THREE.Color;
    if (church) tint = STONE_TINT;
    else if (b.t === 'block' || distC > 650) tint = MODERN_TINTS[Math.floor(rnd * MODERN_TINTS.length)];
    else tint = FACADE_TINTS[Math.floor(rnd * FACADE_TINTS.length)];
    if (b.t === 'station') tint = new THREE.Color('#d8b98a');
    if (industrial) tint = INDUSTRIAL_TINTS[Math.floor(rnd * INDUSTRIAL_TINTS.length)];
    const top = ruins ? y0 + Math.min(h - y0, 3.5) : h;

    for (const [k, ring] of [outer, ...holes].entries()) {
      walls(wallsMesh, ring, y0, top, tint, industrial ? 2 : 3.4, industrial ? 2 : FLOOR_H, k === 0 ? hidden : undefined);
    }

    // Roofs. Low annexes (one storey, small) get flat terraces, like the patios and garages of the old town.
    const lowAnnex = b.part && (b.lv ?? 1) <= 1 && area < 140;
    if (ruins) {
      // Roofless.
    } else if (b.t === 'greenhouse') {
      flatRoof(roofMesh, outer, holes, top, new THREE.Color('#cfe0e4'));
    } else if (industrial || (b.t === 'block' && area > 600) || lowAnnex) {
      flatRoof(roofMesh, outer, holes, top, lowAnnex ? TERRACE : FLAT_ROOF);
    } else if (isConvexQuad(outer) && !holes.length && area < 900) {
      const short = Math.min(...[0, 1, 2, 3].map((i) => Math.hypot(outer[(i + 1) % 4][0] - outer[i][0], outer[(i + 1) % 4][1] - outer[i][1])));
      // A small overhang (alero) beyond the walls, as on the real houses.
      const eave = inset(outer, -0.35) ?? outer;
      hipRoof(roofMesh, eave, top - 0.05, Math.min(4.5, short * 0.32), WHITE);
    } else {
      skirtRoof(roofMesh, outer, holes, top, WHITE, b.t === 'small' ? FLAT_ROOF : WHITE);
    }

    const wallMat = b.t === 'greenhouse' ? mats.galeria : industrial ? mats.corrugatedVC : church ? mats.stoneVC : mats.facadeVC;
    batch.addWorld(wallsMesh.geometry(), wallMat);
    if (!roofMesh.empty) batch.addWorld(roofMesh.geometry(), industrial ? mats.corrugatedVC : mats.roofVC);

    // White glazed galería on the street-facing side of old-town houses (as in the plaza photos).
    if (!church && !industrial && distC < OLD_TOWN_RADIUS && h - y0 > 2 * FLOOR_H && y0 === 0 && rnd < 0.5) {
      let best: { i: number; len: number } | null = null;
      for (let i = 0; i < outer.length; i++) {
        if (hidden.has(i)) continue;
        const [ax, az] = outer[i], [bx, bz] = outer[(i + 1) % outer.length];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 5) continue;
        const nx = (bz - az) / len, nz = -(bx - ax) / len;
        const hit = roads.nearest((ax + bx) / 2 + nx * 4, (az + bz) / 2 + nz * 4, 3, (r) => VEHICLE_ROADS.has(r.k) || r.k === 'pedestrian');
        if (hit && (!best || len > best.len)) best = { i, len };
      }
      if (best) {
        const [ax, az] = outer[best.i], [bx, bz] = outer[(best.i + 1) % outer.length];
        const len = best.len;
        const nx = (bz - az) / len, nz = -(bx - ax) / len;
        const gw = Math.min(len - 1.6, 3 + hash01(idx, 7) * 4);
        const gh = h - FLOOR_H - 0.9;
        const gd = 0.9;
        const mx = (ax + bx) / 2 + nx * (gd / 2), mz = (az + bz) / 2 + nz * (gd / 2);
        const rot = Math.atan2(-(bz - az), bx - ax);
        const gy = FLOOR_H + 0.3 + gh / 2;
        const geo = new THREE.BoxGeometry(gw, gh, gd);
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) * gw) / 1.0, (uv.getY(k) * gh) / 1.4);
        batch.add(geo, mats.galeria, mx, gy, mz, rot);
        batch.add(new THREE.BoxGeometry(gw + 0.2, 0.15, gd + 0.2), mats.roof, mx, gy + gh / 2 + 0.07, mz, rot);
        collision.addBox(mx, mz, gw, gd, { rot, bottom: gy - gh / 2, top: gy + gh / 2, mask: Layer.Camera });
      }
    }

    // Collision: one thin box per visible wall, set just inside the footprint.
    for (const [k, ring] of [outer, ...holes].entries()) {
      for (let i = 0; i < ring.length; i++) {
        if (k === 0 && hidden.has(i)) continue;
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.2) continue;
        const nx = (bz - az) / len, nz = -(bx - ax) / len; // outward
        const t = 0.5;
        collision.addBox((ax + bx) / 2 - nx * (t / 2), (az + bz) / 2 - nz * (t / 2), len + 0.15, t, {
          rot: Math.atan2(-(bz - az), bx - ax), bottom: y0, top: top + 2, mask: Layer.Solid,
        });
      }
    }
  }
}

function flatRoof(m: Mesh3, outer: Pt[], holes: Pt[][], h: number, color: THREE.Color): void {
  for (const [p, q, s] of triangulate(outer, holes)) {
    const A = [p[0], h, p[1]], B = [q[0], h, q[1]], C = [s[0], h, s[1]];
    m.tri(A, B, C, [A[0] / 2, -A[2] / 2], [B[0] / 2, -B[2] / 2], [C[0] / 2, -C[2] / 2], [0, 1, 0], color);
  }
}

/** Open shelter (building=roof): a slab on posts at the corners. */
function canopy(ctx: BuildContext, ring: Pt[], h: number): void {
  const roof = new Mesh3();
  flatRoof(roof, ring, [], h, new THREE.Color('#9a958c'));
  ctx.batch.addWorld(roof.geometry(), ctx.mats.roofVC);
  for (const [x, z] of ring) {
    ctx.batch.add(new THREE.BoxGeometry(0.25, h, 0.25), ctx.mats.iron, x, h / 2, z);
    ctx.collision.addCircle(x, z, 0.2, { top: h, mask: Layer.Solid });
  }
}
