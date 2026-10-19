import { LEVELS } from '../config/levels';
import { trackFor } from './economy';
import type { GameState, Runtime, Station, TutorialFlags } from './types';

export function defaultTutorial(): TutorialFlags {
  return { boost: false, add: false, merge: false, expand: false, build: false, upgrade: false };
}

/** State awal permainan baru (level 1). */
export function createNewGame(): GameState {
  const state: GameState = {
    levelIndex: 0,
    cycle: 0,
    money: 0,
    delivered: 0,
    stagesPaid: 0,
    completed: false,
    expandStage: 0,
    addsPurchased: 0,
    vehicles: [],
    nextVehicleId: 1,
    stations: [],
    tutorial: defaultTutorial(),
    stats: { levelTime: 0, totalTime: 0, totalDelivered: 0, lastLeftoverMoney: 0, lastCompletionBonus: 0 },
  };
  setupLevel(state, 0, 0);
  return state;
}

/**
 * Menyiapkan level (proyek) baru: lintasan tahap 0, satu mesin, satu kendaraan Lv1.
 * Uang, tutorial, dan statistik total dibawa dari level sebelumnya.
 */
export function setupLevel(state: GameState, levelIndex: number, cycle: number): void {
  const level = LEVELS[levelIndex];
  state.levelIndex = levelIndex;
  state.cycle = cycle;
  state.delivered = 0;
  state.stagesPaid = 0;
  state.completed = false;
  state.expandStage = 0;
  state.addsPurchased = 0;
  state.stats.levelTime = 0;
  state.stats.lastLeftoverMoney = 0;
  state.stats.lastCompletionBonus = 0;
  state.stations = level.slots.map(
    (s, i): Station => ({
      slot: i,
      built: s.unlockStage === 0 && i === 0,
      level: 1,
      storage: i === 0 ? level.startStorage : 0,
      conveyor: [],
      timer: 0,
    }),
  );
  const track = trackFor(levelIndex, 0);
  // Mulai tepat setelah titik bongkar supaya urutan pertama: ambil di stasiun A → bongkar.
  state.vehicles = [{ id: state.nextVehicleId++, level: 1, cargo: 0, distance: track.length * 0.03 }];
}

export function createRuntime(): Runtime {
  return {
    boost: { energy: 1, holding: false, tapTimer: 0, exhausted: false, rechargeDelay: 0, mult: 1, usedSeconds: 0 },
    freeze: 0,
    recentLoads: [],
    storageFill: 0,
  };
}
