import { MAX_VEHICLE_LEVEL } from '../config/balance';
import { LEVELS } from '../config/levels';
import { completedStageCount } from './building';
import { projectOf, storageCapacity, trackOf, vehicleCapacity } from './economy';
import { defaultTutorial } from './state';
import type { GameState, Station, Vehicle } from './types';

export const SAVE_KEY = 'loop-builders/save';
export const SETTINGS_KEY = 'loop-builders/settings';
export const CORRUPT_KEY = 'loop-builders/save-corrupt';
export const SCHEMA_VERSION = 1;

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
 * (pemanggil lalu memulai game baru dan menyimpan salinan save rusak untuk debugging).
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
  if (!isInt(s.levelIndex) || s.levelIndex < 0 || s.levelIndex >= LEVELS.length) return null;
  if (!isInt(s.cycle) || s.cycle < 0) return null;
  const level = LEVELS[s.levelIndex];
  if (!isInt(s.expandStage) || s.expandStage < 0 || s.expandStage >= level.trackStages.length) return null;
  if (!isNum(s.money) || !isNum(s.delivered) || !isInt(s.addsPurchased) || !isInt(s.nextVehicleId)) return null;
  if (!Array.isArray(s.vehicles) || !Array.isArray(s.stations)) return null;
  if (s.stations.length !== level.slots.length) return null;

  const state: GameState = {
    levelIndex: s.levelIndex,
    cycle: s.cycle,
    money: Math.max(0, s.money),
    delivered: Math.max(0, Math.floor(s.delivered)),
    stagesPaid: isInt(s.stagesPaid) ? Math.max(0, s.stagesPaid) : 0,
    completed: !!s.completed,
    expandStage: s.expandStage,
    addsPurchased: Math.max(0, s.addsPurchased),
    vehicles: [],
    nextVehicleId: s.nextVehicleId,
    stations: [],
    tutorial: { ...defaultTutorial(), ...(s.tutorial ?? {}) },
    stats: {
      levelTime: isNum(s.stats?.levelTime) ? s.stats.levelTime : 0,
      totalTime: isNum(s.stats?.totalTime) ? s.stats.totalTime : 0,
      totalDelivered: isNum(s.stats?.totalDelivered) ? s.stats.totalDelivered : 0,
      lastLeftoverMoney: isNum(s.stats?.lastLeftoverMoney) ? s.stats.lastLeftoverMoney : 0,
      lastCompletionBonus: isNum(s.stats?.lastCompletionBonus) ? s.stats.lastCompletionBonus : 0,
    },
  };

  const project = projectOf(state);
  state.delivered = Math.min(state.delivered, project.target);
  if (state.delivered >= project.target) state.completed = true;
  if (state.completed && state.delivered < project.target) state.delivered = project.target;
  // Bonus tahap yang sudah dibayar tidak boleh melebihi tahap yang benar-benar selesai.
  state.stagesPaid = Math.min(state.stagesPaid, completedStageCount(project, state.delivered));

  const track = trackOf(state);
  const ids = new Set<number>();
  for (const raw of s.vehicles as Vehicle[]) {
    if (!raw || !isInt(raw.id) || !isInt(raw.level) || !isNum(raw.cargo) || !isNum(raw.distance)) return null;
    if (ids.has(raw.id)) return null;
    ids.add(raw.id);
    const lv = Math.max(1, Math.min(MAX_VEHICLE_LEVEL, raw.level));
    state.vehicles.push({
      id: raw.id,
      level: lv,
      cargo: Math.max(0, Math.min(vehicleCapacity(lv), Math.floor(raw.cargo))),
      distance: track.wrap(raw.distance),
    });
  }
  if (state.vehicles.length === 0 && !state.completed) return null;
  state.nextVehicleId = Math.max(state.nextVehicleId, ...state.vehicles.map((v) => v.id + 1), 1);

  for (let i = 0; i < level.slots.length; i++) {
    const raw = s.stations[i] as Station;
    if (!raw || !isInt(raw.level) || !isNum(raw.storage) || !Array.isArray(raw.conveyor)) return null;
    const unlocked = level.slots[i].unlockStage <= state.expandStage;
    const st: Station = {
      slot: i,
      built: !!raw.built && unlocked,
      level: Math.max(1, raw.level),
      storage: Math.max(0, Math.floor(raw.storage)),
      conveyor: raw.conveyor.filter(isNum).map((p) => Math.max(0, Math.min(0.999, p))),
      timer: isNum(raw.timer) ? Math.max(0, raw.timer) : 0,
    };
    // Jaga invarian storage + conveyor <= kapasitas.
    const cap = storageCapacity(st);
    st.storage = Math.min(st.storage, cap);
    st.conveyor = st.conveyor.sort((a, b) => b - a).slice(0, cap - st.storage);
    if (!st.built) {
      st.storage = 0;
      st.conveyor = [];
      st.level = 1;
    }
    state.stations.push(st);
  }
  if (!state.stations[0].built) return null;
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
