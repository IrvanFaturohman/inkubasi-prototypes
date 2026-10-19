import { BALANCE } from '../config/balance';
import { LEVELS } from '../config/levels';
import { capacity, isPlotComplete, isPlotReady, plotTarget, plotsOf, trackOf } from './economy';
import { stageCount } from './layout';
import { defaultTutorial } from './state';
import type { GameState } from './types';
import { fieldFor, maxHp } from './worldgen';

export const SAVE_KEY = 'loop-builders/train-save';
export const SETTINGS_KEY = 'loop-builders/settings';
export const CORRUPT_KEY = 'loop-builders/train-save-corrupt';
/** Versi 3 = konsep "Tebang & Bangun" (save versi lama tidak dipakai lagi). */
export const SCHEMA_VERSION = 3;

interface SaveFile {
  schema: number;
  savedAt: number;
  state: GameState;
}

export interface Settings {
  muted: boolean;
}

export function serialize(state: GameState): string {
  // HP blok dibulatkan 2 desimal supaya save ringkas.
  const r2 = (v: number) => (v <= 0 ? v : Math.round(v * 100) / 100);
  const compact = { ...state, blocks: state.blocks.map(r2), growth: state.growth.map(r2) };
  const file: SaveFile = { schema: SCHEMA_VERSION, savedAt: Date.now(), state: compact };
  return JSON.stringify(file);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Math.floor(v) === v;

/**
 * Membaca & memvalidasi save. Null bila rusak/versi tidak dikenal (pemanggil memulai
 * permainan baru & mencadangkan save rusak). Nilai di luar batas dirapikan (clamp).
 */
export function deserialize(raw: string): GameState | null {
  let file: SaveFile;
  try {
    file = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!file || typeof file !== 'object' || file.schema !== SCHEMA_VERSION) return null;
  const s = file.state as GameState;
  if (!s || typeof s !== 'object') return null;
  if (!isInt(s.levelIndex) || s.levelIndex < 0 || s.levelIndex >= LEVELS.length) return null;
  if (!isInt(s.cycle) || s.cycle < 0) return null;
  const level = LEVELS[s.levelIndex];
  if (!isInt(s.expandStage) || s.expandStage < 0 || s.expandStage >= stageCount(level)) return null;
  if (!isNum(s.money) || !s.train || !Array.isArray(s.train.wagons) || !isNum(s.train.distance)) return null;
  const f = fieldFor(s.levelIndex);
  if (!Array.isArray(s.blocks) || s.blocks.length !== f.n || !s.blocks.every(isNum)) return null;
  const plots = plotsOf(s.levelIndex);
  if (!Array.isArray(s.plots) || s.plots.length !== plots.length || !s.plots.every(isNum)) return null;

  const clampLv = (v: unknown, max: number) => (isInt(v) ? Math.max(1, Math.min(max, v)) : 1);
  const state: GameState = {
    levelIndex: s.levelIndex,
    cycle: s.cycle,
    money: Math.max(0, s.money),
    blocks: [],
    growth: [],
    plots: [],
    streetsPaid: level.streets.map((_, i) => !!s.streetsPaid?.[i]),
    completed: !!s.completed,
    expandStage: s.expandStage,
    train: {
      distance: 0,
      wagons: s.train.wagons.filter(isInt).map((l) => Math.max(1, Math.min(BALANCE.maxWagonLevel, l))).slice(0, BALANCE.maxWagons).sort((a, b) => b - a),
      cargo: { wood: 0, stone: 0, gem: 0 },
    },
    speedLevel: clampLv(s.speedLevel, BALANCE.speed.maxLevel),
    capacityLevel: clampLv(s.capacityLevel, BALANCE.capacity.maxLevel),
    addsPurchased: isInt(s.addsPurchased) ? Math.max(0, s.addsPurchased) : 0,
    mergesPurchased: isInt(s.mergesPurchased) ? Math.max(0, s.mergesPurchased) : 0,
    tutorial: { ...defaultTutorial(), ...(s.tutorial ?? {}) },
    stats: {
      levelTime: isNum(s.stats?.levelTime) ? s.stats.levelTime : 0,
      totalTime: isNum(s.stats?.totalTime) ? s.stats.totalTime : 0,
      totalCut: isNum(s.stats?.totalCut) ? s.stats.totalCut : 0,
      totalRent: isNum(s.stats?.totalRent) ? s.stats.totalRent : 0,
      totalSold: isNum(s.stats?.totalSold) ? s.stats.totalSold : 0,
      lastCompletionBonus: isNum(s.stats?.lastCompletionBonus) ? s.stats.lastCompletionBonus : 0,
      lastLeftoverMoney: isNum(s.stats?.lastLeftoverMoney) ? s.stats.lastLeftoverMoney : 0,
    },
  };
  if (state.train.wagons.length === 0) state.train.wagons = [1];

  // Blok: dibatasi HP maksimum jenisnya; sel kosong/rel yang sudah dibuka tetap kosong.
  state.blocks = s.blocks.map((v, c) => {
    const max = maxHp(f, c);
    if (max < 0 || (f.railStage[c] >= 0 && f.railStage[c] <= state.expandStage)) return -1;
    if (v < 0) return 0;
    return Math.min(max, v);
  });
  state.growth = state.blocks.map((b, c) => {
    const g = Array.isArray(s.growth) ? s.growth[c] : 0;
    return b === 0 && isNum(g) ? Math.max(0, Math.min(0.999, g)) : 0;
  });

  // Kavling: progres hanya untuk cabang terbuka & lahan bersih, dibatasi target.
  state.plots = s.plots.map((v, i) => (isPlotReady(state, i) ? Math.max(0, Math.min(Math.floor(v), plotTarget(state, i))) : 0));
  const allDone = state.plots.every((_, i) => isPlotComplete(state, i));
  state.completed = allDone;

  const track = trackOf(state);
  state.train.distance = track.wrap(s.train.distance);
  const cap = capacity(state);
  const c = s.train.cargo ?? { wood: 0, stone: 0, gem: 0 };
  let room = cap;
  for (const k of ['wood', 'stone', 'gem'] as const) {
    const v = isNum(c[k]) ? Math.max(0, Math.floor(c[k])) : 0;
    state.train.cargo[k] = Math.min(v, room);
    room -= state.train.cargo[k];
  }
  return state;
}

export function loadGame(storage: Storage): { state: GameState | null; corrupted: boolean } {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return { state: null, corrupted: false };
  }
  if (!raw) return { state: null, corrupted: false };
  const state = deserialize(raw);
  if (!state) {
    try {
      storage.setItem(CORRUPT_KEY, raw);
      storage.removeItem(SAVE_KEY);
    } catch {
      /* abaikan */
    }
    return { state: null, corrupted: true };
  }
  return { state, corrupted: false };
}

export function saveGame(storage: Storage, state: GameState): boolean {
  try {
    storage.setItem(SAVE_KEY, serialize(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(storage: Storage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    /* abaikan */
  }
}

export function loadSettings(storage: Storage): Settings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (raw) return { muted: !!JSON.parse(raw).muted };
  } catch {
    /* abaikan */
  }
  return { muted: false };
}

export function saveSettings(storage: Storage, settings: Settings): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* abaikan */
  }
}
