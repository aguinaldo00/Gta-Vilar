import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import { railingBars } from './Barriers';
import type { BuildContext } from './context';
import { hash01 } from './geo';
import type { MapBuilding } from './mapData';
import { Unit } from './props';

const SLAB = 0.14;
const RAIL_H = 1.0;
const STRIDE = 7;

let glassMat: THREE.MeshStandardMaterial | null = null;
function glass(): THREE.MeshStandardMaterial {
  if (!glassMat) {
    glassMat = new THREE.MeshStandardMaterial({
      color: '#b9d2d6',
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    glassMat.name = 'balconyGlass';
  }
  return glassMat;
}

/** A railing panel of `len` metres (bars texture laid out per 0.6 m), centred on its base line. */
function panel(len: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(len, RAIL_H).translate(0, RAIL_H / 2, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len) / 0.6, uv.getY(i));
  return g;
}

/** Geranium reds and pinks, petunia magenta and purple (the colours the photos show). */
const BLOOMS = ['#d1243a', '#e04e6e', '#c2186f', '#8e3fa8', '#e86a8a'];

/**
 * The balconies of one building where the LiDAR sees them (b.bal): a slab standing out of the
 * wall, iron bars (glass on recent blocks) on the three free sides, and window boxes of flowers
 * along the front where the cadastre's facade photo shows flowers. Floors are snapped to the
 * facade's storey rows, so balconies sit at the windows' feet.
 */
export function addBalconies(
  ctx: BuildContext,
  b: MapBuilding,
  idx: number,
  ground: number,
  rowBase: number,
  storeyH: number,
  top: number,
): number {
  const bal = b.bal;
  if (!bal?.length) return 0;
  const { batch, mats, collision } = ctx;
  const slabMat = mats.tint('#d9d4c8');
  const boxMat = mats.tint('#8a4a32');
  const leafMat = mats.tint('#3f6b2e');
  let n = 0;
  for (let i = 0; i + STRIDE - 1 < bal.length; i += STRIDE) {
    const [x0, z0, x1, z1, hrel, depth, flags] = bal.slice(i, i + STRIDE);
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.8) continue;
    // Floor of the balcony: the storey row nearest to the measured band.
    const raw = ground + hrel;
    const k = Math.max(1, Math.round((raw - rowBase) / storeyH));
    const snapped = rowBase + k * storeyH;
    const y = Math.abs(snapped - raw) < 0.9 ? snapped : raw;
    if (y > top - 1.2) continue;
    const ux = (x1 - x0) / len,
      uz = (z1 - z0) / len;
    // The bake orders the ends so that the outward normal is (-uz, ux).
    const nx = -uz,
      nz = ux;
    const rot = Math.atan2(-(z1 - z0), x1 - x0);
    // Rotation that maps local +X onto the wall and local +Z onto the outward normal.
    const mx = (x0 + x1) / 2 + (nx * depth) / 2,
      mz = (z0 + z1) / 2 + (nz * depth) / 2;
    batch.add(Unit.box, slabMat, mx, y - SLAB / 2, mz, rot, len, SLAB, depth);
    const railMat = (flags & 2) === 2 ? glass() : railingBars();
    const fx = (x0 + x1) / 2 + nx * (depth - 0.03),
      fz = (z0 + z1) / 2 + nz * (depth - 0.03);
    batch.add(panel(len), railMat, fx, y, fz, rot);
    for (const s of [-1, 1]) {
      const ex = (x0 + x1) / 2 + ux * s * (len / 2 - 0.03) + (nx * depth) / 2,
        ez = (z0 + z1) / 2 + uz * s * (len / 2 - 0.03) + (nz * depth) / 2;
      batch.add(panel(depth), railMat, ex, y, ez, rot + Math.PI / 2);
    }
    // Handrail.
    batch.add(Unit.box, mats.iron, fx, y + RAIL_H, fz, rot, len, 0.05, 0.06);
    if (flags & 1) {
      // Window boxes hung on the inside of the front rail, about one per 1.2 m.
      const boxes = Math.max(1, Math.floor(len / 1.2));
      for (let j = 0; j < boxes; j++) {
        const t = (j + 0.5) / boxes - 0.5;
        const bx = fx + ux * t * len - nx * 0.14,
          bz = fz + uz * t * len - nz * 0.14;
        const w = Math.min(0.9, (len / boxes) * 0.8);
        batch.add(Unit.box, boxMat, bx, y + RAIL_H - 0.1, bz, rot, w, 0.18, 0.2);
        batch.add(Unit.blob, leafMat, bx, y + RAIL_H + 0.02, bz, rot, w * 0.55, 0.14, 0.16);
        for (let f = 0; f < 3; f++) {
          const o = (f - 1) * w * 0.3;
          const c = BLOOMS[Math.floor(hash01(bx + f, bz + idx) * BLOOMS.length)];
          batch.add(Unit.blob, mats.tint(c), bx + ux * o, y + RAIL_H + 0.1, bz + uz * o, rot, 0.13, 0.1, 0.12);
        }
      }
    }
    // The follow camera stays out of them.
    collision.addBox(mx, mz, len, depth, { rot, bottom: y - SLAB, top: y, mask: Layer.Camera, absolute: true });
    n++;
  }
  return n;
}

const STREET = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'pedestrian',
]);

/** A bloom cluster: leaves and a few flowers in the photo's colours. */
function bloom(ctx: BuildContext, x: number, y: number, z: number, s: number, seed: number): void {
  const { batch, mats } = ctx;
  batch.add(Unit.blob, mats.tint('#3f6b2e'), x, y + s * 0.35, z, seed, s, s * 0.55, s);
  for (let f = 0; f < 3; f++) {
    const a = seed + f * 2.1;
    const c = BLOOMS[Math.floor(hash01(x + f, z + seed) * BLOOMS.length)];
    batch.add(
      Unit.blob,
      mats.tint(c),
      x + Math.cos(a) * s * 0.45,
      y + s * 0.62,
      z + Math.sin(a) * s * 0.45,
      a,
      s * 0.32,
      s * 0.24,
      s * 0.32,
    );
  }
}

/**
 * Flowers the cadastre's facade photo shows by a house (b.grn, data/greenery.json): pots on
 * the pavement beside the street wall (P) and a flower border along the front of the house
 * in its garden (G). The street wall is the visible wall nearest to a street.
 */
export function addGreenery(
  ctx: BuildContext,
  b: MapBuilding,
  outer: [number, number][],
  hidden: Set<number>,
  idx: number,
  facade: { rowBase: number; storeyH: number; bayW: number; top: number },
): number {
  if (!b.grn) return 0;
  let best: { i: number; d: number } | null = null;
  for (let i = 0; i < outer.length; i++) {
    if (hidden.has(i)) continue;
    const [ax, az] = outer[i],
      [bx, bz] = outer[(i + 1) % outer.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 3) continue;
    // Outward normal of a counter-clockwise ring (see Buildings.oriented).
    const nx = (bz - az) / len,
      nz = -(bx - ax) / len;
    const hit = ctx.roads.nearest((ax + bx) / 2 + nx * 0.5, (az + bz) / 2 + nz * 0.5, 25, (r) => STREET.has(r.k));
    if (hit && (!best || hit.d < best.d)) best = { i, d: hit.d };
  }
  if (!best) return 0;
  const [ax, az] = outer[best.i],
    [bx, bz] = outer[(best.i + 1) % outer.length];
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len,
    uz = (bz - az) / len;
  const nx = uz,
    nz = -ux;
  let n = 0;
  // Not on glazed galerías (the flowers stand inside the glass) or sheds.
  if (b.grn.includes('F') && b.gal !== 1 && b.t !== 'industrial') {
    // Window boxes under the upper-floor windows of the street front. The facade texture puts
    // a window in the middle of every bay, counting bays along the whole ring (Buildings.walls).
    let u0 = 0;
    for (let i = 0; i < best.i; i++) {
      const l = Math.hypot(outer[(i + 1) % outer.length][0] - outer[i][0], outer[(i + 1) % outer.length][1] - outer[i][1]);
      if (l >= 0.05) u0 += l;
    }
    const { rowBase, storeyH, bayW, top } = facade;
    const box = ctx.mats.tint('#8a4a32');
    // Only storeys that are whole (not the low wall under the eaves of a one-storey house).
    for (let k = 1; rowBase + (k + 1) * storeyH <= top + 0.4 && n < 24; k++) {
      const y = rowBase + k * storeyH + storeyH * 0.24;
      for (let c = Math.ceil(u0 / bayW - 0.5); (c + 0.5) * bayW < u0 + len; c++) {
        const along = (c + 0.5) * bayW - u0;
        if (along < 0.6 || along > len - 0.6) continue;
        const x = ax + ux * along + nx * 0.16,
          z = az + uz * along + nz * 0.16;
        const rot = Math.atan2(-uz, ux);
        ctx.batch.add(Unit.box, box, x, y - 0.08, z, rot, 0.9, 0.18, 0.22);
        bloom(ctx, x - ux * 0.22, y, z - uz * 0.22, 0.3, idx + c * 3 + k);
        bloom(ctx, x + ux * 0.22, y, z + uz * 0.22, 0.3, idx + c * 5 + k);
        n++;
      }
    }
  }
  if (b.grn.includes('P')) {
    // Two to four terracotta pots against the wall, on the pavement or the doorstep.
    const pots = Math.min(4, Math.max(2, Math.floor(len / 2.5)));
    const pot = ctx.mats.tint('#a5532f');
    for (let j = 0; j < pots; j++) {
      const along = Math.min(len - 0.4, Math.max(0.4, len / 2 + (j - (pots - 1) / 2) * 0.9 + (hash01(idx, j) - 0.5) * 0.3));
      const x = ax + ux * along + nx * 0.35,
        z = az + uz * along + nz * 0.35;
      const y = ctx.terrain.heightAt(x, z);
      ctx.batch.add(Unit.cyl, pot, x, y + 0.2, z, 0, 0.42, 0.4, 0.42);
      bloom(ctx, x, y + 0.38, z, 0.36, idx + j);
      n++;
    }
  }
  if (b.grn.includes('G') && best.d > 2.5) {
    // A border of flowers along the front wall, inside the garden (not on the pavement).
    const depth = Math.min(1.2, best.d - 1.2);
    const count = Math.max(2, Math.floor((len - 1) / 0.9));
    for (let j = 0; j < count; j++) {
      const along = 0.5 + ((len - 1) * (j + 0.5)) / count;
      const off = 0.5 + hash01(idx + 0.37, j) * Math.max(0.1, depth - 0.5);
      const x = ax + ux * along + nx * off,
        z = az + uz * along + nz * off;
      bloom(ctx, x, ctx.terrain.heightAt(x, z) - 0.05, z, 0.42 + hash01(j, idx) * 0.2, idx * 7 + j);
      n++;
    }
  }
  return n;
}
