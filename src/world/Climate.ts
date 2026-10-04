import type * as THREE from 'three';
import { NIGHT, type SunState } from './DayNight';
import type { Environment } from './Environment';

export type Weather = 'despejado' | 'nublado' | 'lluvia' | 'lluvia_fuerte' | 'niebla';
export const WEATHERS: Weather[] = ['despejado', 'nublado', 'lluvia', 'lluvia_fuerte', 'niebla'];
export const WEATHER_LABEL: Record<Weather, string> = {
  despejado: 'Despejado',
  nublado: 'Nublado',
  lluvia: 'Lluvia',
  lluvia_fuerte: 'Lluvia fuerte',
  niebla: 'Niebla',
};

/** What each weather does to the scene (blended over a transition). */
export interface WeatherParams {
  /** Cloud cover 0–1 (dims the sun and greys the sky). */
  cloud: number;
  /** Rain intensity 0–1 (drops, sound, wet ground). */
  rain: number;
  /** Extra fog 0–1 (visibility down to a few tens of metres at 1). */
  fog: number;
  /** Thunderstorms (lightning and thunder). */
  storm: number;
}

const PARAMS: Record<Weather, WeatherParams> = {
  despejado: { cloud: 0.15, rain: 0, fog: 0, storm: 0 },
  nublado: { cloud: 0.75, rain: 0, fog: 0.08, storm: 0 },
  lluvia: { cloud: 0.88, rain: 0.45, fog: 0.15, storm: 0 },
  lluvia_fuerte: { cloud: 1, rain: 1, fog: 0.28, storm: 1 },
  niebla: { cloud: 0.6, rain: 0, fog: 1, storm: 0 },
};

/** Likely next weather (a simple Markov chain: weather in the valley changes gradually). */
const NEXT: Record<Weather, [Weather, number][]> = {
  despejado: [
    ['despejado', 3],
    ['nublado', 3],
    ['niebla', 1],
  ],
  nublado: [
    ['despejado', 3],
    ['nublado', 1],
    ['lluvia', 3],
    ['niebla', 1],
  ],
  lluvia: [
    ['nublado', 3],
    ['lluvia', 1],
    ['lluvia_fuerte', 2],
  ],
  lluvia_fuerte: [
    ['lluvia', 3],
    ['nublado', 1],
  ],
  niebla: [
    ['despejado', 2],
    ['nublado', 2],
  ],
};

export interface ClimateOptions {
  /** Real minutes per game day (20–30 is a good pace). */
  dayMinutes: number;
  /** Start time (hours) and weather. */
  hours: number;
  weather: Weather;
  /** Let the weather change by itself. */
  dynamic: boolean;
}

/**
 * Time of day and weather in one place, for every system to read:
 * `climate.hours`, `climate.weather`, `climate.night` (0 day … 1 night),
 * `climate.lightsOn` (street lamps and windows: also on under a dark storm),
 * `climate.params` (cloud, rain, fog, storm, blended) and `climate.wetness`
 * (ground drying slowly after the rain). It drives the Environment's sun,
 * sky, fog and ambient light; the rain, the wet ground and the sounds read it.
 *
 * Debug: `__game.climate.setTime(21.5)`, `__game.climate.setWeather('niebla')`,
 * keys T (one hour on) and Y (next weather), or `?hora=21&clima=lluvia` in the URL.
 */
export class ClimateSystem {
  hours: number;
  dayMinutes: number;
  dynamic: boolean;
  weather: Weather;
  /** Blended weather parameters (what the scene shows right now). */
  readonly params: WeatherParams;
  /** Ground wetness 0–1. */
  wetness = 0;
  sun!: SunState;
  /** Lightning flash 0–1 (decays fast). */
  flash = 0;
  private from: WeatherParams;
  private blend = 1;
  /** Seconds a weather change takes to settle. */
  private readonly transition = 25;
  private nextChange: number;
  private lightningIn = 8;
  private readonly listeners: ((w: Weather) => void)[] = [];
  /** Thunder after a flash (seconds of delay), consumed by the weather sounds. */
  thunderIn = -1;

  constructor(
    private readonly env: Environment,
    o: ClimateOptions,
  ) {
    this.hours = o.hours;
    this.dayMinutes = o.dayMinutes;
    this.dynamic = o.dynamic;
    this.weather = o.weather;
    this.params = { ...PARAMS[o.weather] };
    this.from = { ...this.params };
    this.wetness = this.params.rain > 0 ? 0.8 : 0;
    this.nextChange = this.gameHoursUntilChange();
    this.sun = env.setTime(this.hours);
  }

  get night(): number {
    return this.sun.night;
  }

  /** Street lamps and lit windows: night, or a very dark sky (heavy rain, thick fog) by day. */
  get lightsOn(): number {
    return Math.min(
      1,
      Math.max(
        this.sun.night,
        (this.params.cloud * 0.5 + this.params.rain * 0.3 + this.params.fog * 0.3) * (1 - this.sun.day * 0.35) - 0.15,
      ),
    );
  }

  onWeather(fn: (w: Weather) => void): void {
    this.listeners.push(fn);
  }

  setTime(h: number): void {
    this.hours = ((h % 24) + 24) % 24;
  }

  /** Change the weather (over the transition time, or at once). */
  setWeather(w: Weather, immediate = false): void {
    if (!PARAMS[w]) return;
    this.from = { ...this.params };
    this.weather = w;
    this.blend = immediate ? 1 : 0;
    if (immediate) Object.assign(this.params, PARAMS[w]);
    if (immediate) this.wetness = PARAMS[w].rain > 0 ? 0.85 : this.wetness;
    this.nextChange = this.gameHoursUntilChange();
    for (const l of this.listeners) l(w);
  }

  cycleWeather(): Weather {
    const w = WEATHERS[(WEATHERS.indexOf(this.weather) + 1) % WEATHERS.length];
    this.setWeather(w);
    return w;
  }

  private gameHoursUntilChange(): number {
    return 3 + Math.random() * 6;
  }

  private pickNext(): Weather {
    const opts = NEXT[this.weather];
    let r = Math.random() * opts.reduce((a, [, w]) => a + w, 0);
    for (const [k, w] of opts) if ((r -= w) <= 0) return k;
    return opts[0][0];
  }

  update(dt: number, _camera?: THREE.Vector3): void {
    // A game day lasts dayMinutes real minutes.
    const gameHours = (dt * 24) / (this.dayMinutes * 60);
    this.hours = (this.hours + gameHours) % 24;
    if (this.dynamic) {
      this.nextChange -= gameHours;
      if (this.nextChange <= 0) this.setWeather(this.pickNext());
    }
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.transition);
      const t = this.blend * this.blend * (3 - 2 * this.blend);
      const to = PARAMS[this.weather];
      for (const k of Object.keys(to) as (keyof WeatherParams)[]) this.params[k] = this.from[k] + (to[k] - this.from[k]) * t;
    }
    // Wet while it rains; dries over a few game hours (faster in the sun).
    if (this.params.rain > 0.05) this.wetness = Math.min(1, this.wetness + dt * this.params.rain * 0.08);
    else this.wetness = Math.max(0, this.wetness - gameHours * (0.25 + this.sun.day * 0.35));
    // Lightning in a storm.
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.params.storm > 0.5) {
      this.lightningIn -= dt;
      if (this.lightningIn <= 0) {
        this.flash = 1;
        this.thunderIn = 0.6 + Math.random() * 2.5;
        this.lightningIn = 7 + Math.random() * 18;
      }
    }
    this.sun = this.env.setTime(this.hours);
    this.env.applyWeather(this.params, this.flash);
    NIGHT.value = this.lightsOn;
  }
}
