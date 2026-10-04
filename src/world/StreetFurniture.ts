import * as THREE from 'three';
import { Layer } from '../physics/PhysicsWorld';
import { LocalBatch } from './Batcher';
import type { BuildContext } from './context';
import { toPts } from './geo';
import { beamMatrix } from './geometry';
import type { MapFurniture } from './mapData';
import { Unit } from './props';

/** Sign faces in one atlas (alpha-tested): STOP octagon, give-way triangle, trail map, Correos, DEA. */
const SIGN_CELLS = ['stop', 'give_way', 'map', 'board', 'aed'] as const;
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
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

  for (const f of ctx.map.furniture ?? []) {
    const lb = at(f);
    switch (f.k) {
      case 'stop':
      case 'give_way': {
        post(lb, 2.6);
        const size = f.k === 'stop' ? 0.6 : 0.7;
        lb.add(quads[f.k], signMat, 0, 2.25, 0.05, 0, size, size, 1);
        // Plain grey back of the plate.
        lb.add(B, grey, 0, 2.25, 0.03, 0, size * 0.85, size * 0.85, 0.02);
        collision.addCircle(f.x, f.z, 0.08, { top: 2.6, mask: Layer.Bodies });
        break;
      }
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
        const cell: SignCell = f.t === 'map' ? 'map' : 'board';
        for (const x of [-0.6, 0.6]) lb.add(B, mats.wood, x, 0.8, 0, 0, 0.1, 1.6, 0.1);
        lb.add(quads[cell], signMat, 0, 1.25, 0.06, 0, 1.2, f.t === 'guidepost' ? 0.4 : 0.9, 1);
        lb.add(B, mats.wood, 0, 1.25, 0.02, 0, 1.3, f.t === 'guidepost' ? 0.45 : 1.0, 0.06);
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
        post(lb, 1.9, 0.04);
        lb.add(B, mats.tint('#00843d'), 0, 1.2, 0.08, 0, 0.45, 0.6, 0.18);
        lb.add(quads.aed, signMat, 0, 1.85, 0.06, 0, 0.4, 0.4, 1);
        break;
      case 'charger':
        lb.add(B, mats.white, 0, 0.75, 0, 0, 0.45, 1.5, 0.3);
        lb.add(B, mats.glow('#3ad06a'), 0, 1.3, 0.16, 0, 0.3, 0.06, 0.02);
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
