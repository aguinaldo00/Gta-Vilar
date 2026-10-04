import type { Vehicle } from '../entities/Vehicle';
import { AudioMix } from './AudioMix';

/** Tiny synthesized engine + tyre screech, built from WebAudio oscillators and noise. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engine!: OscillatorNode;
  private engineSub!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;

  /** Must be called from a user gesture (browser autoplay policy). */
  init(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = (this.ctx = new Ctor());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5 * AudioMix.level('sfx');
    AudioMix.onChange(() => {
      if (!this.muted) this.master.gain.value = 0.5 * AudioMix.level('sfx');
    });
    this.master.connect(ctx.destination);

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engine = ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engine.connect(this.engineFilter);
    this.engineSub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engine.start();
    this.engineSub.start();

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = noise;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 2;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    src.connect(band).connect(this.skidGain).connect(this.master);
    src.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5 * AudioMix.level('sfx'), this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /**
   * One footstep on a surface: a short filtered noise burst shaped like the
   * real thing (a dull thud on asphalt, a sharper tap on paving stones, a soft
   * swish in grass, a crunch on gravel, a splash in water).
   */
  footstep(surface: string, running: boolean): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const P: Record<string, { f: number; q: number; type: BiquadFilterType; dur: number; gain: number; grains: number; thud: number }> = {
      asphalt: { f: 900, q: 0.9, type: 'bandpass', dur: 0.07, gain: 0.32, grains: 1, thud: 0.35 },
      pavement: { f: 2300, q: 1.6, type: 'bandpass', dur: 0.05, gain: 0.3, grains: 1, thud: 0.25 },
      grass: { f: 3200, q: 0.5, type: 'highpass', dur: 0.16, gain: 0.12, grains: 3, thud: 0.1 },
      gravel: { f: 2800, q: 0.7, type: 'bandpass', dur: 0.12, gain: 0.22, grains: 5, thud: 0.15 },
      water: { f: 1200, q: 0.4, type: 'lowpass', dur: 0.22, gain: 0.25, grains: 2, thud: 0 },
    };
    const p = P[surface] ?? P.pavement;
    const loud = running ? 1.35 : 1;
    const pitch = 0.85 + Math.random() * 0.3;
    for (let g = 0; g < p.grains; g++) {
      const t0 = t + g * (p.dur / (p.grains + 1)) * Math.random();
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = p.type;
      f.frequency.value = p.f * pitch;
      f.Q.value = p.q;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0, t0);
      gn.gain.linearRampToValueAtTime((p.gain * loud) / Math.sqrt(p.grains), t0 + 0.004);
      gn.gain.exponentialRampToValueAtTime(0.001, t0 + p.dur);
      src.connect(f).connect(gn).connect(this.master);
      src.start(t0, Math.random() * 0.8);
      src.stop(t0 + p.dur + 0.02);
    }
    if (p.thud > 0) {
      // Heel thud: a short low sine drop.
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(110 * pitch, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.06);
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(p.thud * loud * 0.6, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(gn).connect(this.master);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  update(v: Vehicle | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!v) {
      this.engineGain.gain.setTargetAtTime(0, t, 0.15);
      this.skidGain.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    const s = v.spec;
    const ratio = Math.min(1, Math.abs(v.speed) / s.maxSpeed);
    // Fake gearbox: rpm climbs within each gear.
    const gears = s.gears;
    const g = Math.min(gears - 1, Math.floor(ratio * gears));
    const inGear = ratio * gears - g;
    const base = s.engineHz;
    const freq = base + inGear * base * 1.4 + g * 6 + Math.abs(v.throttle) * 8;
    this.engine.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineSub.frequency.setTargetAtTime(freq / 2, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(300 + Math.abs(v.throttle) * 700 + ratio * 600, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.05 + Math.abs(v.throttle) * 0.05, t, 0.1);
    this.skidGain.gain.setTargetAtTime(v.skidding ? 0.12 : 0, t, 0.05);
  }
}
