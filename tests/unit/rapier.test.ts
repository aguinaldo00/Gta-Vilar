import { beforeAll, describe, expect, it } from 'vitest';
import { Layer } from '@/physics/PhysicsWorld';
import { initRapier, RapierPhysics } from '@/physics/RapierPhysics';

beforeAll(async () => {
  await initRapier();
});

/** Flat ground at y = 0 over [-50, 50]² plus whatever the test adds. */
function world(): RapierPhysics {
  const p = new RapierPhysics();
  const n = 11;
  p.setTerrain({ minX: -50, minZ: -50, cellSize: 10, cols: n, rows: n, heights: new Float32Array(n * n) });
  return p;
}

describe('RapierPhysics', () => {
  it('orients the terrain heightfield like the height grid (row = z, column = x)', () => {
    const p = new RapierPhysics();
    const cols = 5,
      rows = 3;
    const heights = new Float32Array(cols * rows);
    // Height = x index * 2, independent of z.
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights[r * cols + c] = c * 2;
    p.setTerrain({ minX: 100, minZ: -20, cellSize: 10, cols, rows, heights });
    const t = p.raycast(130, 50, -5, 0, -1, 0, 100, Layer.Player);
    expect(50 - t).toBeCloseTo(6, 3); // column 3 → height 6
  });

  it('raycasts against boxes and respects layer masks', () => {
    const p = world();
    p.addBox(0, 0, 2, 2, { bottom: 0, top: 3, mask: Layer.Player });
    expect(p.raycast(0, 10, 0, 0, -1, 0, 20, Layer.Player)).toBeCloseTo(7, 3);
    expect(p.raycast(0, 10, 0, 0, -1, 0, 20, Layer.Camera)).toBeCloseTo(10, 3); // falls through to the ground
  });

  it('character walks, is stopped by a wall and climbs a kerb', () => {
    const p = world();
    p.addBox(5, 0, 1, 10, { bottom: 0, top: 3 }); // wall at x = 4.5..5.5
    p.addBox(-5, 0, 2, 10, { bottom: 0, top: 0.25 }); // kerb at x = -6..-4
    const c = p.createCharacter({ radius: 0.35, height: 1.8, maxStep: 0.45, maxSlopeDeg: 45, mask: Layer.Player });
    c.teleport(0, 0, 0);
    p.step(1 / 60);
    for (let i = 0; i < 120; i++) {
      c.move(0.1, -0.05, 0);
      p.step(1 / 60);
    }
    expect(c.x).toBeLessThan(4.5 - 0.3);
    expect(c.x).toBeGreaterThan(3.5);
    while (c.x > -5) {
      c.move(-0.1, -0.05, 0);
      p.step(1 / 60);
    }
    // On top of the kerb (plus the controller's 2 cm skin).
    expect(c.y).toBeGreaterThan(0.24);
    expect(c.y).toBeLessThan(0.3);
  });

  it('reports blocked exit points', () => {
    const p = world();
    p.addBox(0, 0, 2, 2, { bottom: 0, top: 3 });
    expect(p.capsuleBlocked(0, 0, 0, 0.35, 1.8, Layer.Player)).toBe(true);
    expect(p.capsuleBlocked(5, 0, 0, 0.35, 1.8, Layer.Player)).toBe(false);
  });
});
