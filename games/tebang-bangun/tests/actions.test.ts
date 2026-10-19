import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { addWagon, expandTrack, mergeWagons, nextProject, upgradeCapacity, upgradeSpeed } from '../src/game/actions';
import { addCost, capacity, isPlotUnlocked, plotTarget, trackOf, trainSpeed } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { fieldFor } from '../src/game/worldgen';
import { count, fresh, run } from './helpers';

describe('gerbong', () => {
  it('Add menambah gerbong Lv1 dengan biaya naik & batas jumlah', () => {
    const { state } = fresh();
    state.money = 1e7;
    const c1 = addCost(state);
    expect(addWagon(state, []).ok).toBe(true);
    expect(state.train.wagons).toEqual([1, 1]);
    expect(addCost(state)).toBeGreaterThan(c1);
    while (addWagon(state, []).ok);
    expect(state.train.wagons.length).toBe(BALANCE.maxWagons);
  });

  it('Merge: dua gerbong setingkat terendah → satu tingkat lebih tinggi, urut dari depan', () => {
    const { state } = fresh();
    state.money = 1e5;
    state.train.wagons = [2, 1, 1, 1];
    const ev: GameEvent[] = [];
    expect(mergeWagons(state, ev).ok).toBe(true);
    expect(state.train.wagons).toEqual([2, 2, 1]);
    expect(mergeWagons(state, ev).ok).toBe(true);
    expect(state.train.wagons).toEqual([3, 1]);
    expect(mergeWagons(state, ev).ok).toBe(false);
  });

  it('Kecepatan & Kapasitas benar-benar naik', () => {
    const { state } = fresh();
    state.money = 1e5;
    const s0 = trainSpeed(state);
    const c0 = capacity(state);
    upgradeSpeed(state, []);
    upgradeCapacity(state, []);
    expect(trainSpeed(state)).toBeGreaterThan(s0);
    expect(capacity(state)).toBeGreaterThan(c0);
  });
});

describe('rel baru', () => {
  it('membuka cabang & membersihkan jalur rel tanpa mengubah progres, muatan, atau gerbong', () => {
    const { state, rt } = fresh();
    run(state, rt, 20);
    state.money = 1e6;
    state.plots[0] = 5;
    const wagons = [...state.train.wagons];
    const cargo = { ...state.train.cargo };
    const L0 = trackOf(state).length;
    const f = fieldFor(0);
    const ev: GameEvent[] = [];
    expect(expandTrack(state, rt, ev).ok).toBe(true);
    expect(trackOf(state).length).toBeGreaterThan(L0 + 5);
    expect(state.plots[0]).toBe(5);
    expect(state.train.wagons).toEqual(wagons);
    expect(state.train.cargo).toEqual(cargo);
    const e = ev.find((x) => x.type === 'expand');
    expect(e && e.type === 'expand' && e.cleared.length).toBeGreaterThan(5);
    for (let c = 0; c < f.n; c++) if (f.railStage[c] === 1) expect(state.blocks[c]).toBe(-1);
    expect(state.plots.map((_, i) => isPlotUnlocked(state, i)).filter(Boolean).length).toBe(10);
    expandTrack(state, rt, []);
    expandTrack(state, rt, []);
    expect(expandTrack(state, rt, []).ok).toBe(false);
  });

  it('kereta tetap di bagian lintasan yang sama relatif terhadap stasiun', () => {
    const { state, rt } = fresh();
    state.money = 1e6;
    state.train.distance = 1.2; // di sisi utara lapangan, bagian yang sama di semua tahap
    expandTrack(state, rt, []);
    expect(state.train.distance).toBeCloseTo(1.2, 3);
  });
});

describe('level berikutnya', () => {
  it('hanya setelah selesai; pindah ke Lembah Batu yang bisa dimainkan, uang dibawa', () => {
    const { state, rt } = fresh();
    expect(nextProject(state, []).ok).toBe(false);
    state.completed = true;
    state.money = 500;
    expect(nextProject(state, []).ok).toBe(true);
    expect(state.levelIndex).toBe(1);
    expect(state.money).toBe(500);
    expect(state.train.wagons).toEqual([1]);
    expect(state.plots.every((p) => p === 0)).toBe(true);
    const ev = run(state, rt, 6);
    expect(count(ev, 'cut')).toBeGreaterThan(0);
    expect(plotTarget(state, 0)).toBeGreaterThan(0);
  });
});
