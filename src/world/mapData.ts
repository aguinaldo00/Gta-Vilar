import raw from './data/villarcayo.json';

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
  t: 'house' | 'block' | 'industrial' | 'small' | 'church' | 'tower' | 'torre' | 'townhall' | 'station' | 'canopy' | 'ruins' | 'greenhouse';
  n?: string;
  mat?: string;
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
}

/** Shop, bar or public service, on the street-facing wall of its building. */
export interface MapShop {
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
  };
  buildings: MapBuilding[];
  areas: MapArea[];
  roads: MapRoad[];
  rails: { p: Coords }[];
  rivers: { p: Coords; w: number; n?: string }[];
  streams: { p: Coords; w: number }[];
  weirs: { p: Coords; n?: string }[];
  /** Flat [x, z, ...]. */
  trees: number[];
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

/** Villarcayo, generated from OpenStreetMap by scripts/osm-to-map.ts. */
export const MAP = raw as unknown as MapData;
export const BOUNDS = MAP.meta.bounds;
