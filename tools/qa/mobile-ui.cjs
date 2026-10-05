// Phone screenshots of the main menu, the on-foot HUD and the in-car HUD, portrait and landscape.
//   npx vite preview --port 4173 &  node tools/qa/mobile-ui.cjs <out-dir>
let chromium, devices;
try {
  ({ chromium, devices } = require('playwright'));
} catch {
  ({ chromium, devices } = require('/opt/node22/lib/node_modules/playwright'));
}
(async () => {
  const dir = process.argv[2] ?? '.';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const dev of (process.env.DEVICES ?? 'Pixel 7,Pixel 7 landscape').split(',')) {
    const ctx = await b.newContext({ ...devices[dev] });
    const p = await ctx.newPage();
    p.setDefaultTimeout(300000);
    await p.route(/^https:\/\/(?!fonts\.)/, (r) => r.abort('blockedbyclient'));
    await p.goto(process.env.URL ?? 'http://localhost:4173/');
    await p.waitForFunction(() => window.__game?.climate, null, { timeout: 300000 });
    await p.waitForTimeout(1500);
    const tag = `${dev.includes('iPad') ? 'tab_' : ''}${dev.includes('landscape') ? 'h' : 'v'}`;
    await p.screenshot({ path: `${dir}/m_${tag}_menu.png` });
    await p.evaluate(() => {
      const g = window.__game;
      g.begin();
      window.requestAnimationFrame = () => 0;
      g.hours = 13;
      for (let i = 0; i < 30; i++) g.update(1 / 60);
      g.pipeline.render();
    });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${dir}/m_${tag}_pie.png` });
    await p.evaluate(() => {
      const g = window.__game;
      g.player.enterVehicle(g.vehicles[0]);
      for (let i = 0; i < 30; i++) g.update(1 / 60);
      g.pipeline.render();
    });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${dir}/m_${tag}_coche.png` });
    await ctx.close();
  }
  await b.close();
})();
