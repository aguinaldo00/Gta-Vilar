import { Layer } from '../physics/CollisionWorld';
import type { BuildContext } from './context';
import { beamMatrix, boxGeo, gableRoof, quadXZ } from './geometry';
import { CAMINO_REAL_Z, RAIL_X, RAIL_Z0, RAIL_Z1, SIDING_X, STATION, STREETS } from './layout';
import { MapLayer } from './MapSketch';
import { Unit, signBoard } from './props';
import { signTexture } from './textures';
import { building } from './Town';

const BALLAST_TOP = 0.32;
const GAUGE = 1.44;

/** Ballast, sleepers and rusty rails between z0 and z1, with a flush level crossing over the Camino Real. */
function track(ctx: BuildContext, x: number, z0: number, z1: number): void {
  const { batch, mats, rng } = ctx;
  const road = STREETS[0];
  const crossA = CAMINO_REAL_Z - road.width / 2;
  const crossB = CAMINO_REAL_Z + road.width / 2;
  const segments: [number, number][] = z0 < crossA && z1 > crossB ? [[z0, crossA], [crossB, z1]] : [[z0, z1]];

  for (const [a, b] of segments) {
    const len = b - a;
    const mid = (a + b) / 2;
    batch.add(boxGeo(4.2, BALLAST_TOP, len, 3), mats.gravel, x, BALLAST_TOP / 2, mid);
    ctx.ground.push({ minX: x - 2.1, maxX: x + 2.1, minZ: a, maxZ: b, y: BALLAST_TOP });
    for (let z = a + 0.4; z < b - 0.2; z += 0.75) {
      if (rng.chance(0.06)) continue; // missing sleepers: nobody has maintained this line in decades
      batch.add(Unit.box, mats.sleeper, x + rng.range(-0.05, 0.05), BALLAST_TOP + 0.05, z, rng.range(-0.06, 0.06), 2.5, 0.12, 0.24);
    }
    for (const side of [-1, 1]) batch.add(Unit.box, mats.rail, x + (side * GAUGE) / 2, BALLAST_TOP + 0.17, mid, 0, 0.08, 0.14, len);
    // Weeds growing through the ballast.
    for (let i = 0; i < len / 3; i++) {
      const s = rng.range(0.3, 0.7);
      batch.add(Unit.blob, rng.pick(mats.foliage), x + rng.range(-2, 2), BALLAST_TOP + s * 0.3, rng.range(a, b), rng.range(0, 3), s, s * 0.6, s);
    }
    ctx.sketch.rect(MapLayer.Road, x - 2.1, a, x + 2.1, b, '#7d766b');
    ctx.sketch.rect(MapLayer.Landmark, x - 0.9, a, x - 0.6, b, '#4a3a2e');
    ctx.sketch.rect(MapLayer.Landmark, x + 0.6, a, x + 0.9, b, '#4a3a2e');
  }
  if (segments.length === 2) {
    for (const side of [-1, 1]) batch.add(Unit.box, mats.rail, x + (side * GAUGE) / 2, 0.06, CAMINO_REAL_Z, 0, 0.08, 0.07, road.width);
  }
}

/** Saint Andrew's cross at the level crossing. */
function crossingSign(ctx: BuildContext, x: number, z: number): void {
  const { batch, mats } = ctx;
  batch.add(Unit.cyl, mats.white, x, 1.4, z, 0, 0.12, 2.8, 0.12);
  for (const tilt of [Math.PI / 4, -Math.PI / 4]) {
    batch.add(Unit.box, mats.redPaint, x + 0.07, 2.5, z, 0, 0.04, 0.22, 1.5, tilt);
    batch.add(Unit.box, mats.white, x + 0.08, 2.5, z, 0, 0.04, 0.12, 1.3, tilt);
  }
  ctx.collision.addCircle(x, z, 0.12, { top: 3, mask: Layer.Bodies });
}

function wagon(ctx: BuildContext, x: number, z: number, kind: 'freight' | 'coach'): void {
  const { batch, mats, collision } = ctx;
  const len = kind === 'freight' ? 10 : 14;
  const y0 = BALLAST_TOP + 0.24;
  for (const bz of [-len / 2 + 2, len / 2 - 2]) {
    batch.add(Unit.box, mats.iron, x, y0 + 0.5, z + bz, 0, 1.6, 0.4, 2.2);
    for (const wz of [-0.7, 0.7]) for (const side of [-1, 1]) {
      batch.add(Unit.cyl16, mats.rust, x + (side * GAUGE) / 2, y0 + 0.45, z + bz + wz, 0, 0.9, 0.12, 0.9, 0, Math.PI / 2);
    }
  }
  batch.add(Unit.box, mats.iron, x, y0 + 0.9, z, 0, 2.4, 0.3, len);
  if (kind === 'freight') {
    batch.add(boxGeo(2.8, 2.6, len - 0.4, 2), mats.corrugatedRust, x, y0 + 2.35, z);
    batch.add(Unit.box, mats.rust, x, y0 + 3.7, z, 0, 2.9, 0.12, len - 0.2);
    batch.add(Unit.box, mats.darkWood, x + 1.42, y0 + 2.2, z, 0, 0.05, 2.0, 2.4);
  } else {
    batch.add(Unit.box, mats.coachGreen, x, y0 + 2.4, z, 0, 2.8, 2.7, len - 0.4);
    for (const side of [-1, 1]) {
      for (let wz = -len / 2 + 1.5; wz < len / 2 - 1; wz += 1.6) {
        batch.add(Unit.box, mats.glass, x + side * 1.41, y0 + 2.8, z + wz, 0, 0.04, 0.8, 1.0);
      }
    }
    batch.add(Unit.cyl16, mats.concrete, x, y0 + 3.75, z, 0, 2.8, len - 0.4, 0.7, Math.PI / 2);
  }
  collision.addBox(x, z, 3, len, { top: y0 + 4 });
  ctx.sketch.rect(MapLayer.Landmark, x - 1.5, z - len / 2, x + 1.5, z + len / 2, '#7a4428');
}

function buildStation(ctx: BuildContext): void {
  const { batch, mats, collision } = ctx;
  const S = STATION;
  // Two-storey station house facing the tracks (west).
  building(ctx, S.minX, S.minZ, S.maxX, S.maxZ, 'W', { floors: 2, facadeIndex: 3, galeria: false, base: 0 });
  const sign = signTexture('VILLARCAYO', '#f2ecdc', '#20304a');
  signBoard(ctx, sign, S.minX - 0.15, (S.minZ + S.maxZ) / 2, 2.6, Math.PI / 2, 4.6, 0.8, 0.01);
  // Boarded-up doors.
  for (const dz of [-6, 0, 6]) {
    const z = (S.minZ + S.maxZ) / 2 + dz;
    for (let i = 0; i < 3; i++) batch.add(Unit.box, mats.wood, S.minX - 0.12, 0.6 + i * 0.75, z, 0, 0.06, 0.25, 1.5, 0, (i - 1) * 0.15);
  }
  // Platform (andén) with ramps at each end.
  const px0 = RAIL_X + 2.3, px1 = S.minX - 0.2;
  const pz0 = S.minZ - 12, pz1 = S.maxZ + 12;
  const top = 0.8;
  batch.add(boxGeo(px1 - px0, top, pz1 - pz0, 2), mats.concrete, (px0 + px1) / 2, top / 2, (pz0 + pz1) / 2);
  batch.add(Unit.box, mats.white, px0 + 0.25, top + 0.005, (pz0 + pz1) / 2, 0, 0.3, 0.01, pz1 - pz0);
  collision.addBox((px0 + px1) / 2, (pz0 + pz1) / 2, px1 - px0, pz1 - pz0, { top });
  for (const [zz, dir] of [[pz0, -1], [pz1, 1]] as const) {
    for (let i = 0; i < 2; i++) {
      const stepTop = top - 0.27 * (i + 1);
      const sz = zz + dir * (0.4 + i * 0.8);
      batch.add(boxGeo(px1 - px0, stepTop, 0.8, 2), mats.concrete, (px0 + px1) / 2, stepTop / 2, sz);
      collision.addBox((px0 + px1) / 2, sz, px1 - px0, 0.8, { top: stepTop });
    }
  }
  // Canopy on cast-iron columns.
  const cz0 = S.minZ + 2, cz1 = S.maxZ - 2;
  for (let z = cz0; z <= cz1 + 0.01; z += (cz1 - cz0) / 4) {
    batch.add(Unit.cyl, mats.ironGreen, px0 + 1.4, top + 1.7, z, 0, 0.18, 3.4, 0.18);
    collision.addCircle(px0 + 1.4, z, 0.12, { bottom: top, top: top + 3.4, mask: Layer.Bodies });
  }
  batch.add(Unit.box, mats.corrugatedRust, (px0 + 1.4 + S.minX) / 2, top + 3.5, (cz0 + cz1) / 2, 0, S.minX - px0 + 0.4, 0.12, cz1 - cz0 + 1, 0, 0.12);
  ctx.sketch.rect(MapLayer.Building, px0, pz0, px1, pz1, '#b8b4aa');

  // Parking / yard in front of the station.
  batch.add(quadXZ(S.maxX, -24, -130, -9, 0.024, 6), mats.gravel, 0, 0, 0);
  ctx.sketch.rect(MapLayer.Road, S.maxX, -24, -130, -9, '#8c857a');
  signBoard(ctx, signTexture('FERROCARRIL SANTANDER - MEDITERRÁNEO', '#20304a', '#f2ecdc', 768, 96), -150, -6.5, 0, Math.PI / 2, 5, 0.65);
}

/** Railway water tower ("aguada") for the old steam engines. */
function waterTower(ctx: BuildContext, x: number, z: number): void {
  const { batch, mats } = ctx;
  for (const [ox, oz] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]) {
    batch.addMatrix(Unit.cyl, mats.iron, beamMatrix(x + ox, 0, z + oz, x + ox * 0.8, 6, z + oz * 0.8, 0.25));
  }
  batch.add(Unit.cyl16, mats.rust, x, 7.6, z, 0, 4.6, 3.2, 4.6);
  batch.add(Unit.cone, mats.rust, x, 9.7, z, 0, 5, 1, 5);
  batch.addMatrix(Unit.cyl, mats.iron, beamMatrix(x + 2.3, 7, z, x + 4.2, 5.2, z, 0.2));
  ctx.collision.addCircle(x, z, 2.2, { top: 10 });
  ctx.sketch.circle(MapLayer.Landmark, x, z, 2.3, '#7a4428');
}

/** Disused goods shed (nave) with a corrugated gable roof. */
function warehouse(ctx: BuildContext, x: number, z: number, w: number, len: number): void {
  const { batch, mats } = ctx;
  const h = 6;
  batch.add(boxGeo(w, h, len, 2), mats.corrugated, x, h / 2, z);
  batch.add(gableRoof(w + 1, len + 0.6, 2.6), mats.corrugatedRust, x, h, z);
  batch.add(Unit.box, mats.darkWood, x + w / 2 + 0.05, 2.4, z, 0, 0.1, 4.8, 6);
  for (let i = -2; i <= 2; i++) batch.add(Unit.box, mats.glass, x + w / 2 + 0.05, 5, z + i * 4.5, 0, 0.1, 0.8, 2.6);
  ctx.collision.addBox(x, z, w, len, { top: h + 2.6 });
  ctx.sketch.rect(MapLayer.Building, x - w / 2, z - len / 2, x + w / 2, z + len / 2, '#8d8f8a');
}

function signal(ctx: BuildContext, x: number, z: number): void {
  const { batch, mats } = ctx;
  batch.add(Unit.cyl, mats.iron, x, 3, z, 0, 0.2, 6, 0.2);
  batch.add(Unit.box, mats.redPaint, x + 0.6, 5.4, z, 0, 1.4, 0.25, 0.06, 0, -0.5);
  batch.add(Unit.box, mats.white, x + 0.9, 5.25, z + 0.01, 0, 0.3, 0.27, 0.06, 0, -0.5);
  ctx.collision.addCircle(x, z, 0.15, { top: 6, mask: Layer.Bodies });
}

export function buildRailway(ctx: BuildContext): void {
  track(ctx, RAIL_X, RAIL_Z0, RAIL_Z1);
  track(ctx, SIDING_X, -100, 22);
  for (const z of [-100.6, 22.6]) {
    ctx.batch.add(Unit.box, ctx.mats.redPaint, SIDING_X, 0.8, z, 0, 2.4, 0.6, 0.4);
    ctx.collision.addBox(SIDING_X, z, 2.4, 0.5, { top: 1.1 });
  }
  wagon(ctx, SIDING_X, -42, 'freight');
  wagon(ctx, SIDING_X, -4, 'coach');
  buildStation(ctx);
  waterTower(ctx, -151, -62);
  warehouse(ctx, -186, -112, 14, 30);
  signal(ctx, RAIL_X + 2.6, -95);
  signal(ctx, RAIL_X - 2.6, 110);
  crossingSign(ctx, RAIL_X + 4, CAMINO_REAL_Z - 7);
  crossingSign(ctx, RAIL_X - 4, CAMINO_REAL_Z + 7);
}
