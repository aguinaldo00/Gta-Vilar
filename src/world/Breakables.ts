import * as THREE from 'three';

/** One mesh part of a breakable prop, in the prop's local frame (Y up, facing local +Z). */
export interface BreakablePart {
  /** Parts with the same key share one InstancedMesh (same geometry and material). */
  key: string;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  local?: THREE.Matrix4;
  /** Per-instance colour (trees and shrubs: species and orthophoto tint). */
  color?: THREE.Color;
  /** Shadow depth material (alpha-tested leaves). */
  depthMat?: THREE.Material;
  /** Casts a shadow (default true). */
  castShadow?: boolean;
  /** Not drawn beyond this distance from the camera (m; default: always drawn). */
  range?: number;
}

interface Item {
  x: number;
  y: number;
  z: number;
  a: number;
  r: number;
  parts: { g: Group; i: number; local: THREE.Matrix4 }[];
  /** Fall progress in seconds (< 0: standing). */
  t: number;
  axis: THREE.Vector3;
  /** Speed the car keeps when it knocks this down (a tree stops it more than a sign). */
  keep: number;
}

interface Group {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  depthMat?: THREE.Material;
  castShadow: boolean;
  count: number;
  colors: (THREE.Color | undefined)[];
  mesh: THREE.InstancedMesh | null;
  range: number;
  /** Owner of every instance, its current world matrix, and the slot it is drawn in (-1: out of range). */
  owners: Item[];
  mats: Float32Array;
  slot: Int32Array;
}

/** What a breakable needs to know about a vehicle. */
export interface Rammer {
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  speed: number;
  impact: number;
}

const CELL = 16;
const FALL_TIME = 0.5;
const WHITE = new THREE.Color(1, 1, 1);
const FALL_ANGLE = 1.48;
const MIN_SPEED = 1.5;
/** Ranged groups are re-sorted when the camera has moved this far (m). */
const RECULL = 15;

/**
 * Light street furniture a car can knock down: traffic signs, lamp posts and
 * bollards. They block people but not vehicles (their colliders are
 * player-only); a car that runs into one tips it over in the direction it was
 * going and loses a little speed, instead of getting wedged between a lamp and
 * a sign. Drawn as instances, so each prop can move on its own.
 */
export class Breakables {
  private readonly groups = new Map<string, Group>();
  private readonly items: Item[] = [];
  private readonly grid = new Map<string, number[]>();
  private readonly falling = new Set<Item>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly last = new THREE.Vector3(1e9, 0, 1e9);

  add(x: number, y: number, z: number, a: number, r: number, parts: BreakablePart[], keep = 0.88): void {
    const item: Item = { x, y, z, a, r, parts: [], t: -1, axis: new THREE.Vector3(1, 0, 0), keep };
    for (const p of parts) {
      const key = p.key;
      let g = this.groups.get(key);
      if (!g)
        this.groups.set(
          key,
          (g = {
            geo: p.geo,
            mat: p.mat,
            depthMat: p.depthMat,
            castShadow: p.castShadow ?? true,
            count: 0,
            colors: [],
            mesh: null,
            range: p.range ?? Number.POSITIVE_INFINITY,
            owners: [],
            mats: new Float32Array(0),
            slot: new Int32Array(0),
          }),
        );
      g.colors.push(p.color);
      g.owners.push(item);
      item.parts.push({ g, i: g.count++, local: p.local ?? new THREE.Matrix4() });
    }
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(this.items.length);
    this.items.push(item);
  }

  /** Creates the instanced meshes once every prop has been added. */
  finish(scene: THREE.Scene): void {
    for (const g of this.groups.values()) {
      g.mesh = new THREE.InstancedMesh(g.geo, g.mat, g.count);
      g.mesh.castShadow = g.castShadow;
      g.mesh.receiveShadow = true;
      if (g.depthMat) g.mesh.customDepthMaterial = g.depthMat;
      g.mesh.name = 'breakables';
      if (g.colors.some((c) => c))
        g.colors.forEach((c, i) => {
          g.mesh!.setColorAt(i, c ?? WHITE);
        });
      g.mats = new Float32Array(g.count * 16);
      g.slot = Int32Array.from({ length: g.count }, (_, i) => i);
    }
    for (const it of this.items) this.place(it, 0);
    for (const g of this.groups.values()) {
      g.mesh!.instanceMatrix.needsUpdate = true;
      g.mesh!.computeBoundingSphere();
      scene.add(g.mesh!);
    }
  }

  /**
   * Groups with a range only draw the instances near the camera (small trees, shrubs, fence
   * posts all over the town): redone when the camera has moved RECULL metres.
   */
  cull(camera: THREE.Vector3): void {
    if (Math.hypot(camera.x - this.last.x, camera.z - this.last.z) < RECULL) return;
    this.last.copy(camera);
    for (const g of this.groups.values()) {
      if (!Number.isFinite(g.range) || !g.mesh) continue;
      const r2 = g.range * g.range;
      const arr = g.mesh.instanceMatrix.array as Float32Array;
      let n = 0;
      for (let i = 0; i < g.count; i++) {
        const it = g.owners[i];
        const dx = it.x - camera.x,
          dz = it.z - camera.z;
        if (dx * dx + dz * dz > r2) {
          g.slot[i] = -1;
          continue;
        }
        g.slot[i] = n;
        arr.set(g.mats.subarray(i * 16, i * 16 + 16), n * 16);
        if (g.mesh.instanceColor) g.mesh.setColorAt(n, g.colors[i] ?? WHITE);
        n++;
      }
      g.mesh.count = n;
      g.mesh.visible = n > 0;
      g.mesh.instanceMatrix.needsUpdate = true;
      if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
      g.mesh.computeBoundingSphere();
    }
  }

  get count(): number {
    return this.items.length;
  }

  private place(it: Item, angle: number): void {
    // Base at the foot of the prop, tipped about a horizontal axis, then its own heading.
    this.q.setFromAxisAngle(it.axis, angle);
    const base = new THREE.Matrix4().compose(this.v.set(it.x, it.y, it.z), this.q, new THREE.Vector3(1, 1, 1));
    base.multiply(new THREE.Matrix4().makeRotationY(it.a));
    for (const p of it.parts) {
      this.m.multiplyMatrices(base, p.local);
      this.m.toArray(p.g.mats, p.i * 16);
      const slot = p.g.slot[p.i];
      if (slot >= 0) p.g.mesh!.setMatrixAt(slot, this.m);
    }
  }

  update(dt: number, vehicles: readonly Rammer[]): void {
    for (const veh of vehicles) {
      if (Math.abs(veh.speed) < MIN_SPEED) continue;
      const cx = Math.floor(veh.x / CELL),
        cz = Math.floor(veh.z / CELL);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const idx of this.grid.get(`${cx + i},${cz + j}`) ?? []) {
            const it = this.items[idx];
            if (it.t >= 0) continue;
            if (Math.hypot(it.x - veh.x, it.z - veh.z) > veh.radius * 0.85 + it.r) continue;
            // Falls the way the car was going: about the horizontal axis across its path.
            const len = Math.hypot(veh.vx, veh.vz) || 1;
            it.axis.set(veh.vz / len, 0, -veh.vx / len);
            it.t = 0;
            this.falling.add(it);
            veh.speed *= it.keep;
            veh.impact = Math.max(veh.impact, 2.5);
          }
    }
    if (!this.falling.size) return;
    const touched = new Set<Group>();
    for (const it of this.falling) {
      it.t += dt;
      const k = Math.min(1, it.t / FALL_TIME);
      this.place(it, FALL_ANGLE * k * k);
      for (const p of it.parts) touched.add(p.g);
      if (k >= 1) this.falling.delete(it);
    }
    for (const g of touched) {
      g.mesh!.instanceMatrix.needsUpdate = true;
      // A tipped tree reaches beyond its standing bounds.
      if (Number.isFinite(g.range)) g.mesh!.computeBoundingSphere();
    }
  }
}
