import { describe, expect, it } from 'vitest';
import { centroid, orientedBox, type Pt, pointInRing, signedArea, triangulate } from '@/world/geo';

const square: Pt[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('geo', () => {
  it('measures signed area', () => {
    expect(Math.abs(signedArea(square))).toBeCloseTo(100);
    expect(signedArea([...square].reverse())).toBeCloseTo(-signedArea(square));
  });

  it('finds the centroid', () => {
    expect(centroid(square)).toEqual([5, 5]);
  });

  it('tests point in ring', () => {
    expect(pointInRing(5, 5, square)).toBe(true);
    expect(pointInRing(15, 5, square)).toBe(false);
  });

  it('fits the minimum oriented box of a rotated rectangle', () => {
    const a = Math.PI / 6;
    const rot = ([x, z]: Pt): Pt => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
    const rect = (
      [
        [-4, -1],
        [4, -1],
        [4, 1],
        [-4, 1],
      ] as Pt[]
    ).map(rot);
    const o = orientedBox(rect);
    expect(o.w * o.d).toBeCloseTo(16, 5);
    expect(Math.max(o.w, o.d)).toBeCloseTo(8, 5);
    expect(o.cx).toBeCloseTo(0, 5);
    expect(o.cz).toBeCloseTo(0, 5);
  });

  it('triangulates a polygon with a hole', () => {
    const hole: Pt[] = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ];
    const tris = triangulate(square, [hole]);
    const area = tris.reduce((s, t) => s + Math.abs(signedArea(t)), 0);
    expect(area).toBeCloseTo(96);
  });
});
