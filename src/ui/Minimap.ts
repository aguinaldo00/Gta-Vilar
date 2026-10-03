import type { Vehicle } from '../entities/Vehicle';
import { AYTO, RIVER, STATION, TORRE, riverCenterX } from '../world/layout';
import type { MapSketch } from '../world/MapSketch';

const MAP_HALF = 230;
const PX_PER_M = 2;
const VIEW_RADIUS_M = 75;

const BLIPS: { x: number; z: number; label: string; color: string }[] = [
  { x: AYTO.x, z: AYTO.z, label: 'A', color: '#f2c230' },
  { x: TORRE.x, z: TORRE.z, label: 'T', color: '#e07a3a' },
  { x: riverCenterX((RIVER.poolZ0 + RIVER.poolZ1) / 2), z: (RIVER.poolZ0 + RIVER.poolZ1) / 2, label: 'P', color: '#4cc0c4' },
  { x: (STATION.minX + STATION.maxX) / 2, z: (STATION.minZ + STATION.maxZ) / 2, label: 'E', color: '#c0c0c0' },
];

/** GTA-style rotating radar, pre-rendered once from the world's MapSketch. */
export class Minimap {
  private readonly map: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement, sketch: MapSketch) {
    this.g = canvas.getContext('2d')!;
    this.map = document.createElement('canvas');
    const size = MAP_HALF * 2 * PX_PER_M;
    this.map.width = this.map.height = size;
    const m = this.map.getContext('2d')!;
    m.fillStyle = '#5b7a3c';
    m.fillRect(0, 0, size, size);
    m.setTransform(PX_PER_M, 0, 0, PX_PER_M, MAP_HALF * PX_PER_M, MAP_HALF * PX_PER_M);
    const ops = [...sketch.ops].sort((a, b) => a.layer - b.layer);
    for (const op of ops) {
      m.fillStyle = op.color;
      m.strokeStyle = op.color;
      if (op.kind === 'rect') m.fillRect(op.x0, op.z0, op.x1 - op.x0, op.z1 - op.z0);
      else if (op.kind === 'circle') {
        m.beginPath();
        m.arc(op.x, op.z, op.r, 0, Math.PI * 2);
        m.fill();
      } else {
        m.beginPath();
        m.moveTo(op.pts[0], op.pts[1]);
        for (let i = 2; i < op.pts.length; i += 2) m.lineTo(op.pts[i], op.pts[i + 1]);
        if (op.stroke) {
          m.lineWidth = op.stroke;
          m.stroke();
        } else {
          m.closePath();
          m.fill();
        }
      }
    }
  }

  draw(px: number, pz: number, facing: number, camYaw: number, vehicles: Vehicle[], driving: Vehicle | null): void {
    const g = this.g;
    const W = this.canvas.width;
    const R = W / 2;
    const scale = R / VIEW_RADIUS_M;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 3, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#3d5228';
    g.fillRect(0, 0, W, W);

    // World space → radar space: centre on the player, rotate so camera-forward is up.
    g.translate(R, R);
    g.rotate(camYaw);
    g.scale(scale, scale);
    g.translate(-px, -pz);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.map, -MAP_HALF, -MAP_HALF, MAP_HALF * 2, MAP_HALF * 2);

    for (const v of vehicles) {
      if (v === driving) continue;
      g.save();
      g.translate(v.x, v.z);
      g.rotate(-v.heading);
      g.fillStyle = v.spec.kind === 'tractor' ? '#7bd148' : '#4fa3ff';
      g.fillRect(-v.spec.width / 2 - 0.5, -v.spec.length / 2 - 0.5, v.spec.width + 1, v.spec.length + 1);
      g.restore();
    }
    for (const b of BLIPS) {
      g.save();
      g.translate(b.x, b.z);
      g.rotate(-camYaw);
      g.beginPath();
      g.arc(0, 0, 4.2, 0, Math.PI * 2);
      g.fillStyle = '#111';
      g.fill();
      g.fillStyle = b.color;
      g.font = 'bold 6px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(b.label, 0, 0.4);
      g.restore();
    }

    // Player arrow.
    g.translate(px, pz);
    g.rotate(Math.PI - facing);
    g.beginPath();
    g.moveTo(0, -4.5);
    g.lineTo(3.2, 3.5);
    g.lineTo(0, 1.8);
    g.lineTo(-3.2, 3.5);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000000';
    g.lineWidth = 0.8;
    g.fill();
    g.stroke();
    g.restore();

    // Rim + north marker.
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
