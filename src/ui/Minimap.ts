import type { Vehicle } from '../entities/Vehicle';
import { type Bounds2, SpatialGrid, ringBounds, toPts } from '../world/geo';
import { MAP } from '../world/mapData';

type Item =
  | { kind: 'fill'; pts: number[]; color: string; layer: number }
  | { kind: 'line'; pts: number[]; color: string; width: number; layer: number };

const AREA_FILL: Record<string, string> = {
  forest: '#3f5f2c',
  park: '#4f7a34',
  garden: '#4f7a34',
  pitch: '#3f7a35',
  water: '#4cc0c4',
  pool: '#5ec8e0',
  pedestrian: '#b9b2a2',
  parking: '#55565a',
  cemetery: '#5c6e4a',
  farmland: '#8a7f4c',
  meadow: '#5e7a3c',
};
const ROAD_COLOR: Record<string, string> = {
  primary: '#d9d4c8',
  secondary: '#d9d4c8',
  tertiary: '#cfcabe',
  residential: '#b9b5ab',
  living_street: '#b9b5ab',
  unclassified: '#b9b5ab',
  service: '#9d9a92',
  pedestrian: '#c9c1ae',
  footway: '#8f8a7c',
  path: '#857456',
  track: '#857456',
  cycleway: '#8f8a7c',
  viaverde: '#a08a64',
  steps: '#8f8a7c',
};

/** GTA-style rotating radar drawn from the OSM vector data around the player. */
export class Minimap {
  private readonly g: CanvasRenderingContext2D;
  private readonly grid = new SpatialGrid<Item>(96);
  private readonly found: Item[] = [];
  private readonly blips: { x: number; z: number; label: string; color: string }[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly viewRadius = 90,
  ) {
    this.g = canvas.getContext('2d')!;
    const add = (it: Item, b: Bounds2) => this.grid.insert(it, b);
    const bboxOf = (pts: number[], pad = 0): Bounds2 => {
      const b = ringBounds(toPts(pts));
      return { minX: b.minX - pad, minZ: b.minZ - pad, maxX: b.maxX + pad, maxZ: b.maxZ + pad };
    };
    for (const a of MAP.areas) {
      const color = AREA_FILL[a.k];
      if (color) add({ kind: 'fill', pts: a.o, color, layer: a.k === 'water' ? 2 : 0 }, bboxOf(a.o));
    }
    for (const r of MAP.rivers) add({ kind: 'line', pts: r.p, color: '#3d84b8', width: r.w, layer: 1 }, bboxOf(r.p, r.w));
    for (const s of MAP.streams) add({ kind: 'line', pts: s.p, color: '#3d84b8', width: 2, layer: 1 }, bboxOf(s.p, 2));
    for (const r of MAP.roads) {
      const big = ['primary', 'secondary', 'tertiary'].includes(r.k);
      add(
        { kind: 'line', pts: r.p, color: ROAD_COLOR[r.k] ?? '#9d9a92', width: Math.max(1.5, r.w + (r.sw ? 2 : 0)), layer: big ? 4 : 3 },
        bboxOf(r.p, r.w),
      );
    }
    for (const b of MAP.buildings) {
      if (b.part) continue;
      const color =
        b.t === 'townhall' || b.t === 'torre' ? '#e2b65c' : b.t === 'church' ? '#c9a77a' : b.t === 'industrial' ? '#8e8f93' : '#6f6a62';
      add({ kind: 'fill', pts: b.o, color, layer: 5 }, bboxOf(b.o));
    }
    for (const p of MAP.pois) {
      if (p.k === 'townhall') this.blips.push({ x: p.x, z: p.z, label: 'A', color: '#f2c230' });
      if (p.k === 'locomotive') this.blips.push({ x: p.x, z: p.z, label: 'M', color: '#e07a3a' });
      if (p.k === 'bandstand') this.blips.push({ x: p.x, z: p.z, label: 'K', color: '#8fd0ff' });
    }
    const torre = MAP.buildings.find((b) => b.t === 'torre');
    if (torre) this.blips.push({ x: torre.o[0], z: torre.o[1], label: 'T', color: '#e07a3a' });
    const pools = MAP.areas.find((a) => a.k === 'water');
    if (pools) this.blips.push({ x: pools.o[0], z: pools.o[1], label: 'P', color: '#4cc0c4' });
    const station = MAP.buildings.find((b) => b.t === 'station');
    if (station) this.blips.push({ x: station.o[0], z: station.o[1], label: 'E', color: '#c0c0c0' });
  }

  draw(px: number, pz: number, facing: number, camYaw: number, vehicles: Vehicle[], driving: Vehicle | null): void {
    const g = this.g;
    const W = this.canvas.width;
    const R = W / 2;
    const scale = R / this.viewRadius;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 3, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#5b7a3c';
    g.fillRect(0, 0, W, W);

    // World → radar: centre on the player, rotate so camera-forward points up.
    g.translate(R, R);
    g.rotate(camYaw);
    g.scale(scale, scale);
    g.translate(-px, -pz);
    const reach = this.viewRadius * 1.45;
    const items = this.grid
      .query(px - reach, pz - reach, px + reach, pz + reach, this.found)
      .slice()
      .sort((a, b) => a.layer - b.layer);
    g.lineCap = g.lineJoin = 'round';
    for (const it of items) {
      g.beginPath();
      g.moveTo(it.pts[0], it.pts[1]);
      for (let i = 2; i < it.pts.length; i += 2) g.lineTo(it.pts[i], it.pts[i + 1]);
      if (it.kind === 'fill') {
        g.closePath();
        g.fillStyle = it.color;
        g.fill();
      } else {
        g.strokeStyle = it.color;
        g.lineWidth = it.width;
        g.stroke();
      }
    }

    for (const v of vehicles) {
      if (v === driving) continue;
      g.save();
      g.translate(v.x, v.z);
      g.rotate(-v.heading);
      g.fillStyle = v.spec.kind === 'tractor' ? '#7bd148' : '#4fa3ff';
      g.fillRect(-v.spec.width / 2 - 0.6, -v.spec.length / 2 - 0.6, v.spec.width + 1.2, v.spec.length + 1.2);
      g.restore();
    }
    for (const b of this.blips) {
      // Clamp far blips to the radar rim.
      let bx = b.x,
        bz = b.z;
      const d = Math.hypot(bx - px, bz - pz);
      const lim = this.viewRadius - 8;
      if (d > lim) {
        bx = px + ((bx - px) / d) * lim;
        bz = pz + ((bz - pz) / d) * lim;
      }
      g.save();
      g.translate(bx, bz);
      g.rotate(-camYaw);
      g.beginPath();
      g.arc(0, 0, 5, 0, Math.PI * 2);
      g.fillStyle = '#111';
      g.fill();
      g.fillStyle = b.color;
      g.font = 'bold 7px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(b.label, 0, 0.5);
      g.restore();
    }

    g.translate(px, pz);
    g.rotate(Math.PI - facing);
    g.beginPath();
    g.moveTo(0, -5.5);
    g.lineTo(4, 4.2);
    g.lineTo(0, 2.2);
    g.lineTo(-4, 4.2);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000000';
    g.lineWidth = 1;
    g.fill();
    g.stroke();
    g.restore();

    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.beginPath();
    g.arc(R, R, R - 3, 0, Math.PI * 2);
    g.stroke();
    const nx = R + Math.sin(camYaw) * (R - 12);
    const ny = R - Math.cos(camYaw) * (R - 12);
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(nx, ny, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 1);
  }
}
