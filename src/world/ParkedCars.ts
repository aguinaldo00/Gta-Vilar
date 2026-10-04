import * as THREE from 'three';
import { Layer, type MovableCollider } from '../physics/PhysicsWorld';
import type { BuildContext } from './context';
import { hash01 } from './geo';

const CAR_COLOURS = ['#b9bcc0', '#2b2d31', '#f1f1ee', '#7c8890', '#1d3557', '#7a1d1d', '#c8b99a', '#3d4f3a', '#e9e9e6', '#5c6670'];
const CELL = 16;
/** Parked mass relative to a driven car (handbrake on: it is heavy to move). */
const PARKED_MASS = 1.4;
const DRIVEN_MASS = 1;
/** How quickly a shoved car stops (tyres scrubbing, handbrake on), per second. */
const FRICTION = 2.6;
const SPIN_FRICTION = 3.2;
const RESTITUTION = 0.25;

/** What a parked car needs to know about a vehicle that may hit it. */
export interface Pusher {
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  speed: number;
  impact: number;
  readonly radius: number;
}

interface Car {
  x: number;
  z: number;
  y: number;
  rot: number;
  vx: number;
  vz: number;
  w: number;
  L: number;
  W: number;
  van: boolean;
  collider: MovableCollider;
  index: number;
}

/**
 * The cars parked where the LiDAR saw them, as instances that a driven car can
 * shove: on contact the two exchange momentum (a parked car is a little
 * heavier, its handbrake on), the parked car slides and turns and soon stops.
 * People still bump into them (a collider that follows the car).
 */
export class ParkedCars {
  private readonly cars: Car[] = [];
  private readonly grid = new Map<string, Car[]>();
  private readonly awake = new Set<Car>();
  private readonly meshes: { mesh: THREE.InstancedMesh; local: (c: Car) => THREE.Matrix4 | null }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(private readonly ctx: BuildContext) {
    const seen = ctx.map.cars ?? [];
    const step = ctx.quality.detail ? 4 : 8;
    for (let i = 0; i < seen.length; i += step) {
      const seed = i / 4 + 1;
      const x = seen[i],
        z = seen[i + 1],
        rot = seen[i + 2];
      const van = hash01(seed, 9.7) < 0.15;
      const L = van ? 4.7 : 4.2 + hash01(seed) * 0.4,
        W = 1.78;
      const y = ctx.terrain.heightAt(x, z);
      const collider = ctx.collision.addMovableBox(x, y, z, W, L, 1.5, rot, Layer.Player | Layer.Camera);
      const car: Car = { x, z, y, rot, vx: 0, vz: 0, w: 0, L, W, van, collider, index: this.cars.length };
      this.cars.push(car);
      this.cellOf(car).push(car);
    }
    this.build(seen.length > 0 ? step : 4);
  }

  get count(): number {
    return this.cars.length;
  }

  private key(x: number, z: number): string {
    return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  }

  private cellOf(c: Car): Car[] {
    const k = this.key(c.x, c.z);
    return this.grid.get(k) ?? this.grid.set(k, []).get(k)!;
  }

  private build(step: number): void {
    const n = this.cars.length;
    if (!n) return;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const paintMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 });
    const part = (mat: THREE.Material, local: (c: Car) => THREE.Matrix4 | null, colour?: (c: Car) => THREE.Color) => {
      const mesh = new THREE.InstancedMesh(box, mat, n);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'parkedCars';
      if (colour) for (const c of this.cars) mesh.setColorAt(c.index, colour(c));
      this.meshes.push({ mesh, local });
      this.ctx.scene.add(mesh);
    };
    const S = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)),
        new THREE.Vector3(sx, sy, sz),
      );
    const paint = (c: Car) => new THREE.Color(CAR_COLOURS[Math.floor(hash01((c.index * step) / 4 + 1, 3.1) * CAR_COLOURS.length)]);
    part(paintMat, (c) => S(0, 0.62, 0, c.W, 0.55, c.L), paint);
    part(paintMat, (c) => (c.van ? S(0, 1.35, -0.35, c.W - 0.04, 0.95, c.L - 1.0) : S(0, 1.12, -0.2, c.W - 0.12, 0.48, c.L * 0.5)), paint);
    part(new THREE.MeshStandardMaterial({ color: '#1f2a36', roughness: 0.1, metalness: 0.5 }), (c) =>
      c.van ? S(0, 1.4, c.L / 2 - 0.88, c.W - 0.1, 0.6, 0.06, -0.35) : S(0, 1.12, -0.2, c.W - 0.08, 0.38, c.L * 0.5 + 0.06),
    );
    const tyre = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.9 });
    part(tyre, (c) => S(0, 0.32, c.L / 2 - 0.75, c.W - 0.02, 0.62, 0.62));
    part(tyre, (c) => S(0, 0.32, -(c.L / 2 - 0.75), c.W - 0.02, 0.62, 0.62));
    part(new THREE.MeshBasicMaterial({ color: '#ffe9c0' }), (c) => S(0, 0.72, c.L / 2 + 0.005, c.W - 0.4, 0.1, 0.02));
    part(new THREE.MeshBasicMaterial({ color: '#8a1010' }), (c) => S(0, 0.75, -c.L / 2 - 0.005, c.W - 0.3, 0.12, 0.02));
    for (const c of this.cars) this.place(c);
    for (const { mesh } of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  private place(c: Car): void {
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, c.rot);
    const base = new THREE.Matrix4().compose(this.v.set(c.x, c.y, c.z), this.q, this.one);
    for (const { mesh, local } of this.meshes) {
      const l = local(c);
      if (!l) continue;
      this.m.multiplyMatrices(base, l);
      mesh.setMatrixAt(c.index, this.m);
    }
  }

  update(dt: number, vehicles: readonly Pusher[]): void {
    for (const veh of vehicles) {
      if (Math.abs(veh.speed) < 0.3) continue;
      const cx = Math.floor(veh.x / CELL),
        cz = Math.floor(veh.z / CELL);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) for (const c of this.grid.get(`${cx + i},${cz + j}`) ?? []) this.collide(c, veh);
    }
    if (!this.awake.size) return;
    for (const c of this.awake) {
      const before = this.key(c.x, c.z);
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.rot += c.w * dt;
      const k = Math.exp(-FRICTION * dt);
      c.vx *= k;
      c.vz *= k;
      c.w *= Math.exp(-SPIN_FRICTION * dt);
      c.y = this.ctx.terrain.heightAt(c.x, c.z);
      if (this.key(c.x, c.z) !== before) {
        const old = this.grid.get(before);
        if (old) old.splice(old.indexOf(c), 1);
        this.cellOf(c).push(c);
      }
      this.place(c);
      c.collider.setPose(c.x, c.y, c.z, c.rot);
      if (Math.hypot(c.vx, c.vz) < 0.05 && Math.abs(c.w) < 0.02) this.awake.delete(c);
    }
    for (const { mesh } of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  /** The driven car as three circles along its axis against the parked car's box. */
  private collide(c: Car, veh: Pusher): void {
    const fx = Math.sin(veh.heading),
      fz = Math.cos(veh.heading);
    const half = Math.max(0.6, veh.radius - 1.1);
    const r = 0.95;
    const cos = Math.cos(c.rot),
      sin = Math.sin(c.rot);
    for (const o of [half, 0, -half]) {
      const px = veh.x + fx * o,
        pz = veh.z + fz * o;
      // Into the parked car's frame (local +Z = its nose).
      const dx = px - c.x,
        dz = pz - c.z;
      const lx = dx * cos - dz * sin,
        lz = dx * sin + dz * cos;
      const qx = Math.max(-c.W / 2, Math.min(c.W / 2, lx)),
        qz = Math.max(-c.L / 2, Math.min(c.L / 2, lz));
      let nlx = lx - qx,
        nlz = lz - qz;
      let d = Math.hypot(nlx, nlz);
      if (d >= r) continue;
      if (d < 1e-4) {
        // Centre inside the box: push out through the nearest side.
        const ex = c.W / 2 - Math.abs(lx),
          ez = c.L / 2 - Math.abs(lz);
        if (ex < ez) [nlx, nlz] = [Math.sign(lx) || 1, 0];
        else [nlx, nlz] = [0, Math.sign(lz) || 1];
        d = 0;
      } else {
        nlx /= d;
        nlz /= d;
      }
      // Normal back to world (from the parked car towards the driven one).
      const nx = nlx * cos + nlz * sin,
        nz = -nlx * sin + nlz * cos;
      const pen = r - d;
      // Contact point on the parked car, for the spin.
      const cpx = qx * cos + qz * sin,
        cpz = -qx * sin + qz * cos;
      const rvx = veh.vx - (c.vx - c.w * cpz),
        rvz = veh.vz - (c.vz + c.w * cpx);
      const vn = rvx * nx + rvz * nz;
      // Separate first (mostly the parked car moves: the driven one keeps its line).
      veh.x += nx * pen * 0.6;
      veh.z += nz * pen * 0.6;
      c.x -= nx * pen * 0.4;
      c.z -= nz * pen * 0.4;
      if (vn >= 0) continue;
      const j = (-(1 + RESTITUTION) * vn) / (1 / DRIVEN_MASS + 1 / PARKED_MASS);
      veh.vx += (j / DRIVEN_MASS) * nx;
      veh.vz += (j / DRIVEN_MASS) * nz;
      veh.speed = veh.vx * fx + veh.vz * fz;
      veh.impact = Math.max(veh.impact, Math.abs(vn));
      c.vx -= (j / PARKED_MASS) * nx;
      c.vz -= (j / PARKED_MASS) * nz;
      // Off-centre hits turn the car (cross product of the lever arm and the impulse).
      const inertia = (c.L * c.L + c.W * c.W) / 12;
      c.w += ((cpx * -nz - cpz * -nx) * j) / PARKED_MASS / inertia;
      this.awake.add(c);
      return;
    }
  }
}
