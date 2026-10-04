import * as THREE from 'three';

/**
 * Time of day for Villarcayo (42.94 N): sunrise ~7:30, solar noon ~14:00 and
 * sunset ~20:30 in local clock time (CEST), the sun crossing the south. The
 * whole lighting rig (sun or moon, sky, haze, ambient light, street lamps,
 * lit windows, headlights) is driven from these values.
 */
export const SUNRISE = 7.5;
export const SUNSET = 20.5;
const MAX_ELEVATION = THREE.MathUtils.degToRad(52);

/** Night amount shared with shaders (lit windows, lamp glass): 0 day … 1 night. */
export const NIGHT = { value: 0 };

export interface SunState {
  /** Unit vector towards the sun (x east, y up, z south). */
  sun: THREE.Vector3;
  /** Sine of the sun's elevation (negative below the horizon). */
  elevation: number;
  /** 1 in full daylight, 0 at night. */
  day: number;
  /** 1 at sunrise / sunset glow, 0 otherwise. */
  golden: number;
  /** 1 at night (street lamps on), 0 by day. */
  night: number;
  /** Unit vector towards the moon (lights the scene at night). */
  moon: THREE.Vector3;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Sun position and light amounts at a clock time (hours, 0–24). */
export function sunState(hours: number): SunState {
  const h = ((hours % 24) + 24) % 24;
  const dayLen = SUNSET - SUNRISE;
  // Phase 0 at sunrise, π at sunset; through the night it keeps turning, under the north, back to 2π.
  const isDay = h >= SUNRISE && h < SUNSET;
  const nightFrac = ((h < SUNRISE ? h + 24 : h) - SUNSET) / (24 - dayLen);
  const phase = isDay ? ((h - SUNRISE) / dayLen) * Math.PI : Math.PI * (1 + nightFrac);
  const elev = isDay ? Math.sin(phase) * Math.sin(MAX_ELEVATION) : -Math.sin(nightFrac * Math.PI) * 0.6;
  const cosE = Math.sqrt(1 - elev * elev);
  // x = cos(phase): east at sunrise, west at sunset; z = sin(phase): south by day, north under the horizon at night.
  const sun = new THREE.Vector3(Math.cos(phase) * cosE, elev, Math.sin(phase) * cosE).normalize();
  const day = smooth(-0.06, 0.18, elev);
  const golden = smooth(-0.1, 0.02, elev) * (1 - smooth(0.12, 0.32, elev));
  const night = 1 - smooth(-0.12, 0.04, elev);
  // A high moon in the south-west for the night light (no phases).
  const moon = new THREE.Vector3(-0.45, 0.62, 0.5).normalize();
  return { sun, elevation: elev, day, golden, night, moon };
}

/** Linear colour blend helper. */
export function mixColor(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number, out = new THREE.Color()): THREE.Color {
  return out.set(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, t)));
}
