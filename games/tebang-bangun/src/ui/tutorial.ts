import { canAddWagon, canExpand, canMerge, canUpgradeCapacity, canUpgradeSpeed } from '../game/actions';
import { isPlotComplete, isPlotUnlocked } from '../game/economy';
import type { GameState, Runtime, TutorialFlags } from '../game/types';

export interface TutorialStep {
  key: keyof TutorialFlags;
  text: string;
  target: 'world' | 'add' | 'merge' | 'speed' | 'capacity' | 'expand';
}

/**
 * Pengantar singkat yang tidak memblokir: satu petunjuk kecil pada satu waktu,
 * muncul hanya saat relevan dan hilang begitu pemain melakukannya.
 */
export function currentTutorial(state: GameState, rt: Runtime): TutorialStep | null {
  if (state.completed) return null;
  const t = state.tutorial;
  if (!t.boost && state.stats.totalCut > 3) return { key: 'boost', text: 'Tahan layar untuk ngebut!', target: 'world' };
  if (!t.capacity && rt.fullTime > 2.5 && canUpgradeCapacity(state).ok) return { key: 'capacity', text: 'Muatan penuh — naikkan Kapasitas', target: 'capacity' };
  if (!t.add && canAddWagon(state).ok) return { key: 'add', text: 'Tambah gerbong gergaji', target: 'add' };
  if (!t.merge && canMerge(state).ok) return { key: 'merge', text: 'Gabung 2 gerbong setingkat → gergaji lebih tajam & lebar', target: 'merge' };
  if (!t.speed && t.merge && canUpgradeSpeed(state).ok) return { key: 'speed', text: 'Naikkan kecepatan kereta', target: 'speed' };
  if (!t.expand) {
    const openDone = state.plots.every((_, i) => !isPlotUnlocked(state, i) || isPlotComplete(state, i));
    if (openDone && canExpand(state).ok) return { key: 'expand', text: 'Buka rel baru ke hutan berikutnya', target: 'expand' };
  }
  return null;
}

/** Tandai langkah boost selesai setelah pemain benar-benar mencobanya. */
export function updateTutorialFlags(state: GameState, rt: Runtime): boolean {
  if (!state.tutorial.boost && (rt.boost.usedSeconds > 1.2 || state.stats.levelTime > 60)) {
    state.tutorial.boost = true;
    return true;
  }
  return false;
}
