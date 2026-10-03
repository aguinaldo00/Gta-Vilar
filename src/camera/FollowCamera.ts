import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import { type CollisionWorld, Layer } from '../physics/CollisionWorld';
import type { World } from '../world/World';

export interface CameraTarget {
  position: THREE.Vector3;
  /** Heading of the followed body (0 = facing +Z). */
  heading: number;
  speed: number;
  inVehicle: boolean;
  distance: number;
  height: number;
}

const MOUSE_SENS = 0.0024;
const AUTO_CENTER_DELAY = 1.2;

/**
 * Third-person orbit camera. The mouse orbits (yaw/pitch) around a smoothed
 * pivot; in vehicles it pulls back, widens the FOV with speed and swings
 * behind the car when the mouse is idle. A ray against the collision world
 * keeps it from clipping into buildings.
 */
export class FollowCamera {
  yaw = 0;
  pitch = 0.3;
  private dist = 5.5;
  private readonly pivot = new THREE.Vector3();
  private initialized = false;
  private shake = 0;
  private readonly offset = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Forward direction on the ground plane (used for camera-relative movement). */
  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  update(dt: number, mouse: { dx: number; dy: number }, sinceLook: number, t: CameraTarget, collision: CollisionWorld, world: World): void {
    this.yaw -= mouse.dx * MOUSE_SENS;
    this.pitch = clamp(this.pitch + mouse.dy * MOUSE_SENS * 0.85, -0.3, 1.25);

    if (t.inVehicle && sinceLook > AUTO_CENTER_DELAY && Math.abs(t.speed) > 2) {
      this.yaw = dampAngle(this.yaw, t.heading + Math.PI, 2.4, dt);
      this.pitch = damp(this.pitch, 0.2, 1.5, dt);
    }

    const want = t.distance + (t.inVehicle ? Math.min(Math.abs(t.speed) * 0.08, 3.5) : 0);
    this.dist = damp(this.dist, want, 2.5, dt);

    const px = t.position.x,
      py = t.position.y + t.height,
      pz = t.position.z;
    if (!this.initialized) {
      this.pivot.set(px, py, pz);
      this.initialized = true;
    } else {
      const k = t.inVehicle ? 12 : 16;
      this.pivot.x = damp(this.pivot.x, px, k, dt);
      this.pivot.z = damp(this.pivot.z, pz, k, dt);
      this.pivot.y = damp(this.pivot.y, py, 9, dt);
    }

    const cp = Math.cos(this.pitch);
    this.offset.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    let d = this.dist;
    const hit = collision.raycast(
      this.pivot.x,
      this.pivot.y,
      this.pivot.z,
      this.offset.x,
      this.offset.y,
      this.offset.z,
      d + 0.4,
      Layer.Camera,
    );
    if (hit < d + 0.4) d = Math.max(0.8, hit - 0.4);

    const cam = this.camera;
    cam.position.copy(this.pivot).addScaledVector(this.offset, d);
    const floor = world.heightAt(cam.position.x, cam.position.z) + 0.35;
    if (cam.position.y < floor) cam.position.y = floor;

    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake = damp(this.shake, 0, 5, dt);
    }

    const fov = 62 + (t.inVehicle ? clamp(Math.abs(t.speed) / 38, 0, 1) * 14 : 0);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = damp(cam.fov, fov, 3, dt);
      cam.updateProjectionMatrix();
    }
    cam.lookAt(this.pivot.x, this.pivot.y + 0.25, this.pivot.z);
  }
}
