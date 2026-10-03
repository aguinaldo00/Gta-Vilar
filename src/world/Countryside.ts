import { Layer } from '../physics/CollisionWorld';
import type { BuildContext } from './context';
import { quadXZ } from './geometry';
import { CAMINO_REAL_Z, RAIL_X, type Rect, WORLD_HALF, inRect, riverCenterX, terrainHeight } from './layout';
import { MapLayer } from './MapSketch';
import { Unit, hayBale, pine, poplar } from './props';

/** Crop fields around the town (north, south and between the town and the railway). */
const FIELDS: Rect[] = [
  { minX: -158, minZ: -186, maxX: -108, maxZ: -140 },
  { minX: -95, minZ: -186, maxX: -44, maxZ: -140 },
  { minX: -30, minZ: -186, maxX: 30, maxZ: -140 },
  { minX: 44, minZ: -186, maxX: 94, maxZ: -140 },
  { minX: -158, minZ: 142, maxX: -108, maxZ: 186 },
  { minX: -95, minZ: 142, maxX: -44, maxZ: 186 },
  { minX: -30, minZ: 142, maxX: 30, maxZ: 186 },
  { minX: 44, minZ: 142, maxX: 94, maxZ: 186 },
  { minX: -158, minZ: 46, maxX: -134, maxZ: 128 },
  { minX: -196, minZ: -60, maxX: -178, maxZ: 26 },
  { minX: -196, minZ: 44, maxX: -178, maxZ: 130 },
];

function buildFields(ctx: BuildContext): void {
  const { batch, mats, rng } = ctx;
  for (const f of FIELDS) {
    const mi = rng.int(0, mats.fields.length - 1);
    batch.add(quadXZ(f.minX, f.minZ, f.maxX, f.maxZ, 0.02, 5), mats.fields[mi], 0, 0, 0);
    ctx.sketch.rect(MapLayer.Ground, f.minX, f.minZ, f.maxX, f.maxZ, ['#b8a058', '#7f9c48', '#8d6f50', '#a8b158'][mi]);
    if (mi === 0 || mi === 3) {
      const n = Math.floor(((f.maxX - f.minX) * (f.maxZ - f.minZ)) / 260);
      for (let i = 0; i < n; i++) hayBale(ctx, rng.range(f.minX + 3, f.maxX - 3), rng.range(f.minZ + 3, f.maxZ - 3), 0, rng.range(0, Math.PI));
    }
    // Hedgerow along the field edges.
    for (let x = f.minX; x <= f.maxX; x += 4) {
      for (const z of [f.minZ - 1, f.maxZ + 1]) {
        if (rng.chance(0.55)) batch.add(Unit.blob, mats.hedge, x + rng.range(-1, 1), 0.5, z, rng.range(0, 3), 1.4, 0.9, 1.1);
      }
    }
  }
}

/** Poplar avenue along the Camino Real outside the town. */
function buildAvenue(ctx: BuildContext): void {
  for (let x = -182; x < -130; x += 9) {
    if (Math.abs(x - RAIL_X) < 9) continue;
    for (const side of [-1, 1]) poplar(ctx, x, CAMINO_REAL_Z + side * 8.5, 0);
  }
  for (let x = 124; x < 182; x += 9) {
    if (Math.abs(x - riverCenterX(CAMINO_REAL_Z)) < 18) continue;
    for (const side of [-1, 1]) poplar(ctx, x, CAMINO_REAL_Z + side * 8.5, 0);
  }
}

/** Pine-covered hills closing the valley at the edge of the map. */
function buildHills(ctx: BuildContext): void {
  const { rng } = ctx;
  for (let i = 0; i < 520; i++) {
    const x = rng.range(-235, 235);
    const z = rng.range(-235, 235);
    if (Math.max(Math.abs(x), Math.abs(z)) < WORLD_HALF - 4) continue;
    if (Math.abs(x - riverCenterX(z)) < 12) continue;
    pine(ctx, x, z, terrainHeight(x, z) - 0.2);
  }
}

/** Invisible walls just inside the hills. */
function buildBounds(ctx: BuildContext): void {
  const H = WORLD_HALF;
  const span = 2 * H + 40;
  const o = { top: 100, mask: Layer.Bodies };
  ctx.collision.addBox(0, -H - 5, span, 10, o);
  ctx.collision.addBox(0, H + 5, span, 10, o);
  ctx.collision.addBox(-H - 5, 0, 10, span, o);
  ctx.collision.addBox(H + 5, 0, 10, span, o);
}

export function buildCountryside(ctx: BuildContext): void {
  buildFields(ctx);
  buildAvenue(ctx);
  buildHills(ctx);
  buildBounds(ctx);
}

export function isField(x: number, z: number): boolean {
  return FIELDS.some((f) => inRect(f, x, z));
}
