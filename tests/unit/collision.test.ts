import { describe, expect, it } from 'vitest';
import { CollisionWorld, Layer } from '@/physics/CollisionWorld';

describe('CollisionWorld', () => {
  it('pushes a circle out of a box wall', () => {
    const w = new CollisionWorld();
    w.addBox(0, 0, 2, 2, { top: 3 });
    const r = w.resolveCircle(0.9, 0, 0.5, Layer.Player, 0, 1.8, 0.4);
    expect(r.x).toBeGreaterThanOrEqual(1.5 - 1e-6);
    expect(r.z).toBeCloseTo(0);
  });

  it('ignores colliders on other layers and low steps', () => {
    const w = new CollisionWorld();
    w.addBox(0, 0, 2, 2, { top: 3, mask: Layer.Vehicle });
    w.addBox(5, 0, 2, 2, { top: 0.2 });
    expect(w.resolveCircle(0.9, 0, 0.5, Layer.Player, 0, 1.8, 0.4).x).toBeCloseTo(0.9);
    expect(w.resolveCircle(5, 0, 0.5, Layer.Player, 0, 1.8, 0.4).x).toBeCloseTo(5);
  });

  it('respects rotated boxes', () => {
    const w = new CollisionWorld();
    w.addBox(0, 0, 10, 1, { top: 3, rot: Math.PI / 2 });
    // Rotated 90°: the box now spans z ∈ [-5, 5], x ∈ [-0.5, 0.5].
    const r = w.resolveCircle(0, 3, 0.3, Layer.Player, 0, 1.8, 0.4);
    expect(Math.abs(r.x)).toBeGreaterThanOrEqual(0.8 - 1e-6);
  });
});
