import * as THREE from 'three';
import { lerp, smoothstep } from '../core/math';
import type { Batcher } from './Batcher';
import {
  type Bounds2, type Pt, type Segment, SpatialGrid, pointInRing, ringBounds, ringDist, segBounds, segDist, segmentsOf, toPts,
} from './geo';
import { MAP, type MapData } from './mapData';

export const WATER_LEVEL = -0.45;
const RIVER_BED = -1.4;
const POOL_BED = -2.8;
const BANK = 5;
const DECK = 0.35;

interface Pool {
  ring: Pt[];
  b: Bounds2;
}

/**
 * Ground heights derived from the map: flat town, river channel carved along
 * the Río Nela centre line, the natural pools dug deeper, and bridge decks.
 */
export class TerrainModel {
  private readonly river = new SpatialGrid<Segment<number>>(40);
  private readonly bridges = new SpatialGrid<Segment<number>>(40);
  readonly pools: Pool[] = [];
  private readonly found: Segment<number>[] = [];

  constructor(map: MapData) {
    map.rivers.forEach((r, i) => {
      for (const s of segmentsOf(toPts(r.p), r.w / 2, i)) this.river.insert(s, segBounds(s, BANK + 4));
    });
    map.roads.forEach((r, i) => {
      if (!r.b) return;
      for (const s of segmentsOf(toPts(r.p), r.w / 2 + 0.3, i)) this.bridges.insert(s, segBounds(s, 1));
    });
    for (const a of map.areas) {
      if (a.k !== 'water') continue;
      const ring = toPts(a.o);
      this.pools.push({ ring, b: ringBounds(ring) });
    }
  }

  /** Distance to the river centre line and the river half-width there. */
  riverDistance(x: number, z: number): { d: number; hw: number } {
    let d = Infinity, hw = 0;
    for (const s of this.river.query(x, z, x, z, this.found)) {
      const dd = segDist(x, z, s.ax, s.az, s.bx, s.bz);
      if (dd < d) {
        d = dd;
        hw = s.hw;
      }
    }
    return { d, hw };
  }

  private poolAt(x: number, z: number, pad: number): { inside: boolean; edge: number } | null {
    for (const p of this.pools) {
      if (x < p.b.minX - pad || x > p.b.maxX + pad || z < p.b.minZ - pad || z > p.b.maxZ + pad) continue;
      return { inside: pointInRing(x, z, p.ring), edge: ringDist(x, z, p.ring) };
    }
    return null;
  }

  /** Natural ground (no bridges). */
  base(x: number, z: number): number {
    let h = 0;
    const { d, hw } = this.riverDistance(x, z);
    if (d < hw + 2) h = lerp(RIVER_BED, 0, smoothstep(hw - 3, hw + 2, d));
    const pool = this.poolAt(x, z, 4);
    if (pool) {
      const ph = pool.inside ? lerp(-0.25, POOL_BED, smoothstep(0, 5, pool.edge)) : lerp(-0.25, 0, Math.min(1, pool.edge / 3));
      h = Math.min(h, ph);
    }
    return h;
  }

  /** Bridge deck height at (x, z), or -Infinity. */
  deck(x: number, z: number): number {
    for (const s of this.bridges.query(x, z, x, z, this.found)) {
      if (segDist(x, z, s.ax, s.az, s.bx, s.bz) <= s.hw) return DECK;
    }
    return -Infinity;
  }

  heightAt(x: number, z: number): number {
    return Math.max(this.base(x, z), this.deck(x, z));
  }

  waterAt(x: number, z: number): number | null {
    const { d, hw } = this.riverDistance(x, z);
    if (d < hw + 1) return WATER_LEVEL;
    const pool = this.poolAt(x, z, 1);
    if (pool && (pool.inside || pool.edge < 1)) return WATER_LEVEL;
    return null;
  }

  /** Does the channel (or a pool) influence the square tile centred at (x, z)? */
  affects(x: number, z: number, half: number): boolean {
    const reach = half * 1.42 + 12;
    for (const s of this.river.query(x - reach, z - reach, x + reach, z + reach, this.found)) {
      if (segDist(x, z, s.ax, s.az, s.bx, s.bz) < reach + s.hw) return true;
    }
    return this.pools.some((p) => x + half > p.b.minX - 6 && x - half < p.b.maxX + 6 && z + half > p.b.minZ - 6 && z - half < p.b.maxZ + 6);
  }
}

// ------------------------------------------------------------ ground colour

const AREA_COLORS: Record<string, string> = {
  farmland: '#b4a35e', meadow: '#86a24a', grass: '#7fa448', scrub: '#6b7f45', forest: '#4b6f33', orchard: '#7b9a46',
  allotments: '#8c9c54', residential: '#a19d8a', industrial: '#a29d92', brownfield: '#9c8c6c', farmyard: '#a08a65',
  park: '#6f9c45', garden: '#6c9a42', cemetery: '#899a72', camp: '#7a9a50', school: '#a7a08c', sports: '#8aa05c',
  pitch: '#4e8a3a', playground: '#b8a274', parking: '#6c6c6e', pedestrian: '#c5bdae', water: '#7d6e52', beach: '#d6c597',
  track: '#9c7b5a', pool: '#cfd3d3',
};
const AREA_ORDER = [
  'farmland', 'meadow', 'grass', 'scrub', 'orchard', 'allotments', 'residential', 'forest', 'industrial', 'brownfield',
  'farmyard', 'park', 'garden', 'cemetery', 'camp', 'school', 'sports', 'pitch', 'track', 'playground', 'parking',
  'pedestrian', 'beach', 'water', 'pool',
];

/**
 * Rasterises land use into one ground texture (also hides the river bed in
 * sandy tones). Roads and buildings are real geometry on top of it.
 */
export function groundTexture(size: number): THREE.CanvasTexture {
  const B = MAP.meta.bounds;
  const W = B.maxX - B.minX, H = B.maxZ - B.minZ;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7a9a4a';
  g.fillRect(0, 0, size, size);
  g.setTransform(size / W, 0, 0, size / H, (-B.minX * size) / W, (-B.minZ * size) / H);

  // Subtle large-scale variation so open fields are not one flat colour.
  for (let i = 0; i < 900; i++) {
    const x = B.minX + Math.random() * W, z = B.minZ + Math.random() * H;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(60,80,30,0.08)' : 'rgba(170,170,90,0.08)';
    g.beginPath();
    g.ellipse(x, z, 20 + Math.random() * 60, 15 + Math.random() * 40, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }

  const path = (coords: number[]) => {
    g.moveTo(coords[0], coords[1]);
    for (let i = 2; i < coords.length; i += 2) g.lineTo(coords[i], coords[i + 1]);
    g.closePath();
  };
  const sorted = [...MAP.areas].sort((a, b) => AREA_ORDER.indexOf(a.k) - AREA_ORDER.indexOf(b.k));
  sorted.forEach((a, i) => {
    let col = AREA_COLORS[a.k];
    if (!col) return;
    if (a.k === 'farmland') col = ['#b4a35e', '#9fae58', '#a88b62', '#c2b56a'][i % 4];
    g.fillStyle = col;
    g.beginPath();
    path(a.o);
    for (const h of a.h ?? []) path(h);
    g.fill('evenodd');
    if (a.k === 'farmland') {
      // Plough lines.
      g.save();
      g.clip('evenodd');
      g.strokeStyle = 'rgba(70,50,20,0.12)';
      g.lineWidth = 1.2;
      const ang = (i * 0.7) % Math.PI;
      const xs = a.o.filter((_, k) => k % 2 === 0), zs = a.o.filter((_, k) => k % 2 === 1);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const R = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      g.beginPath();
      for (let s = -R; s <= R; s += 4) {
        g.moveTo(cx + Math.cos(ang) * s - Math.sin(ang) * R, cz + Math.sin(ang) * s + Math.cos(ang) * R);
        g.lineTo(cx + Math.cos(ang) * s + Math.sin(ang) * R, cz + Math.sin(ang) * s - Math.cos(ang) * R);
      }
      g.stroke();
      g.restore();
    }
    if (a.k === 'pitch') {
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 0.4;
      g.beginPath();
      path(a.o);
      g.stroke();
    }
  });

  // River bed and banks.
  g.lineCap = g.lineJoin = 'round';
  for (const r of MAP.rivers) {
    for (const [w, col] of [[r.w + 6, '#6f7a45'], [r.w + 2, '#8a7a58'], [r.w - 4, '#6e6046']] as const) {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(r.p[0], r.p[1]);
      for (let i = 2; i < r.p.length; i += 2) g.lineTo(r.p[i], r.p[i + 1]);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Ground material: land-use colour map × a tiling detail texture (world scale). */
export function groundMaterial(size: number, detail: THREE.Texture): THREE.MeshLambertMaterial {
  const B = MAP.meta.bounds;
  const mat = new THREE.MeshLambertMaterial({ map: groundTexture(size) });
  mat.name = 'ground';
  mat.userData.castShadow = false;
  const repeat = new THREE.Vector2((B.maxX - B.minX) / 5, (B.maxZ - B.minZ) / 5);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detail };
    shader.uniforms.detailRepeat = { value: repeat };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nuniform vec2 detailRepeat;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n  diffuseColor.rgb *= texture2D(detailMap, vMapUv * detailRepeat).rgb * 1.18;',
      );
  };
  return mat;
}

/**
 * Ground mesh in 50 m tiles: flat quads where the ground is flat, a 2.5 m
 * heightfield where the river channel or the pools carve it.
 */
export function buildGround(terrain: TerrainModel, batch: Batcher, mat: THREE.Material): void {
  const B = MAP.meta.bounds;
  const TILE = 50;
  const W = B.maxX - B.minX, H = B.maxZ - B.minZ;
  const nx = Math.ceil(W / TILE), nz = Math.ceil(H / TILE);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x0 = B.minX + i * TILE, z0 = B.minZ + j * TILE;
      const x1 = Math.min(B.maxX, x0 + TILE), z1 = Math.min(B.maxZ, z0 + TILE);
      const detailed = terrain.affects((x0 + x1) / 2, (z0 + z1) / 2, TILE / 2);
      const seg = detailed ? 20 : 1;
      batch.addWorld(tile(terrain, x0, z0, x1, z1, seg, detailed, B, W, H), mat);
    }
  }
}

function tile(
  terrain: TerrainModel, x0: number, z0: number, x1: number, z1: number, seg: number, detailed: boolean,
  B: { minX: number; minZ: number }, W: number, H: number,
): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const x = x0 + ((x1 - x0) * i) / seg;
      const z = z0 + ((z1 - z0) * j) / seg;
      pos.push(x, detailed ? terrain.base(x, z) : 0, z);
      uv.push((x - B.minX) / W, 1 - (z - B.minZ) / H);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
