import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import { mergeColoured } from '../core/mergeColored';
import { type CollisionWorld, type Contact, Layer } from '../physics/CollisionWorld';
import { BOUNDS } from '../world/mapData';
import type { World } from '../world/World';
import type { Vehicle } from './Vehicle';

export type PlayerState = 'idle' | 'walk' | 'run' | 'jump' | 'wade' | 'swim' | 'knocked' | 'driving';

export interface PlayerInput {
  /** Desired move direction in world space (length 0..1). */
  moveX: number;
  moveZ: number;
  run: boolean;
  jump: boolean;
}

const WALK_SPEED = 3.6;
const RUN_SPEED = 7.8;
const SWIM_SPEED = 2.4;
const GRAVITY = 24;
const JUMP_SPEED = 8.4;
const STEP_HEIGHT = 0.45;
const SWIM_DEPTH = 1.25;
const KNOCK_SPEED = 6;

/**
 * Blocky low-poly avatar. Movement is a kinematic capsule (circle + height)
 * resolved against the static collision world; animation is a cheap
 * procedural limb swing driven by ground speed.
 */
export class Player {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly radius = 0.38;
  readonly height = 1.8;
  facing = 0;
  state: PlayerState = 'idle';
  grounded = true;
  vehicle: Vehicle | null = null;

  private readonly body = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private phase = 0;
  private knockTimer = 0;
  private tumble = 0;
  private readonly contacts: Contact[] = [];

  constructor() {
    const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c });
    const skin = mat('#d9a47e');
    const shirt = mat('#f1f1ec');
    const jacket = mat('#7c2d22');
    const jeans = mat('#2f4a74');
    const shoes = mat('#3a2a1e');
    const hair = mat('#2b1d14');
    const part = (parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Hip pivot at y = 0.95 so the body can lean / swim.
    this.body.position.y = 0.95;
    this.root.add(this.body);
    part(this.body, 0.56, 0.62, 0.3, jacket, 0, 0.31, 0);
    part(this.body, 0.3, 0.5, 0.02, shirt, 0, 0.33, 0.16);
    part(this.body, 0.14, 0.08, 0.14, skin, 0, 0.66, 0);
    part(this.body, 0.3, 0.32, 0.3, skin, 0, 0.84, 0);
    part(this.body, 0.32, 0.1, 0.32, hair, 0, 1.03, -0.01);
    part(this.body, 0.32, 0.18, 0.06, hair, 0, 0.92, -0.14);
    part(this.body, 0.2, 0.05, 0.02, mat('#111111'), 0, 0.88, 0.151); // shades

    for (const [arm, side] of [
      [this.armL, 1],
      [this.armR, -1],
    ] as const) {
      arm.position.set(side * 0.36, 0.55, 0);
      this.body.add(arm);
      part(arm, 0.16, 0.42, 0.18, jacket, 0, -0.2, 0);
      part(arm, 0.13, 0.2, 0.14, skin, 0, -0.5, 0);
    }
    for (const [leg, side] of [
      [this.legL, 1],
      [this.legR, -1],
    ] as const) {
      leg.position.set(side * 0.14, 0, 0);
      this.body.add(leg);
      part(leg, 0.22, 0.86, 0.24, jeans, 0, -0.43, 0);
      part(leg, 0.22, 0.1, 0.32, shoes, 0, -0.9, 0.05);
    }
    for (const g of [this.body, this.armL, this.armR, this.legL, this.legR]) mergeColoured(g);
  }

  spawn(x: number, z: number, y: number, facing: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.sync();
  }

  enterVehicle(v: Vehicle): void {
    this.vehicle = v;
    this.state = 'driving';
    this.root.visible = false;
    v.setDriven(true);
  }

  exitVehicle(x: number, z: number, y: number, facing: number): void {
    const v = this.vehicle;
    if (v) v.setDriven(false);
    this.vehicle = null;
    this.root.visible = true;
    this.state = 'idle';
    this.spawn(x, z, y, facing);
    this.grounded = true;
  }

  /** Sends the player tumbling (hit by a car or bailing out at speed). */
  knock(vx: number, vz: number, up = 5): void {
    this.vel.set(vx, up, vz);
    this.grounded = false;
    this.knockTimer = 1.6;
    this.state = 'knocked';
  }

  get isKnocked(): boolean {
    return this.knockTimer > 0;
  }

  /** Follows the driven vehicle so zone detection and the minimap stay correct. */
  followVehicle(): void {
    const v = this.vehicle;
    if (!v) return;
    this.pos.set(v.x, v.y, v.z);
    this.facing = v.heading;
  }

  private groundHeight(world: World, collision: CollisionWorld, step: number): number {
    const support = collision.supportHeight(this.pos.x, this.pos.z, 0.2, Layer.Player, this.pos.y, step);
    return Math.max(world.heightAt(this.pos.x, this.pos.z), support);
  }

  update(dt: number, input: PlayerInput, world: World, collision: CollisionWorld, vehicles: Vehicle[]): void {
    if (this.vehicle) return;
    const knocked = this.knockTimer > 0;
    if (knocked) this.knockTimer -= dt;

    const waterY = world.waterAt(this.pos.x, this.pos.z);
    let ground = this.groundHeight(world, collision, STEP_HEIGHT);
    const depth = waterY === null ? 0 : waterY - ground;
    const swimming = depth > SWIM_DEPTH && this.pos.y <= waterY! - SWIM_DEPTH + 0.3;
    const wading = !swimming && depth > 0.3;

    // Horizontal velocity: steer towards the desired velocity.
    let speed = input.run ? RUN_SPEED : WALK_SPEED;
    if (wading) speed *= 0.55;
    if (swimming) speed = SWIM_SPEED;
    const mx = knocked ? 0 : input.moveX;
    const mz = knocked ? 0 : input.moveZ;
    const accel = knocked ? (this.grounded ? 3 : 0.3) : this.grounded || swimming ? 14 : 3;
    this.vel.x = damp(this.vel.x, mx * speed, accel, dt);
    this.vel.z = damp(this.vel.z, mz * speed, accel, dt);

    // Vertical.
    if (swimming) {
      this.vel.y = 0;
      this.pos.y = damp(this.pos.y, waterY! - SWIM_DEPTH - 0.05 + Math.sin(performance.now() / 400) * 0.04, 6, dt);
      this.grounded = false;
    } else {
      if (input.jump && this.grounded && !knocked) {
        this.vel.y = JUMP_SPEED;
        this.grounded = false;
      }
      this.vel.y -= GRAVITY * dt;
    }

    // Move + collide horizontally.
    const step = swimming ? waterY! + 0.6 - this.pos.y : this.grounded ? STEP_HEIGHT : 0.2;
    this.contacts.length = 0;
    const r = collision.resolveCircle(
      this.pos.x + this.vel.x * dt,
      this.pos.z + this.vel.z * dt,
      this.radius,
      Layer.Player,
      this.pos.y,
      this.height,
      step,
      this.contacts,
    );
    for (const c of this.contacts) {
      const vn = this.vel.x * c.nx + this.vel.z * c.nz;
      if (vn < 0) {
        this.vel.x -= vn * c.nx;
        this.vel.z -= vn * c.nz;
      }
    }
    const p = { x: r.x, z: r.z };
    for (const v of vehicles) {
      const hit = v.pushPedestrian(p, this.radius, this.pos.y);
      if (!hit.hit) continue;
      if (hit.speed > KNOCK_SPEED && !knocked) {
        this.knock(v.vx * 0.7 + hit.nx * 3, v.vz * 0.7 + hit.nz * 3, 4 + hit.speed * 0.25);
        v.impact = Math.max(v.impact, hit.speed * 0.3);
      } else {
        const vn = this.vel.x * hit.nx + this.vel.z * hit.nz;
        if (vn < 0) {
          this.vel.x -= vn * hit.nx;
          this.vel.z -= vn * hit.nz;
        }
      }
    }
    this.pos.x = clamp(p.x, BOUNDS.minX + 1, BOUNDS.maxX - 1);
    this.pos.z = clamp(p.z, BOUNDS.minZ + 1, BOUNDS.maxZ - 1);

    // Ground snapping / landing.
    if (!swimming) {
      ground = this.groundHeight(world, collision, this.grounded ? STEP_HEIGHT : 0.05);
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.vel.y = 0;
        this.grounded = true;
      } else if (this.grounded && this.pos.y - ground < 0.4 && this.vel.y <= 0) {
        this.pos.y = ground; // stick to slopes and step down curbs
        this.vel.y = 0;
      } else this.grounded = false;
    }

    // Face the direction of travel.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (!knocked && Math.hypot(mx, mz) > 0.1) this.facing = dampAngle(this.facing, Math.atan2(mx, mz), 12, dt);

    // State machine.
    if (this.knockTimer > 0) this.state = 'knocked';
    else if (swimming) this.state = 'swim';
    else if (!this.grounded) this.state = 'jump';
    else if (wading && hs > 0.3) this.state = 'wade';
    else if (hs > (WALK_SPEED + RUN_SPEED) / 2 - 0.5) this.state = 'run';
    else if (hs > 0.3) this.state = 'walk';
    else this.state = 'idle';

    this.animate(dt, hs);
    this.sync();
  }

  private animate(dt: number, hs: number): void {
    const st = this.state;
    let legSwing = 0,
      armSwing = 0,
      lean = 0,
      armLift = 0,
      legBend = 0;
    if (st === 'walk' || st === 'run' || st === 'wade') {
      this.phase += hs * dt * (st === 'run' ? 1.6 : 2.4);
      const amp = st === 'run' ? 0.95 : 0.6;
      legSwing = Math.sin(this.phase) * amp;
      armSwing = -Math.sin(this.phase) * amp * 0.85;
      lean = st === 'run' ? 0.22 : 0.05;
    } else if (st === 'jump') {
      armLift = -2.4;
      legBend = 0.5;
    } else if (st === 'swim') {
      this.phase += dt * 5;
      lean = 1.35;
      armSwing = 0;
    } else if (st === 'idle') {
      this.phase += dt * 1.5;
      armLift = Math.sin(this.phase) * 0.03;
    }

    const k = 14;
    if (st === 'swim') {
      this.armL.rotation.x = (this.phase % (Math.PI * 2)) - Math.PI;
      this.armR.rotation.x = ((this.phase + Math.PI) % (Math.PI * 2)) - Math.PI;
      this.legL.rotation.x = Math.sin(this.phase * 2) * 0.3;
      this.legR.rotation.x = -Math.sin(this.phase * 2) * 0.3;
    } else {
      this.legL.rotation.x = damp(this.legL.rotation.x, legSwing + legBend, k, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, -legSwing - legBend * 0.4, k, dt);
      this.armL.rotation.x = damp(this.armL.rotation.x, armSwing + armLift, k, dt);
      this.armR.rotation.x = damp(this.armR.rotation.x, -armSwing + armLift, k, dt);
    }
    this.body.rotation.x = damp(this.body.rotation.x, lean, 8, dt);

    if (st === 'knocked') {
      this.tumble += dt * (this.grounded ? 2 : 9);
      this.body.rotation.x = this.grounded ? damp(this.body.rotation.x, -1.45, 6, dt) : this.tumble;
      this.body.position.y = this.grounded ? damp(this.body.position.y, 0.25, 8, dt) : 0.95;
    } else {
      this.tumble = 0;
      this.body.position.y = damp(this.body.position.y, st === 'swim' ? 0.6 : 0.95, 10, dt);
    }
  }

  private sync(): void {
    this.root.position.copy(this.pos);
    this.root.position.y += 0.05; // stand on top of the road/pavement surface layers
    this.root.rotation.y = this.facing;
  }
}
