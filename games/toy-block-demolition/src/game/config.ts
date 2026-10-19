// Central tuning for Toy Block Demolition.
// Gameplay values live here so pacing can be adjusted without touching systems.
// See TUNING.md for the reasoning behind the main numbers.

export const PALETTE = {
  coral: '#F45B57',
  blue: '#3C8DFA',
  yellow: '#FFD34D',
  green: '#55C992',
  violet: '#9975E8',
  floor: '#D9EBDC',
  ground: '#C5DACA',
  orange: '#F68B35',
  highlight: '#FFC94D',
  dark: '#34404A',
  uiText: '#243744',
  uiPanel: '#FFF9ED',
} as const;

/** Block color indices. Color never changes HP or value. */
export const BLOCK_COLORS = [PALETTE.coral, PALETTE.blue, PALETTE.yellow, PALETTE.green, PALETTE.violet] as const;
export const C_CORAL = 0;
export const C_BLUE = 1;
export const C_YELLOW = 2;
export const C_GREEN = 3;
export const C_VIOLET = 4;

/** Layer materials. 0 = empty. */
export const MAT_NONE = 0;
export const MAT_NORMAL = 1;
export const MAT_REINFORCED = 2;
export const MAT_BONUS = 3;
export type MaterialId = 1 | 2 | 3;

export const MATERIALS: Record<MaterialId, { name: string; hp: number; coins: number }> = {
  1: { name: 'Normal', hp: 1.0, coins: 4 },
  2: { name: 'Reinforced', hp: 2.8, coins: 6 },
  3: { name: 'Bonus', hp: 1.0, coins: 8 },
};

export const SIM = {
  step: 1 / 60,
  /** Cap catch-up so a long frame never teleports the truck through blocks. */
  maxStepsPerFrame: 5,
};

export const GRID = {
  pitch: 0.7,
  layerHeight: 0.46,
  blockSize: 0.62,
  blockHeight: 0.43,
  bevel: 0.09,
  /** Half extent of an intact cell used for chassis collision. */
  collisionHalf: 0.33,
};

export const VEHICLE = {
  /** Seconds to reach the target speed from rest. */
  accelTime: 0.14,
  /** Seconds to brake to rest after release. */
  brakeTime: 0.12,
  /** Max yaw rate (rad/s) and exponential approach sharpness. */
  turnRate: 10.5,
  turnSharpness: 15,
  reverseFactor: 0.6,
  /** Chassis + cargo collision circles along local Z (forward = +Z). */
  bodyCircles: [
    { z: 0.42, r: 0.55 },
    { z: -0.22, r: 0.57 },
    { z: -0.8, r: 0.57 },
  ],
  rollerZ: 1.12,
  rollerRadius: 0.35,
  /** Yaw pivot (local Z) near the rear axles. */
  pivotZ: -0.55,
  rollerColliderRadius: 0.22,
  /** Roller collider stops this far inside the drum ends. */
  rollerEndInset: 0.06,
  wheelRadius: 0.25,
  /** Residual penetration that makes a step revert instead of forcing through. */
  maxPenetration: 0.035,
  collisionIterations: 4,
};

export const CRUSHER = {
  /** HP per second applied to each contacted layer before the power multiplier. */
  baseDamage: 6.0,
  /** Region extends this far behind the roller axis (cell centres, local space). */
  regionBack: 0.3,
  /** Extra reach beyond the collider contact so normal blocks break as the drum meets them. */
  regionLead: 0.2,
  sideMargin: 0.02,
  /** Throttle needed for the drum to be powered. */
  minThrottle: 0.08,
};

export const CARGO = {
  flightMin: 0.28,
  flightMax: 0.42,
  nearFullRatio: 0.85,
};

export const DEPOT = {
  spawn: { x: 0, z: 1.55, heading: Math.PI },
  pad: { x: 0, z: 3.9, hw: 1.25, hd: 1.2 },
  machine: { x: 2.6, z: 3.85, hw: 0.85, hd: 0.78 },
  shed: { x: -3.1, z: 3.5, hw: 0.72, hd: 0.5 },
  gate: { x: -4.6, hw: 1.25 },
  /** Distance from the pad centre that shows the UPGRADE button. */
  upgradeRadius: 4.4,
  yardDepth: 6.1,
  dwell: 0.25,
  dwellMaxSpeed: 0.75,
  unloadBase: 0.85,
  unloadPerUnit: 0.0045,
  unloadMin: 1.2,
  unloadMax: 2.0,
};

export type UpgradeKey = 'roller' | 'cargo' | 'power' | 'speed';
export const UPGRADE_KEYS: UpgradeKey[] = ['roller', 'cargo', 'power', 'speed'];

export interface UpgradeDef {
  key: UpgradeKey;
  label: string;
  effect: string;
  unit: string;
  values: number[];
  prices: number[];
}

export const UPGRADES: Record<UpgradeKey, UpgradeDef> = {
  roller: {
    key: 'roller',
    label: 'ROLLER',
    effect: 'Wider cut',
    unit: 'm',
    values: [1.45, 1.95, 2.5, 3.1, 3.75],
    prices: [180, 420, 900, 1700],
  },
  cargo: {
    key: 'cargo',
    label: 'CARGO',
    effect: 'Bigger bin',
    unit: '',
    values: [96, 144, 208, 288, 384],
    prices: [240, 540, 1000, 1800],
  },
  power: {
    key: 'power',
    label: 'POWER',
    effect: 'Faster crushing',
    unit: 'x',
    values: [1.0, 1.4, 1.9, 2.5, 3.3],
    prices: [200, 460, 950, 1850],
  },
  speed: {
    key: 'speed',
    label: 'SPEED',
    effect: 'Quicker driving',
    unit: '',
    values: [1.65, 1.8, 2.0, 2.2, 2.45],
    prices: [160, 360, 760, 1450],
  },
};
export const MAX_UPGRADE_LEVEL = 4;

export type PatternId = 'stripes' | 'terraces' | 'carnival';

export interface AreaDef {
  name: string;
  cols: number;
  rows: number;
  doubleRatio: number;
  reinforcedRatio: number;
  bonusRatio: number;
  pattern: PatternId;
  completionBonus: number;
  seed: number;
}

export const AREAS: AreaDef[] = [
  { name: 'Color Yard', cols: 24, rows: 18, doubleRatio: 0, reinforcedRatio: 0, bonusRatio: 0, pattern: 'stripes', completionBonus: 250, seed: 1101 },
  { name: 'Layer Works', cols: 28, rows: 22, doubleRatio: 0.35, reinforcedRatio: 0.12, bonusRatio: 0.02, pattern: 'terraces', completionBonus: 500, seed: 2202 },
  { name: 'Block Carnival', cols: 30, rows: 24, doubleRatio: 0.55, reinforcedRatio: 0.2, bonusRatio: 0.04, pattern: 'carnival', completionBonus: 850, seed: 3303 },
];

/** Free play variants reuse the Block Carnival density with a fresh seed and pattern. */
export function freePlayDef(round: number, seed: number): AreaDef {
  const patterns: PatternId[] = ['carnival', 'terraces', 'stripes'];
  return {
    name: `Free Play ${round}`,
    cols: 30,
    rows: 24,
    doubleRatio: 0.5,
    reinforcedRatio: 0.18,
    bonusRatio: 0.04,
    pattern: patterns[(round - 1) % patterns.length],
    completionBonus: 600,
    seed,
  };
}

export const CAMERA = {
  pitchDeg: 55,
  /** Visible world width at the start scale (truck ≈ 16–18% of it). */
  viewWidth: 8.6,
  /** Where the truck sits vertically (0 = top, 1 = bottom of the canvas). */
  vehicleScreenY: 0.6,
  lookAhead: 0.45,
  maxLookAhead: 1.3,
  followSharpness: 6.5,
  maxLag: 2.2,
  distance: 40,
};

export const REMAINING_MARKER_THRESHOLD = 12;

export type QualityLevel = 'auto' | 'low' | 'high';
export interface QualityProfile {
  dpr: number;
  shadows: boolean;
  shadowMap: number;
  shards: number;
  flights: number;
  sparkles: number;
  confetti: number;
}
export const QUALITY: Record<'low' | 'medium' | 'high', QualityProfile> = {
  low: { dpr: 1, shadows: false, shadowMap: 1024, shards: 60, flights: 20, sparkles: 30, confetti: 36 },
  medium: { dpr: 1.5, shadows: true, shadowMap: 2048, shards: 140, flights: 40, sparkles: 50, confetti: 80 },
  high: { dpr: 2, shadows: true, shadowMap: 2048, shards: 200, flights: 48, sparkles: 60, confetti: 110 },
};
