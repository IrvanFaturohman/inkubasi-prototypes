import { describe, expect, it } from 'vitest';
import { AREAS } from '../src/game/config';
import { GameSim } from '../src/game/GameSim';
import { DT, MAX_GRAZE, driveToPad, maxCellPenetration, wander } from './harness';

describe('No trapping', () => {
  // A reasonable driver (route-following with pure pursuit) gets home with a
  // full bin after erratic random-walk harvesting.
  for (let areaIndex = 0; areaIndex < AREAS.length; areaIndex++) {
    for (const seed of [11, 29, 47]) {
      it(`area ${areaIndex + 1}, wander seed ${seed}: full truck drives back to SELL`, () => {
        const sim = new GameSim();
        sim.loadArea(areaIndex, AREAS[areaIndex].seed);
        wander(sim, seed, 90);
        expect(sim.field.destroyedLayers).toBeGreaterThan(20);
        expect(driveToPad(sim, 90)).toBe(true);
      });
    }
  }

  // Guarantee: however twisted the carved pocket, the truck's own track is a
  // collision-free way back to the depot, and the truck can execute it.
  for (let areaIndex = 0; areaIndex < AREAS.length; areaIndex++) {
    for (const seed of [3, 5, 71, 89, 101, 123, 151]) {
      it(`area ${areaIndex + 1}, wander seed ${seed}: full track retrace returns to the depot`, () => {
        const sim = new GameSim();
        sim.loadArea(areaIndex, AREAS[areaIndex].seed);
        const spawn = sim.depot.layout.spawn;
        wander(sim, seed, 90);
        sim.vehicle.retraceAll();
        expect(sim.vehicle.retracing).toBe(true);
        for (let s = 0; s < 60 * 200 && sim.vehicle.retracing; s++) {
          sim.update(DT, { x: 0, y: 1, mag: 1 });
          expect(maxCellPenetration(sim)).toBeLessThan(MAX_GRAZE);
        }
        expect(sim.vehicle.retracing).toBe(false);
        expect(Math.hypot(sim.vehicle.x - spawn.x, sim.vehicle.z - spawn.z)).toBeLessThan(1.5);
      });
    }
  }
});
