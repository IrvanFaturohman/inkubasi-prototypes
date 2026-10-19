import { MAX_UPGRADE_LEVEL, UPGRADES, UPGRADE_KEYS } from '../game/config';
import { defaultSettings, type Progress, type Settings } from '../game/state';

export const SAVE_VERSION = 1;
const SAVE_KEY = 'toy-block-demolition.save';
const SETTINGS_KEY = 'toy-block-demolition.settings';

/** Versioned progress save. Visual/transient state is never serialized. */
export interface SaveData {
  v: number;
  savedAt: number;
  progress: Progress;
  /** Remaining layers per cell of the current area, base64. */
  field: string;
  fieldCells: number;
  /** Cargo units per material [normal, reinforced, bonus]; in-flight pickups are included as stored. */
  cargo: [number, number, number];
}

export type LoadStatus = 'ok' | 'none' | 'corrupt' | 'unavailable';

export function encodeBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function decodeBytes(b64: string): Uint8Array | null {
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Strict structural + range validation. Returns a clean copy or null. */
export function validateSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.v !== SAVE_VERSION) return null;
  const p = d.progress as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return null;
  const BIG = 1e9;
  if (!isInt(p.coins, 0, BIG) || !isInt(p.totalEarned, 0, BIG)) return null;
  if (!isInt(p.areaIndex, 0, 100000) || !isInt(p.areaSeed, 0, 0xffffffff)) return null;
  if (!isBool(p.areaRewardClaimed) || !isBool(p.runComplete)) return null;
  const up = p.upgrades as Record<string, unknown> | undefined;
  if (!up || typeof up !== 'object') return null;
  for (const k of UPGRADE_KEYS) if (!isInt(up[k], 0, MAX_UPGRADE_LEVEL)) return null;
  const st = p.stats as Record<string, unknown> | undefined;
  if (!st || !isInt(st.layersCleared, 0, BIG) || !isInt(st.areasCleared, 0, BIG) || !isInt(st.unitsSold, 0, BIG)) return null;
  const tu = p.tutorial as Record<string, unknown> | undefined;
  if (!tu || !isBool(tu.drive) || !isBool(tu.pickup) || !isBool(tu.full) || !isBool(tu.sold) || !isBool(tu.upgrade)) return null;
  if (typeof d.field !== 'string' || !isInt(d.fieldCells, 1, 100000)) return null;
  const cargo = d.cargo;
  if (!Array.isArray(cargo) || cargo.length !== 3 || !cargo.every((c) => isInt(c, 0, 100000))) return null;
  const capacity = UPGRADES.cargo.values[up.cargo as number];
  if (cargo[0] + cargo[1] + cargo[2] > capacity) return null;
  const bytes = decodeBytes(d.field);
  if (!bytes || bytes.length !== d.fieldCells) return null;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > 2) return null;

  const progress: Progress = {
    coins: p.coins,
    totalEarned: p.totalEarned,
    upgrades: {
      roller: up.roller as number,
      cargo: up.cargo as number,
      power: up.power as number,
      speed: up.speed as number,
    },
    areaIndex: p.areaIndex,
    areaSeed: p.areaSeed,
    areaRewardClaimed: p.areaRewardClaimed,
    runComplete: p.runComplete,
    stats: {
      layersCleared: st.layersCleared as number,
      areasCleared: st.areasCleared as number,
      unitsSold: st.unitsSold as number,
    },
    tutorial: {
      drive: tu.drive as boolean,
      pickup: tu.pickup as boolean,
      full: tu.full as boolean,
      sold: tu.sold as boolean,
      upgrade: tu.upgrade as boolean,
    },
  };
  return {
    v: SAVE_VERSION,
    savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0,
    progress,
    field: d.field,
    fieldCells: d.fieldCells,
    cargo: [cargo[0], cargo[1], cargo[2]],
  };
}

export function validateSettings(raw: unknown): Settings {
  const s = defaultSettings();
  if (!raw || typeof raw !== 'object') return s;
  const d = raw as Record<string, unknown>;
  const vol = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fb);
  s.muted = isBool(d.muted) ? d.muted : s.muted;
  s.sfxVolume = vol(d.sfxVolume, s.sfxVolume);
  s.musicVolume = vol(d.musicVolume, s.musicVolume);
  s.reducedMotion = isBool(d.reducedMotion) ? d.reducedMotion : s.reducedMotion;
  s.haptics = isBool(d.haptics) ? d.haptics : s.haptics;
  s.quality = d.quality === 'low' || d.quality === 'high' || d.quality === 'auto' ? d.quality : s.quality;
  return s;
}

/** Minimal storage interface so tests can inject an in-memory store. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function detectStorage(): KeyValueStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__tbd_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/**
 * Throttled local persistence with graceful fallback. When storage is
 * unavailable the game keeps running in memory.
 */
export class SaveManager {
  readonly store: KeyValueStore | null;
  private dirty = false;
  private sinceWrite = 0;
  private collect: (() => SaveData) | null = null;
  lastError: string | null = null;
  /** Interval between throttled writes (seconds). */
  interval = 2.5;

  constructor(store?: KeyValueStore | null) {
    this.store = store === undefined ? detectStorage() : store;
  }

  get available(): boolean {
    return this.store !== null;
  }

  setCollector(fn: () => SaveData): void {
    this.collect = fn;
  }

  load(): { status: LoadStatus; data: SaveData | null } {
    if (!this.store) return { status: 'unavailable', data: null };
    let text: string | null = null;
    try {
      text = this.store.getItem(SAVE_KEY);
    } catch {
      return { status: 'unavailable', data: null };
    }
    if (text === null) return { status: 'none', data: null };
    try {
      const data = validateSave(JSON.parse(text));
      return data ? { status: 'ok', data } : { status: 'corrupt', data: null };
    } catch {
      return { status: 'corrupt', data: null };
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  tick(dt: number): void {
    this.sinceWrite += dt;
    if (this.dirty && this.sinceWrite >= this.interval) this.flush();
  }

  /** Write now (important actions, visibility checkpoint). */
  flush(): boolean {
    if (!this.collect) return false;
    this.dirty = false;
    this.sinceWrite = 0;
    if (!this.store) return false;
    try {
      this.store.setItem(SAVE_KEY, JSON.stringify(this.collect()));
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  clear(): void {
    this.dirty = false;
    try {
      this.store?.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }

  loadSettings(): Settings {
    if (!this.store) return defaultSettings();
    try {
      const t = this.store.getItem(SETTINGS_KEY);
      return t ? validateSettings(JSON.parse(t)) : defaultSettings();
    } catch {
      return defaultSettings();
    }
  }

  saveSettings(s: Settings): void {
    try {
      this.store?.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }
}

