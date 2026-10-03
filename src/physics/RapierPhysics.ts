import RAPIER from '@dimforge/rapier3d-compat';
import {
  type CharacterBody,
  type CharacterMove,
  type CharacterOptions,
  type ColliderOptions,
  type HeightGrid,
  Layer,
  type PhysicsWorld,
  type VehicleBody,
  type VehicleContact,
  type VehicleOptions,
} from './PhysicsWorld';

const ALL = 0xffff;
/** Static colliders: member of the layers they block, interact with every query. */
const staticGroups = (mask: number) => ((mask & ALL) << 16) | ALL;
/** Queries: member of every layer, only hit colliders that block `mask`. */
const queryGroups = (mask: number) => (ALL << 16) | (mask & ALL);
const DEFAULT_BOTTOM = -10;
/** Obstacles lower than this above the feet do not block a standing capsule. */
const STEP_CLEARANCE = 0.45;

let ready: Promise<void> | null = null;

/** Loads the Rapier WASM module once (call before constructing RapierPhysics). */
export function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

class RapierCharacter implements CharacterBody {
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly halfHeight: number;
  private readonly groups: number;
  private readonly move3 = { x: 0, y: 0, z: 0 };
  private readonly result: CharacterMove = { grounded: false, contacts: [] };

  constructor(world: RAPIER.World, o: CharacterOptions) {
    this.halfHeight = o.height / 2;
    this.groups = queryGroups(o.mask);
    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(o.maxStep, 0.15, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((o.maxSlopeDeg * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle(((o.maxSlopeDeg + 5) * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    // The character is not part of any layer, so other queries ignore it.
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(this.halfHeight - o.radius, o.radius).setCollisionGroups(0),
      this.body,
    );
  }

  get x(): number {
    return this.body.translation().x;
  }
  get y(): number {
    return this.body.translation().y - this.halfHeight;
  }
  get z(): number {
    return this.body.translation().z;
  }

  teleport(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y: y + this.halfHeight, z }, true);
    this.collider.setTranslation({ x, y: y + this.halfHeight, z });
  }

  setEnabled(on: boolean): void {
    this.body.setEnabled(on);
  }

  move(dx: number, dy: number, dz: number): CharacterMove {
    this.move3.x = dx;
    this.move3.y = dy;
    this.move3.z = dz;
    this.controller.computeColliderMovement(this.collider, this.move3, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.groups);
    const m = this.controller.computedMovement();
    const p = this.body.translation();
    const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
    this.body.setTranslation(next, true);
    this.collider.setTranslation(next);
    this.result.grounded = this.controller.computedGrounded();
    this.result.contacts.length = 0;
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const c = this.controller.computedCollision(i);
      if (!c) continue;
      const n = c.normal1;
      const h = Math.hypot(n.x, n.z);
      // Ignore floors (mostly vertical normals); keep walls for velocity clipping.
      if (h > 0.5) this.result.contacts.push({ nx: n.x / h, nz: n.z / h });
    }
    return this.result;
  }
}

class RapierVehicle implements VehicleBody {
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly groups: number;
  private readonly lift: number;
  private readonly delta = { x: 0, y: 0, z: 0 };
  private readonly result = { x: 0, z: 0, contacts: [] as VehicleContact[] };

  constructor(world: RAPIER.World, o: VehicleOptions) {
    const h = Math.max(0.2, o.height - o.clearance);
    this.lift = o.clearance + h / 2;
    this.groups = queryGroups(o.mask);
    this.controller = world.createCharacterController(0.03);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(o.width / 2, h / 2, o.length / 2).setCollisionGroups(0), this.body);
  }

  private place(x: number, z: number, heading: number, y: number): void {
    const t = { x, y: y + this.lift, z };
    const q = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
    this.body.setTranslation(t, true);
    this.body.setRotation(q, true);
    this.collider.setTranslation(t);
    this.collider.setRotation(q);
  }

  move(x: number, z: number, dx: number, dz: number, heading: number, y: number): { x: number; z: number; contacts: VehicleContact[] } {
    this.place(x, z, heading, y);
    this.delta.x = dx;
    this.delta.z = dz;
    this.controller.computeColliderMovement(this.collider, this.delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.groups);
    const m = this.controller.computedMovement();
    const r = this.result;
    r.x = x + m.x;
    r.z = z + m.z;
    this.place(r.x, r.z, heading, y);
    r.contacts.length = 0;
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const c = this.controller.computedCollision(i);
      if (!c) continue;
      const h = Math.hypot(c.normal1.x, c.normal1.z);
      if (h < 0.5) continue;
      r.contacts.push({ nx: c.normal1.x / h, nz: c.normal1.z / h, px: c.witness1.x, pz: c.witness1.z });
    }
    return r;
  }
}

/** PhysicsWorld backed by Rapier (static level geometry, terrain heightfield, kinematic characters, queries). */
export class RapierPhysics implements PhysicsWorld {
  readonly world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private terrain: RAPIER.Collider | null = null;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private dirty = true;

  addBox(x: number, z: number, w: number, d: number, o: ColliderOptions): void {
    const bottom = o.bottom ?? DEFAULT_BOTTOM;
    const h = Math.max(0.01, o.top - bottom);
    const rot = o.rot ?? 0;
    const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
      .setTranslation(x, bottom + h / 2, z)
      .setRotation({ x: 0, y: Math.sin(rot / 2), z: 0, w: Math.cos(rot / 2) })
      .setCollisionGroups(staticGroups(o.mask ?? 7));
    this.world.createCollider(desc);
    this.dirty = true;
  }

  addCircle(x: number, z: number, r: number, o: ColliderOptions): void {
    const bottom = o.bottom ?? DEFAULT_BOTTOM;
    const h = Math.max(0.01, o.top - bottom);
    const desc = RAPIER.ColliderDesc.cylinder(h / 2, r)
      .setTranslation(x, bottom + h / 2, z)
      .setCollisionGroups(staticGroups(o.mask ?? 3));
    this.world.createCollider(desc);
    this.dirty = true;
  }

  setTerrain(g: HeightGrid): void {
    if (this.terrain) this.world.removeCollider(this.terrain, false);
    // Rapier heightfields are column-major (x columns of z rows) and centred on their origin.
    const nrows = g.rows - 1,
      ncols = g.cols - 1;
    const heights = new Float32Array(g.rows * g.cols);
    for (let c = 0; c < g.cols; c++) for (let r = 0; r < g.rows; r++) heights[c * g.rows + r] = g.heights[r * g.cols + c];
    const sx = ncols * g.cellSize,
      sz = nrows * g.cellSize;
    const desc = RAPIER.ColliderDesc.heightfield(nrows, ncols, heights, { x: sx, y: 1, z: sz })
      .setTranslation(g.minX + sx / 2, 0, g.minZ + sz / 2)
      // Vehicles follow the terrain analytically (ride height and tilt), so the ground never blocks them.
      .setCollisionGroups(staticGroups(Layer.Player | Layer.Camera));
    this.terrain = this.world.createCollider(desc);
    this.dirty = true;
  }

  createVehicle(o: VehicleOptions): VehicleBody {
    return new RapierVehicle(this.world, o);
  }

  createCharacter(o: CharacterOptions): CharacterBody {
    return new RapierCharacter(this.world, o);
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, mask: number): number {
    this.sync();
    this.ray.origin = { x: ox, y: oy, z: oz };
    this.ray.dir = { x: dx, y: dy, z: dz };
    const hit = this.world.castRay(this.ray, maxT, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups(mask));
    return hit ? hit.timeOfImpact : maxT;
  }

  capsuleBlocked(x: number, y: number, z: number, radius: number, height: number, mask: number): boolean {
    this.sync();
    const shape = new RAPIER.Capsule(height / 2 - radius, radius);
    // Lift the capsule by a step so the ground and kerbs under its feet do not count.
    const hit = this.world.intersectionWithShape(
      { x, y: y + height / 2 + STEP_CLEARANCE, z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      queryGroups(mask),
    );
    return hit !== null && hit !== this.terrain;
  }

  step(_dt: number): void {
    // No dynamic bodies yet: characters and vehicles are kinematic and query
    // the level directly (their own colliders belong to no layer), so the
    // world only needs a step to rebuild the broad phase after level edits.
    this.sync();
  }

  /** Makes queries see colliders added since the last broad-phase update. */
  private sync(): void {
    if (!this.dirty) return;
    this.world.step();
    this.dirty = false;
  }
}
