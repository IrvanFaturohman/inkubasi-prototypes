import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { completedModuleCount } from '../src/game/building';
import { isPlotComplete, plotDistance, plotProject, plotRent, plotTarget, plotsOf, storageCapacity, trackOf, vehicleCapacity } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { boostHold, passPlot, pickup, step } from '../src/game/sim';
import { count, fresh, run } from './helpers';

describe('pickup di depot', () => {
  it('mengambil min(stok, kapasitas − muatan); kendaraan penuh lewat saja', () => {
    const { state, rt } = fresh();
    const v = state.vehicles[0];
    state.depot.storage = 3;
    const ev: GameEvent[] = [];
    expect(pickup(state, rt, v, 0, ev)).toBe(3);
    expect(v.cargo).toBe(3);
    state.depot.storage = 10;
    expect(pickup(state, rt, v, 1, ev)).toBe(1);
    expect(v.cargo).toBe(vehicleCapacity(1));
    expect(pickup(state, rt, v, 2, ev)).toBe(0);
    expect(state.depot.storage).toBe(9);
    expect(ev.at(-1)).toMatchObject({ type: 'pickupMiss', reason: 'full' });
  });

  it('item yang masih di conveyor tidak bisa diambil', () => {
    const { state, rt } = fresh();
    state.depot.storage = 0;
    state.depot.lines[0] = [0.99, 0.5];
    const ev: GameEvent[] = [];
    expect(pickup(state, rt, state.vehicles[0], 0, ev)).toBe(0);
    expect(state.depot.lines[0].length).toBe(2);
  });
});

describe('produksi depot', () => {
  it('beberapa mesin berbagi kapasitas; berhenti saat penuh tanpa kehilangan item', () => {
    const { state, rt } = fresh();
    state.vehicles = [];
    state.depot.storage = 0;
    state.depot.machines = 3;
    const cap = storageCapacity(state);
    const ev = run(state, rt, 40);
    expect(state.depot.storage).toBe(cap);
    expect(state.depot.lines.flat().length).toBe(0);
    expect(count(ev, 'produced')).toBe(cap);
    expect(count(ev, 'stored')).toBe(cap);
  });

  it('invarian stok + conveyor <= kapasitas & muatan <= kapasitas selama bermain', () => {
    const { state, rt } = fresh();
    state.money = 999;
    for (let i = 0; i < 3000; i++) {
      step(state, rt, 1 / 30, []);
      const inTransit = state.depot.lines.flat().length;
      expect(state.depot.storage + inTransit).toBeLessThanOrEqual(storageCapacity(state));
      for (const v of state.vehicles) expect(v.cargo).toBeLessThanOrEqual(vehicleCapacity(v.level));
    }
  });
});

describe('kavling: kirim bahan & sewa', () => {
  it('isi-dulu: turunkan sebanyak kebutuhan, sisa lanjut ke kavling berikutnya', () => {
    const { state } = fresh();
    const v = state.vehicles[0];
    v.level = 2;
    v.cargo = 10;
    const need = plotTarget(state, 0);
    state.plots[0] = need - 3;
    const ev: GameEvent[] = [];
    passPlot(state, v, 0, ev);
    expect(state.plots[0]).toBe(need);
    expect(v.cargo).toBe(7);
    expect(ev.some((e) => e.type === 'plotComplete' && e.plot === 0)).toBe(true);
    passPlot(state, v, 1, ev);
    expect(state.plots[1]).toBe(7);
    expect(v.cargo).toBe(0);
    const d = ev.find((e) => e.type === 'deliver' && e.plot === 1);
    expect(d).toMatchObject({ amount: 7, fromModule: 0 });
    if (d?.type === 'deliver') expect(d.toModule).toBe(completedModuleCount(plotProject(state, 1), 7));
  });

  it('bangunan jadi membayar sewa tiap kali truk lewat; truk kosong tidak berbuat apa-apa di kavling belum jadi', () => {
    const { state } = fresh();
    const v = state.vehicles[0];
    state.plots[0] = plotTarget(state, 0);
    const before = state.money;
    const ev: GameEvent[] = [];
    passPlot(state, v, 0, ev);
    passPlot(state, v, 0, ev);
    expect(state.money - before).toBe(plotRent(state, 0) * 2);
    v.cargo = 0;
    passPlot(state, v, 1, ev);
    expect(state.plots[1]).toBe(0);
    expect(count(ev, 'rent')).toBe(2);
  });

  it('bonus jalan dibayar sekali saat semua kavling jalan itu selesai', () => {
    const { state } = fresh();
    const v = state.vehicles[0];
    const street0 = plotsOf(0).filter((p) => p.street === 0);
    for (const p of street0.slice(1)) state.plots[p.index] = plotTarget(state, p.index);
    v.level = 6;
    v.cargo = 100;
    const ev: GameEvent[] = [];
    passPlot(state, v, street0[0].index, ev);
    passPlot(state, v, street0[0].index, ev);
    expect(count(ev, 'streetComplete')).toBe(1);
    expect(state.streetsPaid[0]).toBe(true);
  });

  it('kota selesai saat semua kavling jadi; sisa material dijual', () => {
    const { state } = fresh();
    for (let i = 1; i < state.plots.length; i++) state.plots[i] = plotTarget(state, i);
    state.expandStage = 3;
    const v = state.vehicles[0];
    v.level = 6;
    v.cargo = plotTarget(state, 0) + 5;
    state.depot.storage = 4;
    const ev: GameEvent[] = [];
    passPlot(state, v, 0, ev);
    expect(state.completed).toBe(true);
    expect(ev.find((e) => e.type === 'projectComplete')).toMatchObject({ leftover: 9 });
    expect(state.plots.every((_, i) => isPlotComplete(state, i))).toBe(true);
  });
});

describe('putaran nyata', () => {
  it('beberapa detik pertama: ambil di depot, kirim ke rumah pertama, modul jadi solid', () => {
    const { state, rt } = fresh();
    const ev = run(state, rt, 6);
    const p = ev.findIndex((e) => e.type === 'pickup');
    const d = ev.findIndex((e) => e.type === 'deliver');
    expect(p).toBeGreaterThanOrEqual(0);
    expect(d).toBeGreaterThan(p);
    expect(completedModuleCount(plotProject(state, 0), state.plots[0])).toBeGreaterThan(0);
  });

  it('satu putaran = tepat satu lintasan per titik kunci, dengan atau tanpa boost', () => {
    for (const boost of [false, true]) {
      const { state, rt } = fresh();
      state.plots[0] = plotTarget(state, 0); // jadi → sewa setiap lewat
      if (boost) {
        boostHold(rt, true);
        rt.boost.mult = BALANCE.boost.mult;
      }
      const L = trackOf(state).length;
      const ev: GameEvent[] = [];
      let travelled = 0;
      let prev = state.vehicles[0].distance;
      while (travelled < L * 3) {
        step(state, rt, boost ? 1 / 30 : 1 / 120, ev);
        rt.boost.energy = 1;
        const cur = state.vehicles[0].distance;
        travelled += (cur - prev + L) % L;
        prev = cur;
      }
      expect(ev.filter((e) => e.type === 'rent' && e.plot === 0).length).toBe(3);
      expect(ev.filter((e) => (e.type === 'pickup' || e.type === 'pickupMiss') && e.bay === 2).length).toBe(3);
      expect(plotDistance(0, 0, 0)).toBeGreaterThan(0);
    }
  });
});
