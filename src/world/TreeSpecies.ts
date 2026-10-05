import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/math';

/**
 * The trees of Villarcayo by species, built procedurally: an atlas of leaf and bark
 * textures painted on a canvas, and one model per species with a crown made of clumps
 * of leaf cards (so the silhouette is irregular, not a ball). Species codes are shared
 * with the bake (tools/geodata/trees.py), which decides each LiDAR tree's species from
 * OSM, the Nela's riparian woodland, the parks, the street trees and the crown shape.
 */

/** Atlas cells (4 × 4): leaves in the top half, barks and grasses in the bottom half. */
enum Cell {
  LeafSmall = 0,
  LeafLarge = 1,
  LeafFine = 2,
  LeafPoplar = 3,
  LeafWhite = 4,
  Needles = 5,
  Scales = 6,
  LeafShrub = 7,
  BarkGrey = 8,
  BarkPlane = 9,
  BarkPale = 10,
  BarkPine = 11,
  BarkDark = 12,
  GrassBlades = 13,
  Plume = 14,
  LeafPurple = 15,
}

/** UV rectangle of an atlas cell (with a small inset against bleeding). */
function cellUV(c: number): [number, number, number, number] {
  const col = c % 4,
    row = Math.floor(c / 4);
  const pad = 0.004;
  // Canvas row 0 is at the top, which is v = 1 in the texture.
  return [col / 4 + pad, 1 - (row + 1) / 4 + pad, (col + 1) / 4 - pad, 1 - row / 4 - pad];
}

function remapUV(g: THREE.BufferGeometry, c: number, repeatV = 1): THREE.BufferGeometry {
  const [u0, v0, u1, v1] = cellUV(c);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const v = (uv.getY(i) * repeatV) % 1.0001;
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + Math.min(1, v) * (v1 - v0));
  }
  return g;
}

// ------------------------------------------------------------------ atlas

type Paint = (g: CanvasRenderingContext2D, x0: number, y0: number, C: number, rng: Rng) => void;

const rgb = (r: number, g: number, b: number, k = 1) => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;

/** A clump of leaves: many small shapes inside a ragged round blob (transparent around it). */
function leafClump(
  shape: 'oval' | 'lobed' | 'narrow' | 'round' | 'needle',
  base: [number, number, number],
  count: number,
  size: number,
  under?: [number, number, number],
): Paint {
  return (g, x0, y0, C, rng) => {
    const cx = x0 + C / 2,
      cy = y0 + C / 2;
    for (let i = 0; i < count; i++) {
      // Denser in the middle, thinning to a ragged rim (no hard round edge to the card).
      const rr = rng.next() ** 0.75 * C * 0.45;
      const a = rng.range(0, Math.PI * 2);
      const x = cx + Math.cos(a) * rr,
        y = cy + Math.sin(a) * rr * 0.92;
      // Darker inside the clump, lit on the rim.
      const k = rng.range(0.6, 1.15) * (0.82 + (rr / (C * 0.44)) * 0.3);
      const col = under && rng.chance(0.35) ? under : base;
      g.fillStyle = rgb(col[0], col[1], col[2], k);
      const s = (size * C) / 256;
      g.save();
      g.translate(x, y);
      g.rotate(rng.range(0, Math.PI * 2));
      g.beginPath();
      if (shape === 'needle') {
        g.fillRect(-0.6 * s, -5 * s, 1.2 * s, 10 * s);
      } else if (shape === 'narrow') g.ellipse(0, 0, 6 * s, 1.6 * s, 0, 0, Math.PI * 2);
      else if (shape === 'lobed') {
        for (let l = 0; l < 5; l++) {
          const la = (l / 5) * Math.PI * 2;
          g.moveTo(0, 0);
          g.ellipse(Math.cos(la) * 3 * s, Math.sin(la) * 3 * s, 4 * s, 2.4 * s, la, 0, Math.PI * 2);
        }
      } else if (shape === 'round') g.arc(0, 0, 3 * s, 0, Math.PI * 2);
      else g.ellipse(0, 0, 4.5 * s, 2.6 * s, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  };
}

/** Bark: vertical furrows, plates or patches over a base colour (fills the whole cell). */
function barkPaint(base: [number, number, number], kind: 'furrow' | 'patch' | 'plates' | 'smooth'): Paint {
  return (g, x0, y0, C, rng) => {
    g.fillStyle = rgb(...base);
    g.fillRect(x0, y0, C, C);
    if (kind === 'patch') {
      // Plane tree: flaking patches of cream, olive and grey.
      for (let i = 0; i < 70; i++) {
        const c = rng.pick([
          [222, 214, 182],
          [168, 160, 120],
          [120, 118, 98],
          [196, 190, 160],
        ] as [number, number, number][]);
        g.fillStyle = rgb(...c);
        g.beginPath();
        g.ellipse(
          x0 + rng.range(0, C),
          y0 + rng.range(0, C),
          rng.range(6, 22) * (C / 256),
          rng.range(8, 30) * (C / 256),
          rng.range(0, 3),
          0,
          Math.PI * 2,
        );
        g.fill();
      }
      return;
    }
    if (kind === 'plates') {
      // Scots pine: orange plates with dark cracks.
      for (let i = 0; i < 120; i++) {
        g.fillStyle = rgb(base[0], base[1], base[2], rng.range(0.8, 1.25));
        const w = rng.range(10, 30) * (C / 256),
          h = rng.range(16, 44) * (C / 256);
        g.fillRect(x0 + rng.range(0, C - w), y0 + rng.range(0, C - h), w, h);
      }
    }
    const lines = kind === 'smooth' ? 40 : 140;
    for (let i = 0; i < lines; i++) {
      const x = x0 + rng.range(0, C);
      g.strokeStyle = kind === 'smooth' ? 'rgba(40,40,40,0.35)' : `rgba(25,20,15,${rng.range(0.25, 0.6)})`;
      g.lineWidth = rng.range(1, kind === 'smooth' ? 2 : 3.5) * (C / 256);
      g.beginPath();
      if (kind === 'smooth') {
        // Lenticels: short horizontal dashes (poplars).
        const y = y0 + rng.range(0, C);
        g.moveTo(x, y);
        g.lineTo(x + rng.range(4, 10) * (C / 256), y);
      } else {
        g.moveTo(x, y0);
        let xx = x;
        for (let y = y0; y <= y0 + C; y += 16) {
          xx += rng.range(-3, 3);
          g.lineTo(xx, y);
        }
      }
      g.stroke();
    }
  };
}

function grassPaint(base: [number, number, number]): Paint {
  return (g, x0, y0, C, rng) => {
    for (let i = 0; i < 160; i++) {
      const x = x0 + C / 2 + rng.range(-C * 0.42, C * 0.42);
      g.strokeStyle = rgb(base[0], base[1], base[2], rng.range(0.7, 1.2));
      g.lineWidth = rng.range(1.2, 2.6) * (C / 256);
      g.beginPath();
      g.moveTo(x0 + C / 2 + rng.range(-C * 0.06, C * 0.06), y0 + C);
      g.quadraticCurveTo(x, y0 + C * 0.5, x + rng.range(-C * 0.1, C * 0.1), y0 + rng.range(C * 0.04, C * 0.4));
      g.stroke();
    }
  };
}

function plumePaint(): Paint {
  return (g, x0, y0, C, rng) => {
    for (let i = 0; i < 500; i++) {
      const t = rng.next();
      const x = x0 + C / 2 + rng.range(-1, 1) * C * 0.16 * Math.sin(t * Math.PI);
      const y = y0 + C * 0.06 + t * C * 0.88;
      g.fillStyle = rgb(232, 222, 196, rng.range(0.85, 1.05));
      g.beginPath();
      g.ellipse(x, y, 2 * (C / 256), 5 * (C / 256), rng.range(-0.4, 0.4), 0, Math.PI * 2);
      g.fill();
    }
  };
}

const PAINT: Record<number, Paint> = {
  [Cell.LeafSmall]: leafClump('oval', [74, 104, 46], 1100, 1),
  [Cell.LeafLarge]: leafClump('lobed', [70, 102, 44], 420, 1.6),
  [Cell.LeafFine]: leafClump('narrow', [104, 134, 58], 1500, 0.9),
  [Cell.LeafPoplar]: leafClump('round', [96, 128, 52], 1000, 1.1),
  [Cell.LeafWhite]: leafClump('round', [86, 118, 64], 900, 1.1, [196, 204, 196]),
  [Cell.Needles]: leafClump('needle', [52, 80, 52], 1900, 1),
  [Cell.Scales]: leafClump('round', [44, 70, 44], 2200, 0.6),
  [Cell.LeafShrub]: leafClump('oval', [56, 92, 44], 1500, 0.7),
  [Cell.BarkGrey]: barkPaint([138, 128, 112], 'furrow'),
  [Cell.BarkPlane]: barkPaint([150, 146, 118], 'patch'),
  [Cell.BarkPale]: barkPaint([178, 176, 164], 'smooth'),
  [Cell.BarkPine]: barkPaint([176, 108, 66], 'plates'),
  [Cell.BarkDark]: barkPaint([104, 90, 76], 'furrow'),
  [Cell.GrassBlades]: grassPaint([110, 128, 70]),
  [Cell.Plume]: plumePaint(),
  [Cell.LeafPurple]: leafClump('oval', [96, 40, 52], 1100, 1),
};

/** The vegetation atlas: 1024 px on desktop, 512 on phones. */
export function treeAtlas(size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const C = size / 4;
  const rng = new Rng(4242);
  for (let i = 0; i < 16; i++) PAINT[i]?.(g, (i % 4) * C, Math.floor(i / 4) * C, C, rng);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ models

export interface SpeciesDef {
  name: string;
  /** Height and crown radius of the model at scale 1 (instances are scaled to the LiDAR's). */
  h: number;
  r: number;
  leaf: Cell;
  bark: Cell;
  trunkH: number;
  trunkR: number;
  /** Crown: centre height, half-width and half-height; number of clumps. */
  crownY: number;
  crownR: number;
  crownH: number;
  clumps: number;
  /** Leaf cards on the detailed model, and their size (m). */
  cards: number;
  card: number;
  shape?: 'dome' | 'column' | 'cone' | 'flame' | 'umbrella' | 'weeping' | 'pollard' | 'open';
  /** Leaf colour multiplier (the orthophoto tint is applied on top). */
  tint: [number, number, number];
  /** The small ones of this species (≤ this height) can be knocked down by a car. */
  breakH: number;
}

/** Species by code (see tools/geodata/trees.py for how each tree gets its species). */
export const SPECIES: Record<number, SpeciesDef> = {
  0: sp('frondoso', 9, 3.5, Cell.LeafSmall, Cell.BarkGrey, 3, 0.26, 6, 3.4, 3.2, 6, 60, 2.2, 'dome', [1, 1, 1], 6),
  1: sp('plátano de sombra', 16, 6, Cell.LeafLarge, Cell.BarkPlane, 4.5, 0.42, 10.5, 6, 5, 8, 80, 3.0, 'dome', [1, 1.02, 0.95], 6),
  2: sp('plátano podado', 7, 2.4, Cell.LeafLarge, Cell.BarkPlane, 3.2, 0.3, 4.9, 2.1, 1.5, 6, 38, 1.45, 'pollard', [1, 1.04, 0.95], 0),
  3: sp('chopo lombardo', 22, 2.2, Cell.LeafPoplar, Cell.BarkGrey, 2.5, 0.35, 12, 2.2, 10, 9, 90, 2.4, 'column', [1.02, 1.05, 0.9], 0),
  4: sp('chopo negro', 24, 6, Cell.LeafPoplar, Cell.BarkGrey, 7, 0.5, 15.5, 5.6, 8, 10, 100, 3.2, 'open', [1.02, 1.05, 0.92], 0),
  5: sp('álamo blanco', 20, 6, Cell.LeafWhite, Cell.BarkPale, 6, 0.46, 13, 5.6, 6.5, 9, 90, 3.0, 'open', [1, 1, 1], 0),
  6: sp('sauce', 10, 5, Cell.LeafFine, Cell.BarkGrey, 2.6, 0.38, 6.2, 4.8, 3.6, 8, 90, 2.4, 'weeping', [1.02, 1.04, 0.98], 6),
  7: sp('aliso', 14, 3.6, Cell.LeafSmall, Cell.BarkDark, 3.4, 0.3, 8.8, 3.4, 5.4, 7, 70, 2.3, 'cone', [0.86, 0.94, 0.86], 6),
  8: sp('fresno', 15, 5, Cell.LeafFine, Cell.BarkGrey, 4, 0.34, 9.6, 4.8, 5.2, 8, 80, 2.6, 'open', [1, 1.03, 0.94], 6),
  9: sp('falsa acacia', 13, 4.5, Cell.LeafFine, Cell.BarkDark, 3.6, 0.32, 8.6, 4.4, 4.2, 7, 66, 2.5, 'open', [1.06, 1.08, 0.88], 6.5),
  10: sp('castaño de Indias', 13, 5.5, Cell.LeafLarge, Cell.BarkGrey, 2.8, 0.42, 8, 5.4, 5, 8, 80, 2.8, 'dome', [0.9, 0.96, 0.86], 6),
  11: sp('tilo', 14, 4.6, Cell.LeafSmall, Cell.BarkGrey, 3, 0.36, 8.6, 4.4, 5.4, 8, 80, 2.4, 'dome', [1, 1.04, 0.92], 6),
  12: sp('catalpa', 9, 4.8, Cell.LeafLarge, Cell.BarkGrey, 2.4, 0.3, 6, 4.8, 3, 6, 60, 2.7, 'umbrella', [1.08, 1.1, 0.9], 6.5),
  13: sp('roble', 12, 5.5, Cell.LeafSmall, Cell.BarkDark, 3, 0.42, 7.8, 5.4, 4.2, 9, 80, 2.6, 'open', [0.9, 0.96, 0.84], 6),
  14: sp('encina', 7, 3.6, Cell.LeafSmall, Cell.BarkDark, 1.8, 0.32, 4.4, 3.6, 2.8, 7, 64, 1.9, 'dome', [0.7, 0.8, 0.74], 6),
  15: sp('pino silvestre', 17, 4, Cell.Needles, Cell.BarkPine, 10, 0.32, 13.8, 4, 3, 7, 70, 2.6, 'umbrella', [0.95, 1, 0.95], 0),
  16: sp('ciprés', 12, 1.4, Cell.Scales, Cell.BarkDark, 0.8, 0.2, 6.2, 1.4, 5.8, 6, 70, 1.4, 'flame', [0.9, 0.95, 0.9], 6),
  17: sp('tejo', 7, 3, Cell.Scales, Cell.BarkDark, 1.2, 0.3, 3.8, 3, 3.2, 6, 60, 1.6, 'cone', [0.8, 0.86, 0.82], 7),
  18: sp('frutal', 5, 2.6, Cell.LeafSmall, Cell.BarkDark, 1.4, 0.18, 3.4, 2.6, 1.7, 6, 50, 1.6, 'dome', [1.04, 1.06, 0.92], 7),
  19: sp('ciruelo rojo', 6, 2.8, Cell.LeafPurple, Cell.BarkDark, 1.8, 0.18, 4, 2.8, 2, 6, 54, 1.6, 'dome', [1, 1, 1], 7),
};

function sp(
  name: string,
  h: number,
  r: number,
  leaf: Cell,
  bark: Cell,
  trunkH: number,
  trunkR: number,
  crownY: number,
  crownR: number,
  crownH: number,
  clumps: number,
  cards: number,
  card: number,
  shape: SpeciesDef['shape'],
  tint: [number, number, number],
  breakH: number,
): SpeciesDef {
  return { name, h, r, leaf, bark, trunkH, trunkR, crownY, crownR, crownH, clumps, cards, card, shape, tint, breakH };
}

/** Cylinder from a to b (bark), open-ended. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, radial: number, bark: Cell): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true).translate(0, len / 2, 0);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(a.x, a.y, a.z);
  remapUV(g, bark, Math.max(1, len / 3));
  return g.toNonIndexed();
}

/**
 * One species model. `detail` 1 is the close-up model; ~0.25 is the distant one (few large
 * cards, no branches); phones use ~0.6 for the close one.
 */
export function speciesGeometry(code: number, detail: number): THREE.BufferGeometry {
  const s = SPECIES[code] ?? SPECIES[0];
  const rng = new Rng(1000 + code * 97);
  const parts: THREE.BufferGeometry[] = [];
  const radial = detail >= 0.6 ? 7 : 5;
  const top = new THREE.Vector3(0, s.trunkH, 0);
  const lean = s.shape === 'open' ? 0.25 : 0.08;
  top.x += rng.range(-lean, lean);
  parts.push(limb(new THREE.Vector3(0, -0.3, 0), top, s.trunkR, s.trunkR * 0.7, radial, s.bark));

  // Clump centres inside the crown envelope, by shape.
  const clumps: { c: THREE.Vector3; r: number }[] = [];
  const n = Math.max(3, Math.round(s.clumps * (detail >= 0.6 ? 1 : 0.7)));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = rng.range(0, Math.PI * 2) + i * 2.4;
    let y: number, rad: number, cr: number;
    switch (s.shape) {
      case 'column':
      case 'flame': {
        y = s.crownY - s.crownH * 0.85 + t * s.crownH * 1.75;
        const w = s.shape === 'flame' ? Math.sin(Math.min(1, (1 - t) * 1.15) * Math.PI * 0.5 + 0.2) : 1 - Math.abs(t - 0.45) * 0.9;
        rad = s.crownR * 0.45 * w;
        cr = s.crownR * (0.55 + 0.35 * w);
        break;
      }
      case 'cone': {
        y = s.crownY - s.crownH * 0.75 + t * s.crownH * 1.55;
        rad = s.crownR * (1 - t) * 0.6;
        cr = s.crownR * (0.75 - t * 0.4);
        break;
      }
      case 'umbrella': {
        y = s.crownY + rng.range(-0.35, 0.35) * s.crownH;
        rad = s.crownR * rng.range(0.25, 0.75);
        cr = s.crownR * 0.48;
        break;
      }
      case 'pollard': {
        y = s.crownY + rng.range(-0.3, 0.4) * s.crownH;
        rad = s.crownR * 0.62;
        cr = s.crownR * 0.42;
        break;
      }
      case 'open': {
        // Irregular but filled: clumps all over the crown (none left out of the middle, which
        // reads as a hollow arch), the higher ones nearer the axis.
        const u = rng.range(-0.75, 0.75);
        y = s.crownY + u * s.crownH * 0.8;
        rad = i === 0 ? 0 : s.crownR * 0.68 * Math.sqrt(rng.next()) * (1 - Math.max(0, u) * 0.45);
        cr = s.crownR * rng.range(0.38, 0.52);
        break;
      }
      default: {
        // Dome and weeping: clumps over a half-ellipsoid, the top ones larger.
        const u = rng.range(-0.3, 1);
        y = s.crownY + u * s.crownH * 0.6;
        rad = s.crownR * Math.sqrt(Math.max(0, 1 - u * u)) * 0.62;
        cr = s.crownR * 0.5;
      }
    }
    clumps.push({ c: new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad), r: cr });
  }

  // Branches from the trunk top to the clumps (close-up model only).
  if (detail >= 0.5 && s.shape !== 'flame') {
    const nb = s.shape === 'column' ? 4 : Math.min(clumps.length, 7);
    for (let i = 0; i < nb; i++) {
      const c = clumps[i].c.clone().multiplyScalar(0.8);
      c.y = Math.max(c.y - clumps[i].r * 0.4, top.y + 0.5);
      parts.push(limb(top.clone().setY(top.y - 0.4), c, s.trunkR * 0.5, s.trunkR * 0.18, 4, s.bark));
      if (s.shape === 'pollard') parts.push(knob(c, s.trunkR * 0.55, s.bark));
    }
  }

  // Leaf cards: on the surface of each clump; normals from the crown centre (soft volume).
  const cards = Math.max(8, Math.round(s.cards * detail));
  const size = s.card / Math.sqrt(Math.max(0.2, detail)) ** 0.85;
  const centre = new THREE.Vector3(0, s.crownY, 0);
  const o = new THREE.Object3D();
  const [u0, v0, u1, v1] = cellUV(s.leaf);
  for (let i = 0; i < cards; i++) {
    const cl = clumps[i % clumps.length];
    const u = rng.range(-1, 1),
      phi = rng.range(0, Math.PI * 2),
      k = rng.range(0.55, 1);
    const sq = Math.sqrt(1 - u * u);
    o.position.set(cl.c.x + sq * Math.cos(phi) * cl.r * k, cl.c.y + u * cl.r * k * 0.85, cl.c.z + sq * Math.sin(phi) * cl.r * k);
    const weeping = s.shape === 'weeping' && u < 0.2;
    o.rotation.set(weeping ? rng.range(-0.2, 0.2) : rng.range(-0.6, 0.6), rng.range(0, Math.PI), weeping ? 0 : rng.range(-0.4, 0.4));
    const sc = size * rng.range(0.8, 1.2);
    o.scale.set(sc, weeping ? sc * 1.7 : sc, 1);
    if (weeping) o.position.y -= sc * 0.6;
    o.updateMatrix();
    const card = new THREE.PlaneGeometry(1, 1);
    const uv = card.attributes.uv as THREE.BufferAttribute;
    for (let j = 0; j < uv.count; j++) uv.setXY(j, u0 + uv.getX(j) * (u1 - u0), v0 + uv.getY(j) * (v1 - v0));
    card.applyMatrix4(o.matrix);
    const pos = card.attributes.position as THREE.BufferAttribute;
    const nrm = card.attributes.normal as THREE.BufferAttribute;
    for (let j = 0; j < pos.count; j++) {
      const nv = new THREE.Vector3(
        pos.getX(j) - centre.x,
        (pos.getY(j) - centre.y) * 0.6 + s.crownH * 0.35,
        pos.getZ(j) - centre.z,
      ).normalize();
      nrm.setXYZ(j, nv.x, nv.y, nv.z);
    }
    parts.push(card.toNonIndexed());
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  g.computeBoundingSphere();
  return g;
}

function knob(c: THREE.Vector3, r: number, bark: Cell): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 5, 4).translate(c.x, c.y, c.z);
  return remapUV(g, bark).toNonIndexed();
}

// ------------------------------------------------------------------ shrubs

/** Shrub codes: 0 generic, 1 box, 2 cherry laurel, 3 purple barberry, 4 pampas grass, 5 found in the LiDAR. */
export function shrubGeometry(code: number, detail: number): THREE.BufferGeometry {
  const rng = new Rng(500 + code * 31);
  const parts: THREE.BufferGeometry[] = [];
  const o = new THREE.Object3D();
  if (code === 4) {
    // Pampas grass: a fountain of blades and a few pale plumes (1 m tall model, scaled to 2 m).
    const [b0, bv0, b1, bv1] = cellUV(Cell.GrassBlades);
    const [p0, pv0, p1, pv1] = cellUV(Cell.Plume);
    const nb = detail >= 0.6 ? 8 : 5;
    for (let i = 0; i < nb; i++) {
      o.position.set(0, 0.5, 0);
      o.rotation.set(0, (i / nb) * Math.PI, 0);
      o.scale.set(1.3, 1, 1);
      o.updateMatrix();
      parts.push(card(o.matrix, [b0, bv0, b1, bv1], 0));
    }
    for (let i = 0; i < 5; i++) {
      o.position.set(rng.range(-0.25, 0.25), 1.15, rng.range(-0.25, 0.25));
      o.rotation.set(rng.range(-0.25, 0.25), rng.range(0, Math.PI), rng.range(-0.25, 0.25));
      o.scale.set(0.35, 0.8, 1);
      o.updateMatrix();
      parts.push(card(o.matrix, [p0, pv0, p1, pv1], 0));
      o.rotation.y += Math.PI / 2;
      o.updateMatrix();
      parts.push(card(o.matrix, [p0, pv0, p1, pv1], 0));
    }
  } else {
    // A rounded bush 1 m tall, 1.3 m wide, of overlapping leaf cards.
    const leaf = code === 3 ? Cell.LeafPurple : code === 1 ? Cell.Scales : Cell.LeafShrub;
    const uvr = cellUV(leaf);
    const n = detail >= 0.6 ? 26 : 12;
    for (let i = 0; i < n; i++) {
      const u = rng.range(-0.2, 1),
        phi = rng.range(0, Math.PI * 2);
      const sq = Math.sqrt(Math.max(0, 1 - u * u));
      o.position.set(sq * Math.cos(phi) * 0.5, 0.45 + u * 0.38, sq * Math.sin(phi) * 0.5);
      o.rotation.set(rng.range(-0.6, 0.6), rng.range(0, Math.PI), rng.range(-0.4, 0.4));
      o.scale.setScalar((detail >= 0.6 ? 0.75 : 1.05) * rng.range(0.85, 1.15));
      o.updateMatrix();
      parts.push(card(o.matrix, uvr, 0.45));
    }
  }
  const g = mergeGeometries(parts)!;
  g.computeBoundingSphere();
  return g;
}

function card(m: THREE.Matrix4, [u0, v0, u1, v1]: [number, number, number, number], centreY: number): THREE.BufferGeometry {
  const c = new THREE.PlaneGeometry(1, 1);
  const uv = c.attributes.uv as THREE.BufferAttribute;
  for (let j = 0; j < uv.count; j++) uv.setXY(j, u0 + uv.getX(j) * (u1 - u0), v0 + uv.getY(j) * (v1 - v0));
  c.applyMatrix4(m);
  const pos = c.attributes.position as THREE.BufferAttribute,
    nrm = c.attributes.normal as THREE.BufferAttribute;
  for (let j = 0; j < pos.count; j++) {
    const nv = new THREE.Vector3(pos.getX(j), (pos.getY(j) - centreY) * 0.7 + 0.4, pos.getZ(j)).normalize();
    nrm.setXYZ(j, nv.x, nv.y, nv.z);
  }
  return c.toNonIndexed();
}

/** Shrub colour multipliers by code (the leaf cells carry the base colour). */
export const SHRUB_TINT: Record<number, [number, number, number]> = {
  0: [1, 1, 1],
  1: [1, 1.05, 1],
  2: [0.95, 1.05, 0.95],
  3: [1, 1, 1],
  4: [1, 1, 1],
  5: [1, 1, 1],
};
