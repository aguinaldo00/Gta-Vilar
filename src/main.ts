import { Game } from './Game';

const app = document.getElementById('app')!;
const start = document.getElementById('start')!;
const play = document.getElementById('play') as HTMLButtonElement;

const game = new Game(app);
game.start();
play.disabled = false;
play.textContent = 'JUGAR';

play.addEventListener('click', () => {
  start.classList.add('hidden');
  game.begin();
});
