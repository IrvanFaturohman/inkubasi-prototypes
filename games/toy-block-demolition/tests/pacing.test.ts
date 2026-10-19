import { describe, expect, it } from 'vitest';
import { AREAS, UPGRADE_KEYS } from '../src/game/config';
import { GameSim } from '../src/game/GameSim';
import { upgradePrice } from '../src/game/state';
import { DT, driveTo, driveToPad } from './harness';

/**
 * A simple bot plays the whole prototype headlessly: serpentine lanes as wide
 * as the current roller, sells when full, buys the cheapest affordable upgrade,
 * clears stragglers, drives through the gate. It drives better than a relaxed
 * human, so its times are a lower bound for real first-play pacing.
 */
interface Pacing {
  firstBreak: number;
  firstFull: number;
  firstSale: number;
  firstUpgrade: number;
  areaSeconds: number[];
  trips: number[];
  upgradesAtAreaEnd: number[];
  total: number;
}

function play(): Pacing {
  const sim = new GameSim();
  const out: Pacing = { firstBreak: -1, firstFull: -1, firstSale: -1, firstUpgrade: -1, areaSeconds: [], trips: [], upgradesAtAreaEnd: [], total: 0 };
  let t = 0;
  const step = (x: number, y: number, mag: number) => {
    sim.update(DT, { x, y, mag });
    t += DT;
    for (const e of sim.events) {
      if (e.type === 'break' && out.firstBreak < 0) out.firstBreak = t;
      if (e.type === 'full' && out.firstFull < 0) out.firstFull = t;
      if (e.type === 'unloadDone' && out.firstSale < 0) out.firstSale = t;
    }
    sim.events.length = 0;
  };
  const steerTo = (tx: number, tz: number) => {
    const v = sim.vehicle;
    const dx = tx - v.x;
    const dz = tz - v.z;
    const d = Math.hypot(dx, dz) || 1;
    step(dx / d, dz / d, 1);
  };
  // driveTo counts its own steps; mirror them into the clock.
  const plannedDrive = (fn: () => number) => {
    const before = sim.stepIndex;
    const r = fn();
    t += (sim.stepIndex - before) * DT;
    for (const e of sim.events) if (e.type === 'unloadDone' && out.firstSale < 0) out.firstSale = t;
    sim.events.length = 0;
    return r;
  };
  const buyAll = () => {
    for (;;) {
      let best: (typeof UPGRADE_KEYS)[number] | null = null;
      let bestPrice = Infinity;
      for (const k of UPGRADE_KEYS) {
        const p = upgradePrice(sim.progress, k);
        if (p !== null && p <= sim.progress.coins && p < bestPrice) {
          best = k;
          bestPrice = p;
        }
      }
      if (!best) return;
      sim.buy(best);
      if (out.firstUpgrade < 0) out.firstUpgrade = t;
    }
  };
  const sell = () => {
    plannedDrive(() => (driveToPad(sim, 120) ? 0 : -1));
    for (let s = 0; s < 60 * 8 && (sim.ledger.total > 0 || sim.depot.unloading); s++) step(0, 0, 0);
    buyAll();
  };

  for (let area = 0; area < AREAS.length; area++) {
    const areaStart = t;
    let trips = 0;
    const f = sim.field;
    const laneHasBlocks = (x: number, half: number) => {
      for (let i = 0; i < f.n; i++) if (f.remaining[i] > 0 && Math.abs(f.centerX(i) - x) <= half) return true;
      return false;
    };
    let guard = 0;
    while (f.remainingLayers > 0 && guard++ < 400) {
      // Harvest until full or nothing left.
      const w = sim.rollerWidth;
      const spacing = w + 0.3;
      const lanes: number[] = [];
      for (let x = f.originX + w / 2; x < f.originX + f.width; x += spacing) lanes.push(Math.min(x, f.originX + f.width - w / 2));
      let progressed = false;
      for (const lx of lanes) {
        if (sim.ledger.isFull || f.remainingLayers === 0) break;
        if (!laneHasBlocks(lx, w / 2)) continue;
        progressed = true;
        const north = f.originZ + 0.5;
        const south = -0.4;
        const firstEnd = Math.abs(sim.vehicle.z - south) < Math.abs(sim.vehicle.z - north) ? south : north;
        for (const tz of [firstEnd, firstEnd === south ? north : south]) {
          for (let s = 0; s < 60 * 40 && !sim.ledger.isFull; s++) {
            if (Math.hypot(sim.vehicle.x - lx, sim.vehicle.z - tz) < 0.6) break;
            steerTo(lx, tz);
          }
          if (sim.ledger.isFull) break;
        }
      }
      if (!progressed && !sim.ledger.isFull) {
        // Stragglers: head for the nearest remaining cell.
        const cells = f.listRemainingCells(f.n);
        let best = cells[0];
        let bd = Infinity;
        for (const i of cells) {
          const d = Math.hypot(f.centerX(i) - sim.vehicle.x, f.centerZ(i) - sim.vehicle.z);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        const i0 = best;
        for (let s = 0; s < 60 * 20 && f.remaining[i0] > 0 && !sim.ledger.isFull; s++) steerTo(f.centerX(i0), f.centerZ(i0));
      }
      if (sim.ledger.isFull || f.remainingLayers === 0) {
        trips++;
        sell();
      }
    }
    if (sim.ledger.total > 0) sell();
    out.trips.push(trips);
    out.upgradesAtAreaEnd.push(UPGRADE_KEYS.reduce((a, k) => a + sim.progress.upgrades[k], 0));
    out.areaSeconds.push(t - areaStart);
    if (area < AREAS.length - 1) {
      const g = sim.depot.layout.gate;
      plannedDrive(() => driveTo(sim, g.x, g.z + 1.2, () => sim.gateTriggered, 60, false));
      t += 0.75; // fade transition
      sim.advanceArea();
    }
  }
  out.total = t;
  return out;
}

describe('Pacing (bot playthrough, lower bound for humans)', () => {
  it('completes all three areas with first-loop timings in the intended ranges', () => {
    const p = play();
    const r = (n: number) => Math.round(n * 10) / 10;
    console.log(
      JSON.stringify({
        firstBreak: r(p.firstBreak),
        firstFull: r(p.firstFull),
        firstSale: r(p.firstSale),
        firstUpgrade: r(p.firstUpgrade),
        areaSeconds: p.areaSeconds.map(r),
        trips: p.trips,
        upgradesAtAreaEnd: p.upgradesAtAreaEnd,
        totalMinutes: r(p.total / 60),
      }),
    );
    expect(p.firstBreak).toBeGreaterThan(0);
    expect(p.firstBreak).toBeLessThan(5);
    expect(p.firstFull).toBeGreaterThan(12);
    expect(p.firstFull).toBeLessThan(40);
    expect(p.firstSale).toBeLessThan(70);
    expect(p.areaSeconds.length).toBe(3);
    expect(p.total / 60).toBeLessThan(25);
  });
});
