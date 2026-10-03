import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import type { BuildContext } from './context';
import { hash01, type Pt, pointInRing, ringBounds, toPts, triangulate } from './geo';
import { Unit } from './props';
import { type TerrainModel, WATER_LEVEL } from './Terrain';
import { createWaterMaterial } from './Water';

/** Water surface with an `aDepth` attribute (metres of water below each vertex). */
class WaterMesh {
  pos: number[] = [];
  depth: number[] = [];

  tri(a: Pt, b: Pt, c: Pt, y: number, depthAt: (x: number, z: number) => number): void {
    // Upward-facing winding.
    if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      this.pos.push(p[0], y, p[1]);
      this.depth.push(depthAt(p[0], p[1]));
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(this.depth, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Mitred offsets of a polyline (left/right of each vertex at distance `hw`). */
function offsets(pts: Pt[], hw: number): { left: Pt[]; right: Pt[] } {
  const left: Pt[] = [],
    right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len,
      nz = (b[0] - a[0]) / len;
    let k = hw;
    if (i > 0 && i < pts.length - 1) {
      const d = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
      const l1 = Math.hypot(d[0], d[1]) || 1;
      k = hw / Math.max(0.5, nx * (-d[1] / l1) + nz * (d[0] / l1));
    }
    left.push([pts[i][0] + nx * k, pts[i][1] + nz * k]);
    right.push([pts[i][0] - nx * k, pts[i][1] - nz * k]);
  }
  return { left, right };
}

/** River surface subdivided across its width so depth (and transparency) varies bank to bank. */
function riverSurface(
  m: WaterMesh,
  pts: Pt[],
  hw: number,
  cols: number,
  keep: (x: number, z: number) => boolean,
  depthAt: (x: number, z: number) => number,
): void {
  const { left, right } = offsets(pts, hw);
  const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i][0] + pts[i - 1][0]) / 2,
      mz = (pts[i][1] + pts[i - 1][1]) / 2;
    if (!keep(mx, mz)) continue;
    // Long segments are split along their length too.
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const rows = Math.max(1, Math.ceil(len / 6));
    for (let r = 0; r < rows; r++) {
      const t0 = r / rows,
        t1 = (r + 1) / rows;
      const L0 = lerp(left[i - 1], left[i], t0),
        L1 = lerp(left[i - 1], left[i], t1);
      const R0 = lerp(right[i - 1], right[i], t0),
        R1 = lerp(right[i - 1], right[i], t1);
      for (let c = 0; c < cols; c++) {
        const a = lerp(L0, R0, c / cols),
          b = lerp(L0, R0, (c + 1) / cols);
        const d = lerp(L1, R1, c / cols),
          e = lerp(L1, R1, (c + 1) / cols);
        m.tri(a, b, e, WATER_LEVEL, depthAt);
        m.tri(a, e, d, WATER_LEVEL, depthAt);
      }
    }
  }
}

/** Polygon water (the natural pools) as a 2 m grid clipped to the polygon. */
function gridSurface(m: WaterMesh, ring: Pt[], y: number, depthAt: (x: number, z: number) => number): void {
  const b = ringBounds(ring);
  const s = 2;
  for (let x = b.minX - s; x < b.maxX + s; x += s) {
    for (let z = b.minZ - s; z < b.maxZ + s; z += s) {
      const corners: Pt[] = [
        [x, z],
        [x + s, z],
        [x + s, z + s],
        [x, z + s],
      ];
      if (!corners.some(([cx, cz]) => pointInRing(cx, cz, ring)) && !pointInRing(x + s / 2, z + s / 2, ring)) continue;
      m.tri(corners[0], corners[1], corners[2], y, depthAt);
      m.tri(corners[0], corners[2], corners[3], y, depthAt);
    }
  }
}

/** Boulders and stones along the Río Nela banks, like the riverside in the references. */
function riverRocks(ctx: BuildContext, terrain: TerrainModel): void {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const k = 0.75 + 0.35 * hash01(x * 3.1 + z, y * 5.3);
    pos.setXYZ(i, x * k * 1.3, y * k * 0.65, z * k);
  }
  geo.computeVertexNormals();
  // Grouped in 256 m cells so only the stones near the camera are drawn.
  const cells = new Map<string, THREE.Matrix4[]>();
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3(),
    p = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0);
  for (const r of ctx.map.rivers) {
    const pts = toPts(r.p);
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1],
        [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len,
        nz = (bx - ax) / len;
      for (let t = 0; t < len; t += 3.5) {
        const h1 = hash01(ax + t, az),
          h2 = hash01(az + t, ax);
        if (h1 < 0.35) continue;
        const side = h2 < 0.5 ? -1 : 1;
        const off = r.w / 2 - 2.5 + h1 * 5;
        const x = ax + ((bx - ax) * t) / len + nx * side * off,
          z = az + ((bz - az) * t) / len + nz * side * off;
        const size = 0.25 + h2 * h2 * 1.4;
        q.setFromAxisAngle(up, h1 * 6.28);
        const key = `${Math.floor(x / 256)},${Math.floor(z / 256)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(m.compose(p.set(x, terrain.base(x, z) + size * 0.15, z), q, s.set(size, size, size)).clone());
        if (size > 0.9) ctx.collision.addCircle(x, z, size * 0.9, { top: terrain.base(x, z) + size * 0.6, mask: Layer.Bodies });
      }
    }
  }
  const mat = new THREE.MeshStandardMaterial({ color: '#9a9184', roughness: 0.95, flatShading: true });
  for (const mats of cells.values()) {
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((mm, i) => {
      im.setMatrixAt(i, mm);
      const v = 0.75 + hash01(i, mats.length) * 0.45;
      im.setColorAt(i, new THREE.Color(v, v * 0.97, v * 0.92));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    ctx.scene.add(im);
  }
}

/** Río Nela, the natural pools, streams, garden swimming pools, the weirs and riverside rocks. */
export function buildHydro(ctx: BuildContext): void {
  const { terrain } = ctx;
  const river = createWaterMaterial('#0f3a44', '#4f8a7e', 0.9);
  const pools = createWaterMaterial('#0f4f58', '#3f9a96', 0.15, 0.9);
  const stream = createWaterMaterial('#24423a', '#4f7a66', 0.6, 0.85);
  const swim = createWaterMaterial('#1f78a0', '#6fd0e6', 0.05, 0.9);
  const add = (g: THREE.BufferGeometry | null, mat: THREE.Material, order = 1) => {
    if (!g) return;
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = order;
    ctx.scene.add(mesh);
  };
  const depthAt = (x: number, z: number) => Math.max(0, WATER_LEVEL - terrain.base(x, z));

  const poolRings = ctx.map.areas.filter((a) => a.k === 'water').map((a) => toPts(a.o));
  const outsidePools = (x: number, z: number) => !poolRings.some((r) => pointInRing(x, z, r));
  const riverMesh = new WaterMesh();
  for (const r of ctx.map.rivers) riverSurface(riverMesh, toPts(r.p), r.w / 2 + 2, 8, outsidePools, depthAt);
  add(riverMesh.geometry(), river);
  const poolMesh = new WaterMesh();
  for (const ring of poolRings) gridSurface(poolMesh, ring, WATER_LEVEL + 0.005, depthAt);
  add(poolMesh.geometry(), pools);

  const streamMesh = new WaterMesh();
  for (const s of ctx.map.streams)
    riverSurface(
      streamMesh,
      toPts(s.p),
      s.w / 2,
      1,
      () => true,
      () => 0.25,
    );
  // Streams are not carved: lift them just above the ground.
  const sg = streamMesh.geometry();
  if (sg) {
    sg.translate(0, 0.03 - WATER_LEVEL, 0);
    add(sg, stream);
  }

  const swimMesh = new WaterMesh();
  for (const a of ctx.map.areas) {
    if (a.k !== 'pool') continue;
    for (const [p, q, s] of triangulate(toPts(a.o))) swimMesh.tri(p, q, s, 0.06, () => 1.6);
  }
  add(swimMesh.geometry(), swim, 2);

  // Weirs (presas: Churruca / Las Francesas, Danvila, El Soto): a stone wall
  // across the river with the water spilling over it in a band of foam.
  const foam = foamMaterial();
  ctx.animators.push((t) => {
    foam.map!.offset.y = -t * 0.9;
  });
  for (const w of ctx.map.weirs) {
    const pts = toPts(w.p);
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1],
        [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const rot = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) / 2,
        mz = (az + bz) / 2;
      ctx.batch.add(new THREE.BoxGeometry(1.4, 2.6, len + 1), ctx.mats.stone, mx, -1.6, mz, rot);
      ctx.batch.add(Unit.box, ctx.mats.concrete, mx, WATER_LEVEL + 0.12, mz, rot, 1.5, 0.2, len + 1);
      ctx.collision.addBox(mx, mz, 1.4, len + 1, { rot, bottom: -3, top: -0.3, mask: Layer.Player });
      // Spill on both faces: a steep sheet of white water and a foam apron.
      for (const side of [-1, 1]) {
        const g = new THREE.PlaneGeometry(len + 1, 1.6, 1, 1);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (len + 1) * 0.5, uv.getY(k));
        ctx.batch.add(
          g,
          foam,
          mx + Math.cos(rot) * side * 1.3,
          WATER_LEVEL + 0.02,
          mz - Math.sin(rot) * side * 1.3,
          rot + Math.PI / 2,
          1,
          1,
          1,
          -Math.PI / 2 + side * 0.25,
        );
      }
    }
  }

  riverRocks(ctx, terrain);
}

/** Scrolling white-water texture for the weirs. */
function foamMaterial(): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`;
    g.beginPath();
    g.ellipse(Math.random() * 128, Math.random() * 256, 2 + Math.random() * 6, 6 + Math.random() * 18, 0, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 200; i++) {
    g.fillStyle = 'rgba(160,190,190,0.35)';
    g.fillRect(Math.random() * 128, Math.random() * 256, 3, 12);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({
    map: t,
    transparent: true,
    depthWrite: false,
    roughness: 0.35,
    color: '#f4f8f6',
    side: THREE.DoubleSide,
  });
  m.name = 'weirFoam';
  m.userData.castShadow = false;
  return m;
}
