/**
 * Harvest Circuit — balancing & tuning.
 *
 * Every price, rate and formula the simulation uses lives here so the economy can be
 * tuned without touching gameplay code. `npm run balance` runs a scripted player
 * against these numbers and prints a pacing timeline.
 */
import type { FieldId, Tier } from './types';

export const SAVE_KEY = 'harvest-circuit/save';
export const SAVE_VERSION = 1;

/** Fixed logic step (seconds). Income never depends on frame rate. */
export const SIM_DT = 1 / 30;
/** Largest wall-clock delta a single frame may feed into the simulation. */
export const MAX_FRAME_DT = 0.25;
export const AUTOSAVE_SEC = 5;

export const OFFLINE = {
  /** Offline / hidden-tab catch-up is capped at 2 hours. */
  maxSec: 2 * 60 * 60,
  /** Coarser step for catch-up; the same rules run, just with bigger dt. */
  stepSec: 0.25,
  /** Gaps shorter than this are ignored (no catch-up at all). */
  minSec: 3,
  /** Show the "welcome back" panel only when the gap is at least this long. */
  summaryMinSec: 20,
};

/** Real-income ledger window used for the $/min readout. */
export const INCOME_WINDOW_SEC = 60;

export const DRIVE = {
  /** A single tap keeps the harvesters moving for this long. */
  tapBoostSec: 0.5,
  /** Tap/hold speed relative to base (Auto Drive) speed. Cap — never stacks. */
  boostMult: 1.75,
  /** Drive factor change per second (smooth start/stop, deterministic). */
  accel: 6,
  decel: 4,
  /** Minimum distance along the loop between two harvesters. */
  minGap: 2.2,
  /** Harvesters that bunch up (gap < spacingFrac * ideal) ease off so spacing evens out. */
  spacingFrac: 0.7,
  spacingSlow: 0.88,
};

/** Field geometry (world units). Corridors are horizontal lanes stacked in depth. */
export const GEOMETRY = {
  corridorPitch: 4.45,
  /** Distance of strip 1 / 2 / 3 crop rows from the lane centre (both sides). */
  stripOffsets: [0.74, 1.3, 1.86],
  laneHalf: 3.3,
  turnRadius: 0.8,
  returnRadius: 1.8,
  roadWidth: 0.8,
  bedDepth: 0.44,
  /** How far ahead of the machine centre the cutting header sits (× tier scale). */
  headerAhead: 0.82,
};

export interface TierDef {
  tier: Tier;
  /** Deepest strip the cutting header reaches (1..3). */
  reach: number;
  /** Crate capacity multiplier vs the Tier 1 crate. */
  capMult: number;
  /** Visual body scale. */
  scale: number;
  /** Header width in world units — matches the rows it can reach. */
  headerWidth: number;
  body: string;
  trim: string;
}

export const TIERS: TierDef[] = [
  { tier: 1, reach: 1, capMult: 1, scale: 1, headerWidth: 1.95, body: '#f08a3a', trim: '#fff1d6' },
  { tier: 2, reach: 2, capMult: 2.25, scale: 1.16, headerWidth: 3.1, body: '#e2553b', trim: '#ffe7b8' },
  { tier: 3, reach: 3, capMult: 5, scale: 1.32, headerWidth: 4.2, body: '#b8364a', trim: '#ffd88a' },
];
export const MAX_TIER = 3;

export const STORAGE = { base: 8, perLevel: 4 };

/** Growth thresholds for the visual/logic stages: empty → sprout → young → mature(1). */
export const STAGES = { sprout: 0.12, young: 0.5 };

export const UPGRADE_EFFECT = {
  /** Irrigation: grow time multiplied by this per level (≈15% faster). */
  waterMult: 0.85,
  /** Speed: base & boosted speed multiplied by this per level (+12%). */
  speedMult: 1.12,
};

export interface Curve {
  base: number;
  mult: number;
  max: number;
}

export const curveCost = (c: Curve, level: number): number =>
  Math.round(c.base * Math.pow(c.mult, level));

export type MissionKind = 'add' | 'merge' | 'auto' | 'expand' | 'unlockCorn' | 'tier3' | 'deepRows';

export interface MissionDef {
  kind: MissionKind;
  text: string;
  reward: number;
}

export interface FieldPalette {
  ground: string;
  road: string;
  roadEdge: string;
  soil: string;
  soilWet: string;
  fallow: string;
  plot: string;
  fence: string;
  foliage: string[];
  accent: string;
}

export interface FieldConfig {
  id: FieldId;
  name: string;
  crop: 'wheat' | 'corn';
  cropName: string;
  unitValue: number;
  growTime: number;
  minGrowTime: number;
  /** Base (Auto Drive) speed in world units / second. */
  baseSpeed: number;
  patchesPerRow: number;
  patchSpacing: number;
  /** Corridor count per Expand level (must stay even so the loop closes on the silo side). */
  corridorsByExpand: number[];
  /** Expand level at which strip 3 (deep rows) opens. */
  deepRowsAtExpand: number;
  harvesterLimit: number;
  harvesterLimitPerExpand: number;
  /** Loads that must be sold on this field before Auto Drive can be bought. */
  autoAfterSales: number;
  costs: {
    add: Curve;
    /** Merge price by source tier (T1→T2, T2→T3). */
    merge: number[];
    auto: number;
    water: Curve;
    speed: Curve;
    storage: Curve;
    expand: number[];
  };
  unlock: null | { lifetime: number; cost: number; needsAutoOn: FieldId };
  missions: MissionDef[];
  palette: FieldPalette;
}

export const FIELDS: Record<FieldId, FieldConfig> = {
  wheat: {
    id: 'wheat',
    name: 'Wheat Field',
    crop: 'wheat',
    cropName: 'wheat',
    unitValue: 4,
    growTime: 25,
    minGrowTime: 8,
    baseSpeed: 1.42,
    patchesPerRow: 6,
    patchSpacing: 1.0,
    corridorsByExpand: [2, 4, 4],
    deepRowsAtExpand: 2,
    harvesterLimit: 4,
    harvesterLimitPerExpand: 1,
    autoAfterSales: 3,
    costs: {
      add: { base: 50, mult: 1.6, max: 99 },
      merge: [30, 250],
      auto: 80,
      water: { base: 45, mult: 1.55, max: 8 },
      speed: { base: 55, mult: 1.6, max: 8 },
      storage: { base: 60, mult: 1.5, max: 10 },
      expand: [600, 4200],
    },
    unlock: null,
    missions: [
      { kind: 'add', text: 'Buy another harvester', reward: 15 },
      { kind: 'merge', text: 'Merge two harvesters', reward: 25 },
      { kind: 'auto', text: 'Unlock Auto Drive', reward: 30 },
      { kind: 'expand', text: 'Expand the field', reward: 120 },
      { kind: 'unlockCorn', text: 'Open Corn Field', reward: 250 },
      { kind: 'tier3', text: 'Build a Tier 3 harvester', reward: 400 },
      { kind: 'deepRows', text: 'Open the deep rows', reward: 800 },
    ],
    palette: {
      ground: '#f3e5c6',
      road: '#e2bf82',
      roadEdge: '#d2a96a',
      soil: '#c99462',
      soilWet: '#a9744a',
      fallow: '#e6d3ad',
      plot: '#ecdcb6',
      fence: '#fff6e6',
      foliage: ['#7dbf5a', '#5fa64b', '#9ccc65'],
      accent: '#f2c14e',
    },
  },
  corn: {
    id: 'corn',
    name: 'Corn Field',
    crop: 'corn',
    cropName: 'corn',
    unitValue: 10,
    growTime: 34,
    minGrowTime: 11,
    baseSpeed: 1.42,
    patchesPerRow: 5,
    patchSpacing: 1.2,
    corridorsByExpand: [2, 4, 4],
    deepRowsAtExpand: 2,
    harvesterLimit: 4,
    harvesterLimitPerExpand: 1,
    autoAfterSales: 2,
    costs: {
      add: { base: 260, mult: 1.6, max: 99 },
      merge: [120, 900],
      auto: 350,
      water: { base: 220, mult: 1.55, max: 8 },
      speed: { base: 260, mult: 1.6, max: 8 },
      storage: { base: 280, mult: 1.5, max: 10 },
      expand: [3800, 18000],
    },
    unlock: { lifetime: 2200, cost: 1400, needsAutoOn: 'wheat' },
    missions: [
      { kind: 'add', text: 'Buy another corn harvester', reward: 60 },
      { kind: 'merge', text: 'Merge two corn harvesters', reward: 100 },
      { kind: 'auto', text: 'Unlock Corn Auto Drive', reward: 150 },
      { kind: 'expand', text: 'Expand the Corn Field', reward: 600 },
      { kind: 'tier3', text: 'Build a Tier 3 corn harvester', reward: 1500 },
      { kind: 'deepRows', text: 'Open the deep corn rows', reward: 3000 },
    ],
    palette: {
      ground: '#efe2bf',
      road: '#dcb77c',
      roadEdge: '#c99f63',
      soil: '#b0714a',
      soilWet: '#8c5638',
      fallow: '#dfc6a2',
      plot: '#e7d4ad',
      fence: '#9b6a45',
      foliage: ['#6fb04e', '#8cc063', '#4f9442'],
      accent: '#f5c84c',
    },
  },
};

