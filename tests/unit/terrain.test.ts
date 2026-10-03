import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeHeightPixels, decodeHeights, type MapData, parseMap } from '@/world/mapData';
import { TerrainModel } from '@/world/Terrain';
import { readPng } from './png';

/** Encodes heights (integer units) the way tools/geodata/heightpng.py does. */
const rgba = (values: number[]) => new Uint8Array(values.flatMap((v) => [(v + 32768) >> 8, (v + 32768) & 255, 0, 255]));

/** Minimal map: 3x3 height grid (2 m cells) rising 1 m per column, a river and a bridge. */
function tinyMap(): MapData {
  const empty = {
    buildings: [],
    areas: [],
    rails: [],
    streams: [],
    weirs: [],
    trees: [],
    pines: [],
    lamps: [],
    benches: [],
    crossings: [],
    pois: [],
    shops: [],
    tables: [],
    playgrounds: [],
  };
  const m = {
    meta: {
      source: 't',
      origin: { lat: 0, lon: 0, note: '' },
      bounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
      terrain: { file: 'x', cols: 3, rows: 3, cell: 2, minX: 0, minZ: 0, scale: 0.01, datum: 0 },
    },
    ...empty,
    roads: [{ p: [0, 2, 4, 2], k: 'residential', w: 4, b: 1 }],
    rivers: [{ p: [0, 0, 4, 0], w: 2, wl: [-1, -2] }],
  } as unknown as MapData;
  m.heights = decodeHeights(m, rgba([0, 100, 200, 0, 100, 200, 0, 100, 200]));
  return m;
}

describe('TerrainModel on a heightmap', () => {
  it('decodes negative and positive 16-bit heights exactly', () => {
    const h = decodeHeightPixels(rgba([-32768, -1, 0, 1, 32767]), 5, 1, 0.01, 't');
    expect(Array.from(h, (v) => Math.round(v * 100))).toEqual([-32768, -1, 0, 1, 32767]);
    expect(() => decodeHeightPixels(rgba([0, 1]), 3, 1, 1, 't')).toThrow(/expected 3×1/);
  });

  it('samples the ground bilinearly', () => {
    const t = new TerrainModel(tinyMap());
    expect(t.ground(0, 1)).toBeCloseTo(0);
    expect(t.ground(1, 3)).toBeCloseTo(0.5);
    expect(t.ground(3, 0.5)).toBeCloseTo(1.5);
    expect(t.slope(2, 2)).toBeCloseTo(0.5, 1);
  });

  it('interpolates the river surface along the bed and spans bridges between their ends', () => {
    const t = new TerrainModel(tinyMap());
    expect(t.waterAt(2, 0)).toBeCloseTo(-1.5);
    expect(t.waterAt(2, 3)).toBeNull();
    // Deck from ground 0 (+0.35) at x = 0 to ground 2 (+0.35) at x = 4.
    expect(t.deck(2, 2)).toBeCloseTo(1.35);
    expect(t.heightAt(2, 2)).toBeCloseTo(1.35);
  });

  it('decodes the shipped heightmap: the plaza is the datum, the relief is real', () => {
    const map = parseMap(JSON.parse(readFileSync('public/maps/villarcayo.json', 'utf8')));
    map.heights = decodeHeights(map, readPng(`public/maps/${map.meta.terrain?.file}`).rgba);
    const t = new TerrainModel(map);
    expect(Math.abs(t.ground(0, 0))).toBeLessThan(1);
    let lo = Infinity,
      hi = -Infinity;
    for (let x = map.meta.bounds.minX; x < map.meta.bounds.maxX; x += 50) {
      for (let z = map.meta.bounds.minZ; z < map.meta.bounds.maxZ; z += 50) {
        const h = t.ground(x, z);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    expect(hi - lo).toBeGreaterThan(30);
    // The Río Nela flows downhill across the map.
    const wl = map.rivers[0].wl!;
    expect(Math.abs(wl[0] - wl[wl.length - 1])).toBeGreaterThan(3);
  });
});
