import { Howl, Howler } from 'howler';

/** Mixer channels, each with its own volume in Ajustes. */
export type Channel = 'music' | 'ambience' | 'sfx' | 'voices' | 'radio';

export interface Settings {
  master: number;
  music: number;
  ambience: number;
  sfx: number;
  voices: number;
  radio: number;
  /** Mouse look sensitivity multiplier. */
  sensitivity: number;
  /** Real minutes per game day. */
  dayMinutes: number;
}

const DEFAULTS: Settings = { master: 0.9, music: 0.7, ambience: 0.8, sfx: 0.9, voices: 0.9, radio: 0.85, sensitivity: 1, dayMinutes: 24 };
const KEY = 'villarcayo.settings';

/**
 * Sound settings and the shared Howler setup. Every sound the game loads from
 * a file goes through `AudioMix.howl`, so the channel volumes and the master
 * apply to it, and a missing file (the placeholders in
 * public/config/audio.json before the real recordings are added) only logs
 * once instead of breaking anything.
 */
export class AudioMix {
  static settings: Settings = AudioMix.load();
  private static readonly sounds = new Map<Channel, Set<{ howl: Howl; base: number }>>();
  private static readonly missing = new Set<string>();
  private static readonly listeners: (() => void)[] = [];

  private static load(): Settings {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  }

  static save(patch: Partial<Settings>): void {
    AudioMix.settings = { ...AudioMix.settings, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(AudioMix.settings));
    } catch {
      // Not kept this time.
    }
    Howler.volume(AudioMix.settings.master);
    for (const [ch, set] of AudioMix.sounds) for (const s of set) s.howl.volume(s.base * AudioMix.settings[ch]);
    for (const l of AudioMix.listeners) l();
  }

  static onChange(fn: () => void): void {
    AudioMix.listeners.push(fn);
  }

  /** Volume a channel should play at (0–1), master included. */
  static level(ch: Channel): number {
    return AudioMix.settings.master * AudioMix.settings[ch];
  }

  /**
   * A Howler sound on a channel. `volume` is the sound's own level (before
   * the channel and master). Missing files resolve silently.
   */
  static howl(src: string | string[], ch: Channel, opts: { loop?: boolean; volume?: number; html5?: boolean } = {}): Howl {
    const base = opts.volume ?? 1;
    const howl = new Howl({
      src: Array.isArray(src) ? src : [src],
      loop: opts.loop ?? false,
      volume: base * AudioMix.settings[ch],
      html5: opts.html5 ?? false,
      preload: true,
      onloaderror: () => {
        const key = String(src);
        if (!AudioMix.missing.has(key)) {
          AudioMix.missing.add(key);
          console.info(`[audio] placeholder not found yet: ${key}`);
        }
      },
    });
    const set = AudioMix.sounds.get(ch) ?? AudioMix.sounds.set(ch, new Set()).get(ch)!;
    set.add({ howl, base });
    return howl;
  }

  /** Unlocks the browser's audio (call from a click). */
  static unlock(): void {
    Howler.volume(AudioMix.settings.master);
    const ctx = Howler.ctx;
    if (ctx && ctx.state !== 'running') void ctx.resume();
  }
}
