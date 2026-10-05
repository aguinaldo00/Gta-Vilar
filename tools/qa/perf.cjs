// Draw calls and triangles at fixed viewpoints (desktop, or a phone with TOUCH=1).
//   node tools/qa/perf.cjs "x,z,h,tx,tz ..."
let chromium, devices;
try {
  ({ chromium, devices } = require('playwright'));
} catch {
  ({ chromium, devices } = require('/opt/node22/lib/node_modules/playwright'));
}
const views = (process.argv[2] ?? '0,40,6,0,0')
  .trim()
  .split(/\s+/)
  .map((v) => v.split(',').map(Number));
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext(process.env.TOUCH ? { ...devices['Pixel 7 landscape'] } : { viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(300000);
  await p.route(/^https:\/\/(?!fonts\.)/, (r) => r.abort('blockedbyclient'));
  if (process.env.BD)
    await p.addInitScript(() => {
      window.__BD = 1;
    });
  await p.goto(process.env.URL ?? 'http://localhost:4173/');
  await p.waitForFunction(() => window.__game?.climate, null, { timeout: 300000 });
  const out = await p.evaluate((views) => {
    const g = window.__game;
    g.begin();
    window.requestAnimationFrame = () => 0;
    const r = [];
    for (const [x, z, h, tx, tz] of views) {
      g.player.teleport?.(x, z);
      for (let i = 0; i < 5; i++) g.update(1 / 60);
      const y = g.world.heightAt(x, z) + h;
      g.camera.position.set(x, y, z);
      g.camera.lookAt(tx, g.world.heightAt(tx, tz) + 2, tz);
      g.camera.updateMatrixWorld();
      g.world.trees?.update?.(g.camera.position);
      g.world.breakables.cull?.(g.camera.position);
      const by = {};
      if (window.__BD)
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.onBeforeRender = (_r, _s, _c, geo) => {
            const k = o.name || o.material?.name || o.parent?.name || '?';
            const t = ((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
            by[k] = by[k] || [0, 0];
            by[k][0]++;
            by[k][1] += t;
          };
        });
      g.renderer.info.reset();
      g.renderer.info.autoReset = false;
      const t0 = performance.now();
      g.pipeline.render();
      const ms = performance.now() - t0;
      r.push(
        `(${x},${z}) calls ${g.renderer.info.render.calls} tris ${(g.renderer.info.render.triangles / 1e6).toFixed(2)}M cpu ${ms.toFixed(0)}ms`,
      );
      if (window.__BD)
        r.push(
          '   ' +
            Object.entries(by)
              .sort((a, b) => b[1][1] - a[1][1])
              .slice(0, 14)
              .map(([k, [c, t]]) => `${k}:${c}/${(t / 1e3).toFixed(0)}k`)
              .join(' '),
        );
    }
    r.push(`breakables ${g.world.breakables.count}; trees ${JSON.stringify(g.world.trees?.counts)}`);
    return r;
  }, views);
  console.log(out.join('\n'));
  await b.close();
})();
