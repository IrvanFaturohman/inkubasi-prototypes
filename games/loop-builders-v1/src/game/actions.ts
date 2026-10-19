import { BALANCE, MAX_VEHICLE_LEVEL } from '../config/balance';
import { LEVELS } from '../config/levels';
import {
  addCost,
  buildCost,
  canUpgradeMore,
  expandCost,
  findMergePair,
  isSlotUnlocked,
  levelDef,
  maxVehicles,
  moneyPerUnit,
  trackFor,
  trackOf,
  upgradeCost,
  vehicleCapacity,
} from './economy';
import type { EventSink } from './events';
import { setupLevel } from './state';
import { buildStageMapping, type StageMapping } from './track';
import type { GameState, Runtime } from './types';

export type ActionResult = { ok: true } | { ok: false; reason: string };

const OK: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

export function canAddVehicle(state: GameState): ActionResult {
  if (state.completed) return fail('Proyek sudah selesai');
  if (state.vehicles.length >= maxVehicles(state)) return fail('Jalur penuh — gabungkan kendaraan');
  if (state.money < addCost(state)) return fail('Uang belum cukup');
  return OK;
}

/** Posisi spawn: tengah celah terbesar antar kendaraan (tidak menabrak secara visual). */
export function spawnDistance(state: GameState): number {
  const track = trackOf(state);
  const L = track.length;
  if (state.vehicles.length === 0) return L * 0.03;
  const ds = state.vehicles.map((v) => v.distance).sort((a, b) => a - b);
  let bestGap = -1;
  let bestStart = 0;
  for (let i = 0; i < ds.length; i++) {
    const a = ds[i];
    const b = i + 1 < ds.length ? ds[i + 1] : ds[0] + L;
    if (b - a > bestGap) {
      bestGap = b - a;
      bestStart = a;
    }
  }
  return track.wrap(bestStart + bestGap / 2);
}

export function addVehicle(state: GameState, events: EventSink): ActionResult {
  const can = canAddVehicle(state);
  if (!can.ok) return can;
  state.money -= addCost(state);
  state.addsPurchased++;
  const v = { id: state.nextVehicleId++, level: 1, cargo: 0, distance: spawnDistance(state) };
  state.vehicles.push(v);
  state.tutorial.add = true;
  events.push({ type: 'add', vehicleId: v.id });
  return OK;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export function canMerge(state: GameState, keepId: number, removeId: number): ActionResult {
  if (state.completed) return fail('Proyek sudah selesai');
  if (keepId === removeId) return fail('Pilih dua kendaraan berbeda');
  const a = state.vehicles.find((v) => v.id === keepId);
  const b = state.vehicles.find((v) => v.id === removeId);
  if (!a || !b) return fail('Kendaraan tidak ditemukan');
  if (a.level !== b.level) return fail('Tingkat kendaraan harus sama');
  if (a.level >= MAX_VEHICLE_LEVEL) return fail('Sudah tingkat maksimum');
  return OK;
}

/**
 * Menggabungkan dua kendaraan setingkat menjadi satu tingkat berikutnya.
 * Muatan dijumlahkan; bila melebihi kapasitas baru (hanya mungkin jika config diubah),
 * kelebihannya dijual menjadi uang — tidak hilang.
 */
export function mergeVehicles(state: GameState, keepId: number, removeId: number, events: EventSink): ActionResult {
  const can = canMerge(state, keepId, removeId);
  if (!can.ok) return can;
  const a = state.vehicles.find((v) => v.id === keepId)!;
  const b = state.vehicles.find((v) => v.id === removeId)!;
  a.level += 1;
  const total = a.cargo + b.cargo;
  const cap = vehicleCapacity(a.level);
  a.cargo = Math.min(total, cap);
  const overflow = total - a.cargo;
  const overflowMoney = overflow * moneyPerUnit(state);
  state.money += overflowMoney;
  state.vehicles = state.vehicles.filter((v) => v.id !== removeId);
  state.tutorial.merge = true;
  events.push({ type: 'merge', keepId, removedId: removeId, level: a.level, overflowMoney });
  return OK;
}

export function mergeAuto(state: GameState, events: EventSink): ActionResult {
  const pair = findMergePair(state);
  if (!pair) return fail('Butuh dua kendaraan setingkat');
  return mergeVehicles(state, pair[0], pair[1], events);
}

// ---------------------------------------------------------------------------
// Stasiun
// ---------------------------------------------------------------------------

export function canUpgrade(state: GameState, slot: number): ActionResult {
  const st = state.stations[slot];
  if (state.completed) return fail('Proyek sudah selesai');
  if (!st || !st.built) return fail('Mesin belum dibangun');
  if (!canUpgradeMore(st)) return fail('Produksi sudah maksimum');
  if (state.money < upgradeCost(state, st)) return fail('Uang belum cukup');
  return OK;
}

export function upgradeStation(state: GameState, slot: number, events: EventSink): ActionResult {
  const can = canUpgrade(state, slot);
  if (!can.ok) return can;
  const st = state.stations[slot];
  state.money -= upgradeCost(state, st);
  st.level++;
  state.tutorial.upgrade = true;
  events.push({ type: 'upgrade', slot, level: st.level });
  return OK;
}

export function canBuild(state: GameState, slot: number): ActionResult {
  const st = state.stations[slot];
  if (state.completed) return fail('Proyek sudah selesai');
  if (!st) return fail('Slot tidak ada');
  if (st.built) return fail('Mesin sudah ada');
  if (!isSlotUnlocked(state, slot)) return fail('Perluas jalur dulu');
  if (state.money < buildCost(state, slot)) return fail('Uang belum cukup');
  return OK;
}

export function buildStation(state: GameState, slot: number, events: EventSink): ActionResult {
  const can = canBuild(state, slot);
  if (!can.ok) return can;
  state.money -= buildCost(state, slot);
  const st = state.stations[slot];
  st.built = true;
  st.level = 1;
  st.storage = 0;
  st.conveyor = [];
  st.timer = 0;
  state.tutorial.build = true;
  events.push({ type: 'build', slot });
  return OK;
}

// ---------------------------------------------------------------------------
// Expand
// ---------------------------------------------------------------------------

const mappingCache = new Map<string, StageMapping>();

/** Peta jarak lintasan tahap `from` → `to` (dipakai logika & animasi morph). */
export function stageMapping(levelIndex: number, from: number, to: number): StageMapping {
  const key = `${levelIndex}:${from}:${to}`;
  let m = mappingCache.get(key);
  if (!m) {
    const level = LEVELS[levelIndex];
    const lo = Math.min(from, to);
    const shared = level.slots.filter((s) => s.unlockStage <= lo).map((s) => ({ x: s.storage[0], z: s.storage[1] }));
    m = buildStageMapping(trackFor(levelIndex, from), trackFor(levelIndex, to), shared);
    mappingCache.set(key, m);
  }
  return m;
}

export function canExpand(state: GameState): ActionResult {
  if (state.completed) return fail('Proyek sudah selesai');
  const cost = expandCost(state);
  if (cost === null) return fail('Jalur sudah maksimum');
  if (state.money < cost) return fail('Uang belum cukup');
  return OK;
}

/**
 * Expand Track: lintasan diganti konfigurasi tahap berikutnya dan slot baru terbuka.
 * Proyek, progres bangunan, muatan & jumlah kendaraan TIDAK berubah; posisi kendaraan
 * dipetakan ke lintasan baru dengan urutan relatif terhadap titik bongkar/pickup tetap sama.
 */
export function expandTrack(state: GameState, rt: Runtime | null, events: EventSink): ActionResult {
  const can = canExpand(state);
  if (!can.ok) return can;
  const cost = expandCost(state)!;
  const from = state.expandStage;
  const to = from + 1;
  const map = stageMapping(state.levelIndex, from, to);
  state.money -= cost;
  for (const v of state.vehicles) v.distance = map.map(v.distance);
  state.expandStage = to;
  state.tutorial.expand = true;
  if (rt) rt.freeze = BALANCE.expandFreeze;
  events.push({ type: 'expand', from, to });
  return OK;
}

// ---------------------------------------------------------------------------
// Proyek berikutnya
// ---------------------------------------------------------------------------

export function nextProject(state: GameState, events: EventSink): ActionResult {
  if (!state.completed) return fail('Selesaikan bangunan dulu');
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

export { levelDef };
