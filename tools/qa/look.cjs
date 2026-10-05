// Screenshots of the town from fixed viewpoints, for visual checks.
//   npm run build && npx vite preview --port 4173 &
//   HOURS=19.5 WEATHER=nublado node tools/qa/look.cjs out/ plaza 60 -40 25 0 0 [name x z h tx tz ...]
// Camera at (x, ground + h, z) looking at (tx, ground, tz). HOURS (default 13) and
// TOUCH=1 shoots on a phone; TY raises the point looked at (m above the ground). WEATHER (despejado, nublado, lluvia, lluvia_fuerte, niebla; default despejado) set the scene.
// Prints the page errors at the end (an empty list is a pass).
let chromium, devices;
try {
  ({ chromium, devices } = require('playwright'));
} catch {
  ({ chromium, devices } = require('/opt/node22/lib/node_modules/playwright'));
}
const [dir, ...rest] = process.argv.slice(2);
const views = [];
for (let i = 0; i < rest.length; i += 6) views.push([rest[i], ...rest.slice(i + 1, i + 6).map(Number)]);
const hours = Number(process.env.HOURS ?? 13);
const weather = process.env.WEATHER ?? 'despejado';
const url = process.env.URL ?? 'http://localhost:4173/';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  // TOUCH=1: a phone (touch quality profile).
  const page = await browser.newPage(process.env.TOUCH ? { ...devices['Pixel 7 landscape'] } : { viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.climate, null, { timeout: 300000 });
  await page.addStyleTag({ content: '#start,#menu,#fade{display:none!important}' });
  await page.evaluate(
    ([hours, weather]) => {
      const g = window.__game;
      g.begin();
      window.requestAnimationFrame = () => 0;
      g.followCam.update = () => {};
      g.climate.dynamic = false;
      g.climate.setWeather(weather, true);
      g.hours = hours;
    },
    [hours, weather],
  );
  for (const [name, x, z, h, tx, tz] of views) {
    await page.evaluate(
      ([x, z, h, tx, tz, ty]) => {
        const g = window.__game;
        g.player.spawn(tx, tz, g.world.heightAt(tx, tz), 0);
        for (let i = 0; i < 5; i++) g.update(1 / 60);
        g.camera.position.set(x, g.world.heightAt(x, z) + h, z);
        g.camera.lookAt(tx, g.world.heightAt(tx, tz) + ty, tz);
        g.world.env.update(0, g.camera.position.clone(), g.camera);
        g.pipeline.render();
      },
      [x, z, h, tx, tz, Number(process.env.TY ?? 0)],
    );
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
  console.log('ERRORS', JSON.stringify(errors));
  await browser.close();
})();
