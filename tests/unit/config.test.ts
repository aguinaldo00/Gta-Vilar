import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@/config/Config';
import { ConfigError } from '@/core/validate';

const fromDisk = (file: string) => Promise.resolve(JSON.parse(readFileSync(`public/config/${file}`, 'utf8')));

describe('config', () => {
  it('loads and validates every shipped data file', async () => {
    const c = await loadConfig(fromDisk);
    expect(c.vehicles.sedan.id).toBe('sedan');
    expect(c.game.vehicles.length).toBeGreaterThan(0);
    expect(c.input.bindings.use).toContain('KeyF');
  });

  it('rejects typos and out-of-range values with the offending path', async () => {
    const broken = async (file: string) => {
      const d = await fromDisk(file);
      if (file === 'vehicles.json') d.sedan.maxSpeedd = 1;
      return d;
    };
    await expect(loadConfig(broken)).rejects.toThrow(/vehicles\.sedan\.maxSpeedd: unknown key/);
    const negative = async (file: string) => {
      const d = await fromDisk(file);
      if (file === 'vehicles.json') d.van.mass = -5;
      return d;
    };
    await expect(loadConfig(negative)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects spawns of unknown vehicle types', async () => {
    const bad = async (file: string) => {
      const d = await fromDisk(file);
      if (file === 'game.json') d.vehicles[0].type = 'bus';
      return d;
    };
    await expect(loadConfig(bad)).rejects.toThrow(/unknown vehicle type "bus"/);
  });
});
