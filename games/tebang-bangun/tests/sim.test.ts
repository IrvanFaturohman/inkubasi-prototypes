import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { completedModuleCount } from '../src/game/building';
import { capacity, cargoTotal, isPlotComplete, isPlotReady, plotProject, plotRent, plotTarget, plotsOf, trackOf } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { boostHold, passPlot, sell, step, wagonDistance } from '../src/game/sim';
import { fieldFor } from '../src/game/worldgen';
import { count, fresh, run } from './helpers';

/** Bersihkan lahan kavling (simulasikan sudah ditebang). */
function clearPlot(state: ReturnType<typeof fresh>['state'], plot: number) {
  for (const c of fieldFor(state.levelIndex).plotCells[plot]) state.blocks[c] = 0;
}

describe('gergaji', () => {
  it('menebang blok di dekat rel; hasil masuk muatan, blok jauh tidak tersentuh', () => {
    const { state, rt } = fresh();
    const before = [...state.blocks];
    const ev = run(state, rt, 3);
    expect(count(ev, 'cut')).toBeGreaterThan(0);
    expect(cargoTotal(state.train.cargo)).toBeGreaterThan(0);
    const f = fieldFor(0);
    const t = trackOf(state);
    for (let c = 0; c < f.n; c++) {
      if (state.blocks[c] !== before[c]) {
        expect(t.closestDistance({ x: f.x[c], z: f.z[c] }).gap).toBeLessThan(BALANCE.saw.reach + 0.05);
      }
    }
  });

  it('muatan tidak pernah melebihi kapasitas; saat penuh gergaji berhenti', () => {
    const { state, rt } = fresh();
    for (let i = 0; i < 1500; i++) {
      step(state, rt, 1 / 30, []);
      expect(cargoTotal(state.train.cargo)).toBeLessThanOrEqual(capacity(state));
    }
    state.train.cargo = { wood: capacity(state), stone: 0, gem: 0 };
    const snap = [...state.blocks];
    step(state, rt, 1 / 30, []);
    expect(state.blocks).toEqual(snap);
  });

  it('gerbong berbaris di belakang lokomotif', () => {
    const { state } = fresh();
    state.train.wagons = [2, 1, 1];
    const L = trackOf(state).length;
    const gap = (wagonDistance(state, 0) - wagonDistance(state, 1) + L) % L;
    expect(gap).toBeCloseTo(BALANCE.wagonSpacing, 5);
  });
});

describe('stasiun & kavling', () => {
  it('stasiun menjual seluruh muatan', () => {
    const { state } = fresh();
    state.train.cargo = { wood: 5, stone: 2, gem: 1 };
    const ev: GameEvent[] = [];
    expect(sell(state, ev)).toBe(5 * 1 + 2 * 2 + 1 * 10);
    expect(cargoTotal(state.train.cargo)).toBe(0);
  });

  it('kavling tertutup hutan tidak menerima bahan; setelah bersih diisi (isi-dulu)', () => {
    const { state } = fresh();
    state.train.cargo = { wood: 10, stone: 0, gem: 0 };
    const ev: GameEvent[] = [];
    passPlot(state, 0, ev);
    expect(state.plots[0]).toBe(0);
    expect(isPlotReady(state, 0)).toBe(false);
    clearPlot(state, 0);
    clearPlot(state, 1);
    const need = plotTarget(state, 0);
    state.plots[0] = need - 3;
    passPlot(state, 0, ev);
    expect(state.plots[0]).toBe(need);
    expect(state.train.cargo.wood).toBe(7);
    expect(ev.some((e) => e.type === 'plotComplete')).toBe(true);
    passPlot(state, 1, ev);
    expect(state.plots[1]).toBe(7);
    const d = ev.find((e) => e.type === 'deliver' && e.plot === 1);
    if (d?.type === 'deliver') expect(d.toModule).toBe(completedModuleCount(plotProject(state, 1), 7));
  });

  it('bangunan jadi membayar sewa tiap kereta lewat', () => {
    const { state } = fresh();
    clearPlot(state, 0);
    state.plots[0] = plotTarget(state, 0);
    const before = state.money;
    const ev: GameEvent[] = [];
    passPlot(state, 0, ev);
    passPlot(state, 0, ev);
    expect(state.money - before).toBe(plotRent(state, 0) * 2);
  });

  it('bonus jalur sekali; level selesai saat semua bangunan berdiri, sisa muatan dijual', () => {
    const { state } = fresh();
    state.expandStage = 3;
    for (let i = 0; i < state.plots.length; i++) {
      clearPlot(state, i);
      state.plots[i] = plotTarget(state, i);
    }
    state.plots[0] -= 2;
    state.train.cargo = { wood: 5, stone: 0, gem: 1 };
    const ev: GameEvent[] = [];
    passPlot(state, 0, ev);
    expect(state.completed).toBe(true);
    expect(count(ev, 'streetComplete')).toBe(1);
    expect(ev.find((e) => e.type === 'projectComplete')).toMatchObject({ leftover: 3 + 10 });
    expect(state.plots.every((_, i) => isPlotComplete(state, i))).toBe(true);
  });
});

describe('putaran nyata', () => {
  it('stasiun & kavling terpicu tepat sekali per putaran, dengan atau tanpa boost', () => {
    for (const boost of [false, true]) {
      const { state, rt } = fresh();
      const street0 = plotsOf(0).filter((p) => p.street === 0);
      clearPlot(state, street0[0].index);
      state.plots[street0[0].index] = plotTarget(state, street0[0].index);
      if (boost) {
        boostHold(rt, true);
        rt.boost.mult = BALANCE.boost.mult;
      }
      const L = trackOf(state).length;
      const ev: GameEvent[] = [];
      let travelled = 0;
      let prev = state.train.distance;
      while (travelled < L * 3) {
        state.train.cargo = { wood: 0, stone: 0, gem: 1 }; // permata selalu dijual
        step(state, rt, boost ? 1 / 30 : 1 / 120, ev);
        rt.boost.energy = 1;
        const cur = state.train.distance;
        travelled += (cur - prev + L) % L;
        prev = cur;
      }
      expect(ev.filter((e) => e.type === 'rent').length).toBe(3);
      expect(ev.filter((e) => e.type === 'sell').length).toBe(3);
    }
  });

  it('lahan kavling pertama akhirnya bersih oleh gergaji lalu siap dibangun', () => {
    const { state, rt } = fresh();
    state.train.wagons = [3, 3];
    state.capacityLevel = 10;
    const ev = run(state, rt, 90);
    expect(ev.some((e) => e.type === 'plotReady')).toBe(true);
    expect(plotsOf(0).filter((p) => p.street === 0).some((p) => isPlotReady(state, p.index))).toBe(true);
  });
});

describe('hutan tumbuh kembali', () => {
  it('tunggul tumbuh lagi jadi pohon penuh (kecuali lahan kavling), jadi pasokan tidak habis', async () => {
    const { regrow } = await import('../src/game/sim');
    const { state } = fresh();
    const f = fieldFor(0);
    const tree = [...Array(f.n).keys()].find((c) => f.kind[c] === 0 && f.plotOf[c] < 0 && state.blocks[c] > 0)!;
    const lot = f.plotCells[0][0];
    state.blocks[tree] = 0;
    state.blocks[lot] = 0;
    regrow(state, BALANCE.blocks.tree.regrow + 0.1);
    expect(state.blocks[tree]).toBe(BALANCE.blocks.tree.hp);
    expect(state.blocks[lot]).toBe(0);
  });

  it('stasiun menyimpan kayu yang masih dibutuhkan kavling bersih, sisanya dijual', () => {
    const { state } = fresh();
    for (const c of fieldFor(0).plotCells[0]) state.blocks[c] = 0;
    const need = plotTarget(state, 0);
    state.train.cargo = { wood: need + 5, stone: 0, gem: 1 };
    const ev: GameEvent[] = [];
    const money = sell(state, ev);
    expect(state.train.cargo.wood).toBe(need);
    expect(money).toBe(5 + 10);
  });
});
