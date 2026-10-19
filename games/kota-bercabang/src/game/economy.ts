import { BALANCE, MAX_VEHICLE_LEVEL } from '../config/balance';
import { getBuilding } from '../config/buildings';
import { CITIES } from '../config/cities';
import { pickupPoints, resolvePlots, stageDef, type ResolvedPlot } from './layout';
import { TrackPath } from './track';
import type { CityDefinition, FinalProject, GameState } from './types';

// ---------------------------------------------------------------------------
// Akses konteks kota
// ---------------------------------------------------------------------------

export function cityDef(state: GameState): CityDefinition {
  return CITIES[state.levelIndex];
}

/** Skala kesulitan untuk putaran ulang daftar kota (cycle 0 = 1×). */
export function cycleScale(state: GameState): number {
  return 1 + BALANCE.cycleScale * state.cycle;
}

const trackCache = new Map<string, TrackPath>();

export function trackFor(levelIndex: number, stage: number): TrackPath {
  const key = `${levelIndex}:${stage}`;
  let t = trackCache.get(key);
  if (!t) {
    t = new TrackPath(stageDef(CITIES[levelIndex], stage));
    trackCache.set(key, t);
  }
  return t;
}

export function trackOf(state: GameState): TrackPath {
  return trackFor(state.levelIndex, state.expandStage);
}

const plotCache = new Map<number, ResolvedPlot[]>();

/** Semua kavling kota (posisi, arah hadap, titik jangkar di lajur). */
export function plotsOf(levelIndex: number): ResolvedPlot[] {
  let p = plotCache.get(levelIndex);
  if (!p) {
    p = resolvePlots(CITIES[levelIndex]);
    plotCache.set(levelIndex, p);
  }
  return p;
}

export function isPlotUnlocked(state: GameState, plot: number): boolean {
  const p = plotsOf(state.levelIndex)[plot];
  return cityDef(state).streets[p.street].unlockStage <= state.expandStage;
}

/** Proyek bangunan final sebuah kavling (target sudah termasuk skala putaran). */
export function plotProject(state: GameState, plot: number): FinalProject {
  const p = plotsOf(state.levelIndex)[plot];
  return getBuilding(p.def.building, p.def.variant, Math.round(p.def.target * cycleScale(state)));
}

export function plotTarget(state: GameState, plot: number): number {
  return plotProject(state, plot).target;
}

export function isPlotComplete(state: GameState, plot: number): boolean {
  return state.plots[plot] >= plotTarget(state, plot);
}

export function plotRent(state: GameState, plot: number): number {
  return Math.round(plotsOf(state.levelIndex)[plot].def.rent * cycleScale(state));
}

const keyCache = new Map<string, number>();

/** Jarak titik jangkar kavling pada lintasan tahap tertentu. */
export function plotDistance(levelIndex: number, stage: number, plot: number): number {
  const key = `p${levelIndex}:${stage}:${plot}`;
  let d = keyCache.get(key);
  if (d === undefined) {
    d = trackFor(levelIndex, stage).closestDistance(plotsOf(levelIndex)[plot].anchor).d;
    keyCache.set(key, d);
  }
  return d;
}

/** Jarak titik pickup depot ke-i (4 sisi) pada lintasan tahap tertentu. */
export function pickupDistance(levelIndex: number, stage: number, i: number): number {
  const key = `k${levelIndex}:${stage}:${i}`;
  let d = keyCache.get(key);
  if (d === undefined) {
    d = trackFor(levelIndex, stage).closestDistance(pickupPoints(CITIES[levelIndex])[i]).d;
    keyCache.set(key, d);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Rumus angka
// ---------------------------------------------------------------------------

export function vehicleCapacity(level: number): number {
  const caps = BALANCE.vehicleCapacity;
  return caps[Math.max(0, Math.min(caps.length - 1, level - 1))];
}

export function maxVehicles(state: GameState): number {
  return Math.max(4, Math.floor(trackOf(state).length / BALANCE.lengthPerVehicle));
}

/** Detik per item untuk tiap mesin pada Produksi Lv. saat ini. */
export function productionInterval(state: GameState): number {
  return cityDef(state).baseInterval / Math.pow(BALANCE.productionGrowth, state.depot.level - 1);
}

/** Total item per detik semua mesin. */
export function productionRate(state: GameState): number {
  return state.depot.machines / productionInterval(state);
}

export function storageCapacity(state: GameState): number {
  const s = BALANCE.storage;
  return s.base + s.perLevel * (state.depot.level - 1) + s.perMachine * (state.depot.machines - 1);
}

function niceRound(v: number): number {
  if (v < 100) return Math.round(v);
  if (v < 1000) return Math.round(v / 5) * 5;
  if (v < 10000) return Math.round(v / 10) * 10;
  return Math.round(v / 100) * 100;
}

function costMult(state: GameState): number {
  return cityDef(state).costScale * cycleScale(state);
}

export function addCost(state: GameState): number {
  return niceRound(BALANCE.add.base * costMult(state) * Math.pow(BALANCE.add.growth, state.addsPurchased));
}

export function upgradeCost(state: GameState): number {
  return niceRound(BALANCE.upgrade.base * costMult(state) * Math.pow(BALANCE.upgrade.growth, state.depot.level - 1));
}

export function canUpgradeMore(state: GameState): boolean {
  return state.depot.level < BALANCE.upgrade.maxLevel;
}

/** Biaya mesin berikutnya, atau null bila sudah maksimum. */
export function machineCost(state: GameState): number | null {
  const costs = cityDef(state).machineCosts;
  if (state.depot.machines >= Math.min(BALANCE.maxMachines, costs.length)) return null;
  return niceRound(costs[state.depot.machines] * cycleScale(state));
}

export function expandCost(state: GameState): number | null {
  const costs = cityDef(state).expandCosts;
  if (state.expandStage >= costs.length) return null;
  return niceRound(costs[state.expandStage] * cycleScale(state));
}

export function moneyPerUnit(state: GameState): number {
  return cityDef(state).moneyPerUnit;
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
      const sorted = ids.map((id) => state.vehicles.find((v) => v.id === id)!).sort((a, b) => b.cargo - a.cargo || a.id - b.id);
      return [sorted[0].id, sorted[1].id];
    }
  }
  return null;
}

/** Jumlah bangunan selesai / total (seluruh kota). */
export function buildingsDone(state: GameState): { done: number; total: number; unlocked: number } {
  let done = 0;
  let unlocked = 0;
  for (let i = 0; i < state.plots.length; i++) {
    if (isPlotUnlocked(state, i)) unlocked++;
    if (isPlotComplete(state, i)) done++;
  }
  return { done, total: state.plots.length, unlocked };
}

/** Total material terpasang & dibutuhkan seluruh kota. */
export function materialProgress(state: GameState): { delivered: number; target: number } {
  let delivered = 0;
  let target = 0;
  for (let i = 0; i < state.plots.length; i++) {
    const t = plotTarget(state, i);
    target += t;
    delivered += Math.min(t, state.plots[i]);
  }
  return { delivered, target };
}
