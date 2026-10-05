import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import { LocalBatch } from './Batcher';
import type { BuildContext } from './context';
import { centroid, orientedBox, type Pt, signedArea, toPts } from './geo';
import { beamMatrix, boxGeo } from './geometry';
import type { MapBuilding } from './mapData';
import { Unit } from './props';

/** Buildings drawn by this module instead of the generic extruder. */
export const CUSTOM_CHURCHES = /^(Iglesia de Santa Marina|Ermita de San Roque|Ermita de San Vicente)$/;

/** Triangles → non-indexed geometry with planar UVs (metres / tile). */
function tris(points: number[][], tile = 2): THREE.BufferGeometry {
  const pos: number[] = [],
    uv: number[] = [];
  for (let i = 0; i < points.length; i += 3) {
    const [a, b, c] = [points[i], points[i + 1], points[i + 2]];
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
    );
    const ax = Math.abs(n.x) > Math.abs(n.z) ? 'x' : 'z';
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      if (Math.abs(n.y) > Math.max(Math.abs(n.x), Math.abs(n.z))) uv.push(p[0] / tile, p[2] / tile);
      else uv.push((ax === 'x' ? p[2] : p[0]) / tile, p[1] / tile);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Gable roof over a L x W rectangle (ridge along X), slopes only; UVs run down the slope. */
function gableSlopes(L: number, W: number, eave: number, ridge: number, over = 0.5): THREE.BufferGeometry {
  const x0 = -L / 2 - over,
    x1 = L / 2 + over,
    z = W / 2 + over;
  const drop = ((ridge - eave) * over) / (W / 2);
  const e = eave - drop;
  const pos = [
    [x0, e, z],
    [x1, e, z],
    [x1, ridge, 0],
    [x0, e, z],
    [x1, ridge, 0],
    [x0, ridge, 0],
    [x1, e, -z],
    [x0, e, -z],
    [x0, ridge, 0],
    [x1, e, -z],
    [x0, ridge, 0],
    [x1, ridge, 0],
  ];
  const slope = Math.hypot(z, ridge - e);
  const g = tris(pos);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < 12; i++) uv.setXY(i, pos[i][0] / 2, (pos[i][1] === ridge ? slope : 0) / 2);
  return g;
}

/** Gable-end triangle at x, facing ±X. */
function gableEnd(x: number, W: number, eave: number, ridge: number, dir: 1 | -1): THREE.BufferGeometry {
  const a = [x, eave, -W / 2],
    b = [x, eave, W / 2],
    c = [x, ridge, 0];
  return tris(dir > 0 ? [a, c, b] : [a, b, c]);
}

/** Frame: local +X along the long axis, +X end is the front (towards `front`). */
function frame(ctx: BuildContext, ring: Pt[], front: Pt): { lb: LocalBatch; L: number; W: number; rot: number; cx: number; cz: number } {
  const o = orientedBox(ring);
  let rot = o.angle,
    L = o.w,
    W = o.d;
  if (W > L) {
    rot += Math.PI / 2;
    [L, W] = [W, L];
  }
  // Local +X in world is (cos rot, -sin rot); flip if the front lies behind.
  if ((front[0] - o.cx) * Math.cos(rot) - (front[1] - o.cz) * Math.sin(rot) < 0) rot += Math.PI;
  // Stand on the lowest ground under the building so no corner floats.
  const y = Math.min(...ring.map(([x, z]) => ctx.terrain.heightAt(x, z)));
  return { lb: new LocalBatch(ctx.batch, o.cx, y, o.cz, rot), L, W, rot, cx: o.cx, cz: o.cz };
}

function solid(ctx: BuildContext, f: { lb: LocalBatch; rot: number }, x: number, z: number, w: number, d: number, top: number): void {
  const [wx, wz] = f.lb.point(x, z);
  ctx.collision.addBox(wx, wz, w, d, { rot: f.rot, top, mask: Layer.Solid });
}

/**
 * The front gable of Santa Marina: a concrete lattice pierced by oval
 * openings of every size, glazed with coloured glass (from the photos).
 */
function celosiaTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9d2c2';
  g.fillRect(0, 0, S, S);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const placed: [number, number, number][] = [];
  const glass = ['#2a3f66', '#3b2a1e', '#8a5a1c', '#5e2626', '#264d3a', '#3a3a5a'];
  for (let k = 0; k < 2600 && placed.length < 150; k++) {
    const r = 10 + rnd() * 34;
    const x = rnd() * S,
      y = rnd() * S;
    if (placed.some(([px, py, pr]) => Math.hypot(px - x, py - y) < pr + r + 7)) continue;
    placed.push([x, y, r]);
    const ry = r * (0.75 + rnd() * 0.5);
    // Raised concrete rim, then the glass.
    g.fillStyle = '#c2bba9';
    g.beginPath();
    g.ellipse(x, y, r + 4, ry + 4, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = glass[Math.floor(rnd() * glass.length)];
    g.beginPath();
    g.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.ellipse(x - r * 0.25, y - ry * 0.3, r * 0.45, ry * 0.3, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Extent of a ring along the horizontal line at z: [xmin, xmax] or null. */
function spanAt(ring: Pt[], z: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i],
      [bx, bz] = ring[(i + 1) % ring.length];
    if ((az <= z && bz > z) || (bz <= z && az > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}

/** Tent profile across the nave: 0 at the eaves, 1 at the ridge, slightly concave like the real roof. */
const tent = (u: number) => (1 - Math.abs(u)) ** 1.18;

/**
 * Iglesia de Santa Marina (José Luis Gutiérrez, 1967), from the photos and
 * the LiDAR: a "tent" whose two roof planes rise from low white walls (eaves
 * ~5 m) to a ridge of 19.5 m over the front gable, falling to ~9 m over the
 * curved apse, following the real outline as it narrows. The front gable is a
 * concrete lattice of oval stained-glass openings under the cross; a flat
 * porch on slender paired pillars runs along the whole front over a stone
 * base with steps; the free-standing white needle of the campanile stands at
 * the front corner.
 */
function santaMarina(ctx: BuildContext): void {
  const parts = ctx.map.buildings.filter((b) => b.n === 'Iglesia de Santa Marina' && b.part);
  if (!parts.length) return;
  const area = (b: MapBuilding) => Math.abs(signedArea(toPts(b.o)));
  parts.sort((a, b) => area(b) - area(a));
  const naveB = parts[0];
  const nave = toPts(naveB.o);
  const porchRing = parts[1] ? toPts(parts[1].o) : null;
  const { mats, terrain } = ctx;
  const white = mats.tint('#ecebe6');
  const roofMat = mats.tint('#d3d6d6');
  const stone = mats.stone;
  const ground = naveB.gy ?? terrain.heightAt(...centroid(nave));
  const zs = nave.map((p) => p[1]);
  // The front is the side of the porch (smaller z here); the apse the opposite end.
  const porchZ = porchRing ? centroid(porchRing)[1] : Math.min(...zs);
  const front = porchZ < centroid(nave)[1] ? Math.min(...zs) + 0.4 : Math.max(...zs) - 0.4;
  const back = porchZ < centroid(nave)[1] ? Math.max(...zs) - 0.4 : Math.min(...zs) + 0.4;
  const dir = Math.sign(back - front);
  const eave = ground + 4.4;
  // Measured ridge: 19.5 m over the front gable, ~9 m over the apse (local heights).
  const ridgeFront = Math.max(eave + 6, naveB.top !== undefined ? naveB.top + 3.5 : 19.5);
  const ridgeBack = eave + 3.8;
  const N = 20,
    M = 8;
  const sections: { z: number; x0: number; x1: number; ridge: number }[] = [];
  for (let k = 0; k <= N; k++) {
    const z = front + ((back - front) * k) / N;
    const sp = spanAt(nave, z);
    if (!sp) continue;
    const t = k / N;
    sections.push({ z, x0: sp[0] - 0.3, x1: sp[1] + 0.3, ridge: ridgeFront + (ridgeBack - ridgeFront) * t });
  }
  if (sections.length < 2) return;
  const pos: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const at = (s: (typeof sections)[0], u: number): number[] => {
    const cx = (s.x0 + s.x1) / 2,
      hw = (s.x1 - s.x0) / 2;
    return [cx + u * hw, eave + (s.ridge - eave) * tent(u), s.z];
  };
  for (let k = 1; k < sections.length; k++) {
    const s0 = sections[k - 1],
      s1 = sections[k];
    for (let i = 0; i < M; i++) {
      for (const side of [-1, 1]) {
        const u0 = (side * i) / M,
          u1 = (side * (i + 1)) / M;
        quad(at(s0, u0), at(s0, u1), at(s1, u1), at(s1, u0));
      }
    }
    // Low white side walls under the eaves.
    for (const [x0, x1] of [
      [s0.x0, s1.x0],
      [s0.x1, s1.x1],
    ]) {
      const wall = [
        [x0 + 0.3 * Math.sign(s0.x1 - x0 || 1), ground - 0.5, s0.z],
        [x1 + 0.3 * Math.sign(s1.x1 - x1 || 1), ground - 0.5, s1.z],
        [x1 + 0.3 * Math.sign(s1.x1 - x1 || 1), eave, s1.z],
        [x0 + 0.3 * Math.sign(s0.x1 - x0 || 1), eave, s0.z],
      ];
      ctx.batch.addWorld(tris([wall[0], wall[1], wall[2], wall[0], wall[2], wall[3]]), white);
    }
  }
  // Both faces: the roof is seen from the street and from below at the eaves.
  const roofPts: number[][] = [];
  for (let i = 0; i < pos.length; i += 9) {
    const a = [pos[i], pos[i + 1], pos[i + 2]],
      b = [pos[i + 3], pos[i + 4], pos[i + 5]],
      c = [pos[i + 6], pos[i + 7], pos[i + 8]];
    roofPts.push(a, b, c, a, c, b);
  }
  ctx.batch.addWorld(tris(roofPts), roofMat);
  // Back gable over the apse and the folded white edge along both roof verges.
  const sb = sections[sections.length - 1];
  const sf = sections[0];
  const fan = (s: (typeof sections)[0]) => {
    const pts: number[][] = [];
    const cx = (s.x0 + s.x1) / 2;
    for (let i = 0; i < 2 * M; i++) {
      const u0 = -1 + i / M,
        u1 = -1 + (i + 1) / M;
      pts.push([cx, eave, s.z], at(s, u0), at(s, u1));
    }
    return pts;
  };
  ctx.batch.addWorld(tris(fan(sb)), white);
  for (const s of [sf]) {
    for (let i = 0; i < 2 * M; i++) {
      const u0 = -1 + i / M,
        u1 = -1 + (i + 1) / M;
      const a = at(s, u0),
        b = at(s, u1);
      ctx.batch.addMatrix(Unit.box, white, beamMatrix(a[0], a[1] + 0.2, a[2] - dir * 0.15, b[0], b[1] + 0.2, b[2] - dir * 0.15, 0.45));
    }
  }
  // Front gable: the lattice of oval stained glass, mapped across the whole triangle.
  const lattice = new THREE.MeshStandardMaterial({ map: celosiaTexture(), roughness: 0.75, emissive: '#3a2a10', emissiveIntensity: 0.25 });
  lattice.name = 'vidrieras';
  lattice.side = THREE.DoubleSide;
  {
    const pts = fan(sf).map((p) => [p[0], p[1], p[2] - dir * 0.05]);
    const g = tris(pts);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const w = sf.x1 - sf.x0,
      h = sf.ridge - eave;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pts[i][0] - sf.x0) / w, (pts[i][1] - eave) / h);
    ctx.batch.addWorld(g, lattice);
  }
  // Cross standing over the apex, in front of the gable.
  const cx = (sf.x0 + sf.x1) / 2;
  ctx.batch.add(Unit.box, mats.iron, cx, sf.ridge + 1.2, sf.z - dir * 0.6, 0, 0.22, 7, 0.22);
  ctx.batch.add(Unit.box, mats.iron, cx, sf.ridge + 3.0, sf.z - dir * 0.6, 0, 2.6, 0.22, 0.22);

  // Porch along the whole front: flat slab with a white fascia on paired pillars, over a stone base.
  if (porchRing) {
    const xs = porchRing.map((p) => p[0]),
      pzs = porchRing.map((p) => p[1]);
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs);
    const zOut = dir > 0 ? Math.min(...pzs) : Math.max(...pzs);
    const zIn = front;
    const pz = (zOut + zIn) / 2,
      depth = Math.abs(zIn - zOut) + 0.6;
    const base = (parts[1].gy ?? ground) + 0.6;
    const slab = base + 4.0;
    ctx.batch.add(Unit.box, stone, (x0 + x1) / 2, base - 0.55, pz, 0, x1 - x0 + 0.4, 1.3, depth);
    // Steps up to the platform in front of the doors.
    for (let k = 0; k < 3; k++)
      ctx.batch.add(Unit.box, stone, cx, base - 0.2 * (k + 1), zOut - dir * (0.35 + k * 0.35), 0, 9 - k * 0.4, 0.2 * 2, 0.35);
    ctx.batch.add(Unit.box, white, (x0 + x1) / 2, slab, pz - dir * 0.2, 0, x1 - x0 + 0.8, 0.35, depth + 0.6);
    ctx.batch.add(Unit.box, white, (x0 + x1) / 2, slab + 0.05, zOut - dir * 0.2, 0, x1 - x0 + 0.9, 0.55, 0.12);
    for (const px of [x0 + 1.2, cx - 5.5, cx + 5.5, x1 - 1.2]) {
      for (const o of [-0.25, 0.25]) ctx.batch.add(Unit.box, white, px + o, (base + slab) / 2, zOut + dir * 0.4, 0, 0.16, slab - base, 0.6);
      ctx.collision.addBox(px, zOut + dir * 0.4, 0.7, 0.6, { top: slab - ground, mask: Layer.Solid });
    }
    // Front wall under the gable: wooden doors and the tall mosaic panels of the saints.
    ctx.batch.add(Unit.box, white, cx, (base + eave) / 2, zIn + dir * 0.1, 0, sf.x1 - sf.x0, eave - base, 0.25);
    ctx.batch.add(Unit.box, mats.tint('#5a3a22'), cx, base + 1.5, zIn - dir * 0.05, 0, 4.2, 3.0, 0.1);
    const mosaic = ['#c9a24a', '#8a5a7a', '#5a7aa8'];
    for (const [i, o] of [-9, -7.5, -6, 6, 7.5, 9].entries())
      ctx.batch.add(Unit.box, mats.glow(mosaic[i % 3]), cx + o, base + 2.0, zIn - dir * 0.05, 0, 0.6, 2.6, 0.06);
    ctx.collision.addBox((x0 + x1) / 2, pz, x1 - x0, depth, { top: base - ground, mask: Layer.Solid });
  }
  // Nave collision: the walls of the outline.
  for (let i = 0; i < nave.length; i++) {
    const [ax, az] = nave[i],
      [bx, bz] = nave[(i + 1) % nave.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.3) continue;
    ctx.collision.addBox((ax + bx) / 2, (az + bz) / 2, len, 0.5, {
      rot: Math.atan2(-(bz - az), bx - ax),
      top: eave + 2 - ground,
      mask: Layer.Solid,
    });
  }
  const tower = ctx.map.pois.find((p) => p.k === 'belltower' && Math.hypot(p.x - centroid(nave)[0], p.z - centroid(nave)[1]) < 40);
  if (tower) campanile(ctx, tower.x, tower.z);
}

/** The campanile: a white concrete needle, 28.7 m tall in the LiDAR, crowned by a cross. */
function campanile(ctx: BuildContext, x: number, z: number): void {
  const y = ctx.terrain.heightAt(x, z);
  const { mats } = ctx;
  const H = 27.2;
  const needle = new THREE.CylinderGeometry(0.32, 0.95, H, 4, 1).rotateY(Math.PI / 4);
  ctx.batch.add(needle, mats.tint('#f0efea'), x, y + H / 2, z);
  // A slit for the bells near the top.
  ctx.batch.add(Unit.box, mats.tint('#2b2b2b'), x, y + H - 6, z, 0, 0.5, 2.2, 1.02);
  ctx.batch.add(Unit.box, mats.iron, x, y + H + 1.2, z, 0, 0.12, 2.6, 0.12);
  ctx.batch.add(Unit.box, mats.iron, x, y + H + 1.7, z, 0, 0.12, 0.12, 1.2);
  ctx.collision.addCircle(x, z, 0.9, { top: H, mask: Layer.Solid });
}

/**
 * Stone hermitage: single nave with a tiled gable roof, buttresses, a plain
 * rectangular doorway with its inscription and the espadaña (bell gable) on
 * the front, as at San Roque (rebuilt in 1784) and San Vicente.
 */
function ermita(ctx: BuildContext, name: string, bells: number, plaza = false): void {
  const b = ctx.map.buildings.find((x) => x.n === name);
  if (!b) return;
  const ring = toPts(b.o);
  const c = centroid(ring);
  const road = ctx.roads.nearest(c[0], c[1], 120);
  const o = orientedBox(ring);
  const long = Math.max(o.w, o.d);
  // Front: the short end closest to the road.
  const ax = o.w >= o.d ? o.angle : o.angle + Math.PI / 2;
  const ends: Pt[] = [
    [c[0] + (Math.cos(ax) * long) / 2, c[1] - (Math.sin(ax) * long) / 2],
    [c[0] - (Math.cos(ax) * long) / 2, c[1] + (Math.sin(ax) * long) / 2],
  ];
  const front = road
    ? ends.sort((p, q) => Math.hypot(p[0] - road.x, p[1] - road.z) - Math.hypot(q[0] - road.x, q[1] - road.z))[0]
    : ends[0];
  const f = frame(ctx, ring, front);
  const { lb, L, W } = f;
  const { mats } = ctx;
  const eave = Math.min(6.5, 3.2 + W * 0.3),
    ridge = eave + W * 0.32;
  lb.add(boxGeo(L, eave, W, 2), mats.stone, 0, eave / 2, 0);
  for (const dir of [1, -1] as const) lb.add(gableEnd((dir * L) / 2, W, eave, ridge, dir), mats.stone, 0, 0, 0);
  lb.add(gableSlopes(L, W, eave, ridge, 0.45), mats.roof, 0, 0, 0);
  // Buttresses and cornice.
  for (let x = -L / 2 + L / 4; x < L / 2 - 1; x += L / 4) {
    for (const s of [-1, 1]) lb.add(Unit.box, mats.stone, x, eave * 0.4, s * (W / 2 + 0.35), 0, 1.0, eave * 0.8, 0.7);
  }
  for (const s of [-1, 1]) lb.add(Unit.box, mats.stoneTrim, 0, eave - 0.1, s * (W / 2 + 0.12), 0, L + 0.2, 0.25, 0.3);
  // Front: doorway with lintel, plaque, oculus, espadaña.
  const fx = L / 2 + 0.06;
  lb.add(Unit.box, mats.tint('#4a2f1f'), fx, 1.45, 0, 0, 0.1, 2.9, 1.7);
  lb.add(Unit.box, mats.stoneTrim, fx + 0.06, 3.05, 0, 0, 0.2, 0.35, 2.4);
  for (const z of [-1.05, 1.05]) lb.add(Unit.box, mats.stoneTrim, fx + 0.06, 1.45, z, 0, 0.2, 2.9, 0.35);
  lb.add(Unit.box, mats.tint('#cbbf9f'), fx + 0.05, 3.75, 0, 0, 0.08, 0.6, 1.8);
  lb.add(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 12), mats.tint('#2a3038'), fx + 0.02, eave + 0.9, 0, 0, 1, 1, 1, 0, Math.PI / 2);
  const ew = bells > 1 ? 4.2 : 2.6,
    eh = 3.6,
    ey = ridge - 0.6;
  lb.add(Unit.box, mats.stone, L / 2 - 0.4, ey + eh / 2, 0, 0, 0.8, eh, ew);
  lb.add(new THREE.ConeGeometry(ew * 0.72, 1.3, 4).rotateY(Math.PI / 4), mats.stone, L / 2 - 0.4, ey + eh + 0.6, 0, 0, 0.35, 1, 1);
  const holes = bells > 1 ? [-1, 1] : [0];
  for (const z of holes) {
    lb.add(Unit.box, mats.tint('#2a2622'), L / 2 - 0.4, ey + 1.9, z, 0, 0.84, 1.6, 0.9);
    lb.add(new THREE.CylinderGeometry(0.2, 0.42, 0.7, 10), mats.bronze, L / 2 - 0.4, ey + 1.8, z);
  }
  lb.add(Unit.box, mats.iron, L / 2 - 0.4, ey + eh + 1.7, 0, 0, 0.1, 1.4, 0.1);
  lb.add(Unit.box, mats.iron, L / 2 - 0.4, ey + eh + 1.9, 0, 0, 0.1, 0.1, 0.7);
  solid(ctx, f, 0, 0, L, W + 1.4, ridge);
  if (plaza) ermitaPlaza(ctx, f, L, W);
}

/**
 * San Roque (photos with P): clipped hedges along both sides of the ermita, and in front of
 * the door a small paved square with four benches facing each other, a litter bin, and low
 * stone walls to sit on round its edge, open towards the path.
 */
function ermitaPlaza(ctx: BuildContext, f: ReturnType<typeof frame>, L: number, W: number): void {
  const { lb, rot } = f;
  const { mats, collision } = ctx;
  const hedge = mats.tint('#2e5228');
  const stone = mats.tint('#d9cfb8');
  const wood = mats.tint('#7a5534');
  const add = (x: number, z: number, w: number, d: number, h: number, mat: THREE.Material, mask: number = Layer.Solid) => {
    lb.add(Unit.box, mat, x, h / 2, z, 0, w, h, d);
    const [wx, wz] = lb.point(x, z);
    collision.addBox(wx, wz, w, d, { rot: rot, top: h, mask });
  };
  // Hedges along the long sides, a metre off the walls.
  for (const s of [-1, 1]) add(-0.5, s * (W / 2 + 1.4), L - 1.5, 0.8, 1.0, hedge, Layer.Bodies);
  // The square: 7 m deep, as wide as the front.
  const x0 = L / 2 + 0.8,
    x1 = L / 2 + 7.8,
    hw = Math.max(4, W / 2 + 0.5);
  lb.add(Unit.box, stone, (x0 + x1) / 2, 0.02, 0, 0, x1 - x0, 0.04, 2 * hw);
  // Sitting walls on both sides, leaving the front open to the path.
  for (const s of [-1, 1]) add((x0 + x1) / 2, s * hw, x1 - x0, 0.45, 0.45, stone, Layer.Bodies);
  // Four benches facing across the square, and the bin by the door.
  for (const s of [-1, 1])
    for (const bx of [x0 + 2, x0 + 5]) {
      const z = s * (hw - 1.1);
      lb.add(Unit.box, wood, bx, 0.45, z, 0, 1.8, 0.07, 0.45);
      lb.add(Unit.box, wood, bx, 0.75, z + s * 0.22, 0, 1.8, 0.4, 0.06);
      for (const lx of [-0.75, 0.75]) lb.add(Unit.box, mats.iron, bx + lx, 0.22, z, 0, 0.06, 0.45, 0.4);
      const [wx, wz] = lb.point(bx, z);
      collision.addBox(wx, wz, 1.8, 0.5, { rot, top: 0.5, mask: Layer.Bodies });
    }
  lb.add(Unit.cyl, mats.tint('#3b4a3a'), x0 + 0.6, 0.45, hw - 0.6, 0, 0.25, 0.9, 0.25);
}

export function buildChurches(ctx: BuildContext): void {
  santaMarina(ctx);
  ermita(ctx, 'Ermita de San Roque', 2, true);
  ermita(ctx, 'Ermita de San Vicente', 1);
}
