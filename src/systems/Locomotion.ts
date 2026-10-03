import type { FollowCamera } from '@/camera/FollowCamera';
import type { Player } from '@/entities/Player';
import type { SkidMarks } from '@/entities/SkidMarks';
import { type DriveControls, PARKED, Vehicle } from '@/entities/Vehicle';
import type { InputActions } from '@/input/InputActions';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { World } from '@/world/World';

const COASTING: DriveControls = { throttle: 0, steer: 0, handbrake: false };

/**
 * Fixed-step movement: turns input actions into drive controls for the
 * player's vehicle (others stay parked) and camera-relative walking for the
 * player on foot, then steps vehicles and the player through the physics world.
 */
export class Locomotion {
  enabled = false;
  private jumpQueued = false;

  constructor(
    private readonly player: Player,
    private readonly vehicles: readonly Vehicle[],
    private readonly world: World,
    private readonly physics: PhysicsWorld,
    private readonly skids: SkidMarks,
    private readonly actions: InputActions,
    private readonly camera: FollowCamera,
  ) {}

  /** Per-frame: latch edge-triggered input so a fixed step never misses it. */
  frame(): void {
    if (this.enabled && this.actions.pressed('jump')) this.jumpQueued = true;
  }

  step(dt: number): void {
    this.physics.step(dt);
    const a = this.actions;
    const drive = this.player.vehicle;
    for (const v of this.vehicles) {
      let c = PARKED;
      if (v === drive) c = this.enabled ? { throttle: a.moveY, steer: a.moveX, handbrake: a.held('handbrake') } : COASTING;
      v.update(dt, c, this.world, this.skids);
    }
    for (let i = 0; i < this.vehicles.length; i++) {
      for (let j = i + 1; j < this.vehicles.length; j++) Vehicle.collidePair(this.vehicles[i], this.vehicles[j]);
    }

    if (drive) {
      this.player.followVehicle();
      this.jumpQueued = false;
      return;
    }
    let mx = 0,
      mz = 0;
    if (this.enabled) {
      // Camera-relative: right = camera forward rotated 90° clockwise seen from above.
      const f = a.moveY,
        s = a.moveX;
      const fw = this.camera.forward();
      mx = fw.x * f - fw.z * s;
      mz = fw.z * f + fw.x * s;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
    }
    this.player.update(dt, { moveX: mx, moveZ: mz, run: this.enabled && a.sprinting, jump: this.jumpQueued }, this.world, this.vehicles);
    this.jumpQueued = false;
  }
}
