/** Flat [x0, z0, x1, z1, ...] coordinate list in local metres (+X east, +Z south). */
export type Coords = number[];

export interface MapBuilding {
  o: Coords;
  h?: Coords[];
  lv?: number;
  /** building:min_level (parts raised above the ground). */
  mlv?: number;
  ht?: number;
  /** Outline whose volume is drawn through its building:parts. */
  hp?: 1;
  /** This is a building:part. */
  part?: 1;
  /** Hidden wall indices (walls shared with an equal or taller part). */
  hid?: number[];
  t:
    | 'house'
    | 'block'
    | 'industrial'
    | 'small'
    | 'church'
    | 'tower'
    | 'torre'
    | 'townhall'
    | 'station'
    | 'canopy'
    | 'ruins'
    | 'greenhouse'
    /** Grandstand: stepped terraces under a roof, facing `face`. */
    | 'stand';
  n?: string;
  mat?: string;
  /** Ground under the walls (local y, from the terrain model). */
  gy?: number;
  /** Measured by LiDAR (local y): roof top and eaves. */
  top?: number;
  eave?: number;
  /** "lidar" for buildings traced from the point cloud (missing in OSM). */
  src?: 'lidar';
  /** Index of the roof (MapData.roofs) covering this footprint; its walls stop at that roof's eaves. */
  rf?: number;
  /** Lifted over a passage (tunnel=building_passage): walls start this many metres above the ground. */
  lift?: number;
  /** Ground-floor piece beside a passage, under a lifted building (no roof; walls up to `top`). */
  gf?: 1;
  /** Facade style (row of src/world/facadeStyles.ts) and wall colour 0xRRGGBB from the cadastre photo. */
  fs?: number;
  fc?: number;
  /** Galerías seen in the facade photo: 1 the whole facade, 2 one glazed bay. */
  gal?: 0 | 1 | 2;
  /** Cadastre: year of construction, current use, reference. */
  year?: number;
  use?: string;
  cref?: string;
  /** Checked fixes (data/corrections.json buildingFixes): roof colour, canopy / stand roof height above the ground, the point a stand faces. */
  rc?: string;
  ch?: number;
  face?: [number, number];
}

/**
 * Roof over one or more adjacent footprints with the same eaves
 * (tools/geodata/roofs.py), measured from the LiDAR.
 */
export interface MapRoof {
  o: Coords;
  h?: Coords[];
  /** Eave height (local y). */
  e: number;
  /** Slope, rise per metre (0 = flat terrace). */
  s: number;
  /** Ridge height above the eaves; the hip roof is cut flat there. */
  r: number;
  /** Colour sampled from the orthophoto (0xRRGGBB). */
  c?: number;
}

export interface MapArea {
  k: string;
  o: Coords;
  h?: Coords[];
  n?: string;
  /** Pitches: sport (soccer, tennis, pelota, skittles…); parkings: bay orientation. */
  s?: string;
  /** Pitches: covered. */
  c?: 1;
  /** Woods: needle-leaved (n) or broad-leaved (b). */
  l?: 'n' | 'b';
  /** Water areas: surface level (local y). */
  wl?: number;
  /** Frontones (data/corrections.json pitchFixes): a point by the frontis and one by the left wall (x, z, x, z). */
  fr?: number[];
  /** Wall colour, frontis height, left-wall heights by distance from the frontis ([from, to, height]). */
  wall?: string;
  fh?: number;
  steps?: [number, number, number][];
}

/** Shop, bar or public service, on the street-facing wall of its building. */
export interface MapShop {
  /** Second front of a corner shop, on the other street. */
  s?: 1;
  /** Point on the wall. */
  x: number;
  z: number;
  /** Heading of the wall's outward normal (rotation.y mapping +Z onto it). */
  a: number;
  /** Front width (m). */
  w: number;
  c:
    | 'bar'
    | 'food'
    | 'cafe'
    | 'bank'
    | 'pharmacy'
    | 'police'
    | 'health'
    | 'civic'
    | 'grocery'
    | 'beauty'
    | 'garage'
    | 'shop'
    | 'office'
    | 'hotel';
  /** Sign text (real name, or the trade in Spanish). */
  n: string;
}

export interface MapFurniture {
  k: string;
  x: number;
  z: number;
  /** Heading the item faces (rotation about Y; local +Z). */
  a: number;
  /** Subtype: recycling streams ("glass,paper"), "digital" for animated screens, information kind. */
  t?: string;
}

export interface MapRoad {
  p: Coords;
  k: string;
  w: number;
  n?: string;
  /** Bridge. */
  b?: 1;
  /** Sidewalks: 1 left, 2 right, 3 both. */
  sw?: number;
  /** Indices of junction vertices. */
  j?: number[];
}

export interface MapPoi {
  k: 'townhall' | 'locomotive' | 'belltower' | 'statue' | 'bandstand' | 'fountain' | 'drinking_water' | 'fuel' | 'bus_stop';
  n?: string;
  x: number;
  z: number;
  o?: Coords;
  ht?: number;
}

export interface MapData {
  meta: {
    source: string;
    origin: { lat: number; lon: number; note: string };
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    utmOrigin?: { E: number; N: number };
    /** Heightmap file baked from LiDAR + MDT (tools/geodata). */
    terrain?: { file: string; cols: number; rows: number; cell: number; minX: number; minZ: number; scale: number; datum: number };
    /** Orthophoto tiles (tools/geodata/fetch_ortho.py). */
    ortho?: { dir: string; tile: number; nx: number; nz: number; minX: number; minZ: number; source: string };
    sources?: string[];
    /** Real relief and imagery around the map (MDT25 + PNOA), drawn as the horizon. */
    surroundings?: {
      file: string;
      image: string;
      cols: number;
      rows: number;
      cell: number;
      minX: number;
      minZ: number;
      scale: number;
      imageBounds: [number, number, number, number];
    };
  };
  /** URL of the folder the map was loaded from (its side files live there). */
  baseUrl?: string;
  /** Heights of the surroundings grid (local y). */
  surroundings?: Float32Array;
  /** Ground heights (local y) on the meta.terrain grid; absent = flat map. */
  heights?: Float32Array;
  buildings: MapBuilding[];
  /** Walls, fences and hedges (OSM, plus plot walls found in the LiDAR: src "lidar"); h in metres. */
  barriers?: {
    p: Coords;
    k: 'wall' | 'fence' | 'hedge' | 'retaining_wall' | 'railing' | 'verja';
    /** Verja: hedge on the left (1) or right (-1) side. */
    hedge?: number;
    h?: number;
    src?: 'lidar' | 'step';
    top?: number;
    up?: 1 | -1;
    /** Hedge thickness, m. */
    t?: number;
  }[];
  /** Street furniture at its mapped position (signs, containers, bins, poles, billboards...). */
  furniture?: MapFurniture[];
  /** Overhead power lines (pole to pole). */
  powerlines?: { p: Coords; k: 'line' | 'minor' }[];
  /** Parked cars seen by the LiDAR: flat [x, z, heading, length, ...]. */
  cars?: number[];
  /** Bollards, flat [x, z, ...]. */
  bollards?: number[];
  /** Roofs shared by rows of buildings (absent: each building gets its own roof). */
  roofs?: MapRoof[];
  areas: MapArea[];
  roads: MapRoad[];
  rails: { p: Coords }[];
  /** `wl`: water surface (local y) at each vertex. */
  rivers: { p: Coords; w: number; n?: string; wl?: number[] }[];
  streams: { p: Coords; w: number }[];
  weirs: { p: Coords; n?: string }[];
  /** Flat [x, z, ...]. */
  trees: number[];
  /** Trees found in the LiDAR canopy: flat [x, z, height, crown radius, ...] (metres). */
  ltrees?: number[];
  /** Conifers (leaf_type=needleleaved), flat [x, z, ...]. */
  pines: number[];
  lamps: number[];
  benches: number[];
  /** Flat [x, z, angle, ...]. */
  crossings: number[];
  pois: MapPoi[];
  shops: MapShop[];
  /** Flat [x, z, angle, stone(0|1), ...]. */
  tables: number[];
  /** Flat [x, z, ...]. */
  playgrounds: number[];
}

const ARRAYS = [
  'buildings',
  'areas',
  'roads',
  'rails',
  'rivers',
  'streams',
  'weirs',
  'trees',
  'pines',
  'lamps',
  'benches',
  'crossings',
  'pois',
  'shops',
  'tables',
  'playgrounds',
] as const;

/**
 * Checks the shape of a map file (generated by scripts/osm-to-map.ts) before
 * the world is built from it; a stale or truncated file fails here, loudly.
 */
export function parseMap(raw: unknown, source = 'map'): MapData {
  const m = raw as Partial<MapData> | null;
  const b = m?.meta?.bounds;
  if (!b || ![b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) || b.minX >= b.maxX || b.minZ >= b.maxZ) {
    throw new Error(`${source}: missing or invalid meta.bounds`);
  }
  for (const k of ARRAYS) if (!Array.isArray(m[k])) throw new Error(`${source}: "${k}" must be an array`);
  return m as MapData;
}

/**
 * Decodes a 16-bit heightmap image (tools/geodata/heightpng.py): RGBA pixels,
 * value = R * 256 + G - 32768, row-major (z rows of x columns).
 */
export function decodeHeightPixels(rgba: ArrayLike<number>, cols: number, rows: number, scale: number, name: string): Float32Array {
  if (rgba.length !== cols * rows * 4) throw new Error(`${name}: expected ${cols}×${rows} pixels, got ${rgba.length / 4}`);
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = (rgba[i * 4] * 256 + rgba[i * 4 + 1] - 32768) * scale;
  return out;
}

/** Decodes the map heightmap (cm on the meta.terrain grid). */
export function decodeHeights(map: MapData, rgba: ArrayLike<number>): Float32Array {
  const t = map.meta.terrain;
  if (!t) throw new Error('map has no meta.terrain');
  return decodeHeightPixels(rgba, t.cols, t.rows, t.scale, t.file);
}

/** Fetches a heightmap PNG and returns its exact RGBA bytes (no colour management, no premultiplication). */
async function fetchPixels(url: string): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error(`${url}: no 2D canvas to decode the heightmap`);
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return g.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** Fetches and validates a map file served from public/maps/, with its heightmaps. */
export async function loadMap(url: string): Promise<MapData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const map = parseMap(await res.json(), url);
  map.baseUrl = new URL('.', new URL(url, location.href)).href;
  const t = map.meta.terrain;
  const s = map.meta.surroundings;
  const [heights, far] = await Promise.all([
    t ? fetchPixels(new URL(t.file, map.baseUrl).href) : null,
    // The horizon is optional: without it the game falls back to a stylised backdrop.
    s ? fetchPixels(new URL(s.file, map.baseUrl).href).catch(() => null) : null,
  ]);
  if (heights) map.heights = decodeHeights(map, heights);
  if (s && far) map.surroundings = decodeHeightPixels(far, s.cols, s.rows, s.scale, s.file);
  return map;
}
