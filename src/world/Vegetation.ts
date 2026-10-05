import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Layer } from '../physics/PhysicsWorld';
import type { BuildContext } from './context';
import { NIGHT } from './DayNight';
import { hash01, type Pt, pointInRing, ringBounds, ringDist, SpatialGrid, toPts } from './geo';
import { bench, Unit } from './props';
import { VEHICLE_ROADS } from './Roads';
import { TreeField } from './TreeField';

/** Merged unit geometry with baked vertex colours. */
function coloured(parts: [THREE.BufferGeometry, string][]): THREE.BufferGeometry {
  const geos = parts.map(([g, col]) => {
    const n = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(col);
    const arr = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = c.r;
      arr[i + 1] = c.g;
      arr[i + 2] = c.b;
    }
    n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    n.deleteAttribute('uv');
    return n;
  });
  return mergeGeometries(geos)!;
}

/** Street lamp: batched as static geometry (cheap, and it shares the props draw call). */
const LAMP = (): THREE.BufferGeometry =>
  coloured([
    [new THREE.CylinderGeometry(0.07, 0.12, 4.2, 5, 1, true).translate(0, 2.1, 0), '#2b2f2e'],
    [new THREE.BoxGeometry(0.34, 0.45, 0.34).translate(0, 4.35, 0), '#fff1c4'],
    [new THREE.ConeGeometry(0.32, 0.3, 4).rotateY(Math.PI / 4).translate(0, 4.72, 0), '#2b2f2e'],
  ]);

/** Cast-iron "fernandino" lamp post with three lanterns (Plaza Mayor). */
const ORNATE_LAMP = (): THREE.BufferGeometry => {
  const iron = '#1e2421',
    glass = '#fff1c4';
  const parts: [THREE.BufferGeometry, string][] = [
    [new THREE.CylinderGeometry(0.28, 0.36, 0.7, 8).translate(0, 0.35, 0), iron],
    [new THREE.CylinderGeometry(0.09, 0.14, 3.4, 8).translate(0, 2.4, 0), iron],
    [new THREE.SphereGeometry(0.16, 6, 4).translate(0, 1.0, 0), iron],
    [new THREE.SphereGeometry(0.12, 6, 4).translate(0, 4.1, 0), iron],
  ];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const x = Math.cos(a) * 0.6,
      z = Math.sin(a) * 0.6;
    parts.push([new THREE.BoxGeometry(1.2, 0.05, 0.05).rotateY(-a).translate(x / 2, 4.05, z / 2), iron]);
    parts.push([new THREE.CylinderGeometry(0.15, 0.1, 0.42, 6).translate(x, 3.85, z), glass]);
    parts.push([new THREE.ConeGeometry(0.2, 0.22, 6).translate(x, 4.17, z), iron]);
  }
  parts.push([new THREE.CylinderGeometry(0.16, 0.11, 0.5, 6).translate(0, 4.5, 0), glass]);
  parts.push([new THREE.ConeGeometry(0.22, 0.28, 6).translate(0, 4.88, 0), iron]);
  return coloured(parts);
};

/** Plaza Mayor: iron bollards along the edges that meet a street. */
function plazaFurniture(ctx: BuildContext, plazas: Pt[][]): void {
  const { mats, roads } = ctx;
  for (const ring of plazas) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i],
        [bx, bz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 1.5; s < len - 1; s += 2.2) {
        const x = ax + ((bx - ax) * s) / len,
          z = az + ((bz - az) * s) / len;
        const r = roads.nearest(x, z, 4, (rd) => VEHICLE_ROADS.has(rd.k));
        if (!r || r.d > 2.5 || r.d < 0.3) continue;
        const gy = ctx.terrain.heightAt(x, z);
        ctx.breakables.add(x, gy, z, 0, 0.1, [
          {
            key: 'plaza-bollard',
            geo: Unit.cyl,
            mat: mats.iron,
            local: new THREE.Matrix4().compose(new THREE.Vector3(0, 0.45, 0), new THREE.Quaternion(), new THREE.Vector3(0.14, 0.9, 0.14)),
          },
          {
            key: 'plaza-bollard-top',
            geo: Unit.blob,
            mat: mats.iron,
            local: new THREE.Matrix4().compose(new THREE.Vector3(0, 0.92, 0), new THREE.Quaternion(), new THREE.Vector3(0.1, 0.1, 0.1)),
          },
        ]);
        ctx.collision.addCircle(x, z, 0.12, { top: 0.9, mask: Layer.Player });
      }
    }
    // Planters and bins are only the mapped ones (StreetFurniture): none are invented here.
  }
}

const DENSITY: Record<string, { per: number; code: number | 'mix' }> = {
  forest: { per: 90, code: 'mix' },
  park: { per: 260, code: 'mix' },
  garden: { per: 220, code: 0 },
  orchard: { per: 60, code: 18 },
  scrub: { per: 90, code: 0 },
  cemetery: { per: 400, code: 16 },
};

/** Within this distance of the town centre, small trees and shrubs are breakables (where cars go). */
const BREAKABLE_RADIUS = 1300;

/**
 * Trees (every crown the LiDAR saw, with its species and crown colour from the bake),
 * shrubs, street lamps and benches at their real positions. Returns the tree field, whose
 * update() switches distant squares to the light tree model.
 */
export function buildVegetation(ctx: BuildContext): TreeField {
  const { terrain, roads, rng } = ctx;
  const field = new TreeField(ctx);

  // Footprints of buildings, to keep infill trees out of houses.
  const footprints = new SpatialGrid<Pt[]>(40);
  for (const b of ctx.map.buildings) {
    const r = toPts(b.o);
    footprints.insert(r, ringBounds(r));
  }
  const tmp: Pt[][] = [];
  const blocked = (x: number, z: number, clearance: number) =>
    footprints.query(x - 2, z - 2, x + 2, z + 2, tmp).some((r) => pointInRing(x, z, r)) ||
    (roads.nearest(x, z, clearance)?.d ?? Infinity) < clearance ||
    terrain.base(x, z) < -0.15;

  // Plaza Mayor: pollarded plane trees, like in the photos.
  const plazas = ctx.map.areas.filter((a) => a.k === 'pedestrian' && a.n === 'Plaza Mayor').map((a) => toPts(a.o));
  const inPlaza = (x: number, z: number) => plazas.some((r) => pointInRing(x, z, r));

  // Mapped trees never grow through a building (or through the eaves of the churches).
  const churches = ctx.map.buildings.filter((b) => b.t === 'church').map((b) => toPts(b.o));
  const insideBuilding = (x: number, z: number) =>
    footprints.query(x - 2, z - 2, x + 2, z + 2, tmp).some((r) => pointInRing(x, z, r)) || churches.some((r) => ringDist(x, z, r) < 4);
  const breakableAt = (x: number, z: number) => Math.hypot(x, z) < BREAKABLE_RADIUS;

  // Real trees: every crown the LiDAR saw, at its position, height, crown size, species and colour.
  const lidar = ctx.map.ltrees ?? [];
  const stride = ctx.map.ltreeStride ?? 4;
  const nL = lidar.length / stride;
  const keep = Math.min(1, ctx.quality.treeBudget / Math.max(1, nL));
  const seen = new SpatialGrid<Pt>(16);
  for (let i = 0; i + stride - 1 < lidar.length; i += stride) {
    let x = lidar[i],
      z = lidar[i + 1];
    const h = lidar[i + 2],
      r = lidar[i + 3];
    if (hash01(x * 0.37, z * 0.71) > keep) continue;
    // The LiDAR gives the top of the crown; crowns of garden and street trees often overhang the
    // road. Never stand a trunk on the carriageway: move it to the edge on its side of the street.
    const onRoad = roads.nearest(x, z, 0.5, (rd) => VEHICLE_ROADS.has(rd.k));
    if (onRoad && onRoad.d < 0.5) {
      const ox = x - onRoad.x,
        oz = z - onRoad.z;
      const len = Math.hypot(ox, oz);
      if (len < 0.3) continue; // right on the centre line: no side to move it to
      x = onRoad.x + (ox / len) * (onRoad.road.w / 2 + 1.2);
      z = onRoad.z + (oz / len) * (onRoad.road.w / 2 + 1.2);
    }
    if (inPlaza(x, z) || insideBuilding(x, z)) continue;
    // Species from the bake; older maps: tall and narrow (or by the river) reads as a poplar.
    let code = stride >= 6 ? lidar[i + 4] : 0;
    if (stride < 6) code = (h > 12 && r < h * 0.28) || (h > 9 && terrain.riverDistance(x, z).d < 30) ? 3 : 0;
    const tint = stride >= 6 ? lidar[i + 5] : undefined;
    field.tree(code, x, terrain.heightAt(x, z), z, h, r, tint, breakableAt(x, z));
    seen.insert([x, z], { minX: x, maxX: x, minZ: z, maxZ: z });
  }
  const tmpP: Pt[] = [];
  const hasLidarTree = (x: number, z: number) =>
    seen.query(x - 4, z - 4, x + 4, z + 4, tmpP).some(([a, b]) => Math.hypot(a - x, b - z) < 4);

  for (let i = 0; i < ctx.map.trees.length; i += 2) {
    const x = ctx.map.trees[i],
      z = ctx.map.trees[i + 1];
    if (insideBuilding(x, z)) continue;
    if (inPlaza(x, z)) {
      // Pollarded planes of the Plaza Mayor (the LiDAR crowns there are skipped above).
      field.tree(2, x, terrain.heightAt(x, z) + 0.03, z, 6.5 + hash01(x, z), 2.8, undefined, false);
      continue;
    }
    // Mapped (OSM) trees are already in the LiDAR canopy.
    if (nL > 0) continue;
    const nearRiver = terrain.riverDistance(x, z).d < 40;
    field.tree(
      nearRiver && hash01(x, z) < 0.7 ? 3 : 0,
      x,
      terrain.heightAt(x, z),
      z,
      7 + hash01(z, x) * 4,
      3.5,
      undefined,
      breakableAt(x, z),
    );
  }
  // Conifers mapped in OSM that the LiDAR did not see as a tree (young pines, garden conifers).
  for (let i = 0; i < ctx.map.pines.length; i += 2) {
    const x = ctx.map.pines[i],
      z = ctx.map.pines[i + 1];
    if (hasLidarTree(x, z) || insideBuilding(x, z)) continue;
    field.tree(15, x, terrain.heightAt(x, z), z, 9 + hash01(z, 3) * 6, 3, undefined, breakableAt(x, z));
  }

  // Shrubs: OSM (box, cherry laurel, barberry, pampas grass) and the low crowns of the LiDAR.
  const shrubs = ctx.map.shrubs ?? [];
  const shrubKeep = ctx.quality.detail ? 1 : 0.55;
  for (let i = 0; i + 3 < shrubs.length; i += 4) {
    const x = shrubs[i],
      z = shrubs[i + 1];
    if (shrubs[i + 2] === 5 && hash01(x * 1.3, z * 0.7) > shrubKeep) continue;
    if (inPlaza(x, z) || insideBuilding(x, z)) continue;
    const road = roads.nearest(x, z, 1, (rd) => VEHICLE_ROADS.has(rd.k));
    if (road && road.d < 0.3) continue;
    field.shrub(shrubs[i + 2], x, terrain.heightAt(x, z), z, shrubs[i + 3]);
  }

  // Infill for wooded areas, parks, orchards and scrub (only without LiDAR trees).
  let budget = nL > 0 ? 0 : ctx.quality.treeBudget;
  for (const a of ctx.map.areas) {
    const d = DENSITY[a.k];
    if (!d || budget <= 0) continue;
    const ring = toPts(a.o);
    const holes = (a.h ?? []).map(toPts);
    const b = ringBounds(ring);
    const area = Math.abs((b.maxX - b.minX) * (b.maxZ - b.minZ));
    const n = Math.min(budget, Math.floor(area / d.per));
    for (let k = 0; k < n; k++) {
      const x = rng.range(b.minX, b.maxX),
        z = rng.range(b.minZ, b.maxZ);
      if (!pointInRing(x, z, ring) || holes.some((h) => pointInRing(x, z, h)) || blocked(x, z, 2.5)) continue;
      let code = d.code === 'mix' ? (terrain.riverDistance(x, z).d < 50 || rng.chance(0.3) ? 4 : 0) : d.code;
      if (a.l === 'n') code = 15;
      const scrub = a.k === 'scrub';
      field.tree(code, x, terrain.heightAt(x, z), z, scrub ? rng.range(2, 4) : rng.range(6, 12), 3.5, undefined, scrub);
      budget--;
    }
  }

  // Field hedges and walls are the real ones (OSM + LiDAR, src/world/Barriers.ts): none are invented.
  plazaFurniture(ctx, plazas);

  // Street lamps at their mapped positions.
  const lamp = LAMP();
  const ornate = ORNATE_LAMP();
  const lampMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  // The lanterns (the light vertex colour) glow at night.
  lampMat.onBeforeCompile = (shader) => {
    shader.uniforms.nightGlow = NIGHT;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float nightGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(1.0, 0.8, 0.5) * step(0.8, dot(vColor.rgb, vec3(0.333))) * nightGlow * 3.0;',
      );
  };
  for (let i = 0; i < ctx.map.lamps.length; i += 2) {
    let x = ctx.map.lamps[i],
      z = ctx.map.lamps[i + 1];
    // Lamps mapped on the carriageway are wall lamps of narrow streets (or streets drawn too wide):
    // stand them on the kerb instead of in front of the traffic.
    const road = roads.nearest(x, z, 8, (r) => VEHICLE_ROADS.has(r.k));
    if (road && road.d < 0.3 && !inPlaza(x, z)) {
      const ox = x - road.x,
        oz = z - road.z;
      const len = Math.hypot(ox, oz);
      // Side of the road the lamp was on (or the right-hand side if it sat on the centre line).
      const nx = len > 0.01 ? ox / len : road.dz,
        nz = len > 0.01 ? oz / len : -road.dx;
      x = road.x + nx * (road.road.w / 2 + 0.4);
      z = road.z + nz * (road.road.w / 2 + 0.4);
    }
    // Cast-iron fernandino lamps in the Plaza Mayor, plain poles elsewhere.
    // Knocked over by cars (Breakables); only people bump into them.
    const fancy = inPlaza(x, z);
    ctx.breakables.add(x, terrain.heightAt(x, z), z, 0, fancy ? 0.3 : 0.15, [
      { key: fancy ? 'lamp-ornate' : 'lamp', geo: fancy ? ornate : lamp, mat: lampMat },
    ]);
    ctx.collision.addCircle(x, z, 0.15, { top: 4.5, mask: Layer.Player });
    ctx.lamps.push(x, terrain.heightAt(x, z) + (fancy ? 4.1 : 4.3), z);
  }

  // Benches face the nearest street or path.
  for (let i = 0; i < ctx.map.benches.length; i += 2) {
    const x = ctx.map.benches[i],
      z = ctx.map.benches[i + 1];
    const hit = roads.nearest(x, z, 25);
    const rot = hit ? Math.atan2(hit.x - x, hit.z - z) : 0;
    bench(ctx, x, z, terrain.heightAt(x, z), rot);
  }

  return field;
}
