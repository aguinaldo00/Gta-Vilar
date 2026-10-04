import type { RadioPanel } from '../ui/RadioPanel';
import { AudioMix } from './AudioMix';
import { RadioSynth } from './RadioSynth';
import { STATIONS, type Station, type StreamSource } from './stations';

const STORAGE_KEY = 'villarcayo.radio';
/** Radio level from Ajustes (master × radio channel). */
const volume = () => AudioMix.level('radio');
/** How long a stream may take to start before the next source is tried (ms). */
const STREAM_TIMEOUT = 15000;
/** Phones and tablets: hints name the panel's buttons instead of keys. */
const touch = () => document.body.classList.contains('touch');

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
  /**
   * The page refused to load outside audio (a media-src content security
   * policy). Only used for the message: the live stations stay on the dial.
   */
  private streamsBlocked = false;
  private speechTimer = 0;
  /**
   * Live stations play in a small window of their own: the page that hosts the
   * game (the claude.ai viewer) refuses audio from other sites, a window opened
   * by the player does not. Chosen once with the panel's button, then Q / Z,
   * X and getting out drive that window.
   */
  private external = false;
  private popup: Window | null = null;
  /**
   * The window opened but the page got no handle on it (some hosts open pop-ups
   * detached): it cannot be steered or closed from here, so no second one is
   * opened; the station is changed in it until the player closes it.
   */
  private detached = false;
  /** Switched off with the power button for this ride (back on in the next car). */
  private poweredOff = false;

  constructor(private readonly panel: RadioPanel) {
    this.audio.preload = 'none';
    // A slow stream may still start after its source was given up: then it plays, so clear the message.
    this.audio.addEventListener('playing', () => {
      this.hiss(false);
      this.panel.status('');
    });
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const i = this.stations.findIndex((s) => s.id === saved);
      if (i >= 0) this.index = i;
    } catch {
      // Storage unavailable (private mode): start on the first station.
    }
    panel.onNext = () => this.next();
    panel.onPrev = () => this.prev();
    panel.onPower = () => this.togglePower();
    panel.onExternal = () => this.toggleExternal();
    // V: the radio in its own window and back, from the keyboard (while driving the mouse is captured).
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV' && !e.repeat && this.inVehicle) this.toggleExternal();
    });
    document.addEventListener('securitypolicyviolation', (e) => {
      // Only <audio> loads count (media-src); hls.js and fetch go through connect-src, which MP3 streams do not need.
      if (/media-src|default-src/.test(e.effectiveDirective) && /^https?:/.test(e.blockedURI)) this.streamsBlocked = true;
    });
    panel.onPlay = () => {
      this.init();
      this.panel.needsGesture(false);
      this.tune(this.index, false);
    };
    // While driving the mouse is captured (pointer lock), so a click cannot reach the ⏻ button:
    // the middle button (wheel click) switches the radio off and on, the wheel changes station.
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 1 || !this.inVehicle) return;
      e.preventDefault();
      this.togglePower();
    });
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
    master.gain.value = volume();
    AudioMix.onChange(() => {
      master.gain.value = volume();
      if (!this.muted) this.audio.volume = volume();
    });
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

  /** Wraps a dial position; `skipOff` passes over "Radio apagada" (getting in, power on). */
  private seek(i: number, step: 1 | -1, skipOff = false): number {
    const n = this.stations.length;
    let j = ((i % n) + n) % n;
    if (skipOff && this.stations[j].id === 'off') j = (((j + step) % n) + n) % n;
    return j;
  }

  enterVehicle(): void {
    if (this.inVehicle) return;
    this.inVehicle = true;
    this.poweredOff = false;
    // Switches itself on with the car, on the last station listened to.
    void this.ctx?.resume();
    this.tune(this.seek(this.index, 1, true), true);
  }

  get on(): boolean {
    return this.inVehicle && !this.poweredOff && this.current.id !== 'off';
  }

  /** Power button (X, or ⏻ on the panel): off for the rest of this ride, or back on. */
  togglePower(): void {
    if (!this.inVehicle) return;
    if (this.on) {
      this.poweredOff = true;
      this.stopAll();
      this.panel.show(RADIO_OFF, false);
      this.panel.power(false);
    } else {
      this.poweredOff = false;
      this.init();
      this.tune(this.seek(this.index, 1, true), false);
    }
  }

  exitVehicle(): void {
    if (!this.inVehicle) return;
    this.inVehicle = false;
    this.stopAll();
    this.panel.hide();
  }

  next(): void {
    if (!this.inVehicle) return;
    this.poweredOff = false;
    this.tune(this.seek(this.index + 1, 1), false);
  }

  prev(): void {
    if (!this.inVehicle) return;
    this.poweredOff = false;
    this.tune(this.seek(this.index - 1, -1), false);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.audio.volume = m ? 0 : volume();
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
    this.stopAll(this.external && !!st.streams);
    this.panel.show(st, entering);
    this.panel.power(st.id !== 'off');
    if (st.id === 'off') return;
    this.burst(0.45);
    const token = ++this.loadToken;
    if (st.synth) {
      this.init();
      this.synth?.start(st.synth);
      if (st.ident && !this.muted) this.announce(st.ident);
    } else if (st.streams) {
      if (this.external) this.openExternal(st.streams);
      else void this.playStream(st.streams, token);
    }
  }

  /** Live stations in their own window (V or the panel's button), or back in the game. */
  toggleExternal(): void {
    this.external = !this.external;
    if (!this.external) this.closePopup();
    this.detached = false;
    this.tune(this.index, false);
  }

  /**
   * The station's MP3 stream in the radio's window (the browser's own player).
   * Only ever one: a station change loads into the window already open.
   */
  private openExternal(sources: StreamSource[]): void {
    const url = (sources.find((s) => !s.hls) ?? sources[0]).url;
    let text = touch() ? 'Sonando en otra pestaña' : 'Sonando en la ventana de la radio · V para volver';
    if (this.popup && !this.popup.closed) {
      try {
        this.popup.location.replace(url);
      } catch {
        this.closePopup();
      }
    }
    if (!this.popup || this.popup.closed) {
      if (this.detached) text = touch() ? 'Cambia la emisora en su pestaña' : 'Cambia la emisora en su ventana, o ciérrala y pulsa V';
      else {
        this.popup = window.open(url, 'villarcayo-radio', 'popup,width=420,height=160');
        // Opened without a handle (or blocked): never open another one behind it.
        if (!this.popup) {
          this.detached = true;
          text = 'Si no se abrió la ventana, permite las ventanas emergentes';
        }
      }
    }
    // After the panel has swapped to the station (it clears the line).
    window.setTimeout(() => this.panel.status(text), 250);
    if (this.popup) window.focus();
  }

  private closePopup(): void {
    if (this.popup && !this.popup.closed) this.popup.close();
    this.popup = null;
  }

  /** Stops what plays; `keepPopup` when the radio's window will just load the next station. */
  private stopAll(keepPopup = false): void {
    this.loadToken++;
    this.panel.offerExternal(false);
    if (!keepPopup) this.closePopup();
    this.synth?.stop();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.ctx) this.staticGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    window.clearTimeout(this.speechTimer);
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
    this.speechTimer = window.setTimeout(() => window.speechSynthesis.speak(u), 900);
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
    if (token !== this.loadToken) return;
    // No signal: stay on the station (the player chose it) and offer its own window, where the
    // page's restrictions do not apply; Q / Z move on.
    this.hiss(false);
    this.panel.status(
      this.streamsBlocked
        ? 'Esta página no deja cargar la radio en directo'
        : touch()
          ? 'Sin señal · ‹ › para cambiar'
          : 'Sin señal · Q / Z para cambiar',
    );
    this.panel.offerExternal(true);
  }

  private async tryStream(src: StreamSource, token: number): Promise<'ok' | 'fail' | 'gesture'> {
    const a = this.audio;
    a.volume = this.muted ? 0 : volume();
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
