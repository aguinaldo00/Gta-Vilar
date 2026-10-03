import * as THREE from 'three';
import { Layer } from '../physics/CollisionWorld';
import type { BuildContext } from './context';
import { beamMatrix, boxGeo, hipRoof, scaleUV } from './geometry';
import { AYTO, CURB, KIOSKO, PLAZA, PLAZA_BLOCK, TORRE } from './layout';
import { MapLayer } from './MapSketch';
import { Unit, bench, flag, planeTree, plazaLamp } from './props';
import { building } from './Town';

const ARCH_SPACING = 6.8;
const ARCH_HALF = 2.2;
const ARCH_SPRING = 2.6;

/**
 * Casa Consistorial: two-storey sandstone block with a five-arch arcade on the
 * ground floor, iron balconies, hip roof and the central clock gable topped by
 * an iron bell cage (see the reference photos).
 */
function buildAyuntamiento(ctx: BuildContext): void {
  const { batch, mats, collision } = ctx;
  const { x: cx, z: cz, w, d } = AYTO;
  const base = CURB;
  const gf = 5.0;
  const uf = 5.2;
  const front = cz + d / 2;
  const back = cz - d / 2;
  const arcadeDepth = 4;
  const archXs = [-2, -1, 0, 1, 2].map((i) => cx + i * ARCH_SPACING);

  // Ground floor core behind the arcade.
  const coreD = d - arcadeDepth;
  batch.add(boxGeo(w, gf, coreD, 2), mats.stone, cx, base + gf / 2, back + coreD / 2);
  collision.addBox(cx, back + coreD / 2, w, coreD, { top: base + gf });

  // Arcaded front wall: outline with five round arches cut from the bottom edge.
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  for (const ax of archXs) {
    const lx = ax - cx;
    s.lineTo(lx - ARCH_HALF, 0);
    s.lineTo(lx - ARCH_HALF, ARCH_SPRING);
    s.absarc(lx, ARCH_SPRING, ARCH_HALF, Math.PI, 0, true);
    s.lineTo(lx + ARCH_HALF, 0);
  }
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, gf);
  s.lineTo(-w / 2, gf);
  s.closePath();
  const arcade = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 10 });
  scaleUV(arcade, 0.5, 0.5);
  arcade.translate(0, 0, -1);
  batch.add(arcade, mats.stone, cx, base, front);

  // Pillar colliders between the arches.
  const edges = [-w / 2, ...archXs.flatMap((ax) => [ax - cx - ARCH_HALF, ax - cx + ARCH_HALF]), w / 2];
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i], b = edges[i + 1];
    collision.addBox(cx + (a + b) / 2, front - 0.5, b - a, 1, { top: base + gf });
  }

  // Doors and windows under the arcade (on the core's front face).
  const coreFront = back + coreD;
  archXs.forEach((ax, i) => {
    const isDoor = i === 2 || i === 0 || i === 4;
    if (isDoor) batch.add(Unit.box, mats.darkWood, ax, base + 1.6, coreFront + 0.06, 0, 1.9, 3.2, 0.12);
    else batch.add(Unit.box, mats.glass, ax, base + 2.2, coreFront + 0.06, 0, 1.5, 2.0, 0.12);
    bench(ctx, ax + (i % 2 ? 0 : 1.6), coreFront + 0.5, base, 0);
  });

  // Upper floor (also roofs the arcade).
  const upperY = base + gf;
  batch.add(boxGeo(w, uf, d, 2), mats.stone, cx, upperY + uf / 2, cz);
  collision.addBox(cx, cz, w, d, { bottom: upperY, top: upperY + uf + 4, mask: Layer.Solid });
  batch.add(Unit.box, mats.stoneTrim, cx, upperY + 0.15, cz, 0, w + 0.3, 0.35, d + 0.3);

  // Tall balcony windows above every arch and on the sides.
  for (const ax of archXs) {
    batch.add(Unit.box, mats.stoneTrim, ax, upperY + 2.1, front + 0.05, 0, 2.0, 3.2, 0.12);
    batch.add(Unit.box, mats.glass, ax, upperY + 2.0, front + 0.1, 0, 1.4, 2.7, 0.1);
    batch.add(Unit.box, mats.white, ax, upperY + 2.0, front + 0.13, 0, 0.08, 2.7, 0.06);
  }
  for (const side of [-1, 1]) {
    for (const oz of [-3.5, 3.5]) {
      batch.add(Unit.box, mats.stoneTrim, cx + side * (w / 2 + 0.05), upperY + 2.1, cz + oz, 0, 0.12, 3.2, 2.0);
      batch.add(Unit.box, mats.glass, cx + side * (w / 2 + 0.1), upperY + 2.0, cz + oz, 0, 0.1, 2.7, 1.4);
    }
  }
  // Long central iron balcony and two single ones.
  const balconies: [number, number][] = [[cx, ARCH_SPACING * 2 + 2.4], [archXs[0], 2.6], [archXs[4], 2.6]];
  for (const [bx, bw] of balconies) {
    batch.add(Unit.box, mats.stoneTrim, bx, upperY + 0.42, front + 0.4, 0, bw, 0.16, 0.8);
    batch.add(boxGeo(bw, 0.95, 0.04, 2.4, 0.95), mats.ironwork, bx, upperY + 0.98, front + 0.78);
  }

  // Cornice, roof.
  const topY = upperY + uf;
  batch.add(Unit.box, mats.stoneTrim, cx, topY + 0.25, cz, 0, w + 0.8, 0.5, d + 0.8);
  batch.add(hipRoof(w, d, 3.6, 0.5), mats.roof, cx, topY + 0.5, cz);

  // Clock gable with rounded top, clock face and iron bell cage.
  const gz = front - 0.3;
  const gw = 5.2;
  const gh = 3.4;
  batch.add(boxGeo(gw, gh, 1.2, 2), mats.stone, cx, topY + gh / 2, gz);
  const cap = new THREE.CylinderGeometry(gw / 2, gw / 2, 1.2, 20, 1, false, -Math.PI / 2, Math.PI);
  cap.rotateX(-Math.PI / 2);
  batch.add(cap, mats.stone, cx, topY + gh, gz);
  batch.add(Unit.box, mats.stoneTrim, cx, topY + gh + 0.05, gz, 0, gw + 0.3, 0.2, 1.4);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), mats.clock);
  clock.position.set(cx, topY + gh * 0.55, gz + 0.62);
  ctx.scene.add(clock);
  batch.add(Unit.cyl16, mats.stoneTrim, cx, topY + gh * 0.55, gz + 0.58, 0, 2.7, 0.1, 2.7, Math.PI / 2);

  const cageBase = topY + gh + gw / 2;
  const legs: [number, number][] = [[-0.8, -0.4], [0.8, -0.4], [0.8, 0.4], [-0.8, 0.4]];
  for (const [lx, lz] of legs) {
    batch.addMatrix(Unit.cyl, mats.iron, beamMatrix(cx + lx, cageBase - 0.1, gz + lz, cx, cageBase + 2.3, gz, 0.07));
  }
  batch.add(Unit.cone, mats.bronze, cx, cageBase + 1.0, gz, 0, 0.8, 0.9, 0.8);
  batch.add(Unit.sphere, mats.bronze, cx, cageBase + 0.55, gz, 0, 0.8, 0.3, 0.8);
  batch.add(Unit.cyl, mats.iron, cx, cageBase + 2.9, gz, 0, 0.05, 1.3, 0.05);
  batch.add(Unit.box, mats.iron, cx + 0.2, cageBase + 3.3, gz, 0, 0.6, 0.15, 0.03);

  // Balcony flags (Spain, Castilla y León, Europe) leaning over the plaza.
  flag(ctx, 'es', cx, upperY + 0.6, front + 0.7, 2.8, 0, 0.45);
  flag(ctx, 'cyl', cx - 2.2, upperY + 0.6, front + 0.7, 2.8, 0, 0.45);
  flag(ctx, 'eu', cx + 2.2, upperY + 0.6, front + 0.7, 2.8, 0, 0.45);

  ctx.sketch.rect(MapLayer.Landmark, cx - w / 2, back, cx + w / 2, front, '#d9b77a');
}

/** Torre del Corregimiento: square medieval stone tower with crenellations. */
function buildTorre(ctx: BuildContext): void {
  const { batch, mats, collision } = ctx;
  const { x, z, size: s, height: h } = TORRE;
  const base = CURB;
  batch.add(boxGeo(s + 0.6, 1.2, s + 0.6, 2), mats.plinth, x, base + 0.6, z);
  batch.add(boxGeo(s, h, s, 2), mats.stone, x, base + h / 2, z);
  batch.add(boxGeo(s + 0.7, 0.7, s + 0.7, 2), mats.stone, x, base + h + 0.35, z);
  // Merlons.
  const top = base + h + 0.7;
  const half = (s + 0.7) / 2 - 0.3;
  for (let i = 0; i < 6; i++) {
    const t = -half + (i * 2 * half) / 5;
    for (const [mx, mz] of [[t, -half], [t, half], [-half, t], [half, t]]) {
      batch.add(Unit.box, mats.stone, x + mx, top + 0.55, z + mz, 0, 0.75, 1.1, 0.75);
    }
  }
  // Pointed-arch door, arrow slits and windows.
  batch.add(Unit.box, mats.darkWood, x, base + 1.7, z + s / 2 + 0.05, 0, 1.6, 2.8, 0.1);
  batch.add(Unit.cone, mats.darkWood, x, base + 3.4, z + s / 2 + 0.05, 0, 1.6, 1.0, 0.1);
  for (const [wy, ww, wh] of [[8, 0.35, 1.4], [12.5, 1.0, 1.8], [17, 0.35, 1.4]] as const) {
    batch.add(Unit.box, mats.glass, x, base + wy, z + s / 2 + 0.05, 0, ww, wh, 0.1);
    batch.add(Unit.box, mats.glass, x + s / 2 + 0.05, base + wy, z, 0, 0.1, wh, ww);
    batch.add(Unit.box, mats.glass, x - s / 2 - 0.05, base + wy, z, 0, 0.1, wh, ww);
    batch.add(Unit.box, mats.glass, x, base + wy, z - s / 2 - 0.05, 0, ww, wh, 0.1);
  }
  // Coat of arms plaque.
  batch.add(Unit.box, mats.stoneTrim, x, base + 5.2, z + s / 2 + 0.08, 0, 1.2, 1.5, 0.15);
  collision.addBox(x, z, s + 0.6, s + 0.6, { top: base + h + 2 });
  ctx.sketch.rect(MapLayer.Landmark, x - s / 2, z - s / 2, x + s / 2, z + s / 2, '#a9875a');
}

/** Octagonal music kiosk: stone base, wooden columns, green ironwork and a tiled roof. */
function buildKiosko(ctx: BuildContext): void {
  const { batch, mats, collision } = ctx;
  const { x, z } = KIOSKO;
  const base = CURB;
  const P = base + 1.6; // platform level
  const oct = (r1: number, r2: number, h: number) => {
    const g = new THREE.CylinderGeometry(r1, r2, h, 8);
    g.rotateY(Math.PI / 8); // put a flat face towards +Z (the entrance)
    return g;
  };
  batch.add(oct(4.3, 4.5, 1.6), mats.stone, x, base + 0.8, z);
  batch.add(oct(4.7, 4.7, 0.22), mats.darkWood, x, P - 0.05, z);
  const colR = 3.95;
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    const px = x + Math.sin(a) * colR;
    const pz = z + Math.cos(a) * colR;
    batch.add(Unit.cyl, mats.darkWood, px, P + 1.8, pz, 0, 0.26, 3.6, 0.26);
    batch.add(Unit.box, mats.stoneTrim, px, P + 0.45, pz, a, 0.38, 0.9, 0.38);
    batch.add(Unit.sphere, mats.stoneTrim, px, P + 1.05, pz, 0, 0.36, 0.36, 0.36);
    collision.addCircle(px, pz, 0.2, { bottom: P, top: P + 3.6, mask: Layer.Bodies });
    if (k % 2 === 0) {
      const lx = px + Math.sin(a) * 0.55;
      const lz = pz + Math.cos(a) * 0.55;
      batch.addMatrix(Unit.cyl, mats.ironGreen, beamMatrix(px, P + 2.6, pz, lx, P + 2.9, lz, 0.06));
      batch.add(Unit.box, mats.lampGlass, lx, P + 2.65, lz, a, 0.26, 0.4, 0.26);
      batch.add(Unit.cone, mats.ironGreen, lx, P + 3.0, lz, 0, 0.45, 0.3, 0.45);
    }
  }
  // Iron railings on seven faces; the +Z face is the stair entrance.
  const apothem = colR * Math.cos(Math.PI / 8);
  const panelW = 2 * colR * Math.sin(Math.PI / 8) - 0.35;
  for (let k = 1; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const px = x + Math.sin(a) * apothem;
    const pz = z + Math.cos(a) * apothem;
    batch.add(boxGeo(panelW, 0.9, 0.04, panelW, 0.9), mats.ironwork, px, P + 0.5, pz, a);
    batch.add(Unit.box, mats.ironGreen, px, P + 0.97, pz, a, panelW, 0.06, 0.08);
    collision.addBox(px, pz, panelW + 0.4, 0.2, { rot: a, bottom: P, top: P + 1.0, mask: Layer.Player });
  }
  // Roof: dark timber ceiling, terracotta octagonal cone and a little lantern.
  batch.add(oct(5.3, 5.3, 0.3), mats.darkWood, x, P + 3.7, z);
  batch.add(new THREE.ConeGeometry(5.6, 1.6, 8).rotateY(Math.PI / 8), mats.roof, x, P + 4.65, z);
  batch.add(oct(1.1, 1.1, 0.9), mats.darkWood, x, P + 5.6, z);
  batch.add(new THREE.ConeGeometry(1.5, 0.6, 8).rotateY(Math.PI / 8), mats.roof, x, P + 6.3, z);
  // Platform and stairs (step colliders let the player walk up).
  collision.addCircle(x, z, 4.25, { top: P, mask: Layer.Solid });
  const steps = [P - 0.4, P - 0.8, P - 1.2];
  steps.forEach((top, i) => {
    const sz = z + 4.4 + i * 0.6;
    const h = top - base;
    batch.add(boxGeo(2.6, h, 0.6, 1), mats.stone, x, base + h / 2, sz);
    collision.addBox(x, sz, 2.6, 0.6, { top, mask: Layer.Solid });
  });
  ctx.sketch.circle(MapLayer.Landmark, x, z, 4.6, '#8a5a3a');
}

/** Pollarded plane trees, benches, lamps, flagpoles and the seated bronze statue. */
function buildPlazaDecor(ctx: BuildContext): void {
  const base = CURB;
  for (let x = -26; x <= 26; x += 6.5) planeTree(ctx, x, -16.5, base);
  for (const x of [-27, 27]) for (let z = -9; z <= 21; z += 7.5) planeTree(ctx, x, z, base);
  for (let x = -22.75; x <= 22.75; x += 13) bench(ctx, x, -14.8, base, 0);
  for (const x of [-25, 25]) for (const z of [-5.25, 9.75]) bench(ctx, x, z, base, x < 0 ? Math.PI / 2 : -Math.PI / 2);
  for (const [lx, lz] of [[-12, -6], [-12, 16], [16, 14], [-2, 20]]) plazaLamp(ctx, lx, lz, base);

  // Seated bronze figure on a stone bench (bottom-left of the reference photo).
  const sx = -22, sz = 21;
  ctx.batch.add(Unit.box, ctx.mats.stone, sx, base + 0.25, sz, 0, 2.2, 0.5, 0.7);
  ctx.batch.add(Unit.box, ctx.mats.bronze, sx + 0.4, base + 0.85, sz - 0.1, 0, 0.5, 0.7, 0.35);
  ctx.batch.add(Unit.box, ctx.mats.bronze, sx + 0.4, base + 1.35, sz - 0.1, 0, 0.26, 0.3, 0.28);
  ctx.batch.add(Unit.box, ctx.mats.bronze, sx + 0.4, base + 0.58, sz + 0.25, 0, 0.45, 0.18, 0.55);
  ctx.batch.add(Unit.box, ctx.mats.bronze, sx + 0.4, base + 0.3, sz + 0.5, 0, 0.45, 0.5, 0.15);
  ctx.collision.addBox(sx, sz, 2.2, 0.8, { top: base + 0.5, mask: Layer.Solid });

  // Flagpoles beside the town hall.
  flag(ctx, 'es', -20.5, base, -20, 9, Math.PI / 2);
  flag(ctx, 'cyl', -22, base, -20, 9, Math.PI / 2);
  flag(ctx, 'eu', -23.5, base, -20, 9, Math.PI / 2);
  for (const fx of [-20.5, -22, -23.5]) ctx.collision.addCircle(fx, -20, 0.12, { top: base + 9, mask: Layer.Bodies });

  // Flower planters.
  for (const [px, pz] of [[-6, 24], [6, 24], [-18, 24], [18, 24]]) {
    ctx.batch.add(Unit.box, ctx.mats.stone, px, base + 0.3, pz, 0, 2.4, 0.6, 0.9);
    ctx.batch.add(Unit.blob, ctx.mats.flowers, px, base + 0.7, pz, 0, 1.1, 0.35, 0.4);
    ctx.collision.addBox(px, pz, 2.4, 0.9, { top: base + 0.6, mask: Layer.Solid });
  }
}

/** Houses flanking the town hall and around the tower inside the plaza block. */
function buildPlazaBlockHouses(ctx: BuildContext): void {
  const B = PLAZA_BLOCK;
  const P = PLAZA;
  building(ctx, P.minX, -40, -19, P.minZ, 'S', { floors: 3, galeria: true });
  building(ctx, 19, -40, P.maxX, P.minZ, 'S', { floors: 3, galeria: true });
  building(ctx, P.minX, B.minZ + 2.5, -16, -44, 'N', { floors: 3 });
  building(ctx, 16, B.minZ + 2.5, P.maxX, -44, 'N', { floors: 3 });
  building(ctx, P.minX, -44, -19, -40, 'W', { floors: 2, galeria: false });
  building(ctx, 19, -44, P.maxX, -40, 'E', { floors: 2, galeria: false });
}

export function buildLandmarks(ctx: BuildContext): void {
  buildAyuntamiento(ctx);
  buildTorre(ctx);
  buildKiosko(ctx);
  buildPlazaDecor(ctx);
  buildPlazaBlockHouses(ctx);
}
