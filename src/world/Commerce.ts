import * as THREE from 'three';
import { LocalBatch } from './Batcher';
import type { BuildContext } from './context';
import { hash01 } from './geo';
import type { MapShop } from './mapData';
import { flag, Unit } from './props';
import { VEHICLE_ROADS } from './Roads';

/** How each trade dresses its ground floor. */
interface Style {
  bg: string;
  fg: string;
  font: string;
  /** Shop-front joinery colour. */
  frame: string;
  /** Awning colour (null: none). */
  awning: string | null;
  front: 'glass' | 'door' | 'shutter';
  upper?: boolean;
}

const SANS = 'Arial, Helvetica, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

/** Banks and chains carry their brand colours. */
const BRANDS: [RegExp, string, string][] = [
  [/santander/i, '#ec0000', '#ffffff'],
  [/caixa/i, '#0d71b9', '#ffffff'],
  [/rural|cajaviva/i, '#00733e', '#ffffff'],
  [/ibercaja/i, '#0c3f7e', '#ffffff'],
  [/bbva/i, '#072146', '#ffffff'],
  [/sabadell/i, '#006dff', '#ffffff'],
  [/unicaja|caja de burgos|cajacírculo|cajacirculo/i, '#2b7b3c', '#ffffff'],
  [/eroski/i, '#ffffff', '#e2001a'],
  [/\bdia\b/i, '#e30613', '#ffffff'],
  [/lupa/i, '#ffffff', '#e4032e'],
  [/carrefour/i, '#ffffff', '#1e5bc6'],
  [/correos/i, '#ffcd00', '#002e6d'],
  [/loter/i, '#ffffff', '#00539f'],
  [/estanco|tabac/i, '#7a1a1a', '#f4d03f'],
];

const SHOP_PALETTE: [string, string][] = [
  ['#24324a', '#f1e9d2'],
  ['#6b2d3c', '#f6e7c8'],
  ['#2f4f4f', '#f0ead8'],
  ['#f1ece0', '#2c2c2c'],
  ['#3d2f24', '#e9c98a'],
  ['#1d1d1d', '#ffffff'],
];

function styleOf(s: MapShop, h: number): Style {
  const brand = BRANDS.find(([re]) => re.test(s.n));
  const pick = <T>(a: T[]) => a[Math.floor(h * a.length) % a.length];
  let st: Style;
  switch (s.c) {
    case 'bar':
      st = {
        bg: pick(['#5a1e1e', '#22382a', '#2b2018', '#1c2a3a']),
        fg: '#f3e3b5',
        font: SERIF,
        frame: '#3b2a1e',
        awning: pick(['#7a2a22', '#2d5a3c', null, '#8a6a2a']),
        front: 'glass',
      };
      break;
    case 'food':
      st = {
        bg: pick(['#2f3b2a', '#4a1c1c', '#1d2b3a']),
        fg: '#f0e6c8',
        font: SERIF,
        frame: '#3b2a1e',
        awning: pick(['#2d5a3c', '#7a2a22', '#5a3a22']),
        front: 'glass',
      };
      break;
    case 'cafe':
      st = {
        bg: '#3e2a1f',
        fg: '#f2d9a6',
        font: `italic ${SERIF}`,
        frame: '#4a3020',
        awning: pick(['#c9a46a', '#6b4a2f']),
        front: 'glass',
      };
      break;
    case 'bank':
      st = { bg: '#1d4e89', fg: '#ffffff', font: SANS, frame: '#9aa0a6', awning: null, front: 'glass' };
      break;
    case 'pharmacy':
      st = { bg: '#0d7a3a', fg: '#ffffff', font: SANS, frame: '#cfd3d6', awning: null, front: 'glass' };
      break;
    case 'police':
      st = { bg: '#f2efe6', fg: '#1f4a32', font: SERIF, frame: '#1f4a32', awning: null, front: 'door' };
      break;
    case 'health':
      st = { bg: '#ffffff', fg: '#1f6fa8', font: SANS, frame: '#d8dde0', awning: null, front: 'glass' };
      break;
    case 'civic':
      st = { bg: '#e9dfc8', fg: '#3a2e22', font: SERIF, frame: '#5a4636', awning: null, front: 'door' };
      break;
    case 'grocery':
      st = {
        bg: pick(['#f6f1e4', '#8a1c1c', '#2d5a3c']),
        fg: '#000',
        font: `bold ${SERIF}`,
        frame: '#5a3a24',
        awning: pick(['#2d6a4f', '#b8332a', '#d08a1f']),
        front: 'glass',
      };
      break;
    case 'beauty':
      st = { bg: pick(['#1a1a1a', '#f3e6ea']), fg: '#000', font: `italic ${SERIF}`, frame: '#2a2a2a', awning: null, front: 'glass' };
      break;
    case 'garage':
      st = { bg: '#1d4e89', fg: '#ffffff', font: SANS, frame: '#6b6f72', awning: null, front: 'shutter' };
      break;
    case 'office':
      st = { bg: '#c9a45a', fg: '#2a2014', font: SERIF, frame: '#4a3020', awning: null, front: 'door' };
      break;
    case 'hotel':
      st = { bg: '#14213d', fg: '#e8c66a', font: SERIF, frame: '#2a2a2a', awning: '#14213d', front: 'glass' };
      break;
    default: {
      const [bg, fg] = pick(SHOP_PALETTE);
      st = {
        bg,
        fg,
        font: pick([SANS, SERIF, `bold ${SERIF}`]),
        frame: pick(['#2a2a2a', '#5a3a24', '#8a8f93', '#2f4f4f']),
        awning: h > 0.55 ? pick(['#b8332a', '#2d6a4f', '#1d4e89', '#d08a1f', '#555']) : null,
        front: 'glass',
      };
    }
  }
  if (st.fg === '#000') st.fg = st.bg === '#f6f1e4' || st.bg === '#f3e6ea' ? '#8a1c1c' : '#f6efe0';
  if (brand) {
    st.bg = brand[1];
    st.fg = brand[2];
    st.font = `bold ${SANS}`;
  }
  return st;
}

/**
 * All sign texts in one atlas (one draw call for every sign in town).
 * Cells are 8:1; signs are sized to that aspect.
 */
class SignAtlas {
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;
  private readonly cw: number;
  private readonly ch: number;
  private readonly cols = 4;
  private readonly rows: number;
  private next = 0;
  private readonly cache = new Map<string, [number, number, number, number]>();

  constructor(count: number, width: number) {
    this.cw = width / this.cols;
    this.ch = this.cw / 8;
    const rows = Math.ceil(count / this.cols);
    const height = 2 ** Math.ceil(Math.log2(rows * this.ch));
    this.rows = height / this.ch;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    this.g = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  /** UV rectangle [u0, v0, u1, v1] of the sign text. */
  cell(text: string, st: Style): [number, number, number, number] {
    const key = `${text}|${st.bg}|${st.fg}|${st.font}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const i = this.next++ % (this.cols * this.rows);
    const { g, cw, ch } = this;
    const x = (i % this.cols) * cw,
      y = Math.floor(i / this.cols) * ch;
    g.save();
    g.translate(x, y);
    g.fillStyle = st.bg;
    g.fillRect(0, 0, cw, ch);
    g.strokeStyle = st.fg;
    g.globalAlpha = 0.6;
    g.lineWidth = ch * 0.04;
    g.strokeRect(ch * 0.08, ch * 0.08, cw - ch * 0.16, ch - ch * 0.16);
    g.globalAlpha = 1;
    g.fillStyle = st.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = text.length <= 24 ? text.toUpperCase() : text;
    const maxW = cw - ch * 0.5;
    let size = ch * 0.62;
    g.font = `${size}px ${st.font}`;
    const width = g.measureText(label).width;
    if (width > maxW * 1.35 && label.includes(' ')) {
      // Two lines, split at the space nearest the middle.
      const mid = label.length / 2;
      let cut = -1;
      for (let k = 0; k < label.length; k++) if (label[k] === ' ' && (cut < 0 || Math.abs(k - mid) < Math.abs(cut - mid))) cut = k;
      size = ch * 0.36;
      g.font = `${size}px ${st.font}`;
      g.fillText(label.slice(0, cut), cw / 2, ch * 0.31, maxW);
      g.fillText(label.slice(cut + 1), cw / 2, ch * 0.71, maxW);
    } else {
      g.fillText(label, cw / 2, ch * 0.54, maxW);
    }
    g.restore();
    const H = this.rows * ch,
      W = this.cols * cw;
    const uv: [number, number, number, number] = [(x + 1) / W, 1 - (y + ch - 1) / H, (x + cw - 1) / W, 1 - (y + 1) / H];
    this.cache.set(key, uv);
    return uv;
  }
}

function signPlane(uv: [number, number, number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) ? uv[2] : uv[0], a.getY(i) ? uv[3] : uv[1]);
  return g;
}

/**
 * Real shops, bars, banks and public services (OSM): the ground floor of the
 * building that holds each one gets a shop front in the local style —
 * joinery, shop window or door, awning — and a fascia sign with its real name.
 */
export interface Signs {
  /** Plane (1 x 1, facing +Z) showing `text` on the shared sign atlas. */
  sign: (text: string, bg: string, fg: string) => THREE.BufferGeometry;
  mat: THREE.Material;
}

export function buildCommerce(ctx: BuildContext): Signs {
  const { mats, batch } = ctx;
  const atlas = new SignAtlas(ctx.map.shops.length + 16, ctx.quality.groundTexture >= 4096 ? 2048 : 1024);
  const signMat = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.55 });
  signMat.name = 'signs';
  signMat.userData.castShadow = false;
  // Lit signs (the Estanco's box sign, photos): the same atlas glowing on its own.
  const signLit = new THREE.MeshStandardMaterial({
    map: atlas.texture,
    emissiveMap: atlas.texture,
    emissive: '#ffffff',
    emissiveIntensity: 0.9,
    roughness: 0.4,
  });
  signLit.name = 'signsLit';
  signLit.userData.castShadow = false;
  // Shop windows: dark reflective glass with a warm interior glow.
  const glass = new THREE.MeshStandardMaterial({
    color: '#141a1f',
    roughness: 0.05,
    metalness: 0.9,
    emissive: '#6b5236',
    emissiveIntensity: 0.35,
  });
  glass.name = 'shopGlass';
  glass.userData.castShadow = false;
  const B = Unit.box;

  for (const s of ctx.map.shops) {
    // Seeded by the name, so both fronts of a corner shop look alike.
    let code = 0;
    for (let i = 0; i < s.n.length; i++) code = (code * 31 + s.n.charCodeAt(i)) % 100003;
    const h = hash01(code * 0.37, 2.3);
    const st = styleOf(s, h);
    if (s.aw) st.awning = s.aw;
    // The shop front stands on the pavement in front of the wall.
    // A raised door (s.dy, photos: the Juzgados over its steps) starts at its landing.
    const ground = ctx.terrain.heightAt(s.x + Math.sin(s.a) * 1.5, s.z + Math.cos(s.a) * 1.5) + (s.dy ?? 0);
    const lb = new LocalBatch(batch, s.x, ground, s.z, s.a);
    const W = s.w;
    const frame = mats.tint(st.frame);
    const half = W / 2;

    // Ground floor front.
    if (st.front === 'glass') {
      lb.add(B, frame, 0, 0.2, 0.06, 0, W, 0.4, 0.14); // stall riser
      lb.add(B, glass, 0, 1.45, 0.05, 0, W - 0.3, 2.1, 0.06);
      for (const x of [-half + 0.08, half - 0.08]) lb.add(B, frame, x, 1.3, 0.08, 0, 0.16, 2.6, 0.16);
      lb.add(B, frame, 0, 2.55, 0.08, 0, W, 0.12, 0.16); // transom
      // Glazed door with its own mullions.
      const dx = W > 4 ? -half + 1.0 : 0;
      for (const x of [dx - 0.5, dx + 0.5]) lb.add(B, frame, x, 1.15, 0.09, 0, 0.08, 2.3, 0.1);
      lb.add(B, frame, dx, 1.1, 0.1, 0, 0.06, 0.06, 0.06);
      lb.add(B, mats.tint('#c9b27a'), dx + 0.38, 1.05, 0.14, 0, 0.03, 0.35, 0.03); // handle
      // Wide fronts are glazed in bays of about 2.4 m, like the real shop windows.
      const bays = Math.max(1, Math.round(W / 2.4));
      for (let k = 1; k < bays; k++) {
        const x = -half + (W * k) / bays;
        if (Math.abs(x - dx) > 0.7) lb.add(B, frame, x, 1.45, 0.08, 0, 0.08, 2.1, 0.1);
      }
    } else if (st.front === 'shutter') {
      lb.add(B, mats.corrugated, 0, 1.5, 0.05, 0, W - 0.5, 3.0, 0.06);
      lb.add(B, frame, 0, 3.05, 0.1, 0, W - 0.3, 0.25, 0.2);
    } else {
      const dw = s.c === 'civic' || s.c === 'police' ? 1.8 : 1.1;
      lb.add(B, mats.tint(s.c === 'police' ? '#3a4a3a' : '#4a2f1f'), 0, 1.25, 0.06, 0, dw, 2.5, 0.08);
      lb.add(B, mats.stone, 0, 2.62, 0.08, 0, dw + 0.5, 0.25, 0.14); // lintel
      for (const x of [-dw / 2 - 0.13, dw / 2 + 0.13]) lb.add(B, mats.stone, x, 1.25, 0.08, 0, 0.26, 2.5, 0.14);
      lb.add(B, mats.tint('#c9b27a'), 0.25, 1.1, 0.12, 0, 0.04, 0.04, 0.06);
    }

    // Fascia sign with the real name (8:1, sized to the front).
    const sw = st.front === 'door' ? Math.min(W, s.c === 'office' ? 2.6 : 5) : Math.min(W, 6.5);
    const sh = Math.min(0.9, Math.max(0.32, sw / 8));
    const sy = st.front === 'shutter' ? 3.25 + sh / 2 : 2.75 + sh / 2;
    lb.add(B, mats.tint(st.bg), 0, sy, 0.05, 0, sw + 0.1, sh + 0.1, 0.1);
    lb.addMatrix(
      signPlane(atlas.cell(s.n, st)),
      s.lit ? signLit : signMat,
      new THREE.Matrix4().makeScale(sw, sh, 1).setPosition(0, sy, 0.102),
    );

    // Awning over the shop window.
    if (st.awning && st.front === 'glass') {
      const aw = mats.tint(st.awning);
      lb.add(B, aw, 0, 2.38, 0.62, 0, W - 0.1, 0.04, 1.3, 0.38);
      lb.add(B, aw, 0, 2.08, 1.24, 0, W - 0.1, 0.28, 0.03); // valance
      for (const x of [-half + 0.1, half - 0.1]) lb.add(B, mats.iron, x, 2.38, 0.62, 0, 0.03, 0.03, 1.3, 0.38);
    }

    // Trade-specific details.
    if (s.c === 'pharmacy') {
      // Lit green cross on a bracket, seen from both ways along the street.
      const g = mats.glow('#29d36a');
      lb.add(B, mats.iron, half - 0.4, sy + 0.9, 0.3, 0, 0.06, 0.06, 0.6);
      lb.add(B, g, half - 0.4, sy + 0.9, 0.75, 0, 0.08, 0.8, 0.27);
      lb.add(B, g, half - 0.4, sy + 0.9, 0.75, 0, 0.08, 0.27, 0.8);
    } else if (s.c === 'bank') {
      const ax = half - 0.7;
      lb.add(B, mats.tint('#5d6266'), ax, 1.25, 0.12, 0, 0.75, 1.7, 0.16);
      lb.add(B, mats.glow('#6fc2ff'), ax, 1.55, 0.21, 0, 0.42, 0.3, 0.02);
      lb.add(B, mats.tint('#1b1b1b'), ax, 1.1, 0.23, 0, 0.5, 0.18, 0.05);
    } else if (s.c === 'police') {
      // Casa cuartel: the flag over the door and a lamp on each side.
      const c = Math.cos(s.a),
        sn = Math.sin(s.a);
      flag(ctx, 'es', s.x + sn * 0.15, ground + sy + 0.5, s.z + c * 0.15, 2.4, s.a, 0.8);
      for (const x of [-1.6, 1.6]) {
        lb.add(B, mats.iron, x, 2.6, 0.18, 0, 0.05, 0.05, 0.35);
        lb.add(B, mats.glow('#ffe2a0'), x, 2.45, 0.35, 0, 0.18, 0.28, 0.18);
      }
    } else if (s.c === 'bar' || s.c === 'cafe' || s.c === 'hotel') {
      // Hanging bracket lantern.
      lb.add(B, mats.iron, -half + 0.3, 3.0 + sh, 0.3, 0, 0.04, 0.04, 0.6);
      lb.add(B, mats.glow('#ffd58a'), -half + 0.3, 2.75 + sh, 0.55, 0, 0.16, 0.26, 0.16);
    }

    // Bar and café terraces where the pavement or the square has room.
    if ((s.c === 'bar' || s.c === 'cafe') && (s.tr || (h < 0.7 && !s.nt)) && !s.s) {
      const out = 2.6;
      const px = s.x + Math.sin(s.a) * out,
        pz = s.z + Math.cos(s.a) * out;
      const road = ctx.roads.nearest(px, pz, 6, (r) => VEHICLE_ROADS.has(r.k));
      if (!road || road.d > 1.4) {
        const n = W > 5 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const tx = n === 1 ? 0 : (k - 0.5) * (W / 2);
          terraceTable(ctx, lb, tx, out, st.awning ?? st.bg);
        }
      }
    }
  }
  return {
    sign: (text, bg, fg) => signPlane(atlas.cell(text, { bg, fg, font: `bold ${SANS}`, frame: bg, awning: null, front: 'door' })),
    mat: signMat,
  };
}

function terraceTable(ctx: BuildContext, lb: LocalBatch, x: number, z: number, parasol: string): void {
  const { mats } = ctx;
  const metal = mats.tint('#8d9296');
  lb.add(Unit.cyl, metal, x, 0.37, z, 0, 0.06, 0.74, 0.06);
  lb.add(Unit.cyl, metal, x, 0.75, z, 0, 0.7, 0.03, 0.7);
  for (const [cx, cz, r] of [
    [-0.62, 0, Math.PI / 2],
    [0.62, 0, -Math.PI / 2],
  ] as const) {
    lb.add(Unit.box, metal, x + cx, 0.45, z + cz, r, 0.42, 0.04, 0.42);
    lb.add(Unit.box, metal, x + cx * 1.3, 0.7, z + cz, r, 0.42, 0.5, 0.03);
    lb.add(Unit.box, metal, x + cx, 0.22, z + cz, r, 0.4, 0.45, 0.025);
  }
  lb.add(Unit.cyl, mats.tint('#dddddd'), x, 1.35, z, 0, 0.04, 1.2, 0.04);
  lb.add(Unit.cone, mats.tint(parasol), x, 2.1, z, 0, 2.4, 0.45, 2.4);
  const [wx, wz] = lb.point(x, z);
  ctx.collision.addCircle(wx, wz, 0.5, { top: 0.8 });
}
