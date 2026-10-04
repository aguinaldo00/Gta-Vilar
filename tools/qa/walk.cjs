// Walks the player along waypoints and reports where they get stuck (paths that must stay open).
//   node tools/qa/walk.cjs "x,z x,z x,z ..."   (several routes separated by " | ")
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const routes = (process.argv[2] ?? '').split('|').map((r) =>
  r
    .trim()
    .split(/\s+/)
    .map((p) => p.split(',').map(Number)),
);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.setDefaultTimeout(300000);
  await p.goto(process.env.URL ?? 'http://localhost:4173/');
  await p.waitForFunction(() => window.__game?.climate, null, { timeout: 300000 });
  for (const route of routes) {
    const res = await p.evaluate((route) => {
      const g = window.__game;
      if (!g.running) g.begin();
      window.requestAnimationFrame = () => 0;
      const [x0, z0] = route[0];
      g.player.spawn(x0, z0, g.world.heightAt(x0, z0), 0);
      const log = [];
      for (const [tx, tz] of route.slice(1)) {
        let best = Infinity,
          still = 0,
          ok = false;
        for (let f = 0; f < 60 * 40; f++) {
          const pos = g.player.pos;
          const d = Math.hypot(tx - pos.x, tz - pos.z);
          if (d < 1.2) {
            ok = true;
            break;
          }
          // The camera looks back at the player: W walks away from the camera.
          g.followCam.yaw = Math.atan2(pos.x - tx, pos.z - tz);
          g.input.pressVirtual('KeyW');
          g.update(1 / 60);
          if (d < best - 0.05) {
            best = d;
            still = 0;
          } else if (++still > 120) break;
        }
        g.input.releaseVirtual('KeyW');
        const pos = g.player.pos;
        log.push(`${ok ? 'OK ' : 'ATASCADO'} → (${tx},${tz}) en (${pos.x.toFixed(1)},${pos.z.toFixed(1)})`);
        if (!ok) break;
      }
      return log;
    }, route);
    console.log(route.map((q) => q.join(',')).join(' → '));
    for (const l of res) console.log('   ', l);
  }
  await b.close();
})();
