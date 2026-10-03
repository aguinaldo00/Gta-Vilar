import { describe, expect, it } from 'vitest';
import { clamp, damp, Rng, wrapAngle } from '@/core/math';

describe('math', () => {
  it('clamps', () => expect(clamp(5, 0, 1)).toBe(1));
  it('damps towards the target, frame-rate independent', () => {
    const one = damp(0, 10, 4, 0.1);
    const two = damp(damp(0, 10, 4, 0.05), 10, 4, 0.05);
    expect(one).toBeCloseTo(two, 6);
  });
  it('wraps angles into [-π, π]', () => {
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI);
    expect(wrapAngle(Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(wrapAngle(2 * Math.PI))).toBeCloseTo(0);
  });
  it('seeded rng is deterministic', () => {
    const a = new Rng(42),
      b = new Rng(42);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });
});
