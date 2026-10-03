/**
 * Fixed-timestep accumulator: simulation runs at a constant rate regardless
 * of frame rate (deterministic physics), rendering runs once per frame.
 */
export class FixedStepLoop {
  private acc = 0;

  constructor(
    readonly step: number,
    private readonly maxSubSteps: number,
  ) {}

  /** Runs `fixed` as many whole steps as `dt` covers; returns the interpolation factor 0..1. */
  advance(dt: number, fixed: (step: number) => void): number {
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.step && n < this.maxSubSteps) {
      fixed(this.step);
      this.acc -= this.step;
      n++;
    }
    // Spiral of death guard: drop the backlog after a long stall.
    if (n === this.maxSubSteps) this.acc = 0;
    return this.acc / this.step;
  }
}
