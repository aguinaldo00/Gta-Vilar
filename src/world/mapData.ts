import raw from './data/villarcayo.json';

/** Flat [x0, z0, x1, z1, ...] coordinate list in local metres (+X east, +Z south). */
export type Coords = number[];

export interface MapBuilding {
  o: Coords;
  h?: Coords[];
  lv?: number;
  ht?: number;
  t: 'house' | 'block' | 'industrial' | 'small' | 'church' | 'tower' | 'torre' | 'townhall' | 'station';
  n?: string;
  mat?: string;
}

export interface MapArea {
  k: string;
  o: Coords;
  h?: Coords[];
  n?: string;
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
  k: 'townhall' | 'locomotive' | 'belltower' | 'statue' | 'bandstand' | 'fountain' | 'drinking_water';
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
  lamps: number[];
  benches: number[];
  /** Flat [x, z, angle, ...]. */
  crossings: number[];
  pois: MapPoi[];
}

/** Villarcayo, generated from OpenStreetMap by scripts/osm-to-map.ts. */
export const MAP = raw as unknown as MapData;
export const BOUNDS = MAP.meta.bounds;
