import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import { CHUNK } from './Batcher';
import { Mesh3 } from './Buildings';
import type { BuildContext } from './context';
import { hash01, toPts } from './geo';
import { fenceMaterial } from './Sports';

/** Default heights when neither OSM nor the LiDAR gives one. */
const DEFAULT_H: Record<string, number> = { wall: 1.6, retaining_wall: 1.2, fence: 1.8, hedge: 1.5, railing: 0.9 };
const THICK: Record<string, number> = { wall: 0.3, retaining_wall: 0.45, fence: 0.25, hedge: 0.9, railing: 0.08 };
/** Masonry base under railings and wire fences. */
const PLINTH = 0.45;
/** Size of one wire-mesh diamond, m. */
const MESH_CELL = 0.12;
/** Long runs are cut into pieces this long so they follow the ground. */
const PIECE = 4;
/** Depth of the platform block drawn along a terrace edge (covers the heightmap ramp), m. */
const STEP_BODY = 2.2;
const WALL_TINTS = ['#ebe5d6', '#d9caa8', '#c9bba0', '#e2d9c6'].map((c) => new THREE.Color(c));
const CONCRETE = new THREE.Color('#b9b4aa');
const RAILING = new THREE.Color('#1e2224');
const HEDGE = new THREE.Color('#3f6a30');

/**
 * Prism along a wall piece from (x0, z0) to (x1, z1), `t` thick, standing on
 * bottoms b0/b1 up to tops y0/y1 (so it follows the slope): two faces, the
 * top and both ends. UVs in metres (u along, v up).
 */
function prism(
  m: Mesh3,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  t: number,
  b0: number,
  b1: number,
  y0: number,
  y1: number,
  color: THREE.Color,
  uvScale: number,
  caps: [boolean, boolean] = [true, true],
): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const nx = (-(z1 - z0) / len) * (t / 2),
    nz = ((x1 - x0) / len) * (t / 2);
  const s = uvScale;
  for (const side of [1, -1]) {
    const ox = nx * side,
      oz = nz * side;
    m.quad(
      [x0 + ox, b0, z0 + oz],
      [x1 + ox, b1, z1 + oz],
      [x1 + ox, y1, z1 + oz],
      [x0 + ox, y0, z0 + oz],
      [0, b0 / s],
      [len / s, b1 / s],
      [len / s, y1 / s],
      [0, y0 / s],
      [ox, 0, oz],
      color,
    );
  }
  m.quad(
    [x0 + nx, y0, z0 + nz],
    [x1 + nx, y1, z1 + nz],
    [x1 - nx, y1, z1 - nz],
    [x0 - nx, y0, z0 - nz],
    [0, 0],
    [len / s, 0],
    [len / s, t / s],
    [0, t / s],
    [0, 1, 0],
    color,
  );
  for (const [x, z, b, y, dir] of [
    [x0, z0, b0, y0, -1],
    [x1, z1, b1, y1, 1],
  ]) {
    if (!caps[dir < 0 ? 0 : 1]) continue;
    m.quad(
      [x + nx, b, z + nz],
      [x - nx, b, z - nz],
      [x - nx, y, z - nz],
      [x + nx, y, z + nz],
      [0, b / s],
      [t / s, b / s],
      [t / s, y / s],
      [0, y / s],
      [((x1 - x0) / len) * dir, 0, ((z1 - z0) / len) * dir],
      color,
    );
  }
}

/**
 * Walls, fences and hedges: the OSM barriers and the plot walls found in the
 * LiDAR (tools/geodata/walls.py), cut into pieces that follow the ground,
 * with colliders. Fences are railings or wire mesh on a masonry plinth, as
 * on most garden boundaries in the town. Bollards from OSM keep cars out.
 */
export function buildBarriers(ctx: BuildContext): void {
  const { terrain, collision } = ctx;
  // One set of meshes per batcher chunk, so distant walls are culled with their chunk.
  const chunks = new Map<string, { masonry: Mesh3; hedges: Mesh3; mesh: Mesh3 }>();
  const at = (x: number, z: number) => {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = { masonry: new Mesh3(), hedges: new Mesh3(), mesh: new Mesh3() }));
    return c;
  };
  const fence = fenceMaterial();
  // Coping stones only on the high-detail level (they double the triangles of a wall).
  const coping = ctx.quality.detail === 1;
  let idx = 0;
  for (const b of ctx.map.barriers ?? []) {
    idx++;
    const pts = toPts(b.p);
    const h = b.h ?? DEFAULT_H[b.k] ?? 1.5;
    const t = THICK[b.k] ?? 0.3;
    const tint = b.k === 'retaining_wall' ? CONCRETE : WALL_TINTS[Math.floor(hash01(idx) * WALL_TINTS.length)];
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1],
        [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      const n = Math.max(1, Math.ceil(len / PIECE));
      for (let k = 0; k < n; k++) {
        const x0 = ax + ((bx - ax) * k) / n,
          z0 = az + ((bz - az) * k) / n,
          x1 = ax + ((bx - ax) * (k + 1)) / n,
          z1 = az + ((bz - az) * (k + 1)) / n;
        const g0 = terrain.heightAt(x0, z0),
          g1 = terrain.heightAt(x1, z1);
        // Footing below the ground on both ends; tops follow the slope.
        const f0 = Math.min(g0, g1) - 0.3,
          f1 = f0;
        const { masonry, hedges, mesh } = at((x0 + x1) / 2, (z0 + z1) / 2);
        // End faces only where the run starts and stops (pieces in between are joined).
        const caps: [boolean, boolean] = [i === 1 && k === 0, i === pts.length - 1 && k === n - 1];
        if (b.src === 'step' && b.top !== undefined) {
          // Terrace edge: a platform block whose top is flush with the upper ground, its
          // face on the step line and its body over the ramp of the 2 m heightmap.
          const ux = ((z1 - z0) / len) * n * (b.up ?? 1),
            uz = (-(x1 - x0) / len) * n * (b.up ?? 1);
          const o = STEP_BODY / 2 - 0.25;
          const top = b.top + 0.04;
          prism(masonry, x0 + ux * o, z0 + uz * o, x1 + ux * o, z1 + uz * o, STEP_BODY, f0, f1, top, top, tint, 1.5, caps);
          if (coping) prism(masonry, x0, z0, x1, z1, 0.5, top - 0.02, top - 0.02, top + 0.06, top + 0.06, CONCRETE, 1.5, caps);
          collision.addBox((x0 + x1) / 2 + ux * o, (z0 + z1) / 2 + uz * o, len / n + 0.05, STEP_BODY, {
            rot: Math.atan2(-(z1 - z0), x1 - x0),
            bottom: f0,
            top,
            mask: Layer.Solid,
            absolute: true,
          });
          continue;
        }
        if (b.k === 'railing') {
          // Black iron railing: round-headed posts every ~1.5 m, a top rail and a lower rail.
          const iron = RAILING;
          prism(masonry, x0, z0, x1, z1, 0.06, g0 + h - 0.06, g1 + h - 0.06, g0 + h, g1 + h, iron, 1, caps);
          prism(masonry, x0, z0, x1, z1, 0.04, g0 + 0.25, g1 + 0.25, g0 + 0.3, g1 + 0.3, iron, 1, caps);
          const posts = Math.max(1, Math.round(len / n / 1.5));
          for (let j = 0; j <= posts; j++) {
            if (j === 0 && !caps[0] && k > 0) continue;
            const px = x0 + ((x1 - x0) * j) / posts,
              pz = z0 + ((z1 - z0) * j) / posts,
              py = g0 + ((g1 - g0) * j) / posts;
            prism(masonry, px - 0.05, pz, px + 0.05, pz, 0.1, py - 0.2, py - 0.2, py + h + 0.08, py + h + 0.08, iron, 1);
          }
          collision.addBox((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0), 0.15, {
            rot: Math.atan2(-(z1 - z0), x1 - x0),
            bottom: f0,
            top: Math.max(g0, g1) + h,
            mask: Layer.Bodies,
            absolute: true,
          });
          continue;
        }
        if (b.k === 'hedge') {
          prism(hedges, x0, z0, x1, z1, t, f0, f1, g0 + h, g1 + h, HEDGE, 1, caps);
        } else if (b.k === 'fence') {
          const p = Math.min(PLINTH, h * 0.4);
          prism(masonry, x0, z0, x1, z1, t, f0, f1, g0 + p, g1 + p, tint, 1.5, caps);
          // Mesh panel (double-sided, alpha-tested) from the plinth to the top.
          mesh.quad(
            [x0, g0 + p, z0],
            [x1, g1 + p, z1],
            [x1, g1 + h, z1],
            [x0, g0 + h, z0],
            [0, 0],
            [len / n / MESH_CELL, 0],
            [len / n / MESH_CELL, (h - p) / MESH_CELL],
            [0, (h - p) / MESH_CELL],
            [-(z1 - z0), 0, x1 - x0],
            tint,
          );
        } else {
          prism(masonry, x0, z0, x1, z1, t, f0, f1, g0 + h, g1 + h, tint, 1.5, caps);
          // Coping stone along the top of free-standing walls.
          if (coping && b.k === 'wall' && h > 0.8)
            prism(masonry, x0, z0, x1, z1, t + 0.1, g0 + h - 0.02, g1 + h - 0.02, g0 + h + 0.08, g1 + h + 0.08, CONCRETE, 1.5);
        }
        collision.addBox((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) + 0.05, Math.max(0.25, t), {
          rot: Math.atan2(-(z1 - z0), x1 - x0),
          bottom: f0,
          top: Math.max(g0, g1) + h,
          mask: b.k === 'fence' ? Layer.Bodies : Layer.Solid,
          absolute: true,
        });
      }
    }
  }
  const bol = ctx.map.bollards ?? [];
  const post = new THREE.CylinderGeometry(0.1, 0.12, 0.9, 8);
  for (let i = 0; i < bol.length; i += 2) {
    const x = bol[i],
      z = bol[i + 1];
    const y = terrain.heightAt(x, z);
    ctx.batch.add(post, ctx.mats.tint('#3a3a3a'), x, y + 0.45, z);
    collision.addCircle(x, z, 0.15, { bottom: y - 0.5, top: y + 0.9, mask: Layer.Bodies, absolute: true });
  }
  for (const { masonry, hedges, mesh } of chunks.values()) {
    if (!masonry.empty) ctx.batch.addWorld(masonry.geometry(), ctx.mats.stoneVC);
    if (!hedges.empty) ctx.batch.addWorld(hedges.geometry(), ctx.mats.propsVC);
    if (!mesh.empty) ctx.batch.addWorld(mesh.geometry(), fence);
  }
}
