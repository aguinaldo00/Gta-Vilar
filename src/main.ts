import { fetchFromPublic, loadConfig } from './config/Config';
import { Game } from './Game';

const app = document.getElementById('app')!;
const start = document.getElementById('start')!;
const play = document.getElementById('play') as HTMLButtonElement;

async function boot(): Promise<void> {
  const config = await loadConfig(fetchFromPublic());
  const game = new Game(app, config);
  game.start();
  play.disabled = false;
  play.textContent = 'JUGAR';
  play.addEventListener('click', () => {
    start.classList.add('hidden');
    game.begin();
  });
}

boot().catch((err: unknown) => {
  // Bad or missing data files: say so on the start screen instead of a blank page.
  console.error(err);
  play.textContent = 'ERROR';
  start.insertAdjacentHTML('beforeend', `<p style="color:#f66;max-width:40em">${String(err)}</p>`);
});
