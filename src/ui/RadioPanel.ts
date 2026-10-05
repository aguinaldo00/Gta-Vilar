import type { Station } from '../audio/stations';

/** How long the panel stays large after tuning, before it settles to a quiet badge (s). */
const SHOW_TIME = 4.5;

/**
 * Radio panel at the top centre of the HUD, GTA IV style: the station's logo
 * in white, its name in large condensed capitals and a line under it. It
 * fades between stations, stays large for a few seconds after tuning and
 * then settles to a small translucent badge (full again on hover). The logo
 * is clickable (next station) and has ‹ › buttons either side.
 */
export class RadioPanel {
  onNext: () => void = () => {};
  onPrev: () => void = () => {};
  onPlay: () => void = () => {};
  onPower: () => void = () => {};
  onExternal: () => void = () => {};
  private readonly root: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly logo: HTMLDivElement;
  private readonly name: HTMLDivElement;
  private readonly tag: HTMLDivElement;
  private readonly state: HTMLDivElement;
  private readonly play: HTMLButtonElement;
  private settleTimer = 0;
  private swapTimer = 0;
  /** Official artwork the user dropped in public/radio/ (listed in logos.json). */
  private custom = new Set<string>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'radio';
    this.root.innerHTML = `
      <button class="r-arrow r-prev" aria-label="Emisora anterior">‹</button>
      <div class="r-card" role="button" tabindex="0" aria-label="Siguiente emisora">
        <div class="r-logo"></div>
        <div class="r-name"></div>
        <div class="r-tag"></div>
        <div class="r-state"></div>
        <div class="r-keys">X: apagar · Q Z: cambiar · V: radio en ventana</div>
      </div>
      <button class="r-arrow r-next" aria-label="Siguiente emisora">›</button>
      <button class="r-power" aria-label="Apagar o encender la radio" title="Apagar / encender la radio">⏻</button>
      <button class="r-play">▶ Encender radio</button>
      <button class="r-ext">▶ Escuchar en otra ventana (V)</button>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.card = q('.r-card');
    this.logo = q('.r-logo');
    this.name = q('.r-name');
    this.tag = q('.r-tag');
    this.state = q('.r-state');
    this.play = q('.r-play');
    const stop = (e: Event) => e.stopPropagation();
    this.root.addEventListener('mousedown', stop);
    this.card.addEventListener('click', () => this.onNext());
    q('.r-next').addEventListener('click', () => this.onNext());
    q('.r-prev').addEventListener('click', () => this.onPrev());
    this.play.addEventListener('click', () => this.onPlay());
    q('.r-power').addEventListener('click', () => this.onPower());
    q('.r-ext').addEventListener('click', () => this.onExternal());
    fetch(new URL('radio/logos.json', document.baseURI))
      .then((r) => (r.ok ? r.json() : []))
      .then((ids: string[]) => {
        this.custom = new Set(ids);
      })
      .catch(() => {});
  }

  show(st: Station, entering: boolean): void {
    this.root.classList.add('on');
    this.root.classList.remove('settled');
    this.card.classList.add('fade');
    window.clearTimeout(this.swapTimer);
    // Fade out, swap, fade in (on getting in, the panel itself fades in).
    this.swapTimer = window.setTimeout(
      () => {
        this.logo.innerHTML = this.custom.has(st.id) ? `<img src="radio/${st.id}.svg" alt="">` : st.logo;
        this.logo.classList.toggle('empty', !st.logo && !this.custom.has(st.id));
        this.name.textContent = st.name;
        this.tag.textContent = st.tagline;
        this.state.textContent = '';
        this.card.classList.remove('fade');
      },
      entering ? 0 : 180,
    );
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.root.classList.add('settled'), SHOW_TIME * 1000);
  }

  /** Power button lit while the radio plays. */
  power(on: boolean): void {
    this.root.classList.toggle('off', !on);
  }

  hide(): void {
    this.root.classList.remove('on', 'settled');
    this.needsGesture(false);
    this.offerExternal(false);
    window.clearTimeout(this.settleTimer);
  }

  status(text: string): void {
    this.state.textContent = text;
  }

  needsGesture(on: boolean): void {
    this.root.classList.toggle('gesture', on);
  }

  /** Offer to play the live station in a window of its own (where the page cannot load it). */
  offerExternal(on: boolean): void {
    // No keyboard on phones: the button names no key there (the touch layer is set up after the panel).
    const ext = this.root.querySelector('.r-ext');
    if (on && ext) ext.textContent = document.body.classList.contains('touch') ? '▶ Abrir la radio' : '▶ Escuchar en otra ventana (V)';
    this.root.classList.toggle('ext', on);
  }
}
