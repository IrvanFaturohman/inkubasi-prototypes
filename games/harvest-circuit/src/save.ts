/**
 * Versioned localStorage persistence. Anything malformed falls back to safe defaults
 * field by field; a completely unreadable save starts a fresh game instead of crashing.
 */
import { FIELDS, SAVE_KEY, SAVE_VERSION } from './config';
import { defaultField, defaultState } from './economy';
import { buildLayout } from './field';
import { FIELD_IDS, type FieldState, type GameState, type HarvesterState, type Tier } from './types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `?slot=name` keeps a separate save (handy for testing several devices side by side). */
export function saveKey(): string {
  try {
    const slot = new URLSearchParams(window.location.search).get('slot');
    return slot && /^[\w-]{1,24}$/.test(slot) ? `${SAVE_KEY}:${slot}` : SAVE_KEY;
  } catch {
    return SAVE_KEY;
  }
}

export function getStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = '__hc_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const int = (v: unknown, fallback: number, min = 0, max = 1e9): number => Math.floor(num(v, fallback, min, max));
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

export function serialize(state: GameState): string {
  const fields: Record<string, unknown> = {};
  for (const id of FIELD_IDS) {
    const f = state.fields[id];
    fields[id] = { ...f, growth: f.growth.map((g) => Math.round(g * 1000) / 1000) };
  }
  return JSON.stringify({ ...state, version: SAVE_VERSION, fields });
}

function sanitizeField(raw: unknown, id: (typeof FIELD_IDS)[number]): FieldState {
  const d = defaultField(id);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const cfg = FIELDS[id];
  const f: FieldState = {
    id,
    unlocked: bool(r.unlocked, d.unlocked) || cfg.unlock === null,
    expand: int(r.expand, 0, 0, cfg.costs.expand.length),
    water: int(r.water, 0, 0, cfg.costs.water.max),
    speed: int(r.speed, 0, 0, cfg.costs.speed.max),
    storage: int(r.storage, 0, 0, cfg.costs.storage.max),
    auto: bool(r.auto, false),
    adds: int(r.adds, 0),
    merges: int(r.merges, 0),
    harvesters: [],
    nextId: int(r.nextId, 2, 1),
    growth: [],
    sales: int(r.sales, 0),
    unitsSold: int(r.unitsSold, 0),
    earned: num(r.earned, 0, 0),
    mission: int(r.mission, 0, 0, cfg.missions.length),
  };
  const layout = buildLayout(cfg, f.expand);
  const L = layout.path.length;
  const limit = cfg.harvesterLimit + cfg.harvesterLimitPerExpand * f.expand;
  const hs: HarvesterState[] = [];
  const seen = new Set<number>();
  if (Array.isArray(r.harvesters)) {
    for (const h of r.harvesters as unknown[]) {
      if (!h || typeof h !== 'object' || hs.length >= limit) continue;
      const o = h as Record<string, unknown>;
      const hid = int(o.id, -1, -1);
      if (hid < 0 || seen.has(hid)) continue;
      seen.add(hid);
      const tier = int(o.tier, 1, 1, 3) as Tier;
      hs.push({ id: hid, tier, s: num(o.s, 0, 0, L - 1e-6), cargo: int(o.cargo, 0, 0, 1000) });
    }
  }
  f.harvesters = hs;
  f.nextId = Math.max(f.nextId, ...hs.map((h) => h.id + 1), 1);
  if (f.unlocked && f.harvesters.length === 0) f.harvesters.push({ id: f.nextId++, tier: 1, s: layout.siloS + 0.4, cargo: 0 });

  const n = layout.patches.length;
  const g = Array.isArray(r.growth) ? (r.growth as unknown[]) : [];
  f.growth = layout.patches.map((p, i) => (p.locked ? 0 : g.length === n ? num(g[i], 1, 0, 1) : 1));
  return f;
}

export function deserialize(json: string | null, now = Date.now()): { state: GameState; fresh: boolean } {
  if (!json) return { state: defaultState(now), fresh: true };
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || raw.version !== SAVE_VERSION) return { state: defaultState(now), fresh: true };
    const d = defaultState(now);
    const fieldsRaw = (raw.fields ?? {}) as Record<string, unknown>;
    const state: GameState = {
      version: SAVE_VERSION,
      money: num(raw.money, 0, 0),
      lifetime: num(raw.lifetime, 0, 0),
      time: num(raw.time, 0, 0),
      current: raw.current === 'corn' ? 'corn' : 'wheat',
      fields: { wheat: sanitizeField(fieldsRaw.wheat, 'wheat'), corn: sanitizeField(fieldsRaw.corn, 'corn') },
      muted: bool(raw.muted, d.muted),
      volume: num(raw.volume, d.volume, 0, 1),
      onboardMoved: num(raw.onboardMoved, 0, 0),
      firstSaleSeen: bool(raw.firstSaleSeen, false),
      simWallClock: num(raw.simWallClock, now, 0),
    };
    if (!state.fields[state.current].unlocked) state.current = 'wheat';
    if (state.simWallClock > now) state.simWallClock = now;
    return { state, fresh: false };
  } catch {
    return { state: defaultState(now), fresh: true };
  }
}

export function loadState(storage: StorageLike | null, now = Date.now()): { state: GameState; fresh: boolean } {
  if (!storage) return { state: defaultState(now), fresh: true };
  let json: string | null = null;
  try {
    json = storage.getItem(saveKey());
  } catch {
    json = null;
  }
  return deserialize(json, now);
}

export function saveState(storage: StorageLike | null, state: GameState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(saveKey(), serialize(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(storage: StorageLike | null): void {
  try {
    storage?.removeItem(saveKey());
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
