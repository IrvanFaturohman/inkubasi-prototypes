import { BALANCE } from '../config/balance';
import { CITIES } from '../config/cities';
import { pickupDistance, plotsOf, trackFor } from './economy';
import type { Depot, GameState, Runtime, TutorialFlags } from './types';

export function defaultTutorial(): TutorialFlags {
  return { boost: false, add: false, merge: false, expand: false, machine: false, upgrade: false };
}

export function newDepot(startStorage: number): Depot {
  return {
    level: 1,
    machines: 1,
    storage: startStorage,
    lines: Array.from({ length: BALANCE.maxMachines }, () => []),
    timers: Array.from({ length: BALANCE.maxMachines }, () => 0),
  };
}

/** State awal permainan baru (kota pertama). */
export function createNewGame(): GameState {
  const state: GameState = {
    levelIndex: 0,
    cycle: 0,
    money: 0,
    plots: [],
    streetsPaid: [],
    completed: false,
    expandStage: 0,
    addsPurchased: 0,
    vehicles: [],
    nextVehicleId: 1,
    depot: newDepot(0),
    tutorial: defaultTutorial(),
    stats: { levelTime: 0, totalTime: 0, totalDelivered: 0, totalRent: 0, lastLeftoverMoney: 0, lastCompletionBonus: 0 },
  };
  setupLevel(state, 0, 0);
  return state;
}

/**
 * Menyiapkan kota baru: jalan tahap 0, satu mesin, satu kendaraan Lv1.
 * Uang, tutorial, dan statistik total dibawa dari kota sebelumnya.
 */
export function setupLevel(state: GameState, levelIndex: number, cycle: number): void {
  const city = CITIES[levelIndex];
  state.levelIndex = levelIndex;
  state.cycle = cycle;
  state.plots = plotsOf(levelIndex).map(() => 0);
  state.streetsPaid = city.streets.map(() => false);
  state.completed = false;
  state.expandStage = 0;
  state.addsPurchased = 0;
  state.stats.levelTime = 0;
  state.stats.lastLeftoverMoney = 0;
  state.stats.lastCompletionBonus = 0;
  state.depot = newDepot(city.startStorage);
  const track = trackFor(levelIndex, 0);
  // Mulai tepat sebelum pickup sisi utara → langsung isi muatan lalu masuk jalan pertama.
  const d = track.wrap(pickupDistance(levelIndex, 0, 0) - 0.6);
  state.vehicles = [{ id: state.nextVehicleId++, level: 1, cargo: 0, distance: d }];
}

export function createRuntime(): Runtime {
  return {
    boost: { energy: 1, holding: false, tapTimer: 0, exhausted: false, rechargeDelay: 0, mult: 1, usedSeconds: 0 },
    freeze: 0,
    recentLoads: [],
    storageFill: 0,
  };
}
