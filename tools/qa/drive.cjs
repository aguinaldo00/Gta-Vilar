// Vehicle physics check: 0–50 km/h time and the 50–0 braking distance, dry and wet.
//   npx vite preview --port 4173 &  node tools/qa/drive.cjs
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.setDefaultTimeout(300000);
  await p.goto(process.env.URL ?? 'http://localhost:4173/');
  await p.waitForFunction(() => window.__game?.climate, null, { timeout: 300000 });
  const res = await p.evaluate(() => {
    const g = window.__game;
    g.begin();
    window.requestAnimationFrame = () => 0;
    const v = g.vehicles.find((c) => c.spec.id !== 'tractor') ?? g.vehicles[0];
    const run = (wet) => {
      g.world.wetness = wet;
      const sx = v.x,
        sz = v.z;
      const out = { surface: g.world.surfaceAt(v.x, v.z), wet };
      let t = 0;
      for (; t < 20 && v.speedKmh < 50; t += 1 / 60) v.update(1 / 60, { throttle: 1, steer: 0, handbrake: false }, g.world);
      out.t0_50 = +t.toFixed(2);
      const bx = v.x,
        bz = v.z;
      for (let i = 0; i < 1200 && v.speedKmh > 0.5; i++) v.update(1 / 60, { throttle: -1, steer: 0, handbrake: false }, g.world);
      out.brake50 = +Math.hypot(v.x - bx, v.z - bz).toFixed(1);
      out.total = +Math.hypot(v.x - sx, v.z - sz).toFixed(1);
      return out;
    };
    return [v.spec.id, run(0), run(1)];
  });
  console.log(JSON.stringify(res));
  await b.close();
})();
