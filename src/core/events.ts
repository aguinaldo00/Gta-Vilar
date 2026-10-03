import type { Vehicle } from '@/entities/Vehicle';

/** Every gameplay event and its payload. */
export interface GameEvents extends Record<string, unknown> {
  'vehicle:entered': { vehicle: Vehicle };
  'vehicle:exited': { vehicle: Vehicle; bailedOut: boolean };
  'vehicle:impact': { vehicle: Vehicle; strength: number };
  'player:respawned': { x: number; z: number };
  'hud:flash': { text: string };
}
