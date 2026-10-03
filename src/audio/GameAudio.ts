import type { Vehicle } from '../entities/Vehicle';

/** Tiny synthesized engine + tyre screech, built from WebAudio oscillators and noise. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engine!: OscillatorNode;
  private engineSub!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  muted = false;

  /** Must be called from a user gesture (browser autoplay policy). */
  init(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = (this.ctx = new Ctor());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
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
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    return this.muted;
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
