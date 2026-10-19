// ---------------------------------------------------------------------------
// Game state + economy simulation. Pure logic: no DOM, no Three.js.
// The 3D scene only *visualises* the numbers produced here, via events.
// ---------------------------------------------------------------------------
import {
  BALANCE,
  KIOSKS,
  KIOSK_IDS,
  MAX_CUP_SLOTS,
  cupSlotsFor,
  intervalFor,
  upgradeCost,
  type KioskId,
  type UpgradeKind,
} from './config';

export interface CupState {
  /** Popcorn pieces currently in the cup. */
  fill: number;
  /** -1 while filling, otherwise seconds elapsed in the customer pick-up. */
  selling: number;
  /** Progress (seconds) toward the next piece for this lane. */
  packT: number;
}

export interface KioskState {
  id: KioskId;
  unlocked: boolean;
  levels: Record<UpgradeKind, number>;
  /** Raw kernels in the pot. */
  raw: number;
  /** Popped pieces waiting on the tray. */
  popped: number;
  feedT: number;
  popT: number;
  cups: CupState[];
  /** Seconds of SHAKE boost left. */
  shakeBoost: number;
  /** Seconds until SHAKE can be used again. */
  shakeCd: number;
  cupsSold: number;
  earned: number;
}

export interface MissionProgress {
  /** 0..2 = story missions, 3+ = repeating objective. */
  index: number;
  /** Total cups sold when the current repeating objective started. */
  repeatBase: number;
  /** Reward of the current repeating objective, fixed when it starts. */
  repeatReward: number;
}

export interface GameState {
  version: 1;
  money: number;
  lifetime: number;
  totalCups: number;
  active: KioskId;
  kiosks: Record<KioskId, KioskState>;
  mission: MissionProgress;
  muted: boolean;
  savedAt: number;
}

/** Hooks the renderer/audio can subscribe to. Only fired for real state changes. */
export interface SimListener {
  feed(k: KioskState): void;
  pop(k: KioskState): void;
  pack(k: KioskState, cup: number): void;
  sale(k: KioskState, cup: number, price: number): void;
  cupReady(k: KioskState, cup: number): void;
}

export function newCup(): CupState {
  return { fill: 0, selling: -1, packT: 0 };
}

export function newKiosk(id: KioskId, unlocked: boolean): KioskState {
  const cups: CupState[] = [];
  for (let i = 0; i < MAX_CUP_SLOTS; i++) cups.push(newCup());
  return {
    id,
    unlocked,
    levels: { feed: 1, heat: 1, pack: 1 },
    raw: 0,
    popped: 0,
    feedT: 0,
    popT: 0,
    cups,
    shakeBoost: 0,
    shakeCd: 0,
    cupsSold: 0,
    earned: 0,
  };
}

export function newGame(): GameState {
  return {
    version: 1,
    money: BALANCE.startMoney,
    lifetime: 0,
    totalCups: 0,
    active: 'cinema',
    kiosks: {
      cinema: newKiosk('cinema', true),
      fairground: newKiosk('fairground', false),
    },
    mission: { index: 0, repeatBase: 0, repeatReward: 0 },
    muted: false,
    savedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/** Fixed simulation step. Production never depends on render frame rate. */
export const SIM_STEP = 1 / 60;

export function earn(g: GameState, amount: number): void {
  g.money += amount;
  g.lifetime += amount;
}

/**
 * Advances one kiosk by `dt` seconds. Each stage only progresses while it can
 * actually do work, so nothing is ever thrown away when a buffer is full.
 */
export function stepKiosk(g: GameState, k: KioskState, dt: number, L?: SimListener): void {
  const B = BALANCE;
  if (k.shakeBoost > 0) k.shakeBoost = Math.max(0, k.shakeBoost - dt);
  if (k.shakeCd > 0) k.shakeCd = Math.max(0, k.shakeCd - dt);

  // FEED: hopper -> pot. Pauses while the pot is full.
  const feedInt = intervalFor('feed', k.levels.feed);
  if (k.raw < B.rawCap) {
    k.feedT += dt;
    while (k.feedT >= feedInt && k.raw < B.rawCap) {
      k.feedT -= feedInt;
      k.raw++;
      L?.feed(k);
    }
    if (k.raw >= B.rawCap) k.feedT = Math.min(k.feedT, feedInt);
  }

  // HEAT: pot -> tray. Needs a kernel and free space on the tray.
  const popInt = intervalFor('heat', k.levels.heat) / (k.shakeBoost > 0 ? B.shake.popMult : 1);
  if (k.raw > 0 && k.popped < B.poppedCap) {
    k.popT += dt;
    while (k.popT >= popInt && k.raw > 0 && k.popped < B.poppedCap) {
      k.popT -= popInt;
      k.raw--;
      k.popped++;
      L?.pop(k);
    }
    if (k.raw === 0 || k.popped >= B.poppedCap) k.popT = Math.min(k.popT, popInt);
  }

  // PACK: tray -> cups. One lane per unlocked cup; a lane waits while its
  // cup is being picked up by a customer.
  const slots = cupSlotsFor(k.levels.pack);
  const packInt = intervalFor('pack', k.levels.pack);
  const price = KIOSKS[k.id].cupPrice;
  for (let i = 0; i < slots; i++) {
    const c = k.cups[i];
    if (c.selling >= 0) {
      c.selling += dt;
      if (c.selling >= B.saleDuration) {
        c.selling = -1;
        c.fill = 0;
        c.packT = 0;
        L?.cupReady(k, i);
      }
      continue;
    }
    if (k.popped <= 0) continue;
    c.packT += dt;
    while (c.packT >= packInt && k.popped > 0 && c.selling < 0) {
      c.packT -= packInt;
      k.popped--;
      c.fill++;
      L?.pack(k, i);
      if (c.fill >= B.cupSize) {
        // Full cup is bought immediately: money is credited right away.
        c.selling = 0;
        c.packT = 0;
        earn(g, price);
        k.earned += price;
        k.cupsSold++;
        g.totalCups++;
        L?.sale(k, i, price);
      }
    }
    if (k.popped <= 0) c.packT = Math.min(c.packT, packInt);
  }
}

/** Advances every unlocked kiosk. Only the listener of the visible kiosk gets events. */
export function stepGame(g: GameState, dt: number, visible?: SimListener): void {
  for (const id of KIOSK_IDS) {
    const k = g.kiosks[id];
    if (!k.unlocked) continue;
    stepKiosk(g, k, dt, id === g.active ? visible : undefined);
  }
}

// ---------------------------------------------------------------------------
// Rates, income estimate, bottleneck
// ---------------------------------------------------------------------------

export interface KioskRates {
  feed: number; // kernels / s
  pop: number; // pops / s
  pack: number; // pieces / s across all lanes, including pick-up pauses
  lanes: number;
  throughput: number; // pieces / s at steady state
  income: number; // coins / s at steady state
  bottleneck: UpgradeKind;
}

export function kioskRates(k: KioskState): KioskRates {
  const B = BALANCE;
  const feed = 1 / intervalFor('feed', k.levels.feed);
  const pop = 1 / intervalFor('heat', k.levels.heat);
  const lanes = cupSlotsFor(k.levels.pack);
  const packInt = intervalFor('pack', k.levels.pack);
  const pack = (lanes * B.cupSize) / (B.cupSize * packInt + B.saleDuration);
  const throughput = Math.min(feed, pop, pack);
  const income = (throughput / B.cupSize) * KIOSKS[k.id].cupPrice;
  const bottleneck: UpgradeKind = throughput === pack ? 'pack' : throughput === pop ? 'heat' : 'feed';
  return { feed, pop, pack, lanes, throughput, income, bottleneck };
}

export function totalIncome(g: GameState): number {
  let sum = 0;
  for (const id of KIOSK_IDS) if (g.kiosks[id].unlocked) sum += kioskRates(g.kiosks[id]).income;
  return sum;
}

/**
 * Credits what every open kiosk would have earned over `seconds` of absence
 * (capped), based on each kiosk's steady-state production capacity.
 * Stock levels are left untouched — no per-popcorn simulation.
 */
export function applyAway(g: GameState, seconds: number): number {
  const s = Math.max(0, Math.min(seconds, BALANCE.offlineCapSec));
  let total = 0;
  for (const id of KIOSK_IDS) {
    const k = g.kiosks[id];
    if (!k.unlocked) continue;
    const r = kioskRates(k);
    const gain = Math.floor(r.income * s);
    k.earned += gain;
    total += gain;
  }
  earn(g, total);
  // shake timers simply run out while away
  for (const id of KIOSK_IDS) {
    g.kiosks[id].shakeBoost = Math.max(0, g.kiosks[id].shakeBoost - s);
    g.kiosks[id].shakeCd = Math.max(0, g.kiosks[id].shakeCd - s);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export function costOf(g: GameState, kiosk: KioskId, kind: UpgradeKind): number {
  return upgradeCost(kind, g.kiosks[kiosk].levels[kind], kiosk);
}

export function tryUpgrade(g: GameState, kiosk: KioskId, kind: UpgradeKind): boolean {
  const cost = costOf(g, kiosk, kind);
  if (g.money < cost) return false;
  const k = g.kiosks[kiosk];
  g.money -= cost;
  const before = cupSlotsFor(k.levels.pack);
  k.levels[kind]++;
  if (kind === 'pack') {
    const after = cupSlotsFor(k.levels.pack);
    for (let i = before; i < after; i++) k.cups[i] = newCup();
  }
  return true;
}

export function tryShake(k: KioskState): boolean {
  if (k.shakeCd > 0) return false;
  k.shakeBoost = BALANCE.shake.duration;
  k.shakeCd = BALANCE.shake.cooldown;
  return true;
}

export function fairgroundAvailable(g: GameState): boolean {
  return !g.kiosks.fairground.unlocked && g.lifetime >= BALANCE.fairground.unlockLifetime;
}

export function tryOpenFairground(g: GameState): boolean {
  if (!fairgroundAvailable(g) || g.money < BALANCE.fairground.openPrice) return false;
  g.money -= BALANCE.fairground.openPrice;
  g.kiosks.fairground = newKiosk('fairground', true);
  return true;
}
