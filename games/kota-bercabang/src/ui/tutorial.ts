import { canAddMachine, canAddVehicle, canExpand, canUpgrade } from '../game/actions';
import { findMergePair, isPlotComplete, isPlotUnlocked } from '../game/economy';
import type { GameState, Runtime, TutorialFlags } from '../game/types';

export interface TutorialStep {
  key: keyof TutorialFlags;
  text: string;
  target: 'world' | 'add' | 'merge' | 'expand' | 'upgrade' | 'machine';
}

/**
 * Pengantar singkat yang tidak memblokir: satu petunjuk kecil pada satu waktu,
 * muncul hanya saat relevan dan hilang begitu pemain melakukannya.
 */
export function currentTutorial(state: GameState, rt: Runtime): TutorialStep | null {
  if (state.completed) return null;
  const t = state.tutorial;
  if (!t.boost && state.stats.totalDelivered > 0) return { key: 'boost', text: 'Ketuk / tahan layar untuk ngebut! Geser untuk lihat kota', target: 'world' };
  if (!t.merge && findMergePair(state)) return { key: 'merge', text: 'Gabung 2 truk setingkat → muat lebih banyak', target: 'merge' };
  if (!t.add && canAddVehicle(state).ok) return { key: 'add', text: 'Uang cukup! Tambah truk', target: 'add' };
  if (!t.upgrade && state.vehicles.length >= 2 && rt.storageFill < 0.3 && canUpgrade(state).ok) return { key: 'upgrade', text: 'Stok pabrik cepat habis — naikkan produksi', target: 'upgrade' };
  if (!t.expand && t.add) {
    const allOpenDone = state.plots.every((_, i) => !isPlotUnlocked(state, i) || isPlotComplete(state, i) || state.plots[i] > 0);
    if (canExpand(state).ok && allOpenDone) return { key: 'expand', text: 'Buka jalan baru → kavling & sewa lebih banyak', target: 'expand' };
  }
  if (!t.machine && t.upgrade && canAddMachine(state).ok) return { key: 'machine', text: 'Tambah mesin: jalur conveyor baru di pabrik', target: 'machine' };
  return null;
}

/** Tandai langkah boost selesai setelah pemain benar-benar mencobanya. */
export function updateTutorialFlags(state: GameState, rt: Runtime): boolean {
  if (!state.tutorial.boost && (rt.boost.usedSeconds > 1.2 || (state.stats.totalDelivered > 0 && state.stats.levelTime > 50))) {
    state.tutorial.boost = true;
    return true;
  }
  return false;
}
