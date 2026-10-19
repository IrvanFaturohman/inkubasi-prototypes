import { describe, expect, it } from 'vitest';
import { BlockField } from '../src/game/BlockField';
import { CargoLedger } from '../src/game/CargoLedger';
import { AREAS, MATERIALS, MAT_NORMAL, SIM, UPGRADES } from '../src/game/config';
import { GameSim } from '../src/game/GameSim';
import { generateArea } from '../src/game/LevelGen';
import { defaultProgress, purchaseUpgrade } from '../src/game/state';
import { SaveManager, validateSave, type KeyValueStore } from '../src/persistence/SaveManager';

const DT = SIM.step;

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** Drive toward a screen-space direction for a number of steps, checking the cargo invariant every step. */
function drive(sim: GameSim, x: number, y: number, steps: number, check?: () => void): void {
  const len = Math.hypot(x, y) || 1;
  for (let s = 0; s < steps; s++) {
    sim.update(DT, { x: x / len, y: y / len, mag: x || y ? 1 : 0 });
    check?.();
  }
}

/** Serpentine harvesting across the field until the bin is full (or a step budget runs out). */
function harvestUntilFull(sim: GameSim, check?: () => void, maxSteps = 60 * 240): void {
  const f = sim.field;
  const pts: { x: number; z: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const x = f.originX + 1 + k * 1.3;
    const north = f.originZ + 0.8;
    const south = -0.6;
    pts.push(k % 2 === 0 ? { x, z: north } : { x, z: south });
    pts.push(k % 2 === 0 ? { x: x + 1.3, z: north } : { x: x + 1.3, z: south });
  }
  let wp = 0;
  for (let s = 0; s < maxSteps && !sim.ledger.isFull && wp < pts.length; s++) {
    const v = sim.vehicle;
    const t = pts[wp];
    const dx = t.x - v.x;
    const dz = t.z - v.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) {
      wp++;
      continue;
    }
    sim.update(DT, { x: dx / d, y: dz / d, mag: 1 });
    check?.();
  }
}

function soldCoins(sim: GameSim): number {
  return sim.progress.coins;
}

describe('BlockField', () => {
  it('breaks a layer exactly once and only one layer per cell per step', () => {
    const f = new BlockField(2, 1);
    f.setCell(0, 2, MAT_NORMAL, 0, MAT_NORMAL, 1);
    f.setCell(1, 1, MAT_NORMAL, 2);
    f.finalize();
    expect(f.totalLayers).toBe(3);
    expect(f.breakTop(0, 1)).toBe(1); // top layer key = cell*2+1
    expect(f.breakTop(0, 1)).toBe(-1); // same step: lower layer not yet available
    expect(f.remaining[0]).toBe(1);
    expect(f.breakTop(0, 2)).toBe(0);
    expect(f.breakTop(0, 3)).toBe(-1); // empty
    expect(f.destroyedLayers).toBe(2);
  });

  it('generates the authored areas with the specified density', () => {
    const a1 = generateArea(AREAS[0]);
    expect(a1.n).toBe(24 * 18);
    expect(a1.totalLayers).toBe(432);
    const a3 = generateArea(AREAS[2]);
    let doubles = 0;
    for (let i = 0; i < a3.n; i++) if (a3.orig[i] === 2) doubles++;
    expect(doubles / a3.n).toBeCloseTo(0.55, 1);
    // Deterministic for a seed.
    const again = generateArea(AREAS[2]);
    expect(Array.from(again.color)).toEqual(Array.from(a3.color));
  });
});

describe('CargoLedger', () => {
  it('never lets stored + reserved exceed capacity', () => {
    const l = new CargoLedger(5);
    let accepted = 0;
    for (let i = 0; i < 20; i++) if (l.reserve(1, 0, 0, 0, 0, 0, 0, 0.5)) accepted++;
    expect(accepted).toBe(5);
    expect(l.total).toBe(5);
    l.update(1);
    expect(l.storedTotal).toBe(5);
    expect(l.reservedTotal).toBe(0);
    expect(l.reserve(1, 0, 0, 0, 0, 0, 0, 0.5)).toBe(false);
  });

  it('snapshot counts pending pickups as stored cargo', () => {
    const l = new CargoLedger(10);
    l.reserve(2, 0, 0, 0, 0, 0, 0, 0);
    l.reserve(3, 0, 0, 0, 0, 0, 0, 0);
    expect(l.snapshot()).toEqual([0, 1, 1]);
  });
});

describe('GameSim crushing + cargo', () => {
  it('holds the capacity invariant and awards one unit per destroyed layer', () => {
    const sim = new GameSim();
    let maxTotal = 0;
    let breaks = 0;
    const check = () => {
      const l = sim.ledger;
      expect(l.storedTotal + l.reservedTotal).toBeLessThanOrEqual(l.capacity);
      maxTotal = Math.max(maxTotal, l.total);
      for (const e of sim.events) if (e.type === 'break') breaks++;
      sim.events.length = 0;
    };
    // Drive north into the field, weaving so many cells break in the same steps.
    for (let k = 0; k < 12; k++) {
      drive(sim, k % 2 ? 0.6 : -0.6, -1, 90, check);
    }
    expect(breaks).toBeGreaterThan(0);
    expect(sim.field.destroyedLayers).toBe(breaks);
    expect(sim.ledger.total).toBe(breaks);
    expect(maxTotal).toBeLessThanOrEqual(sim.ledger.capacity);
  });

  it('stops breaking when full without losing rewards', () => {
    const sim = new GameSim();
    harvestUntilFull(sim);
    expect(sim.ledger.isFull).toBe(true);
    const destroyed = sim.field.destroyedLayers;
    drive(sim, 0, -1, 240);
    expect(sim.field.destroyedLayers).toBe(destroyed);
    expect(sim.ledger.total).toBe(destroyed);
  });
});

describe('Unloading', () => {
  it('grants coins matching the ledger exactly once', () => {
    const sim = new GameSim();
    harvestUntilFull(sim);
    const expected = sim.ledger.value;
    const units = sim.ledger.total;
    expect(units).toBe(96);
    const pad = sim.depot.layout.pad;
    sim.vehicle.setPose(pad.x, pad.z, 0);
    drive(sim, 0, 0, 60 * 4);
    expect(sim.ledger.total).toBe(0);
    expect(soldCoins(sim)).toBe(expected);
    expect(sim.progress.stats.unitsSold).toBe(units);
    // Staying on the pad longer must not pay again.
    drive(sim, 0, 0, 120);
    expect(soldCoins(sim)).toBe(expected);
  });

  it('stops at a unit boundary when the truck leaves the pad', () => {
    const sim = new GameSim();
    harvestUntilFull(sim);
    const pad = sim.depot.layout.pad;
    sim.vehicle.setPose(pad.x, pad.z, Math.PI);
    drive(sim, 0, 0, 45); // dwell + part of the unload
    const midCoins = sim.progress.coins;
    const midUnits = sim.ledger.total;
    expect(midCoins).toBeGreaterThan(0);
    expect(midUnits).toBeGreaterThan(0);
    expect(midCoins).toBe((96 - midUnits) * MATERIALS[1].coins);
    // Leave the pad; the rest stays in the bin.
    sim.vehicle.setPose(pad.x - 6, pad.z, Math.PI);
    drive(sim, 0, 0, 60);
    expect(sim.progress.coins).toBe(midCoins);
    expect(sim.ledger.total).toBe(midUnits);
  });
});

describe('Upgrades', () => {
  it('changes price and level atomically and never overspends', () => {
    const p = defaultProgress();
    p.coins = 179;
    expect(purchaseUpgrade(p, 'roller')).toBe('funds');
    expect(p.upgrades.roller).toBe(0);
    expect(p.coins).toBe(179);
    p.coins = 180 + 420;
    expect(purchaseUpgrade(p, 'roller')).toBe('ok');
    expect(purchaseUpgrade(p, 'roller')).toBe('ok');
    expect(purchaseUpgrade(p, 'roller')).toBe('funds'); // rapid extra tap
    expect(p.upgrades.roller).toBe(2);
    expect(p.coins).toBe(0);
    p.coins = 1e6;
    for (let i = 0; i < 10; i++) purchaseUpgrade(p, 'cargo');
    expect(p.upgrades.cargo).toBe(4);
    const spent = UPGRADES.cargo.prices.reduce((a, b) => a + b, 0);
    expect(p.coins).toBe(1e6 - spent);
  });

  it('applies roller width to the crusher collider and capacity to the ledger', () => {
    const sim = new GameSim();
    sim.progress.coins = 10000;
    expect(sim.buy('roller')).toBe('ok');
    expect(sim.vehicle.rollerWidth).toBe(1.95);
    expect(sim.buy('cargo')).toBe('ok');
    expect(sim.ledger.capacity).toBe(144);
  });
});

describe('Save / load', () => {
  it('preserves cleared layers, pending cargo, upgrades and rewards', () => {
    const store = memoryStore();
    const sim = new GameSim();
    const sm = new SaveManager(store);
    sm.setCollector(() => sim.snapshot());
    sim.progress.coins = 500;
    sim.buy('power');
    drive(sim, 0.4, -1, 150);
    // Make sure some pickups are still in flight at save time.
    drive(sim, 0, -1, 3);
    const pendingTotal = sim.ledger.total;
    expect(pendingTotal).toBeGreaterThan(0);
    const destroyed = sim.field.destroyedLayers;
    sim.progress.areaRewardClaimed = false;
    expect(sm.flush()).toBe(true);

    const loaded = new SaveManager(store).load();
    expect(loaded.status).toBe('ok');
    const sim2 = new GameSim();
    expect(sim2.restore(loaded.data!)).toBe(true);
    expect(sim2.field.destroyedLayers).toBe(destroyed);
    expect(Array.from(sim2.field.remaining)).toEqual(Array.from(sim.field.remaining));
    expect(sim2.ledger.storedTotal).toBe(pendingTotal);
    expect(sim2.ledger.reservedTotal).toBe(0);
    expect(sim2.progress.upgrades.power).toBe(1);
    expect(sim2.progress.coins).toBe(sim.progress.coins);
  });

  it('rejects corrupt or out-of-range saves', () => {
    const sim = new GameSim();
    const snap = sim.snapshot();
    expect(validateSave(snap)).not.toBeNull();
    expect(validateSave({ ...snap, v: 99 })).toBeNull();
    expect(validateSave({ ...snap, cargo: [500, 0, 0] })).toBeNull();
    expect(validateSave({ ...snap, progress: { ...snap.progress, coins: -5 } })).toBeNull();
    expect(validateSave({ ...snap, field: '!!!' })).toBeNull();
    const store = memoryStore();
    store.setItem('toy-block-demolition.save', '{not json');
    expect(new SaveManager(store).load().status).toBe('corrupt');
    expect(new SaveManager(null).load().status).toBe('unavailable');
  });

  it('claims the area completion reward exactly once', () => {
    const sim = new GameSim();
    // Clear the whole field logically, then step.
    for (let i = 0; i < sim.field.n; i++) while (sim.field.remaining[i] > 0) sim.field.breakTop(i, -10 - sim.field.remaining[i]);
    const before = sim.progress.coins;
    drive(sim, 0, 0, 5);
    expect(sim.progress.coins).toBe(before + AREAS[0].completionBonus);
    drive(sim, 0, 0, 5);
    expect(sim.progress.coins).toBe(before + AREAS[0].completionBonus);
    const snap = sim.snapshot();
    const sim2 = new GameSim();
    sim2.restore(validateSave(JSON.parse(JSON.stringify(snap)))!);
    drive(sim2, 0, 0, 5);
    expect(sim2.progress.coins).toBe(before + AREAS[0].completionBonus);
  });
});
