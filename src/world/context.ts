import type * as THREE from 'three';
import type { Rng } from '../core/math';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Batcher } from './Batcher';
import type { MapSketch } from './MapSketch';
import type { Materials } from './Materials';
import type { Rect } from './layout';

/** Raised walkable area (sidewalks, bridge decks, rail ballast...). */
export interface GroundRect extends Rect {
  y: number;
}

export type Animator = (time: number, dt: number) => void;

/** Everything a world builder needs to add geometry, collisions and map data. */
export interface BuildContext {
  scene: THREE.Scene;
  batch: Batcher;
  mats: Materials;
  collision: CollisionWorld;
  ground: GroundRect[];
  sketch: MapSketch;
  animators: Animator[];
  rng: Rng;
}
