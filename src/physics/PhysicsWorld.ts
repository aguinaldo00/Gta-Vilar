/**
 * Engine-agnostic physics API used by gameplay and world building. The
 * game never touches Rapier types directly, so the backend can be replaced
 * (or the code ported to Godot/Unity physics) without changing gameplay.
 *
 * Conventions: metres, Y up, static colliders are vertical prisms between
 * `bottom` and `top` (boxes rotated around Y, or cylinders).
 */

/** Who a collider blocks (bit mask, see `Layer`). */
export const Layer = {
  Player: 1,
  Vehicle: 2,
  Camera: 4,
  /** Blocks everything. */
  Solid: 7,
  /** Blocks bodies but lets the camera pass (thin props, invisible walls). */
  Bodies: 3,
} as const;

export interface ColliderOptions {
  rot?: number;
  bottom?: number;
  top: number;
  mask?: number;
}

/** Write-only sink for static level geometry (what world builders need). */
export interface StaticColliders {
  addBox(x: number, z: number, w: number, d: number, o: ColliderOptions): void;
  addCircle(x: number, z: number, r: number, o: ColliderOptions): void;
}

/** Regular grid of ground heights (row-major, z rows by x columns). */
export interface HeightGrid {
  minX: number;
  minZ: number;
  cellSize: number;
  cols: number;
  rows: number;
  heights: Float32Array;
}

export interface CharacterMove {
  grounded: boolean;
  /** Horizontal unit normals of the obstacles touched this move. */
  contacts: { nx: number; nz: number }[];
}

/** Kinematic capsule driven by gameplay (position = feet). */
export interface CharacterBody {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  teleport(x: number, y: number, z: number): void;
  /** Slides the capsule by the desired displacement, stepping up kerbs and snapping down slopes. */
  move(dx: number, dy: number, dz: number): CharacterMove;
  setEnabled(on: boolean): void;
}

export interface CharacterOptions {
  radius: number;
  height: number;
  maxStep: number;
  maxSlopeDeg: number;
  mask: number;
}

export interface PhysicsWorld extends StaticColliders {
  setTerrain(grid: HeightGrid): void;
  createCharacter(o: CharacterOptions): CharacterBody;
  /** Distance to the first hit along a unit direction, or `maxT`. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, mask: number): number;
  /** Whether a standing capsule (feet at y, kerbs under knee height ignored) would overlap anything that blocks `mask`. */
  capsuleBlocked(x: number, y: number, z: number, radius: number, height: number, mask: number): boolean;
  /** Finalises queued changes; call once per fixed step. */
  step(dt: number): void;
}

/** Sends static colliders to several backends (used while systems migrate). */
export class ColliderFanout implements StaticColliders {
  constructor(private readonly sinks: StaticColliders[]) {}

  addBox(x: number, z: number, w: number, d: number, o: ColliderOptions): void {
    for (const s of this.sinks) s.addBox(x, z, w, d, o);
  }

  addCircle(x: number, z: number, r: number, o: ColliderOptions): void {
    for (const s of this.sinks) s.addCircle(x, z, r, o);
  }
}
