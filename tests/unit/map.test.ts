import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMap } from '@/world/mapData';

describe('map data', () => {
  const raw = JSON.parse(readFileSync('public/maps/villarcayo.json', 'utf8'));

  it('the shipped map passes validation', () => {
    const m = parseMap(raw);
    expect(m.buildings.length).toBeGreaterThan(1000);
    expect(m.roads.length).toBeGreaterThan(100);
  });

  it('every coordinate lies inside the bounds', () => {
    const { minX, maxX, minZ, maxZ } = parseMap(raw).meta.bounds;
    for (const b of raw.buildings) {
      for (let i = 0; i < b.o.length; i += 2) {
        expect(b.o[i]).toBeGreaterThanOrEqual(minX - 1);
        expect(b.o[i]).toBeLessThanOrEqual(maxX + 1);
        expect(b.o[i + 1]).toBeGreaterThanOrEqual(minZ - 1);
        expect(b.o[i + 1]).toBeLessThanOrEqual(maxZ + 1);
      }
    }
  });

  it('rejects a truncated file', () => {
    const { roads: _roads, ...rest } = raw;
    expect(() => parseMap(rest, 'bad.json')).toThrow(/bad\.json: "roads"/);
  });
});
