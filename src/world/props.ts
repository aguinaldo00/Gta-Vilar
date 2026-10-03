import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import type { BuildContext } from './context';
import { beamMatrix, boxGeo } from './geometry';
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

/** Unit leaf card mapped onto the leaf region of the tree atlas. */
const LEAF_CARD = (() => {
  const g = new THREE.PlaneGeometry(1, 1);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.75);
  return g;
})();

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
    const sx = x,
      sy = y0 + h - 0.15,
      sz = z;
    const ex = sx + Math.sin(a) * Math.sin(tilt) * len;
    const ey = sy + Math.cos(tilt) * len;
    const ez = sz + Math.cos(a) * Math.sin(tilt) * len;
    batch.addMatrix(Unit.cyl, mats.bark, beamMatrix(sx, sy, sz, ex, ey, ez, 0.26));
    batch.add(Unit.blob, mats.bark, ex, ey, ez, 0, 0.2, 0.2, 0.2);
    // Sprouting foliage: a few crossed leaf cards at each knob.
    for (let k = 0; k < 3; k++) {
      const s = rng.range(1.1, 1.6);
      batch.add(
        LEAF_CARD,
        mats.leaves,
        ex + rng.range(-0.3, 0.3),
        ey + 0.45 + rng.range(-0.2, 0.3),
        ez + rng.range(-0.3, 0.3),
        rng.range(0, Math.PI),
        s,
        s,
        s,
        rng.range(-0.5, 0.5),
      );
    }
  }
  ctx.collision.addCircle(x, z, 0.35, { top: y0 + h, mask: Layer.Bodies });
}

export function bench(ctx: BuildContext, x: number, z: number, y0: number, rotY: number): void {
  const { batch, mats } = ctx;
  const c = Math.cos(rotY),
    s = Math.sin(rotY);
  batch.add(Unit.box, mats.wood, x, y0 + 0.45, z, rotY, 1.8, 0.08, 0.5);
  batch.add(Unit.box, mats.wood, x - s * 0.22, y0 + 0.75, z - c * 0.22, rotY, 1.8, 0.4, 0.06);
  for (const k of [-0.75, 0.75]) {
    batch.add(Unit.box, mats.iron, x + c * k, y0 + 0.4, z - s * k, rotY, 0.08, 0.8, 0.5);
  }
  ctx.collision.addBox(x, z, 1.8, 0.55, { rot: rotY, top: y0 + 0.5, mask: Layer.Bodies });
}

/** Sign board on two posts. */
export function signBoard(
  ctx: BuildContext,
  tex: THREE.Texture,
  x: number,
  z: number,
  y0: number,
  rotY: number,
  w = 3.4,
  h = 0.65,
  postH = 1.6,
): void {
  const mat = new THREE.MeshStandardMaterial({ map: tex });
  const board = new THREE.Mesh(boxGeo(w, h, 0.08), mat);
  board.position.set(x, y0 + postH + h / 2, z);
  board.rotation.y = rotY;
  board.castShadow = true;
  ctx.scene.add(board);
  const c = Math.cos(rotY),
    s = Math.sin(rotY);
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
  ctx: BuildContext,
  kind: 'es' | 'cyl' | 'eu',
  x: number,
  y0: number,
  z: number,
  poleH: number,
  rotY: number,
  tilt = 0,
): void {
  const group = new THREE.Group();
  group.position.set(x, y0, z);
  group.rotation.set(tilt, rotY, 0, 'YXZ');
  // The pole is static: batch it with the other props (one draw call for all of them).
  group.updateMatrix();
  ctx.batch.addMatrix(new THREE.CylinderGeometry(0.035, 0.05, poleH, 6).translate(0, poleH / 2, 0), ctx.mats.white, group.matrix);

  const fw = 1.5,
    fh = 1.0;
  const geo = new THREE.PlaneGeometry(fw, fh, 12, 6);
  geo.translate(fw / 2, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ map: flagTexture(kind), side: THREE.DoubleSide });
  const cloth = new THREE.Mesh(geo, mat);
  cloth.position.set(0.04, poleH - fh / 2 - 0.05, 0);
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
