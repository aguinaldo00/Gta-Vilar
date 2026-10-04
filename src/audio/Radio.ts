import type { RadioPanel } from '../ui/RadioPanel';
import { RadioSynth } from './RadioSynth';
import { STATIONS, type Station, type StreamSource } from './stations';

const STORAGE_KEY = 'villarcayo.radio';
const VOLUME = 0.85;
/** How long a stream may take to start before the next source is tried (ms). */
const STREAM_TIMEOUT = 9000;

/** "Radio off" sits at the end of the dial, as in GTA IV. */
export const RADIO_OFF: Station = { id: 'off', name: 'Radio apagada', tagline: '', logo: '' };

type HlsCtor = typeof import('hls.js').default;

/**
 * Car radio in the style of GTA IV. It switches on when the player gets into
 * a vehicle and stops when they get out; the station is changed from the HUD
 * panel (click), the wheel or Q / Z, with a burst of tuning static. National
 * stations play their live streams (HTML audio, hls.js for HLS); the three
 * local stations are generated live (RadioSynth) and announce themselves
 * with the browser's Spanish voice. The last station is remembered.
 *
 * Autoplay: the game starts from a click, which unlocks audio for the
 * session; if the browser still refuses, the panel shows a play button and
 * the first click on it unlocks the radio for the rest of the session.
 */
export class RadioSystem {
  readonly stations: Station[] = [...STATIONS, RADIO_OFF];
  private index = 0;
  private inVehicle = false;
  private muted = false;
  private ctx: AudioContext | null = null;
  private synth: RadioSynth | null = null;
  private staticGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly audio = new Audio();
  private hls: InstanceType<HlsCtor> | null = null;
  private loadToken = 0;
  private lastWheel = 0;

  constructor(private readonly panel: RadioPanel) {
    this.audio.preload = 'none';
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const i = this.stations.findIndex((s) => s.id === saved);
      if (i >= 0) this.index = i;
    } catch {
      // Storage unavailable (private mode): start on the first station.
    }
    panel.onNext = () => this.next();
    panel.onPrev = () => this.prev();
    panel.onPlay = () => {
      this.init();
      this.panel.needsGesture(false);
      this.tune(this.index, false);
    };
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.inVehicle) return;
        const now = performance.now();
        if (now - this.lastWheel < 250 || Math.abs(e.deltaY) < 4) return;
        this.lastWheel = now;
        if (e.deltaY > 0) this.next();
        else this.prev();
      },
      { passive: true },
    );
  }

  get current(): Station {
    return this.stations[this.index];
  }

  /** Call from a user gesture (the start button): creates the audio graph for static and the local stations. */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = (this.ctx = new Ctor());
    const master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
    this.synth = new RadioSynth(ctx, master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.staticGain = ctx.createGain();
    this.staticGain.gain.value = 0;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2400;
    band.Q.value = 0.6;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.connect(band).connect(this.staticGain).connect(master);
    src.start();
  }

  enterVehicle(): void {
    if (this.inVehicle) return;
    this.inVehicle = true;
    this.tune(this.index, true);
  }

  exitVehicle(): void {
    if (!this.inVehicle) return;
    this.inVehicle = false;
    this.stopAll();
    this.panel.hide();
  }

  next(): void {
    if (this.inVehicle) this.tune((this.index + 1) % this.stations.length, false);
  }

  prev(): void {
    if (this.inVehicle) this.tune((this.index - 1 + this.stations.length) % this.stations.length, false);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.audio.volume = m ? 0 : VOLUME;
    if (this.ctx) void (m ? this.ctx.suspend() : this.ctx.resume());
  }

  private tune(i: number, entering: boolean): void {
    this.index = i;
    const st = this.current;
    try {
      localStorage.setItem(STORAGE_KEY, st.id);
    } catch {
      // Not remembered this time.
    }
    this.stopAll();
    this.panel.show(st, entering);
    if (st.id === 'off') return;
    this.burst(0.45);
    const token = ++this.loadToken;
    if (st.synth) {
      this.init();
      this.synth?.start(st.synth);
      if (st.ident && !this.muted) this.announce(st.ident);
    } else if (st.streams) void this.playStream(st.streams, token);
  }

  private stopAll(): void {
    this.loadToken++;
    this.synth?.stop();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.ctx) this.staticGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /** Tuning static between stations (and a soft hiss while a stream is connecting). */
  private burst(seconds: number, level = 0.22): void {
    if (!this.ctx || !this.staticGain) return;
    const t = this.ctx.currentTime;
    const g = this.staticGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(level, t);
    g.setTargetAtTime(0.0, t + seconds, 0.12);
  }

  private hiss(on: boolean): void {
    if (!this.ctx || !this.staticGain) return;
    this.staticGain.gain.setTargetAtTime(on ? 0.035 : 0, this.ctx.currentTime, 0.2);
  }

  private announce(text: string): void {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith('es'));
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.onstart = () => this.synth?.duck(true);
    u.onend = () => this.synth?.duck(false);
    window.setTimeout(() => window.speechSynthesis.speak(u), 900);
  }

  private async playStream(sources: StreamSource[], token: number): Promise<void> {
    this.panel.status('Sintonizando…');
    this.hiss(true);
    for (const src of sources) {
      if (token !== this.loadToken) return;
      const result = await this.tryStream(src, token);
      if (token !== this.loadToken) return;
      if (result === 'ok') {
        this.hiss(false);
        this.panel.status('');
        return;
      }
      if (result === 'gesture') {
        this.hiss(false);
        this.panel.needsGesture(true);
        return;
      }
    }
    this.panel.status('Sin señal');
  }

  private async tryStream(src: StreamSource, token: number): Promise<'ok' | 'fail' | 'gesture'> {
    const a = this.audio;
    a.volume = this.muted ? 0 : VOLUME;
    let Hls: HlsCtor | null = null;
    if (src.hls && !a.canPlayType('application/vnd.apple.mpegurl')) {
      Hls = (await import('hls.js')).default;
      if (token !== this.loadToken || !Hls.isSupported()) return 'fail';
      this.hls = new Hls({ liveSyncDurationCount: 3, maxBufferLength: 20 });
      this.hls.loadSource(src.url);
      this.hls.attachMedia(a);
    } else {
      a.src = src.url;
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: 'ok' | 'fail' | 'gesture') => {
        if (done) return;
        done = true;
        a.removeEventListener('playing', onPlaying);
        a.removeEventListener('error', onError);
        window.clearTimeout(timer);
        if (r !== 'ok' && this.hls) {
          this.hls.destroy();
          this.hls = null;
        }
        resolve(r);
      };
      const onPlaying = () => finish('ok');
      const onError = () => finish('fail');
      a.addEventListener('playing', onPlaying);
      a.addEventListener('error', onError);
      if (Hls && this.hls)
        this.hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) finish('fail');
        });
      const timer = window.setTimeout(() => finish('fail'), STREAM_TIMEOUT);
      a.play().catch((e: DOMException) => finish(e?.name === 'NotAllowedError' ? 'gesture' : 'fail'));
    });
  }
}
