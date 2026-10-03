import type { RawInput } from '../input/RawInput';

const STICK_RADIUS = 60;
const LOOK_SENS = 1.8;

/**
 * On-screen controls for phones and tablets: a floating joystick on the left
 * half of the screen, drag-to-look on the right half, and action buttons.
 * Everything is fed into `RawInput` as virtual keys (`Touch.*`, bound in config/input.json),
 * so gameplay only ever reads actions.
 */
export class TouchControls {
  static supported(): boolean {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  private readonly layer: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly jumpBtn: HTMLButtonElement;
  private readonly useBtn: HTMLButtonElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private ox = 0;
  private oy = 0;
  private lx = 0;
  private ly = 0;
  private driving = false;

  constructor(private readonly input: RawInput) {
    document.body.classList.add('touch');
    this.layer = document.createElement('div');
    this.layer.id = 'touch';
    this.base = document.createElement('div');
    this.base.className = 'stick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    this.base.appendChild(this.knob);
    this.layer.appendChild(this.base);
    this.jumpBtn = this.button('btn-jump', 'SALTAR', 'Touch.jump');
    this.useBtn = this.button('btn-use', 'ROBAR', 'Touch.use');
    document.body.appendChild(this.layer);

    this.layer.addEventListener('pointerdown', (e) => this.onDown(e));
    this.layer.addEventListener('pointermove', (e) => this.onMove(e));
    this.layer.addEventListener('pointerup', (e) => this.onUp(e));
    this.layer.addEventListener('pointercancel', (e) => this.onUp(e));
  }

  /** Relabels the buttons when getting in or out of a vehicle. */
  setDriving(driving: boolean): void {
    if (driving === this.driving) return;
    this.driving = driving;
    this.jumpBtn.textContent = driving ? 'FRENO' : 'SALTAR';
    this.useBtn.textContent = driving ? 'SALIR' : 'ROBAR';
  }

  private button(id: string, label: string, code: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'touch-btn';
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      b.classList.add('active');
      this.input.pressVirtual(code);
    });
    const release = (e: PointerEvent) => {
      e.stopPropagation();
      b.classList.remove('active');
      this.input.releaseVirtual(code);
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    this.layer.appendChild(b);
    return b;
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    if (e.clientX < window.innerWidth * 0.45 && this.stickId === null) {
      this.stickId = e.pointerId;
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.base.style.left = `${this.ox}px`;
      this.base.style.top = `${this.oy}px`;
      this.base.classList.add('active');
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lx = e.clientX;
      this.ly = e.clientY;
    } else return;
    this.layer.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.ox;
      let dy = e.clientY - this.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        dx *= STICK_RADIUS / d;
        dy *= STICK_RADIUS / d;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.input.stickX = dx / STICK_RADIUS;
      this.input.stickY = -dy / STICK_RADIUS;
    } else if (e.pointerId === this.lookId) {
      this.input.addLook((e.clientX - this.lx) * LOOK_SENS, (e.clientY - this.ly) * LOOK_SENS);
      this.lx = e.clientX;
      this.ly = e.clientY;
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.input.stickX = this.input.stickY = 0;
      this.base.classList.remove('active');
    } else if (e.pointerId === this.lookId) this.lookId = null;
  }
}
