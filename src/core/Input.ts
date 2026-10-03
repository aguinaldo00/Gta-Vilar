const MAX_MOUSE_DELTA = 250;
const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/**
 * Keyboard + mouse state. Keys are tracked by `KeyboardEvent.code` so the
 * layout (QWERTY/AZERTY) does not matter. Mouse deltas are accumulated while
 * the pointer is locked (or while dragging, as a fallback).
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private mdx = 0;
  private mdy = 0;
  private dragging = false;
  private skipNextMove = false;
  /** Timestamp (seconds) of the last mouse-look movement. */
  lastLookTime = -Infinity;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    target.addEventListener('mousedown', () => {
      if (!this.locked) this.dragging = true;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    // Browsers can report a bogus, huge delta right after pointer lock changes.
    document.addEventListener('pointerlockchange', () => (this.skipNextMove = true));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.dragging) return;
      if (this.skipNextMove || Math.abs(e.movementX) > MAX_MOUSE_DELTA || Math.abs(e.movementY) > MAX_MOUSE_DELTA) {
        this.skipNextMove = false;
        return;
      }
      this.mdx += e.movementX;
      this.mdy += e.movementY;
      this.lastLookTime = performance.now() / 1000;
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  requestLock(): void {
    try {
      const result = this.target.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      /* pointer lock unavailable (e.g. iframe sandbox) — drag-to-look still works */
    }
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Returns -1, 0 or 1 depending on which group of keys is held. */
  axis(negative: string[], positive: string[]): number {
    return (this.isDown(...positive) ? 1 : 0) - (this.isDown(...negative) ? 1 : 0);
  }

  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mdx, dy: this.mdy };
    this.mdx = this.mdy = 0;
    return r;
  }

  /** Clears one-frame "pressed" edges. Call once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
  }
}
