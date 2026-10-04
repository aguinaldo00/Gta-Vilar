import { describe, expect, it } from 'vitest';
import { type Agent, type AIHooks, panic, type Route, stepAgent, type VoiceKind } from '@/entities/PedestrianAI';

const route: Route = {
  pts: [
    [0, 0],
    [100, 0],
  ],
  len: [0, 100],
  side: 0,
};

const agent = (): Agent => ({
  x: 50,
  z: 0.6,
  y: 0,
  heading: 0,
  state: 'walk',
  timer: 0,
  route,
  s: 50,
  dir: 1,
  sideSign: 1,
  speed: 1.2,
  look: 0.3,
  nightOwl: false,
  vx: 0,
  vy: 0,
  vz: 0,
  spin: 0,
  tumble: 0,
  tx: 0,
  tz: 0,
});

const hooks = (said: VoiceKind[]): AIHooks => ({
  voice: (k) => said.push(k),
  shelter: () => ({ x: 60, z: 20 }),
  groundAt: () => 0,
  rnd: () => 0.4,
});

describe('pedestrian AI', () => {
  it('walks along its route', () => {
    const a = agent();
    const said: VoiceKind[] = [];
    for (let i = 0; i < 60; i++) stepAgent(a, 1 / 60, [], hooks(said));
    expect(a.s).toBeGreaterThan(50.9);
    expect(a.state).toBe('walk');
  });

  it('jumps aside from a car coming fast, shouting, then goes back', () => {
    const a = agent();
    const said: VoiceKind[] = [];
    const car = { x: 50, z: -8, vx: 0, vz: 14, speed: 14, impact: 0, radius: 2.3 };
    stepAgent(a, 1 / 60, [car], hooks(said));
    expect(a.state).toBe('flee');
    expect(said.length).toBe(1);
    for (let i = 0; i < 60 * 5; i++) stepAgent(a, 1 / 60, [], hooks(said));
    expect(['return', 'walk']).toContain(a.state);
  });

  it('is thrown through the air when hit, lies down, then gets up', () => {
    const a = agent();
    const said: VoiceKind[] = [];
    const car = { x: 50, z: 0, vx: 0, vz: 12, speed: 12, impact: 0, radius: 2.3 };
    stepAgent(a, 1 / 60, [car], hooks(said));
    expect(a.state).toBe('ragdoll');
    expect(said).toContain('dolor');
    expect(car.speed).toBeLessThan(12);
    let maxY = 0;
    for (let i = 0; i < 60 * 4; i++) {
      stepAgent(a, 1 / 60, [], hooks(said));
      maxY = Math.max(maxY, a.y);
    }
    expect(maxY).toBeGreaterThan(0.5);
    expect(a.z).toBeGreaterThan(3);
    for (let i = 0; i < 60 * 12; i++) stepAgent(a, 1 / 60, [], hooks(said));
    expect(['return', 'walk']).toContain(a.state);
  });

  it('panics and runs for shelter, then hides', () => {
    const a = agent();
    const said: VoiceKind[] = [];
    panic(a, hooks(said));
    expect(a.state).toBe('panic');
    expect(said).toContain('panico');
    for (let i = 0; i < 60 * 8; i++) stepAgent(a, 1 / 60, [], hooks(said));
    expect(a.state).toBe('hide');
  });
});
