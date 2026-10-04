/** What the arrival needs from the game. */
export interface ArrivalHost {
  /** In the dark: player at the spawn, camera settled, the arrival shot armed. */
  prepareArrival(): void;
  /** Arrival shot progress 0–1 (the camera descends from high above). */
  arrival: number;
  /** World ambience level 0–1 (fades in with the picture). */
  ambienceGain: number;
  takeControl(lockPointer: boolean): void;
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Runs fn(k) for k from 0 to 1 over ms (on animation frames, or timers if frames are not running). */
function tween(ms: number, fn: (k: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      fn(k);
      if (k < 1) window.setTimeout(step, 16);
      else resolve();
    };
    step();
  });
}

const smooth = (k: number) => k * k * (3 - 2 * k);

/**
 * The cinematic way into the world, in strict order:
 *  1. the menu fades to black (1 s) while its music fades out;
 *  2. in the dark, the player is placed and the camera prepared;
 *  3. the world fades in from black (2 s), blurred and coming into focus;
 *  4. the camera descends from high above to its place behind the player (3.5 s);
 *  5. control returns to the player, and half a second later the HUD fades in.
 */
export async function runArrival(
  host: ArrivalHost,
  ui: { menu: { hide(): void; fadeMusic(ms: number): void }; fade: HTMLElement; app: HTMLElement; hud: HTMLElement },
  lockPointer: boolean,
): Promise<void> {
  const { fade, app, hud } = ui;
  hud.classList.add('hud-hidden');
  // 1. Fade to black.
  fade.classList.add('on');
  ui.menu.fadeMusic(1000);
  ui.menu.hide();
  await wait(1050);
  // 2. Loading in the dark.
  host.prepareArrival();
  await wait(250);
  // 3 + 4. Fade in (blurred → sharp) while the camera starts to descend.
  const fadeIn = tween(2000, (k) => {
    const e = smooth(k);
    fade.style.opacity = String(1 - e);
    app.style.filter = e < 1 ? `blur(${(14 * (1 - e)).toFixed(2)}px)` : '';
    host.ambienceGain = e;
  });
  const descend = tween(3600, (k) => {
    host.arrival = k;
  });
  await fadeIn;
  fade.classList.remove('on');
  fade.style.opacity = '';
  app.style.filter = '';
  await descend;
  // 5. Control, then the HUD.
  host.takeControl(lockPointer);
  await wait(500);
  hud.classList.remove('hud-hidden');
}
