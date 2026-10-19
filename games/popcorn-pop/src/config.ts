// ---------------------------------------------------------------------------
// Popcorn Pop! — balancing & formulas.
// Every number that affects the economy lives here so it can be tuned in one
// place. Times are in seconds, money in coins.
// ---------------------------------------------------------------------------

export type UpgradeKind = 'feed' | 'heat' | 'pack';
export type KioskId = 'cinema' | 'fairground';

export const UPGRADE_KINDS: UpgradeKind[] = ['feed', 'heat', 'pack'];
export const KIOSK_IDS: KioskId[] = ['cinema', 'fairground'];

export const BALANCE = {
  startMoney: 40,

  /** Pot holds at most this many raw kernels. Feeder pauses when full. */
  rawCap: 20,
  /** Tray holds at most this many popped pieces. Popping pauses when full. */
  poppedCap: 25,
  /** Popcorn pieces per cup. */
  cupSize: 5,
  /** Customer pick-up time before an empty cup is available again. */
  saleDuration: 0.8,

  /** Seconds per unit of work at level 1. */
  baseInterval: {
    feed: 0.85, // one kernel into the pot
    heat: 1.1, // one kernel popped
    pack: 1.25, // one popcorn moved into a cup (per cup lane)
  } as Record<UpgradeKind, number>,

  /** Each level multiplies the speed of its stage by this factor (+18%). */
  speedPerLevel: 1.18,

  /** Price of going from level 1 -> 2. */
  baseCost: { feed: 20, heat: 25, pack: 25 } as Record<UpgradeKind, number>,
  /** Every purchase multiplies the next price of the same upgrade. */
  costGrowth: 1.55,

  /** PACK level at which cup slot #1, #2, #3 become available. */
  cupSlotUnlockPackLevel: [1, 5, 9],

  shake: {
    popMult: 1.8, // popping speed multiplier while boosted
    duration: 2, // seconds of boost
    cooldown: 6, // seconds from tap until the next shake is allowed
  },

  /** Offline earnings are capped at this many seconds (2h). */
  offlineCapSec: 2 * 60 * 60,
  /** Gaps shorter than this are simulated normally instead of estimated. */
  catchUpSimulateMaxSec: 5,
  /** Minimum away time before the "while away" panel appears. */
  awayPanelMinSec: 20,

  saveEverySec: 5,

  fairground: {
    unlockLifetime: 600, // lifetime earnings needed before it can be bought
    openPrice: 300,
  },

  missionRewards: {
    sellCups: 60,
    heat3: 120,
    openFair: 250,
  },
  /** Endless "sell N cups" objective after the three story missions. */
  repeatMission: {
    baseCups: 25,
    cupsStep: 15,
    maxCups: 300,
    /** Reward = max(minReward, total income/s × this many seconds), fixed when the objective starts. */
    rewardIncomeSec: 20,
    minReward: 150,
  },
};

export interface KioskDef {
  id: KioskId;
  name: string;
  short: string;
  cupPrice: number;
  /** Multiplier applied to every upgrade cost in this kiosk. */
  costMult: number;
}

export const KIOSKS: Record<KioskId, KioskDef> = {
  cinema: { id: 'cinema', name: 'CINEMA POPCORN', short: 'Cinema', cupPrice: 30, costMult: 1 },
  fairground: { id: 'fairground', name: 'FAIRGROUND POPCORN', short: 'Fairground', cupPrice: 45, costMult: 1.6 },
};

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

/** Seconds per unit of work for a stage at a given level. */
export function intervalFor(kind: UpgradeKind, level: number): number {
  return BALANCE.baseInterval[kind] / Math.pow(BALANCE.speedPerLevel, level - 1);
}

/** Price to buy the next level when currently at `level`. */
export function upgradeCost(kind: UpgradeKind, level: number, kiosk: KioskId): number {
  const raw = BALANCE.baseCost[kind] * KIOSKS[kiosk].costMult * Math.pow(BALANCE.costGrowth, level - 1);
  return niceNumber(raw);
}

/** Number of cup slots (parallel packing lanes) at a PACK level. */
export function cupSlotsFor(packLevel: number): number {
  let n = 0;
  for (const lv of BALANCE.cupSlotUnlockPackLevel) if (packLevel >= lv) n++;
  return n;
}

export const MAX_CUP_SLOTS = BALANCE.cupSlotUnlockPackLevel.length;

/** Rounds to an easy-to-read price: 31, 48, 115, 1300, 27500 ... */
export function niceNumber(n: number): number {
  if (n < 100) return Math.round(n);
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  const step = mag / 2; // two significant digits, rounded to a half step
  return Math.round(n / step) * step;
}
