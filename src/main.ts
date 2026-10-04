import { fetchFromPublic, loadConfig } from './config/Config';
import { Game } from './Game';
import { initRapier } from './physics/RapierPhysics';
import { runArrival } from './ui/ArrivalSequence';
import { MainMenu } from './ui/MainMenu';
import type { Weather } from './world/Climate';
import { loadMap } from './world/mapData';

const app = document.getElementById('app')!;
let game: Game | null = null;
/** Choices made in Ajustes before entering (applied at the arrival). */
let startHour: number | null = null;
let startWeather: Weather | 'auto' | null = null;

const menu = new MainMenu({
  unlockAudio: () => game?.unlockAudio(),
  setWeather: (w) => {
    startWeather = w;
  },
  setStartHour: (h) => {
    startHour = h;
  },
});

menu.onEnter = () => {
  if (!game) return;
  const g = game;
  if (startHour !== null) g.hours = startHour;
  else {
    const now = new Date();
    if (!new URLSearchParams(location.search).has('hora')) g.hours = now.getHours() + now.getMinutes() / 60;
  }
  if (startWeather === 'auto') g.climate.dynamic = true;
  else if (startWeather) {
    g.climate.dynamic = false;
    g.climate.setWeather(startWeather, true);
  }
  void runArrival(g, { menu, fade: document.getElementById('fade')!, app, hud: document.getElementById('hud')! }, true);
};

async function boot(): Promise<void> {
  menu.progress('CARGANDO EL PUEBLO…', 0.15);
  const [config, map] = await Promise.all([loadConfig(fetchFromPublic()), loadMap('maps/villarcayo.json'), initRapier()]);
  menu.progress('CONSTRUYENDO VILLARCAYO…', 0.6);
  // Let the progress paint before the heavy build.
  await new Promise((r) => setTimeout(r, 30));
  game = new Game(app, config, map);
  // The menu's backdrop: the town at dusk, filmed by a slow crane shot.
  game.menuPreview(20.4);
  game.start();
  menu.progress('LISTO', 1);
  menu.ready();
  fetch('config/audio.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => menu.setMusic(c?.menu?.music, c?.menu?.volume))
    .catch(() => undefined);
}

boot().catch((err: unknown) => {
  // Bad or missing data files: say so on the menu instead of a blank page.
  console.error(err);
  menu.progress('ERROR AL CARGAR', 1);
  menu.root.insertAdjacentHTML(
    'beforeend',
    `<p style="position:absolute;left:24px;bottom:24px;color:#f66;max-width:40em">${String(err)}</p>`,
  );
});
