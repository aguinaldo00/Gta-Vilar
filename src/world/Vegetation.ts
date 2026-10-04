import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Layer } from '../physics/PhysicsWorld';
import type { BuildContext } from './context';
import { hash01, type Pt, pointInRing, ringBounds, ringDist, SpatialGrid, toPts } from './geo';
import { bench, planeTree, Unit } from './props';
import { VEHICLE_ROADS } from './Roads';

type Kind = 'round' | 'poplar' | 'pine';
const INSTANCE_CELL = 384;

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

/** Re-maps a geometry's UVs into the bark strip of the tree atlas. */
function bark(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.82 + uv.getX(i) * 0.16, uv.getY(i));
  return g.index ? g.toNonIndexed() : g;
}

/**
 * Tree as one geometry for one material: bark trunk and branches plus a crown
 * of randomly oriented leaf cards. Card normals point away from the crown
 * centre so the crown shades like a soft volume, not like flat planes.
 */
function leafTree(
  seed: number,
  trunkH: number,
  trunkR: number,
  crown: THREE.Vector3,
  radii: THREE.Vector3,
  cards: number,
  size: number,
): THREE.BufferGeometry {
  let r = seed;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const parts: THREE.BufferGeometry[] = [
    bark(new THREE.CylinderGeometry(trunkR * 0.6, trunkR, trunkH, 6, 1, true).translate(0, trunkH / 2, 0)),
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd();
    const len = Math.min(radii.x, radii.y) * 0.9;
    const b = new THREE.CylinderGeometry(trunkR * 0.25, trunkR * 0.45, len, 4, 1, true).translate(0, len / 2, 0);
    b.rotateZ(0.7 + rnd() * 0.3)
      .rotateY(a)
      .translate(0, trunkH * 0.85, 0);
    parts.push(bark(b));
  }
  const o = new THREE.Object3D();
  for (let i = 0; i < cards; i++) {
    // Point inside the crown ellipsoid, biased to its surface.
    const u = rnd() * 2 - 1,
      phi = rnd() * Math.PI * 2,
      k = 0.55 + rnd() * 0.45;
    const sq = Math.sqrt(1 - u * u);
    o.position.set(crown.x + sq * Math.cos(phi) * radii.x * k, crown.y + u * radii.y * k, crown.z + sq * Math.sin(phi) * radii.z * k);
    o.rotation.set((rnd() - 0.5) * 0.9, rnd() * Math.PI, (rnd() - 0.5) * 0.6);
    o.scale.setScalar(size * (0.8 + rnd() * 0.4));
    o.updateMatrix();
    const card = new THREE.PlaneGeometry(1, 1);
    const uv = card.attributes.uv as THREE.BufferAttribute;
    for (let j = 0; j < uv.count; j++) uv.setX(j, uv.getX(j) * 0.75);
    card.applyMatrix4(o.matrix);
    const pos = card.attributes.position as THREE.BufferAttribute;
    const nrm = card.attributes.normal as THREE.BufferAttribute;
    for (let j = 0; j < pos.count; j++) {
      const n = new THREE.Vector3(pos.getX(j) - crown.x, (pos.getY(j) - crown.y) * 0.6 + radii.y * 0.4, pos.getZ(j) - crown.z).normalize();
      nrm.setXYZ(j, n.x, n.y, n.z);
    }
    parts.push(card.toNonIndexed());
  }
  return mergeGeometries(parts)!;
}

/** Conifer: tall bare trunk and tiers of drooping leaf cards narrowing to the top. */
function pineTree(): THREE.BufferGeometry {
  let r = 41;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const parts: THREE.BufferGeometry[] = [bark(new THREE.CylinderGeometry(0.12, 0.3, 11, 6, 1, true).translate(0, 5.5, 0))];
  const o = new THREE.Object3D();
  const tiers = 6;
  for (let t = 0; t < tiers; t++) {
    const y = 4.2 + t * 1.25,
      rad = 2.6 * (1 - t / tiers) + 0.4;
    const n = 5 - Math.floor(t / 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd();
      o.position.set(Math.cos(a) * rad * 0.55, y, Math.sin(a) * rad * 0.55);
      o.rotation.set(-1.15 + rnd() * 0.3, -a + Math.PI / 2, 0, 'YXZ');
      o.scale.set(rad * 1.3, rad * 1.1, 1);
      o.updateMatrix();
      const card = new THREE.PlaneGeometry(1, 1);
      const uv = card.attributes.uv as THREE.BufferAttribute;
      for (let j = 0; j < uv.count; j++) uv.setX(j, uv.getX(j) * 0.75);
      card.applyMatrix4(o.matrix);
      const pos = card.attributes.position as THREE.BufferAttribute,
        nrm = card.attributes.normal as THREE.BufferAttribute;
      for (let j = 0; j < pos.count; j++) {
        const nv = new THREE.Vector3(pos.getX(j), 1.2, pos.getZ(j)).normalize();
        nrm.setXYZ(j, nv.x, nv.y, nv.z);
      }
      parts.push(card.toNonIndexed());
    }
  }
  return mergeGeometries(parts)!;
}

/** Approximate height of each model at scale 1 (to fit LiDAR tree heights). */
const MODEL_HEIGHT: Record<Kind, number> = { round: 7.4, poplar: 12.4, pine: 12.5 };

/** Instance tint per model (pines are darker and bluer). */
const TINT: Record<Kind, [number, number, number]> = { round: [1, 1, 1], poplar: [1, 1, 1], pine: [0.5, 0.68, 0.58] };

/** Tree models; `cards` scales the crown (fewer, larger leaf cards on phones). */
const MODELS: Record<Kind, (cards: number) => THREE.BufferGeometry> = {
  pine: pineTree,
  round: (k) =>
    leafTree(11, 2.9, 0.28, new THREE.Vector3(0, 5.0, 0), new THREE.Vector3(2.8, 2.4, 2.8), Math.round(18 * k), 3.3 / Math.sqrt(k)),
  poplar: (k) =>
    leafTree(23, 3.0, 0.22, new THREE.Vector3(0, 7.6, 0), new THREE.Vector3(1.7, 4.8, 1.7), Math.round(18 * k), 2.5 / Math.sqrt(k)),
};

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

/**
 * Plaza Mayor street furniture: flower planters, litter bins and iron
 * bollards along the edges that meet a street.
 */
function plazaFurniture(ctx: BuildContext, plazas: Pt[][]): void {
  const { mats, batch, roads } = ctx;
  const planter = mats.stone,
    flowers = [mats.tint('#c0392b'), mats.tint('#e5b31a'), mats.tint('#8e44ad')],
    green = mats.hedge;
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
    // Planters and bins around the inner edge.
    const b = ringBounds(ring);
    for (let k = 0; k < 40; k++) {
      const x = b.minX + hash01(k, 1.3) * (b.maxX - b.minX),
        z = b.minZ + hash01(k, 7.9) * (b.maxZ - b.minZ);
      if (!pointInRing(x, z, ring)) continue;
      const near = roads.nearest(x, z, 6, (rd) => VEHICLE_ROADS.has(rd.k));
      if (near && near.d < 2) continue;
      if (ctx.map.pois.some((p) => Math.hypot(p.x - x, p.z - z) < (p.k === 'bandstand' ? 9 : 6))) continue;
      let tree = false;
      for (let t = 0; t < ctx.map.trees.length; t += 2) if (Math.hypot(ctx.map.trees[t] - x, ctx.map.trees[t + 1] - z) < 2.5) tree = true;
      if (tree) continue;
      const gy = ctx.terrain.heightAt(x, z);
      if (k % 3 === 0) {
        batch.add(Unit.cyl, mats.tint('#2f4a3a'), x, gy + 0.45, z, 0, 0.45, 0.9, 0.45);
        continue;
      }
      batch.add(Unit.box, planter, x, gy + 0.35, z, hash01(k) * 3, 1.4, 0.7, 1.4);
      batch.add(Unit.blob, green, x, gy + 0.85, z, 0, 0.6, 0.35, 0.6);
      for (let f = 0; f < 4; f++)
        batch.add(
          Unit.blob,
          flowers[(k + f) % 3],
          x + (hash01(k, f) - 0.5) * 0.9,
          gy + 1.0,
          z + (hash01(f, k) - 0.5) * 0.9,
          0,
          0.18,
          0.15,
          0.18,
        );
      ctx.collision.addBox(x, z, 1.4, 1.4, { rot: hash01(k) * 3, top: 0.7, mask: Layer.Bodies });
    }
  }
}

const DENSITY: Record<string, { per: number; kind: Kind | 'mix' }> = {
  forest: { per: 90, kind: 'mix' },
  park: { per: 260, kind: 'mix' },
  garden: { per: 220, kind: 'round' },
  orchard: { per: 60, kind: 'round' },
  scrub: { per: 90, kind: 'round' },
  cemetery: { per: 400, kind: 'poplar' },
};

/**
 * Trees from OSM (natural=tree, tree rows) plus forest/park infill, street
 * lamps and benches at their real positions. Repeated models are drawn with
 * one InstancedMesh per model and chunk.
 */
export function buildVegetation(ctx: BuildContext): void {
  const { collision, terrain, roads, rng } = ctx;
  const instances = new Map<string, { kind: Kind; mats: THREE.Matrix4[] }>();
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3(),
    p = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0);

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

  const place = (kind: Kind, x: number, z: number, scale: number, collide = true) => {
    const key = `${kind}|${Math.floor(x / INSTANCE_CELL)}|${Math.floor(z / INSTANCE_CELL)}`;
    let e = instances.get(key);
    if (!e) instances.set(key, (e = { kind, mats: [] }));
    q.setFromAxisAngle(up, hash01(x, z) * Math.PI * 2);
    e.mats.push(m.compose(p.set(x, terrain.heightAt(x, z), z), q, s.setScalar(scale)).clone());
    if (collide) collision.addCircle(x, z, 0.35 * scale, { top: 6 * scale, mask: Layer.Bodies });
  };

  // Plaza Mayor: pollarded plane trees, like in the photos.
  const plazas = ctx.map.areas.filter((a) => a.k === 'pedestrian' && a.n === 'Plaza Mayor').map((a) => toPts(a.o));
  const inPlaza = (x: number, z: number) => plazas.some((r) => pointInRing(x, z, r));

  // Mapped trees never grow through a building (or through the eaves of the churches).
  const churches = ctx.map.buildings.filter((b) => b.t === 'church').map((b) => toPts(b.o));
  const insideBuilding = (x: number, z: number) =>
    footprints.query(x - 2, z - 2, x + 2, z + 2, tmp).some((r) => pointInRing(x, z, r)) || churches.some((r) => ringDist(x, z, r) < 4);
  // Real trees: every crown the LiDAR saw, at its position and height (thinned on phones).
  const lidar = ctx.map.ltrees ?? [];
  const nL = lidar.length / 4;
  const keep = Math.min(1, (ctx.quality.treeBudget * 2) / Math.max(1, nL));
  for (let i = 0; i < lidar.length; i += 4) {
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
    // Tall and narrow (or by the river) reads as a poplar (chopo); the rest as broad-leaved trees.
    const poplar = (h > 12 && r < h * 0.28) || (h > 9 && terrain.riverDistance(x, z).d < 30);
    const kind: Kind = poplar ? 'poplar' : 'round';
    place(kind, x, z, Math.min(2.6, Math.max(0.45, h / MODEL_HEIGHT[kind])), h > 3);
  }

  for (let i = 0; i < ctx.map.trees.length; i += 2) {
    const x = ctx.map.trees[i],
      z = ctx.map.trees[i + 1];
    if (insideBuilding(x, z)) continue;
    if (inPlaza(x, z)) {
      planeTree(ctx, x, z, terrain.heightAt(x, z) + 0.03);
      continue;
    }
    // Mapped (OSM) trees are already in the LiDAR canopy.
    if (nL > 0) continue;
    const nearRiver = terrain.riverDistance(x, z).d < 40;
    place(nearRiver && hash01(x, z) < 0.7 ? 'poplar' : 'round', x, z, 0.8 + hash01(z, x) * 0.5);
  }
  for (let i = 0; i < ctx.map.pines.length; i += 2)
    place('pine', ctx.map.pines[i], ctx.map.pines[i + 1], 0.8 + hash01(ctx.map.pines[i + 1], 3) * 0.5);

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
      let kind: Kind = d.kind === 'mix' ? (terrain.riverDistance(x, z).d < 50 || rng.chance(0.3) ? 'poplar' : 'round') : d.kind;
      if (a.l === 'n') kind = 'pine';
      else if (a.n && /chopera/i.test(a.n)) kind = 'poplar';
      const scrub = a.k === 'scrub';
      place(kind, x, z, scrub ? rng.range(0.35, 0.6) : rng.range(0.75, 1.3), !scrub);
      budget--;
    }
  }

  // Field hedges and walls are the real ones (OSM + LiDAR, src/world/Barriers.ts): none are invented.
  plazaFurniture(ctx, plazas);

  // Street lamps at their mapped positions.
  const lamp = LAMP();
  const ornate = ORNATE_LAMP();
  const lampMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
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
    collision.addCircle(x, z, 0.15, { top: 4.5, mask: Layer.Player });
  }

  // Benches face the nearest street or path.
  for (let i = 0; i < ctx.map.benches.length; i += 2) {
    const x = ctx.map.benches[i],
      z = ctx.map.benches[i + 1];
    const hit = roads.nearest(x, z, 25);
    const rot = hit ? Math.atan2(hit.x - x, hit.z - z) : 0;
    bench(ctx, x, z, terrain.heightAt(x, z), rot);
  }

  const geos = Object.fromEntries((Object.keys(MODELS) as Kind[]).map((k) => [k, MODELS[k](ctx.quality.detail ? 1 : 0.6)])) as Record<
    Kind,
    THREE.BufferGeometry
  >;
  for (const { kind, mats } of instances.values()) {
    const im = new THREE.InstancedMesh(geos[kind], ctx.mats.leavesWind, mats.length);
    im.customDepthMaterial = ctx.mats.leavesDepth;
    for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
    for (let i = 0; i < mats.length; i++) {
      const v = 0.85 + hash01(i, mats.length) * 0.3;
      const [tr, tg, tb] = TINT[kind];
      im.setColorAt(i, new THREE.Color(v * tr, v * tg, v * tb));
    }
    im.computeBoundingSphere();
    im.castShadow = ctx.quality.treeShadows;
    im.receiveShadow = true;
    ctx.scene.add(im);
  }
}
