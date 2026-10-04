// Radio check: gets into a car, lists what plays, presses X (off), X (on), Q, and the ⏻ button.
//   npx vite preview --port 4173 &  node tools/qa/radio.cjs
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
(async () => {
  const b = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      ...(process.env.INSECURE ? ['--ignore-certificate-errors'] : []),
    ],
  });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.setDefaultTimeout(300000);
  await p.goto(process.env.URL ?? 'http://localhost:4173/');
  await p.waitForFunction(() => window.__game?.climate, null, { timeout: 300000 });
  await p.evaluate(() => {
    const g = window.__game;
    g.begin();
    window.requestAnimationFrame = () => 0;
    window.__step = (n = 10) => {
      for (let i = 0; i < n; i++) g.update(1 / 60);
    };
    window.__radio = () => {
      const r = g.radio;
      const a = r.audio;
      return {
        station: r.current.id,
        on: r.on,
        synth: r.synth ? r.synth.timer !== null : null,
        audioPlaying: !!a.src && !a.paused,
        src: a.currentSrc.slice(0, 70),
        status: document.querySelector('#radio .r-state')?.textContent,
        panel: document.querySelector('#radio .r-name')?.textContent,
        offClass: document.getElementById('radio').classList.contains('off'),
      };
    };
  });
  const log = async (label, wait = 0) => {
    if (wait) await p.waitForTimeout(wait);
    console.log(label.padEnd(14), JSON.stringify(await p.evaluate(() => window.__radio())));
  };
  await p.evaluate(() => {
    const g = window.__game;
    localStorage.setItem('villarcayo.radio', 'los40');
    g.radio.index = 0;
    g.player.enterVehicle(g.vehicles[0]);
    window.__step(3);
  });
  await log('dentro', 6000);
  const key = async (k) => {
    await p.evaluate((k) => {
      const g = window.__game;
      g.input.pressVirtual(k);
      window.__step(1);
      g.input.releaseVirtual?.(k);
      window.__step(1);
    }, k);
  };
  await key('KeyX');
  await log('X (apagar)', 600);
  await key('KeyX');
  await log('X (encender)', 6000);
  for (let i = 0; i < Number(process.env.STATIONS ?? 4); i++) {
    await key('KeyQ');
    await log(`Q ${i + 1}`, 6000);
  }
  await p.mouse.move(640, 400);
  await p.waitForTimeout(5000); // the panel settles (smaller)
  console.log(
    'hit',
    await p.evaluate(() => {
      const el = document.querySelector('#radio .r-power');
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const hud = document.getElementById('hud');
      return JSON.stringify({
        locked: !!document.pointerLockElement,
        r: [r.x, r.y, r.width, r.height],
        top: `${top?.tagName}#${top?.id}.${top?.className}`,
        radio: document.getElementById('radio').className,
        hud: hud.className,
        hudZ: getComputedStyle(hud).zIndex,
      });
    }),
  );
  const clickPower = async () => {
    const r = await p.evaluate(() => {
      const b = document.querySelector('#radio .r-power').getBoundingClientRect();
      return [b.x + b.width / 2, b.y + b.height / 2];
    });
    await p.mouse.click(r[0], r[1]);
  };
  if (process.env.DEBUG) {
    p.on('console', (m) => console.log('page:', m.text()));
    await p.evaluate(() => {
      for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click'])
        document.addEventListener(t, (e) => console.log(t, e.target.tagName, e.target.className), true);
    });
  }
  await p.mouse.click(640, 400, { button: 'middle' });
  await log('rueda (apagar)', 600);
  await log('rueda +1.5s', 1500);
  await p.mouse.click(640, 400, { button: 'middle' });
  await log('rueda (encend.)', 3000);
  // Without pointer lock (Esc), the ⏻ button takes the click.
  await p.evaluate(() => document.exitPointerLock());
  await p.waitForTimeout(300);
  await clickPower();
  await log('⏻ (apagar)', 600);
  await clickPower();
  await log('⏻ (encender)', 3000);
  await b.close();
})();
