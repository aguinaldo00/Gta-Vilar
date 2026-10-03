import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Layer } from '../physics/CollisionWorld';
import type { BuildContext } from './context';
import { type Pt, SpatialGrid, hash01, pointInRing, ringBounds, toPts } from './geo';
import { MAP } from './mapData';
import { bench, planeTree } from './props';

type Kind = 'round' | 'poplar';
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

const MODELS: Record<Kind, () => THREE.BufferGeometry> = {
  round: () => coloured([
    [new THREE.CylinderGeometry(0.18, 0.28, 2.6, 6).translate(0, 1.3, 0), '#5a4330'],
    [new THREE.IcosahedronGeometry(2.3, 0).scale(1, 0.85, 1).translate(0, 4.0, 0), '#4f7a32'],
    [new THREE.IcosahedronGeometry(1.6, 0).translate(0.9, 4.9, 0.4), '#5f8a3a'],
  ]),
  poplar: () => coloured([
    [new THREE.CylinderGeometry(0.16, 0.24, 3, 6).translate(0, 1.5, 0), '#6b5a45'],
    [new THREE.IcosahedronGeometry(1.5, 0).scale(1, 3.4, 1).translate(0, 7.2, 0), '#4a7a34'],
  ]),
};

/** Street lamp: batched as static geometry (cheap, and it shares the props draw call). */
const LAMP = (): THREE.BufferGeometry => coloured([
    [new THREE.CylinderGeometry(0.07, 0.1, 4.2, 6).translate(0, 2.1, 0), '#2b2f2e'],
    [new THREE.CylinderGeometry(0.16, 0.16, 0.5, 6).translate(0, 0.25, 0), '#2b2f2e'],
    [new THREE.BoxGeometry(0.34, 0.45, 0.34).translate(0, 4.35, 0), '#fff1c4'],
    [new THREE.ConeGeometry(0.32, 0.3, 4).rotateY(Math.PI / 4).translate(0, 4.72, 0), '#2b2f2e'],
  ]);

const DENSITY: Record<string, { per: number; kind: Kind | 'mix' }> = {
  forest: { per: 90, kind: 'mix' },
  park: { per: 260, kind: 'mix' },
  garden: { per: 220, kind: 'round' },
  orchard: { per: 60, kind: 'round' },
  scrub: { per: 90, kind: 'round' },
  cemetery: { per: 400, kind: 'poplar' },
};
const MAX_SCATTER = 5200;

/**
 * Trees from OSM (natural=tree, tree rows) plus forest/park infill, street
 * lamps and benches at their real positions. Repeated models are drawn with
 * one InstancedMesh per model and chunk.
 */
export function buildVegetation(ctx: BuildContext): void {
  const { collision, terrain, roads, rng } = ctx;
  const instances = new Map<string, { kind: Kind; mats: THREE.Matrix4[] }>();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  // Footprints of buildings, to keep infill trees out of houses.
  const footprints = new SpatialGrid<Pt[]>(40);
  for (const b of MAP.buildings) {
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
  const plazas = MAP.areas.filter((a) => a.k === 'pedestrian' && a.n === 'Plaza Mayor').map((a) => toPts(a.o));
  const inPlaza = (x: number, z: number) => plazas.some((r) => pointInRing(x, z, r));

  for (let i = 0; i < MAP.trees.length; i += 2) {
    const x = MAP.trees[i], z = MAP.trees[i + 1];
    if (inPlaza(x, z)) {
      planeTree(ctx, x, z, 0.03);
      continue;
    }
    const nearRiver = terrain.riverDistance(x, z).d < 40;
    place(nearRiver && hash01(x, z) < 0.7 ? 'poplar' : 'round', x, z, 0.8 + hash01(z, x) * 0.5);
  }

  // Infill for wooded areas, parks, orchards and scrub.
  let budget = MAX_SCATTER;
  for (const a of MAP.areas) {
    const d = DENSITY[a.k];
    if (!d || budget <= 0) continue;
    const ring = toPts(a.o);
    const holes = (a.h ?? []).map(toPts);
    const b = ringBounds(ring);
    const area = Math.abs((b.maxX - b.minX) * (b.maxZ - b.minZ));
    const n = Math.min(budget, Math.floor(area / d.per));
    for (let k = 0; k < n; k++) {
      const x = rng.range(b.minX, b.maxX), z = rng.range(b.minZ, b.maxZ);
      if (!pointInRing(x, z, ring) || holes.some((h) => pointInRing(x, z, h)) || blocked(x, z, 2.5)) continue;
      const kind: Kind = d.kind === 'mix' ? (terrain.riverDistance(x, z).d < 50 || rng.chance(0.3) ? 'poplar' : 'round') : d.kind;
      const scrub = a.k === 'scrub';
      place(kind, x, z, scrub ? rng.range(0.35, 0.6) : rng.range(0.75, 1.3), !scrub);
      budget--;
    }
  }

  // Street lamps at their mapped positions.
  const lamp = LAMP();
  for (let i = 0; i < MAP.lamps.length; i += 2) {
    const x = MAP.lamps[i], z = MAP.lamps[i + 1];
    ctx.batch.addMatrix(lamp, ctx.mats.propsVC, m.makeTranslation(x, terrain.heightAt(x, z), z));
    collision.addCircle(x, z, 0.15, { top: 4.5, mask: Layer.Bodies });
  }

  // Benches face the nearest street or path.
  for (let i = 0; i < MAP.benches.length; i += 2) {
    const x = MAP.benches[i], z = MAP.benches[i + 1];
    const hit = roads.nearest(x, z, 25);
    const rot = hit ? Math.atan2(hit.x - x, hit.z - z) : 0;
    bench(ctx, x, z, terrain.heightAt(x, z), rot);
  }

  const geos = Object.fromEntries((Object.keys(MODELS) as Kind[]).map((k) => [k, MODELS[k]()])) as Record<Kind, THREE.BufferGeometry>;
  for (const { kind, mats } of instances.values()) {
    const im = new THREE.InstancedMesh(geos[kind], ctx.mats.treeVC, mats.length);
    mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    for (let i = 0; i < mats.length; i++) {
      const v = 0.85 + hash01(i, mats.length) * 0.3;
      im.setColorAt(i, new THREE.Color(v, v, v));
    }
    im.computeBoundingSphere();
    im.castShadow = ctx.quality.treeShadows;
    im.receiveShadow = true;
    ctx.scene.add(im);
  }
}
