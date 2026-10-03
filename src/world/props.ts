import * as THREE from 'three';
import { Layer } from '../physics/CollisionWorld';
import type { BuildContext } from './context';
import { beamMatrix, boxGeo } from './geometry';
import { MapLayer } from './MapSketch';
import { flagTexture } from './textures';

/** Unit primitives, scaled per instance by the batcher. */
export const Unit = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cyl16: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  cone: new THREE.ConeGeometry(0.5, 1, 8),
  blob: new THREE.IcosahedronGeometry(1, 0),
  blob1: new THREE.IcosahedronGeometry(1, 1),
  sphere: new THREE.SphereGeometry(0.5, 10, 8),
};

/** Pollarded plane tree ("plátano") — knobbly trunk with short sprouting branches. */
export function planeTree(ctx: BuildContext, x: number, z: number, y0: number): void {
  const { batch, mats, rng } = ctx;
  const h = rng.range(2.6, 3.3);
  batch.add(Unit.cyl, mats.bark, x, y0 + h / 2, z, 0, 0.55, h, 0.55);
  const n = rng.int(4, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const tilt = rng.range(0.45, 0.9);
    const len = rng.range(1.1, 1.7);
    const sx = x, sy = y0 + h - 0.15, sz = z;
    const ex = sx + Math.sin(a) * Math.sin(tilt) * len;
    const ey = sy + Math.cos(tilt) * len;
    const ez = sz + Math.cos(a) * Math.sin(tilt) * len;
    batch.addMatrix(Unit.cyl, mats.bark, beamMatrix(sx, sy, sz, ex, ey, ez, 0.26));
    batch.add(Unit.blob, mats.bark, ex, ey, ez, 0, 0.2, 0.2, 0.2);
    const s = rng.range(0.55, 0.85);
    batch.add(Unit.blob, mats.springLeaf, ex, ey + s * 0.5, ez, rng.range(0, 3), s, s * 0.8, s);
  }
  ctx.collision.addCircle(x, z, 0.35, { top: y0 + h, mask: Layer.Bodies });
  ctx.sketch.circle(MapLayer.Landmark, x, z, 1.4, '#7e9a3f');
}

/** Tall riverside poplar ("chopo"). */
export function poplar(ctx: BuildContext, x: number, z: number, y0: number): void {
  const { batch, mats, rng } = ctx;
  const h = rng.range(2.5, 3.5);
  const s = rng.range(0.85, 1.25);
  batch.add(Unit.cyl, mats.trunk, x, y0 + h / 2, z, 0, 0.4, h, 0.4);
  batch.add(Unit.blob1, rng.pick(mats.foliage), x, y0 + h + 3.6 * s, z, rng.range(0, 3), 1.5 * s, 4.4 * s, 1.5 * s);
  ctx.collision.addCircle(x, z, 0.35, { top: y0 + 10, mask: Layer.Bodies });
  ctx.sketch.circle(MapLayer.Building, x, z, 1.6 * s, '#3f6a2c');
}

/** Broad deciduous tree (ash / willow / oak) for El Soto. */
export function roundTree(ctx: BuildContext, x: number, z: number, y0: number, scale = 1): void {
  const { batch, mats, rng } = ctx;
  const s = rng.range(0.8, 1.2) * scale;
  const h = 2.4 * s;
  batch.add(Unit.cyl, mats.trunk, x, y0 + h / 2, z, 0, 0.5 * s, h, 0.5 * s);
  const mat = rng.pick(mats.foliage);
  const blobs = rng.int(2, 3);
  for (let i = 0; i < blobs; i++) {
    const r = rng.range(1.6, 2.6) * s;
    batch.add(
      Unit.blob1, mat,
      x + rng.range(-1, 1) * s, y0 + h + r * 0.8 + i * 0.6 * s, z + rng.range(-1, 1) * s,
      rng.range(0, 3), r, r * 0.85, r,
    );
  }
  ctx.collision.addCircle(x, z, 0.4 * s, { top: y0 + 8, mask: Layer.Bodies });
  ctx.sketch.circle(MapLayer.Building, x, z, 2.4 * s, '#3d6a2a');
}

export function pine(ctx: BuildContext, x: number, z: number, y0: number): void {
  const { batch, mats, rng } = ctx;
  const s = rng.range(0.8, 1.4);
  batch.add(Unit.cyl, mats.trunk, x, y0 + 1 * s, z, 0, 0.4 * s, 2 * s, 0.4 * s);
  batch.add(Unit.cone, mats.pine, x, y0 + 3.6 * s, z, rng.range(0, 3), 3.4 * s, 4.5 * s, 3.4 * s);
  batch.add(Unit.cone, mats.pine, x, y0 + 5.6 * s, z, rng.range(0, 3), 2.4 * s, 3.4 * s, 2.4 * s);
}

/** Classic street lamp: dark post, curved arm and a lantern. */
export function streetLamp(ctx: BuildContext, x: number, z: number, y0: number, armDir = 0): void {
  const { batch, mats } = ctx;
  batch.add(Unit.cyl, mats.iron, x, y0 + 2.1, z, 0, 0.16, 4.2, 0.16);
  batch.add(Unit.cyl, mats.iron, x, y0 + 0.3, z, 0, 0.3, 0.6, 0.3);
  const ax = x + Math.sin(armDir) * 0.7;
  const az = z + Math.cos(armDir) * 0.7;
  batch.addMatrix(Unit.cyl, mats.iron, beamMatrix(x, y0 + 4.0, z, ax, y0 + 4.25, az, 0.08));
  batch.add(Unit.box, mats.lampGlass, ax, y0 + 3.95, az, armDir, 0.3, 0.4, 0.3);
  batch.add(Unit.cone, mats.iron, ax, y0 + 4.3, az, 0, 0.5, 0.3, 0.5);
  ctx.collision.addCircle(x, z, 0.15, { top: y0 + 4.4, mask: Layer.Bodies });
}

/** Plaza lamp post with four green lanterns. */
export function plazaLamp(ctx: BuildContext, x: number, z: number, y0: number): void {
  const { batch, mats } = ctx;
  batch.add(Unit.cyl, mats.ironGreen, x, y0 + 1.9, z, 0, 0.18, 3.8, 0.18);
  batch.add(Unit.cyl, mats.ironGreen, x, y0 + 0.35, z, 0, 0.4, 0.7, 0.4);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const lx = x + Math.sin(a) * 0.55;
    const lz = z + Math.cos(a) * 0.55;
    batch.addMatrix(Unit.cyl, mats.ironGreen, beamMatrix(x, y0 + 3.4, z, lx, y0 + 3.7, lz, 0.06));
    batch.add(Unit.box, mats.lampGlass, lx, y0 + 3.55, lz, a, 0.24, 0.36, 0.24);
    batch.add(Unit.cone, mats.ironGreen, lx, y0 + 3.85, lz, 0, 0.4, 0.25, 0.4);
  }
  ctx.collision.addCircle(x, z, 0.2, { top: y0 + 4, mask: Layer.Bodies });
}

export function bench(ctx: BuildContext, x: number, z: number, y0: number, rotY: number): void {
  const { batch, mats } = ctx;
  const c = Math.cos(rotY), s = Math.sin(rotY);
  batch.add(Unit.box, mats.wood, x, y0 + 0.45, z, rotY, 1.8, 0.08, 0.5);
  batch.add(Unit.box, mats.wood, x - s * 0.22, y0 + 0.75, z - c * 0.22, rotY, 1.8, 0.4, 0.06);
  for (const k of [-0.75, 0.75]) {
    batch.add(Unit.box, mats.iron, x + c * k, y0 + 0.4, z - s * k, rotY, 0.08, 0.8, 0.5);
  }
  ctx.collision.addBox(x, z, 1.8, 0.55, { rot: rotY, top: y0 + 0.5, mask: Layer.Bodies });
}

export function hayBale(ctx: BuildContext, x: number, z: number, y0: number, rotY: number): void {
  ctx.batch.add(Unit.cyl16, ctx.mats.hay, x, y0 + 0.75, z, rotY, 1.5, 1.3, 1.5, 0, Math.PI / 2);
  ctx.collision.addCircle(x, z, 0.85, { top: y0 + 1.5, mask: Layer.Solid });
}

export function picnicTable(ctx: BuildContext, x: number, z: number, y0: number, rotY: number): void {
  const { batch, mats } = ctx;
  batch.add(Unit.box, mats.wood, x, y0 + 0.75, z, rotY, 2, 0.08, 0.9);
  for (const k of [-0.65, 0.65]) {
    const ox = Math.sin(rotY) * k, oz = Math.cos(rotY) * k;
    batch.add(Unit.box, mats.wood, x + ox, y0 + 0.45, z + oz, rotY, 2, 0.06, 0.3);
  }
  batch.add(Unit.box, mats.wood, x, y0 + 0.37, z, rotY, 0.1, 0.75, 1.6);
  ctx.collision.addBox(x, z, 2, 1.7, { rot: rotY, top: y0 + 0.8, mask: Layer.Bodies });
}

/** Sign board on two posts. */
export function signBoard(
  ctx: BuildContext, tex: THREE.Texture, x: number, z: number, y0: number, rotY: number, w = 3.4, h = 0.65, postH = 1.6,
): void {
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const board = new THREE.Mesh(boxGeo(w, h, 0.08), [ctx.mats.darkWood, ctx.mats.darkWood, ctx.mats.darkWood, ctx.mats.darkWood, mat, mat]);
  board.position.set(x, y0 + postH + h / 2, z);
  board.rotation.y = rotY;
  board.castShadow = true;
  ctx.scene.add(board);
  const c = Math.cos(rotY), s = Math.sin(rotY);
  for (const k of [-w / 2 + 0.15, w / 2 - 0.15]) {
    ctx.batch.add(Unit.box, ctx.mats.darkWood, x + c * k, y0 + (postH + h) / 2, z - s * k, rotY, 0.12, postH + h, 0.12);
  }
  ctx.collision.addBox(x, z, w, 0.2, { rot: rotY, top: y0 + postH + h, mask: Layer.Bodies });
}

/**
 * Animated cloth flag on a pole. The pole base is at (x, y0, z); `tilt` leans
 * the pole forward (balcony flags) along `rotY`.
 */
export function flag(
  ctx: BuildContext, kind: 'es' | 'cyl' | 'eu', x: number, y0: number, z: number, poleH: number, rotY: number, tilt = 0,
): void {
  const group = new THREE.Group();
  group.position.set(x, y0, z);
  group.rotation.set(tilt, rotY, 0, 'YXZ');
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, poleH, 6), ctx.mats.white);
  pole.position.y = poleH / 2;
  pole.castShadow = true;
  group.add(pole);

  const fw = 1.5, fh = 1.0;
  const geo = new THREE.PlaneGeometry(fw, fh, 12, 6);
  geo.translate(fw / 2, 0, 0);
  const mat = new THREE.MeshLambertMaterial({ map: flagTexture(kind), side: THREE.DoubleSide });
  const cloth = new THREE.Mesh(geo, mat);
  cloth.position.set(0.04, poleH - fh / 2 - 0.05, 0);
  cloth.castShadow = true;
  group.add(cloth);
  ctx.scene.add(group);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const base = Float32Array.from(pos.array as Float32Array);
  const phase = ctx.rng.range(0, 6);
  ctx.animators.push((t) => {
    for (let i = 0; i < pos.count; i++) {
      const fx = base[i * 3];
      const fy = base[i * 3 + 1];
      const k = fx / fw;
      pos.setXYZ(
        i,
        fx - k * 0.08,
        fy - k * k * 0.12 + Math.sin(fx * 2 + t * 4 + phase) * 0.03 * k,
        Math.sin(fx * 3.2 - t * 6 + phase) * 0.18 * k + Math.sin(fy * 2 + t * 3) * 0.04 * k,
      );
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  });
}
