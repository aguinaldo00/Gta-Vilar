import * as THREE from 'three';
import { Layer } from '../physics/CollisionWorld';
import { LocalBatch } from './Batcher';
import type { BuildContext } from './context';
import { type Pt, centroid, hash01, orientedBox, pointInRing, toPts } from './geo';
import { MAP } from './mapData';
import { Unit } from './props';
import { VEHICLE_ROADS } from './Roads';
import { fenceMaterial } from './Sports';

/** Buildings drawn here instead of by the generic extruder. */
export const CUSTOM_FACILITIES = /^(Polideportivo de Villarcayo)$/;

const CAR_COLOURS = ['#e9e9e6', '#e9e9e6', '#b9bcbf', '#8c9095', '#2a2c30', '#1f2f4f', '#7a1d1d', '#c8b99a', '#3d4f3a', '#e9e9e6', '#5c6670'];

/** Parked car (batched boxes): body, cabin, glass, wheels. Local +Z = nose. */
function parkedCar(ctx: BuildContext, x: number, z: number, rot: number, seed: number): void {
  const lb = new LocalBatch(ctx.batch, x, ctx.terrain.heightAt(x, z), z, rot);
  const { mats } = ctx;
  const paint = mats.tint(CAR_COLOURS[Math.floor(hash01(seed, 3.1) * CAR_COLOURS.length)]);
  const van = hash01(seed, 9.7) < 0.15;
  const L = van ? 4.7 : 4.2 + hash01(seed) * 0.4, W = 1.78;
  lb.add(Unit.box, paint, 0, 0.62, 0, 0, W, 0.55, L);
  if (van) {
    lb.add(Unit.box, paint, 0, 1.35, -0.35, 0, W - 0.04, 0.95, L - 1.0);
    lb.add(Unit.box, mats.glass, 0, 1.4, L / 2 - 0.88, 0, W - 0.1, 0.6, 0.06, -0.35);
  } else {
    lb.add(Unit.box, paint, 0, 1.12, -0.2, 0, W - 0.12, 0.48, L * 0.5);
    lb.add(Unit.box, mats.glass, 0, 1.12, -0.2, 0, W - 0.08, 0.38, L * 0.5 + 0.06);
  }
  const tyre = mats.tint('#1b1b1b');
  for (const sz of [-1, 1]) lb.add(Unit.box, tyre, 0, 0.32, sz * (L / 2 - 0.75), 0, W - 0.02, 0.62, 0.62); // wheel pairs
  lb.add(Unit.box, mats.glow('#ffe9c0'), 0, 0.72, L / 2 + 0.005, 0, W - 0.4, 0.1, 0.02);
  lb.add(Unit.box, mats.tint('#8a1010'), 0, 0.75, -L / 2 - 0.005, 0, W - 0.3, 0.12, 0.02);
  ctx.collision.addBox(x, z, W, L, { rot, top: 1.5 });
}

/**
 * Car parks: painted bays laid out along the long axis of each mapped
 * parking (perpendicular rows with aisles, or a single parallel row for
 * street-side lanes), most of them occupied by parked cars.
 */
function carParks(ctx: BuildContext): void {
  const line = ctx.mats.tint('#ecebe4');
  let seed = 1;
  for (const a of MAP.areas) {
    if (a.k !== 'parking') continue;
    const ring = toPts(a.o);
    const o = orientedBox(ring);
    let rot = o.angle, L = o.w, W = o.d;
    if (W > L) { rot += Math.PI / 2; [L, W] = [W, L]; }
    if (L * W > 20000) continue;
    const lb = new LocalBatch(ctx.batch, o.cx, 0, o.cz, rot);
    const inside = (lx: number, lz: number) => {
      const [x, z] = lb.point(lx, lz);
      return pointInRing(x, z, ring);
    };
    const clearOfRoads = (lx: number, lz: number) => {
      const [x, z] = lb.point(lx, lz);
      const r = ctx.roads.nearest(x, z, 4, (rd) => VEHICLE_ROADS.has(rd.k) && rd.k !== 'service');
      return !r || r.d > 0.6;
    };
    const parallel = a.s === 'parallel' || (W < 4.6 && a.s !== 'perpendicular' && a.s !== 'diagonal');
    // Rows across W: each row is [bays 5 m][aisle 6 m] pairs facing each other.
    const rows: { z: number; dir: number }[] = [];
    if (parallel) rows.push({ z: 0, dir: 0 });
    else if (W < 11) rows.push({ z: -W / 2 + 2.6, dir: 1 });
    else for (let z = -W / 2 + 2.6; z + 2.5 <= W / 2; z += 16) {
      rows.push({ z, dir: 1 });
      if (z + 11 + 2.5 <= W / 2) rows.push({ z: z + 11, dir: -1 });
    }
    const pitch = parallel ? 6 : 2.5;
    for (const row of rows) {
      for (let x = -L / 2 + pitch / 2; x <= L / 2 - pitch / 2; x += pitch) {
        const hw = parallel ? 2.9 : 1.2, hd = parallel ? 1.1 : 2.4;
        if (![[x - hw, row.z - hd], [x + hw, row.z - hd], [x - hw, row.z + hd], [x + hw, row.z + hd]].every(([px, pz]) => inside(px, pz))) continue;
        if (!clearOfRoads(x, row.z)) continue;
        // Bay lines.
        if (parallel) lb.add(Unit.box, line, x - pitch / 2, 0.035, row.z, 0, 0.1, 0.02, 2.2);
        else lb.add(Unit.box, line, x - pitch / 2, 0.035, row.z, 0, 0.1, 0.02, 5);
        seed++;
        if (hash01(seed, 0.37) < (ctx.quality.detail ? 0.32 : 0.55)) continue;
        const [wx, wz] = lb.point(x + (hash01(seed, 5) - 0.5) * 0.3, row.z);
        const heading = parallel ? rot + Math.PI / 2 + (hash01(seed, 7) < 0.5 ? 0 : Math.PI) : rot + (row.dir > 0 ? Math.PI : 0) + (hash01(seed, 2) - 0.5) * 0.08;
        parkedCar(ctx, wx, wz, heading, seed);
      }
    }
  }
}

/** Walls of a ring between y0 and y1 (outward faces), world-scaled UVs. */
function ringWalls(ring: Pt[], y0: number, y1: number, tile: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [];
  let u = 0;
  const ccw = ring.reduce((s, p, i) => s + (ring[(i + 1) % ring.length][0] - p[0]) * (ring[(i + 1) % ring.length][1] + p[1]), 0) < 0;
  for (let i = 0; i < ring.length; i++) {
    let a = ring[i], b = ring[(i + 1) % ring.length];
    if (!ccw) [a, b] = [b, a];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const q = [[a[0], y0, a[1], u, y0], [b[0], y0, b[1], u + len, y0], [b[0], y1, b[1], u + len, y1], [a[0], y1, a[1], u, y1]];
    for (const k of [0, 2, 1, 0, 3, 2]) {
      pos.push(q[k][0], q[k][1], q[k][2]);
      uv.push(q[k][3] / tile, q[k][4] / tile);
    }
    u += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Polideportivo: brick plinth, ribbed metal cladding, high clerestory, barrel-vault roof and its sign. */
function polideportivo(ctx: BuildContext, sign: (text: string, bg: string, fg: string) => THREE.BufferGeometry, signMat: THREE.Material): void {
  const b = MAP.buildings.find((x) => x.n === 'Polideportivo de Villarcayo');
  if (!b) return;
  const ring = toPts(b.o);
  const { mats, batch } = ctx;
  const H = 9.5;
  batch.addWorld(ringWalls(ring, 0, 3.2, 2), mats.tint('#b5664a'));
  batch.addWorld(ringWalls(ring, 3.2, 3.4, 2), mats.tint('#d9d5cc'));
  batch.addWorld(ringWalls(ring, 3.4, H - 1.6, 1.2), mats.tint('#c9ced1'));
  batch.addWorld(ringWalls(ring, H - 1.6, H, 2), mats.glass);
  const o = orientedBox(ring);
  let rot = o.angle, L = o.w, W = o.d;
  if (W > L) { rot += Math.PI / 2; [L, W] = [W, L]; }
  const lb = new LocalBatch(batch, o.cx, 0, o.cz, rot);
  const rise = Math.min(4, W * 0.15), R = (W * W) / 4 / (2 * rise) + rise / 2, th = 2 * Math.asin(W / 2 / R);
  const vault = new THREE.CylinderGeometry(R, R, L + 0.8, 24, 1, true, -th / 2, th);
  vault.rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
  lb.add(vault, mats.tint('#a9b1b6'), 0, H + rise - R, 0);
  lb.add(Unit.box, mats.tint('#d9d5cc'), 0, H, 0, 0, L + 0.4, 0.25, W + 0.4);
  // Name over the entrance on the long side facing the street.
  const c = centroid(ring);
  const road = ctx.roads.nearest(c[0], c[1], 80, (r) => VEHICLE_ROADS.has(r.k));
  const side = road && ((road.x - o.cx) * Math.sin(rot) + (road.z - o.cz) * Math.cos(rot)) < 0 ? -1 : 1;
  const sz = side * (W / 2 + 0.25);
  lb.addMatrix(sign('POLIDEPORTIVO MUNICIPAL', '#1d4e89', '#ffffff'), signMat,
    new THREE.Matrix4().makeRotationY(side > 0 ? 0 : Math.PI).setPosition(0, 4.6, sz).multiply(new THREE.Matrix4().makeScale(8, 1, 1)));
  lb.add(Unit.box, mats.glass, 0, 1.3, sz, 0, 4, 2.6, 0.12);
  lb.add(Unit.box, mats.tint('#d9d5cc'), 0, 3.0, sz + side * 1.2, 0, 6, 0.3, 2.6);
  ctx.collision.addBox(o.cx, o.cz, L, W, { rot, top: H + rise });
}

/** Fence around the sports grounds, with gaps where paths and roads come in. */
function sportsFences(ctx: BuildContext): void {
  const fence = fenceMaterial();
  const post = ctx.mats.tint('#2f4a3a');
  for (const a of MAP.areas) {
    if (a.k !== 'sports' || !a.n || !/Polideportivo|Piscinas/.test(a.n)) continue;
    const ring = toPts(a.o);
    const h = 2.2;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const r = ctx.roads.nearest(mx, mz, 3);
        if (r && r.d < 1) continue;
        const seg = len / n, ang = Math.atan2(-(z1 - z0), x1 - x0);
        const g = new THREE.PlaneGeometry(1, 1);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * seg * 2, uv.getY(j) * h * 2);
        ctx.batch.add(g, fence, mx, h / 2, mz, ang, seg, h, 1);
        ctx.batch.add(Unit.box, post, x0, h / 2, z0, 0, 0.06, h, 0.06);
        ctx.collision.addBox(mx, mz, seg, 0.15, { rot: ang, top: h, mask: Layer.Bodies });
      }
    }
  }
}

/** Estación de Servicio Rivera: canopy, pump islands, price totem. */
function gasolinera(ctx: BuildContext, sign: (text: string, bg: string, fg: string) => THREE.BufferGeometry, signMat: THREE.Material): void {
  const p = MAP.pois.find((x) => x.k === 'fuel');
  if (!p) return;
  const road = ctx.roads.nearest(p.x, p.z, 60, (r) => VEHICLE_ROADS.has(r.k));
  const rot = road ? Math.atan2(road.dx, road.dz) + Math.PI / 2 : 0; // local +Z towards the road side
  // Canopy on the forecourt: the first spot beside the road, clear of streets and buildings.
  let cx = p.x, cz = p.z;
  if (road) {
    const nx0 = p.x - road.x, nz0 = p.z - road.z;
    const d = Math.hypot(nx0, nz0) || 1;
    const nx = nx0 / d, nz = nz0 / d, tx = -nz, tz = nx;
    const near = MAP.buildings.filter((b) => Math.hypot(b.o[0] - p.x, b.o[1] - p.z) < 80).map((b) => toPts(b.o));
    const free = (x: number, z: number) => {
      const r = ctx.roads.nearest(x, z, 3, (rd) => VEHICLE_ROADS.has(rd.k));
      return (!r || r.d > 0.5) && !near.some((ring) => pointInRing(x, z, ring));
    };
    for (let off = road.road.w / 2 + 5.5; off < road.road.w / 2 + 30; off += 1.5) {
      for (const slide of [0, 6, -6, 12, -12]) {
        const x = road.x + nx * off + tx * slide, z = road.z + nz * off + tz * slide;
        const corners = [[-8, -4.5], [8, -4.5], [-8, 4.5], [8, 4.5], [0, 0]].map(([a, b]) => [x + tx * a + nx * b, z + tz * a + nz * b]);
        if (corners.every(([qx, qz]) => free(qx, qz))) { cx = x; cz = z; off = Infinity; break; }
      }
    }
  }
  const face = road ? Math.atan2(road.x - cx, road.z - cz) : rot;
  const lb = new LocalBatch(ctx.batch, cx, 0, cz, face);
  const { mats } = ctx;
  const white = mats.tint('#f2f2ee');
  lb.add(Unit.box, white, 0, 5.4, 0, 0, 16, 0.5, 9);
  lb.add(Unit.box, mats.tint('#c8102e'), 0, 5.0, 4.52, 0, 16, 0.35, 0.04);
  lb.add(Unit.box, mats.tint('#c8102e'), 0, 5.0, -4.52, 0, 16, 0.35, 0.04);
  lb.add(Unit.box, mats.glow('#fff6e0'), 0, 5.13, 0, 0, 15, 0.02, 8);
  lb.addMatrix(sign('RIVERA', '#ffffff', '#c8102e'), signMat, new THREE.Matrix4().makeScale(5, 0.62, 1).setPosition(0, 5.45, 4.53));
  for (const x of [-4, 4]) {
    lb.add(Unit.box, mats.tint('#d8d8d2'), x, 0.1, 0, 0, 1.4, 0.2, 6);
    lb.add(Unit.box, white, x, 2.8, 0, 0, 0.35, 5.2, 0.35);
    for (const z of [-1.8, 1.8]) {
      lb.add(Unit.box, white, x, 1.0, z, 0, 0.6, 1.8, 0.9);
      lb.add(Unit.box, mats.glow('#9fd3ff'), x + 0.31, 1.4, z, 0, 0.02, 0.3, 0.5);
      lb.add(Unit.box, mats.tint('#c8102e'), x, 1.85, z, 0, 0.62, 0.1, 0.92);
      lb.add(Unit.box, mats.tint('#222'), x + 0.32, 0.9, z + 0.3, 0, 0.06, 0.6, 0.06);
    }
    const [wx, wz] = lb.point(x, 0);
    ctx.collision.addBox(wx, wz, 1.4, 6, { rot: face, top: 2 });
  }
  // Price totem by the road.
  lb.add(Unit.box, white, -9.5, 3, 4, 0, 0.5, 6, 1.6);
  lb.addMatrix(sign('RIVERA', '#c8102e', '#ffffff'), signMat, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(-9.24, 5.3, 4).multiply(new THREE.Matrix4().makeScale(1.5, 0.19, 1)));
  for (let k = 0; k < 3; k++) lb.add(Unit.box, mats.glow('#ffb52e'), -9.24, 4.3 - k * 0.6, 4, 0, 0.02, 0.4, 1.2);
  const [tx, tz] = lb.point(-9.5, 4);
  ctx.collision.addBox(tx, tz, 0.5, 1.6, { rot: face, top: 6 });
}

/** Bus: white coach with the blue band, parked at a bay. */
function bus(ctx: BuildContext, lb: LocalBatch, x: number, z: number, ry: number): void {
  const { mats } = ctx;
  const body = mats.tint('#f0f0ec');
  const o = new THREE.Object3D();
  o.position.set(x, 0, z);
  o.rotation.y = ry;
  o.updateMatrix();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, sx: number, sy: number, sz: number) =>
    lb.addMatrix(geo, mat, o.matrix.clone().multiply(new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(px, py, pz)));
  add(Unit.box, body, 0, 1.9, 0, 2.5, 2.9, 12);
  add(Unit.box, mats.glass, 0, 2.4, 0, 2.54, 1.0, 11.2);
  add(Unit.box, mats.glass, 0, 2.1, 6.01, 2.3, 1.6, 0.04);
  add(Unit.box, mats.tint('#1d4e89'), 0, 1.35, 0, 2.55, 0.35, 12.02);
  for (const sz of [-3.8, 4]) for (const sx of [-1.15, 1.15]) {
    lb.addMatrix(Unit.cyl, mats.tint('#1b1b1b'), o.matrix.clone().multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(sx, 0.5, sz).multiply(new THREE.Matrix4().makeScale(1, 0.3, 1))));
  }
  const [wx, wz] = lb.point(x, z);
  ctx.collision.addBox(wx, wz, 2.5, 12, { rot: lb.rot + ry, top: 3.4 });
}

/** Estación de Autobuses: platform canopy, benches, bays and a coach; shelters at the other stops. */
function busStations(ctx: BuildContext, sign: (text: string, bg: string, fg: string) => THREE.BufferGeometry, signMat: THREE.Material): void {
  const { mats } = ctx;
  for (const a of MAP.areas) {
    if (a.k !== 'busstation') continue;
    const ring = toPts(a.o);
    const o = orientedBox(ring);
    let rot = o.angle, L = o.w, W = o.d;
    if (W > L) { rot += Math.PI / 2; [L, W] = [W, L]; }
    const lb = new LocalBatch(ctx.batch, o.cx, 0, o.cz, rot);
    const cl = Math.min(L - 2, 30);
    const z0 = -W / 2 + 2.5;
    lb.add(Unit.box, mats.tint('#cfcac0'), 0, 0.09, z0, 0, cl, 0.18, 4);
    lb.add(Unit.box, mats.tint('#5d6369'), 0, 3.4, z0, 0, cl + 0.6, 0.25, 4.6);
    for (let x = -cl / 2 + 1; x <= cl / 2 - 1; x += 5) {
      lb.add(Unit.box, mats.tint('#3a4a5a'), x, 1.7, z0 - 1.6, 0, 0.18, 3.4, 0.18);
      lb.add(Unit.box, mats.wood, x + 2.5, 0.65, z0 - 1.2, 0, 1.8, 0.08, 0.45);
    }
    lb.addMatrix(sign('ESTACIÓN DE AUTOBUSES', '#1d4e89', '#ffffff'), signMat, new THREE.Matrix4().makeScale(6, 0.75, 1).setPosition(0, 3.95, z0 + 2.31));
    lb.add(Unit.box, mats.tint('#1d4e89'), 0, 3.95, z0 + 2.28, 0, 6.1, 0.8, 0.04);
    for (let x = -cl / 2; x <= cl / 2; x += 4) lb.add(Unit.box, mats.tint('#e5b31a'), x, 0.035, z0 + 5, 0, 0.12, 0.02, 6);
    if (W > 12) bus(ctx, lb, -cl / 4, z0 + 5.2, Math.PI / 2);
    const [wx, wz] = lb.point(0, z0);
    ctx.collision.addBox(wx, wz, cl, 4, { rot, top: 0.2, mask: Layer.Bodies });
  }
  for (const p of MAP.pois) {
    if (p.k !== 'bus_stop') continue;
    const road = ctx.roads.nearest(p.x, p.z, 30, (r) => VEHICLE_ROADS.has(r.k));
    const face = road ? Math.atan2(road.x - p.x, road.z - p.z) : 0;
    const lb = new LocalBatch(ctx.batch, p.x, 0, p.z, face);
    lb.add(Unit.box, mats.tint('#5d6369'), 0, 2.5, 0, 0, 3.6, 0.12, 1.6);
    lb.add(Unit.box, mats.glass, 0, 1.25, -0.75, 0, 3.4, 2.3, 0.05);
    for (const x of [-1.75, 1.75]) lb.add(Unit.box, mats.glass, x, 1.25, 0, 0, 0.05, 2.3, 1.5);
    lb.add(Unit.box, mats.wood, 0, 0.5, -0.45, 0, 2.6, 0.06, 0.4);
    ctx.collision.addBox(p.x, p.z, 3.6, 1.6, { rot: face, top: 2.5, mask: Layer.Bodies });
  }
}

/**
 * Public facilities with their own look: the polideportivo, the petrol
 * station, the bus station, car parks full of parked cars and the fences
 * of the sports grounds.
 */
export function buildFacilities(ctx: BuildContext, sign: (text: string, bg: string, fg: string) => THREE.BufferGeometry, signMat: THREE.Material): void {
  polideportivo(ctx, sign, signMat);
  gasolinera(ctx, sign, signMat);
  busStations(ctx, sign, signMat);
  carParks(ctx);
  sportsFences(ctx);
}

