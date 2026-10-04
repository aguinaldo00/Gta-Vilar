// Radio where the page cannot load outside audio (as in the claude.ai viewer): every stream
// request fails; the panel offers the radio's own window, Q changes its station, X closes it.
//   npx vite preview --port 4173 &  node tools/qa/radio-blocked.cjs
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
(async () => {
  const b = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(300000);
  // Block outside audio in the game page only (the popup is another page).
  await p.route(/^https:\/\/(?!fonts\.)/, (r) => r.abort('blockedbyclient'));
  const popups = [];
  ctx.on('page', (pg) => {
    popups.push(pg);
    pg.on('framenavigated', (f) => f === pg.mainFrame() && console.log('ventana radio →', f.url().slice(0, 80)));
  });
  await p.goto(process.env.URL ?? 'http://localhost:4173/');
  await p.waitForFunction(() => window.__game?.climate, null, { timeout: 300000 });
  const state = () =>
    p.evaluate(() => ({
      name: document.querySelector('#radio .r-name')?.textContent,
      status: document.querySelector('#radio .r-state')?.textContent,
      offer: document.getElementById('radio').classList.contains('ext'),
    }));
  await p.evaluate(() => {
    const g = window.__game;
    g.begin();
    window.requestAnimationFrame = () => 0;
    localStorage.setItem('villarcayo.radio', 'los40');
    g.radio.index = 0;
    g.player.enterVehicle(g.vehicles[0]);
    for (let i = 0; i < 3; i++) g.update(1 / 60);
    document.exitPointerLock();
  });
  await p.waitForTimeout(3000);
  console.log('dentro', JSON.stringify(await state()));
  await p.click('#radio .r-ext');
  await p.waitForTimeout(2000);
  console.log('ventana', JSON.stringify(await state()), 'ventanas abiertas', popups.filter((x) => !x.isClosed()).length);
  const key = (k) =>
    p.evaluate((k) => {
      const g = window.__game;
      g.input.pressVirtual(k);
      g.update(1 / 60);
      g.input.releaseVirtual(k);
      g.update(1 / 60);
    }, k);
  await p.keyboard.press('KeyQ'); // a real key press gives the page the user activation window.open needs
  await key('KeyQ');
  await p.waitForTimeout(2000);
  console.log('Q', JSON.stringify(await state()), 'ventanas abiertas', popups.filter((x) => !x.isClosed()).length);
  await key('KeyX');
  await p.waitForTimeout(1000);
  console.log('X', JSON.stringify(await state()), 'ventanas abiertas', popups.filter((x) => !x.isClosed()).length);
  await b.close();
})();
