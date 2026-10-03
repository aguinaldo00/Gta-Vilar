import { ConfigError } from '@/core/validate';
import { type GameConfig, type InputConfig, type Quality, SCHEMAS, type VehicleSpec } from './schema';

export type { GameConfig, InputConfig, Quality, VehicleSpec };

/** Every data file the game reads at boot (public/config/*.json). */
export interface Config {
  game: GameConfig;
  input: InputConfig;
  quality: { desktop: Quality; touch: Quality };
  vehicles: Record<string, VehicleSpec>;
}

type Fetcher = (file: string) => Promise<unknown>;

/** Loads and validates all config files. `fetchJson` is injectable for tests and tools. */
export async function loadConfig(fetchJson: Fetcher): Promise<Config> {
  const names = Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[];
  const raw = await Promise.all(names.map((n) => fetchJson(`${n}.json`)));
  const parsed = Object.fromEntries(names.map((n, i) => [n, SCHEMAS[n](raw[i], n)])) as Omit<Config, 'vehicles'> & {
    vehicles: Record<string, Omit<VehicleSpec, 'id'>>;
  };
  const vehicles = Object.fromEntries(Object.entries(parsed.vehicles).map(([id, v]) => [id, { ...v, id }]));
  for (const s of parsed.game.vehicles) {
    if (!vehicles[s.type]) throw new ConfigError(`game.vehicles: unknown vehicle type "${s.type}"`);
  }
  return { ...parsed, vehicles };
}

/** Browser fetcher for files served from public/config/. */
export const fetchFromPublic =
  (base = 'config/'): Fetcher =>
  async (file) => {
    const res = await fetch(`${base}${file}`);
    if (!res.ok) throw new ConfigError(`${file}: HTTP ${res.status}`);
    return res.json();
  };
