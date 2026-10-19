import { BALANCE } from '../config/balance';
import { completedModuleCount } from './building';
import {
  capacity,
  cargoTotal,
  cargoValue,
  cycleScale,
  isPlotComplete,
  isPlotReady,
  isPlotUnlocked,
  levelDef,
  plotDistance,
  plotProject,
  plotRent,
  plotsOf,
  sawDps,
  sawReach,
  STATION_D,
  trackOf,
  trainSpeed,
} from './economy';
import type { EventSink } from './events';
import { computeCrossings, type KeyPoint } from './track';
import type { GameState, Runtime } from './types';
import { fieldFor, forCellsInRadius, KINDS } from './worldgen';

type Key = { kind: 'station' } | { kind: 'plot'; plot: number };

/**
 * Satu langkah simulasi (sub-step kecil, maks BALANCE.maxStepDt).
 * Urutan: boost → gerak kereta (+ crossing stasiun/kavling) → gergaji menebang.
 */
export function step(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  if (dt <= 0) return;
  updateBoost(rt, dt);
  rt.cutHeat = Math.max(0, rt.cutHeat - dt * 3);
  if (state.completed) return;
  state.stats.levelTime += dt;
  state.stats.totalTime += dt;
  if (rt.freeze > 0) {
    rt.freeze = Math.max(0, rt.freeze - dt);
    return;
  }
  moveTrain(state, rt, dt, events);
  if (!state.completed) saw(state, rt, dt, events);
  regrow(state, dt);
}

/** Tunggul tumbuh kembali (kecuali di lahan kavling & jalur rel). */
export function regrow(state: GameState, dt: number): void {
  const f = fieldFor(state.levelIndex);
  for (let c = 0; c < f.n; c++) {
    if (state.blocks[c] !== 0 || f.plotOf[c] >= 0) continue;
    const def = BALANCE.blocks[KINDS[f.kind[c]]];
    if (!def.regrow) continue;
    state.growth[c] += dt / def.regrow;
    if (state.growth[c] >= 1) {
      state.growth[c] = 0;
      state.blocks[c] = def.hp;
    }
  }
}

// ---------------------------------------------------------------------------
// Boost
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
// Kereta
// ---------------------------------------------------------------------------

export function keyPointsFor(state: GameState): KeyPoint<Key>[] {
  const keys: KeyPoint<Key>[] = [{ d: STATION_D, data: { kind: 'station' } }];
  for (let p = 0; p < state.plots.length; p++) {
    if (isPlotUnlocked(state, p)) keys.push({ d: plotDistance(state.levelIndex, state.expandStage, p), data: { kind: 'plot', plot: p } });
  }
  return keys;
}

/** Jarak (di lintasan) gerbong ke-k: berbaris di belakang lokomotif. */
export function wagonDistance(state: GameState, k: number): number {
  return trackOf(state).wrap(state.train.distance - (k + 1) * BALANCE.wagonSpacing);
}

function moveTrain(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  const track = trackOf(state);
  const move = Math.min(trainSpeed(state) * rt.boost.mult * dt, track.length * 0.5);
  for (const c of computeCrossings(state.train.distance, move, track.length, keyPointsFor(state))) {
    if (c.data.kind === 'station') sell(state, events);
    else passPlot(state, c.data.plot, events);
    if (state.completed) return;
  }
  state.train.distance = track.wrap(state.train.distance + move);
}

/**
 * Gergaji: tiap gerbong merusak blok dalam radius jangkauan (lebih kuat dekat rel).
 * Blok yang HP-nya habis ditebang: hasilnya masuk muatan (dibatasi kapasitas), tumpukan
 * koin langsung jadi uang. Saat muatan penuh gergaji berhenti — tanda untuk upgrade
 * kapasitas atau segera ke stasiun.
 */
function saw(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  const f = fieldFor(state.levelIndex);
  const track = trackOf(state);
  const cap = capacity(state);
  const p = { x: 0, z: 0 };
  let full = cargoTotal(state.train.cargo) >= cap;
  if (full) {
    rt.fullTime += dt;
    return;
  }
  rt.fullTime = 0;
  state.train.wagons.forEach((lvl, k) => {
    if (full) return;
    track.pointAt(wagonDistance(state, k), p);
    const dmg = sawDps(lvl) * dt;
    const R = sawReach(lvl);
    forCellsInRadius(f.half, f.cols, p.x, p.z, R, (c) => {
      if (full || state.blocks[c] <= 0) return;
      const dist = Math.hypot(f.x[c] - p.x, f.z[c] - p.z);
      if (dist > R) return;
      rt.cutHeat = 1;
      state.blocks[c] -= dmg * (1 - (0.45 * dist) / R);
      if (state.blocks[c] > 0) return;
      const def = BALANCE.blocks[KINDS[f.kind[c]]];
      let amount = 0;
      let money = 0;
      if (def.res) {
        const room = cap - cargoTotal(state.train.cargo);
        if (room <= 0) {
          // Tidak ada ruang: blok tertahan di ambang tebang sampai muatan berkurang.
          state.blocks[c] = 0.01;
          full = true;
          return;
        }
        amount = Math.min(def.amount, room);
        state.train.cargo[def.res] += amount;
        full = cargoTotal(state.train.cargo) >= cap;
      } else if (def.money) {
        money = Math.round(def.money * cycleScale(state));
        state.money += money;
      }
      state.blocks[c] = 0;
      state.growth[c] = 0;
      state.stats.totalCut++;
      events.push({ type: 'cut', cell: c, wagon: k, res: def.res, amount, money });
      const plot = f.plotOf[c];
      if (plot >= 0 && isPlotReady(state, plot)) events.push({ type: 'plotReady', plot });
    });
  });
}

/** Bahan bangunan yang masih dibutuhkan kavling bersih yang belum jadi (di cabang terbuka). */
export function buildDemand(state: GameState): number {
  let need = 0;
  for (let p = 0; p < state.plots.length; p++) {
    if (isPlotReady(state, p) && !isPlotComplete(state, p)) need += plotProject(state, p).target - state.plots[p];
  }
  return need;
}

/**
 * Stasiun: menjual KELEBIHAN muatan. Bahan bangunan yang masih dibutuhkan kavling bersih
 * disimpan di kereta untuk dikirim; sisanya (dan semua batu/permata lain) dijual.
 */
export function sell(state: GameState, events: EventSink): number {
  const res = levelDef(state).buildResource;
  const keep = Math.min(state.train.cargo[res], buildDemand(state));
  const cargo = { ...state.train.cargo };
  cargo[res] -= keep;
  if (cargoTotal(cargo) <= 0) return 0;
  const money = cargoValue(state, cargo);
  state.money += money;
  state.stats.totalSold += money;
  state.train.cargo = { wood: 0, stone: 0, gem: 0 };
  state.train.cargo[res] = keep;
  events.push({ type: 'sell', money, cargo, kept: keep });
  return money;
}

/**
 * Kereta melintasi kavling:
 *  - lahan belum bersih → tidak terjadi apa-apa (tebang dulu!);
 *  - bangunan belum jadi → turunkan bahan bangunan sebanyak yang masih dibutuhkan
 *    (isi-dulu, sisa lanjut ke kavling berikutnya), modul terkait langsung solid;
 *  - bangunan sudah jadi → bayar sewa (reward line).
 */
export function passPlot(state: GameState, plot: number, events: EventSink): void {
  if (!isPlotReady(state, plot)) return;
  if (isPlotComplete(state, plot)) {
    const amount = plotRent(state, plot);
    state.money += amount;
    state.stats.totalRent += amount;
    events.push({ type: 'rent', plot, amount });
    return;
  }
  const res = levelDef(state).buildResource;
  const have = state.train.cargo[res];
  if (have <= 0) return;
  const project = plotProject(state, plot);
  const built = state.plots[plot];
  const drop = Math.min(have, project.target - built);
  state.train.cargo[res] -= drop;
  state.plots[plot] = built + drop;
  events.push({ type: 'deliver', plot, amount: drop, fromModule: completedModuleCount(project, built), toModule: completedModuleCount(project, built + drop) });
  if (state.plots[plot] >= project.target) {
    events.push({ type: 'plotComplete', plot });
    checkStreet(state, plotsOf(state.levelIndex)[plot].street, events);
    if (state.plots.every((_, i) => isPlotComplete(state, i))) completeLevel(state, events);
  }
}

function checkStreet(state: GameState, street: number, events: EventSink): void {
  if (state.streetsPaid[street]) return;
  if (!plotsOf(state.levelIndex).filter((p) => p.street === street).every((p) => isPlotComplete(state, p.index))) return;
  state.streetsPaid[street] = true;
  const bonus = Math.round((levelDef(state).streetBonus[street] ?? 0) * cycleScale(state));
  state.money += bonus;
  events.push({ type: 'streetComplete', street, bonus });
}

function completeLevel(state: GameState, events: EventSink): void {
  state.completed = true;
  const bonus = Math.round(levelDef(state).completionBonus * cycleScale(state));
  const leftover = cargoValue(state, state.train.cargo);
  state.train.cargo = { wood: 0, stone: 0, gem: 0 };
  state.money += bonus + leftover;
  state.stats.lastCompletionBonus = bonus;
  state.stats.lastLeftoverMoney = leftover;
  events.push({ type: 'projectComplete', bonus, leftover });
}
