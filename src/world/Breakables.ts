import * as THREE from 'three';

/** One mesh part of a breakable prop, in the prop's local frame (Y up, facing local +Z). */
export interface BreakablePart {
  /** Parts with the same key share one InstancedMesh (same geometry and material). */
  key: string;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  local?: THREE.Matrix4;
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
}

interface Group {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  count: number;
  mesh: THREE.InstancedMesh | null;
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
const FALL_ANGLE = 1.48;
const MIN_SPEED = 1.5;

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

  add(x: number, y: number, z: number, a: number, r: number, parts: BreakablePart[]): void {
    const item: Item = { x, y, z, a, r, parts: [], t: -1, axis: new THREE.Vector3(1, 0, 0) };
    for (const p of parts) {
      let g = this.groups.get(p.key);
      if (!g) this.groups.set(p.key, (g = { geo: p.geo, mat: p.mat, count: 0, mesh: null }));
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
      g.mesh.castShadow = true;
      g.mesh.receiveShadow = true;
      g.mesh.name = 'breakables';
    }
    for (const it of this.items) this.place(it, 0);
    for (const g of this.groups.values()) {
      g.mesh!.instanceMatrix.needsUpdate = true;
      g.mesh!.computeBoundingSphere();
      scene.add(g.mesh!);
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
      p.g.mesh!.setMatrixAt(p.i, this.m);
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
            veh.speed *= 0.88;
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
    for (const g of touched) g.mesh!.instanceMatrix.needsUpdate = true;
  }
}
