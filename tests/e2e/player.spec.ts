import { expect, type Page, test } from '@playwright/test';

/**
 * Steps the game `s` seconds while `keys` are held. Keys go through the same
 * virtual-key path as the touch buttons (real keyboard input is covered by
 * the smoke test), which keeps this long test fast and stable.
 */
async function run(page: Page, s: number, keys: string[] = []): Promise<void> {
  await page.evaluate(
    ([s, keys]) => {
      // biome-ignore lint/suspicious/noExplicitAny: test hook
      const g = (window as any).__game;
      for (const k of keys as string[]) g.input.pressVirtual(k);
      for (let i = 0; i < Math.round((s as number) * 60); i++) g.update(1 / 60);
      for (const k of keys as string[]) g.input.releaseVirtual(k);
    },
    [s, keys] as const,
  );
}

/** Puts the player at (x, z) with the camera (and so "forward") looking along (dx, dz). */
async function place(page: Page, x: number, z: number, dx: number, dz: number): Promise<void> {
  await page.evaluate(
    ([x, z, dx, dz]) => {
      // biome-ignore lint/suspicious/noExplicitAny: test hook
      const g = (window as any).__game;
      g.player.spawn(x, z, g.world.heightAt(x, z), Math.atan2(dx, dz));
      g.followCam.yaw = Math.atan2(dx, dz);
    },
    [x, z, dx, dz],
  );
}

const state = (page: Page) =>
  page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    const g = (window as any).__game;
    const p = g.player.pos;
    // Inside any building footprint? (Not the Ayuntamiento: its arcade, the soportales, is walkable.)
    const inside = g.world.map.buildings.some((b: { o: number[]; hp?: number; t: string }) => {
      if (b.hp || b.t === 'townhall') return false;
      let c = false;
      for (let i = 0, j = b.o.length - 2; i < b.o.length; j = i, i += 2) {
        const [xi, zi, xj, zj] = [b.o[i], b.o[i + 1], b.o[j], b.o[j + 1]];
        if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    });
    return { x: p.x, y: p.y, z: p.z, state: g.player.state, inside };
  });

test('player physics: walls, jumping, swimming', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled, null, { timeout: 240_000 });
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    (window as any).__game.begin();
    // Deterministic light: midday (the clock otherwise starts at the local time).
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    (window as any).__game.hours = 13;
    window.requestAnimationFrame = () => 0;
  });

  // Walk into the buildings around the plaza in several directions: never end up inside one.
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    await place(page, 4, 14, dx, dz);
    await run(page, 0.2);
    await run(page, 6, ['ShiftLeft', 'KeyW']);
    const s = await state(page);
    expect(s.inside, `walking ${dx},${dz} ended inside a building at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBe(false);
  }

  // Jump.
  await place(page, 4, 14, 1, 0);
  await run(page, 0.3);
  const y0 = (await state(page)).y;
  await run(page, 0.25, ['Space']);
  expect((await state(page)).y).toBeGreaterThan(y0 + 0.5);
  await run(page, 1.5);
  expect((await state(page)).y).toBeCloseTo(y0, 0);

  // Swim in the natural pools of the Río Nela.
  await place(page, -300, -440, 1, 0);
  await run(page, 1.5);
  expect((await state(page)).state).toBe('swim');

  expect(errors).toEqual([]);
});
