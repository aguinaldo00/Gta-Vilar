import { expect, test } from '@playwright/test';

/**
 * Drives the sedan flat out into real buildings from several approaches:
 * it must stop at the walls (never end inside a footprint) and bounce.
 */
test('vehicles collide with buildings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled, null, { timeout: 240_000 });
  const results = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    const g = (window as any).__game;
    g.begin();
    g.hours = 13;
    window.requestAnimationFrame = () => 0;
    const v = g.vehicles[0];
    const p = v.sidePoint(1);
    g.player.spawn(p.x, p.z, 0, 0);
    g.update(1 / 60);
    g.interaction.toggle();
    const inside = (x: number, z: number) =>
      g.world.map.buildings.some((b: { o: number[]; hp?: number; t: string }) => {
        if (b.hp || b.t === 'townhall' || b.t === 'canopy') return false;
        let c = false;
        for (let i = 0, j = b.o.length - 2; i < b.o.length; j = i, i += 2) {
          const [xi, zi, xj, zj] = [b.o[i], b.o[i + 1], b.o[j], b.o[j + 1]];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
        }
        return c;
      });
    const out: { from: number[]; end: number[]; inside: boolean; hit: boolean }[] = [];
    // Start on real streets around the centre and turn 90° off the road, into the blocks.
    const starts: [number, number, number][] = [];
    for (const [px, pz] of [
      [30, 20],
      [60, -100],
      [-40, 60],
      [0, -70],
      [100, 40],
      [-120, -20],
    ]) {
      const s = g.world.roadSpawn(px, pz, false);
      for (const side of [1, -1]) starts.push([s.x, s.z, s.heading + (side * Math.PI) / 2]);
    }
    for (const [x, z, h] of starts) {
      v.x = x;
      v.z = z;
      v.heading = h;
      v.vx = Math.sin(h) * 25;
      v.vz = Math.cos(h) * 25;
      v.yawRate = 0;
      let hit = false;
      for (let i = 0; i < 240; i++) {
        g.locomotion.step(1 / 60);
        if (v.impact > 3) hit = true;
        v.impact = 0;
      }
      out.push({ from: [x, z], end: [v.x, v.z], inside: inside(v.x, v.z), hit });
    }
    return out;
  });
  for (const r of results) expect(r.inside, `drove from ${r.from} into a building at ${r.end.map((n) => n.toFixed(1))}`).toBe(false);
  expect(results.filter((r) => r.hit).length).toBeGreaterThanOrEqual(6);
  expect(errors).toEqual([]);
});
