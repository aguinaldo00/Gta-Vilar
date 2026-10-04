import { expect, test } from '@playwright/test';

/**
 * Boots the production build in a real browser (software WebGL), steps the
 * simulation deterministically through `window.__game` and checks the core
 * loop: spawn, walk, steal a car, drive, and no page errors.
 */
test('boots, walks, steals a car and drives', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled, null, { timeout: 240_000 });

  const state = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    const g = (window as any).__game;
    g.begin();
    g.hours = 13;
    window.requestAnimationFrame = () => 0;
    const step = (s: number) => {
      for (let i = 0; i < Math.round(s * 60); i++) g.update(1 / 60);
    };
    step(0.5);
    const spawn = g.player.pos.clone();
    const zone = g.world.zoneAt(spawn.x, spawn.z);
    const v = g.vehicles[0];
    const side = v.sidePoint(1);
    g.player.spawn(side.x, side.z, g.world.heightAt(side.x, side.z), 0);
    step(0.1);
    return { zone, spawnY: spawn.y, vehicles: g.vehicles.length };
  });
  expect(state.zone).toBe('Plaza Mayor');
  expect(state.vehicles).toBeGreaterThan(0);

  await page.keyboard.press('f');
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    const g = (window as any).__game;
    for (let i = 0; i < 12; i++) g.update(1 / 60);
  });
  await page.keyboard.down('w');
  const drive = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    const g = (window as any).__game;
    for (let i = 0; i < 180; i++) g.update(1 / 60);
    const v = g.player.vehicle;
    return v ? { kmh: v.speedKmh } : null;
  });
  await page.keyboard.up('w');
  expect(drive).not.toBeNull();
  expect(drive?.kmh ?? 0).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
