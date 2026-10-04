import type { Howl } from 'howler';
import { AudioMix, type Settings } from '../audio/AudioMix';
import { WEATHER_LABEL, WEATHERS, type Weather } from '../world/Climate';

/** What the menu needs from the game (kept small so the menu stays a separate module). */
export interface MenuHost {
  /** Called once, on the first click (unlocks the browser's audio). */
  unlockAudio(): void;
  setWeather(w: Weather | 'auto'): void;
  setStartHour(h: number | null): void;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/**
 * The main menu, over the live town (the game films a slow crane shot
 * behind it). Built in HTML/CSS: the logo, the list on the right as in the
 * mockups (ENTRAR AL MUNDO, AJUSTES, CRÉDITOS; a hidden slot for a future
 * login), keyboard and mouse navigation, the settings (volumes, mouse,
 * length of the day, weather) and the credits. Music from
 * public/config/audio.json (`menu.music`, a placeholder until it is added).
 */
export class MainMenu {
  readonly root = $('#menu');
  private readonly play = $<HTMLButtonElement>('#play');
  private music: Howl | null = null;
  private musicVol = 0.8;
  private unlocked = false;
  onEnter: () => void = () => {};

  constructor(private readonly host: MenuHost) {
    const items = [...this.root.querySelectorAll<HTMLButtonElement>('.m-list > button')];
    items.forEach((b) => {
      b.addEventListener('mouseenter', () => b.focus());
      b.addEventListener('click', () => {
        this.unlock();
        const panel = b.dataset.panel;
        if (panel) this.open(panel);
      });
    });
    this.play.addEventListener('click', () => {
      if (this.play.disabled) return;
      this.unlock();
      this.onEnter();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) => {
      b.addEventListener('click', () => this.close());
    });
    // Keyboard: ↑ ↓ to move, Enter to choose, Esc to close a panel.
    this.root.addEventListener('keydown', (e) => {
      const list = items.filter((b) => !b.hidden && !b.disabled);
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      } else if (e.key === 'Escape') this.close();
    });
    // Any first interaction unlocks the audio (and starts the menu music).
    window.addEventListener('pointerdown', () => this.unlock(), { once: true });
    window.addEventListener('keydown', () => this.unlock(), { once: true });
    this.buildSettings();
  }

  /** The game is loaded: the 3D town fades in behind the menu and the button is enabled. */
  ready(): void {
    this.play.disabled = false;
    this.play.textContent = 'ENTRAR AL MUNDO';
    this.root.classList.add('ready');
    this.play.focus();
  }

  progress(text: string, k: number): void {
    const bar = this.root.querySelector<HTMLElement>('.m-loading i');
    if (bar) bar.style.width = `${Math.round(k * 100)}%`;
    const t = this.root.querySelector<HTMLElement>('.m-loading span');
    if (t) t.textContent = text;
  }

  setMusic(src: string | undefined, volume = 0.8): void {
    if (!src) return;
    this.musicVol = volume;
    this.music = AudioMix.howl(src, 'music', { loop: true, volume, html5: true });
    if (this.unlocked) this.music.play();
  }

  private unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.host.unlockAudio();
    if (this.music && !this.music.playing()) {
      this.music.volume(0);
      this.music.play();
      this.music.fade(0, this.musicVol * AudioMix.settings.music, 1500);
    }
  }

  /** Music down over `ms` (the fade to black). */
  fadeMusic(ms: number): void {
    if (!this.music) return;
    const m = this.music;
    m.fade(m.volume(), 0, ms);
    window.setTimeout(() => m.stop(), ms + 50);
  }

  /** Fade the menu out (CSS transition, 1 s). */
  hide(): void {
    this.close();
    this.root.classList.add('leaving');
    window.setTimeout(() => {
      this.root.hidden = true;
    }, 1100);
  }

  private open(id: string): void {
    this.root.querySelectorAll('.m-panel').forEach((p) => {
      p.classList.toggle('open', p.id === `panel-${id}`);
    });
    this.root.classList.add('panel-open');
  }

  private close(): void {
    this.root.querySelectorAll('.m-panel').forEach((p) => {
      p.classList.remove('open');
    });
    this.root.classList.remove('panel-open');
  }

  private buildSettings(): void {
    const box = this.root.querySelector<HTMLElement>('#panel-settings .m-fields');
    if (!box) return;
    const s = AudioMix.settings;
    const slider = (key: keyof Settings, label: string, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const row = document.createElement('label');
      row.className = 'm-field';
      row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}"><output>${fmt(s[key])}</output>`;
      const input = row.querySelector('input')!;
      const out = row.querySelector('output')!;
      input.addEventListener('input', () => {
        const v = Number(input.value);
        out.textContent = fmt(v);
        AudioMix.save({ [key]: v } as Partial<Settings>);
        if (key === 'music' && this.music?.playing()) this.music.volume(this.musicVol * AudioMix.settings.music);
      });
      box.appendChild(row);
    };
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    slider('master', 'Volumen general', 0, 1, 0.05, pct);
    slider('music', 'Música', 0, 1, 0.05, pct);
    slider('radio', 'Radio', 0, 1, 0.05, pct);
    slider('ambience', 'Ambiente', 0, 1, 0.05, pct);
    slider('voices', 'Voces', 0, 1, 0.05, pct);
    slider('sfx', 'Efectos', 0, 1, 0.05, pct);
    slider('sensitivity', 'Sensibilidad del ratón', 0.3, 2.5, 0.1, (v) => `${v.toFixed(1)}×`);
    slider('dayMinutes', 'Duración del día', 10, 60, 2, (v) => `${v} min`);
    // Start conditions (also for testing the lighting and the weather).
    const row = document.createElement('label');
    row.className = 'm-field';
    row.innerHTML = `<span>Clima</span><select><option value="auto">Dinámico</option>${WEATHERS.map((w) => `<option value="${w}">${WEATHER_LABEL[w]}</option>`).join('')}</select>`;
    row
      .querySelector('select')!
      .addEventListener('change', (e) => this.host.setWeather((e.target as HTMLSelectElement).value as Weather | 'auto'));
    box.appendChild(row);
    const hour = document.createElement('label');
    hour.className = 'm-field';
    hour.innerHTML = `<span>Hora al entrar</span><select><option value="">Hora real</option>${Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('')}</select>`;
    hour.querySelector('select')!.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.host.setStartHour(v === '' ? null : Number(v));
    });
    box.appendChild(hour);
  }
}
