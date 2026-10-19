import { describe, expect, it } from 'vitest';
import { addVehicle, expandTrack, buildStation } from '../src/game/actions';
import { projectOf } from '../src/game/economy';
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
  it('memulihkan level, progres, uang, expand, kendaraan/muatan, stasiun/stok/conveyor', () => {
    const { state, rt } = fresh();
    state.money = 500;
    addVehicle(state, []);
    expandTrack(state, rt, []);
    buildStation(state, 1, []);
    rt.freeze = 0;
    run(state, rt, 13.37);
    const restored = deserialize(serialize(state))!;
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
  });

  it('save rusak → null dan disimpan sebagai cadangan', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{"schema":1,"state":{"levelIndex":99}}');
    const res = loadGame(storage);
    expect(res.state).toBeNull();
    expect(res.corrupted).toBe(true);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
    expect(deserialize('bukan json')).toBeNull();
    expect(deserialize('{"schema":999}')).toBeNull();
  });

  it('level yang selesai pulih dalam keadaan selesai (tidak auto pindah level)', () => {
    const { state } = fresh();
    state.delivered = projectOf(state).target;
    state.completed = true;
    const storage = new MemoryStorage();
    saveGame(storage, state);
    const { state: s2 } = loadGame(storage);
    expect(s2!.completed).toBe(true);
    expect(s2!.levelIndex).toBe(0);
  });

  it('merapikan nilai di luar batas (muatan > kapasitas, stok > kapasitas)', () => {
    const { state } = fresh();
    state.vehicles[0].cargo = 99;
    state.stations[0].storage = 500;
    state.stations[0].conveyor = [0.5, 0.2];
    const s2 = deserialize(serialize(state))!;
    expect(s2.vehicles[0].cargo).toBe(4);
    expect(s2.stations[0].storage + s2.stations[0].conveyor.length).toBeLessThanOrEqual(12);
  });
});
