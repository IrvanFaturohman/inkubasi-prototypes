import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { addMachine, addVehicle, expandTrack, mergeAuto, mergeVehicles, nextProject, upgradeDepot } from '../src/game/actions';
import { addCost, isPlotUnlocked, pickupDistance, plotTarget, productionRate, trackOf, vehicleCapacity } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { count, fresh, run } from './helpers';

const originalCaps = [...BALANCE.vehicleCapacity];
afterEach(() => {
  BALANCE.vehicleCapacity.splice(0, BALANCE.vehicleCapacity.length, ...originalCaps);
});

describe('Add & Merge', () => {
  it('Add menambah kendaraan di celah terbesar, biaya naik', () => {
    const { state } = fresh();
    state.money = 1000;
    const c1 = addCost(state);
    expect(addVehicle(state, []).ok).toBe(true);
    expect(state.vehicles.length).toBe(2);
    expect(addCost(state)).toBeGreaterThan(c1);
    const L = trackOf(state).length;
    const gap = Math.abs(state.vehicles[0].distance - state.vehicles[1].distance);
    expect(Math.min(gap, L - gap)).toBeCloseTo(L / 2, 1);
  });

  it('Merge: dua setingkat → satu tingkat berikutnya, muatan utuh, posisi tetap', () => {
    const { state } = fresh();
    state.money = 1000;
    addVehicle(state, []);
    const [a, b] = state.vehicles;
    a.cargo = 3;
    b.cargo = 4;
    const ev: GameEvent[] = [];
    expect(mergeVehicles(state, a.id, b.id, ev).ok).toBe(true);
    expect(state.vehicles).toHaveLength(1);
    expect(state.vehicles[0]).toMatchObject({ id: a.id, level: 2, cargo: 7, distance: a.distance });
    expect(vehicleCapacity(2)).toBe(10);
  });

  it('Merge menolak tingkat berbeda; overflow bila config diubah dijual', () => {
    const { state } = fresh();
    state.money = 1000;
    addVehicle(state, []);
    state.vehicles[1].level = 2;
    expect(mergeAuto(state, []).ok).toBe(false);
    BALANCE.vehicleCapacity.splice(0, 2, 6, 8);
    state.vehicles[1].level = 1;
    state.vehicles[0].cargo = 6;
    state.vehicles[1].cargo = 6;
    const before = state.money;
    mergeAuto(state, []);
    expect(state.vehicles[0].cargo).toBe(8);
    expect(state.money - before).toBe(4);
  });
});

describe('Depot', () => {
  it('Upgrade & Tambah Mesin menaikkan produksi; mesin dibatasi 4', () => {
    const { state } = fresh();
    state.money = 1e6;
    const r0 = productionRate(state);
    upgradeDepot(state, []);
    const r1 = productionRate(state);
    expect(r1 / r0).toBeCloseTo(BALANCE.productionGrowth, 5);
    addMachine(state, []);
    expect(productionRate(state) / r1).toBeCloseTo(2, 5);
    while (addMachine(state, []).ok);
    expect(state.depot.machines).toBe(BALANCE.maxMachines);
  });

  it('mesin baru benar-benar memproduksi lebih banyak', () => {
    const a = fresh();
    a.state.vehicles = [];
    a.state.depot.storage = 0;
    const b = fresh();
    b.state.vehicles = [];
    b.state.depot.storage = 0;
    b.state.money = 100;
    addMachine(b.state, []);
    const na = count(run(a.state, a.rt, 5), 'produced');
    const nb = count(run(b.state, b.rt, 5), 'produced');
    expect(nb / na).toBeGreaterThan(1.8);
  });
});

describe('Jalan baru (expand)', () => {
  it('membuka jalan & kavling baru tanpa mengubah progres, muatan, atau jumlah kendaraan', () => {
    const { state, rt } = fresh();
    run(state, rt, 20);
    state.money = 1e5;
    addVehicle(state, []);
    addVehicle(state, []);
    const plots = [...state.plots];
    const cargo = state.vehicles.map((v) => [v.id, v.cargo]);
    const L0 = trackOf(state).length;
    const locked = state.plots.map((_, i) => isPlotUnlocked(state, i)).filter((x) => !x).length;
    expect(expandTrack(state, rt, []).ok).toBe(true);
    expect(trackOf(state).length).toBeGreaterThan(L0 + 8);
    expect(state.plots).toEqual(plots);
    expect(state.vehicles.map((v) => [v.id, v.cargo])).toEqual(cargo);
    expect(state.plots.map((_, i) => isPlotUnlocked(state, i)).filter((x) => !x).length).toBeLessThan(locked);
    expect(expandTrack(state, rt, []).ok).toBe(true);
    expect(expandTrack(state, rt, []).ok).toBe(true);
    expect(expandTrack(state, rt, []).ok).toBe(false);
    expect(state.plots.every((_, i) => isPlotUnlocked(state, i))).toBe(true);
  });

  it('urutan kendaraan relatif terhadap pickup depot tetap sama setelah expand', () => {
    const { state, rt } = fresh();
    state.money = 1e5;
    for (let i = 0; i < 5; i++) addVehicle(state, []);
    const rel = (stage: number) => state.vehicles.map((v) => [0, 1, 2, 3].filter((b) => v.distance < pickupDistance(0, stage, b)).length);
    const before = rel(0);
    expandTrack(state, rt, []);
    expect(rel(1)).toEqual(before);
  });
});

describe('Kota berikutnya', () => {
  it('hanya setelah selesai; pindah ke kota bata yang bisa dimainkan, uang dibawa', () => {
    const { state, rt } = fresh();
    expect(nextProject(state, []).ok).toBe(false);
    state.expandStage = 3;
    for (let i = 0; i < state.plots.length; i++) state.plots[i] = plotTarget(state, i);
    state.plots[0] -= 1;
    state.vehicles[0].cargo = 1;
    run(state, rt, 20);
    expect(state.completed).toBe(true);
    const money = state.money;
    expect(nextProject(state, []).ok).toBe(true);
    expect(state.levelIndex).toBe(1);
    expect(state.completed).toBe(false);
    expect(state.plots.every((p) => p === 0)).toBe(true);
    expect(state.money).toBe(money);
    const ev = run(state, rt, 10);
    expect(count(ev, 'deliver')).toBeGreaterThan(0);
  });
});
