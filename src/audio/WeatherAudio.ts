import type { Howl } from 'howler';
import type { ClimateSystem } from '../world/Climate';
import type { LayerConf } from './AmbientZones';
import { AudioMix } from './AudioMix';

export interface WeatherAudioConf {
  rainLight?: LayerConf;
  rainHeavy?: LayerConf;
  wind?: LayerConf;
  thunder?: string[];
}

/**
 * Rain and wind loops whose volume follows the climate (light rain fading
 * into heavy rain), and thunder a moment after each lightning flash. File
 * paths come from public/config/audio.json (placeholders until the real
 * recordings are added).
 */
export class WeatherAudio {
  private light: Howl | null = null;
  private heavy: Howl | null = null;
  private wind: Howl | null = null;
  private thunder: Howl[] = [];

  constructor(private readonly conf: WeatherAudioConf) {}

  private ensure(): void {
    if (this.light || this.heavy || this.wind) return;
    const c = this.conf;
    if (c.rainLight) this.light = AudioMix.howl(c.rainLight.src, 'ambience', { loop: true, volume: 0 });
    if (c.rainHeavy) this.heavy = AudioMix.howl(c.rainHeavy.src, 'ambience', { loop: true, volume: 0 });
    if (c.wind) this.wind = AudioMix.howl(c.wind.src, 'ambience', { loop: true, volume: 0 });
    this.thunder = (c.thunder ?? []).map((src) => AudioMix.howl(src, 'ambience', { volume: 1 }));
  }

  /** `inCar` muffles the rain (it drums on the roof instead). */
  update(dt: number, climate: ClimateSystem, gain: number, inCar: boolean): void {
    const { rain, cloud, storm } = climate.params;
    if (rain < 0.01 && cloud < 0.6 && !this.light) return;
    this.ensure();
    const lvl = AudioMix.settings.ambience * gain * (inCar ? 0.55 : 1);
    const heavyMix = Math.max(0, Math.min(1, (rain - 0.45) / 0.45));
    this.set(this.light, (this.conf.rainLight?.volume ?? 1) * Math.min(1, rain * 2) * (1 - heavyMix) * lvl);
    this.set(this.heavy, (this.conf.rainHeavy?.volume ?? 1) * heavyMix * lvl);
    this.set(this.wind, (this.conf.wind?.volume ?? 1) * Math.max(storm, cloud * 0.4) * lvl);
    if (climate.thunderIn >= 0) {
      climate.thunderIn -= dt;
      if (climate.thunderIn < 0 && this.thunder.length) {
        const t = this.thunder[Math.floor(Math.random() * this.thunder.length)];
        t.volume(lvl * (0.6 + Math.random() * 0.4));
        t.play();
      }
    }
  }

  private set(h: Howl | null, v: number): void {
    if (!h) return;
    if (v > 0.003) {
      if (!h.playing()) h.play();
      h.volume(v);
    } else if (h.playing()) h.pause();
  }
}
