import { clamp } from '../core/math';
import { Layer } from '../physics/CollisionWorld';
import type { BuildContext } from './context';
import { boxGeo, hipRoof, quadXZ } from './geometry';
import {
  BRIDGE, CURB, FLOOR_H, PLAZA_BLOCK, RAIL_X, type Rect, SIDEWALK, STREETS, type Street, TOWN, inRect, streetRect,
} from './layout';
import { MapLayer } from './MapSketch';
import { Unit, roundTree, streetLamp } from './props';

export type Facing = 'N' | 'S' | 'E' | 'W';

const FACING_VEC: Record<Facing, [number, number]> = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };

export interface BuildingOptions {
  floors?: number;
  facadeIndex?: number;
  galeria?: boolean;
  base?: number;
}

/**
 * A typical Merindades town house: plastered facade with tiled windows,
 * stone plinth, cornice, hip roof in terracotta and — often — a white glazed
 * "galería" on the upper floors facing the street.
 */
export function building(ctx: BuildContext, x0: number, z0: number, x1: number, z1: number, facing: Facing, opts: BuildingOptions = {}): void {
  const { batch, mats, rng } = ctx;
  const base = opts.base ?? CURB;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const floors = opts.floors ?? rng.int(2, 4);
  const h = floors * FLOOR_H + 0.4;
  const facade = mats.facades[opts.facadeIndex ?? rng.int(0, mats.facades.length - 1)];

  batch.add(boxGeo(w, h, d, 3.4, FLOOR_H), facade, cx, base + h / 2, cz);
  batch.add(boxGeo(w + 0.08, 0.9, d + 0.08, 2), mats.plinth, cx, base + 0.45, cz);
  batch.add(Unit.box, mats.stoneTrim, cx, base + h, cz, 0, w + 0.5, 0.28, d + 0.5);
  const roofH = Math.min(w, d) * 0.28;
  batch.add(hipRoof(w, d, roofH, 0.45), mats.roof, cx, base + h + 0.14, cz);
  if (rng.chance(0.5)) {
    batch.add(Unit.box, mats.stoneTrim, cx + rng.range(-w / 4, w / 4), base + h + roofH * 0.7, cz + rng.range(-d / 5, d / 5), 0, 0.6, 1.6, 0.6);
  }

  // Street-facing details.
  const [ox, oz] = FACING_VEC[facing];
  const alongX = oz !== 0;
  const facadeW = alongX ? w : d;
  const fx = ox === 0 ? cx : ox < 0 ? x0 : x1;
  const fz = oz === 0 ? cz : oz < 0 ? z0 : z1;
  const ry = alongX ? 0 : Math.PI / 2;
  const doorOff = rng.range(-facadeW / 3, facadeW / 3);
  const dx = alongX ? doorOff : 0;
  const dz = alongX ? 0 : doorOff;
  batch.add(Unit.box, mats.darkWood, fx + dx + ox * 0.05, base + 1.15, fz + dz + oz * 0.05, ry, 1.2, 2.3, 0.12);

  const wantGaleria = opts.galeria ?? (floors >= 2 && rng.chance(floors >= 3 ? 0.5 : 0.3));
  if (wantGaleria && facadeW > 5) {
    const gw = Math.min(facadeW - 1.6, rng.range(3.5, 7.5));
    const gh = (floors - 1) * FLOOR_H - 0.5;
    const gd = 0.9;
    const gy = base + FLOOR_H + 0.3 + gh / 2;
    const gx = fx + ox * gd / 2;
    const gz = fz + oz * gd / 2;
    batch.add(boxGeo(alongX ? gw : gd, gh, alongX ? gd : gw, 1.0, 1.4), mats.galeria, gx, gy, gz);
    batch.add(Unit.box, mats.roof, gx, gy + gh / 2 + 0.08, gz, 0, (alongX ? gw : gd) + 0.2, 0.16, (alongX ? gd : gw) + 0.2);
    ctx.collision.addBox(gx, gz, alongX ? gw : gd, alongX ? gd : gw, { bottom: gy - gh / 2, top: gy + gh / 2, mask: Layer.Camera });
  } else if (rng.chance(0.35)) {
    const aw = Math.min(4, facadeW - 1);
    const ax = fx + ox * 0.6 - (alongX ? doorOff : 0) * 0.3;
    const az = fz + oz * 0.6 - (alongX ? 0 : doorOff) * 0.3;
    batch.add(Unit.box, rng.pick(mats.awnings), ax, base + 2.85, az, ry, aw, 0.12, 1.2);
  }

  ctx.collision.addBox(cx, cz, w, d, { top: base + h + roofH, mask: Layer.Solid });
  ctx.sketch.rect(MapLayer.Building, x0, z0, x1, z1, '#b9a98c');
}

/** Splits a row of plots along its long axis and builds a house on each. */
function buildRow(ctx: BuildContext, x0: number, z0: number, x1: number, z1: number, facing: Facing): void {
  const alongX = facing === 'N' || facing === 'S';
  const start = alongX ? x0 : z0;
  const end = alongX ? x1 : z1;
  let p = start;
  while (end - p > 4) {
    let len = ctx.rng.range(7, 13);
    if (end - p - len < 6) len = end - p;
    const q = p + len;
    if (alongX) building(ctx, p, z0, q, z1, facing);
    else building(ctx, x0, p, x1, q, facing);
    p = q;
  }
}

function intervals(min: number, max: number, cuts: [number, number][]): [number, number][] {
  cuts.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = min;
  for (const [a, b] of cuts) {
    if (a > cur) out.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < max) out.push([cur, max]);
  return out;
}

function spansTownX(s: Street): boolean {
  return s.axis === 'z' && s.from <= TOWN.minZ && s.to >= TOWN.maxZ && s.c > TOWN.minX && s.c < TOWN.maxX;
}

function spansTownZ(s: Street): boolean {
  return s.axis === 'x' && s.from <= TOWN.minX && s.to >= TOWN.maxX && s.c > TOWN.minZ && s.c < TOWN.maxZ;
}

/** Town blocks = the rectangles left between the streets crossing the town. */
export function townBlocks(): Rect[] {
  const xs = intervals(TOWN.minX, TOWN.maxX, STREETS.filter(spansTownX).map((s) => [s.c - s.width / 2, s.c + s.width / 2]));
  const zs = intervals(TOWN.minZ, TOWN.maxZ, STREETS.filter(spansTownZ).map((s) => [s.c - s.width / 2, s.c + s.width / 2]));
  const blocks: Rect[] = [];
  for (const [minX, maxX] of xs) for (const [minZ, maxZ] of zs) blocks.push({ minX, maxX, minZ, maxZ });
  return blocks;
}

function onAnyStreet(x: number, z: number, pad: number, except?: Street): boolean {
  return STREETS.some((s) => s !== except && inRect(streetRect(s), x, z, pad));
}

function buildStreets(ctx: BuildContext): void {
  const { batch, mats } = ctx;
  for (const s of STREETS) {
    const r = streetRect(s);
    // The Camino Real is interrupted by the bridge over the Nela and by the level crossing (drawn by their builders).
    const pieces: Rect[] = [];
    if (s.main) {
      pieces.push({ ...r, maxX: BRIDGE.minX }, { ...r, minX: BRIDGE.maxX });
    } else pieces.push(r);
    for (const p of pieces) {
      batch.add(quadXZ(p.minX, p.minZ, p.maxX, p.maxZ, 0.03, 8), mats.asphalt, 0, 0, 0);
      ctx.sketch.rect(MapLayer.Road, p.minX, p.minZ, p.maxX, p.maxZ, s.main ? '#4b4b4f' : '#5a5a5e');
    }

    // Centre-line dashes (solid edge lines on the Camino Real).
    if (s.width < 7.5) continue;
    const step = 6;
    for (let t = s.from + 3; t < s.to - 2; t += step) {
      const [x, z] = s.axis === 'x' ? [t, s.c] : [s.c, t];
      if (onAnyStreet(x, z, 0.5, s) || inRect(BRIDGE, x, z, 1) || Math.abs(x - RAIL_X) < 4) continue;
      const len = 3;
      const lw = 0.16;
      if (s.axis === 'x') batch.add(quadXZ(x - len / 2, z - lw / 2, x + len / 2, z + lw / 2, 0.045, 1), mats.marking, 0, 0, 0);
      else batch.add(quadXZ(x - lw / 2, z - len / 2, x + lw / 2, z + len / 2, 0.045, 1), mats.marking, 0, 0, 0);
      if (s.main) {
        for (const side of [-1, 1]) {
          const ez = z + side * (s.width / 2 - 0.45);
          batch.add(quadXZ(x - step / 2, ez - 0.07, x + step / 2, ez + 0.07, 0.045, 1), mats.marking, 0, 0, 0);
        }
      }
    }
  }

  // Zebra crossings on the Camino Real in front of the plaza and at the side streets.
  const main = STREETS[0];
  for (const cxw of [-12, 12, -48, 48]) {
    for (let z = main.c - main.width / 2 + 0.8; z < main.c + main.width / 2 - 0.6; z += 1.1) {
      batch.add(quadXZ(cxw - 1.6, z, cxw + 1.6, z + 0.55, 0.046, 1), mats.marking, 0, 0, 0);
    }
  }
  for (const sx of [-37, 37]) {
    for (const zc of [main.c - main.width / 2 - 2.4, main.c + main.width / 2 + 2.4]) {
      for (let x = sx - 3.4; x < sx + 3.4; x += 1.1) {
        batch.add(quadXZ(x, zc - 1.4, x + 0.55, zc + 1.4, 0.046, 1), mats.marking, 0, 0, 0);
      }
    }
  }
}

function buildBlocks(ctx: BuildContext): void {
  const { batch, mats, rng } = ctx;
  for (const b of townBlocks()) {
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const isPlaza = b.minX === PLAZA_BLOCK.minX && b.minZ === PLAZA_BLOCK.minZ;
    batch.add(boxGeo(w, CURB, d, 2), isPlaza ? mats.paving : mats.sidewalk, (b.minX + b.maxX) / 2, CURB / 2, (b.minZ + b.maxZ) / 2);
    ctx.ground.push({ ...b, y: CURB });
    ctx.sketch.rect(MapLayer.Block, b.minX, b.minZ, b.maxX, b.maxZ, isPlaza ? '#cfc6b4' : '#a8a296');
    if (isPlaza) continue; // Landmarks builds the plaza block.

    const edge = (v: number, town: number) => (Math.abs(v - town) < 0.01 ? 1 : SIDEWALK);
    const x0 = b.minX + edge(b.minX, TOWN.minX);
    const x1 = b.maxX - edge(b.maxX, TOWN.maxX);
    const z0 = b.minZ + edge(b.minZ, TOWN.minZ);
    const z1 = b.maxZ - edge(b.maxZ, TOWN.maxZ);
    const W = x1 - x0;
    const D = z1 - z0;
    const depth = clamp(Math.min(W, D) / 2, 6, 12);

    if (D <= depth * 2 + 6) {
      if (D < 16) buildRow(ctx, x0, z0, x1, z1, b.maxZ >= TOWN.maxZ ? 'N' : 'S');
      else {
        buildRow(ctx, x0, z0, x1, (z0 + z1) / 2, 'N');
        buildRow(ctx, x0, (z0 + z1) / 2, x1, z1, 'S');
      }
    } else if (W <= depth * 2 + 6) {
      if (W < 16) buildRow(ctx, x0, z0, x1, z1, b.minX <= TOWN.minX ? 'E' : 'W');
      else {
        buildRow(ctx, x0, z0, (x0 + x1) / 2, z1, 'W');
        buildRow(ctx, (x0 + x1) / 2, z0, x1, z1, 'E');
      }
    } else {
      buildRow(ctx, x0, z0, x1, z0 + depth, 'N');
      buildRow(ctx, x0, z1 - depth, x1, z1, 'S');
      buildRow(ctx, x0, z0 + depth, x0 + depth, z1 - depth, 'W');
      buildRow(ctx, x1 - depth, z0 + depth, x1, z1 - depth, 'E');
      // Inner courtyard gardens ("huertas").
      const gx0 = x0 + depth + 1, gx1 = x1 - depth - 1, gz0 = z0 + depth + 1, gz1 = z1 - depth - 1;
      if (gx1 - gx0 > 4 && gz1 - gz0 > 4) {
        batch.add(quadXZ(gx0, gz0, gx1, gz1, CURB + 0.01, 4), mats.fields[1], 0, 0, 0);
        const trees = Math.floor(((gx1 - gx0) * (gz1 - gz0)) / 120);
        for (let i = 0; i < trees; i++) {
          roundTree(ctx, rng.range(gx0 + 2, gx1 - 2), rng.range(gz0 + 2, gz1 - 2), CURB, 0.6);
        }
      }
    }
  }
}

function buildLamps(ctx: BuildContext): void {
  for (const s of STREETS) {
    const inTownOnly = !s.main;
    for (let t = s.from + 8; t < s.to - 6; t += 24) {
      for (const side of [-1, 1]) {
        const off = s.width / 2 + 0.7;
        const [x, z] = s.axis === 'x' ? [t, s.c + side * off] : [s.c + side * off, t];
        const inTown = inRect(TOWN, x, z, -0.5);
        if (inTownOnly && !inTown) continue;
        if (onAnyStreet(x, z, 1.5, s) || inRect(BRIDGE, x, z, 3) || Math.abs(x - RAIL_X) < 8) continue;
        if (inRect(PLAZA_BLOCK, x, z, -0.5)) continue;
        const armDir = s.axis === 'x' ? (side > 0 ? Math.PI : 0) : side > 0 ? -Math.PI / 2 : Math.PI / 2;
        streetLamp(ctx, x, z, inTown ? CURB : 0, armDir);
      }
    }
  }
}

export function buildTown(ctx: BuildContext): void {
  buildStreets(ctx);
  buildBlocks(ctx);
  buildLamps(ctx);
}
