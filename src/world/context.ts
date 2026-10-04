import type * as THREE from 'three';
import type { Rng } from '../core/math';
import type { StaticColliders } from '../physics/PhysicsWorld';
import type { Batcher } from './Batcher';
import type { Breakables } from './Breakables';
import type { Materials } from './Materials';
import type { MapData } from './mapData';
import type { RoadNetwork } from './Roads';
import type { OrthoTiles, TerrainModel } from './Terrain';
import type { Quality } from './World';

export type Animator = (time: number, dt: number) => void;

/** Everything a world builder needs to add geometry, collisions and animation. */
export interface BuildContext {
  /** The map being built (loaded from public/maps/). */
  map: MapData;
  /** Orthophoto tiles (ground and roofs), when the map has them. */
  ortho: OrthoTiles | null;
  scene: THREE.Scene;
  batch: Batcher;
  mats: Materials;
  collision: StaticColliders;
  animators: Animator[];
  rng: Rng;
  terrain: TerrainModel;
  roads: RoadNetwork;
  quality: Quality;
  /** Signs, lamp posts and bollards a car can knock down. */
  breakables: Breakables;
  /** Street lamp heads (x, y, z triples) for the night lights. */
  lamps: number[];
}
