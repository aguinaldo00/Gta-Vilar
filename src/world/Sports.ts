import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import { LocalBatch } from './Batcher';
import type { BuildContext } from './context';
import { hash01, orientedBox, type Pt, toPts, triangulate } from './geo';
import { beamMatrix } from './geometry';
import type { MapArea } from './mapData';
import { Unit } from './props';

/** Court atlas cells (4 x 2). */
const CELL: Record<string, number> = {
  soccer: 0,
  futsal: 1,
  multi: 1,
  basketball: 2,
  tennis: 3,
  racquet: 5,
  padel: 4,
  pelota: 5,
  skateboard: 5,
  skittles: 6,
  bullfighting: 6,
  boules: 7,
  table_tennis: 5,
};

/**
 * Court surfaces with their line markings, drawn in a court-local square
 * (u along the length, v across) and stretched over each pitch.
 */
function courtAtlas(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S * 4;
  c.height = S * 2;
  const g = c.getContext('2d')!;
  const cell = (
    i: number,
    draw: (
      L: (x0: number, y0: number, x1: number, y1: number) => void,
      R: (x: number, y: number, w: number, h: number) => void,
      A: (x: number, y: number, r: number, a0?: number, a1?: number) => void,
    ) => void,
    bg: string,
    line = 'rgba(255,255,255,0.92)',
    lw = 4,
  ) => {
    g.save();
    g.translate((i % 4) * S, Math.floor(i / 4) * S);
    g.fillStyle = bg;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = line;
    g.lineWidth = lw;
    const m = 18; // margin
    const X = (u: number) => m + u * (S - 2 * m),
      Y = (v: number) => m + v * (S - 2 * m);
    draw(
      (x0, y0, x1, y1) => {
        g.beginPath();
        g.moveTo(X(x0), Y(y0));
        g.lineTo(X(x1), Y(y1));
        g.stroke();
      },
      (x, y, w, h) => g.strokeRect(X(x), Y(y), X(x + w) - X(x), Y(y + h) - Y(y)),
      (x, y, r, a0 = 0, a1 = Math.PI * 2) => {
        g.beginPath();
        g.ellipse(X(x), Y(y), r * (S - 2 * m), r * (S - 2 * m), 0, a0, a1);
        g.stroke();
      },
    );
    g.restore();
  };
  // Soccer: mown stripes, full markings.
  g.save();
  for (let k = 0; k < 12; k++) {
    g.fillStyle = k % 2 ? '#4f8c38' : '#5a9a40';
    g.fillRect((k * S) / 12, 0, S / 12, S);
  }
  g.restore();
  cell(
    0,
    (L, R, A) => {
      R(0, 0, 1, 1);
      L(0.5, 0, 0.5, 1);
      A(0.5, 0.5, 0.13);
      R(0, 0.2, 0.16, 0.6);
      R(1 - 0.16, 0.2, 0.16, 0.6);
      R(0, 0.37, 0.055, 0.26);
      R(1 - 0.055, 0.37, 0.055, 0.26);
      A(0.11, 0.5, 0.12, -0.9, 0.9);
      A(0.89, 0.5, 0.12, Math.PI - 0.9, Math.PI + 0.9);
    },
    'rgba(0,0,0,0)',
  );
  // Futsal / multi-sport: blue court, green surround.
  cell(
    1,
    (L, R, A) => {
      R(0, 0, 1, 1);
      L(0.5, 0, 0.5, 1);
      A(0.5, 0.5, 0.1);
      A(0, 0.5, 0.3, -Math.PI / 2, Math.PI / 2);
      A(1, 0.5, 0.3, Math.PI / 2, Math.PI * 1.5);
    },
    '#2f6d9a',
  );
  // Basketball: orange-red court with keys and three-point arcs.
  cell(
    2,
    (L, R, A) => {
      R(0, 0, 1, 1);
      L(0.5, 0, 0.5, 1);
      A(0.5, 0.5, 0.12);
      R(0, 0.33, 0.2, 0.34);
      R(0.8, 0.33, 0.2, 0.34);
      A(0.05, 0.5, 0.45, -1.25, 1.25);
      A(0.95, 0.5, 0.45, Math.PI - 1.25, Math.PI + 1.25);
    },
    '#b65a3a',
  );
  // Tennis: green hard court with doubles and service lines.
  cell(
    3,
    (L, R) => {
      R(0, 0, 1, 1);
      L(0, 0.125, 1, 0.125);
      L(0, 0.875, 1, 0.875);
      L(0.23, 0.125, 0.23, 0.875);
      L(0.77, 0.125, 0.77, 0.875);
      L(0.23, 0.5, 0.77, 0.5);
      L(0.5, 0, 0.5, 1);
    },
    '#3f7a54',
  );
  // Padel: blue turf with service lines.
  cell(
    4,
    (L, R) => {
      R(0, 0, 1, 1);
      L(0.5, 0, 0.5, 1);
      L(0.15, 0, 0.15, 1);
      L(0.85, 0, 0.85, 1);
      L(0.15, 0.5, 0.85, 0.5);
    },
    '#2a62a8',
  );
  // Frontón / racquet / skate: concrete with the cancha lines.
  cell(
    5,
    (L) => {
      for (let k = 1; k < 7; k++) L(k / 7, 0, k / 7, 1);
    },
    '#a7a49c',
    'rgba(250,250,250,0.55)',
    3,
  );
  // Bolera / sand ring: raked sand.
  cell(
    6,
    () => {
      for (let k = 0; k < 900; k++) {
        g.fillStyle = `rgba(${120 + Math.random() * 60},${100 + Math.random() * 40},${70 + Math.random() * 30},0.35)`;
        g.fillRect(6 * 0 + (2 % 4) * S + Math.random() * S, S + Math.random() * S, 3, 3);
      }
    },
    '#c8a874',
    'rgba(0,0,0,0)',
  );
  // Petanque: gravel.
  cell(7, () => undefined, '#b9ab90', 'rgba(0,0,0,0)');
  // Grain on every cell.
  for (let k = 0; k < 40000; k++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    g.fillRect(Math.random() * S * 4, Math.random() * S * 2, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Chain-link mesh (alpha-tested). */
function fenceTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.moveTo(32, -32);
  g.lineTo(96, 32);
  g.moveTo(-32, 32);
  g.lineTo(32, 96);
  g.moveTo(32, 96);
  g.lineTo(96, 32);
  g.moveTo(-32, 32);
  g.lineTo(32, -32);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let fenceMat: THREE.MeshStandardMaterial | null = null;

/** Shared chain-link material (one draw call per chunk for every fence and net). */
export function fenceMaterial(): THREE.MeshStandardMaterial {
  if (!fenceMat) {
    fenceMat = new THREE.MeshStandardMaterial({
      map: fenceTexture(),
      color: '#9aa39c',
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.4,
    });
    fenceMat.name = 'fence';
    fenceMat.userData.castShadow = false;
  }
  return fenceMat;
}

interface Court {
  lb: LocalBatch;
  L: number;
  W: number;
  ring: Pt[];
  cx: number;
  cz: number;
  rot: number;
}

/** Court frame: local +X along the long side. */
function courtFrame(ctx: BuildContext, ring: Pt[]): Court {
  const o = orientedBox(ring);
  let rot = o.angle,
    L = o.w,
    W = o.d;
  if (W > L) {
    rot += Math.PI / 2;
    [L, W] = [W, L];
  }
  return { lb: new LocalBatch(ctx.batch, o.cx, 0, o.cz, rot), L, W, ring, cx: o.cx, cz: o.cz, rot };
}

/** Pitch surface: the real polygon, UV-mapped in court space onto its atlas cell. */
function surface(ctx: BuildContext, c: Court, cellIdx: number, mat: THREE.Material, y: number): void {
  const pos: number[] = [],
    uv: number[] = [];
  const cos = Math.cos(c.rot),
    sin = Math.sin(c.rot);
  const cu = (cellIdx % 4) / 4,
    cv = 1 - (Math.floor(cellIdx / 4) + 1) / 2;
  for (const tri of triangulate(c.ring)) {
    const t = [...tri];
    // Upward winding.
    if ((t[1][1] - t[0][1]) * (t[2][0] - t[0][0]) - (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) < 0) [t[1], t[2]] = [t[2], t[1]];
    for (const [x, z] of t) {
      const dx = x - c.cx,
        dz = z - c.cz;
      const lx = dx * cos - dz * sin,
        lz = dx * sin + dz * cos;
      const u = Math.min(1, Math.max(0, lx / c.L + 0.5)),
        v = Math.min(1, Math.max(0, lz / c.W + 0.5));
      pos.push(x, y, z);
      uv.push(cu + (0.01 + u * 0.98) / 4, cv + (0.01 + (1 - v) * 0.98) / 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  ctx.batch.addWorld(g, mat);
}

function fenceAround(ctx: BuildContext, c: Court, h: number, fence: THREE.Material, gap = true): void {
  const post = ctx.mats.tint('#2f4a3a');
  const corners: [number, number][] = [
    [-c.L / 2, -c.W / 2],
    [c.L / 2, -c.W / 2],
    [c.L / 2, c.W / 2],
    [-c.L / 2, c.W / 2],
  ];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i],
      [bx, bz] = corners[(i + 1) % 4];
    let len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(-(bz - az), bx - ax);
    let sx = ax,
      sz = az;
    // Entrance gap at the start of the first long side.
    if (gap && i === 0) {
      sx += 1.4;
      len -= 1.4;
    }
    const mx = (sx + bx) / 2,
      mz = (sz + bz) / 2;
    const geo = new THREE.PlaneGeometry(1, 1);
    const uvs = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) * len * 2, uvs.getY(k) * h * 2);
    c.lb.add(geo, fence, mx, h / 2, mz, ang, len, h, 1);
    for (let s = 0; s <= len + 0.01; s += 3) {
      const t = s / len;
      c.lb.add(Unit.box, post, sx + (bx - sx) * t, h / 2, sz + (bz - sz) * t, 0, 0.06, h, 0.06);
    }
    c.lb.add(Unit.box, post, mx, h, mz, ang, len, 0.05, 0.05);
    const [wx, wz] = c.lb.point(mx, mz);
    ctx.collision.addBox(wx, wz, len, 0.15, { rot: c.rot + ang, top: h, mask: Layer.Bodies });
  }
}

function goal(ctx: BuildContext, c: Court, x: number, w: number, h: number, net: THREE.Material): void {
  const white = ctx.mats.tint('#f4f4f0');
  const dir = Math.sign(x);
  for (const z of [-w / 2, w / 2]) c.lb.add(Unit.cyl, white, x, h / 2, z, 0, 0.12, h, 0.12);
  c.lb.add(Unit.box, white, x, h, 0, 0, 0.12, 0.12, w + 0.12);
  // Net: back and roof.
  const d = Math.min(1.8, h * 0.7);
  c.lb.add(new THREE.PlaneGeometry(1, 1), net, x + dir * d, h / 2, 0, Math.PI / 2, w, h, 1);
  c.lb.add(new THREE.PlaneGeometry(1, 1), net, x + (dir * d) / 2, h, 0, Math.PI / 2, w, d, 1, -Math.PI / 2);
  for (const z of [-w / 2, w / 2]) {
    const [wx, wz] = c.lb.point(x, z);
    ctx.collision.addCircle(wx, wz, 0.12, { top: h, mask: Layer.Bodies });
  }
}

function hoop(ctx: BuildContext, c: Court, x: number): void {
  const dir = -Math.sign(x);
  const { mats } = ctx;
  c.lb.add(Unit.cyl, mats.tint('#3a4a5a'), x, 1.6, 0, 0, 0.14, 3.2, 0.14);
  c.lb.addMatrix(Unit.cyl, mats.tint('#3a4a5a'), beamMatrix(x, 3.0, 0, x + dir * 1.0, 3.2, 0, 0.1));
  c.lb.add(Unit.box, mats.tint('#f4f4f0'), x + dir * 1.0, 3.35, 0, 0, 0.05, 1.05, 1.8);
  c.lb.add(new THREE.TorusGeometry(0.23, 0.02, 4, 12), mats.tint('#d8501e'), x + dir * 1.3, 3.05, 0, 0, 1, 1, 1, Math.PI / 2);
  const [wx, wz] = c.lb.point(x, 0);
  ctx.collision.addCircle(wx, wz, 0.15, { top: 3.4, mask: Layer.Bodies });
}

function tennisNet(ctx: BuildContext, c: Court, w: number, net: THREE.Material): void {
  const post = ctx.mats.tint('#2f4a3a');
  for (const z of [-w / 2, w / 2]) c.lb.add(Unit.cyl, post, 0, 0.55, z, 0, 0.08, 1.1, 0.08);
  c.lb.add(new THREE.PlaneGeometry(1, 1), net, 0, 0.5, 0, Math.PI / 2, w, 0.9, 1);
  c.lb.add(Unit.box, ctx.mats.tint('#f4f4f0'), 0, 0.95, 0, 0, 0.03, 0.06, w);
}

/** Frontón: tall front wall and a side wall along the left of the cancha. */
function fronton(ctx: BuildContext, c: Court): void {
  const wall = ctx.mats.tint('#d6d0c4');
  const H = 9,
    T = 0.8;
  const fx = -c.L / 2 - T / 2;
  c.lb.add(Unit.box, wall, fx, H / 2, 0, 0, T, H, c.W + T);
  c.lb.add(Unit.box, ctx.mats.tint('#c43b2e'), fx + T / 2 + 0.02, 0.9, 0, 0, 0.03, 0.08, c.W); // chapa line
  const sl = c.L * 0.75;
  c.lb.add(Unit.box, wall, fx + sl / 2, H * 0.4, -c.W / 2 - T / 2, 0, sl, H * 0.8, T);
  for (let k = 1; k < 7; k++)
    c.lb.add(Unit.box, ctx.mats.tint('#f4f4f0'), -c.L / 2 + (k * c.L) / 7, 1.5, -c.W / 2 + 0.02, 0, 0.06, 3, 0.03);
  const [wx, wz] = c.lb.point(fx, 0);
  ctx.collision.addBox(wx, wz, T, c.W + T, { rot: c.rot, top: H });
  const [sx, sz] = c.lb.point(fx + sl / 2, -c.W / 2 - T / 2);
  ctx.collision.addBox(sx, sz, sl, T, { rot: c.rot, top: H * 0.8 });
}

/** Bolera: sand floor with a wooden curb, the nine bolos and the throwing plank. */
function bolera(ctx: BuildContext, c: Court): void {
  const wood = ctx.mats.tint('#7a5534');
  for (const z of [-c.W / 2, c.W / 2]) c.lb.add(Unit.box, wood, 0, 0.15, z, 0, c.L, 0.3, 0.12);
  for (const x of [-c.L / 2, c.L / 2]) c.lb.add(Unit.box, wood, x, 0.15, 0, 0, 0.12, 0.3, c.W);
  const bx = c.L / 2 - Math.min(6, c.L * 0.25);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      c.lb.add(Unit.cyl, ctx.mats.tint('#e2c48e'), bx + i * 0.6, 0.25, j * 0.6, 0, 0.11, 0.5, 0.11);
      c.lb.add(Unit.sphere, ctx.mats.tint('#e2c48e'), bx + i * 0.6, 0.52, j * 0.6, 0, 0.12, 0.12, 0.12);
    }
  c.lb.add(Unit.box, wood, -c.L / 2 + 2.5, 0.08, 0, 0, 0.5, 0.16, 1.6);
  for (const [x, z] of [
    [-c.L / 2 + 2.6, 1.2],
    [-c.L / 2 + 2.9, 1.4],
  ])
    c.lb.add(Unit.sphere, ctx.mats.tint('#5a3a22'), x, 0.11, z, 0, 0.22, 0.22, 0.22);
}

function borderCurb(ctx: BuildContext, c: Court): void {
  const wood = ctx.mats.tint('#7a5534');
  for (const z of [-c.W / 2, c.W / 2]) c.lb.add(Unit.box, wood, 0, 0.08, z, 0, c.L, 0.16, 0.1);
  for (const x of [-c.L / 2, c.L / 2]) c.lb.add(Unit.box, wood, x, 0.08, 0, 0, 0.1, 0.16, c.W);
}

function pingPong(ctx: BuildContext, c: Court): void {
  const conc = ctx.mats.tint('#5f7f6a');
  c.lb.add(Unit.box, conc, 0, 0.74, 0, 0, 2.74, 0.06, 1.52);
  c.lb.add(Unit.box, ctx.mats.tint('#8a8a86'), 0, 0.36, 0, 0, 0.3, 0.72, 1.0);
  c.lb.add(Unit.box, ctx.mats.tint('#9a9a96'), 0, 0.85, 0, 0, 0.03, 0.16, 1.6);
  const [wx, wz] = c.lb.point(0, 0);
  ctx.collision.addBox(wx, wz, 2.74, 1.52, { rot: c.rot, top: 0.8, mask: Layer.Bodies });
}

function buildPitch(ctx: BuildContext, a: MapArea, mats: { court: THREE.Material; fence: THREE.Material; net: THREE.Material }): void {
  const ring = toPts(a.o);
  const sport = a.s ?? 'multi';
  const c = courtFrame(ctx, ring);
  if (c.L < 3 || c.W < 2) return;
  const big = c.L > 70;
  surface(ctx, c, sport === 'soccer' && !big ? 1 : (CELL[sport] ?? 1), mats.court, 0.055);
  switch (sport) {
    case 'soccer':
    case 'futsal':
    case 'multi': {
      const gw = big ? 7.32 : 3,
        gh = big ? 2.44 : 2;
      for (const x of [-c.L / 2 + 0.3, c.L / 2 - 0.3]) goal(ctx, c, x, Math.min(gw, c.W * 0.5), gh, mats.net);
      if (sport === 'multi' && c.L > 16) for (const x of [-c.L / 2 + 1.2, c.L / 2 - 1.2]) hoop(ctx, c, x);
      if (!big && !a.c) fenceAround(ctx, c, 3, mats.fence);
      break;
    }
    case 'basketball':
      for (const x of [-c.L / 2 + 0.6, c.L / 2 - 0.6]) hoop(ctx, c, x);
      break;
    case 'tennis':
    case 'racquet':
      tennisNet(ctx, c, c.W * 0.8, mats.net);
      fenceAround(ctx, c, 3.5, mats.fence);
      break;
    case 'padel': {
      tennisNet(ctx, c, c.W, mats.net);
      // Glass back walls and fence on top.
      const glass = ctx.mats.glass;
      for (const x of [-c.L / 2, c.L / 2]) c.lb.add(Unit.box, glass, x, 1.5, 0, 0, 0.05, 3, c.W);
      fenceAround(ctx, c, 4, mats.fence);
      break;
    }
    case 'pelota':
      fronton(ctx, c);
      break;
    case 'skittles':
      bolera(ctx, c);
      break;
    case 'boules':
      borderCurb(ctx, c);
      break;
    case 'table_tennis':
      pingPong(ctx, c);
      break;
    default:
  }
}

/** Picnic table with its two benches (wood, or stone in the newer park). */
function picnicTable(ctx: BuildContext, x: number, z: number, a: number, stone: boolean): void {
  const lb = new LocalBatch(ctx.batch, x, ctx.terrain.heightAt(x, z), z, a);
  const m = stone ? ctx.mats.stone : ctx.mats.tint('#7a5534');
  const leg = stone ? ctx.mats.stone : ctx.mats.tint('#5e4128');
  lb.add(Unit.box, m, 0, 0.75, 0, 0, 1.9, stone ? 0.12 : 0.06, 0.85);
  for (const z0 of [-0.7, 0.7]) lb.add(Unit.box, m, 0, 0.45, z0, 0, 1.9, stone ? 0.1 : 0.05, 0.32);
  for (const x0 of [-0.75, 0.75]) {
    if (stone) lb.add(Unit.box, leg, x0, 0.37, 0, 0, 0.2, 0.74, 0.5);
    else {
      lb.add(Unit.box, leg, x0, 0.37, 0, 0.0, 0.08, 0.06, 1.7, 0, 0);
      lb.add(Unit.box, leg, x0, 0.4, 0, 0, 0.08, 0.8, 0.08, 0.5);
      lb.add(Unit.box, leg, x0, 0.4, 0, 0, 0.08, 0.8, 0.08, -0.5);
    }
  }
  ctx.collision.addBox(x, z, 1.9, 1.9, { rot: a, top: 0.8, mask: Layer.Bodies });
}

/** Swings and a slide on each playground. */
function playground(ctx: BuildContext, x: number, z: number, i: number): void {
  const road = ctx.roads.nearest(x, z, 6);
  if (road && road.d < 3) return;
  const a = hash01(x, z) * Math.PI;
  const lb = new LocalBatch(ctx.batch, x, ctx.terrain.heightAt(x, z), z, a);
  const { mats } = ctx;
  const red = mats.tint(['#c0392b', '#2e86c1', '#27ae60'][i % 3]),
    yellow = mats.tint('#f1c40f');
  // Swing set (A-frames + beam), two seats on chains.
  for (const sx of [-1.6, 1.6]) for (const sz of [-0.7, 0.7]) lb.addMatrix(Unit.cyl, red, beamMatrix(sx, 0, sz - 1.5, sx, 2.3, -1.5, 0.08));
  lb.add(Unit.cyl, red, 0, 2.3, -1.5, 0, 0.09, 3.3, 0.09, 0, Math.PI / 2);
  for (const sx of [-0.7, 0.7]) {
    for (const cz of [-0.2, 0.2]) lb.add(Unit.box, mats.iron, sx, 1.55, -1.5 + cz, 0, 0.015, 1.5, 0.015);
    lb.add(Unit.box, mats.tint('#222'), sx, 0.8, -1.5, 0, 0.45, 0.05, 0.25);
  }
  // Slide: platform, ladder and chute.
  lb.add(Unit.box, yellow, 1.5, 1.4, 2, 0, 1.0, 0.08, 1.0);
  for (const px of [1.05, 1.95]) for (const pz of [1.55, 2.45]) lb.add(Unit.cyl, red, px, 0.7, pz, 0, 0.08, 1.4, 0.08);
  lb.addMatrix(Unit.box, yellow, beamMatrix(1.5, 1.4, 1.5, 1.5, 0.25, -0.6, 0.6));
  for (let k = 0; k < 5; k++) lb.add(Unit.box, mats.iron, 1.5, 0.25 + k * 0.27, 2.55 + 0.1 * k, 0, 0.6, 0.04, 0.04);
  const [wx, wz] = lb.point(0, -1.5);
  ctx.collision.addBox(wx, wz, 3.4, 1.6, { rot: a, top: 2.4, mask: Layer.Bodies });
  const [px, pz] = lb.point(1.5, 2);
  ctx.collision.addBox(px, pz, 1.1, 1.1, { rot: a, top: 1.5, mask: Layer.Bodies });
}

/**
 * Sports grounds as mapped in OSM: football pitches with goals and nets,
 * basketball hoops, tennis and pádel courts with fences, the frontones, the
 * Bolera Nela and the petanque court; plus picnic tables (the riverside
 * tables in El Soto) and playground equipment.
 */
export function buildSports(ctx: BuildContext): void {
  const court = new THREE.MeshStandardMaterial({ map: courtAtlas(), roughness: 0.9 });
  court.name = 'courts';
  court.userData.castShadow = false;
  court.polygonOffset = true;
  court.polygonOffsetFactor = -1;
  court.polygonOffsetUnits = -2;
  const fence = fenceMaterial();
  const net = fence;
  for (const a of ctx.map.areas) if (a.k === 'pitch') buildPitch(ctx, a, { court, fence, net });
  const T = ctx.map.tables;
  for (let i = 0; i < T.length; i += 4) picnicTable(ctx, T[i], T[i + 1], T[i + 2], T[i + 3] === 1);
  const P = ctx.map.playgrounds;
  for (let i = 0; i < P.length; i += 2) playground(ctx, P[i], P[i + 1], i / 2);
}
