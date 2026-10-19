import { describe, expect, it } from 'vitest';
import { addMachine, addVehicle, expandTrack } from '../src/game/actions';
import { plotTarget } from '../src/game/economy';
import { deserialize, loadGame, SAVE_KEY, saveGame, serialize } from '../src/game/save';
import { fresh, run } from './helpers';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('save/load', () => {
  it('memulihkan kota, progres kavling, uang, jalan, kendaraan/muatan, depot/stok/conveyor', () => {
    const { state, rt } = fresh();
    state.money = 500;
    addVehicle(state, []);
    addMachine(state, []);
    expandTrack(state, rt, []);
    rt.freeze = 0;
    run(state, rt, 17.3);
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it('save rusak / versi lama → null dan dicadangkan', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{"schema":2,"state":{"levelIndex":99}}');
    const res = loadGame(storage);
    expect(res.state).toBeNull();
    expect(res.corrupted).toBe(true);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
    expect(deserialize('bukan json')).toBeNull();
    expect(deserialize('{"schema":1,"state":{}}')).toBeNull();
  });

  it('kota yang selesai pulih dalam keadaan selesai', () => {
    const { state } = fresh();
    state.expandStage = 3;
    for (let i = 0; i < state.plots.length; i++) state.plots[i] = plotTarget(state, i);
    state.completed = true;
    const storage = new MemoryStorage();
    saveGame(storage, state);
    const s2 = loadGame(storage).state!;
    expect(s2.completed).toBe(true);
    expect(s2.levelIndex).toBe(0);
  });

  it('merapikan nilai di luar batas', () => {
    const { state } = fresh();
    state.vehicles[0].cargo = 99;
    state.depot.storage = 500;
    state.depot.lines[0] = [0.5, 0.2];
    state.plots[state.plots.length - 1] = 30; // kavling di jalan terkunci
    const s2 = deserialize(serialize(state))!;
    expect(s2.vehicles[0].cargo).toBe(4);
    expect(s2.depot.storage + s2.depot.lines.flat().length).toBeLessThanOrEqual(12);
    expect(s2.plots[s2.plots.length - 1]).toBe(0);
  });
});
