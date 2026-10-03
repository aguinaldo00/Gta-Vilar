import { describe, expect, it } from 'vitest';
import type { Pt } from '@/world/geo';
import { FlatMesh, KERB, sidewalks } from '@/world/Roads';

/** Distance from p to the segment a-b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

describe('sidewalks', () => {
  // A 7 m street along X crossed by a 6 m street along Z.
  const main: Pt[] = [
    [-40, 0],
    [40, 0],
  ];
  const cross: Pt[] = [
    [0, -40],
    [0, 40],
  ];
  const onCrossStreet = (x: number, z: number) => segDist([x, z], cross[0], cross[1]) < 3 - 0.2;
  const m = new FlatMesh(2, 1);
  const kerb = new FlatMesh(1, 1);
  sidewalks(m, kerb, main, 3.5, 2.2, () => 0, onCrossStreet);

  it('run beside the carriageway, never on it', () => {
    for (let i = 0; i < m.pos.length; i += 9) {
      const cx = (m.pos[i] + m.pos[i + 3] + m.pos[i + 6]) / 3,
        cz = (m.pos[i + 2] + m.pos[i + 5] + m.pos[i + 8]) / 3;
      // Outside its own carriageway (|z| > 3.5) and out of the crossing street.
      expect(Math.abs(cz)).toBeGreaterThan(3.5 - 1e-6);
      expect(Math.abs(cz)).toBeLessThan(3.5 + 2.2 + 1e-6);
      expect(onCrossStreet(cx, cz)).toBe(false);
    }
  });

  it('stand a kerb above the road with a face along the edge', () => {
    const ys = m.pos.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(KERB, 6);
    const kys = kerb.pos.filter((_, i) => i % 3 === 1);
    expect(Math.min(...kys)).toBeCloseTo(0, 6);
    expect(Math.max(...kys)).toBeCloseTo(KERB, 6);
  });
});
