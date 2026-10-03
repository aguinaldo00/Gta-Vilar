import type * as THREE from 'three';
import type { Rng } from '../core/math';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Batcher } from './Batcher';
import type { Materials } from './Materials';
import type { MapData } from './mapData';
import type { RoadNetwork } from './Roads';
import type { TerrainModel } from './Terrain';
import type { Quality } from './World';

export type Animator = (time: number, dt: number) => void;

/** Everything a world builder needs to add geometry, collisions and animation. */
export interface BuildContext {
  /** The map being built (loaded from public/maps/). */
  map: MapData;
  scene: THREE.Scene;
  batch: Batcher;
  mats: Materials;
  collision: CollisionWorld;
  animators: Animator[];
  rng: Rng;
  terrain: TerrainModel;
  roads: RoadNetwork;
  quality: Quality;
}
