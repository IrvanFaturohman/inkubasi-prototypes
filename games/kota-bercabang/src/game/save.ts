import { BALANCE, MAX_VEHICLE_LEVEL } from '../config/balance';
import { CITIES } from '../config/cities';
import { isPlotComplete, plotTarget, plotsOf, storageCapacity, trackOf, vehicleCapacity } from './economy';
import { stageCount } from './layout';
import { defaultTutorial, newDepot } from './state';
import type { GameState, Vehicle } from './types';

export const SAVE_KEY = 'loop-builders/city-save';
export const SETTINGS_KEY = 'loop-builders/settings';
export const CORRUPT_KEY = 'loop-builders/city-save-corrupt';
/** Versi 2 = konsep kota bercabang (save versi 1 rumah tunggal tidak dipakai lagi). */
export const SCHEMA_VERSION = 2;

interface SaveFile {
  schema: number;
  savedAt: number;
  state: GameState;
}

export interface Settings {
  muted: boolean;
}

export function serialize(state: GameState): string {
  const file: SaveFile = { schema: SCHEMA_VERSION, savedAt: Date.now(), state };
  return JSON.stringify(file);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Math.floor(v) === v;

/**
 * Membaca & memvalidasi save. Mengembalikan null bila rusak/versi tidak dikenal
 * (pemanggil lalu memulai permainan baru dan menyimpan salinan save rusak).
 * Nilai yang sedikit di luar batas dirapikan (clamp) agar invarian simulasi tetap aman.
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
  if (!isInt(s.levelIndex) || s.levelIndex < 0 || s.levelIndex >= CITIES.length) return null;
  if (!isInt(s.cycle) || s.cycle < 0) return null;
  const city = CITIES[s.levelIndex];
  if (!isInt(s.expandStage) || s.expandStage < 0 || s.expandStage >= stageCount(city)) return null;
  if (!isNum(s.money) || !isInt(s.addsPurchased) || !isInt(s.nextVehicleId)) return null;
  if (!Array.isArray(s.vehicles) || !Array.isArray(s.plots) || !s.depot || typeof s.depot !== 'object') return null;
  const plotCount = plotsOf(s.levelIndex).length;
  if (s.plots.length !== plotCount || !s.plots.every(isNum)) return null;

  const state: GameState = {
    levelIndex: s.levelIndex,
    cycle: s.cycle,
    money: Math.max(0, s.money),
    plots: s.plots.map((v) => Math.max(0, Math.floor(v))),
    streetsPaid: city.streets.map((_, i) => !!s.streetsPaid?.[i]),
    completed: !!s.completed,
    expandStage: s.expandStage,
    addsPurchased: Math.max(0, s.addsPurchased),
    vehicles: [],
    nextVehicleId: s.nextVehicleId,
    depot: newDepot(0),
    tutorial: { ...defaultTutorial(), ...(s.tutorial ?? {}) },
    stats: {
      levelTime: isNum(s.stats?.levelTime) ? s.stats.levelTime : 0,
      totalTime: isNum(s.stats?.totalTime) ? s.stats.totalTime : 0,
      totalDelivered: isNum(s.stats?.totalDelivered) ? s.stats.totalDelivered : 0,
      totalRent: isNum(s.stats?.totalRent) ? s.stats.totalRent : 0,
      lastLeftoverMoney: isNum(s.stats?.lastLeftoverMoney) ? s.stats.lastLeftoverMoney : 0,
      lastCompletionBonus: isNum(s.stats?.lastCompletionBonus) ? s.stats.lastCompletionBonus : 0,
    },
  };

  // Kavling di jalan yang belum terbuka tidak boleh punya progres; progres dibatasi target.
  const plots = plotsOf(state.levelIndex);
  state.plots = state.plots.map((v, i) => (city.streets[plots[i].street].unlockStage <= state.expandStage ? Math.min(v, plotTarget(state, i)) : 0));
  const allDone = state.plots.every((_, i) => isPlotComplete(state, i));
  if (allDone) state.completed = true;
  if (state.completed && !allDone) state.completed = false;

  // Depot
  const d = s.depot;
  if (!isInt(d.level) || !isInt(d.machines) || !isNum(d.storage) || !Array.isArray(d.lines) || !Array.isArray(d.timers)) return null;
  state.depot.level = Math.max(1, Math.min(BALANCE.upgrade.maxLevel, d.level));
  state.depot.machines = Math.max(1, Math.min(BALANCE.maxMachines, d.machines));
  state.depot.storage = Math.max(0, Math.floor(d.storage));
  for (let m = 0; m < BALANCE.maxMachines; m++) {
    const line = Array.isArray(d.lines[m]) ? d.lines[m].filter(isNum).map((p) => Math.max(0, Math.min(0.999, p))) : [];
    state.depot.lines[m] = m < state.depot.machines ? line.sort((a, b) => b - a) : [];
    state.depot.timers[m] = isNum(d.timers[m]) ? Math.max(0, d.timers[m]) : 0;
  }
  // Jaga invarian stok + conveyor <= kapasitas.
  const cap = storageCapacity(state);
  state.depot.storage = Math.min(state.depot.storage, cap);
  let room = cap - state.depot.storage;
  for (let m = 0; m < state.depot.machines; m++) {
    state.depot.lines[m] = state.depot.lines[m].slice(0, Math.max(0, room));
    room -= state.depot.lines[m].length;
  }

  const track = trackOf(state);
  const ids = new Set<number>();
  for (const raw of s.vehicles as Vehicle[]) {
    if (!raw || !isInt(raw.id) || !isInt(raw.level) || !isNum(raw.cargo) || !isNum(raw.distance)) return null;
    if (ids.has(raw.id)) return null;
    ids.add(raw.id);
    const lv = Math.max(1, Math.min(MAX_VEHICLE_LEVEL, raw.level));
    state.vehicles.push({ id: raw.id, level: lv, cargo: Math.max(0, Math.min(vehicleCapacity(lv), Math.floor(raw.cargo))), distance: track.wrap(raw.distance) });
  }
  if (state.vehicles.length === 0 && !state.completed) return null;
  state.nextVehicleId = Math.max(state.nextVehicleId, ...state.vehicles.map((v) => v.id + 1), 1);
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
    if (raw) {
      const s = JSON.parse(raw);
      return { muted: !!s.muted };
    }
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
