import type { EventBus } from '@/core/EventBus';
import type { GameEvents } from '@/core/events';
import type { Player } from '@/entities/Player';
import type { Vehicle } from '@/entities/Vehicle';
import { Layer, type PhysicsWorld } from '@/physics/PhysicsWorld';
import type { World } from '@/world/World';

/** Speed (m/s) above which getting out of a car means rolling on the tarmac. */
const BAIL_OUT_SPEED = 8;

/**
 * Getting in and out of vehicles: finds the nearest car within reach, picks
 * a free exit point (driver side, passenger side, front, back) and announces
 * the change on the event bus.
 */
export class VehicleInteraction {
  constructor(
    private readonly player: Player,
    private readonly vehicles: readonly Vehicle[],
    private readonly world: World,
    private readonly physics: PhysicsWorld,
    private readonly events: EventBus<GameEvents>,
    private readonly reach: number,
  ) {}

  /** The vehicle the player could steal right now, if any. */
  nearest(): Vehicle | null {
    if (this.player.vehicle || this.player.isKnocked) return null;
    const p = this.player.pos;
    let best: Vehicle | null = null;
    let bestD = Infinity;
    for (const v of this.vehicles) {
      if (!v.isNear(p.x, p.z, this.reach) || Math.abs(p.y - v.y) > 2) continue;
      const d = (v.x - p.x) ** 2 + (v.z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  toggle(): void {
    const v = this.player.vehicle;
    if (!v) {
      const near = this.nearest();
      if (near) {
        this.player.enterVehicle(near);
        this.events.emit('vehicle:entered', { vehicle: near });
      }
      return;
    }
    for (const [x, z, facing] of this.exitPoints(v)) {
      const y = this.world.heightAt(x, z);
      if (Math.abs(y - v.y) > 1.2) continue;
      if (this.physics.capsuleBlocked(x, y, z, this.player.radius, this.player.height, Layer.Player)) continue;
      const bailedOut = Math.abs(v.speed) > BAIL_OUT_SPEED;
      this.player.exitVehicle(x, z, y, facing);
      if (bailedOut) this.player.knock(v.vx * 0.5 + Math.sin(facing) * 2, v.vz * 0.5 + Math.cos(facing) * 2, 3);
      this.events.emit('vehicle:exited', { vehicle: v, bailedOut });
      return;
    }
    this.events.emit('hud:flash', { text: 'No hay sitio para salir' });
  }

  private exitPoints(v: Vehicle): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (const side of [1, -1] as const) {
      const p = v.sidePoint(side);
      out.push([p.x, p.z, Math.atan2(p.x - v.x, p.z - v.z)]);
    }
    for (const dir of [1, -1]) {
      const d = (v.spec.length / 2 + 1) * dir;
      out.push([v.x + v.forwardX * d, v.z + v.forwardZ * d, v.heading]);
    }
    return out;
  }
}
