import * as THREE from 'three';
import { Layer } from '../physics/CollisionWorld';
import type { BuildContext } from './context';
import { type Pt, pointInRing, toPts, triangulate } from './geo';
import { MAP } from './mapData';
import { WATER_LEVEL } from './Terrain';
import { createWaterMaterial } from './Water';

/** Continuous strip along a polyline with mitred joints (no overlaps, so transparent water blends once). */
function miterStrip(pts: Pt[], hw: number, y: number, keep: (x: number, z: number) => boolean): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    let nx = -dz / len, nz = dx / len;
    let k = hw;
    if (i > 0 && i < pts.length - 1) {
      const d1 = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
      const l1 = Math.hypot(d1[0], d1[1]) || 1;
      const n1 = [-d1[1] / l1, d1[0] / l1];
      const cos = nx * n1[0] + nz * n1[1];
      k = hw / Math.max(0.5, cos);
    } else if (i === 0) {
      nx = -(pts[1][1] - pts[0][1]);
      nz = pts[1][0] - pts[0][0];
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
    }
    left.push([pts[i][0] + nx * k, pts[i][1] + nz * k]);
    right.push([pts[i][0] - nx * k, pts[i][1] - nz * k]);
  }
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i][0] + pts[i - 1][0]) / 2, mz = (pts[i][1] + pts[i - 1][1]) / 2;
    if (!keep(mx, mz)) continue;
    const quad = [left[i - 1], left[i], right[i], right[i - 1]];
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      let [A, B, C] = [quad[a], quad[b], quad[c]];
      if ((B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) < 0) [B, C] = [C, B];
      pos.push(A[0], y, A[1], B[0], y, B[1], C[0], y, C[1]);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function polygonGeometry(outer: Pt[], holes: Pt[][], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let [a, b, c] of triangulate(outer, holes)) {
    if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) [b, c] = [c, b];
    pos.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Río Nela, the natural pools, streams, garden swimming pools and the weirs. */
export function buildHydro(ctx: BuildContext): void {
  const river = createWaterMaterial('#1d5a76', '#4a98ad', 1.1);
  const pools = createWaterMaterial('#16707a', '#55bfbd', 0.15, 0.8);
  const stream = createWaterMaterial('#2c5a52', '#4f8a7a', 0.8, 0.9);
  const swim = createWaterMaterial('#2a8fb5', '#7fd6ea', 0.05, 0.92);
  const add = (g: THREE.BufferGeometry | null, mat: THREE.Material, order = 1) => {
    if (!g) return;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = order;
    ctx.scene.add(mesh);
  };

  const poolRings = MAP.areas.filter((a) => a.k === 'water').map((a) => toPts(a.o));
  const outsidePools = (x: number, z: number) => !poolRings.some((r) => pointInRing(x, z, r));
  for (const r of MAP.rivers) add(miterStrip(toPts(r.p), r.w / 2 + 2, WATER_LEVEL, outsidePools), river);
  for (const a of MAP.areas) {
    if (a.k === 'water') add(polygonGeometry(toPts(a.o), (a.h ?? []).map(toPts), WATER_LEVEL + 0.005), pools);
  }

  const streams: THREE.BufferGeometry[] = [];
  for (const s of MAP.streams) {
    const g = miterStrip(toPts(s.p), s.w / 2, 0.02, () => true);
    if (g) streams.push(g);
  }
  if (streams.length) add(mergeAll(streams), stream);

  // Garden and municipal swimming pools, with a paved rim.
  const swims: THREE.BufferGeometry[] = [];
  for (const a of MAP.areas) {
    if (a.k !== 'pool') continue;
    const ring = toPts(a.o);
    swims.push(polygonGeometry(ring, [], 0.06));
  }
  if (swims.length) add(mergeAll(swims), swim, 2);

  // Weirs (azudes): low stone walls across the river.
  for (const w of MAP.weirs) {
    const pts = toPts(w.p);
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const rot = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      ctx.batch.add(new THREE.BoxGeometry(1.4, 2.6, len + 1), ctx.mats.stone, mx, -1.6, mz, rot);
      ctx.collision.addBox(mx, mz, 1.4, len + 1, { rot, bottom: -3, top: -0.3, mask: Layer.Player });
    }
  }
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const g of geos) pos.push(...(g.attributes.position.array as Float32Array));
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
