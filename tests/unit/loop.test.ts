import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/EventBus';
import { FixedStepLoop } from '@/core/FixedStepLoop';

describe('FixedStepLoop', () => {
  it('runs whole steps and carries the remainder', () => {
    const loop = new FixedStepLoop(0.01, 10);
    let n = 0;
    const alpha = loop.advance(0.035, () => n++);
    expect(n).toBe(3);
    expect(alpha).toBeCloseTo(0.5);
    loop.advance(0.005, () => n++);
    expect(n).toBe(4);
  });

  it('drops the backlog after a stall', () => {
    const loop = new FixedStepLoop(0.01, 5);
    let n = 0;
    loop.advance(1, () => n++);
    expect(n).toBe(5);
    loop.advance(0.001, () => n++);
    expect(n).toBe(5);
  });
});

describe('EventBus', () => {
  it('delivers typed events and unsubscribes', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    const got: number[] = [];
    const off = bus.on('ping', (e) => got.push(e.n));
    bus.emit('ping', { n: 1 });
    off();
    bus.emit('ping', { n: 2 });
    expect(got).toEqual([1]);
  });
});
