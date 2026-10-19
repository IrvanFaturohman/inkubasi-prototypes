import { LEVELS } from '../config/levels';
import { plotsOfLevel } from './layout';
import { trackFor } from './tracks';
import type { GameState, Runtime, TutorialFlags } from './types';
import { initialBlocks } from './worldgen';

export function defaultTutorial(): TutorialFlags {
  return { boost: false, add: false, merge: false, expand: false, capacity: false, speed: false };
}

/** State awal permainan baru (level pertama). */
export function createNewGame(): GameState {
  const state: GameState = {
    levelIndex: 0,
    cycle: 0,
    money: 0,
    blocks: [],
    growth: [],
    plots: [],
    streetsPaid: [],
    completed: false,
    expandStage: 0,
    train: { distance: 0, wagons: [1], cargo: { wood: 0, stone: 0, gem: 0 } },
    speedLevel: 1,
    capacityLevel: 1,
    addsPurchased: 0,
    mergesPurchased: 0,
    tutorial: defaultTutorial(),
    stats: { levelTime: 0, totalTime: 0, totalCut: 0, totalRent: 0, totalSold: 0, lastCompletionBonus: 0, lastLeftoverMoney: 0 },
  };
  setupLevel(state, 0, 0);
  return state;
}

/**
 * Menyiapkan level baru: hutan utuh, rel tahap 0, kereta dengan satu gerbong Lv1.
 * Uang, tutorial, dan statistik total dibawa dari level sebelumnya; upgrade kereta di-reset
 * (seperti pindah area di game idle kereta pada umumnya).
 */
export function setupLevel(state: GameState, levelIndex: number, cycle: number): void {
  const level = LEVELS[levelIndex];
  state.levelIndex = levelIndex;
  state.cycle = cycle;
  state.blocks = initialBlocks(levelIndex);
  state.growth = state.blocks.map(() => 0);
  state.plots = plotsOfLevel(levelIndex).map(() => 0);
  state.streetsPaid = level.streets.map(() => false);
  state.completed = false;
  state.expandStage = 0;
  state.speedLevel = 1;
  state.capacityLevel = 1;
  state.addsPurchased = 0;
  state.mergesPurchased = 0;
  state.stats.levelTime = 0;
  state.stats.lastCompletionBonus = 0;
  state.stats.lastLeftoverMoney = 0;
  // Mulai tepat setelah stasiun, menghadap cabang pertama.
  state.train = { distance: trackFor(levelIndex, 0).wrap(0.5), wagons: [1], cargo: { wood: 0, stone: 0, gem: 0 } };
}

export function createRuntime(): Runtime {
  return {
    boost: { energy: 1, holding: false, tapTimer: 0, exhausted: false, rechargeDelay: 0, mult: 1, usedSeconds: 0 },
    freeze: 0,
    cutHeat: 0,
    fullTime: 0,
  };
}
