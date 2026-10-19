import { BALANCE } from '../config/balance';
import { getBuilding } from '../config/buildings';
import { LEVELS } from '../config/levels';
import { plotsOfLevel, type ResolvedPlot } from './layout';
import { trackFor } from './tracks';
import type { TrackPath } from './track';
import type { Cargo, FinalProject, GameState, LevelDefinition, Resource } from './types';
import { fieldFor } from './worldgen';

export { trackFor };

// ---------------------------------------------------------------------------
// Konteks level
// ---------------------------------------------------------------------------

export function levelDef(state: GameState): LevelDefinition {
  return LEVELS[state.levelIndex];
}

export function cycleScale(state: GameState): number {
  return 1 + BALANCE.cycleScale * state.cycle;
}

export function trackOf(state: GameState): TrackPath {
  return trackFor(state.levelIndex, state.expandStage);
}

export function plotsOf(levelIndex: number): ResolvedPlot[] {
  return plotsOfLevel(levelIndex);
}

export function isPlotUnlocked(state: GameState, plot: number): boolean {
  const p = plotsOf(state.levelIndex)[plot];
  return levelDef(state).streets[p.street].unlockStage <= state.expandStage;
}

/** Lahan kavling sudah bersih (semua blok di atasnya ditebang) dan cabangnya terbuka. */
export function isPlotReady(state: GameState, plot: number): boolean {
  if (!isPlotUnlocked(state, plot)) return false;
  for (const c of fieldFor(state.levelIndex).plotCells[plot]) if (state.blocks[c] > 0) return false;
  return true;
}

/** Persentase lahan kavling yang sudah bersih (0..1). */
export function plotClearedRatio(state: GameState, plot: number): number {
  const cells = fieldFor(state.levelIndex).plotCells[plot];
  if (!cells.length) return 1;
  return cells.filter((c) => state.blocks[c] <= 0).length / cells.length;
}

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

export function plotDistance(levelIndex: number, stage: number, plot: number): number {
  const key = `p${levelIndex}:${stage}:${plot}`;
  let d = keyCache.get(key);
  if (d === undefined) {
    d = trackFor(levelIndex, stage).closestDistance(plotsOf(levelIndex)[plot].anchor).d;
    keyCache.set(key, d);
  }
  return d;
}

/** Stasiun berada di titik awal loop (jarak 0), di sisi barat lapangan stasiun. */
export const STATION_D = 0;

// ---------------------------------------------------------------------------
// Rumus angka
// ---------------------------------------------------------------------------

export function trainSpeed(state: GameState): number {
  return BALANCE.speed.base * (1 + BALANCE.speed.perLevel * (state.speedLevel - 1));
}

export function capacity(state: GameState): number {
  return Math.round(BALANCE.capacity.base * Math.pow(BALANCE.capacity.growth, state.capacityLevel - 1));
}

export function sawDps(level: number): number {
  return BALANCE.saw.dps * Math.pow(BALANCE.saw.growth, level - 1);
}

/** Jangkauan gergaji gerbong (melebar tiap tingkat merge). */
export function sawReach(level: number): number {
  return BALANCE.saw.reach + BALANCE.saw.reachPerLevel * (level - 1);
}

export function cargoTotal(c: Cargo): number {
  return c.wood + c.stone + c.gem;
}

export function price(state: GameState, r: Resource): number {
  return BALANCE.price[r] * cycleScale(state);
}

export function cargoValue(state: GameState, c: Cargo): number {
  return Math.round(c.wood * price(state, 'wood') + c.stone * price(state, 'stone') + c.gem * price(state, 'gem'));
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
  const c = BALANCE.cost.add;
  return niceRound(c.base * costMult(state) * Math.pow(c.growth, state.addsPurchased));
}

export function mergeCost(state: GameState): number {
  const c = BALANCE.cost.merge;
  return niceRound(c.base * costMult(state) * Math.pow(c.growth, state.mergesPurchased));
}

export function speedCost(state: GameState): number | null {
  if (state.speedLevel >= BALANCE.speed.maxLevel) return null;
  const c = BALANCE.cost.speed;
  return niceRound(c.base * costMult(state) * Math.pow(c.growth, state.speedLevel - 1));
}

export function capacityCost(state: GameState): number | null {
  if (state.capacityLevel >= BALANCE.capacity.maxLevel) return null;
  const c = BALANCE.cost.capacity;
  return niceRound(c.base * costMult(state) * Math.pow(c.growth, state.capacityLevel - 1));
}

export function expandCost(state: GameState): number | null {
  const costs = levelDef(state).expandCosts;
  if (state.expandStage >= costs.length) return null;
  return niceRound(costs[state.expandStage] * cycleScale(state));
}

/** Pasangan gerbong setingkat terendah (indeks di array wagons), atau null. */
export function findMergePair(state: GameState): [number, number] | null {
  const w = state.train.wagons;
  for (let lv = 1; lv < BALANCE.maxWagonLevel; lv++) {
    const idx = w.map((l, i) => (l === lv ? i : -1)).filter((i) => i >= 0);
    if (idx.length >= 2) return [idx[idx.length - 2], idx[idx.length - 1]];
  }
  return null;
}

export function buildingsDone(state: GameState): { done: number; total: number } {
  let done = 0;
  for (let i = 0; i < state.plots.length; i++) if (isPlotComplete(state, i)) done++;
  return { done, total: state.plots.length };
}

/** Porsi blok hutan yang sudah ditebang (0..1). */
export function forestCleared(state: GameState): number {
  const f = fieldFor(state.levelIndex);
  let cut = 0;
  let total = 0;
  for (let c = 0; c < f.n; c++) {
    if (f.kind[c] < 0) continue;
    total++;
    if (state.blocks[c] === 0) cut++;
  }
  return total ? cut / total : 0;
}
