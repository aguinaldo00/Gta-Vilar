import type * as THREE from 'three';
import type { Quality } from '@/config/Config';
import { Rng } from '../core/math';
import { type CollisionWorld, Layer } from '../physics/CollisionWorld';
import { Batcher } from './Batcher';
import { buildBuildings } from './Buildings';
import { buildChurches } from './Churches';
import { buildCommerce } from './Commerce';
import type { Animator, BuildContext } from './context';
import { Environment } from './Environment';
import { buildFacilities } from './Facilities';
import { Grass } from './Grass';
import { type Bounds2, orientedBox, type Pt, pointInRing, ringBounds, toPts } from './geo';
import { buildHydro } from './Hydro';
import { buildLandmarks } from './Landmarks';
import { Materials } from './Materials';
import { BOUNDS, MAP } from './mapData';
import { buildRoads, RoadNetwork, VEHICLE_ROADS } from './Roads';
import { buildSports } from './Sports';
import { buildGround, groundMaterial, TerrainModel } from './Terrain';
import { buildVegetation } from './Vegetation';
import { waterTime } from './Water';

export type { Quality } from '@/config/Config';

interface NamedArea {
  name: string;
  ring: Pt[];
  b: Bounds2;
  area: number;
}

/**
 * Villarcayo built from OpenStreetMap data (src/world/data/villarcayo.json):
 * terrain, roads, buildings, water, vegetation and landmarks, plus spatial
 * queries used by gameplay (ground height, water, place names, spawns).
 */
export class World {
  readonly env: Environment;
  readonly grass: Grass;
  readonly terrain = new TerrainModel(MAP);
  readonly roads = new RoadNetwork();
  readonly bounds = BOUNDS;
  readonly stats: { meshes: number; triangles: number; byStage?: Record<string, number> } = { meshes: 0, triangles: 0 };
  private readonly animators: Animator[] = [];
  private readonly named: NamedArea[] = [];
  private readonly landmarkZones: { name: string; x: number; z: number; r: number }[] = [];

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, collision: CollisionWorld, quality: Quality) {
    const rng = new Rng(1971);
    const mats = new Materials();
    const batch = new Batcher();
    const ctx: BuildContext = {
      scene,
      batch,
      mats,
      collision,
      animators: this.animators,
      rng,
      terrain: this.terrain,
      roads: this.roads,
      quality,
    };
    this.env = new Environment(scene, renderer, rng, quality);
    buildGround(this.terrain, batch, groundMaterial(quality.groundTexture, mats.detail), quality.detail === 1);
    batch.stage = 'roads';
    buildRoads(ctx);
    batch.stage = 'buildings';
    buildBuildings(ctx);
    batch.stage = 'churches';
    buildChurches(ctx);
    batch.stage = 'commerce';
    const signs = buildCommerce(ctx);
    batch.stage = 'facilities';
    buildFacilities(ctx, signs.sign, signs.mat);
    batch.stage = 'sports';
    buildSports(ctx);
    batch.stage = 'hydro';
    buildHydro(ctx);
    batch.stage = 'vegetation';
    buildVegetation(ctx);
    batch.stage = 'landmarks';
    buildLandmarks(ctx);
    this.grass = new Grass(scene, quality.grassRadius, quality.grassSpacing, quality.groundTexture >= 4096 ? 4096 : 2048);
    this.stats.triangles = Math.round(batch.triangles);
    this.stats.byStage = Object.fromEntries(Object.entries(batch.byStage).map(([k, v]) => [k, Math.round(v)]));
    this.stats.meshes = batch.build(scene);
    this.buildBounds(collision);
    this.indexPlaces();
  }

  private buildBounds(collision: CollisionWorld): void {
    const B = this.bounds;
    const W = B.maxX - B.minX,
      H = B.maxZ - B.minZ;
    const o = { top: 200, mask: Layer.Bodies };
    collision.addBox((B.minX + B.maxX) / 2, B.minZ - 3, W + 20, 10, o);
    collision.addBox((B.minX + B.maxX) / 2, B.maxZ + 3, W + 20, 10, o);
    collision.addBox(B.minX - 3, (B.minZ + B.maxZ) / 2, 10, H + 20, o);
    collision.addBox(B.maxX + 3, (B.minZ + B.maxZ) / 2, 10, H + 20, o);
  }

  private indexPlaces(): void {
    for (const a of MAP.areas) {
      if (!a.n || a.k === 'parking') continue;
      const ring = toPts(a.o);
      const b = ringBounds(ring);
      this.named.push({ name: a.n, ring, b, area: (b.maxX - b.minX) * (b.maxZ - b.minZ) });
    }
    this.named.sort((a, b) => a.area - b.area);
    const add = (name: string, x: number, z: number, r: number) => this.landmarkZones.push({ name, x, z, r });
    for (const w of MAP.weirs) {
      if (!w.n) continue;
      const mid = Math.floor(w.p.length / 4) * 2;
      add(w.n, w.p[mid], w.p[mid + 1], 30);
    }
    for (const b of MAP.buildings) {
      if (b.t === 'townhall') {
        const o = orientedBox(toPts(b.o));
        add('Ayuntamiento', o.cx, o.cz, Math.max(o.w, o.d) / 2 + 2);
      } else if (b.t === 'torre') {
        const o = orientedBox(toPts(b.o));
        add('Torre del Corregimiento', o.cx, o.cz, 9);
      } else if (b.t === 'station' || (b.t === 'church' && b.n)) {
        const o = orientedBox(toPts(b.o));
        add(b.t === 'station' ? 'Antigua Estación de Horna-Villarcayo' : b.n!, o.cx, o.cz, Math.max(o.w, o.d) / 2 + 12);
      }
    }
    for (const p of MAP.pois) {
      if (p.k === 'locomotive') add('Locomotora Mikado', p.x, p.z, 14);
      if (p.k === 'bandstand') add('Templete de la Plaza Mayor', p.x, p.z, 7);
    }
  }

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  waterAt(x: number, z: number): number | null {
    return this.terrain.waterAt(x, z);
  }

  /** Place name for the HUD: landmark, named area, street name, or the municipality. */
  zoneAt(x: number, z: number): string {
    for (const l of this.landmarkZones) if (Math.hypot(x - l.x, z - l.z) < l.r) return l.name;
    for (const a of this.named) {
      if (x < a.b.minX || x > a.b.maxX || z < a.b.minZ || z > a.b.maxZ) continue;
      if (pointInRing(x, z, a.ring)) return a.name;
    }
    const river = this.terrain.riverDistance(x, z);
    if (river.d < river.hw + 3) return 'Río Nela';
    const road = this.roads.nearest(x, z, 4, (r) => !!r.n);
    if (road?.road.n) return road.road.n;
    return Math.hypot(x, z) < 700 ? 'Villarcayo' : 'Merindad de Castilla la Vieja';
  }

  /** Nearest drivable road to (x, z): a point on the right-hand lane and its heading. */
  roadSpawn(x: number, z: number, preferMain = true): { x: number; z: number; heading: number } {
    const main = preferMain ? this.roads.nearest(x, z, 120, (r) => VEHICLE_ROADS.has(r.k) && r.k !== 'service') : null;
    const hit = main ?? this.roads.nearest(x, z, 400, (r) => VEHICLE_ROADS.has(r.k) || r.k === 'track');
    if (!hit) return { x, z, heading: 0 };
    const lane = hit.road.w / 4;
    // Spain drives on the right; a vehicle heading along (dx, dz) has its right side at (-dz, dx).
    return { x: hit.x - hit.dz * lane, z: hit.z + hit.dx * lane, heading: Math.atan2(hit.dx, hit.dz) };
  }

  update(dt: number, time: number, focus: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
    waterTime.value = time;
    for (const a of this.animators) a(time, dt);
    this.env.update(time, focus, camera);
    this.grass.update(camera);
  }
}
