import { BALANCE } from '../config/balance';
import { LEVELS } from '../config/levels';
import { addCost, capacityCost, expandCost, findMergePair, isPlotReady, mergeCost, plotsOf, speedCost } from './economy';
import type { EventSink } from './events';
import { setupLevel } from './state';
import { stageMapping } from './tracks';
import type { GameState, Runtime } from './types';
import { fieldFor } from './worldgen';

export type ActionResult = { ok: true } | { ok: false; reason: string };

const OK: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });

export { stageMapping };

// ---------------------------------------------------------------------------
// Gerbong
// ---------------------------------------------------------------------------

export function canAddWagon(state: GameState): ActionResult {
  if (state.completed) return fail('Level sudah selesai');
  if (state.train.wagons.length >= BALANCE.maxWagons) return fail('Gerbong penuh — gabungkan dulu');
  if (state.money < addCost(state)) return fail('Uang belum cukup');
  return OK;
}

/** Tambah gerbong gergaji Lv1 di ujung belakang kereta. */
export function addWagon(state: GameState, events: EventSink): ActionResult {
  const can = canAddWagon(state);
  if (!can.ok) return can;
  state.money -= addCost(state);
  state.addsPurchased++;
  state.train.wagons.push(1);
  state.tutorial.add = true;
  events.push({ type: 'add', index: state.train.wagons.length - 1 });
  return OK;
}

export function canMerge(state: GameState): ActionResult {
  if (state.completed) return fail('Level sudah selesai');
  if (!findMergePair(state)) return fail('Butuh 2 gerbong setingkat');
  if (state.money < mergeCost(state)) return fail('Uang belum cukup');
  return OK;
}

/**
 * Gabung dua gerbong setingkat terendah menjadi satu gerbong tingkat berikutnya
 * (gergaji lebih tajam). Gerbong diurutkan ulang: tingkat tertinggi tepat di belakang lokomotif.
 */
export function mergeWagons(state: GameState, events: EventSink): ActionResult {
  const can = canMerge(state);
  if (!can.ok) return can;
  const [a, b] = findMergePair(state)!;
  const level = state.train.wagons[a] + 1;
  state.money -= mergeCost(state);
  state.mergesPurchased++;
  const rest = state.train.wagons.filter((_, i) => i !== a && i !== b);
  rest.push(level);
  state.train.wagons = rest.sort((x, y) => y - x);
  state.tutorial.merge = true;
  events.push({ type: 'merge', a, b, level });
  return OK;
}

// ---------------------------------------------------------------------------
// Kecepatan & kapasitas
// ---------------------------------------------------------------------------

export function canUpgradeSpeed(state: GameState): ActionResult {
  if (state.completed) return fail('Level sudah selesai');
  const c = speedCost(state);
  if (c === null) return fail('Kecepatan maksimum');
  if (state.money < c) return fail('Uang belum cukup');
  return OK;
}

export function upgradeSpeed(state: GameState, events: EventSink): ActionResult {
  const can = canUpgradeSpeed(state);
  if (!can.ok) return can;
  state.money -= speedCost(state)!;
  state.speedLevel++;
  state.tutorial.speed = true;
  events.push({ type: 'speed', level: state.speedLevel });
  return OK;
}

export function canUpgradeCapacity(state: GameState): ActionResult {
  if (state.completed) return fail('Level sudah selesai');
  const c = capacityCost(state);
  if (c === null) return fail('Kapasitas maksimum');
  if (state.money < c) return fail('Uang belum cukup');
  return OK;
}

export function upgradeCapacity(state: GameState, events: EventSink): ActionResult {
  const can = canUpgradeCapacity(state);
  if (!can.ok) return can;
  state.money -= capacityCost(state)!;
  state.capacityLevel++;
  state.tutorial.capacity = true;
  events.push({ type: 'capacity', level: state.capacityLevel });
  return OK;
}

// ---------------------------------------------------------------------------
// Rel baru (expand)
// ---------------------------------------------------------------------------

export function canExpand(state: GameState): ActionResult {
  if (state.completed) return fail('Level sudah selesai');
  const cost = expandCost(state);
  if (cost === null) return fail('Semua jalur sudah dibuka');
  if (state.money < cost) return fail('Uang belum cukup');
  return OK;
}

/**
 * Rel baru: lintasan diganti konfigurasi tahap berikutnya; blok di jalur rel baru
 * dibersihkan. Progres bangunan, muatan & gerbong TIDAK berubah; posisi kereta dipetakan
 * ke lintasan baru dengan urutan relatif terhadap stasiun & kavling lama tetap sama.
 */
export function expandTrack(state: GameState, rt: Runtime | null, events: EventSink): ActionResult {
  const can = canExpand(state);
  if (!can.ok) return can;
  const from = state.expandStage;
  const to = from + 1;
  state.money -= expandCost(state)!;
  state.train.distance = stageMapping(state.levelIndex, from, to).map(state.train.distance);
  state.expandStage = to;
  const f = fieldFor(state.levelIndex);
  const cleared: number[] = [];
  for (let c = 0; c < f.n; c++) {
    if (f.railStage[c] === to && state.blocks[c] !== -1) {
      state.blocks[c] = -1;
      state.growth[c] = 0;
      cleared.push(c);
    }
  }
  state.tutorial.expand = true;
  if (rt) rt.freeze = BALANCE.expandFreeze;
  events.push({ type: 'expand', from, to, cleared });
  // Kavling di cabang baru yang kebetulan sudah bersih langsung siap dibangun.
  const level = LEVELS[state.levelIndex];
  for (const p of plotsOf(state.levelIndex)) {
    if (level.streets[p.street].unlockStage === to && isPlotReady(state, p.index)) events.push({ type: 'plotReady', plot: p.index });
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Level berikutnya
// ---------------------------------------------------------------------------

export function nextProject(state: GameState, events: EventSink): ActionResult {
  if (!state.completed) return fail('Selesaikan semua bangunan dulu');
  let idx = state.levelIndex + 1;
  let cycle = state.cycle;
  if (idx >= LEVELS.length) {
    idx = 0;
    cycle++;
  }
  setupLevel(state, idx, cycle);
  events.push({ type: 'nextProject', levelIndex: idx });
  return OK;
}

export function isLastLevel(state: GameState): boolean {
  return state.levelIndex === LEVELS.length - 1;
}
