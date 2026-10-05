import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import { LocalBatch } from './Batcher';
import type { BuildContext } from './context';
import { toPts } from './geo';
import { beamMatrix } from './geometry';
import type { MapFurniture } from './mapData';
import { flag, Unit } from './props';

/**
 * Sign faces in one atlas (alpha-tested): STOP octagon, give-way triangle,
 * trail map, information, DEA, S-13 pedestrian crossing, R-303 no left turn,
 * P-15a speed bump.
 */
const SIGN_CELLS = ['stop', 'give_way', 'map', 'board', 'aed', 'S-13', 'R-303', 'P-15a', 'R-101'] as const;
type SignCell = (typeof SIGN_CELLS)[number];

function signAtlas(): THREE.CanvasTexture {
  const C = 128;
  const c = document.createElement('canvas');
  c.width = C * SIGN_CELLS.length;
  c.height = C;
  const g = c.getContext('2d')!;
  const at = (k: SignCell) => SIGN_CELLS.indexOf(k) * C;
  // R2 STOP: red octagon, white border and letters.
  {
    const x0 = at('stop');
    const poly = (r: number, fill: string) => {
      g.fillStyle = fill;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i * Math.PI) / 4;
        g.lineTo(x0 + C / 2 + Math.cos(a) * r, C / 2 + Math.sin(a) * r);
      }
      g.fill();
    };
    poly(62, '#ffffff');
    poly(56, '#c8102e');
    g.fillStyle = '#ffffff';
    g.font = 'bold 40px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('STOP', x0 + C / 2, C / 2 + 2);
  }
  // R1 give way: inverted triangle, red border, white centre.
  {
    const x0 = at('give_way');
    const tri = (inset: number, fill: string) => {
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(x0 + 4 + inset * 1.7, 8 + inset);
      g.lineTo(x0 + C - 4 - inset * 1.7, 8 + inset);
      g.lineTo(x0 + C / 2, C - 6 - inset * 1.9);
      g.closePath();
      g.fill();
    };
    tri(0, '#c8102e');
    tri(14, '#ffffff');
  }
  // Trail map panel (brown, with a light map).
  {
    const x0 = at('map');
    g.fillStyle = '#5b3a22';
    g.fillRect(x0, 0, C, C);
    g.fillStyle = '#e8e2c8';
    g.fillRect(x0 + 10, 26, C - 20, C - 36);
    g.strokeStyle = '#7a8c4a';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x0 + 18, 100);
    g.bezierCurveTo(x0 + 50, 40, x0 + 80, 120, x0 + 110, 40);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 13px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('SENDEROS', x0 + C / 2, 18);
  }
  // Information board (green).
  {
    const x0 = at('board');
    g.fillStyle = '#1f4d36';
    g.fillRect(x0, 0, C, C);
    g.fillStyle = '#ffffff';
    g.font = 'bold 56px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('i', x0 + C / 2, C / 2);
  }
  // DEA (defibrillator) sign.
  {
    const x0 = at('aed');
    g.fillStyle = '#00843d';
    g.fillRect(x0, 0, C, C);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x0 + 46, 50, 20, 0, Math.PI * 2);
    g.arc(x0 + 82, 50, 20, 0, Math.PI * 2);
    g.moveTo(x0 + 28, 58);
    g.lineTo(x0 + 64, 100);
    g.lineTo(x0 + 100, 58);
    g.fill();
    g.fillStyle = '#00843d';
    g.fillRect(x0 + 60, 38, 8, 40);
    g.fillRect(x0 + 44, 54, 40, 8);
  }
  // S-13 pedestrian crossing: blue square, white triangle, walking figure.
  {
    const x0 = at('S-13');
    g.fillStyle = '#ffffff';
    g.fillRect(x0 + 2, 2, C - 4, C - 4);
    g.fillStyle = '#1d4f9c';
    g.fillRect(x0 + 6, 6, C - 12, C - 12);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(x0 + C / 2, 16);
    g.lineTo(x0 + C - 16, C - 18);
    g.lineTo(x0 + 16, C - 18);
    g.closePath();
    g.fill();
    g.fillStyle = '#111111';
    g.fillRect(x0 + 30, C - 36, 68, 5);
    for (let i = 0; i < 4; i++) g.fillRect(x0 + 34 + i * 16, C - 31, 9, 8);
    g.beginPath();
    g.arc(x0 + 66, 48, 6, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#111111';
    g.beginPath();
    g.moveTo(x0 + 64, 56);
    g.lineTo(x0 + 60, 76);
    g.lineTo(x0 + 52, 90);
    g.moveTo(x0 + 60, 76);
    g.lineTo(x0 + 70, 90);
    g.moveTo(x0 + 52, 66);
    g.lineTo(x0 + 72, 64);
    g.stroke();
  }
  // R-303 no left turn: white disc, red ring and bar over a black left-turn arrow.
  {
    const x0 = at('R-303');
    const cx = x0 + C / 2;
    g.fillStyle = '#c8102e';
    g.beginPath();
    g.arc(cx, C / 2, 60, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(cx, C / 2, 47, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#111111';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(cx + 12, 104);
    g.lineTo(cx + 12, 62);
    g.quadraticCurveTo(cx + 12, 48, cx - 4, 48);
    g.lineTo(cx - 22, 48);
    g.stroke();
    g.fillStyle = '#111111';
    g.beginPath();
    g.moveTo(cx - 34, 48);
    g.lineTo(cx - 18, 34);
    g.lineTo(cx - 18, 62);
    g.closePath();
    g.fill();
    g.strokeStyle = '#c8102e';
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(cx - 33, C / 2 - 33);
    g.lineTo(cx + 33, C / 2 + 33);
    g.stroke();
  }
  // P-15a speed bump: red-bordered triangle with the bump profile.
  {
    const x0 = at('P-15a');
    const tri = (inset: number, fill: string) => {
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(x0 + C / 2, 6 + inset * 1.9);
      g.lineTo(x0 + C - 4 - inset * 1.7, C - 10 - inset);
      g.lineTo(x0 + 4 + inset * 1.7, C - 10 - inset);
      g.closePath();
      g.fill();
    };
    tri(0, '#c8102e');
    tri(13, '#ffffff');
    g.fillStyle = '#111111';
    g.fillRect(x0 + 34, 92, 60, 6);
    g.beginPath();
    g.ellipse(x0 + C / 2, 92, 16, 12, 0, Math.PI, 0);
    g.fill();
  }
  // R-101 no entry: red disc with a white bar.
  {
    const x0 = at('R-101');
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x0 + C / 2, C / 2, 62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c8102e';
    g.beginPath();
    g.arc(x0 + C / 2, C / 2, 58, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillRect(x0 + 22, C / 2 - 11, C - 44, 22);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Lit-by-the-sun panel with lines of text (direction signs, milestones, kiosk names). */
function textPanel(w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void): THREE.Material {
  const c = document.createElement('canvas');
  c.width = Math.round(w * 128);
  c.height = Math.round(h * 128);
  draw(c.getContext('2d')!, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 });
}

/** One white direction plate ("BILBAO >", "< BURGOS", "^" ahead; "*" prefix: brown tourist plate). */
function directionPlate(line: string): THREE.Material {
  const tourist = line.startsWith('*');
  const text = tourist ? line.slice(1) : line;
  return textPanel(2.2, 0.36, (g, W, H) => {
    g.fillStyle = tourist ? '#7a4a24' : '#ffffff';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = tourist ? '#ffffff' : '#222222';
    g.lineWidth = 5;
    g.strokeRect(5, 5, W - 10, H - 10);
    g.fillStyle = tourist ? '#ffffff' : '#111111';
    g.font = `bold ${Math.round(H * 0.6)}px Arial, Helvetica, sans-serif`;
    g.textBaseline = 'middle';
    const arrow = text.match(/[<>^]/)?.[0];
    const label = text.replace(/[<>^]/g, '').trim();
    g.textAlign = arrow === '<' ? 'right' : 'left';
    g.fillText(label, arrow === '<' ? W - 24 : 24, H / 2 + 2);
    if (arrow) {
      const ax = arrow === '<' ? 40 : W - 48;
      g.beginPath();
      if (arrow === '^') {
        g.moveTo(ax, 10);
        g.lineTo(ax + 18, 30);
        g.lineTo(ax - 18, 30);
        g.closePath();
        g.fill();
        g.fillRect(ax - 5, 28, 10, H - 38);
      } else {
        const d = arrow === '<' ? -1 : 1;
        g.moveTo(ax + d * 22, H / 2);
        g.lineTo(ax, H / 2 - 16);
        g.lineTo(ax, H / 2 + 16);
        g.closePath();
        g.fill();
        g.fillRect(Math.min(ax, ax - d * 26), H / 2 - 5, 26, 10);
      }
    }
  });
}

/** Unit quad facing +Z showing one atlas cell. */
function signQuad(cell: SignCell): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const i = SIGN_CELLS.indexOf(cell);
  for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / SIGN_CELLS.length);
  return g;
}

/** Colours of the Spanish recycling containers by stream. */
const STREAM_COLOUR: Record<string, string> = {
  glass: '#2e7d32',
  paper: '#1e5bb8',
  plastic: '#f2c200',
  organic: '#7a4b2a',
  clothes: '#9e9e9e',
  batteries: '#c62828',
  other: '#4f6f52',
};

/**
 * Street furniture where OSM maps it: STOP and give-way signs on the kerb
 * facing the traffic, recycling containers by stream, litter bins, waste
 * containers, planters, drinking fountains, fire hydrants, information
 * panels, CCTV cameras, street cabinets, post boxes, defibrillators, EV
 * chargers, static billboards, and the overhead power lines on their poles.
 * (The Ayuntamiento's digital screen is built by Screens.ts.)
 */
export function buildStreetFurniture(ctx: BuildContext): void {
  const { mats, terrain, collision } = ctx;
  const signMat = new THREE.MeshStandardMaterial({ map: signAtlas(), alphaTest: 0.5, roughness: 0.5, side: THREE.DoubleSide });
  signMat.name = 'trafficSigns';
  signMat.userData.castShadow = false;
  const quads = Object.fromEntries(SIGN_CELLS.map((c) => [c, signQuad(c)])) as Record<SignCell, THREE.BufferGeometry>;
  const grey = mats.tint('#8d9296');
  const darkGrey = mats.tint('#4a4f53');
  const B = Unit.box;

  const at = (f: MapFurniture) => new LocalBatch(ctx.batch, f.x, terrain.heightAt(f.x, f.z), f.z, f.a);
  const post = (lb: LocalBatch, h: number, r = 0.035, m: THREE.Material = grey) => lb.add(Unit.cyl, m, 0, h / 2, 0, 0, r * 2, h, r * 2);

  // Traffic signs: a post and a plate that a car can knock down (Breakables).
  const mtx = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
  const signPost = (f: MapFurniture, cell: SignCell, size: number) => {
    const h = size > 0.65 ? 2.6 : 2.5;
    ctx.breakables.add(f.x, terrain.heightAt(f.x, f.z), f.z, f.a, 0.1, [
      { key: 'sign-post', geo: Unit.cyl, mat: grey, local: mtx(0, h / 2, 0, 0.07, h, 0.07) },
      { key: `sign-${cell}`, geo: quads[cell], mat: signMat, local: mtx(0, h - 0.35, 0.05, size, size, 1) },
      { key: 'sign-back', geo: B, mat: grey, local: mtx(0, h - 0.35, 0.03, size * 0.85, size * 0.85, 0.02) },
    ]);
    collision.addCircle(f.x, f.z, 0.08, { top: h, mask: Layer.Player });
  };

  // Light street furniture a car knocks over (Breakables): parts as [key, geometry, material, x, y, z, sx, sy, sz].
  type Part = [string, THREE.BufferGeometry, THREE.Material, number, number, number, number, number, number];
  const breakable = (f: MapFurniture, r: number, parts: Part[]) =>
    ctx.breakables.add(
      f.x,
      terrain.heightAt(f.x, f.z),
      f.z,
      f.a,
      r,
      parts.map(([key, geo, mat, x, y, z, sx, sy, sz]) => ({ key, geo, mat, local: mtx(x, y, z, sx, sy, sz) })),
    );

  for (const f of ctx.map.furniture ?? []) {
    const lb = at(f);
    switch (f.k) {
      case 'stop':
      case 'give_way':
        signPost(f, f.k, f.k === 'stop' ? 0.6 : 0.7);
        break;
      case 'recycling': {
        const streams = (f.t ?? 'other').split(',');
        streams.forEach((s, i) => {
          const x = (i - (streams.length - 1) / 2) * 1.9;
          const m = mats.tint(STREAM_COLOUR[s] ?? STREAM_COLOUR.other);
          if (s === 'glass') {
            // Igloo for glass.
            lb.add(Unit.cyl16, m, x, 0.7, 0, 0, 1.5, 1.4, 1.5);
            lb.add(Unit.sphere, m, x, 1.4, 0, 0, 1.5, 0.5, 1.5);
          } else {
            lb.add(B, m, x, 0.75, 0, 0, 1.7, 1.5, 1.4);
            lb.add(B, m, x, 1.6, 0, 0, 1.75, 0.2, 1.45, 0.08);
          }
          lb.add(B, darkGrey, x, 1.15, 0.72, 0, 0.6, 0.12, 0.04);
          const [wx, wz] = lb.point(x, 0);
          collision.addBox(wx, wz, 1.7, 1.4, { rot: f.a, top: 1.7, mask: Layer.Solid });
        });
        break;
      }
      case 'container': {
        const m = mats.tint('#3d5a40');
        lb.add(B, m, 0, 0.7, 0, 0, 1.8, 1.3, 1.1);
        lb.add(B, mats.tint('#2f4632'), 0, 1.42, -0.05, 0, 1.85, 0.12, 1.2, 0.12);
        for (const x of [-0.7, 0.7]) lb.add(Unit.cyl, darkGrey, x, 0.08, 0.4, 0, 0.16, 0.16, 0.16, 0, Math.PI / 2);
        collision.addBox(f.x, f.z, 1.8, 1.1, { rot: f.a, top: 1.5, mask: Layer.Solid });
        break;
      }
      case 'bin':
        post(lb, 0.9, 0.03, darkGrey);
        lb.add(Unit.cyl, mats.tint('#4e6b55'), 0, 0.75, 0.2, 0, 0.42, 0.55, 0.42);
        break;
      case 'planter':
        lb.add(B, mats.stone, 0, 0.3, 0, 0, 1.3, 0.6, 1.3);
        lb.add(B, mats.hedge, 0, 0.7, 0, 0, 1.1, 0.35, 1.1);
        lb.add(Unit.blob, mats.flowers, 0, 0.92, 0, 0, 0.45, 0.25, 0.45);
        collision.addBox(f.x, f.z, 1.3, 1.3, { rot: f.a, top: 0.6, mask: Layer.Bodies });
        break;
      case 'cypress': {
        // Round stone planter with a tall clipped cypress (the middle of the Plaza de España).
        lb.add(Unit.cyl16, mats.stone, 0, 0.3, 0, 0, 2.6, 0.6, 2.6);
        lb.add(Unit.cyl16, mats.tint('#4a3a2a'), 0, 0.58, 0, 0, 2.3, 0.06, 2.3);
        lb.add(Unit.cyl, mats.tint('#4a3426'), 0, 1.0, 0, 0, 0.18, 1.0, 0.18);
        lb.add(new THREE.ConeGeometry(0.75, 5.5, 10), mats.tint('#2c4a2a'), 0, 3.6, 0);
        lb.add(Unit.sphere, mats.tint('#2c4a2a'), 0, 1.15, 0, 0, 1.45, 0.9, 1.45);
        collision.addCircle(f.x, f.z, 1.3, { top: 0.6, mask: Layer.Solid });
        break;
      }
      case 'entrance': {
        // Raised entrance (the Juzgados, photos with P): landing of height H against the wall
        // (local +z out of the facade), steps down to the square in front, a ramp alongside
        // it with a small metal railing, and a railing round the open edges of the landing.
        // t = "H" or "H,side": side -1 puts the ramp on the other hand of the steps.
        const [hs, ss] = (f.t ?? '1').split(',');
        const H = Number.parseFloat(hs) || 1;
        const sd = ss === '-1' ? -1 : 1;
        const stone = mats.tint('#cfc6b4');
        const rail = mats.tint('#3c4044');
        const solid = (x: number, z: number, w: number, d: number, top: number) => {
          const [wx, wz] = lb.point(sd * x, z);
          collision.addBox(wx, wz, w, d, { rot: f.a, top, mask: Layer.Solid });
        };
        // Landing: u in [-2.5, 3.5], n in [0, 2.6].
        lb.add(B, stone, sd * 0.5, H / 2, 1.3, 0, 6, H, 2.6);
        solid(0.5, 1.3, 6, 2.6, H);
        // Steps down in front of the door, u in [-2.5, 1.5].
        const n = Math.max(2, Math.round(H / 0.18));
        const rise = H / n,
          tread = 0.32;
        for (let k = 0; k < n - 1; k++) {
          const top = H - rise * (k + 1);
          const z = 2.6 + tread * (k + 0.5);
          lb.add(B, stone, sd * -0.5, top / 2, z, 0, 4, top, tread);
          solid(-0.5, z, 4, tread, top);
        }
        // Ramp beside it, along the facade, from the landing (u 3.5) down to u 9.5.
        const rl = 6,
          slope = Math.atan2(H, rl);
        lb.add(B, stone, sd * (3.5 + rl / 2), H / 2 - 0.05, 2.0, 0, Math.hypot(rl, H), 0.12, 1.2, 0, -sd * slope);
        for (let k = 0; k < 6; k++) {
          const x = 3.5 + (rl * (k + 0.5)) / 6;
          const top = H * (1 - (k + 0.5) / 6);
          lb.add(B, stone, sd * x, top / 2 - 0.05, 2.0, 0, rl / 6, top, 1.1);
          solid(x, 2.0, rl / 6, 1.2, top);
        }
        // Railings: along the ramp's outer edge, and the landing's edge beside the steps.
        const railRun = (ax: number, y0: number, bx: number, y1: number, z: number) => {
          const x0 = sd * ax,
            x1 = sd * bx;
          const len = Math.hypot(x1 - x0, y1 - y0),
            tilt = Math.atan2(y1 - y0, x1 - x0);
          lb.add(B, rail, (x0 + x1) / 2, (y0 + y1) / 2 + 0.95, z, 0, len, 0.05, 0.05, 0, tilt);
          const posts = Math.max(1, Math.round(len / 1.2));
          for (let k = 0; k <= posts; k++) {
            const t = k / posts;
            lb.add(B, rail, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + 0.475, z, 0, 0.05, 0.95, 0.05);
          }
          const [wx, wz] = lb.point((x0 + x1) / 2, z);
          collision.addBox(wx, wz, len, 0.1, { rot: f.a, top: Math.max(y0, y1) + 1, mask: Layer.Player });
        };
        railRun(3.5, H, 3.5 + rl, 0, 2.6);
        railRun(1.5, H, 3.5, H, 2.6);
        // Edge of the landing on the far side of the steps.
        lb.add(B, rail, sd * -2.5, H + 0.95, 1.3, 0, 0.05, 0.05, 2.6);
        for (const z of [0.2, 1.3, 2.5]) lb.add(B, rail, sd * -2.5, H + 0.475, z, 0, 0.05, 0.95, 0.05);
        break;
      }
      case 'woodterrace': {
        // Rustic bar terrace (Casa Arcadio, photos with P): a timber deck against the bar's
        // glazed front (local -z), a glass screen round its open sides with a gap to get in,
        // and big wooden tables with benches. t = "WxD".
        const [tw, td] = (f.t ?? '8x4.4').split('x').map(Number);
        const timber = mats.tint('#8a6440');
        const dark = mats.tint('#5e4129');
        const deck = 0.25;
        lb.add(B, timber, 0, deck / 2, 0, 0, tw, deck, td);
        for (let x = -tw / 2 + 0.15; x < tw / 2; x += 0.3) lb.add(B, dark, x, deck + 0.005, 0, 0, 0.02, 0.01, td);
        collision.addBox(f.x, f.z, tw, td, { rot: f.a, top: deck, mask: Layer.Solid });
        const glass = mats.galeria;
        const frameM = mats.tint('#3a2a1c');
        const screen = (x: number, z: number, w: number, d: number) => {
          lb.add(B, glass, x, deck + 0.75, z, 0, w, 1.3, d);
          lb.add(B, frameM, x, deck + 1.42, z, 0, w + 0.04, 0.06, d + 0.04);
          const [wx, wz] = lb.point(x, z);
          collision.addBox(wx, wz, Math.max(w, 0.1), Math.max(d, 0.1), { rot: f.a, top: deck + 1.4, mask: Layer.Player });
        };
        // Front screen in two halves with a 1.4 m opening, and both ends.
        const half = (tw - 1.4) / 2;
        screen(-tw / 2 + half / 2, td / 2, half, 0.05);
        screen(tw / 2 - half / 2, td / 2, half, 0.05);
        for (const sx of [-1, 1]) screen((sx * tw) / 2, 0, 0.05, td);
        // Tables with a bench on each side, across the deck.
        const n = Math.max(1, Math.floor((tw - 0.6) / 2.6));
        for (let i = 0; i < n; i++) {
          const x = -tw / 2 + 0.3 + (tw - 0.6) * ((i + 0.5) / n);
          lb.add(B, timber, x, deck + 0.75, -0.2, 0, 0.9, 0.08, 2.0);
          for (const lz of [-0.95, 0.55]) lb.add(B, dark, x, deck + 0.37, lz, 0, 0.8, 0.74, 0.1);
          for (const bx of [-0.75, 0.75]) {
            lb.add(B, timber, x + bx, deck + 0.45, -0.2, 0, 0.3, 0.06, 2.0);
            lb.add(B, dark, x + bx, deck + 0.22, -0.2, 0, 0.25, 0.44, 0.1);
          }
          const [wx, wz] = lb.point(x, -0.2);
          collision.addBox(wx, wz, 2.0, 2.0, { rot: f.a, top: deck + 0.8, mask: Layer.Bodies });
        }
        break;
      }
      case 'fountain':
        lb.add(Unit.cyl, mats.stone, 0, 0.45, 0, 0, 0.35, 0.9, 0.35);
        lb.add(B, mats.ironGreen, 0, 0.95, 0.12, 0, 0.06, 0.06, 0.25);
        lb.add(Unit.cyl, mats.stone, 0, 0.12, 0.35, 0, 0.5, 0.24, 0.5);
        break;
      case 'hydrant':
        lb.add(Unit.cyl, mats.redPaint, 0, 0.35, 0, 0, 0.22, 0.7, 0.22);
        lb.add(Unit.sphere, mats.redPaint, 0, 0.72, 0, 0, 0.24, 0.2, 0.24);
        lb.add(Unit.cyl, mats.tint('#d8c21a'), 0, 0.45, 0, 0, 0.32, 0.06, 0.32, 0, Math.PI / 2);
        break;
      case 'info': {
        // Information panel on two wooden legs: a car knocks it over.
        const cell: SignCell = f.t === 'map' ? 'map' : 'board';
        const ph = f.t === 'guidepost' ? 0.4 : 0.9;
        breakable(f, 0.7, [
          ['info-leg', B, mats.wood, -0.6, 0.8, 0, 0.1, 1.6, 0.1],
          ['info-leg', B, mats.wood, 0.6, 0.8, 0, 0.1, 1.6, 0.1],
          [`info-${cell}-${ph}`, quads[cell], signMat, 0, 1.25, 0.06, 1.2, ph, 1],
          [`info-back-${ph}`, B, mats.wood, 0, 1.25, 0.02, 1.3, ph + 0.05, 0.06],
        ]);
        collision.addBox(f.x, f.z, 1.3, 0.15, { rot: f.a, top: 1.8, mask: Layer.Player });
        break;
      }
      case 'camera':
        post(lb, 4.5, 0.06);
        lb.add(B, mats.white, 0, 4.4, 0.25, 0, 0.18, 0.15, 0.4);
        lb.add(B, darkGrey, 0, 4.4, 0.47, 0, 0.12, 0.1, 0.04);
        break;
      case 'cabinet':
        lb.add(B, mats.tint('#b5b9ad'), 0, 0.65, 0, 0, 0.9, 1.3, 0.4);
        break;
      case 'postbox':
        post(lb, 0.7, 0.05, mats.tint('#f2c200'));
        lb.add(B, mats.tint('#f2c200'), 0, 1.0, 0, 0, 0.5, 0.55, 0.38);
        lb.add(B, mats.tint('#0b2d63'), 0, 1.12, 0.2, 0, 0.3, 0.08, 0.02);
        break;
      case 'aed':
        breakable(f, 0.25, [
          ['aed-post', Unit.cyl, grey, 0, 0.95, 0, 0.08, 1.9, 0.08],
          ['aed-box', B, mats.tint('#00843d'), 0, 1.2, 0.08, 0.45, 0.6, 0.18],
          ['aed-sign', quads.aed, signMat, 0, 1.85, 0.06, 0.4, 0.4, 1],
        ]);
        collision.addCircle(f.x, f.z, 0.2, { top: 1.9, mask: Layer.Player });
        break;
      case 'charger':
        lb.add(B, mats.white, 0, 0.75, 0, 0, 0.45, 1.5, 0.3);
        lb.add(B, mats.glow('#3ad06a'), 0, 1.3, 0.16, 0, 0.3, 0.06, 0.02);
        break;
      case 'sign':
        // Single plate on a post (S-13 crossings, R-303, P-15a...).
        signPost(f, (SIGN_CELLS as readonly string[]).includes(f.t ?? '') ? (f.t as SignCell) : 'S-13', 0.6);
        break;
      case 'direction': {
        // Stacked direction plates on two posts.
        const lines = (f.t ?? '').split('|').filter(Boolean);
        const top = 1.0 + lines.length * 0.42;
        breakable(f, 1.0, [
          ...[-0.9, 0.9].map((x): Part => [`dir-post-${top}`, Unit.cyl, grey, x, (top + 0.1) / 2, 0, 0.08, top + 0.1, 0.08]),
          ...lines.map((line, i): Part => [`dir-${line}`, Unit.box, directionPlate(line), 0, top - 0.2 - i * 0.42, 0.06, 2.2, 0.36, 0.03]),
        ]);
        collision.addBox(f.x, f.z, 2.0, 0.2, { rot: f.a, top, mask: Layer.Player });
        break;
      }
      case 'milestone': {
        // Kilometre post: green plate with the road and the kilometre (BU-561 km 0).
        const [ref, km] = (f.t ?? '|').split('|');
        const plate = textPanel(0.5, 0.7, (g, W, H) => {
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, W, H);
          g.fillStyle = ref.startsWith('CL') ? '#2f6f3a' : '#1f7a45';
          g.fillRect(5, 5, W - 10, H - 10);
          g.fillStyle = '#ffffff';
          g.textAlign = 'center';
          g.font = 'bold 15px Arial, sans-serif';
          g.fillText(ref, W / 2, 28);
          g.fillRect(10, 36, W - 20, 2);
          g.font = 'bold 13px Arial, sans-serif';
          g.fillText('km', W / 2, 56);
          g.font = 'bold 22px Arial, sans-serif';
          g.fillText(km, W / 2, 80);
        });
        post(lb, 1.2, 0.03);
        lb.add(Unit.box, plate, 0, 0.95, 0.04, 0, 0.5, 0.7, 0.03);
        break;
      }
      case 'kiosk': {
        // Press kiosk (granite base, cream walls, flat roof with an awning) or the ONCE booth.
        const once = /ONCE/i.test(f.t ?? '');
        const wall = mats.tint(once ? '#f4f4f0' : '#e7dfcc');
        const w = once ? 1.8 : 2.8,
          d = once ? 1.5 : 2.0;
        lb.add(B, once ? mats.tint('#9aa0a3') : mats.stone, 0, 0.35, 0, 0, w, 0.7, d);
        lb.add(B, wall, 0, 1.45, 0, 0, w - 0.06, 1.5, d - 0.06);
        lb.add(B, mats.tint(once ? '#00843d' : '#7b6a55'), 0, 2.3, 0, 0, w + 0.5, 0.18, d + 0.5);
        if (!once) {
          // Magazines on the front and the side, under an awning.
          lb.add(B, mats.awnings[0], 0, 2.05, d / 2 + 0.35, 0, w + 0.2, 0.06, 0.7, 0.35);
          lb.add(B, mats.tint('#c7543b'), -w / 4, 1.5, d / 2 + 0.01, 0, w / 2 - 0.2, 1.0, 0.02);
          lb.add(B, mats.tint('#3b6db0'), w / 4, 1.5, d / 2 + 0.01, 0, w / 2 - 0.2, 1.0, 0.02);
        } else lb.add(B, mats.glass, 0, 1.45, d / 2, 0, 1.0, 0.7, 0.03);
        const name = textPanel(w, 0.3, (g, W, H) => {
          g.fillStyle = once ? '#00843d' : '#1c2a44';
          g.fillRect(0, 0, W, H);
          g.fillStyle = '#ffffff';
          g.font = `bold ${Math.round(H * 0.6)}px Arial, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText((f.t ?? 'PRENSA').toUpperCase(), W / 2, H / 2 + 2);
        });
        lb.add(B, name, 0, 2.55, d / 2 - 0.1, 0, w, 0.3, 0.04);
        collision.addBox(f.x, f.z, w, d, { rot: f.a, top: 2.4, mask: Layer.Solid });
        break;
      }
      case 'flagpole': {
        const y = terrain.heightAt(f.x, f.z);
        lb.add(Unit.cyl, mats.stone, 0, 0.25, 0, 0, 0.7, 0.5, 0.7);
        // "ES" (the plaza's national flag, high and large) or "EU:small" (the row in front of the Ayuntamiento).
        const [code, size] = (f.t ?? 'ES').split(':');
        const kind = code === 'EU' ? 'eu' : code === 'CYL' ? 'cyl' : 'es';
        const [poleH, cloth] = size === 'small' ? [7.5, 1.1] : size === 'mid' ? [9, 1.35] : [11.5, 2.2];
        flag(ctx, kind, f.x, y + 0.5, f.z, poleH, f.a, 0, cloth);
        collision.addCircle(f.x, f.z, 0.35, { top: 12, mask: Layer.Solid });
        break;
      }
      case 'statue': {
        // Bronze walking figure in a long coat, head bowed (as "Pasos" in the Plaza Mayor), on a low base.
        const br = mats.bronze;
        lb.add(B, mats.stone, 0, 0.1, 0, 0, 0.9, 0.2, 0.9);
        lb.add(Unit.cyl, br, -0.12, 0.55, 0.12, 0, 0.16, 0.75, 0.16, 0.18);
        lb.add(Unit.cyl, br, 0.12, 0.55, -0.1, 0, 0.16, 0.75, 0.16, -0.2);
        lb.add(new THREE.CylinderGeometry(0.2, 0.36, 1.05, 10), br, 0, 1.25, 0.02, 0, 1, 1, 1, 0.08);
        lb.add(Unit.sphere, br, 0, 1.92, 0.12, 0, 0.24, 0.27, 0.24);
        lb.add(Unit.cyl, br, 0.27, 1.35, 0.05, 0, 0.1, 0.62, 0.1, 0.12);
        lb.add(Unit.cyl, br, -0.27, 1.35, 0.05, 0, 0.1, 0.62, 0.1, 0.12);
        collision.addCircle(f.x, f.z, 0.45, { top: 2, mask: Layer.Solid });
        break;
      }
      case 'lamp4': {
        // Cast-iron lamp post with four lanterns and the loudspeakers of the Ayuntamiento.
        const iron = mats.iron;
        lb.add(Unit.cyl, iron, 0, 0.4, 0, 0, 0.36, 0.8, 0.36);
        lb.add(Unit.cyl, iron, 0, 2.6, 0, 0, 0.16, 4.4, 0.16);
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2 + Math.PI / 4;
          const lx = Math.sin(a) * 0.45,
            lz = Math.cos(a) * 0.45;
          lb.add(Unit.box, iron, lx / 2, 4.55, lz / 2, a, 0.06, 0.06, 0.5);
          lb.add(Unit.cyl, mats.lampGlass, lx, 4.8, lz, 0, 0.26, 0.42, 0.26);
          lb.add(Unit.cone, iron, lx, 5.1, lz, 0, 0.34, 0.2, 0.34);
        }
        for (const a of [0.6, -0.9])
          lb.add(Unit.cone, mats.tint('#c9ccc4'), Math.sin(a) * 0.25, 3.9, Math.cos(a) * 0.25, a, 0.3, 0.5, 0.3, Math.PI / 2);
        collision.addCircle(f.x, f.z, 0.2, { top: 5, mask: Layer.Solid });
        break;
      }
      case 'treebox':
        // Stone planter box with a low iron railing round the tree (Plaza Mayor, Ayuntamiento).
        lb.add(B, mats.stone, 0, 0.3, 0, 0, 2.0, 0.6, 2.0);
        lb.add(B, mats.dirt, 0, 0.61, 0, 0, 1.7, 0.02, 1.7);
        for (const [x, z, w, d] of [
          [0, 0.85, 1.8, 0.04],
          [0, -0.85, 1.8, 0.04],
          [0.85, 0, 0.04, 1.8],
          [-0.85, 0, 0.04, 1.8],
        ])
          lb.add(B, mats.iron, x, 0.95, z, 0, w, 0.04, d);
        collision.addBox(f.x, f.z, 2.0, 2.0, { rot: f.a, top: 0.6, mask: Layer.Bodies });
        break;
      case 'taxi': {
        // Villarcayo's taxi waiting at its rank: white saloon, roof sign, green light.
        const white = mats.tint('#f2f2ee'),
          glass = mats.glass,
          tyre = mats.tint('#1b1b1b');
        lb.add(B, white, 0, 0.62, 0, 0, 1.78, 0.55, 4.5);
        lb.add(B, white, 0, 1.12, -0.2, 0, 1.66, 0.48, 2.3);
        lb.add(B, glass, 0, 1.12, -0.2, 0, 1.7, 0.38, 2.36);
        for (const sz of [-1, 1]) lb.add(B, tyre, 0, 0.32, sz * 1.5, 0, 1.76, 0.62, 0.62);
        lb.add(B, mats.tint('#1f6f3a'), 0, 0.72, 0, 0, 1.8, 0.08, 4.3);
        lb.add(B, mats.glow('#f4f4f4'), 0, 1.46, -0.1, 0, 0.7, 0.18, 0.2);
        lb.add(B, mats.glow('#2fd16a'), 0.32, 1.48, 0.02, 0, 0.12, 0.1, 0.06);
        lb.add(B, mats.glow('#ffe9c0'), 0, 0.72, 2.255, 0, 1.4, 0.1, 0.02);
        collision.addBox(f.x, f.z, 1.8, 4.5, { rot: f.a, top: 1.5, mask: Layer.Solid });
        break;
      }
      case 'terrace': {
        // Covered bar terrace: a light flat roof on slim posts, glass screens on the sides.
        const [tw, td] = (f.t ?? '8x6').split('x').map(Number);
        const post = mats.tint('#3a3d40');
        lb.add(B, mats.tint('#ecebe6'), 0, 2.75, 0, 0, tw, 0.18, td);
        for (const [px, pz] of [
          [-tw / 2 + 0.2, -td / 2 + 0.2],
          [tw / 2 - 0.2, -td / 2 + 0.2],
          [-tw / 2 + 0.2, td / 2 - 0.2],
          [tw / 2 - 0.2, td / 2 - 0.2],
        ])
          lb.add(B, post, px, 1.35, pz, 0, 0.1, 2.7, 0.1);
        const pane = mats.tint('#9fb0ba');
        lb.add(B, pane, 0, 0.6, -td / 2 + 0.2, 0, tw - 0.4, 1.2, 0.04);
        lb.add(B, pane, -tw / 2 + 0.2, 0.6, 0, 0, 0.04, 1.2, td - 0.4);
        for (let i = 0; i < 4; i++) {
          const x = -tw / 2 + 1.6 + i * ((tw - 3.2) / 3);
          lb.add(Unit.cyl, mats.tint('#cfcfcf'), x, 0.72, 0, 0, 0.7, 0.04, 0.7);
          lb.add(Unit.cyl, post, x, 0.36, 0, 0, 0.06, 0.72, 0.06);
        }
        collision.addBox(f.x, f.z, tw, 0.2, { rot: f.a, top: 1.2, mask: Layer.Player });
        break;
      }
      case 'stonebench': {
        // Long low block of light stone (the benches round the Ayuntamiento's square).
        const L = Number.parseFloat(f.t ?? '3') || 3;
        lb.add(B, mats.tint('#e3dccb'), 0, 0.23, 0, 0, L, 0.46, 0.62);
        lb.add(B, mats.tint('#eee8da'), 0, 0.48, 0, 0, L + 0.06, 0.06, 0.7);
        collision.addBox(f.x, f.z, L, 0.62, { rot: f.a, top: 0.5, mask: Layer.Bodies });
        break;
      }
      case 'shrub':
        // Round clipped shrub in a stone planter.
        lb.add(B, mats.stone, 0, 0.25, 0, 0, 1.0, 0.5, 1.0);
        lb.add(Unit.sphere, mats.hedge, 0, 1.05, 0, 0, 1.5, 1.2, 1.5);
        collision.addCircle(f.x, f.z, 0.6, { top: 1.6, mask: Layer.Bodies });
        break;
      case 'billboard':
        break; // Screens.ts (posters and the digital screen)
      case 'pole':
        lb.add(Unit.cyl, mats.concrete, 0, 4.5, 0, 0, 0.26, 9, 0.26);
        lb.add(B, mats.concrete, 0, 8.6, 0, 0, 1.6, 0.12, 0.12);
        collision.addCircle(f.x, f.z, 0.15, { top: 9, mask: Layer.Solid });
        break;
      case 'tower':
        for (const [x, z] of [
          [-0.9, -0.9],
          [0.9, -0.9],
          [-0.9, 0.9],
          [0.9, 0.9],
        ])
          lb.addMatrix(Unit.box, mats.iron, beamMatrix(x, 0, z, x * 0.3, 16, z * 0.3, 0.12));
        lb.add(B, mats.iron, 0, 14.5, 0, 0, 5, 0.25, 0.25);
        collision.addBox(f.x, f.z, 2, 2, { rot: f.a, top: 16, mask: Layer.Solid });
        break;
      default:
    }
  }

  // Overhead lines between consecutive poles: three wires with a little sag.
  const wire = mats.tint('#2a2a2a');
  for (const line of ctx.map.powerlines ?? []) {
    const pts = toPts(line.p);
    const h = line.k === 'line' ? 14.5 : 8.6;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1],
        [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1 || len > 400) continue;
      const nx = -(bz - az) / len,
        nz = (bx - ax) / len;
      const ya = terrain.heightAt(ax, az) + h,
        yb = terrain.heightAt(bx, bz) + h;
      const sag = Math.min(1.5, len * 0.012);
      for (const o of [-0.7, 0, 0.7]) {
        const mx = (ax + bx) / 2 + nx * o,
          mz = (az + bz) / 2 + nz * o;
        const my = (ya + yb) / 2 - sag;
        ctx.batch.addMatrix(Unit.box, wire, beamMatrix(ax + nx * o, ya, az + nz * o, mx, my, mz, 0.03));
        ctx.batch.addMatrix(Unit.box, wire, beamMatrix(mx, my, mz, bx + nx * o, yb, bz + nz * o, 0.03));
      }
    }
  }
}
