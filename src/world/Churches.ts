import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import { LocalBatch } from './Batcher';
import type { BuildContext } from './context';
import { centroid, orientedBox, type Pt, signedArea, toPts } from './geo';
import { beamMatrix, boxGeo } from './geometry';
import type { MapBuilding } from './mapData';
import { Unit } from './props';

/** Buildings drawn by this module instead of the generic extruder. */
export const CUSTOM_CHURCHES = /^(Iglesia de Santa Marina|Ermita de San Roque|Ermita de San Vicente)$/;

/** Triangles → non-indexed geometry with planar UVs (metres / tile). */
function tris(points: number[][], tile = 2): THREE.BufferGeometry {
  const pos: number[] = [],
    uv: number[] = [];
  for (let i = 0; i < points.length; i += 3) {
    const [a, b, c] = [points[i], points[i + 1], points[i + 2]];
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
    );
    const ax = Math.abs(n.x) > Math.abs(n.z) ? 'x' : 'z';
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      if (Math.abs(n.y) > Math.max(Math.abs(n.x), Math.abs(n.z))) uv.push(p[0] / tile, p[2] / tile);
      else uv.push((ax === 'x' ? p[2] : p[0]) / tile, p[1] / tile);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Gable roof over a L x W rectangle (ridge along X), slopes only; UVs run down the slope. */
function gableSlopes(L: number, W: number, eave: number, ridge: number, over = 0.5): THREE.BufferGeometry {
  const x0 = -L / 2 - over,
    x1 = L / 2 + over,
    z = W / 2 + over;
  const drop = ((ridge - eave) * over) / (W / 2);
  const e = eave - drop;
  const pos = [
    [x0, e, z],
    [x1, e, z],
    [x1, ridge, 0],
    [x0, e, z],
    [x1, ridge, 0],
    [x0, ridge, 0],
    [x1, e, -z],
    [x0, e, -z],
    [x0, ridge, 0],
    [x1, e, -z],
    [x0, ridge, 0],
    [x1, ridge, 0],
  ];
  const slope = Math.hypot(z, ridge - e);
  const g = tris(pos);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < 12; i++) uv.setXY(i, pos[i][0] / 2, (pos[i][1] === ridge ? slope : 0) / 2);
  return g;
}

/** Gable-end triangle at x, facing ±X. */
function gableEnd(x: number, W: number, eave: number, ridge: number, dir: 1 | -1): THREE.BufferGeometry {
  const a = [x, eave, -W / 2],
    b = [x, eave, W / 2],
    c = [x, ridge, 0];
  return tris(dir > 0 ? [a, c, b] : [a, b, c]);
}

/** Frame: local +X along the long axis, +X end is the front (towards `front`). */
function frame(ctx: BuildContext, ring: Pt[], front: Pt): { lb: LocalBatch; L: number; W: number; rot: number; cx: number; cz: number } {
  const o = orientedBox(ring);
  let rot = o.angle,
    L = o.w,
    W = o.d;
  if (W > L) {
    rot += Math.PI / 2;
    [L, W] = [W, L];
  }
  // Local +X in world is (cos rot, -sin rot); flip if the front lies behind.
  if ((front[0] - o.cx) * Math.cos(rot) - (front[1] - o.cz) * Math.sin(rot) < 0) rot += Math.PI;
  return { lb: new LocalBatch(ctx.batch, o.cx, 0, o.cz, rot), L, W, rot, cx: o.cx, cz: o.cz };
}

function solid(ctx: BuildContext, f: { lb: LocalBatch; rot: number }, x: number, z: number, w: number, d: number, top: number): void {
  const [wx, wz] = f.lb.point(x, z);
  ctx.collision.addBox(wx, wz, w, d, { rot: f.rot, top, mask: Layer.Solid });
}

/** Lattice of concrete with coloured glass (the 1968 stained glass of the gable). */
function vidrieraTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8d4cb';
  g.fillRect(0, 0, 256, 256);
  const colors = ['#1f4fa8', '#c0392b', '#e5b31a', '#2e8b57', '#6a3d9a', '#e67e22', '#3aa0d8'];
  let s = 3;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      g.fillStyle = colors[Math.floor(rnd() * colors.length)];
      g.fillRect(x * 32 + 5, y * 32 + 5, 22, 22);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x * 32 + 5, y * 32 + 5, 22, 6);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Iglesia de Santa Marina (José Luis Gutiérrez, 1967): a huge "tent" —
 * two steep roof planes almost down to the ground, the gables closed by a
 * concrete lattice holding the coloured glass, and a free-standing concrete
 * campanile crowned by three crosses.
 */
function santaMarina(ctx: BuildContext): void {
  const parts = ctx.map.buildings.filter((b) => b.n === 'Iglesia de Santa Marina' && b.part);
  if (!parts.length) return;
  const area = (b: MapBuilding) => Math.abs(signedArea(toPts(b.o)));
  parts.sort((a, b) => area(b) - area(a));
  const nave = toPts(parts[0].o);
  const porch = parts[1] ? centroid(toPts(parts[1].o)) : null;
  const tower = ctx.map.pois.find((p) => p.k === 'belltower' && Math.hypot(p.x - centroid(nave)[0], p.z - centroid(nave)[1]) < 40);
  const f = frame(ctx, nave, porch ?? (tower ? [tower.x, tower.z] : centroid(nave)));
  const { lb, L, W } = f;
  const { mats } = ctx;
  const concrete = mats.tint('#d9d5cc');
  const slate = mats.tint('#5d6369');
  const eave = 2.2,
    ridge = Math.min(19, W * 0.75);
  // Low side walls, roof planes, ridge beam.
  for (const z of [-W / 2, W / 2]) lb.add(Unit.box, concrete, 0, eave / 2, z, 0, L, eave, 0.4);
  lb.add(gableSlopes(L, W, eave, ridge, 0.9), slate, 0, 0, 0);
  lb.add(Unit.box, concrete, 0, ridge + 0.15, 0, 0, L + 2.4, 0.35, 0.5);
  // Gables: lattice of glass framed by concrete ribs that run up to the ridge.
  const vidriera = new THREE.MeshStandardMaterial({ map: vidrieraTexture(), emissive: '#ffffff', roughness: 0.4 });
  vidriera.emissiveMap = vidriera.map;
  vidriera.emissiveIntensity = 0.35;
  vidriera.name = 'vidrieras';
  vidriera.side = THREE.DoubleSide;
  for (const dir of [1, -1] as const) {
    const x = (dir * L) / 2;
    const g = gableEnd(x, W, 0, ridge, dir);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.5, uv.getY(i) / 2.5);
    lb.add(g, vidriera, 0, 0, 0);
    for (let k = -3; k <= 3; k++) {
      const z = (k / 3.5) * (W / 2);
      const top = ridge * (1 - Math.abs(z) / (W / 2));
      lb.add(Unit.box, concrete, x + dir * 0.15, top / 2, z, 0, 0.3, top, 0.25);
    }
    for (const z of [-1, 1]) lb.addMatrix(Unit.box, concrete, beamMatrix(x + dir * 0.2, 0, (z * W) / 2, x + dir * 0.2, ridge, 0, 0.5));
  }
  // Main door under the front gable with a concrete canopy, and the cross on the apex.
  const fx = L / 2;
  lb.add(Unit.box, mats.tint('#6b4a2f'), fx + 0.3, 1.6, 0, 0, 0.15, 3.2, 3.2);
  lb.add(Unit.box, concrete, fx + 1.6, 3.6, 0, 0, 3.4, 0.3, 6);
  for (const z of [-2.8, 2.8]) lb.add(Unit.box, concrete, fx + 3.1, 1.8, z, 0, 0.3, 3.6, 0.3);
  lb.add(Unit.box, mats.iron, fx + 1.2, ridge + 1.8, 0, 0, 0.18, 3.2, 0.18);
  lb.add(Unit.box, mats.iron, fx + 1.2, ridge + 2.4, 0, 0, 0.18, 0.18, 1.6);
  solid(ctx, f, 0, 0, L, W, ridge);

  if (tower) campanile(ctx, tower.x, tower.z, f.rot);
}

/** Free-standing concrete bell tower: two blades, one opening for two bells and a small one, three crosses. */
function campanile(ctx: BuildContext, x: number, z: number, rot: number): void {
  const lb = new LocalBatch(ctx.batch, x, 0, z, rot);
  const { mats } = ctx;
  const concrete = mats.tint('#cfcac0');
  const H = 24;
  for (const s of [-1, 1]) lb.add(Unit.box, concrete, 0, H / 2, s * 1.1, 0, 2.8, H, 0.45);
  for (const y of [0.4, 14.5, 19.6, H - 0.2]) lb.add(Unit.box, concrete, 0, y, 0, 0, 2.8, 0.4, 2.65);
  for (const s of [-0.45, 0.45]) {
    lb.add(new THREE.CylinderGeometry(0.25, 0.55, 0.9, 10), mats.bronze, 0, 17.6, s);
    lb.add(Unit.box, mats.iron, 0, 18.15, s, 0, 0.12, 0.12, 0.12);
  }
  lb.add(new THREE.CylinderGeometry(0.15, 0.32, 0.5, 8), mats.bronze, 0, 21.7, 0);
  for (const s of [-0.9, 0, 0.9]) {
    const h = s === 0 ? 3.2 : 2.4;
    lb.add(Unit.box, mats.iron, 0, H + h / 2, s, 0, 0.14, h, 0.14);
    lb.add(Unit.box, mats.iron, 0, H + h * 0.7, s, 0, 0.14, 0.14, 0.9);
  }
  ctx.collision.addBox(x, z, 2.8, 2.7, { rot, top: H, mask: Layer.Solid });
}

/**
 * Stone hermitage: single nave with a tiled gable roof, buttresses, a plain
 * rectangular doorway with its inscription and the espadaña (bell gable) on
 * the front, as at San Roque (rebuilt in 1784) and San Vicente.
 */
function ermita(ctx: BuildContext, name: string, bells: number): void {
  const b = ctx.map.buildings.find((x) => x.n === name);
  if (!b) return;
  const ring = toPts(b.o);
  const c = centroid(ring);
  const road = ctx.roads.nearest(c[0], c[1], 120);
  const o = orientedBox(ring);
  const long = Math.max(o.w, o.d);
  // Front: the short end closest to the road.
  const ax = o.w >= o.d ? o.angle : o.angle + Math.PI / 2;
  const ends: Pt[] = [
    [c[0] + (Math.cos(ax) * long) / 2, c[1] - (Math.sin(ax) * long) / 2],
    [c[0] - (Math.cos(ax) * long) / 2, c[1] + (Math.sin(ax) * long) / 2],
  ];
  const front = road
    ? ends.sort((p, q) => Math.hypot(p[0] - road.x, p[1] - road.z) - Math.hypot(q[0] - road.x, q[1] - road.z))[0]
    : ends[0];
  const f = frame(ctx, ring, front);
  const { lb, L, W } = f;
  const { mats } = ctx;
  const eave = Math.min(6.5, 3.2 + W * 0.3),
    ridge = eave + W * 0.32;
  lb.add(boxGeo(L, eave, W, 2), mats.stone, 0, eave / 2, 0);
  for (const dir of [1, -1] as const) lb.add(gableEnd((dir * L) / 2, W, eave, ridge, dir), mats.stone, 0, 0, 0);
  lb.add(gableSlopes(L, W, eave, ridge, 0.45), mats.roof, 0, 0, 0);
  // Buttresses and cornice.
  for (let x = -L / 2 + L / 4; x < L / 2 - 1; x += L / 4) {
    for (const s of [-1, 1]) lb.add(Unit.box, mats.stone, x, eave * 0.4, s * (W / 2 + 0.35), 0, 1.0, eave * 0.8, 0.7);
  }
  for (const s of [-1, 1]) lb.add(Unit.box, mats.stoneTrim, 0, eave - 0.1, s * (W / 2 + 0.12), 0, L + 0.2, 0.25, 0.3);
  // Front: doorway with lintel, plaque, oculus, espadaña.
  const fx = L / 2 + 0.06;
  lb.add(Unit.box, mats.tint('#4a2f1f'), fx, 1.45, 0, 0, 0.1, 2.9, 1.7);
  lb.add(Unit.box, mats.stoneTrim, fx + 0.06, 3.05, 0, 0, 0.2, 0.35, 2.4);
  for (const z of [-1.05, 1.05]) lb.add(Unit.box, mats.stoneTrim, fx + 0.06, 1.45, z, 0, 0.2, 2.9, 0.35);
  lb.add(Unit.box, mats.tint('#cbbf9f'), fx + 0.05, 3.75, 0, 0, 0.08, 0.6, 1.8);
  lb.add(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 12), mats.tint('#2a3038'), fx + 0.02, eave + 0.9, 0, 0, 1, 1, 1, 0, Math.PI / 2);
  const ew = bells > 1 ? 4.2 : 2.6,
    eh = 3.6,
    ey = ridge - 0.6;
  lb.add(Unit.box, mats.stone, L / 2 - 0.4, ey + eh / 2, 0, 0, 0.8, eh, ew);
  lb.add(new THREE.ConeGeometry(ew * 0.72, 1.3, 4).rotateY(Math.PI / 4), mats.stone, L / 2 - 0.4, ey + eh + 0.6, 0, 0, 0.35, 1, 1);
  const holes = bells > 1 ? [-1, 1] : [0];
  for (const z of holes) {
    lb.add(Unit.box, mats.tint('#2a2622'), L / 2 - 0.4, ey + 1.9, z, 0, 0.84, 1.6, 0.9);
    lb.add(new THREE.CylinderGeometry(0.2, 0.42, 0.7, 10), mats.bronze, L / 2 - 0.4, ey + 1.8, z);
  }
  lb.add(Unit.box, mats.iron, L / 2 - 0.4, ey + eh + 1.7, 0, 0, 0.1, 1.4, 0.1);
  lb.add(Unit.box, mats.iron, L / 2 - 0.4, ey + eh + 1.9, 0, 0, 0.1, 0.1, 0.7);
  solid(ctx, f, 0, 0, L, W + 1.4, ridge);
}

export function buildChurches(ctx: BuildContext): void {
  santaMarina(ctx);
  ermita(ctx, 'Ermita de San Roque', 2);
  ermita(ctx, 'Ermita de San Vicente', 1);
}
