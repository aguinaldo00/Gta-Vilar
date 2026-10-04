// Phone check of the car radio: landscape phone with touch, in a car; screenshot and taps on the panel.
//   npx vite preview --port 4173 &  node tools/qa/mobile-radio.cjs <out-dir>
let chromium, devices;
try {
  ({ chromium, devices } = require('playwright'));
} catch {
  ({ chromium, devices } = require('/opt/node22/lib/node_modules/playwright'));
}
(async () => {
  const dir = process.argv[2] ?? '.';
  const b = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await b.newContext({ ...devices['Pixel 7 landscape'] });
  const p = await ctx.newPage();
  p.setDefaultTimeout(300000);
  await p.route(/^https:\/\/(?!fonts\.)/, (r) => r.abort('blockedbyclient'));
  await p.goto(process.env.URL ?? 'http://localhost:4173/');
  await p.waitForFunction(() => window.__game?.climate, null, { timeout: 300000 });
  await p.evaluate(() => {
    const g = window.__game;
    g.begin();
    window.requestAnimationFrame = () => 0;
    g.hours = 13;
    g.player.enterVehicle(g.vehicles[0]);
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    g.pipeline.render();
  });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${dir}/movil_radio.png` });
  const info = await p.evaluate(() => {
    const r = document.getElementById('radio').getBoundingClientRect();
    const hit = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return 'no existe';
      const b = el.getBoundingClientRect();
      if (!b.width) return 'oculto';
      const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return top === el || el.contains(top) ? 'ok' : `tapado por ${top?.tagName}#${top?.id}.${top?.className}`;
    };
    return {
      viewport: [innerWidth, innerHeight],
      panel: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      next: hit('#radio .r-next'),
      prev: hit('#radio .r-prev'),
      power: hit('#radio .r-power'),
      ext: hit('#radio .r-ext'),
      card: hit('#radio .r-card'),
    };
  });
  console.log(JSON.stringify(info));
  await p.tap('#radio .r-next');
  await p.waitForTimeout(800);
  console.log('tras tocar ›', await p.evaluate(() => document.querySelector('#radio .r-name').textContent));
  await p.tap('#radio .r-power');
  await p.waitForTimeout(800);
  console.log('tras tocar ⏻', await p.evaluate(() => window.__game.radio.on));
  await b.close();
})();
