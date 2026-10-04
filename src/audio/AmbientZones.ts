import type { Howl } from 'howler';
import { AudioMix } from './AudioMix';

export interface LayerConf {
  src: string;
  volume?: number;
}

export interface StingerConf extends LayerConf {
  /** Seconds between plays: [min, max]. */
  every: [number, number];
}

export type ZoneShape =
  | { type: 'circle'; x: number; z: number; r: number }
  /** Within d metres of the Río Nela. */
  | { type: 'river'; d: number }
  /** Farther than r metres from the Plaza Mayor. */
  | { type: 'outskirts'; r: number };

export interface ZoneConf {
  id: string;
  name: string;
  shape: ZoneShape;
  priority?: number;
  /** Crossfade seconds in and out. */
  fade?: number;
  loop?: LayerConf;
  /** Replaces the loop at night. */
  night?: LayerConf;
  music?: LayerConf;
  stingers?: StingerConf[];
}

/** What the zones need to know about the world. */
export interface ZoneWorld {
  riverDistance(x: number, z: number): number;
}

/** Edge falloff of a zone (m): its weight goes from 0 at the border to 1 this far inside. */
const EDGE = 18;

interface Live {
  conf: ZoneConf;
  loop: Howl | null;
  night: Howl | null;
  music: Howl | null;
  stingers: { conf: StingerConf; howl: Howl; next: number }[];
  /** Current mix weight 0–1 (eased towards the target with the zone's fade). */
  weight: number;
}

/**
 * Ambient sound zones in the style of Red Dead Redemption 2: invisible areas
 * from public/config/audio.json (Plaza Mayor, Río Nela, the bar street, the
 * outskirts). Each has a loop (a night variant), a music layer and stingers;
 * walking in or out crossfades them, softly towards the edges. Where zones
 * overlap the highest priority one leads and the others duck under it.
 * Sounds are created on first use, so a zone you never visit loads nothing.
 */
export class AmbientZones {
  private readonly live: Live[];
  private time = 0;

  constructor(
    zones: ZoneConf[],
    private readonly world: ZoneWorld,
  ) {
    this.live = zones.map((conf) => ({ conf, loop: null, night: null, music: null, stingers: [], weight: 0 }));
  }

  /** How much (0–1) a point is inside a zone, soft at the edges. */
  inside(shape: ZoneShape, x: number, z: number): number {
    const soft = (d: number) => Math.min(1, Math.max(0, d / EDGE));
    switch (shape.type) {
      case 'circle':
        return soft(shape.r - Math.hypot(x - shape.x, z - shape.z));
      case 'river':
        return soft(shape.d - this.world.riverDistance(x, z));
      case 'outskirts':
        return soft(Math.hypot(x, z) - shape.r);
    }
  }

  private ensure(l: Live): void {
    if (l.loop || l.music || l.stingers.length) return;
    const c = l.conf;
    if (c.loop) l.loop = AudioMix.howl(c.loop.src, 'ambience', { loop: true, volume: 0 });
    if (c.night) l.night = AudioMix.howl(c.night.src, 'ambience', { loop: true, volume: 0 });
    if (c.music) l.music = AudioMix.howl(c.music.src, 'music', { loop: true, volume: 0 });
    l.stingers = (c.stingers ?? []).map((s) => ({
      conf: s,
      howl: AudioMix.howl(s.src, 'ambience', { volume: s.volume ?? 1 }),
      next: this.time + rand(s.every),
    }));
  }

  /** The zone the listener is in (highest priority with any presence), for the HUD or debugging. */
  current: ZoneConf | null = null;

  /**
   * Call every frame with the listener's position (the camera), the night
   * amount 0–1 and an overall gain (0 while the menu is up, ducked by the
   * radio in a car).
   */
  update(dt: number, x: number, z: number, night: number, gain: number): void {
    this.time += dt;
    const targets = this.live.map((l) => this.inside(l.conf.shape, x, z));
    // The strongest zone of the highest priority leads; lower priority zones duck under it.
    let lead = -1;
    targets.forEach((t, i) => {
      if (t <= 0) return;
      if (lead < 0 || (this.live[i].conf.priority ?? 0) > (this.live[lead].conf.priority ?? 0)) lead = i;
    });
    this.current = lead >= 0 ? this.live[lead].conf : null;
    const leadP = lead >= 0 ? (this.live[lead].conf.priority ?? 0) : 0;
    const leadT = lead >= 0 ? targets[lead] : 0;
    this.live.forEach((l, i) => {
      let target = targets[i];
      if (i !== lead && (l.conf.priority ?? 0) < leadP) target *= 1 - leadT * 0.85;
      const fade = Math.max(0.1, l.conf.fade ?? 2.5);
      const step = dt / fade;
      l.weight += Math.max(-step, Math.min(step, target - l.weight));
      if (l.weight <= 0.001 && !l.loop && !l.music) return;
      if (l.weight > 0.001) this.ensure(l);
      const w = l.weight * gain;
      const c = l.conf;
      const nightMix = c.night ? night : 0;
      this.set(l.loop, (c.loop?.volume ?? 1) * w * (1 - nightMix), 'ambience');
      this.set(l.night, (c.night?.volume ?? 1) * w * nightMix, 'ambience');
      this.set(l.music, (c.music?.volume ?? 1) * w, 'music');
      for (const s of l.stingers) {
        if (this.time < s.next) continue;
        s.next = this.time + rand(s.conf.every);
        if (w > 0.3) {
          s.howl.volume((s.conf.volume ?? 1) * w * AudioMix.settings.ambience);
          s.howl.play();
        }
      }
    });
  }

  /** Volume of a looping layer: plays while audible, pauses when silent (no wasted decoding). */
  private set(h: Howl | null, v: number, ch: 'ambience' | 'music'): void {
    if (!h) return;
    const vol = v * AudioMix.settings[ch];
    if (vol > 0.002) {
      if (!h.playing()) h.play();
      h.volume(vol);
    } else if (h.playing()) h.pause();
  }
}

const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);
