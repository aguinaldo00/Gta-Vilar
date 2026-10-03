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
function leafTree(seed: number, trunkH: number, trunkR: number, crown: THREE.Vector3, radii: THREE.Vector3, cards: number, size: number): THREE.BufferGeometry {
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const parts: THREE.BufferGeometry[] = [bark(new THREE.CylinderGeometry(trunkR * 0.6, trunkR, trunkH, 6, 1, true).translate(0, trunkH / 2, 0))];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd();
    const len = Math.min(radii.x, radii.y) * 0.9;
    const b = new THREE.CylinderGeometry(trunkR * 0.25, trunkR * 0.45, len, 4, 1, true).translate(0, len / 2, 0);
    b.rotateZ(0.7 + rnd() * 0.3).rotateY(a).translate(0, trunkH * 0.85, 0);
    parts.push(bark(b));
  }
  const o = new THREE.Object3D();
  for (let i = 0; i < cards; i++) {
    // Point inside the crown ellipsoid, biased to its surface.
    const u = rnd() * 2 - 1, phi = rnd() * Math.PI * 2, k = 0.55 + rnd() * 0.45;
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

const MODELS: Record<Kind, () => THREE.BufferGeometry> = {
  round: () => leafTree(11, 2.9, 0.28, new THREE.Vector3(0, 5.0, 0), new THREE.Vector3(2.8, 2.4, 2.8), 18, 3.3),
  poplar: () => leafTree(23, 3.0, 0.22, new THREE.Vector3(0, 7.6, 0), new THREE.Vector3(1.7, 4.8, 1.7), 18, 2.5),
};

/** Street lamp: batched as static geometry (cheap, and it shares the props draw call). */
const LAMP = (): THREE.BufferGeometry => coloured([
    [new THREE.CylinderGeometry(0.07, 0.12, 4.2, 5, 1, true).translate(0, 2.1, 0), '#2b2f2e'],
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
  let budget = ctx.quality.treeBudget;
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
    const im = new THREE.InstancedMesh(geos[kind], ctx.mats.leavesWind, mats.length);
    im.customDepthMaterial = ctx.mats.leavesDepth;
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
