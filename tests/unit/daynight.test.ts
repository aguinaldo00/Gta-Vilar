import { describe, expect, it } from 'vitest';
import { sunState } from '@/world/DayNight';

describe('time of day', () => {
  it('the sun rises in the east, crosses the south at solar noon and sets in the west', () => {
    expect(sunState(7.6).sun.x).toBeGreaterThan(0.9);
    const noon = sunState(14).sun;
    expect(noon.z).toBeGreaterThan(0.5);
    expect(noon.y).toBeGreaterThan(0.7);
    expect(sunState(20.4).sun.x).toBeLessThan(-0.9);
  });

  it('day, golden hour and night amounts', () => {
    expect(sunState(13).day).toBe(1);
    expect(sunState(13).night).toBe(0);
    expect(sunState(20.3).golden).toBeGreaterThan(0.3);
    expect(sunState(2).night).toBe(1);
    expect(sunState(2).sun.y).toBeLessThan(0);
  });

  it('is continuous across midnight', () => {
    const a = sunState(23.999).sun,
      b = sunState(0.001).sun;
    expect(a.distanceTo(b)).toBeLessThan(0.01);
  });
});
