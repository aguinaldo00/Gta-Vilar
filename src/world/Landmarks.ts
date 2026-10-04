import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import { LocalBatch } from './Batcher';
import type { BuildContext } from './context';
import { centroid, orientedBox, toPts } from './geo';
import { beamMatrix, boxGeo, hipRoof, scaleUV } from './geometry';
import type { MapPoi } from './mapData';
import { flag, signBoard, Unit } from './props';
import { signTexture } from './textures';

const BASE = 0.03; // plaza paving level

/**
 * Places a model in its own local frame (front = +Z) at a world position and
 * heading: batched geometry, collision boxes and loose meshes all follow.
 */
class Placer {
  readonly lb: LocalBatch;
  readonly group = new THREE.Group();
  /** World height of the model's origin. */
  readonly y: number;

  constructor(
    private readonly ctx: BuildContext,
    readonly x: number,
    readonly z: number,
    readonly rot: number,
    y = 0,
  ) {
    // `y` is relative to the ground under the model's origin.
    this.y = ctx.terrain.heightAt(x, z) + y;
    this.lb = new LocalBatch(ctx.batch, x, this.y, z, rot);
    this.group.position.set(x, this.y, z);
    this.group.rotation.y = rot;
    ctx.scene.add(this.group);
  }

  add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    ry = 0,
    sx = 1,
    sy = 1,
    sz = 1,
    rx = 0,
    rz = 0,
  ): void {
    this.lb.add(geo, mat, x, y, z, ry, sx, sy, sz, rx, rz);
  }

  box(x: number, z: number, w: number, d: number, o: { rot?: number; top: number; bottom?: number; mask?: number }): void {
    const [wx, wz] = this.lb.point(x, z);
    this.ctx.collision.addBox(wx, wz, w, d, { ...o, rot: (o.rot ?? 0) + this.rot });
  }

  circle(x: number, z: number, r: number, o: { top: number; bottom?: number; mask?: number }): void {
    const [wx, wz] = this.lb.point(x, z);
    this.ctx.collision.addCircle(wx, wz, r, o);
  }
}

/** Heading whose +Z axis points from (x, z) towards (tx, tz). */
function facing(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

function poi(ctx: BuildContext, k: MapPoi['k']): MapPoi | undefined {
  return ctx.map.pois.find((p) => p.k === k);
}

/**
 * Casa Consistorial on its real footprint: arcaded ground floor (soportales),
 * iron balconies, hip roof and the clock gable with the bell cage, facing the
 * Plaza Mayor and the templete (see the reference photos).
 */
function buildAyuntamiento(ctx: BuildContext): void {
  const fp = ctx.map.buildings.find((b) => b.t === 'townhall');
  if (!fp) return;
  const ring = toPts(fp.o);
  const obb = orientedBox(ring);
  const target = poi(ctx, 'bandstand') ?? { x: obb.cx, z: obb.cz + 10 };
  // Pick the OBB side that looks at the plaza as the front (+Z of the model).
  const options = [0, Math.PI, Math.PI / 2, -Math.PI / 2].map((o) => obb.angle + o);
  const toT = [target.x - obb.cx, target.z - obb.cz];
  const rot = options.reduce((best, r) =>
    Math.sin(r) * toT[0] + Math.cos(r) * toT[1] > Math.sin(best) * toT[0] + Math.cos(best) * toT[1] ? r : best,
  );
  const swapped = Math.abs(Math.sin(rot - obb.angle)) > 0.5;
  const w = swapped ? obb.d : obb.w;
  const d = swapped ? obb.w : obb.d;

  const P = new Placer(ctx, obb.cx, obb.cz, rot, BASE);
  const { mats } = ctx;
  const gf = 4.8,
    uf = 5.0;
  const front = d / 2,
    back = -d / 2;
  const arches = Math.max(3, Math.round(w / 6.4) | 1);
  const spacing = w / arches;
  const half = Math.min(2.2, spacing / 2 - 0.65);
  const spring = gf - half - 0.6;
  const archXs = Array.from({ length: arches }, (_, i) => -w / 2 + spacing * (i + 0.5));
  const arcadeDepth = Math.min(4, d * 0.3);

  const coreD = d - arcadeDepth;
  P.add(boxGeo(w, gf, coreD, 2), mats.stone, 0, gf / 2, back + coreD / 2);
  P.box(0, back + coreD / 2, w, coreD, { top: gf + BASE });

  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  for (const ax of archXs) {
    s.lineTo(ax - half, 0);
    s.lineTo(ax - half, spring);
    s.absarc(ax, spring, half, Math.PI, 0, true);
    s.lineTo(ax + half, 0);
  }
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, gf);
  s.lineTo(-w / 2, gf);
  s.closePath();
  const arcade = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 10 });
  scaleUV(arcade, 0.5, 0.5);
  arcade.translate(0, 0, -1);
  P.add(arcade, mats.stone, 0, 0, front);
  const edges = [-w / 2, ...archXs.flatMap((ax) => [ax - half, ax + half]), w / 2];
  for (let i = 0; i < edges.length; i += 2)
    P.box((edges[i] + edges[i + 1]) / 2, front - 0.5, edges[i + 1] - edges[i], 1, { top: gf + BASE });

  const coreFront = back + coreD;
  archXs.forEach((ax, i) => {
    if (i % 2 === 0) P.add(Unit.box, mats.darkWood, ax, 1.6, coreFront + 0.06, 0, 1.9, 3.2, 0.12);
    else P.add(Unit.box, mats.glass, ax, 2.2, coreFront + 0.06, 0, 1.5, 2.0, 0.12);
  });

  const upperY = gf;
  P.add(boxGeo(w, uf, d, 2), mats.stone, 0, upperY + uf / 2, 0);
  P.box(0, 0, w, d, { bottom: upperY + BASE, top: upperY + uf + 4, mask: Layer.Solid });
  P.add(Unit.box, mats.stoneTrim, 0, upperY + 0.15, 0, 0, w + 0.3, 0.35, d + 0.3);
  for (const ax of archXs) {
    P.add(Unit.box, mats.stoneTrim, ax, upperY + 2.1, front + 0.05, 0, 2.0, 3.2, 0.12);
    P.add(Unit.box, mats.glass, ax, upperY + 2.0, front + 0.1, 0, 1.4, 2.7, 0.1);
    P.add(Unit.box, mats.white, ax, upperY + 2.0, front + 0.13, 0, 0.08, 2.7, 0.06);
  }
  for (const side of [-1, 1]) {
    for (const oz of [-d / 4, d / 4]) {
      P.add(Unit.box, mats.stoneTrim, side * (w / 2 + 0.05), upperY + 2.1, oz, 0, 0.12, 3.2, 2.0);
      P.add(Unit.box, mats.glass, side * (w / 2 + 0.1), upperY + 2.0, oz, 0, 0.1, 2.7, 1.4);
    }
  }
  const midW = archXs.length >= 3 ? archXs[archXs.length - 2] - archXs[1] + 2.4 : 3;
  const balconies: [number, number][] = [
    [0, midW],
    [archXs[0], 2.6],
    [archXs[archXs.length - 1], 2.6],
  ];
  for (const [bx, bw] of balconies) {
    P.add(Unit.box, mats.stoneTrim, bx, upperY + 0.42, front + 0.4, 0, bw, 0.16, 0.8);
    P.add(boxGeo(bw, 0.95, 0.04, 2.4, 0.95), mats.ironwork, bx, upperY + 0.98, front + 0.78);
  }

  const topY = upperY + uf;
  P.add(Unit.box, mats.stoneTrim, 0, topY + 0.25, 0, 0, w + 0.8, 0.5, d + 0.8);
  P.add(hipRoof(w, d, Math.min(3.6, d * 0.25), 0.5), mats.roof, 0, topY + 0.5, 0);

  // Clock gable with rounded top and the iron bell cage.
  const gz = front - 0.3,
    gw = 5.2,
    gh = 3.4;
  P.add(boxGeo(gw, gh, 1.2, 2), mats.stone, 0, topY + gh / 2, gz);
  const cap = new THREE.CylinderGeometry(gw / 2, gw / 2, 1.2, 20, 1, false, -Math.PI / 2, Math.PI);
  cap.rotateX(-Math.PI / 2);
  P.add(cap, mats.stone, 0, topY + gh, gz);
  P.add(Unit.box, mats.stoneTrim, 0, topY + gh + 0.05, gz, 0, gw + 0.3, 0.2, 1.4);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), mats.clock);
  // In front of its stone ring (the ring's disc reaches gz + 0.63).
  clock.position.set(0, topY + gh * 0.55, gz + 0.68);
  P.group.add(clock);
  P.add(Unit.cyl16, mats.stoneTrim, 0, topY + gh * 0.55, gz + 0.6, 0, 2.7, 0.12, 2.7, Math.PI / 2);
  const cageBase = topY + gh + gw / 2;
  for (const [lx, lz] of [
    [-0.8, -0.4],
    [0.8, -0.4],
    [0.8, 0.4],
    [-0.8, 0.4],
  ]) {
    P.lb.addMatrix(Unit.cyl, mats.iron, beamMatrix(lx, cageBase - 0.1, gz + lz, 0, cageBase + 2.3, gz, 0.07));
  }
  P.add(Unit.cone, mats.bronze, 0, cageBase + 1.0, gz, 0, 0.8, 0.9, 0.8);
  P.add(Unit.sphere, mats.bronze, 0, cageBase + 0.55, gz, 0, 0.8, 0.3, 0.8);
  P.add(Unit.cyl, mats.iron, 0, cageBase + 2.9, gz, 0, 0.05, 1.3, 0.05);

  // Balcony flags: Spain, Castilla y León, Europe.
  const fy = BASE + upperY + 0.6;
  for (const [kind, ox] of [
    ['es', 0],
    ['cyl', -2.2],
    ['eu', 2.2],
  ] as const) {
    const [fx, fz] = P.lb.point(ox, front + 0.7);
    flag(ctx, kind, fx, P.y + fy, fz, 2.8, rot, 0.45);
  }
}

/** Torre del Corregimiento on its footprint: square stone tower with battlements. */
function buildTorre(ctx: BuildContext): void {
  const fp = ctx.map.buildings.find((b) => b.t === 'torre');
  if (!fp) return;
  const obb = orientedBox(toPts(fp.o));
  const h = (fp.lv ?? 4) * 4.6;
  const P = new Placer(ctx, obb.cx, obb.cz, obb.angle);
  const { mats } = ctx;
  const sw = obb.w,
    sd = obb.d;
  P.add(boxGeo(sw + 0.5, 1.2, sd + 0.5, 2), mats.plinth, 0, 0.6, 0);
  P.add(boxGeo(sw, h, sd, 2), mats.stone, 0, h / 2, 0);
  P.add(boxGeo(sw + 0.7, 0.7, sd + 0.7, 2), mats.stone, 0, h + 0.35, 0);
  const top = h + 0.7;
  const hx = (sw + 0.7) / 2 - 0.3,
    hz = (sd + 0.7) / 2 - 0.3;
  for (let i = 0; i < 6; i++) {
    const tx = -hx + (i * 2 * hx) / 5,
      tz = -hz + (i * 2 * hz) / 5;
    for (const [mx, mz] of [
      [tx, -hz],
      [tx, hz],
      [-hx, tz],
      [hx, tz],
    ])
      P.add(Unit.box, mats.stone, mx, top + 0.55, mz, 0, 0.75, 1.1, 0.75);
  }
  for (const [wy, ww, wh] of [
    [h * 0.4, 0.35, 1.4],
    [h * 0.62, 1.0, 1.8],
    [h * 0.84, 0.35, 1.4],
  ] as const) {
    P.add(Unit.box, mats.glass, 0, wy, sd / 2 + 0.05, 0, ww, wh, 0.1);
    P.add(Unit.box, mats.glass, 0, wy, -sd / 2 - 0.05, 0, ww, wh, 0.1);
    P.add(Unit.box, mats.glass, sw / 2 + 0.05, wy, 0, 0, 0.1, wh, ww);
    P.add(Unit.box, mats.glass, -sw / 2 - 0.05, wy, 0, 0, 0.1, wh, ww);
  }
  P.add(Unit.box, mats.darkWood, 0, 1.7, sd / 2 + 0.05, 0, 1.6, 2.8, 0.1);
  P.add(Unit.cone, mats.darkWood, 0, 3.4, sd / 2 + 0.05, 0, 1.6, 1.0, 0.1);
  P.add(Unit.box, mats.stoneTrim, 0, 5.2, sd / 2 + 0.08, 0, 1.2, 1.5, 0.15);
  P.box(0, 0, sw + 0.5, sd + 0.5, { top: h + 2 });
}

/** The templete (octagonal music kiosk) at its mapped position. */
function buildTemplete(ctx: BuildContext): void {
  const b = poi(ctx, 'bandstand');
  if (!b) return;
  const ring = b.o ? toPts(b.o) : [];
  const radius = ring.length ? ring.reduce((s, [x, z]) => s + Math.hypot(x - b.x, z - b.z), 0) / ring.length : 4.5;
  const townhall = poi(ctx, 'townhall');
  const rot = townhall ? facing(b.x, b.z, townhall.x, townhall.z) : 0;
  const P = new Placer(ctx, b.x, b.z, rot);
  const { mats } = ctx;
  const k = radius / 4.5;
  const Pl = 1.6 * Math.min(1, k + 0.1);
  const oct = (r1: number, r2: number, h: number) => new THREE.CylinderGeometry(r1, r2, h, 8).rotateY(Math.PI / 8);
  P.add(oct(4.3 * k, 4.5 * k, Pl), mats.stone, 0, Pl / 2, 0);
  P.add(oct(4.7 * k, 4.7 * k, 0.22), mats.darkWood, 0, Pl - 0.05, 0);
  const colR = 3.95 * k;
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const px = Math.sin(a) * colR,
      pz = Math.cos(a) * colR;
    P.add(Unit.cyl, mats.darkWood, px, Pl + 1.8, pz, 0, 0.26, 3.6, 0.26);
    P.add(Unit.box, mats.stoneTrim, px, Pl + 0.45, pz, a, 0.38, 0.9, 0.38);
    P.add(Unit.sphere, mats.stoneTrim, px, Pl + 1.05, pz, 0, 0.36, 0.36, 0.36);
    P.circle(px, pz, 0.2, { bottom: Pl, top: Pl + 3.6, mask: Layer.Bodies });
    if (i % 2 === 0) {
      const lx = px + Math.sin(a) * 0.55,
        lz = pz + Math.cos(a) * 0.55;
      P.lb.addMatrix(Unit.cyl, mats.ironGreen, beamMatrix(px, Pl + 2.6, pz, lx, Pl + 2.9, lz, 0.06));
      P.add(Unit.box, mats.lampGlass, lx, Pl + 2.65, lz, a, 0.26, 0.4, 0.26);
      P.add(Unit.cone, mats.ironGreen, lx, Pl + 3.0, lz, 0, 0.45, 0.3, 0.45);
    }
  }
  const apothem = colR * Math.cos(Math.PI / 8);
  const panelW = 2 * colR * Math.sin(Math.PI / 8) - 0.35;
  for (let i = 1; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const px = Math.sin(a) * apothem,
      pz = Math.cos(a) * apothem;
    P.add(boxGeo(panelW, 0.9, 0.04, panelW, 0.9), mats.ironwork, px, Pl + 0.5, pz, a);
    P.add(Unit.box, mats.ironGreen, px, Pl + 0.97, pz, a, panelW, 0.06, 0.08);
    P.box(px, pz, panelW + 0.4, 0.2, { rot: a, bottom: Pl, top: Pl + 1.0, mask: Layer.Player });
  }
  P.add(oct(5.3 * k, 5.3 * k, 0.3), mats.darkWood, 0, Pl + 3.7, 0);
  P.add(new THREE.ConeGeometry(5.6 * k, 1.6, 8).rotateY(Math.PI / 8), mats.roof, 0, Pl + 4.65, 0);
  P.add(oct(1.1, 1.1, 0.9), mats.darkWood, 0, Pl + 5.6, 0);
  P.add(new THREE.ConeGeometry(1.5, 0.6, 8).rotateY(Math.PI / 8), mats.roof, 0, Pl + 6.3, 0);
  P.circle(0, 0, 4.25 * k, { top: Pl, mask: Layer.Solid });
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const top = Pl - (Pl / (steps + 1)) * (i + 1);
    const sz = 4.4 * k + i * 0.6;
    P.add(boxGeo(2.6, top, 0.6, 1), mats.stone, 0, top / 2, sz);
    P.box(0, sz, 2.6, 0.6, { top, mask: Layer.Solid });
  }
}

/** Fuente de la plaza: round basin with a tiered central column. */
function buildFountain(ctx: BuildContext): void {
  const f = poi(ctx, 'fountain');
  if (!f) return;
  const ring = f.o ? toPts(f.o) : [];
  const r = ring.length ? ring.reduce((s, [x, z]) => s + Math.hypot(x - f.x, z - f.z), 0) / ring.length : 4;
  const h = f.ht ?? 4;
  const P = new Placer(ctx, f.x, f.z, 0);
  const { mats } = ctx;
  P.add(new THREE.CylinderGeometry(r, r + 0.15, 0.7, 24, 1, true), mats.stone, 0, 0.35, 0);
  P.add(new THREE.CylinderGeometry(r - 0.35, r - 0.35, 0.7, 24, 1, true), mats.stone, 0, 0.35, 0);
  P.add(new THREE.RingGeometry(r - 0.35, r, 24).rotateX(-Math.PI / 2), mats.stoneTrim, 0, 0.71, 0);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(r - 0.35, 24).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#4a9ab0' }),
  );
  water.position.y = 0.55;
  P.group.add(water);
  P.add(Unit.cyl, mats.stone, 0, h * 0.4, 0, 0, 0.6, h * 0.8, 0.6);
  P.add(new THREE.CylinderGeometry(1.4, 0.4, 0.4, 16), mats.stone, 0, h * 0.45, 0);
  P.add(new THREE.CylinderGeometry(0.8, 0.25, 0.3, 16), mats.stone, 0, h * 0.75, 0);
  P.add(Unit.sphere, mats.stoneTrim, 0, h * 0.85, 0, 0, 0.5, 0.5, 0.5);
  P.circle(0, 0, r, { top: 0.7, mask: Layer.Solid });
}

/** "Al músico": seated bronze figure on a bench (the statue in the plaza photo). */
function buildStatue(ctx: BuildContext): void {
  const s = poi(ctx, 'statue');
  if (!s) return;
  const b = poi(ctx, 'bandstand');
  const P = new Placer(ctx, s.x, s.z, b ? facing(s.x, s.z, b.x, b.z) : 0, BASE);
  const { mats } = ctx;
  P.add(Unit.box, mats.iron, 0, 0.45, 0, 0, 1.9, 0.08, 0.55);
  P.add(Unit.box, mats.iron, 0, 0.75, -0.25, 0, 1.9, 0.5, 0.06);
  for (const k of [-0.8, 0.8]) P.add(Unit.box, mats.iron, k, 0.22, 0, 0, 0.08, 0.45, 0.5);
  P.add(Unit.box, mats.bronze, 0.35, 0.82, -0.08, 0, 0.5, 0.68, 0.32);
  P.add(Unit.box, mats.bronze, 0.35, 1.32, -0.08, 0, 0.26, 0.3, 0.28);
  P.add(Unit.box, mats.bronze, 0.35, 0.56, 0.22, 0, 0.45, 0.16, 0.5);
  P.add(Unit.box, mats.bronze, 0.35, 0.28, 0.45, 0, 0.45, 0.5, 0.14);
  P.add(Unit.box, mats.bronze, -0.2, 0.7, 0.12, 0.4, 0.15, 0.6, 0.22);
  P.box(0, 0, 1.9, 0.6, { top: 0.5 + BASE, mask: Layer.Solid });
}

function buildBellTowers(ctx: BuildContext): void {
  const { mats } = ctx;
  const marina = ctx.map.buildings.filter((b) => b.n === 'Iglesia de Santa Marina').map((b) => centroid(toPts(b.o)));
  for (const t of ctx.map.pois.filter((p) => p.k === 'belltower')) {
    // Santa Marina's concrete campanile is modelled with the church (Churches.ts).
    if (marina.some(([x, z]) => Math.hypot(x - t.x, z - t.z) < 45)) continue;
    const h = t.ht || 20;
    const P = new Placer(ctx, t.x, t.z, 0);
    P.add(boxGeo(4.2, h, 4.2, 2), mats.stone, 0, h / 2, 0);
    for (const [ox, oz, ry] of [
      [0, 2.12, 0],
      [0, -2.12, 0],
      [2.12, 0, Math.PI / 2],
      [-2.12, 0, Math.PI / 2],
    ] as const) {
      P.add(Unit.box, mats.glass, ox, h - 2.2, oz, ry, 1.4, 2.2, 0.1);
    }
    P.add(new THREE.ConeGeometry(3.2, 2.6, 4).rotateY(Math.PI / 4), mats.roof, 0, h + 1.3, 0);
    P.add(Unit.cyl, mats.iron, 0, h + 3.2, 0, 0, 0.06, 1.4, 0.06);
    P.box(0, 0, 4.2, 4.2, { top: h + 2 });
  }
}

/** Mikado steam locomotive preserved at the old Horna-Villarcayo station, on a short stretch of track. */
function buildMikado(ctx: BuildContext): void {
  const l = poi(ctx, 'locomotive');
  if (!l) return;
  const hit = ctx.roads.nearest(l.x, l.z, 80, (r) => r.k === 'viaverde');
  const rot = hit ? Math.atan2(hit.dx, hit.dz) : 0;
  const P = new Placer(ctx, l.x, l.z, rot);
  const { mats } = ctx;
  const black = new THREE.MeshStandardMaterial({ color: '#1f2022' });
  const red = mats.redPaint;
  P.add(boxGeo(3.4, 0.3, 26, 2), mats.gravel, 0, 0.15, 0);
  for (let z = -12.6; z <= 12.6; z += 0.75) P.add(Unit.box, mats.sleeper, 0, 0.36, z, 0, 2.4, 0.12, 0.24);
  for (const s of [-0.5, 0.5]) P.add(Unit.box, mats.rail, s, 0.47, 0, 0, 0.08, 0.14, 26);
  const y0 = 0.55;
  P.add(Unit.cyl16, black, 0, y0 + 1.75, 1.4, 0, 1.7, 7.4, 1.7, Math.PI / 2);
  P.add(Unit.cyl16, new THREE.MeshStandardMaterial({ color: '#2b2c2f' }), 0, y0 + 1.75, 5.15, 0, 1.75, 0.3, 1.75, Math.PI / 2);
  P.add(Unit.cyl, black, 0, y0 + 2.95, 4.2, 0, 0.45, 0.9, 0.45);
  P.add(Unit.cyl, black, 0, y0 + 2.75, 1.6, 0, 0.75, 0.6, 0.75);
  P.add(Unit.cyl, black, 0, y0 + 2.7, -0.4, 0, 0.6, 0.5, 0.6);
  P.add(Unit.box, black, 0, y0 + 2.05, -3.4, 0, 2.6, 2.6, 2.6);
  P.add(Unit.box, black, 0, y0 + 3.45, -3.4, 0, 2.9, 0.15, 2.9);
  P.add(Unit.box, mats.glass, 1.31, y0 + 2.5, -3.2, 0, 0.04, 0.8, 1.0);
  P.add(Unit.box, mats.glass, -1.31, y0 + 2.5, -3.2, 0, 0.04, 0.8, 1.0);
  P.add(Unit.box, red, 0, y0 + 0.75, 0.5, 0, 2.2, 0.25, 11);
  P.add(Unit.box, red, 0, y0 + 0.6, 5.9, 0, 2.6, 0.5, 0.25);
  P.add(Unit.box, black, 0, y0 + 1.6, -8.2, 0, 2.6, 2.2, 5.8);
  for (const side of [-0.9, 0.9]) {
    for (const z of [-1.6, 0.05, 1.7, 3.35]) P.add(Unit.cyl16, red, side, y0 + 0.7, z, 0, 1.4, 0.12, 1.4, 0, Math.PI / 2);
    P.add(Unit.cyl16, red, side, y0 + 0.4, 4.9, 0, 0.75, 0.1, 0.75, 0, Math.PI / 2);
    P.add(Unit.cyl16, red, side, y0 + 0.4, -2.6, 0, 0.75, 0.1, 0.75, 0, Math.PI / 2);
    P.add(Unit.box, mats.iron, side * 1.06, y0 + 0.75, 0.9, 0, 0.06, 0.12, 5.3);
    for (const z of [-6.5, -9.9]) P.add(Unit.cyl16, red, side, y0 + 0.4, z, 0, 0.8, 0.1, 0.8, 0, Math.PI / 2);
  }
  P.add(Unit.box, mats.lampGlass, 0, y0 + 2.9, 5.35, 0, 0.35, 0.35, 0.2);
  P.box(0, -1.4, 3, 16, { top: 4.5 });
  signBoard(
    ctx,
    signTexture('LOCOMOTORA MIKADO', '#20304a', '#f2ecdc', 640, 96),
    ...P.lb.point(3.2, 2),
    P.y,
    rot + Math.PI / 2,
    3.6,
    0.6,
    0.9,
  );
}

/** Name board of the old Horna-Villarcayo station, facing the Vía Verde. */
function buildStationSign(ctx: BuildContext): void {
  const st = ctx.map.buildings.find((b) => b.t === 'station');
  if (!st) return;
  const [cx, cz] = centroid(toPts(st.o));
  const hit = ctx.roads.nearest(cx, cz, 80, (r) => r.k === 'viaverde');
  if (!hit) return;
  const mx = cx + (hit.x - cx) * 0.6,
    mz = cz + (hit.z - cz) * 0.6;
  const rot = facing(mx, mz, hit.x, hit.z);
  signBoard(ctx, signTexture('VILLARCAYO', '#f2ecdc', '#20304a'), mx, mz, ctx.terrain.heightAt(mx, mz), rot, 4.2, 0.8, 1.8);
}

export function buildLandmarks(ctx: BuildContext): void {
  buildAyuntamiento(ctx);
  buildTorre(ctx);
  buildTemplete(ctx);
  buildFountain(ctx);
  buildStatue(ctx);
  buildBellTowers(ctx);
  buildMikado(ctx);
  buildStationSign(ctx);
}
