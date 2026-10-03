import * as THREE from 'three';
import { approach, clamp, damp, lerp, wrapAngle } from '../core/math';
import { type CollisionWorld, type Contact, Layer } from '../physics/CollisionWorld';
import type { World } from '../world/World';
import type { SkidMarks } from './SkidMarks';
import { type VehicleRig, buildVehicleModel, updateWheelInstances } from './VehicleModels';
import { SPECS, type VehicleKind, type VehicleSpec } from './vehicleSpecs';

export interface DriveControls {
  /** -1 (reverse/brake) .. 1 (accelerate). */
  throttle: number;
  /** -1 (left) .. 1 (right). */
  steer: number;
  handbrake: boolean;
}

export const PARKED: DriveControls = { throttle: 0, steer: 0, handbrake: true };

/** Terrain the wheels refuse: river channel and steep edge hills. */
const MIN_DRIVABLE = -0.35;
const MAX_DRIVABLE = 1.6;
const RESTITUTION = 0.25;

/**
 * Arcade car model on the XZ plane. Velocity is split into forward and
 * lateral components every step: throttle/brake act on the forward part,
 * grip bleeds off the lateral part. Low grip (handbrake, sharp turns at speed)
 * lets the heading rotate faster than the velocity follows → drifting.
 */
export class Vehicle {
  readonly spec: VehicleSpec;
  readonly rig: VehicleRig;
  x: number;
  z: number;
  y = 0;
  heading: number;
  vx = 0;
  vz = 0;
  yawRate = 0;
  steer = 0;
  /** Signed forward speed (m/s). */
  speed = 0;
  /** Lateral (sliding) speed (m/s). */
  slip = 0;
  throttle = 0;
  braking = false;
  skidding = false;
  /** Strongest impact this frame (m/s), consumed by camera shake / audio. */
  impact = 0;
  driven = false;

  readonly radius: number;
  readonly offsets: number[];
  private accelLong = 0;
  private pitch = 0;
  private roll = 0;
  private readonly contacts: Contact[] = [];
  private readonly lastSkid: ({ x: number; z: number } | null)[] = [null, null];

  constructor(kind: VehicleKind, color: string, x: number, z: number, heading: number) {
    this.spec = SPECS[kind];
    this.rig = buildVehicleModel(kind, color);
    this.x = x;
    this.z = z;
    this.heading = heading;
    // Body approximated by circles along its length.
    this.radius = this.spec.width / 2;
    const span = this.spec.length / 2 - this.radius;
    const n = Math.max(2, Math.ceil((2 * span) / (this.radius * 1.3)) + 1);
    this.offsets = Array.from({ length: n }, (_, i) => -span + (2 * span * i) / (n - 1));
  }

  get forwardX(): number {
    return Math.sin(this.heading);
  }

  get forwardZ(): number {
    return Math.cos(this.heading);
  }

  get speedKmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  setDriven(driven: boolean): void {
    this.driven = driven;
    this.rig.driver.visible = driven;
  }

  update(dt: number, c: DriveControls, world: World, collision: CollisionWorld, skids: SkidMarks): void {
    const s = this.spec;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = -fz; // right-hand side of the vehicle
    const rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * rx + this.vz * rz;
    const prevVF = vF;
    this.throttle = c.throttle;

    // Longitudinal: engine, brakes, reverse, rolling resistance.
    this.braking = false;
    if (c.throttle > 0) {
      if (vF < -0.5) {
        vF = approach(vF, 0, s.brake * dt);
        this.braking = true;
      } else vF += s.accel * c.throttle * Math.max(0, 1 - vF / s.maxSpeed) * dt;
    } else if (c.throttle < 0) {
      if (vF > 0.5) {
        vF = approach(vF, 0, s.brake * dt);
        this.braking = true;
      } else vF -= s.accel * 0.7 * -c.throttle * Math.max(0, 1 + vF / s.maxReverse) * dt;
    } else vF = approach(vF, 0, s.rolling * dt);
    if (c.handbrake) {
      vF = approach(vF, 0, s.brake * 0.45 * dt);
      this.braking = this.braking || Math.abs(vF) > 0.5;
    }

    // Steering: bicycle model yaw rate, lock reduced at speed.
    this.steer = approach(this.steer, c.steer, s.steerSpeed * dt);
    const angle = (this.steer * s.steerMax) / (1 + Math.abs(vF) * s.steerFalloff);
    let targetYaw = (-vF * Math.tan(angle)) / s.wheelBase;
    if (c.handbrake && Math.abs(vF) > 3) targetYaw *= 1.7;
    targetYaw = clamp(targetYaw, -s.maxYawRate, s.maxYawRate);
    this.yawRate = damp(this.yawRate, targetYaw, c.handbrake ? 4 : 8, dt);

    // Lateral grip: handbrake or a hard turn at speed lets the tail slide out.
    let grip = s.grip;
    const sharpTurn = Math.abs(this.steer) > 0.7 && Math.abs(vF) > s.maxSpeed * 0.5;
    if (c.handbrake) grip = s.driftGrip;
    else if (sharpTurn) grip = lerp(s.grip, s.driftGrip, 0.6);
    vL *= Math.exp(-grip * dt);
    // Sliding sideways scrubs speed.
    vF = approach(vF, 0, Math.abs(vL) * 0.25 * dt);

    this.vx = fx * vF + rx * vL;
    this.vz = fz * vF + rz * vL;
    this.speed = vF;
    this.slip = vL;
    this.accelLong = damp(this.accelLong, (vF - prevVF) / dt, 8, dt);

    // Integrate, then resolve against the world.
    const px = this.x,
      pz = this.z,
      ph = this.heading;
    this.heading = wrapAngle(this.heading + this.yawRate * dt);
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.resolveStatic(collision);
    this.resolveTerrain(world, px, pz, ph);
    this.updatePose(world, dt);
    this.updateSkids(skids, c);
  }

  /** Pushes every body circle out of static colliders and applies a bounce impulse. */
  private resolveStatic(collision: CollisionWorld): void {
    for (let it = 0; it < 2; it++) {
      let hit = false;
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      for (const o of this.offsets) {
        const cx = this.x + fx * o;
        const cz = this.z + fz * o;
        this.contacts.length = 0;
        const r = collision.resolveCircle(cx, cz, this.radius, Layer.Vehicle, this.y, this.spec.height, 0.3, this.contacts);
        if (this.contacts.length === 0) continue;
        this.x += r.x - cx;
        this.z += r.z - cz;
        for (const ct of this.contacts) this.applyImpulse(ct.nx, ct.nz, o, RESTITUTION, Infinity);
        hit = true;
      }
      if (!hit) break;
    }
  }

  /** Impulse at a body circle `offset` metres along the vehicle axis. */
  applyImpulse(nx: number, nz: number, offset: number, e: number, otherMass: number): number {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rX = fx * offset;
    const rZ = fz * offset;
    // Velocity of the contact point: v + ω × r.
    const pvx = this.vx + this.yawRate * rZ;
    const pvz = this.vz - this.yawRate * rX;
    const vn = pvx * nx + pvz * nz;
    if (vn >= 0) return 0;
    const invI = 12 / (this.spec.length * this.spec.length + this.spec.width * this.spec.width);
    const rCrossN = rZ * nx - rX * nz;
    const massFactor = Number.isFinite(otherMass) ? otherMass / (this.spec.mass + otherMass) : 1;
    const j = (-(1 + e) * vn * massFactor) / (1 + rCrossN * rCrossN * invI);
    this.vx += j * nx;
    this.vz += j * nz;
    this.yawRate += j * rCrossN * invI * 0.6;
    // Friction along the wall.
    const tx = -nz,
      tz = nx;
    const vt = this.vx * tx + this.vz * tz;
    this.vx -= tx * vt * 0.15;
    this.vz -= tz * vt * 0.15;
    this.impact = Math.max(this.impact, -vn);
    return -vn;
  }

  /** Keeps the wheels out of the river and off the steep boundary hills. */
  private resolveTerrain(world: World, px: number, pz: number, ph: number): void {
    const s = this.spec;
    const fx = Math.sin(this.heading),
      fz = Math.cos(this.heading);
    const hl = s.length / 2,
      hw = s.width / 2;
    for (const [a, b] of [
      [hl, hw],
      [hl, -hw],
      [-hl, hw],
      [-hl, -hw],
    ]) {
      const x = this.x + fx * a - fz * b;
      const z = this.z + fz * a + fx * b;
      const h = world.heightAt(x, z);
      if (h >= MIN_DRIVABLE && h <= MAX_DRIVABLE) continue;
      // Normal from the height gradient: uphill out of the river, downhill off the hills.
      const e = 0.5;
      let nx = world.heightAt(x + e, z) - world.heightAt(x - e, z);
      let nz = world.heightAt(x, z + e) - world.heightAt(x, z - e);
      if (h > MAX_DRIVABLE) {
        nx = -nx;
        nz = -nz;
      }
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      const prevH = world.heightAt(px, pz);
      if (prevH < MIN_DRIVABLE || prevH > MAX_DRIVABLE) {
        // Already off the drivable ground (e.g. dropped into the riverbed): crawl out uphill.
        this.x += nx * 0.08;
        this.z += nz * 0.08;
        this.vx *= 0.9;
        this.vz *= 0.9;
        return;
      }
      this.x = px;
      this.z = pz;
      this.heading = ph;
      this.applyImpulse(nx, nz, a, 0.3, Infinity);
      return;
    }
  }

  private updatePose(world: World, dt: number): void {
    const s = this.spec;
    const fx = Math.sin(this.heading),
      fz = Math.cos(this.heading);
    const hb = s.wheelBase / 2,
      ht = s.width / 2 - 0.15;
    const sample = (a: number, b: number) => world.heightAt(this.x + fx * a - fz * b, this.z + fz * a + fx * b);
    // b > 0 samples the right-hand side (local -X).
    const fR = sample(hb, ht),
      fL = sample(hb, -ht),
      rR = sample(-hb, ht),
      rL = sample(-hb, -ht);
    const target = (fR + fL + rR + rL) / 4;
    this.y = target > this.y ? damp(this.y, target, 25, dt) : damp(this.y, target, 12, dt);
    this.pitch = damp(this.pitch, Math.atan2((fR + fL - rR - rL) / 2, s.wheelBase), 10, dt);
    this.roll = damp(this.roll, Math.atan2((fL + rL - fR - rR) / 2, s.width), 10, dt);

    const root = this.rig.root;
    root.position.set(this.x, this.y + 0.04, this.z); // tyres on top of the road surface layers
    root.rotation.set(-this.pitch, this.heading, this.roll, 'YXZ');
    // Body weight transfer: squat under acceleration, lean out of corners.
    const body = this.rig.body;
    body.rotation.x = damp(body.rotation.x, clamp(-this.accelLong * 0.004, -0.06, 0.06), 8, dt);
    body.rotation.z = damp(body.rotation.z, clamp(this.yawRate * this.speed * 0.006, -0.08, 0.08), 8, dt);

    for (const w of this.rig.wheels) {
      w.spin.rotation.x += (this.speed / w.r) * dt;
      if (w.front) w.pivot.rotation.y = -this.steer * s.steerMax * 0.8;
    }
    updateWheelInstances(this.rig);
    this.rig.brakeMat.emissiveIntensity = this.braking || this.throttle < 0 ? 1.6 : 0.15;
  }

  private updateSkids(skids: SkidMarks, c: DriveControls): void {
    const s = this.spec;
    this.skidding =
      (Math.abs(this.slip) > 2.5 || (c.handbrake && Math.abs(this.speed) > 4) || (this.braking && Math.abs(this.speed) > 14)) &&
      s.kind !== 'tractor';
    const fx = Math.sin(this.heading),
      fz = Math.cos(this.heading);
    const rear = this.rig.wheels.filter((w) => !w.front);
    rear.forEach((w, i) => {
      if (!this.skidding) {
        this.lastSkid[i] = null;
        return;
      }
      // Local (w.x, w.z) → world; local +X is (cos h, -sin h).
      const x = this.x + fz * w.x + fx * w.z;
      const z = this.z - fx * w.x + fz * w.z;
      const last = this.lastSkid[i];
      if (!last) this.lastSkid[i] = { x, z };
      else if ((x - last.x) ** 2 + (z - last.z) ** 2 > 0.36) {
        skids.add(last.x, last.z, x, z, this.y, 0.24);
        this.lastSkid[i] = { x, z };
      }
    });
  }

  /** Circle–circle push between two vehicles with a mass-weighted impulse. */
  static collidePair(a: Vehicle, b: Vehicle): void {
    const reach = (a.spec.length + b.spec.length) / 2 + 0.5;
    if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > reach * reach) return;
    for (const oa of a.offsets) {
      for (const ob of b.offsets) {
        const ax = a.x + a.forwardX * oa,
          az = a.z + a.forwardZ * oa;
        const bx = b.x + b.forwardX * ob,
          bz = b.z + b.forwardZ * ob;
        let nx = ax - bx,
          nz = az - bz;
        const d = Math.hypot(nx, nz);
        const overlap = a.radius + b.radius - d;
        if (overlap <= 0) continue;
        if (d < 1e-4) {
          nx = 1;
          nz = 0;
        } else {
          nx /= d;
          nz /= d;
        }
        const total = a.spec.mass + b.spec.mass;
        const ka = b.spec.mass / total,
          kb = a.spec.mass / total;
        a.x += nx * overlap * ka;
        a.z += nz * overlap * ka;
        b.x -= nx * overlap * kb;
        b.z -= nz * overlap * kb;
        const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (rel >= 0) continue;
        const j = (-(1 + 0.3) * rel) / (1 / a.spec.mass + 1 / b.spec.mass);
        a.vx += (j / a.spec.mass) * nx;
        a.vz += (j / a.spec.mass) * nz;
        b.vx -= (j / b.spec.mass) * nx;
        b.vz -= (j / b.spec.mass) * nz;
        a.yawRate += ((oa * (a.forwardZ * nx - a.forwardX * nz) * j) / a.spec.mass) * 0.15;
        b.yawRate -= ((ob * (b.forwardZ * nx - b.forwardX * nz) * j) / b.spec.mass) * 0.15;
        a.impact = Math.max(a.impact, -rel);
        b.impact = Math.max(b.impact, -rel);
      }
    }
  }

  /**
   * Pushes a pedestrian circle out of this vehicle. Returns the speed at
   * which the vehicle was moving into the pedestrian (0 when no contact).
   */
  pushPedestrian(p: { x: number; z: number }, r: number, feetY: number): { hit: boolean; nx: number; nz: number; speed: number } {
    const res = { hit: false, nx: 0, nz: 0, speed: 0 };
    if (feetY > this.y + this.spec.height - 0.3) return res;
    for (const o of this.offsets) {
      const cx = this.x + this.forwardX * o,
        cz = this.z + this.forwardZ * o;
      let nx = p.x - cx,
        nz = p.z - cz;
      const d = Math.hypot(nx, nz);
      const overlap = this.radius + r - d;
      if (overlap <= 0) continue;
      nx = d > 1e-4 ? nx / d : 1;
      nz = d > 1e-4 ? nz / d : 0;
      p.x += nx * overlap;
      p.z += nz * overlap;
      const pvx = this.vx + this.yawRate * this.forwardZ * o;
      const pvz = this.vz - this.yawRate * this.forwardX * o;
      res.hit = true;
      res.nx = nx;
      res.nz = nz;
      res.speed = Math.max(res.speed, pvx * nx + pvz * nz);
    }
    return res;
  }

  /** Is (x, z) within reach of a door? */
  isNear(x: number, z: number, reach: number): boolean {
    const dx = x - this.x,
      dz = z - this.z;
    const fx = this.forwardX,
      fz = this.forwardZ;
    const along = dx * fx + dz * fz;
    const side = dx * fz - dz * fx;
    return Math.abs(along) < this.spec.length / 2 + reach && Math.abs(side) < this.spec.width / 2 + reach;
  }

  /** World position of a point on the driver's (left, +X local) or passenger side. */
  sidePoint(side: 1 | -1, out = new THREE.Vector3()): THREE.Vector3 {
    const d = (this.spec.width / 2 + 0.9) * side;
    return out.set(this.x + this.forwardZ * d, this.y, this.z - this.forwardX * d);
  }
}
