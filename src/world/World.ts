import * as THREE from 'three';
import { Rng } from '../core/math';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { Batcher } from './Batcher';
import type { Animator, BuildContext, GroundRect } from './context';
import { buildCountryside, isField } from './Countryside';
import { Environment } from './Environment';
import { buildLandmarks } from './Landmarks';
import {
  AYTO, CAMINO_REAL_Z, PLAZA_BLOCK, RAIL_X, RIVER, SOTO, STATION, TORRE, TOWN, inRect, isPool, riverCenterX, terrainHeight,
} from './layout';
import { MapSketch } from './MapSketch';
import { Materials } from './Materials';
import { buildRailway } from './Railway';
import { buildSoto } from './Soto';
import { buildTerrain } from './Terrain';
import { buildTown } from './Town';
import { waterTime } from './Water';

/**
 * Builds the whole Villarcayo map and answers spatial questions about it
 * (ground height, water, named zones).
 */
export class World {
  readonly ground: GroundRect[] = [];
  readonly sketch = new MapSketch();
  readonly env: Environment;
  private readonly animators: Animator[] = [];

  constructor(scene: THREE.Scene, collision: CollisionWorld) {
    const rng = new Rng(1971);
    const mats = new Materials();
    const batch = new Batcher();
    const ctx: BuildContext = {
      scene, batch, mats, collision, ground: this.ground, sketch: this.sketch, animators: this.animators, rng,
    };
    this.env = new Environment(scene, rng);
    scene.add(buildTerrain(mats));
    buildCountryside(ctx);
    buildTown(ctx);
    buildLandmarks(ctx);
    buildSoto(ctx);
    buildRailway(ctx);
    batch.build(scene);
  }

  /** Walkable / drivable height: terrain plus raised surfaces (sidewalks, decks, ballast). */
  heightAt(x: number, z: number): number {
    let h = terrainHeight(x, z);
    for (const r of this.ground) {
      if (r.y > h && x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) h = r.y;
    }
    return h;
  }

  /** Water surface height at (x, z), or null when there is no water. */
  waterAt(x: number, z: number): number | null {
    return Math.abs(x - riverCenterX(z)) < RIVER.halfWidth + 1 ? RIVER.water : null;
  }

  zoneAt(x: number, z: number): string {
    if (inRect({ minX: TORRE.x - 9, maxX: TORRE.x + 9, minZ: TORRE.z - 9, maxZ: TORRE.z + 8 }, x, z)) return 'Torre del Corregimiento';
    if (inRect({ minX: AYTO.x - AYTO.w / 2, maxX: AYTO.x + AYTO.w / 2, minZ: AYTO.z - AYTO.d / 2, maxZ: AYTO.z + AYTO.d / 2 }, x, z, 1)) return 'Ayuntamiento';
    if (inRect(PLAZA_BLOCK, x, z)) return 'Plaza Mayor';
    if (isPool(x, z)) return 'Piscinas Naturales';
    if (Math.abs(x - riverCenterX(z)) < RIVER.halfWidth - 2) return 'Río Nela';
    if (Math.abs(z - CAMINO_REAL_Z) < 7 && Math.abs(x) < 190) return 'Camino Real';
    if (x > SOTO.minX) return 'Parque El Soto';
    if (inRect(STATION, x, z, 14)) return 'Estación de Villarcayo';
    if (Math.abs(x - RAIL_X) < 12) return 'Vía Santander-Mediterráneo';
    if (inRect(TOWN, x, z)) return 'Villarcayo';
    if (isField(x, z)) return 'Campos de Castilla';
    return 'Merindad de Castilla la Vieja';
  }

  update(dt: number, time: number, focus: THREE.Vector3): void {
    waterTime.value = time;
    for (const a of this.animators) a(time, dt);
    this.env.update(dt, focus);
  }
}
