import { MAX_FRAME_DT, SIM_DT } from './config';

/**
 * Fixed-timestep accumulator. Frame deltas are clamped (tab switches, hitches) so a long
 * frame can never inject a burst of simulated time; the logic always runs in SIM_DT steps.
 */
export class FixedClock {
  private acc = 0;

  /** Returns interpolation alpha (0..1) for rendering between the last two logic steps. */
  advance(frameDt: number, step: (dt: number) => void): number {
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
    this.acc += dt;
    while (this.acc >= SIM_DT) {
      step(SIM_DT);
      this.acc -= SIM_DT;
    }
    return this.acc / SIM_DT;
  }

  reset(): void {
    this.acc = 0;
  }
}
