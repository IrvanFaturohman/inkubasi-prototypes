import { AREAS, MAX_UPGRADE_LEVEL, UPGRADES, UPGRADE_KEYS, type QualityLevel, type UpgradeKey } from './config';

/** Persistent progression (saved). Transient visuals are rebuilt from this. */
export interface Progress {
  coins: number;
  totalEarned: number;
  upgrades: Record<UpgradeKey, number>;
  /** 0..2 are the authored areas; 3+ are free play variants. */
  areaIndex: number;
  areaSeed: number;
  areaRewardClaimed: boolean;
  /** Set once the final completion panel has been presented for the current run. */
  runComplete: boolean;
  stats: {
    layersCleared: number;
    areasCleared: number;
    unitsSold: number;
  };
  tutorial: {
    drive: boolean;
    pickup: boolean;
    full: boolean;
    sold: boolean;
    upgrade: boolean;
  };
}

export interface Settings {
  muted: boolean;
  sfxVolume: number;
  musicVolume: number;
  reducedMotion: boolean;
  haptics: boolean;
  quality: QualityLevel;
}

export function defaultProgress(): Progress {
  return {
    coins: 0,
    totalEarned: 0,
    upgrades: { roller: 0, cargo: 0, power: 0, speed: 0 },
    areaIndex: 0,
    areaSeed: AREAS[0].seed,
    areaRewardClaimed: false,
    runComplete: false,
    stats: { layersCleared: 0, areasCleared: 0, unitsSold: 0 },
    tutorial: { drive: false, pickup: false, full: false, sold: false, upgrade: false },
  };
}

export function defaultSettings(): Settings {
  return {
    muted: false,
    sfxVolume: 0.8,
    musicVolume: 0.45,
    reducedMotion: false,
    haptics: false,
    quality: 'auto',
  };
}

export function upgradeValue(p: Progress, key: UpgradeKey): number {
  return UPGRADES[key].values[p.upgrades[key]];
}

/** Price of the next level, or null when maxed. */
export function upgradePrice(p: Progress, key: UpgradeKey): number | null {
  const lvl = p.upgrades[key];
  if (lvl >= MAX_UPGRADE_LEVEL) return null;
  return UPGRADES[key].prices[lvl];
}

export type PurchaseResult = 'ok' | 'max' | 'funds';

/**
 * Atomic purchase: price check, deduction and level change happen together or
 * not at all. Safe against rapid repeated taps because every call re-reads state.
 */
export function purchaseUpgrade(p: Progress, key: UpgradeKey): PurchaseResult {
  const price = upgradePrice(p, key);
  if (price === null) return 'max';
  if (!Number.isFinite(p.coins) || p.coins < price) return 'funds';
  p.coins -= price;
  p.upgrades[key] += 1;
  return 'ok';
}

export function addCoins(p: Progress, amount: number): void {
  const a = Math.max(0, Math.floor(amount));
  p.coins += a;
  p.totalEarned += a;
}

export function upgradeCount(p: Progress): number {
  let s = 0;
  for (const k of UPGRADE_KEYS) s += p.upgrades[k];
  return s;
}
