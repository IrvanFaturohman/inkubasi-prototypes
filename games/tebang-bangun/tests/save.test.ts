import { describe, expect, it } from 'vitest';
import { addWagon, expandTrack } from '../src/game/actions';
import { deserialize, loadGame, SAVE_KEY, saveGame, serialize } from '../src/game/save';
import { fieldFor } from '../src/game/worldgen';
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
  it('memulihkan hutan (HP blok), kereta/gerbong/muatan, rel, kavling, uang', () => {
    const { state, rt } = fresh();
    state.money = 300;
    addWagon(state, []);
    expandTrack(state, rt, []);
    rt.freeze = 0;
    run(state, rt, 23.7);
    const s2 = deserialize(serialize(state))!;
    expect(s2).not.toBeNull();
    const { blocks: b1, growth: g1, ...rest1 } = state;
    const { blocks: b2, growth: g2, ...rest2 } = s2;
    expect(rest2).toEqual(rest1);
    for (let i = 0; i < b1.length; i++) {
      expect(b2[i]).toBeCloseTo(b1[i], 1);
      expect(g2[i]).toBeCloseTo(g1[i], 1);
    }
  });

  it('save rusak / versi lama → null dan dicadangkan', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{"schema":3,"state":{"levelIndex":7}}');
    const res = loadGame(storage);
    expect(res.state).toBeNull();
    expect(res.corrupted).toBe(true);
    expect(deserialize('{"schema":2,"state":{}}')).toBeNull();
    expect(deserialize('bukan json')).toBeNull();
  });

  it('level selesai pulih dalam keadaan selesai', async () => {
    const { state } = fresh();
    const { plotTarget } = await import('../src/game/economy');
    state.expandStage = 3;
    const f = fieldFor(0);
    for (let i = 0; i < state.plots.length; i++) {
      for (const c of f.plotCells[i]) state.blocks[c] = 0;
      state.plots[i] = plotTarget(state, i);
    }
    state.completed = true;
    const storage = new MemoryStorage();
    saveGame(storage, state);
    expect(loadGame(storage).state!.completed).toBe(true);
  });

  it('merapikan nilai di luar batas', () => {
    const { state } = fresh();
    state.train.cargo = { wood: 999, stone: 0, gem: 0 };
    state.plots[0] = 50; // lahan belum bersih → progres tidak sah
    state.blocks[0] = 999;
    const s2 = deserialize(serialize(state))!;
    expect(s2.train.cargo.wood).toBe(20);
    expect(s2.plots[0]).toBe(0);
    expect(s2.blocks[0]).toBeLessThanOrEqual(10);
  });
});
