// Drives a car along waypoints (steering towards each) and reports where it gets stuck.
//   node tools/qa/drive-route.cjs "x,z x,z ..."
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
const route = (process.argv[2] ?? '')
  .trim()
  .split(/\s+/)
  .map((p) => p.split(',').map(Number));
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.setDefaultTimeout(300000);
  await p.goto(process.env.URL ?? 'http://localhost:4173/');
  await p.waitForFunction(() => window.__game?.climate, null, { timeout: 300000 });
  const log = await p.evaluate((route) => {
    const g = window.__game;
    g.begin();
    window.requestAnimationFrame = () => 0;
    const v = g.vehicles.find((c) => c.spec.id === 'sedan') ?? g.vehicles[0];
    const [x0, z0] = route[0],
      [x1, z1] = route[1];
    v.teleport
      ? v.teleport(x0, z0, Math.atan2(x1 - x0, z1 - z0))
      : Object.assign(v, { x: x0, z: z0, heading: Math.atan2(x1 - x0, z1 - z0), vx: 0, vz: 0 });
    g.player.enterVehicle(v);
    // Remember where the body last touched something, to name what blocks a stuck car.
    let touch = [];
    const body = v.body;
    if (body) {
      const move = body.move.bind(body);
      body.move = (...a) => {
        const r = move(...a);
        if (r.contacts.length)
          touch = r.contacts.map((c) => `(${c.px?.toFixed(1)},${c.pz?.toFixed(1)}) n=(${c.nx.toFixed(2)},${c.nz.toFixed(2)})`);
        return r;
      };
    }
    const out = [];
    for (const [tx, tz] of route.slice(1)) {
      let ok = false,
        best = Number.POSITIVE_INFINITY,
        still = 0,
        backs = 0;
      for (let f = 0; f < 60 * 40; f++) {
        const d = Math.hypot(tx - v.x, tz - v.z);
        if (d < 2) {
          ok = true;
          break;
        }
        let err = Math.atan2(tx - v.x, tz - v.z) - v.heading;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) g.input.releaseVirtual(k);
        if (still > 120 && backs < 4) {
          // Stuck against something: back up a little with the wheel the other way, as a driver would.
          backs++;
          still = 0;
          for (let r = 0; r < 70; r++) {
            for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) g.input.releaseVirtual(k);
            if (Math.abs(v.speed) < 2.5) g.input.pressVirtual('KeyS');
            g.input.pressVirtual(err > 0 ? 'KeyD' : 'KeyA');
            g.update(1 / 60);
          }
          continue;
        }
        // Slow down for sharp turns (a gateway off the street, the car wash).
        if (Math.abs(v.speed) < (Math.abs(err) > 0.7 ? 1.6 : 4)) g.input.pressVirtual('KeyW');
        if (err > 0.08) g.input.pressVirtual('KeyA');
        else if (err < -0.08) g.input.pressVirtual('KeyD');
        g.update(1 / 60);
        if (d < best - 0.05) {
          best = d;
          still = 0;
        } else if (++still > 180 && backs >= 4) break;
      }
      out.push(
        `${ok ? 'OK ' : 'ATASCADO'} → (${tx},${tz}) en (${v.x.toFixed(1)},${v.z.toFixed(1)})${ok ? '' : ` rumbo ${v.heading.toFixed(2)} contactos ${touch.join(' ')}`}`,
      );
      if (!ok) break;
    }
    for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) g.input.releaseVirtual(k);
    return out;
  }, route);
  for (const l of log) console.log('   ', l);
  await b.close();
})();
