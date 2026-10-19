import { BALANCE } from '../config/balance';
import { completedModuleCount, completedStageCount } from './building';
import {
  cycleScale,
  isSlotUnlocked,
  moneyPerUnit,
  pickupDistance,
  productionInterval,
  projectOf,
  storageCapacity,
  trackOf,
  vehicleCapacity,
} from './economy';
import type { EventSink } from './events';
import { computeCrossings, type KeyPoint } from './track';
import type { GameState, Runtime, Vehicle } from './types';

type Key = { kind: 'unload' } | { kind: 'pickup'; slot: number };

/**
 * Satu langkah simulasi. Dipanggil dengan dt kecil (sub-step, maks BALANCE.maxStepDt).
 * Urutan: boost → produksi/conveyor → gerak kendaraan (+ crossing).
 */
export function step(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  if (dt <= 0) return;
  updateBoost(rt, dt);
  if (state.completed) return;
  state.stats.levelTime += dt;
  state.stats.totalTime += dt;
  updateStations(state, rt, dt, events);
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
// Produksi & conveyor
// ---------------------------------------------------------------------------

/**
 * Aturan buffer conveyor:
 *  - Mesin hanya melahirkan item bila storage + item di conveyor < kapasitas penyimpanan.
 *    Artinya ruang penyimpanan "dipesan" sejak item lahir, sehingga item yang tiba di ujung
 *    conveyor SELALU muat dan tidak pernah hilang/menumpuk di luar batas.
 *  - Item di conveyor belum bisa diambil kendaraan; baru masuk `storage` saat progress >= 1.
 *  - Saat penuh, timer mesin ditahan di satu interval (mesin berhenti, siap produksi lagi
 *    begitu kendaraan mengambil stok).
 */
function updateStations(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  let fillSum = 0;
  let fillCount = 0;
  for (const st of state.stations) {
    if (!st.built || !isSlotUnlocked(state, st.slot)) continue;
    const cap = storageCapacity(st);
    const interval = productionInterval(state, st);
    const wasFull = st.storage + st.conveyor.length >= cap;

    const adv = dt / BALANCE.conveyorTime;
    for (let i = 0; i < st.conveyor.length; i++) st.conveyor[i] += adv;
    while (st.conveyor.length > 0 && st.conveyor[0] >= 1) {
      st.conveyor.shift();
      st.storage++;
      events.push({ type: 'stored', slot: st.slot });
    }

    if (st.storage + st.conveyor.length < cap) {
      st.timer += dt;
      while (st.timer >= interval && st.storage + st.conveyor.length < cap) {
        st.timer -= interval;
        st.conveyor.push(Math.min(0.99, st.timer / BALANCE.conveyorTime));
        events.push({ type: 'produced', slot: st.slot });
      }
      if (st.storage + st.conveyor.length >= cap) st.timer = Math.min(st.timer, interval);
    } else {
      st.timer = Math.min(st.timer + dt, interval);
    }

    const isFull = st.storage + st.conveyor.length >= cap;
    if (isFull !== wasFull) events.push({ type: 'stationFull', slot: st.slot, full: isFull });
    fillSum += st.storage / cap;
    fillCount++;
  }
  if (fillCount > 0) {
    const avg = fillSum / fillCount;
    rt.storageFill += (avg - rt.storageFill) * (1 - Math.exp(-dt / 3));
  }
}

// ---------------------------------------------------------------------------
// Kendaraan
// ---------------------------------------------------------------------------

export function keyPointsFor(state: GameState): KeyPoint<Key>[] {
  const keys: KeyPoint<Key>[] = [{ d: 0, data: { kind: 'unload' } }];
  for (const st of state.stations) {
    if (st.built && isSlotUnlocked(state, st.slot)) {
      keys.push({ d: pickupDistance(state.levelIndex, state.expandStage, st.slot), data: { kind: 'pickup', slot: st.slot } });
    }
  }
  return keys;
}

function moveVehicles(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  const track = trackOf(state);
  const L = track.length;
  const keys = keyPointsFor(state);
  const n = state.vehicles.length;
  if (n === 0) return;

  // Penyeimbang jarak: kendaraan dengan celah depan lebih besar dari rata-rata sedikit
  // lebih cepat, yang terlalu dekat mengerem — tanpa fisika tabrakan.
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
    const crossings = computeCrossings(v.distance, move, L, keys);
    for (const c of crossings) {
      if (c.data.kind === 'unload') unload(state, rt, v, events);
      else pickup(state, v, c.data.slot, events);
      if (state.completed) return;
    }
    v.distance = track.wrap(v.distance + move);
  }
}

/** Pickup nyata: jumlahDiambil = min(stokPenyimpanan, kapasitas − muatan). */
export function pickup(state: GameState, v: Vehicle, slot: number, events: EventSink): number {
  const st = state.stations[slot];
  if (!st || !st.built) return 0;
  const space = vehicleCapacity(v.level) - v.cargo;
  if (space <= 0) {
    events.push({ type: 'pickupMiss', vehicleId: v.id, slot, reason: 'full' });
    return 0;
  }
  const take = Math.min(st.storage, space);
  if (take <= 0) {
    events.push({ type: 'pickupMiss', vehicleId: v.id, slot, reason: 'empty' });
    return 0;
  }
  st.storage -= take;
  v.cargo += take;
  events.push({ type: 'pickup', vehicleId: v.id, slot, amount: take, cargo: v.cargo });
  return take;
}

/**
 * Bongkar: SELURUH muatan langsung masuk progres bangunan dalam satu langkah logika
 * (tanpa timer pemasangan). Material melewati target tetap dibayar sebagai uang
 * (aturan eksplisit "kelebihan dijual"), tidak dibuang diam-diam.
 */
export function unload(state: GameState, rt: Runtime | null, v: Vehicle, events: EventSink): void {
  const amount = v.cargo;
  if (amount <= 0) {
    events.push({ type: 'unloadEmpty', vehicleId: v.id });
    if (rt) pushLoad(rt, 0);
    return;
  }
  const project = projectOf(state);
  const before = state.delivered;
  const used = Math.min(amount, project.target - before);
  state.delivered = before + used;
  v.cargo = 0;
  const money = amount * moneyPerUnit(state);
  state.money += money;
  state.stats.totalDelivered += used;
  if (rt) pushLoad(rt, amount / vehicleCapacity(v.level));
  events.push({
    type: 'unload',
    vehicleId: v.id,
    amount,
    used,
    money,
    fromModule: completedModuleCount(project, before),
    toModule: completedModuleCount(project, state.delivered),
  });

  const stagesDone = completedStageCount(project, state.delivered);
  const lastStage = project.stageNames.length - 1;
  while (state.stagesPaid < stagesDone) {
    const s = state.stagesPaid;
    if (s < lastStage) {
      const bonus = Math.round((project.stageBonus[s] ?? 0) * cycleScale(state));
      state.money += bonus;
      events.push({ type: 'stageComplete', stage: s, bonus });
    }
    state.stagesPaid++;
  }
  if (state.delivered >= project.target) completeProject(state, events);
}

function completeProject(state: GameState, events: EventSink): void {
  const project = projectOf(state);
  state.completed = true;
  const bonus = Math.round(project.completionBonus * cycleScale(state));
  // Sisa material di kendaraan, penyimpanan & conveyor dijual (tidak dibuang diam-diam).
  let units = 0;
  for (const v of state.vehicles) {
    units += v.cargo;
    v.cargo = 0;
  }
  for (const st of state.stations) {
    units += st.storage + st.conveyor.length;
    st.storage = 0;
    st.conveyor = [];
  }
  const leftover = units * moneyPerUnit(state);
  state.money += bonus + leftover;
  state.stats.lastCompletionBonus = bonus;
  state.stats.lastLeftoverMoney = leftover;
  events.push({ type: 'projectComplete', bonus, leftover });
}

function pushLoad(rt: Runtime, ratio: number): void {
  rt.recentLoads.push(ratio);
  if (rt.recentLoads.length > 8) rt.recentLoads.shift();
}
