import { describe, expect, it } from 'vitest';
import { compass, reportText, utmToLatLon } from '@/ui/PositionReport';

describe('position report (P)', () => {
  it('turns UTM 30N into the latitude / longitude of the map origin (Plaza Mayor)', () => {
    const [lat, lon] = utmToLatLon(453356, 4754203);
    // public/maps/villarcayo.json meta.origin
    expect(lat).toBeCloseTo(42.93903632, 5);
    expect(lon).toBeCloseTo(-3.57169402, 5);
  });

  it('names the compass point (x east, z south)', () => {
    expect(compass(0, -1)).toBe('N');
    expect(compass(1, 0)).toBe('E');
    expect(compass(0, 1)).toBe('S');
    expect(compass(-1, -1)).toBe('NO');
  });

  it('writes the place, view, mode, zone, time and a map link', () => {
    const t = reportText({
      x: 52.2,
      z: -277.7,
      lookX: 1,
      lookZ: -1,
      vehicle: null,
      zone: 'Polideportivo',
      hours: 12.5,
      weather: 'Despejado',
      origin: { E: 453356, N: 4754203 },
    });
    expect(t).toContain('x=52.2 z=-277.7 mirando NE');
    expect(t).toContain('a pie · Polideportivo · 12:30');
    expect(t).toContain('UTM 30N 453408 4754481');
    expect(t).toMatch(/google\.com\/maps\?q=42\.94\d+,-3\.57\d+/);
  });
});
