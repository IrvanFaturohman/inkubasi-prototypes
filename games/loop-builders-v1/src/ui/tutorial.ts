import { canAddVehicle, canExpand } from '../game/actions';
import { findMergePair, isSlotUnlocked, upgradeCost } from '../game/economy';
import type { GameState, Runtime, TutorialFlags } from '../game/types';

export interface TutorialStep {
  key: keyof TutorialFlags;
  text: string;
  target: 'world' | 'add' | 'merge' | 'expand' | 'station' | 'slot';
  slot?: number;
}

/**
 * Pengantar singkat yang tidak memblokir: satu petunjuk kecil pada satu waktu,
 * muncul hanya saat relevan dan hilang begitu pemain melakukannya.
 */
export function currentTutorial(state: GameState, rt: Runtime): TutorialStep | null {
  if (state.completed) return null;
  const t = state.tutorial;
  if (!t.boost && state.delivered > 0) return { key: 'boost', text: 'Ketuk / tahan layar untuk ngebut!', target: 'world' };
  if (!t.merge && findMergePair(state)) return { key: 'merge', text: 'Gabung 2 kendaraan setingkat → muat lebih banyak', target: 'merge' };
  if (!t.add && canAddVehicle(state).ok) return { key: 'add', text: 'Uang cukup! Tambah kendaraan', target: 'add' };
  if (!t.expand && t.add && canExpand(state).ok) return { key: 'expand', text: 'Perluas jalur untuk membuka slot mesin baru', target: 'expand' };
  if (!t.build) {
    const slot = state.stations.findIndex((s, i) => !s.built && isSlotUnlocked(state, i));
    if (slot >= 0) return { key: 'build', text: 'Bangun mesin baru di sini', target: 'slot', slot };
  }
  if (!t.upgrade && state.vehicles.length >= 2 && rt.storageFill < 0.3) {
    const st = state.stations[0];
    if (st.built && state.money >= upgradeCost(state, st)) return { key: 'upgrade', text: 'Stok cepat habis — tingkatkan produksi', target: 'station' };
  }
  return null;
}

/** Tandai langkah boost selesai setelah pemain benar-benar mencobanya. */
export function updateTutorialFlags(state: GameState, rt: Runtime): boolean {
  if (!state.tutorial.boost && (rt.boost.usedSeconds > 1.2 || (state.delivered > 0 && state.stats.levelTime > 50))) {
    state.tutorial.boost = true;
    return true;
  }
  return false;
}
