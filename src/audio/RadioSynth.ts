import type { SynthStyle } from './stations';

/**
 * Music for the made-up local stations, composed live with WebAudio: an
 * endless, never-repeating programme in each station's style, scheduled a
 * little ahead of the audio clock.
 *
 *  - folk  (Radio Merindades): 6/8 jota-like tune on a reedy dulzaina over a
 *    drone and a tamboril;
 *  - chill (Nela FM): electric piano seventh chords, soft beat, sub bass and
 *    a sparse pentatonic melody;
 *  - rock  (Corregimiento Rock): distorted power chords, bass and drums.
 */
export class RadioSynth {
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private readonly out: GainNode;
  private noise: AudioBuffer;
  private dist: WaveShaperNode | null = null;
  private melodyNote = 0;
  private seed = 1;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  start(style: SynthStyle): void {
    this.stop();
    this.style = style;
    this.seed = Math.floor(Math.random() * 1e6) + 1;
    this.step = 0;
    this.bar = 0;
    this.melodyNote = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.4);
    if (style === 'rock' && !this.dist) {
      this.dist = this.ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / 1023) * 2 - 1;
        curve[i] = Math.tanh(x * 6);
      }
      this.dist.curve = curve;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      this.dist.connect(lp).connect(this.out);
    }
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  private style: SynthStyle = 'chill';

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }

  /** Lower the music under the presenter's voice. */
  duck(on: boolean): void {
    if (this.timer === null) return;
    this.out.gain.setTargetAtTime(on ? 0.3 : 0.9, this.ctx.currentTime, 0.2);
  }

  private get stepDur(): number {
    // folk: 6/8 in quavers; chill and rock: semiquavers.
    return this.style === 'folk' ? 60 / 132 / 2 : this.style === 'chill' ? 60 / 88 / 4 : 60 / 132 / 4;
  }

  private get stepsPerBar(): number {
    return this.style === 'folk' ? 6 : 16;
  }

  private schedule(): void {
    while (this.nextTime < this.ctx.currentTime + 0.25) {
      if (this.style === 'folk') this.folk(this.nextTime);
      else if (this.style === 'chill') this.chill(this.nextTime);
      else this.rock(this.nextTime);
      this.nextTime += this.stepDur;
      this.step++;
      if (this.step % this.stepsPerBar === 0) this.bar++;
    }
  }

  // ---------------------------------------------------------------- voices

  private tone(
    t: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    opts: { attack?: number; filter?: number; vibrato?: number; dest?: AudioNode; detune?: number } = {},
  ): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.01;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.25);
    let node: AudioNode = o;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.filter;
      node.connect(f);
      node = f;
    }
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = ctx.createGain();
      lg.gain.value = opts.vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.5);
    }
    node.connect(g).connect(opts.dest ?? this.out);
    o.start(t);
    o.stop(t + dur + 0.6);
  }

  private hit(t: number, kind: 'kick' | 'snare' | 'hat' | 'tom', gain = 1): void {
    const ctx = this.ctx;
    if (kind === 'kick' || kind === 'tom') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f0 = kind === 'kick' ? 120 : 190;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(kind === 'kick' ? 42 : 90, t + 0.12);
      g.gain.setValueAtTime(0.9 * gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'kick' ? 0.32 : 0.25));
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + 0.4);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const g = ctx.createGain();
    const len = kind === 'hat' ? 0.05 : 0.18;
    g.gain.setValueAtTime((kind === 'hat' ? 0.18 : 0.5) * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, this.rnd() * 0.5);
    src.stop(t + len + 0.02);
  }

  private static hz(midi: number): number {
    return 440 * 2 ** ((midi - 69) / 12);
  }

  // ---------------------------------------------------------------- styles

  private folk(t: number): void {
    const s = this.step % 6;
    const D = 62; // D4, dorian
    const scale = [0, 2, 3, 5, 7, 9, 10, 12, 14];
    const hz = RadioSynth.hz;
    // Drone (bordón) every bar.
    if (s === 0) {
      const dur = this.stepDur * 6;
      this.tone(t, hz(D - 24), dur, 'sawtooth', 0.05, { filter: 500, attack: 0.05 });
      this.tone(t, hz(D - 17), dur, 'sawtooth', 0.035, { filter: 600, attack: 0.05 });
    }
    // Tamboril: strong 1 and 4, light in between.
    if (s === 0 || s === 3) this.hit(t, 'tom', s === 0 ? 1 : 0.7);
    else if (this.rnd() < 0.5) this.hit(t, 'snare', 0.25);
    // Dulzaina: stepwise melody, phrases of 4 bars ending on the tonic.
    const phraseEnd = this.bar % 4 === 3 && s >= 3;
    if (phraseEnd) {
      if (s === 3) {
        this.melodyNote = 0;
        this.tone(t, hz(D + 12), this.stepDur * 3, 'square', 0.06, { filter: 2600, vibrato: 6 });
      }
      return;
    }
    if (this.rnd() < 0.85) {
      this.melodyNote = Math.max(0, Math.min(scale.length - 1, this.melodyNote + Math.floor(this.rnd() * 5) - 2));
      const len = this.rnd() < 0.3 ? 2 : 1;
      this.tone(t, hz(D + 12 + scale[this.melodyNote]), this.stepDur * len, 'square', 0.055, { filter: 2400, vibrato: 5, attack: 0.02 });
    }
  }

  private chill(t: number): void {
    const s = this.step % 16;
    const hz = RadioSynth.hz;
    // ii–V–I–vi in F, seventh chords.
    const prog = [
      [55, 58, 62, 65],
      [60, 64, 67, 70],
      [53, 57, 60, 64],
      [62, 65, 69, 72],
    ];
    const chord = prog[this.bar % 4];
    if (s === 0) for (const n of chord) this.tone(t, hz(n), this.stepDur * 15, 'triangle', 0.045, { attack: 0.03, filter: 1800 });
    if (s === 8 && this.rnd() < 0.6) for (const n of chord) this.tone(t, hz(n + 12), this.stepDur * 6, 'sine', 0.02, { attack: 0.02 });
    if (s === 0 || s === 10) this.hit(t, 'kick', 0.7);
    if (s === 4 || s === 12) this.hit(t, 'snare', 0.35);
    if (s % 2 === 0) this.hit(t, 'hat', s % 4 === 2 ? 0.8 : 0.5);
    if (s === 0 || s === 6 || s === 10) this.tone(t, hz(chord[0] - 24), this.stepDur * 3, 'sine', 0.22, { attack: 0.01 });
    // Sparse pentatonic melody.
    const penta = [65, 67, 69, 72, 74, 77, 79];
    if (s % 2 === 0 && this.rnd() < 0.28) {
      this.melodyNote = Math.max(0, Math.min(penta.length - 1, this.melodyNote + Math.floor(this.rnd() * 3) - 1));
      this.tone(t, hz(penta[this.melodyNote]), this.stepDur * 3, 'sine', 0.06, { attack: 0.01, vibrato: 2 });
    }
  }

  private rock(t: number): void {
    const s = this.step % 16;
    const hz = RadioSynth.hz;
    // E – C – D – A power chords, two bars each.
    const roots = [40, 36, 38, 45];
    const root = roots[Math.floor(this.bar / 2) % 4];
    const dest = this.dist ?? this.out;
    if (s % 2 === 0) {
      const mute = s % 4 !== 0;
      for (const iv of [0, 7, 12])
        this.tone(t, hz(root + 12 + iv), this.stepDur * (mute ? 1 : 2), 'sawtooth', mute ? 0.05 : 0.08, { dest, detune: iv ? 4 : 0 });
    }
    if (s % 4 === 0) this.tone(t, hz(root), this.stepDur * 3, 'square', 0.12, { filter: 700 });
    if (s === 0 || s === 8 || (s === 10 && this.rnd() < 0.5)) this.hit(t, 'kick', 1);
    if (s === 4 || s === 12) this.hit(t, 'snare', 0.9);
    if (s % 2 === 0) this.hit(t, 'hat', 0.7);
    // A short lead lick every fourth bar.
    if (this.bar % 4 === 3 && s % 2 === 0 && this.rnd() < 0.7) {
      const blues = [0, 3, 5, 6, 7, 10, 12];
      this.tone(t, hz(root + 24 + blues[Math.floor(this.rnd() * blues.length)]), this.stepDur * 2, 'sawtooth', 0.05, { dest, vibrato: 4 });
    }
  }
}
