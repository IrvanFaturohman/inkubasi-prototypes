import { BALANCE } from '../config/balance';
import { completedModuleCount } from './building';
import {
  cityDef,
  cycleScale,
  isPlotComplete,
  isPlotUnlocked,
  moneyPerUnit,
  pickupDistance,
  plotDistance,
  plotProject,
  plotRent,
  plotsOf,
  productionInterval,
  storageCapacity,
  trackOf,
  vehicleCapacity,
} from './economy';
import type { EventSink } from './events';
import { computeCrossings, type KeyPoint } from './track';
import type { GameState, Runtime, Vehicle } from './types';

type Key = { kind: 'pickup'; bay: number } | { kind: 'plot'; plot: number };

/**
 * Satu langkah simulasi. Dipanggil dengan dt kecil (sub-step, maks BALANCE.maxStepDt).
 * Urutan: boost → produksi/conveyor depot → gerak kendaraan (+ crossing).
 */
export function step(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  if (dt <= 0) return;
  updateBoost(rt, dt);
  if (state.completed) return;
  state.stats.levelTime += dt;
  state.stats.totalTime += dt;
  updateDepot(state, rt, dt, events);
  if (rt.freeze > 0) {
    rt.freeze = Math.max(0, rt.freeze - dt);
    return;
  }
  moveVehicles(state, rt, dt, events);
}

// ---------------------------------------------------------------------------
// Boost (tap = dorongan singkat, hold = dipertahankan sampai energi habis)
// ---------------------------------------------------------------------------

export function boostTap(rt: Runtime): void {
  if (rt.boost.exhausted) return;
  rt.boost.tapTimer = Math.max(rt.boost.tapTimer, BALANCE.boost.tapDuration);
}

export function boostHold(rt: Runtime, holding: boolean): void {
  rt.boost.holding = holding;
  if (holding) boostTap(rt);
}

export function isBoosting(rt: Runtime): boolean {
  const b = rt.boost;
  return !b.exhausted && (b.holding || b.tapTimer > 0);
}

function updateBoost(rt: Runtime, dt: number): void {
  const b = rt.boost;
  const cfg = BALANCE.boost;
  const wants = isBoosting(rt);
  b.tapTimer = Math.max(0, b.tapTimer - dt);
  if (wants) {
    b.energy -= dt / cfg.maxHoldSeconds;
    b.usedSeconds += dt;
    b.rechargeDelay = cfg.rechargeDelay;
    if (b.energy <= 0) {
      b.energy = 0;
      b.exhausted = true;
      b.tapTimer = 0;
    }
  } else {
    b.rechargeDelay = Math.max(0, b.rechargeDelay - dt);
    if (b.rechargeDelay === 0) b.energy = Math.min(1, b.energy + dt / cfg.rechargeSeconds);
    if (b.exhausted && b.energy >= cfg.resumeAt) b.exhausted = false;
  }
  const target = wants && !b.exhausted ? cfg.mult : 1;
  const rate = target > b.mult ? cfg.accel : cfg.decel;
  b.mult += (target - b.mult) * (1 - Math.exp(-rate * dt));
  if (Math.abs(target - b.mult) < 0.001) b.mult = target;
}

// ---------------------------------------------------------------------------
// Depot: beberapa mesin + conveyor → satu penyimpanan
// ---------------------------------------------------------------------------

export function depotInTransit(state: GameState): number {
  let n = 0;
  for (let i = 0; i < state.depot.machines; i++) n += state.depot.lines[i].length;
  return n;
}

/**
 * Aturan buffer conveyor (sama untuk semua jalur mesin):
 *  - Mesin hanya melahirkan item bila stok + SEMUA item di conveyor < kapasitas penyimpanan.
 *    Ruang dipesan sejak item lahir, sehingga item yang tiba selalu muat.
 *  - Item di conveyor belum bisa diambil kendaraan; baru masuk `storage` saat progress >= 1.
 *  - Saat penuh, timer mesin ditahan di satu interval (berhenti, siap produksi lagi).
 */
function updateDepot(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  const dep = state.depot;
  const cap = storageCapacity(state);
  const interval = productionInterval(state);
  const wasFull = dep.storage + depotInTransit(state) >= cap;
  const adv = dt / BALANCE.conveyorTime;
  for (let m = 0; m < dep.machines; m++) {
    const line = dep.lines[m];
    for (let i = 0; i < line.length; i++) line[i] += adv;
    while (line.length > 0 && line[0] >= 1) {
      line.shift();
      dep.storage++;
      events.push({ type: 'stored' });
    }
  }
  let inTransit = depotInTransit(state);
  for (let m = 0; m < dep.machines; m++) {
    if (dep.storage + inTransit < cap) {
      dep.timers[m] += dt;
      while (dep.timers[m] >= interval && dep.storage + inTransit < cap) {
        dep.timers[m] -= interval;
        dep.lines[m].push(Math.min(0.99, dep.timers[m] / BALANCE.conveyorTime));
        inTransit++;
        events.push({ type: 'produced', line: m });
      }
      if (dep.storage + inTransit >= cap) dep.timers[m] = Math.min(dep.timers[m], interval);
    } else {
      dep.timers[m] = Math.min(dep.timers[m] + dt, interval);
    }
  }
  const isFull = dep.storage + inTransit >= cap;
  if (isFull !== wasFull) events.push({ type: 'stationFull', full: isFull });
  rt.storageFill += (dep.storage / cap - rt.storageFill) * (1 - Math.exp(-dt / 3));
}

// ---------------------------------------------------------------------------
// Kendaraan
// ---------------------------------------------------------------------------

export function keyPointsFor(state: GameState): KeyPoint<Key>[] {
  const keys: KeyPoint<Key>[] = [];
  for (let bay = 0; bay < 4; bay++) keys.push({ d: pickupDistance(state.levelIndex, state.expandStage, bay), data: { kind: 'pickup', bay } });
  for (let p = 0; p < state.plots.length; p++) {
    if (isPlotUnlocked(state, p)) keys.push({ d: plotDistance(state.levelIndex, state.expandStage, p), data: { kind: 'plot', plot: p } });
  }
  return keys;
}

function moveVehicles(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  const track = trackOf(state);
  const L = track.length;
  const keys = keyPointsFor(state);
  const n = state.vehicles.length;
  if (n === 0) return;

  // Penyeimbang jarak: celah depan lebih besar dari rata-rata → sedikit lebih cepat,
  // terlalu dekat → mengerem. Tanpa fisika tabrakan.
  const gaps = new Map<number, number>();
  const sorted = [...state.vehicles].sort((a, b) => a.distance - b.distance);
  for (let i = 0; i < n; i++) {
    const v = sorted[i];
    const ahead = sorted[(i + 1) % n];
    gaps.set(v.id, n === 1 ? L : (ahead.distance - v.distance + L) % L);
  }
  const ideal = L / n;
  const base = BALANCE.vehicleSpeed * rt.boost.mult * dt;

  for (const v of state.vehicles) {
    let factor = 1;
    if (n > 1) {
      const g = gaps.get(v.id)!;
      factor = 1 + Math.max(-1, Math.min(1, (g - ideal) / ideal)) * BALANCE.spacingGain;
      if (g < BALANCE.minVehicleGap) factor *= Math.max(0.25, g / BALANCE.minVehicleGap);
    }
    const move = Math.min(base * factor, L * 0.5);
    for (const c of computeCrossings(v.distance, move, L, keys)) {
      if (c.data.kind === 'pickup') pickup(state, rt, v, c.data.bay, events);
      else passPlot(state, v, c.data.plot, events);
      if (state.completed) return;
    }
    v.distance = track.wrap(v.distance + move);
  }
}

/** Pickup nyata di teluk depot: jumlahDiambil = min(stok, kapasitas − muatan). */
export function pickup(state: GameState, rt: Runtime | null, v: Vehicle, bay: number, events: EventSink): number {
  const space = vehicleCapacity(v.level) - v.cargo;
  if (space <= 0) {
    events.push({ type: 'pickupMiss', vehicleId: v.id, bay, reason: 'full' });
    return 0;
  }
  const take = Math.min(state.depot.storage, space);
  if (take <= 0) {
    events.push({ type: 'pickupMiss', vehicleId: v.id, bay, reason: 'empty' });
    if (rt) pushLoad(rt, v.cargo / vehicleCapacity(v.level));
    return 0;
  }
  state.depot.storage -= take;
  v.cargo += take;
  if (rt) pushLoad(rt, v.cargo / vehicleCapacity(v.level));
  events.push({ type: 'pickup', vehicleId: v.id, bay, amount: take, cargo: v.cargo });
  return take;
}

/**
 * Truk melintasi kavling:
 *  - bangunan belum jadi + truk bermuatan → turunkan sebanyak yang masih dibutuhkan
 *    (isi-dulu: sisa muatan lanjut ke kavling berikutnya), modul terkait langsung solid;
 *  - bangunan sudah jadi → bayar sewa (reward line), berapa pun muatannya.
 */
export function passPlot(state: GameState, v: Vehicle, plot: number, events: EventSink): void {
  if (isPlotComplete(state, plot)) {
    const amount = plotRent(state, plot);
    state.money += amount;
    state.stats.totalRent += amount;
    events.push({ type: 'rent', vehicleId: v.id, plot, amount });
    return;
  }
  if (v.cargo <= 0) return;
  const project = plotProject(state, plot);
  const have = state.plots[plot];
  const drop = Math.min(v.cargo, project.target - have);
  v.cargo -= drop;
  state.plots[plot] = have + drop;
  const money = drop * moneyPerUnit(state);
  state.money += money;
  state.stats.totalDelivered += drop;
  events.push({
    type: 'deliver',
    vehicleId: v.id,
    plot,
    amount: drop,
    money,
    fromModule: completedModuleCount(project, have),
    toModule: completedModuleCount(project, have + drop),
  });
  if (state.plots[plot] >= project.target) {
    events.push({ type: 'plotComplete', plot });
    checkStreet(state, plotsOf(state.levelIndex)[plot].street, events);
    if (state.plots.every((_, i) => isPlotComplete(state, i))) completeCity(state, events);
  }
}

function checkStreet(state: GameState, street: number, events: EventSink): void {
  if (state.streetsPaid[street]) return;
  const plots = plotsOf(state.levelIndex).filter((p) => p.street === street);
  if (!plots.every((p) => isPlotComplete(state, p.index))) return;
  state.streetsPaid[street] = true;
  const bonus = Math.round((cityDef(state).streetBonus[street] ?? 0) * cycleScale(state));
  state.money += bonus;
  events.push({ type: 'streetComplete', street, bonus });
}

function completeCity(state: GameState, events: EventSink): void {
  state.completed = true;
  const bonus = Math.round(cityDef(state).completionBonus * cycleScale(state));
  // Sisa material di kendaraan, penyimpanan & conveyor dijual (tidak dibuang diam-diam).
  let units = 0;
  for (const v of state.vehicles) {
    units += v.cargo;
    v.cargo = 0;
  }
  units += state.depot.storage + depotInTransit(state);
  state.depot.storage = 0;
  state.depot.lines = state.depot.lines.map(() => []);
  const leftover = units * moneyPerUnit(state);
  state.money += bonus + leftover;
  state.stats.lastCompletionBonus = bonus;
  state.stats.lastLeftoverMoney = leftover;
  events.push({ type: 'projectComplete', bonus, leftover });
}

function pushLoad(rt: Runtime, ratio: number): void {
  rt.recentLoads.push(ratio);
  if (rt.recentLoads.length > 12) rt.recentLoads.shift();
}
