import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { LEVELS } from '../src/config/levels';
import { addVehicle, expandTrack, mergeAuto, mergeVehicles, nextProject, buildStation, upgradeStation } from '../src/game/actions';
import { addCost, pickupDistance, projectOf, trackOf, vehicleCapacity } from '../src/game/economy';
import { keyPointsFor } from '../src/game/sim';
import type { GameEvent } from '../src/game/events';
import { count, fresh, run } from './helpers';

const originalCaps = [...BALANCE.vehicleCapacity];
afterEach(() => {
  BALANCE.vehicleCapacity.splice(0, BALANCE.vehicleCapacity.length, ...originalCaps);
});

describe('Add', () => {
  it('menambah kendaraan dengan biaya yang naik dan spawn di celah terbesar', () => {
    const { state } = fresh();
    state.money = 1000;
    const c1 = addCost(state);
    const ev: GameEvent[] = [];
    expect(addVehicle(state, ev).ok).toBe(true);
    expect(state.vehicles.length).toBe(2);
    expect(addCost(state)).toBeGreaterThan(c1);
    const L = trackOf(state).length;
    const [a, b] = state.vehicles.map((v) => v.distance);
    const gap = Math.abs(a - b);
    expect(Math.min(gap, L - gap)).toBeCloseTo(L / 2, 1);
  });

  it('ditolak bila uang kurang atau jalur penuh', () => {
    const { state } = fresh();
    state.money = 0;
    expect(addVehicle(state, []).ok).toBe(false);
    state.money = 1e9;
    while (addVehicle(state, []).ok);
    expect(state.vehicles.length).toBe(LEVELS[0].trackStages[0].maxVehicles);
  });
});

describe('Merge', () => {
  it('dua kendaraan setingkat menjadi satu tingkat berikutnya tanpa kehilangan muatan', () => {
    const { state } = fresh();
    state.money = 1000;
    addVehicle(state, []);
    const [a, b] = state.vehicles;
    a.cargo = 3;
    b.cargo = 4;
    const ev: GameEvent[] = [];
    expect(mergeVehicles(state, a.id, b.id, ev).ok).toBe(true);
    expect(state.vehicles.length).toBe(1);
    const m = state.vehicles[0];
    expect(m.id).toBe(a.id);
    expect(m.level).toBe(2);
    expect(m.cargo).toBe(7);
    expect(vehicleCapacity(2)).toBe(10);
    expect(m.distance).toBe(a.distance);
  });

  it('menolak tingkat berbeda', () => {
    const { state } = fresh();
    state.money = 1000;
    addVehicle(state, []);
    state.vehicles[1].level = 2;
    expect(mergeAuto(state, []).ok).toBe(false);
    expect(mergeVehicles(state, state.vehicles[0].id, state.vehicles[1].id, []).ok).toBe(false);
  });

  it('kelebihan muatan bila config kapasitas diubah → dijual, tidak hilang', () => {
    BALANCE.vehicleCapacity.splice(0, 2, 6, 8);
    const { state } = fresh();
    state.money = 1000;
    addVehicle(state, []);
    const [a, b] = state.vehicles;
    a.cargo = 6;
    b.cargo = 6;
    const before = state.money;
    const ev: GameEvent[] = [];
    mergeVehicles(state, a.id, b.id, ev);
    expect(state.vehicles[0].cargo).toBe(8);
    expect(state.money - before).toBe(4);
    expect(ev[0]).toMatchObject({ type: 'merge', overflowMoney: 4 });
  });
});

describe('Expand', () => {
  it('memperpanjang loop & membuka slot tanpa mengubah proyek, progres, atau muatan', () => {
    const { state, rt } = fresh();
    run(state, rt, 20);
    state.money = 10_000;
    addVehicle(state, []);
    addVehicle(state, []);
    const project = projectOf(state);
    const delivered = state.delivered;
    const cargo = state.vehicles.map((v) => [v.id, v.cargo]);
    const L0 = trackOf(state).length;
    const ev: GameEvent[] = [];
    expect(expandTrack(state, rt, ev).ok).toBe(true);
    expect(state.expandStage).toBe(1);
    expect(trackOf(state).length).toBeGreaterThan(L0 + 3);
    expect(projectOf(state).id).toBe(project.id);
    expect(state.delivered).toBe(delivered);
    expect(state.vehicles.map((v) => [v.id, v.cargo])).toEqual(cargo);
    expect(state.stations[1].built).toBe(false);
    expect(buildStation(state, 1, []).ok).toBe(true);
    expect(expandTrack(state, rt, []).ok).toBe(true);
    expect(state.expandStage).toBe(2);
    expect(buildStation(state, 2, []).ok).toBe(true);
    expect(expandTrack(state, rt, []).ok).toBe(false); // sudah maksimum
    expect(projectOf(state).id).toBe(project.id);
    expect(state.delivered).toBe(delivered);
  });

  it('posisi kendaraan relatif terhadap titik bongkar & pickup A tetap sama (tidak ada crossing ganda/terlewat)', () => {
    const { state, rt } = fresh();
    state.money = 10_000;
    for (let i = 0; i < 4; i++) addVehicle(state, []);
    const dA0 = pickupDistance(0, 0, 0);
    const before = state.vehicles.map((v) => v.distance < dA0);
    expandTrack(state, rt, []);
    const dA1 = pickupDistance(0, 1, 0);
    const after = state.vehicles.map((v) => v.distance < dA1);
    expect(after).toEqual(before);
    for (const v of state.vehicles) {
      expect(v.distance).toBeGreaterThanOrEqual(0);
      expect(v.distance).toBeLessThan(trackOf(state).length);
    }
  });

  it('setelah expand, satu putaran penuh = tepat satu bongkar per kendaraan', () => {
    const { state, rt } = fresh();
    state.money = 10_000;
    addVehicle(state, []);
    expandTrack(state, rt, []);
    rt.freeze = 0;
    const L = trackOf(state).length;
    const ev = run(state, rt, (L / BALANCE.vehicleSpeed) * 0.999, 1 / 60);
    // selisih kecepatan penyeimbang jarak kecil; tiap kendaraan maksimal satu bongkar
    const perVehicle = new Map<number, number>();
    for (const e of ev) if (e.type === 'unload' || e.type === 'unloadEmpty') perVehicle.set(e.vehicleId, (perVehicle.get(e.vehicleId) ?? 0) + 1);
    for (const n of perVehicle.values()) expect(n).toBeLessThanOrEqual(1);
    expect(keyPointsFor(state).length).toBe(1 + state.stations.filter((s) => s.built).length);
  });
});

describe('Upgrade produksi', () => {
  it('menaikkan throughput sekitar 50%', () => {
    const { state, rt } = fresh();
    state.vehicles = [];
    state.stations[0].storage = 0;
    state.money = 1000;
    const base = count(run(state, rt, 5), 'produced');
    const { state: s2, rt: r2 } = fresh();
    s2.vehicles = [];
    s2.stations[0].storage = 0;
    s2.money = 1000;
    upgradeStation(s2, 0, []);
    const up = count(run(s2, r2, 5), 'produced');
    expect(up / base).toBeGreaterThan(1.35);
    expect(up / base).toBeLessThan(1.65);
  });
});

describe('Proyek berikutnya', () => {
  it('hanya setelah selesai, lalu pindah ke proyek berbeda yang bisa dimainkan', () => {
    const { state, rt } = fresh();
    expect(nextProject(state, []).ok).toBe(false);
    state.delivered = projectOf(state).target - 1;
    state.vehicles[0].cargo = 1;
    state.vehicles[0].distance = trackOf(state).length - 0.01;
    run(state, rt, 0.1);
    expect(state.completed).toBe(true);
    const money = state.money;
    expect(nextProject(state, []).ok).toBe(true);
    expect(state.levelIndex).toBe(1);
    expect(projectOf(state).id).toBe('bighouse');
    expect(state.completed).toBe(false);
    expect(state.delivered).toBe(0);
    expect(state.money).toBe(money);
    const ev = run(state, rt, 15);
    expect(count(ev, 'unload')).toBeGreaterThan(0);
    expect(state.delivered).toBeGreaterThan(0);
  });
});
