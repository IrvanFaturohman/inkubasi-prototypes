// Versioned save in localStorage. Every access is wrapped: private mode, blocked storage
// or a corrupt value must never stop the game from starting.
import { Levels, UPGRADES, UPGRADE_IDS } from './config';

export const SAVE_KEY = 'arrow-orbit.save.v1';

export interface SaveData {
  v: 1;
  coins: number;
  levels: Levels;
  best: number;
  runs: number;
}

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem?(k: string): void;
}

export function defaultSave(): SaveData {
  return { v: 1, coins: 0, levels: { power: 1, bounce: 1, length: 1 }, best: 0, runs: 0 };
}

const num = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d;

export function loadSave(kv: KV | null): SaveData {
  const d = defaultSave();
  if (!kv) return d;
  try {
    const raw = kv.getItem(SAVE_KEY);
    if (!raw) return d;
    const o = JSON.parse(raw) as Partial<SaveData>;
    if (!o || o.v !== 1) return d;
    const lv = (o.levels ?? {}) as Partial<Levels>;
    const levels = { ...d.levels };
    for (const id of UPGRADE_IDS) levels[id] = num(lv[id], 1, UPGRADES[id].max, 1);
    return {
      v: 1,
      coins: num(o.coins, 0, 1e12, 0),
      levels,
      best: num(o.best, 0, 1e6, 0),
      runs: num(o.runs, 0, 1e9, 0),
    };
  } catch {
    return d;
  }
}

export function writeSave(kv: KV | null, s: SaveData): boolean {
  if (!kv) return false;
  try {
    kv.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function browserStorage(): KV | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const k = SAVE_KEY + '.probe';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return null;
  }
}

export function memoryStorage(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
