import { lerp, smoothstep } from '../core/math';

/**
 * Villarcayo, simplified. World units are metres; +X is east, +Z is south
 * (so "north" on the minimap is -Z).
 *
 *            N (-Z)
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ fields          fields             fields                 │
 *   │  ║ rail   ┌──────────── town ─────────────┐  ┊ El Soto ≈≈ │
 *   │  ║        │        Torre del Corregimiento │  ┊        ≈≈ │
 *   │  ║ estac. │          Ayuntamiento          │  ┊ pools  ≈≈ │
 *   │  ║        │          Plaza Mayor           │  ┊  Río   ≈≈ │
 *   │══╬═══════════════ Camino Real ═══════════════════bridge═══ │
 *   │  ║        └────────────────────────────────┘  ┊        ≈≈ │
 *   └────────────────────────────────────────────────────────────┘
 */

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Street {
  name: string;
  /** Axis the street runs along. */
  axis: 'x' | 'z';
  /** Centre-line coordinate on the other axis. */
  c: number;
  from: number;
  to: number;
  width: number;
  main?: boolean;
}

export const WORLD_HALF = 200;
export const TOWN: Rect = { minX: -128, minZ: -130, maxX: 118, maxZ: 135 };
export const SIDEWALK = 2.5;
export const CURB = 0.15;
export const FLOOR_H = 3.1;

export const CAMINO_REAL_Z = 34;

export const STREETS: Street[] = [
  { name: 'Camino Real', axis: 'x', c: CAMINO_REAL_Z, from: -186, to: 186, width: 11, main: true },
  { name: 'Calle', axis: 'x', c: -70, from: TOWN.minX, to: TOWN.maxX, width: 8 },
  { name: 'Calle', axis: 'x', c: 100, from: TOWN.minX, to: TOWN.maxX, width: 8 },
  { name: 'Calle', axis: 'z', c: -100, from: TOWN.minZ, to: TOWN.maxZ, width: 8 },
  { name: 'Calle', axis: 'z', c: -37, from: TOWN.minZ, to: TOWN.maxZ, width: 8 },
  { name: 'Calle', axis: 'z', c: 37, from: TOWN.minZ, to: TOWN.maxZ, width: 8 },
  { name: 'Carretera', axis: 'z', c: 100, from: -186, to: 186, width: 8 },
  { name: 'Camino de la Estación', axis: 'x', c: -5, from: -147, to: TOWN.minX, width: 7 },
];

export function streetRect(s: Street): Rect {
  const h = s.width / 2;
  return s.axis === 'x'
    ? { minX: s.from, maxX: s.to, minZ: s.c - h, maxZ: s.c + h }
    : { minX: s.c - h, maxX: s.c + h, minZ: s.from, maxZ: s.to };
}

/** Block containing the Plaza Mayor, the Ayuntamiento and the Torre. */
export const PLAZA_BLOCK: Rect = { minX: -33, minZ: -66, maxX: 33, maxZ: 28.5 };
/** Open paved square in front of the town hall. */
export const PLAZA: Rect = { minX: -30.5, minZ: -22, maxX: 30.5, maxZ: 26 };
/** Ayuntamiento footprint: arcaded front faces the plaza (+Z). */
export const AYTO = { x: 0, z: -29, w: 34, d: 14 };
export const TORRE = { x: 0, z: -51, size: 9, height: 21 };
export const KIOSKO = { x: 9, z: 5 };

export const RIVER = {
  halfWidth: 9,
  bank: 5,
  bed: -1.2,
  poolBed: -2.8,
  water: -0.45,
  poolZ0: -78,
  poolZ1: -28,
};

/** The Río Nela meanders gently north–south through Parque El Soto. */
export function riverCenterX(z: number): number {
  return 160 + 7 * Math.sin(z / 45);
}

export const SOTO: Rect = { minX: 118, minZ: -200, maxX: 200, maxZ: 200 };

const bridgeCx = riverCenterX(CAMINO_REAL_Z);
export const BRIDGE: Rect & { deck: number } = {
  minX: bridgeCx - 15,
  maxX: bridgeCx + 15,
  minZ: CAMINO_REAL_Z - 5.5,
  maxZ: CAMINO_REAL_Z + 5.5,
  deck: 0.35,
};
export const FOOTBRIDGE_Z = -120;
export const SOTO_PARKING: Rect = { minX: 121, minZ: 42, maxX: 140, maxZ: 62 };

/** Old Santander–Mediterráneo line on the western outskirts. */
export const RAIL_X = -165;
export const SIDING_X = -172;
export const RAIL_Z0 = -186;
export const RAIL_Z1 = 186;
export const STATION: Rect = { minX: -158, minZ: -38, maxX: -146, maxZ: -16 };

export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
}

/** Analytic terrain: flat town, carved river channel, hills at the map edge. */
export function terrainHeight(x: number, z: number): number {
  const d = Math.abs(x - riverCenterX(z));
  const landT = smoothstep(RIVER.halfWidth - RIVER.bank, RIVER.halfWidth + 1, d);

  const ex = Math.max(0, Math.abs(x) - 186);
  const ez = Math.max(0, Math.abs(z) - 186);
  const e = Math.hypot(ex, ez);
  let land = 0;
  if (e > 0) {
    land = 24 * smoothstep(0, 36, e) + Math.sin(x * 0.13) * Math.cos(z * 0.11) * 2 * smoothstep(0, 12, e);
    land *= smoothstep(RIVER.halfWidth, RIVER.halfWidth + 16, d); // keep the river valley open
  }

  const poolT = smoothstep(RIVER.poolZ0 - 5, RIVER.poolZ0 + 1, z) * (1 - smoothstep(RIVER.poolZ1 - 1, RIVER.poolZ1 + 5, z));
  const bed = lerp(RIVER.bed, RIVER.poolBed, poolT);
  return lerp(bed, land, landT);
}

export function isPool(x: number, z: number): boolean {
  return z > RIVER.poolZ0 && z < RIVER.poolZ1 && Math.abs(x - riverCenterX(z)) < RIVER.halfWidth;
}
