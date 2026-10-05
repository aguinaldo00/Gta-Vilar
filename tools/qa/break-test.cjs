// Drives a car at each target and reports whether the breakables there were knocked down.
//   node tools/qa/break-test.cjs "x,z,fromX,fromZ x,z,fromX,fromZ ..."   (car starts at from, aims at x,z)
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const targets = (process.argv[2] ?? '')
  .trim()
  .split(/\s+/)
  .map((p) => p.split(',').map(Number));
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 320, height: 200 } });
  p.setDefaultTimeout(300000);
  await p.goto(process.env.URL ?? 'http://localhost:4173/');
  await p.waitForFunction(() => window.__game?.climate, null, { timeout: 300000 });
  const out = await p.evaluate((targets) => {
    const g = window.__game;
    g.begin();
    window.requestAnimationFrame = () => 0;
    const v = g.vehicles.find((c) => c.spec.id === 'sedan') ?? g.vehicles[0];
    g.player.enterVehicle(v);
    const items = g.world.breakables.items;
    const res = [];
    for (const [tx, tz, fx, fz] of targets) {
      const near = items.filter((it) => Math.hypot(it.x - tx, it.z - tz) < 2.5);
      const h = Math.atan2(tx - fx, tz - fz);
      v.teleport ? v.teleport(fx, fz, h) : Object.assign(v, { x: fx, z: fz, heading: h, vx: 0, vz: 0 });
      g.input.pressVirtual('KeyW');
      let minD = 1e9;
      for (let f = 0; f < 60 * 5; f++) {
        g.update(1 / 60);
        minD = Math.min(minD, Math.hypot(v.x - tx, v.z - tz));
      }
      g.input.releaseVirtual('KeyW');
      res.push(
        `(${tx},${tz}): ${near.length} cerca, ${near.filter((it) => it.t >= 0).length} derribados; el coche pasó a ${minD.toFixed(1)} m; velocidad ${v.speed.toFixed(1)}`,
      );
    }
    return res;
  }, targets);
  console.log(out.join('\n'));
  await b.close();
})();
