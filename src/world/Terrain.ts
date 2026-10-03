import * as THREE from 'three';
import { lerp } from '../core/math';
import type { Batcher } from './Batcher';
import {
  type Bounds2,
  type Pt,
  pointInRing,
  ringBounds,
  ringDist,
  type Segment,
  SpatialGrid,
  segBounds,
  segDist,
  segmentsOf,
  toPts,
} from './geo';
import type { MapData } from './mapData';

const BANK = 5;
/** Bridge decks sit this far above the approach ground at either end. */
const DECK_LIFT = 0.35;

interface Pool {
  ring: Pt[];
  b: Bounds2;
  level: number;
}

interface LevelSegment extends Segment<number> {
  /** Water surface (rivers) or deck height (bridges) at a and b. */
  ha: number;
  hb: number;
}

/**
 * Ground and water heights. The relief comes from the baked heightmap
 * (PNOA-LiDAR ground returns, IGN MDT05 outside the LiDAR tiles; river beds
 * already carved), sampled bilinearly. Rivers and pools carry their own
 * surface levels; bridge decks span between the ground at their two ends.
 * Without a heightmap (tests, old map files) the ground is flat at y = 0.
 */
export class TerrainModel {
  private readonly river = new SpatialGrid<LevelSegment>(40);
  private readonly bridges = new SpatialGrid<LevelSegment>(40);
  readonly pools: Pool[] = [];
  private readonly found: LevelSegment[] = [];
  private readonly grid: MapData['meta']['terrain'];
  private readonly heights: Float32Array | undefined;

  constructor(map: MapData) {
    this.grid = map.meta.terrain;
    this.heights = map.heights;
    map.rivers.forEach((r, i) => {
      const pts = toPts(r.p);
      segmentsOf(pts, r.w / 2, i).forEach((s, k) => {
        const seg: LevelSegment = { ...s, ha: r.wl?.[k] ?? -0.45, hb: r.wl?.[k + 1] ?? -0.45 };
        this.river.insert(seg, segBounds(s, BANK + 4));
      });
    });
    map.roads.forEach((r, i) => {
      if (!r.b) return;
      const pts = toPts(r.p);
      // Deck: straight between the ground at the two ends of the bridge.
      const h0 = this.ground(pts[0][0], pts[0][1]) + DECK_LIFT;
      const h1 = this.ground(pts[pts.length - 1][0], pts[pts.length - 1][1]) + DECK_LIFT;
      let total = 0;
      for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      let run = 0;
      segmentsOf(pts, r.w / 2 + 0.3, i).forEach((s) => {
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
        const seg: LevelSegment = { ...s, ha: lerp(h0, h1, run / (total || 1)), hb: lerp(h0, h1, (run + len) / (total || 1)) };
        run += len;
        this.bridges.insert(seg, segBounds(s, 1));
      });
    });
    for (const a of map.areas) {
      if (a.k !== 'water') continue;
      const ring = toPts(a.o);
      this.pools.push({ ring, b: ringBounds(ring), level: a.wl ?? -0.45 });
    }
  }

  /** Bilinear heightmap sample (the natural ground, river beds included). */
  ground(x: number, z: number): number {
    const g = this.grid,
      h = this.heights;
    if (!g || !h) return 0;
    const fx = Math.min(Math.max((x - g.minX) / g.cell, 0), g.cols - 1.001);
    const fz = Math.min(Math.max((z - g.minZ) / g.cell, 0), g.rows - 1.001);
    const c = Math.floor(fx),
      r = Math.floor(fz);
    const tx = fx - c,
      tz = fz - r;
    const i = r * g.cols + c;
    const top = h[i] + (h[i + 1] - h[i]) * tx;
    const bot = h[i + g.cols] + (h[i + g.cols + 1] - h[i + g.cols]) * tx;
    return top + (bot - top) * tz;
  }

  /** Distance to the river centre line and the river half-width there. */
  riverDistance(x: number, z: number): { d: number; hw: number } {
    const n = this.nearestRiver(x, z);
    return n ? { d: n.d, hw: n.seg.hw } : { d: Infinity, hw: 0 };
  }

  private nearestRiver(x: number, z: number): { seg: LevelSegment; d: number; t: number } | null {
    let best: { seg: LevelSegment; d: number; t: number } | null = null;
    for (const s of this.river.query(x, z, x, z, this.found)) {
      const d = segDist(x, z, s.ax, s.az, s.bx, s.bz);
      if (best && d >= best.d) continue;
      const dx = s.bx - s.ax,
        dz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
      best = { seg: s, d, t };
    }
    return best;
  }

  private poolAt(x: number, z: number, pad: number): Pool | null {
    for (const p of this.pools) {
      if (x < p.b.minX - pad || x > p.b.maxX + pad || z < p.b.minZ - pad || z > p.b.maxZ + pad) continue;
      if (pointInRing(x, z, p.ring) || ringDist(x, z, p.ring) < pad) return p;
    }
    return null;
  }

  /** Natural ground (no bridges). */
  base(x: number, z: number): number {
    return this.ground(x, z);
  }

  /** Bridge deck height at (x, z), or -Infinity. */
  deck(x: number, z: number): number {
    for (const s of this.bridges.query(x, z, x, z, this.found)) {
      if (segDist(x, z, s.ax, s.az, s.bx, s.bz) > s.hw) continue;
      const dx = s.bx - s.ax,
        dz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
      return lerp(s.ha, s.hb, t);
    }
    return -Infinity;
  }

  heightAt(x: number, z: number): number {
    return Math.max(this.base(x, z), this.deck(x, z));
  }

  /** Water surface at (x, z) if it is on the river or a pool and below the surface, else null. */
  waterAt(x: number, z: number): number | null {
    const r = this.nearestRiver(x, z);
    if (r && r.d < r.seg.hw + 1) return lerp(r.seg.ha, r.seg.hb, r.t);
    const pool = this.poolAt(x, z, 1);
    return pool ? pool.level : null;
  }

  /** River surface level along the nearest river segment (for water meshes). */
  riverLevel(x: number, z: number): number {
    const r = this.nearestRiver(x, z);
    return r ? lerp(r.seg.ha, r.seg.hb, r.t) : -0.45;
  }

  /** Slope (rise over run) of the ground at (x, z). */
  slope(x: number, z: number): number {
    const e = 1;
    const gx = (this.ground(x + e, z) - this.ground(x - e, z)) / (2 * e);
    const gz = (this.ground(x, z + e) - this.ground(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz);
  }
}

// ------------------------------------------------------------ ground colour

const AREA_COLORS: Record<string, string> = {
  farmland: '#b4a35e',
  meadow: '#86a24a',
  grass: '#7fa448',
  scrub: '#6b7f45',
  forest: '#4b6f33',
  orchard: '#7b9a46',
  allotments: '#8c9c54',
  residential: '#a19d8a',
  industrial: '#a29d92',
  brownfield: '#9c8c6c',
  farmyard: '#a08a65',
  park: '#6f9c45',
  garden: '#6c9a42',
  cemetery: '#899a72',
  camp: '#7a9a50',
  school: '#a7a08c',
  sports: '#8aa05c',
  pitch: '#4e8a3a',
  playground: '#b8a274',
  parking: '#6c6c6e',
  pedestrian: '#c5bdae',
  water: '#7d6e52',
  beach: '#d6c597',
  track: '#9c7b5a',
  pool: '#cfd3d3',
};
const AREA_ORDER = [
  'farmland',
  'meadow',
  'grass',
  'scrub',
  'orchard',
  'allotments',
  'residential',
  'forest',
  'industrial',
  'brownfield',
  'farmyard',
  'park',
  'garden',
  'cemetery',
  'camp',
  'school',
  'sports',
  'pitch',
  'track',
  'playground',
  'parking',
  'pedestrian',
  'beach',
  'water',
  'pool',
];

/**
 * Rasterises land use into one ground texture (also hides the river bed in
 * sandy tones). Roads and buildings are real geometry on top of it.
 */
export function groundTexture(map: MapData, size: number): THREE.CanvasTexture {
  const B = map.meta.bounds;
  const W = B.maxX - B.minX,
    H = B.maxZ - B.minZ;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7a9a4a';
  g.fillRect(0, 0, size, size);
  g.setTransform(size / W, 0, 0, size / H, (-B.minX * size) / W, (-B.minZ * size) / H);

  // Subtle large-scale variation so open fields are not one flat colour.
  for (let i = 0; i < 900; i++) {
    const x = B.minX + Math.random() * W,
      z = B.minZ + Math.random() * H;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(60,80,30,0.08)' : 'rgba(170,170,90,0.08)';
    g.beginPath();
    g.ellipse(x, z, 20 + Math.random() * 60, 15 + Math.random() * 40, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }

  // Patchwork of plots (fincas) wherever OSM has no land use: the valley around
  // town is a mosaic of hay meadows, pasture and cereal strips.
  const plotColours = [
    'rgba(122,150,70,0.45)',
    'rgba(140,160,80,0.45)',
    'rgba(170,165,95,0.4)',
    'rgba(100,130,60,0.45)',
    'rgba(185,170,105,0.35)',
  ];
  for (let x = B.minX; x < B.maxX; x += 140) {
    for (let z = B.minZ; z < B.maxZ; z += 110) {
      const w = 60 + Math.random() * 90,
        h = 40 + Math.random() * 70;
      g.save();
      g.translate(x + Math.random() * 60, z + Math.random() * 50);
      g.rotate(0.35 + (Math.random() - 0.5) * 0.25);
      g.fillStyle = plotColours[Math.floor(Math.random() * plotColours.length)];
      g.fillRect(-w / 2, -h / 2, w, h);
      g.restore();
    }
  }

  const path = (coords: number[]) => {
    g.moveTo(coords[0], coords[1]);
    for (let i = 2; i < coords.length; i += 2) g.lineTo(coords[i], coords[i + 1]);
    g.closePath();
  };
  const sorted = [...map.areas].sort((a, b) => AREA_ORDER.indexOf(a.k) - AREA_ORDER.indexOf(b.k));
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
      const xs = a.o.filter((_, k) => k % 2 === 0),
        zs = a.o.filter((_, k) => k % 2 === 1);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
        cz = (Math.min(...zs) + Math.max(...zs)) / 2;
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
  for (const r of map.rivers) {
    for (const [w, col] of [
      [r.w + 6, '#6f7a45'],
      [r.w + 2, '#8a7a58'],
      [r.w - 4, '#6e6046'],
    ] as const) {
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
export function groundMaterial(map: MapData, size: number, detail: THREE.Texture): THREE.MeshStandardMaterial {
  const B = map.meta.bounds;
  const mat = new THREE.MeshStandardMaterial({ map: groundTexture(map, size), roughness: 1, metalness: 0 });
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
        '#include <map_fragment>\n  diffuseColor.rgb *= texture2D(detailMap, vMapUv * detailRepeat).rgb * 1.45;',
      );
  };
  return mat;
}

/**
 * Real orthophoto (PNOA) on the ground, one texture and material per 256 m
 * tile, with the grass/grain detail map multiplied in for close-ups. Roofs
 * reuse the same materials (their UVs are world positions too), so a tile of
 * ground and every roof on it is a single draw call.
 */
export class OrthoTiles {
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly loader = new THREE.TextureLoader();

  constructor(
    private readonly cfg: NonNullable<MapData['meta']['ortho']>,
    private readonly baseUrl: string,
    private readonly detail: THREE.Texture,
  ) {}

  /** Tile indices containing (x, z), clamped to the grid. */
  tileOf(x: number, z: number): [number, number] {
    const c = this.cfg;
    const i = Math.min(c.nx - 1, Math.max(0, Math.floor((x - c.minX) / c.tile)));
    const j = Math.min(c.nz - 1, Math.max(0, Math.floor((z - c.minZ) / c.tile)));
    return [i, j];
  }

  /** UV of world (x, z) inside tile (i, j). */
  uv(i: number, j: number, x: number, z: number): [number, number] {
    const c = this.cfg;
    return [(x - (c.minX + i * c.tile)) / c.tile, 1 - (z - (c.minZ + j * c.tile)) / c.tile];
  }

  material(i: number, j: number): THREE.MeshStandardMaterial {
    const key = `${i}_${j}`;
    let m = this.mats.get(key);
    if (m) return m;
    const tex = this.loader.load(`${this.baseUrl}${this.cfg.dir}/${key}.jpg`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    m.name = `ortho_${key}`;
    m.userData.castShadow = false;
    const detail = this.detail;
    const tile = this.cfg.tile;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.detailMap = { value: detail };
      shader.uniforms.detailRepeat = { value: new THREE.Vector2(tile / 3, tile / 3) };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nuniform vec2 detailRepeat;')
        .replace(
          '#include <map_fragment>',
          // The orthophoto was shot in sunlight: tone it down so our own lighting does not double it.
          '#include <map_fragment>\n  diffuseColor.rgb *= mix(vec3(1.0), texture2D(detailMap, vMapUv * detailRepeat).rgb * 1.45, 0.35) * 0.95;',
        );
    };
    this.mats.set(key, m);
    return m;
  }
}

/**
 * Ground mesh: one heightfield patch per orthophoto tile (or 128 m patches
 * with the land-use texture when the map has no orthophoto).
 */
export function buildGround(
  map: MapData,
  terrain: TerrainModel,
  batch: Batcher,
  fallback: THREE.Material,
  ortho: OrthoTiles | null,
  segments: number,
): void {
  const B = map.meta.bounds;
  const TILE = map.meta.ortho?.tile ?? 128;
  const x0 = map.meta.ortho?.minX ?? B.minX,
    z0 = map.meta.ortho?.minZ ?? B.minZ;
  const nx = Math.ceil((B.maxX - x0) / TILE),
    nz = Math.ceil((B.maxZ - z0) / TILE);
  const W = B.maxX - B.minX,
    H = B.maxZ - B.minZ;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const ax = x0 + i * TILE,
        az = z0 + j * TILE;
      const bx = Math.min(B.maxX, ax + TILE),
        bz = Math.min(B.maxZ, az + TILE);
      const uv = ortho
        ? (x: number, z: number) => ortho.uv(i, j, x, z)
        : (x: number, z: number) => [(x - B.minX) / W, 1 - (z - B.minZ) / H];
      batch.addWorld(patch(terrain, ax, az, bx, bz, segments, uv), ortho ? ortho.material(i, j) : fallback);
    }
  }
}

function patch(
  terrain: TerrainModel,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  seg: number,
  uvOf: (x: number, z: number) => number[],
): THREE.BufferGeometry {
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const sx = Math.max(1, Math.round((seg * (x1 - x0)) / 256)),
    sz = Math.max(1, Math.round((seg * (z1 - z0)) / 256));
  for (let j = 0; j <= sz; j++) {
    for (let i = 0; i <= sx; i++) {
      const x = x0 + ((x1 - x0) * i) / sx;
      const z = z0 + ((z1 - z0) * j) / sz;
      pos.push(x, terrain.base(x, z), z);
      uv.push(...uvOf(x, z));
    }
  }
  for (let j = 0; j < sz; j++) {
    for (let i = 0; i < sx; i++) {
      const a = j * (sx + 1) + i,
        b = a + 1,
        c = a + sx + 1,
        d = c + 1;
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
