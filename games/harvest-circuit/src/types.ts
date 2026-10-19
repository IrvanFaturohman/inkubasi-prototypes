export type FieldId = 'wheat' | 'corn';
export const FIELD_IDS: FieldId[] = ['wheat', 'corn'];

export type Tier = 1 | 2 | 3;

export type UpgradeKind =
  | 'add'
  | 'merge'
  | 'auto'
  | 'water'
  | 'speed'
  | 'storage'
  | 'expand';

/** Persistent state of one harvester (saved). */
export interface HarvesterState {
  id: number;
  tier: Tier;
  /** Arc-length position along the field loop (0..path.length). */
  s: number;
  /** Units of crop in the crate. */
  cargo: number;
}

/** Persistent state of one field (saved). Everything here is field-local. */
export interface FieldState {
  id: FieldId;
  unlocked: boolean;
  expand: number;
  water: number;
  speed: number;
  storage: number;
  auto: boolean;
  adds: number;
  merges: number;
  harvesters: HarvesterState[];
  nextId: number;
  /** Growth progress per patch, 0..1 (1 = mature). Index order comes from layout. */
  growth: number[];
  /** Loads sold at the silo (used to unlock Auto Drive). */
  sales: number;
  unitsSold: number;
  earned: number;
  /** Index of the active mission in this field's mission list. */
  mission: number;
}

export interface GameState {
  version: number;
  money: number;
  lifetime: number;
  /** Simulation clock in seconds (only advances through fixed steps / offline steps). */
  time: number;
  current: FieldId;
  fields: Record<FieldId, FieldState>;
  muted: boolean;
  volume: number;
  /** Distance driven before the "Hold to harvest" hint disappears. */
  onboardMoved: number;
  firstSaleSeen: boolean;
  /** Wall-clock ms up to which the simulation has been applied (live or offline). */
  simWallClock: number;
}

export type GameEvent =
  | { type: 'cut'; field: FieldId; patch: number; harvester: number; dir: number }
  | { type: 'full'; field: FieldId; harvester: number }
  | { type: 'sell'; field: FieldId; harvester: number; units: number; amount: number; first: boolean }
  | { type: 'spawn'; field: FieldId; harvester: number }
  | { type: 'merge'; field: FieldId; kept: number; removed: number; removedS: number; tier: Tier }
  | { type: 'upgrade'; field: FieldId; kind: UpgradeKind }
  | { type: 'expand'; field: FieldId; level: number }
  | { type: 'mission'; field: FieldId; text: string; reward: number }
  | { type: 'unlockField'; field: FieldId }
  | { type: 'switch'; field: FieldId };

export type BottleneckKind = 'idle' | 'storage' | 'harvesters' | 'crops' | 'reach' | 'good';

export interface Bottleneck {
  kind: BottleneckKind;
  text: string;
  hint: UpgradeKind | null;
}

export type OfferState = 'ok' | 'poor' | 'locked' | 'max' | 'owned';

export interface Offer {
  kind: UpgradeKind;
  cost: number;
  state: OfferState;
  /** Short effect line, e.g. "grow 25s → 21s". */
  effect: string;
  /** Reason shown when locked. */
  reason?: string;
}

export interface OfflineFieldSummary {
  field: FieldId;
  seconds: number;
  earned: number;
  units: number;
  loads: number;
  auto: boolean;
}
