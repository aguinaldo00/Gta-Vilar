import * as THREE from 'three';
import { Layer } from '../physics/CollisionWorld';
import type { BuildContext } from './context';
import { beamMatrix, boxGeo, curveStrip, hipRoof, quadXZ } from './geometry';
import {
  BRIDGE, CAMINO_REAL_Z, FOOTBRIDGE_Z, RIVER, SOTO, SOTO_PARKING, inRect, riverCenterX, terrainHeight,
} from './layout';
import { MapLayer } from './MapSketch';
import { Unit, picnicTable, poplar, roundTree, signBoard } from './props';
import { signTexture } from './textures';
import { createWaterMaterial } from './Water';

const WEST_PATH = (z: number) => riverCenterX(z) - 17;

function buildRiver(ctx: BuildContext): void {
  const river = createWaterMaterial('#1d5a86', '#4a98bf', 1.4);
  const pools = createWaterMaterial('#167a86', '#5cc8c6', 0.2, 0.8);
  const hw = RIVER.halfWidth + 1;
  for (const [z0, z1] of [[-230, RIVER.poolZ0], [RIVER.poolZ1, 230]]) {
    const m = new THREE.Mesh(curveStrip(riverCenterX, z0, z1, hw, RIVER.water, 4), river);
    m.renderOrder = 1;
    ctx.scene.add(m);
  }
  const p = new THREE.Mesh(curveStrip(riverCenterX, RIVER.poolZ0, RIVER.poolZ1, hw, RIVER.water, 4), pools);
  p.renderOrder = 1;
  ctx.scene.add(p);

  // Minimap: visible water width is ~2 x 6.5 m.
  const left: number[] = [];
  const right: number[] = [];
  for (let z = -210; z <= 210; z += 5) {
    left.push(riverCenterX(z) - 6.5, z);
    right.unshift(riverCenterX(z) + 6.5, z);
  }
  const pts: number[] = [...left];
  for (let i = 0; i < right.length; i += 2) pts.push(right[i], right[i + 1]);
  ctx.sketch.poly(MapLayer.Water, pts, '#3d84b8');
  const cxp = riverCenterX((RIVER.poolZ0 + RIVER.poolZ1) / 2);
  ctx.sketch.rect(MapLayer.Water, cxp - 6.5, RIVER.poolZ0, cxp + 6.5, RIVER.poolZ1, '#4cc0c4');

  // Stone weirs that hold back the natural pools.
  for (const z of [RIVER.poolZ0, RIVER.poolZ1]) {
    const cx = riverCenterX(z);
    ctx.batch.add(boxGeo(2 * RIVER.halfWidth + 2, 2.6, 1.2, 2), ctx.mats.stone, cx, -1.6, z);
    ctx.collision.addBox(cx, z, 2 * RIVER.halfWidth + 2, 1.2, { bottom: -3, top: -0.3, mask: Layer.Player });
  }
}

/** Stone road bridge carrying the Camino Real over the Nela. */
function buildBridge(ctx: BuildContext): void {
  const { batch, mats, collision } = ctx;
  const B = BRIDGE;
  const len = B.maxX - B.minX;
  const cx = (B.minX + B.maxX) / 2;
  const w = B.maxZ - B.minZ;
  batch.add(boxGeo(len, 1.0, w, 2), mats.stone, cx, B.deck - 0.5, CAMINO_REAL_Z);
  batch.add(quadXZ(B.minX, B.minZ + 0.5, B.maxX, B.maxZ - 0.5, B.deck + 0.01, 8), mats.asphalt, 0, 0, 0);
  for (const side of [-1, 1]) {
    const z = CAMINO_REAL_Z + side * (w / 2 - 0.25);
    batch.add(boxGeo(len, 0.9, 0.5, 2), mats.stone, cx, B.deck + 0.45, z);
    batch.add(Unit.box, mats.stoneTrim, cx, B.deck + 0.95, z, 0, len + 0.1, 0.1, 0.62);
    collision.addBox(cx, z, len, 0.5, { top: B.deck + 1.0 });
  }
  const rc = riverCenterX(CAMINO_REAL_Z);
  for (const px of [rc - 3.5, rc + 3.5]) {
    batch.add(boxGeo(1.8, 2.2, w - 1, 2), mats.stone, px, -1.0, CAMINO_REAL_Z);
    batch.add(Unit.cone, mats.stone, px, -0.9, CAMINO_REAL_Z - w / 2 - 0.2, 0, 1.8, 2.2, 1.4);
  }
  ctx.ground.push({ minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ, y: B.deck });
  ctx.sketch.rect(MapLayer.Road, B.minX, B.minZ, B.maxX, B.maxZ, '#6e6a62');
}

/** Wooden pedestrian footbridge further north. */
function buildFootbridge(ctx: BuildContext): void {
  const { batch, mats, collision } = ctx;
  const z = FOOTBRIDGE_Z;
  const rc = riverCenterX(z);
  const x0 = rc - 13, x1 = rc + 13;
  const top = 0.5;
  const len = x1 - x0;
  batch.add(boxGeo(len, 0.2, 3, 2), mats.wood, rc, top - 0.1, z);
  for (const side of [-1, 1]) {
    const rz = z + side * 1.4;
    batch.add(Unit.box, mats.wood, rc, top + 1.0, rz, 0, len, 0.1, 0.12);
    for (let x = x0; x <= x1 + 0.01; x += 2.6) {
      batch.add(Unit.box, mats.wood, x, top + 0.5, rz, 0, 0.12, 1.0, 0.12);
      batch.add(Unit.box, mats.trunk, x, (top - 1.4) / 2, rz, 0, 0.2, 1.4 + top, 0.2);
    }
    collision.addBox(rc, rz, len, 0.2, { top: top + 1.1, mask: Layer.Bodies });
  }
  // Bollards keep vehicles off the footbridge.
  for (const bx of [x0 - 0.6, x1 + 0.6]) {
    for (const bz of [z - 0.9, z, z + 0.9]) batch.add(Unit.cyl, mats.iron, bx, 0.45, bz, 0, 0.22, 0.9, 0.22);
    collision.addBox(bx, z, 0.5, 3, { top: 1, mask: Layer.Vehicle });
  }
  ctx.ground.push({ minX: x0, maxX: x1, minZ: z - 1.5, maxZ: z + 1.5, y: top });
  ctx.sketch.rect(MapLayer.Road, x0, z - 1.5, x1, z + 1.5, '#8b6a45');
}

/** Lawn, sunbeds, jetty, diving board and lifeguard chair on the west bank of the pools. */
function buildPoolAmenities(ctx: BuildContext): void {
  const { batch, mats, collision, rng } = ctx;
  const midZ = (RIVER.poolZ0 + RIVER.poolZ1) / 2;
  const bankX = (z: number) => riverCenterX(z) - 12;

  for (let i = 0; i < 10; i++) {
    const z = RIVER.poolZ0 + 6 + i * 4.4;
    const x = bankX(z) - 3 - (i % 2) * 5;
    batch.add(Unit.box, mats.white, x, 0.25, z, Math.PI / 2, 0.7, 0.12, 1.9);
    batch.add(Unit.box, mats.white, x - 0.85, 0.45, z, Math.PI / 2, 0.7, 0.1, 0.5, -0.6);
    if (i % 3 === 0) {
      const ux = x - 1.6;
      batch.add(Unit.cyl, mats.white, ux, 1.2, z + 1.2, 0, 0.08, 2.4, 0.08);
      batch.add(Unit.cone, rng.pick(mats.awnings), ux, 2.5, z + 1.2, 0, 3.4, 0.6, 3.4);
      collision.addCircle(ux, z + 1.2, 0.1, { top: 2.4, mask: Layer.Bodies });
    }
  }

  // Wooden jetty over the pool with a diving board and ladder.
  const jz0 = midZ - 5, jz1 = midZ + 3;
  const jx0 = riverCenterX(midZ) - 9.5, jx1 = riverCenterX(midZ) - 4;
  const jTop = 0.2;
  batch.add(boxGeo(jx1 - jx0, 0.2, jz1 - jz0, 2), mats.wood, (jx0 + jx1) / 2, jTop - 0.1, (jz0 + jz1) / 2);
  for (const px of [jx0 + 0.3, jx1 - 0.3]) for (const pz of [jz0 + 0.3, jz1 - 0.3]) {
    batch.add(Unit.box, mats.trunk, px, (jTop - 3) / 2, pz, 0, 0.25, 3 + jTop, 0.25);
  }
  ctx.ground.push({ minX: jx0, maxX: jx1, minZ: jz0, maxZ: jz1, y: jTop });
  const boardZ = midZ - 1;
  batch.add(Unit.box, mats.white, jx1 + 1.4, 0.75, boardZ, 0, 3.2, 0.1, 0.6);
  batch.add(Unit.box, mats.iron, jx1 - 0.3, 0.45, boardZ, 0, 0.3, 0.5, 0.5);
  ctx.ground.push({ minX: jx1 - 0.2, maxX: jx1 + 3, minZ: boardZ - 0.3, maxZ: boardZ + 0.3, y: 0.8 });
  for (const off of [-0.3, 0.3]) {
    batch.addMatrix(Unit.cyl, mats.white, beamMatrix(jx1 + 0.1, 1.0, jz1 - 1.5 + off, jx1 + 0.4, -2, jz1 - 1.5 + off, 0.06));
  }

  // Lifeguard chair.
  const lx = bankX(midZ) - 1, lz = midZ + 9;
  for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]]) {
    batch.addMatrix(Unit.cyl, mats.white, beamMatrix(lx + ox * 1.5, 0, lz + oz * 1.5, lx + ox * 0.8, 2.5, lz + oz * 0.8, 0.12));
  }
  batch.add(Unit.box, mats.redPaint, lx, 2.6, lz, 0, 1.5, 0.15, 1.5);
  batch.add(Unit.box, mats.redPaint, lx - 0.7, 3.1, lz, 0, 0.1, 1, 1.5);
  collision.addCircle(lx, lz, 1.0, { top: 2.7, mask: Layer.Bodies });

  // Changing hut.
  const hx = bankX(midZ) - 20, hz = midZ - 8;
  batch.add(boxGeo(6, 2.8, 3.4, 2), mats.wood, hx, 1.4, hz);
  batch.add(hipRoof(6, 3.4, 1.0, 0.4), mats.roof, hx, 2.8, hz);
  for (let i = 0; i < 3; i++) batch.add(Unit.box, mats.awnings[2], hx - 2 + i * 2, 1.1, hz + 1.72, 0, 1.2, 2.0, 0.06);
  collision.addBox(hx, hz, 6, 3.4, { top: 3.8 });
  ctx.sketch.rect(MapLayer.Building, hx - 3, hz - 1.7, hx + 3, hz + 1.7, '#8b6a45');
}

function buildPathsAndParking(ctx: BuildContext): void {
  const { batch, mats } = ctx;
  for (const [z0, z1] of [[-188, CAMINO_REAL_Z - 5.5], [CAMINO_REAL_Z + 5.5, 188]]) {
    batch.add(curveStrip(WEST_PATH, z0, z1, 1.3, 0.025, 4, 4), mats.dirt, 0, 0, 0);
    const pts: number[] = [];
    for (let z = z0; z <= z1; z += 8) pts.push(WEST_PATH(z), z);
    ctx.sketch.poly(MapLayer.Road, pts, '#a08a64', 2.6);
  }
  const fz = FOOTBRIDGE_Z;
  batch.add(quadXZ(WEST_PATH(fz), fz - 1.2, riverCenterX(fz) - 12.5, fz + 1.2, 0.026, 4), mats.dirt, 0, 0, 0);
  const P = SOTO_PARKING;
  batch.add(quadXZ(P.minX, P.minZ, P.maxX, P.maxZ, 0.024, 6), mats.gravel, 0, 0, 0);
  ctx.sketch.rect(MapLayer.Road, P.minX, P.minZ, P.maxX, P.maxZ, '#8c857a');
  signBoard(ctx, signTexture('PARQUE EL SOTO', '#3d2b1a', '#f1e6c8'), P.minX + 4, P.minZ - 1.2, 0, 0);
  signBoard(ctx, signTexture('PISCINAS NATURALES · RÍO NELA', '#1d4e89', '#ffffff', 640, 96), WEST_PATH(RIVER.poolZ1 + 6) - 2.2, RIVER.poolZ1 + 6, 0, Math.PI / 2, 4.2);
}

/** Riverside woodland: poplars along the banks, broad trees elsewhere. */
function buildWoods(ctx: BuildContext): void {
  const { rng } = ctx;
  const placed: [number, number][] = [];
  const free = (x: number, z: number, minD: number) => placed.every(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 > minD * minD);
  const midZ = (RIVER.poolZ0 + RIVER.poolZ1) / 2;

  // Poplar rows along both banks.
  for (let z = -190; z < 190; z += rng.range(6, 9)) {
    for (const side of [-1, 1]) {
      const x = riverCenterX(z) + side * rng.range(11.5, 13.5);
      if (Math.abs(z - CAMINO_REAL_Z) < 9 || Math.abs(z - FOOTBRIDGE_Z) < 4) continue;
      if (side < 0 && z > RIVER.poolZ0 - 6 && z < RIVER.poolZ1 + 6) continue;
      poplar(ctx, x, z, 0);
      placed.push([x, z]);
    }
  }
  let count = 0;
  for (let attempt = 0; attempt < 4000 && count < 230; attempt++) {
    const x = rng.range(SOTO.minX + 4, 196);
    const z = rng.range(-194, 194);
    const d = Math.abs(x - riverCenterX(z));
    if (d < 11) continue;
    if (Math.abs(z - CAMINO_REAL_Z) < 9) continue;
    if (inRect(SOTO_PARKING, x, z, 3)) continue;
    if (x < riverCenterX(z) && x > riverCenterX(z) - 36 && z > RIVER.poolZ0 - 10 && z < RIVER.poolZ1 + 10) continue;
    if (Math.abs(x - WEST_PATH(z)) < 2.6) continue;
    if (Math.abs(z - FOOTBRIDGE_Z) < 3 && x < riverCenterX(z)) continue;
    if (Math.abs(x - 100) < 8) continue;
    if (!free(x, z, 5)) continue;
    const y = terrainHeight(x, z);
    if (rng.chance(0.3)) poplar(ctx, x, z, y);
    else roundTree(ctx, x, z, y);
    placed.push([x, z]);
    count++;
  }
  // Picnic tables in clearings near the path.
  for (let i = 0; i < 7; i++) {
    const z = -170 + i * 50 + rng.range(-6, 6);
    if (Math.abs(z - CAMINO_REAL_Z) < 12 || Math.abs(z - midZ) < 30) continue;
    const x = WEST_PATH(z) - 5;
    if (free(x, z, 3)) picnicTable(ctx, x, z, 0, rng.range(0, Math.PI));
  }
}

export function buildSoto(ctx: BuildContext): void {
  ctx.sketch.rect(MapLayer.Ground, SOTO.minX, SOTO.minZ - 20, SOTO.maxX + 20, SOTO.maxZ + 20, '#4f7234');
  buildRiver(ctx);
  buildBridge(ctx);
  buildFootbridge(ctx);
  buildPoolAmenities(ctx);
  buildPathsAndParking(ctx);
  buildWoods(ctx);
}
