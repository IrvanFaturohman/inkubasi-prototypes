// Tuning, upgrade table and economy formulas. Pure data, no DOM, no Rapier.

export const DT = 1 / 60;
export const GRAVITY = -30;
export const LAUNCH_ANGLE_DEG = 50; // lofty: apex/range = tan(50)/4 = 0.30
export const LAUNCH_TAIL = { x: 0.4, y: 1.7 }; // nock position on the launcher
export const MAX_RUN_STEPS = 60 * 14; // hard cap, 14 s of sim time
export const COURSE_LENGTH = 1800;
export const COURSE_SEED = 7092026;

// Out-of-bounds guard: anything outside this box (or faster than maxSpeed, or
// non-finite) is removed before the next broad phase pass.
export const BOUNDS = { minX: -80, maxX: COURSE_LENGTH + 400, minY: -600, maxY: 1200, maxSpeed: 320 };

// Arrow geometry
export const SEG_LEN = 0.95;
export const SHAFT_RADIUS = 0.14;
export const HEAD_RADIUS = 0.2;
export const SHAFT_DENSITY = 19; // ~1.0 kg per segment
export const HEAD_DENSITY = 20; // ~2.0 kg head
export const ARROW_FRICTION = 0.15; // Min-combined: the shaft skids, it does not grip

// Hand-written angular spring between segments (the joint itself is spherical).
export const BEND_K = 1500; // N m / rad, solved implicitly
export const BEND_C = 12;
export const BEND_LIMIT = 0.35; // rad, ~20 deg
export const BEND_LIMIT_K = 5000;
export const BEND_HARD = 0.5; // rad, positional clamp after the step
export const FLETCH_ALIGN = 2; // rad/s per rad of misalignment, airborne only

export const CRATE_SIZE = 1.0;
export const CRATE_DENSITY = 0.7;
export const BARREL_RADIUS = 0.42;
export const BARREL_HALF_H = 0.55;
export const BARREL_DENSITY = 1.5;
export const SMASH_SPEED = 2.5;
export const SHATTER_CRATE = 42; // arrow momentum (kg m/s) that bursts a crate
export const SHATTER_BARREL = 80;
export const SHATTER_SHARE = 0.8;
export const RAMP_H = 1.6;
export const PAD_H = 0.4;
export const AIR_DRAG = 0.006; // N per (m/s)^2 on the whole shaft
export const COMBO_WINDOW_STEPS = 30;

export type UpgradeId = 'power' | 'bounce' | 'length';
export interface Levels {
  power: number;
  bounce: number;
  length: number;
}
export const UPGRADE_IDS: UpgradeId[] = ['power', 'bounce', 'length'];

export interface UpgradeDef {
  name: string;
  max: number;
  baseCost: number;
  growth: number;
  stat: (lvl: number) => string;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  power: { name: 'POWER', max: 10, baseCost: 60, growth: 1.45, stat: (l) => `${drawWeight(l)} lb draw` },
  bounce: { name: 'BOUNCE', max: 10, baseCost: 70, growth: 1.5, stat: (l) => `${Math.round(arrowRestitution(l) * 100)}% rebound` },
  length: { name: 'LENGTH', max: 8, baseCost: 90, growth: 1.6, stat: (l) => `${segmentCount(l)} segments` },
};

export function drawWeight(powerLvl: number): number {
  return 30 + 6 * (powerLvl - 1);
}

/** Launch speed in m/s. meter is the clicker gauge position 0..1. */
export function launchSpeed(powerLvl: number, meter: number, perfect: boolean): number {
  const top = 42 + 8 * (powerLvl - 1);
  const m = Math.min(1, Math.max(0, meter));
  return top * (0.5 + 0.5 * m) * (perfect ? 1.06 : 1);
}

export function arrowRestitution(bounceLvl: number): number {
  return 0.15 + 0.07 * (bounceLvl - 1);
}

export function padBoost(bounceLvl: number): { vy: number; vxMul: number } {
  return { vy: 16 + 2.5 * (bounceLvl - 1), vxMul: 1.1 + 0.02 * (bounceLvl - 1) };
}

/** LENGTH Lv.1 = 3 segments ... Lv.8 = 10 segments. Each one is a real body + collider. */
export function segmentCount(lengthLvl: number): number {
  return Math.max(1, Math.min(8, lengthLvl)) + 2;
}

/** Sublinear on purpose: destruction is the second income source. */
export function coinsForDistance(d: number): number {
  return Math.floor(3 * Math.pow(Math.max(0, d), 0.72));
}

export function coinsForSmash(combo: number): number {
  return 2 + Math.min(Math.max(combo, 1) - 1, 6);
}

export function upgradeCost(id: UpgradeId, lvl: number): number {
  const u = UPGRADES[id];
  return Math.round((u.baseCost * Math.pow(u.growth, lvl - 1)) / 5) * 5;
}

// Clicker gauge (timing meter)
export const METER_PERIOD = 1.25; // seconds for 0 -> 1 -> 0
export const METER_GOOD = 0.8;
export const METER_PERFECT = 0.93;

export function meterAt(t: number): number {
  const p = (t / METER_PERIOD) % 1;
  return p < 0.5 ? p * 2 : 2 - p * 2; // triangle wave, no lingering at the ends
}
