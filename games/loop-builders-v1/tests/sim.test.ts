import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { completedModuleCount } from '../src/game/building';
import { pickupDistance, projectOf, storageCapacity, trackOf, vehicleCapacity } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { boostHold, pickup, step, unload } from '../src/game/sim';
import { count, fresh, run } from './helpers';

describe('pickup', () => {
  it('mengambil min(stok, kapasitas − muatan)', () => {
    const { state } = fresh();
    const v = state.vehicles[0];
    const st = state.stations[0];
    st.storage = 3;
    const ev: GameEvent[] = [];
    expect(pickup(state, v, 0, ev)).toBe(3);
    expect(v.cargo).toBe(3);
    expect(st.storage).toBe(0);

    st.storage = 10;
    expect(pickup(state, v, 0, ev)).toBe(1); // kapasitas Lv1 = 4
    expect(v.cargo).toBe(4);
    expect(st.storage).toBe(9);

    // kendaraan penuh melewati stasiun tanpa mengambil
    expect(pickup(state, v, 0, ev)).toBe(0);
    expect(st.storage).toBe(9);
    expect(ev.at(-1)).toMatchObject({ type: 'pickupMiss', reason: 'full' });
  });

  it('item di conveyor tidak bisa diambil', () => {
    const { state } = fresh();
    const st = state.stations[0];
    st.storage = 0;
    st.conveyor = [0.99, 0.5, 0.2];
    const ev: GameEvent[] = [];
    expect(pickup(state, state.vehicles[0], 0, ev)).toBe(0);
    expect(st.conveyor.length).toBe(3);
    expect(ev.at(-1)).toMatchObject({ type: 'pickupMiss', reason: 'empty' });
  });
});

describe('produksi & buffer', () => {
  it('mesin berhenti saat storage + conveyor mencapai kapasitas, tanpa item hilang', () => {
    const { state, rt } = fresh();
    state.vehicles = []; // tidak ada yang mengambil
    const st = state.stations[0];
    st.storage = 0;
    const cap = storageCapacity(st);
    const ev = run(state, rt, 60);
    expect(st.storage).toBe(cap);
    expect(st.conveyor.length).toBe(0);
    expect(count(ev, 'produced')).toBe(cap);
    expect(count(ev, 'stored')).toBe(cap);
    expect(ev.some((e) => e.type === 'stationFull' && e.full)).toBe(true);
  });

  it('invarian storage + conveyor <= kapasitas selama permainan normal', () => {
    const { state, rt } = fresh();
    for (let i = 0; i < 2000; i++) {
      step(state, rt, 1 / 30, []);
      for (const st of state.stations) {
        if (!st.built) continue;
        expect(st.storage + st.conveyor.length).toBeLessThanOrEqual(storageCapacity(st));
        expect(st.storage).toBeGreaterThanOrEqual(0);
      }
      for (const v of state.vehicles) expect(v.cargo).toBeLessThanOrEqual(vehicleCapacity(v.level));
    }
  });
});

describe('bongkar', () => {
  it('seluruh muatan masuk progres sekaligus dan modul terkait menjadi solid', () => {
    const { state, rt } = fresh();
    const v = state.vehicles[0];
    v.cargo = 4;
    const ev: GameEvent[] = [];
    unload(state, rt, v, ev);
    expect(v.cargo).toBe(0);
    expect(state.delivered).toBe(4);
    expect(state.money).toBe(4);
    const u = ev.find((e) => e.type === 'unload')!;
    expect(u).toMatchObject({ amount: 4, used: 4, fromModule: 0 });
    if (u.type === 'unload') expect(u.toModule).toBe(completedModuleCount(projectOf(state), 4));
    expect(completedModuleCount(projectOf(state), 4)).toBeGreaterThan(0);
  });

  it('tepat sekali per putaran, walau berjalan pelan di sekitar titik bongkar', () => {
    const { state, rt } = fresh();
    const track = trackOf(state);
    state.stations[0].storage = 12;
    const v = state.vehicles[0];
    v.distance = track.length - 0.5;
    const ev = run(state, rt, 0.5, 1 / 240); // banyak langkah kecil melintasi titik 0
    expect(count(ev, 'unload') + count(ev, 'unloadEmpty')).toBe(1);
  });

  it('boost tidak membuat pickup/bongkar terlewat', () => {
    const lapsFor = (h: number, boost: boolean) => {
      const { state, rt } = fresh();
      state.stations[0].storage = 12;
      if (boost) {
        boostHold(rt, true);
        rt.boost.mult = BALANCE.boost.mult;
      }
      // hitung dengan jarak tempuh, bukan waktu
      const L = trackOf(state).length;
      const ev: GameEvent[] = [];
      let travelled = 0;
      let prev = state.vehicles[0].distance;
      while (travelled < L * 3) {
        step(state, rt, h, ev);
        rt.boost.energy = 1; // abaikan batas energi untuk tes ini
        const cur = state.vehicles[0].distance;
        travelled += (cur - prev + L) % L;
        prev = cur;
      }
      return { unloads: count(ev, 'unload') + count(ev, 'unloadEmpty'), visits: ev.filter((e) => e.type === 'pickup' || e.type === 'pickupMiss').length };
    };
    const slow = lapsFor(1 / 120, false);
    const fast = lapsFor(1 / 30, true);
    expect(slow.unloads).toBe(3);
    expect(fast.unloads).toBe(3);
    expect(slow.visits).toBe(3);
    expect(fast.visits).toBe(3);
  });

  it('pengiriman melewati target menyelesaikan rumah & kelebihan dibayar, tidak dibuang', () => {
    const { state, rt } = fresh();
    const project = projectOf(state);
    state.delivered = project.target - 2;
    state.stagesPaid = project.stageNames.length - 1;
    const v = state.vehicles[0];
    v.level = 2;
    v.cargo = 9;
    state.stations[0].storage = 5;
    const moneyBefore = state.money;
    const ev: GameEvent[] = [];
    unload(state, rt, v, ev);
    expect(state.delivered).toBe(project.target);
    expect(state.completed).toBe(true);
    const u = ev.find((e) => e.type === 'unload');
    expect(u).toMatchObject({ amount: 9, used: 2, money: 9 });
    const c = ev.find((e) => e.type === 'projectComplete');
    expect(c).toMatchObject({ leftover: 5 });
    expect(state.money).toBe(moneyBefore + 9 + project.completionBonus + 5);
    expect(completedModuleCount(project, state.delivered)).toBe(project.modules.length);
  });
});

describe('putaran nyata', () => {
  it('beberapa detik pertama: pickup di A, bongkar, lalu rumah punya modul solid', () => {
    const { state, rt } = fresh();
    const ev = run(state, rt, 8);
    const firstPickup = ev.findIndex((e) => e.type === 'pickup');
    const firstUnload = ev.findIndex((e) => e.type === 'unload');
    expect(firstPickup).toBeGreaterThanOrEqual(0);
    expect(firstUnload).toBeGreaterThan(firstPickup);
    expect(completedModuleCount(projectOf(state), state.delivered)).toBeGreaterThan(0);
    expect(pickupDistance(0, 0, 0)).toBeLessThan(trackOf(state).length / 2);
  });
});
