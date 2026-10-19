import { BALANCE, MAX_VEHICLE_LEVEL } from '../config/balance';
import { LEVELS } from '../config/levels';
import { getProject } from '../config/projects';
import { TrackPath } from './track';
import type { FinalProject, GameState, LevelDefinition, Station } from './types';

// ---------------------------------------------------------------------------
// Akses konteks level
// ---------------------------------------------------------------------------

export function levelDef(state: GameState): LevelDefinition {
  return LEVELS[state.levelIndex];
}

/** Skala kesulitan untuk putaran ulang daftar level (cycle 0 = 1×). */
export function cycleScale(state: GameState): number {
  return 1 + BALANCE.cycleScale * state.cycle;
}

export function projectOf(state: GameState): FinalProject {
  return getProject(levelDef(state).projectId, cycleScale(state));
}

const trackCache = new Map<string, TrackPath>();

export function trackFor(levelIndex: number, stage: number): TrackPath {
  const key = `${levelIndex}:${stage}`;
  let t = trackCache.get(key);
  if (!t) {
    t = new TrackPath(LEVELS[levelIndex].trackStages[stage]);
    trackCache.set(key, t);
  }
  return t;
}

export function trackOf(state: GameState): TrackPath {
  return trackFor(state.levelIndex, state.expandStage);
}

const pickupCache = new Map<string, number>();

/** Jarak titik pickup slot pada lintasan tahap tertentu (proyeksi penyimpanan ke lintasan). */
export function pickupDistance(levelIndex: number, stage: number, slot: number): number {
  const key = `${levelIndex}:${stage}:${slot}`;
  let d = pickupCache.get(key);
  if (d === undefined) {
    const s = LEVELS[levelIndex].slots[slot];
    d = trackFor(levelIndex, stage).closestDistance({ x: s.storage[0], z: s.storage[1] }).d;
    pickupCache.set(key, d);
  }
  return d;
}

export function isSlotUnlocked(state: GameState, slot: number): boolean {
  return levelDef(state).slots[slot].unlockStage <= state.expandStage;
}

// ---------------------------------------------------------------------------
// Rumus angka
// ---------------------------------------------------------------------------

export function vehicleCapacity(level: number): number {
  const caps = BALANCE.vehicleCapacity;
  return caps[Math.max(0, Math.min(caps.length - 1, level - 1))];
}

export function maxVehicles(state: GameState): number {
  return levelDef(state).trackStages[state.expandStage].maxVehicles;
}

/** Detik per item untuk Produksi Lv. tertentu. */
export function productionInterval(state: GameState, station: Station): number {
  return levelDef(state).baseInterval / Math.pow(BALANCE.productionGrowth, station.level - 1);
}

export function productionRate(state: GameState, station: Station): number {
  return 1 / productionInterval(state, station);
}

export function storageCapacity(station: Station): number {
  return BALANCE.storage.base + BALANCE.storage.perLevel * (station.level - 1);
}

function niceRound(v: number): number {
  if (v < 100) return Math.round(v);
  if (v < 1000) return Math.round(v / 5) * 5;
  if (v < 10000) return Math.round(v / 10) * 10;
  return Math.round(v / 100) * 100;
}

function costMult(state: GameState): number {
  return levelDef(state).costScale * cycleScale(state);
}

export function addCost(state: GameState): number {
  return niceRound(BALANCE.add.base * costMult(state) * Math.pow(BALANCE.add.growth, state.addsPurchased));
}

export function upgradeCost(state: GameState, station: Station): number {
  const f = BALANCE.slotUpgradeFactor[station.slot] ?? 1;
  return niceRound(BALANCE.upgrade.base * costMult(state) * f * Math.pow(BALANCE.upgrade.growth, station.level - 1));
}

export function canUpgradeMore(station: Station): boolean {
  return station.level < BALANCE.upgrade.maxLevel;
}

export function buildCost(state: GameState, slot: number): number {
  return niceRound(levelDef(state).slots[slot].buildCost * cycleScale(state));
}

export function expandCost(state: GameState): number | null {
  const costs = levelDef(state).expandCosts;
  if (state.expandStage >= costs.length) return null;
  return niceRound(costs[state.expandStage] * cycleScale(state));
}

export function moneyPerUnit(state: GameState): number {
  return levelDef(state).moneyPerUnit;
}

export function canMergeLevel(level: number): boolean {
  return level < MAX_VEHICLE_LEVEL;
}

/** Pasangan kendaraan setingkat dengan tingkat terendah (untuk tombol Gabung). */
export function findMergePair(state: GameState): [number, number] | null {
  const byLevel = new Map<number, number[]>();
  for (const v of state.vehicles) {
    if (!canMergeLevel(v.level)) continue;
    const arr = byLevel.get(v.level) ?? [];
    arr.push(v.id);
    byLevel.set(v.level, arr);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  for (const lv of levels) {
    const ids = byLevel.get(lv)!;
    if (ids.length >= 2) {
      // Pertahankan kendaraan dengan muatan terbanyak supaya animasi terasa "menyerap".
      const sorted = ids
        .map((id) => state.vehicles.find((v) => v.id === id)!)
        .sort((a, b) => b.cargo - a.cargo || a.id - b.id);
      return [sorted[0].id, sorted[1].id];
    }
  }
  return null;
}
