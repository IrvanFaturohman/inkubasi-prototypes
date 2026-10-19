import { BALANCE, MAX_VEHICLE_LEVEL } from '../config/balance';
import { CITIES } from '../config/cities';
import {
  addCost,
  canUpgradeMore,
  expandCost,
  findMergePair,
  machineCost,
  maxVehicles,
  moneyPerUnit,
  plotsOf,
  trackFor,
  trackOf,
  upgradeCost,
  vehicleCapacity,
} from './economy';
import type { EventSink } from './events';
import { pickupPoints } from './layout';
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
  if (state.completed) return fail('Kota sudah selesai');
  if (state.vehicles.length >= maxVehicles(state)) return fail('Jalan penuh — gabungkan kendaraan');
  if (state.money < addCost(state)) return fail('Uang belum cukup');
  return OK;
}

/** Posisi spawn: tengah celah terbesar antar kendaraan (tidak menabrak secara visual). */
export function spawnDistance(state: GameState): number {
  const track = trackOf(state);
  const L = track.length;
  if (state.vehicles.length === 0) return 0;
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
  if (state.completed) return fail('Kota sudah selesai');
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
 * Muatan dijumlahkan; kelebihan (hanya mungkin jika config diubah) dijual menjadi uang.
 */
export function mergeVehicles(state: GameState, keepId: number, removeId: number, events: EventSink): ActionResult {
  const can = canMerge(state, keepId, removeId);
  if (!can.ok) return can;
  const a = state.vehicles.find((v) => v.id === keepId)!;
  const b = state.vehicles.find((v) => v.id === removeId)!;
  a.level += 1;
  const total = a.cargo + b.cargo;
  a.cargo = Math.min(total, vehicleCapacity(a.level));
  const overflowMoney = (total - a.cargo) * moneyPerUnit(state);
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
// Depot: upgrade produksi & tambah mesin
// ---------------------------------------------------------------------------

export function canUpgrade(state: GameState): ActionResult {
  if (state.completed) return fail('Kota sudah selesai');
  if (!canUpgradeMore(state)) return fail('Produksi sudah maksimum');
  if (state.money < upgradeCost(state)) return fail('Uang belum cukup');
  return OK;
}

export function upgradeDepot(state: GameState, events: EventSink): ActionResult {
  const can = canUpgrade(state);
  if (!can.ok) return can;
  state.money -= upgradeCost(state);
  state.depot.level++;
  state.tutorial.upgrade = true;
  events.push({ type: 'upgrade', level: state.depot.level });
  return OK;
}

export function canAddMachine(state: GameState): ActionResult {
  if (state.completed) return fail('Kota sudah selesai');
  const cost = machineCost(state);
  if (cost === null) return fail('Mesin sudah maksimum');
  if (state.money < cost) return fail('Uang belum cukup');
  return OK;
}

export function addMachine(state: GameState, events: EventSink): ActionResult {
  const can = canAddMachine(state);
  if (!can.ok) return can;
  state.money -= machineCost(state)!;
  const line = state.depot.machines;
  state.depot.machines++;
  state.depot.lines[line] = [];
  state.depot.timers[line] = 0;
  state.tutorial.machine = true;
  events.push({ type: 'machine', line });
  return OK;
}

// ---------------------------------------------------------------------------
// Expand (jalan baru)
// ---------------------------------------------------------------------------

const mappingCache = new Map<string, StageMapping>();

/** Peta jarak lintasan tahap `from` → `to` (dipakai logika & animasi morph). */
export function stageMapping(levelIndex: number, from: number, to: number): StageMapping {
  const key = `${levelIndex}:${from}:${to}`;
  let m = mappingCache.get(key);
  if (!m) {
    const city = CITIES[levelIndex];
    const lo = Math.min(from, to);
    const shared = [...pickupPoints(city), ...plotsOf(levelIndex).filter((p) => city.streets[p.street].unlockStage <= lo).map((p) => p.anchor)];
    m = buildStageMapping(trackFor(levelIndex, from), trackFor(levelIndex, to), shared);
    mappingCache.set(key, m);
  }
  return m;
}

export function canExpand(state: GameState): ActionResult {
  if (state.completed) return fail('Kota sudah selesai');
  const cost = expandCost(state);
  if (cost === null) return fail('Semua jalan sudah dibuka');
  if (state.money < cost) return fail('Uang belum cukup');
  return OK;
}

/**
 * Jalan baru: lintasan diganti konfigurasi tahap berikutnya dan kavling di jalan baru terbuka.
 * Progres bangunan, muatan & jumlah kendaraan TIDAK berubah; posisi kendaraan dipetakan ke
 * lintasan baru dengan urutan relatif terhadap pickup & kavling lama tetap sama.
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
// Kota berikutnya
// ---------------------------------------------------------------------------

export function nextProject(state: GameState, events: EventSink): ActionResult {
  if (!state.completed) return fail('Selesaikan kota dulu');
  let idx = state.levelIndex + 1;
  let cycle = state.cycle;
  if (idx >= CITIES.length) {
    idx = 0;
    cycle++;
  }
  setupLevel(state, idx, cycle);
  events.push({ type: 'nextProject', levelIndex: idx });
  return OK;
}

export function isLastLevel(state: GameState): boolean {
  return state.levelIndex === CITIES.length - 1;
}
