import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Mesh3 } from '@/world/Buildings';
import type { Pt } from '@/world/geo';
import { parseMap } from '@/world/mapData';
import { cleanRing, hipRoof, skeletonFaces } from '@/world/Roofs';

const area = (p: Pt[]) => Math.abs(p.reduce((s, [x, z], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * z, 0) / 2);
/** Sum of the triangle areas projected on the ground. */
function planArea(m: Mesh3): number {
  let s = 0;
  for (let i = 0; i < m.pos.length; i += 9) {
    const [ax, , az, bx, , bz, cx, , cz] = m.pos.slice(i, i + 9);
    s += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  }
  return s;
}

describe('roofs', () => {
  const square: Pt[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it('cleans duplicate, collinear and spike vertices', () => {
    const r: Pt[] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 0.05],
      [10, 10],
      [0, 10],
    ];
    expect(cleanRing(r, 0.25, 0.02)).toHaveLength(4);
  });

  it('the straight skeleton of an outline tiles it exactly', () => {
    const faces = skeletonFaces(square)!;
    expect(faces).toHaveLength(4);
    expect(faces.reduce((s, f) => s + area(f.poly), 0)).toBeCloseTo(100, 3);
    // An L-shaped house and a courtyard block work too.
    const L: Pt[] = [
      [0, 0],
      [12, 0],
      [12, 5],
      [5, 5],
      [5, 12],
      [0, 12],
    ];
    expect(skeletonFaces(L)!.reduce((s, f) => s + area(f.poly), 0)).toBeCloseTo(area(L), 2);
    const yard: Pt[] = [
      [3, 3],
      [3, 7],
      [7, 7],
      [7, 3],
    ];
    expect(skeletonFaces(square, [yard])!.reduce((s, f) => s + area(f.poly), 0)).toBeCloseTo(84, 2);
  });

  it('hip roof rises with the slope and is cut flat at the measured ridge', () => {
    const tiles = new Mesh3(),
      flat = new Mesh3();
    // Slope 0.5, ridge 1.5 m above the eaves at y = 10: the faces stop 3 m in, the 4x4 m centre is flat.
    hipRoof(tiles, flat, skeletonFaces(square)!, 10, 0.5, 1.5, new THREE.Color(1, 0, 0));
    const ys = [...tiles.pos.filter((_, i) => i % 3 === 1), ...flat.pos.filter((_, i) => i % 3 === 1)];
    expect(Math.min(...ys)).toBeCloseTo(10, 5);
    expect(Math.max(...ys)).toBeCloseTo(11.5, 5);
    expect(planArea(flat)).toBeCloseTo(16, 3);
    expect(planArea(tiles) + planArea(flat)).toBeCloseTo(100, 3);
  });

  it('the shipped roofs reference valid footprints and have sane shapes', () => {
    const m = parseMap(JSON.parse(readFileSync('public/maps/villarcayo.json', 'utf8')));
    const roofs = m.roofs ?? [];
    expect(roofs.length).toBeGreaterThan(1000);
    for (const b of m.buildings) if (b.rf !== undefined) expect(b.rf).toBeLessThan(roofs.length);
    for (const r of roofs) {
      expect(r.s).toBeGreaterThanOrEqual(0);
      expect(r.s).toBeLessThanOrEqual(1.2);
      expect(r.r).toBeLessThanOrEqual(8);
    }
    // Nearly every outline yields a skeleton (the rest fall back to a flat roof).
    const pitched = roofs.filter((r) => r.s > 0);
    let ok = 0;
    for (const r of pitched) {
      const o: Pt[] = [];
      for (let i = 0; i < r.o.length; i += 2) o.push([r.o[i], r.o[i + 1]]);
      if (skeletonFaces(o)) ok++;
    }
    expect(ok / pitched.length).toBeGreaterThan(0.97);
  });
});
