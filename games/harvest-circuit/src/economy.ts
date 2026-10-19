/**
 * Simulation — the single source of truth.
 * Runs in fixed steps (SIM_DT live, OFFLINE.stepSec for catch-up). The 3D scene only reads
 * this state and the event queue; nothing visual feeds back into income.
 */
import {
  DRIVE,
  FIELDS,
  GEOMETRY,
  INCOME_WINDOW_SEC,
  MAX_TIER,
  OFFLINE,
  SAVE_VERSION,
  STAGES,
  STORAGE,
  TIERS,
  UPGRADE_EFFECT,
  curveCost,
  type FieldConfig,
  type MissionDef,
} from './config';
import { buildLayout, type Column, type FieldLayout } from './field';
import {
  FIELD_IDS,
  type Bottleneck,
  type FieldId,
  type FieldState,
  type GameEvent,
  type GameState,
  type HarvesterState,
  type Offer,
  type OfflineFieldSummary,
  type Tier,
  type UpgradeKind,
} from './types';

interface Metrics {
  cut: number;
  passUnripe: number;
  /** Distance driven, and distance driven with a full crate (share = "full long before the silo"). */
  dist: number;
  fullDist: number;
  wait: number;
  ripeFrac: number;
  deepFrac: number;
  sampleT: number;
}

export interface FieldRuntime {
  cfg: FieldConfig;
  layout: FieldLayout;
  /** Deterministic per-patch growth-rate jitter so rows don't ripen in one flat wave. */
  rate: Float32Array;
  ripeAt: Float64Array;
  /** Current drive factor (0 = stopped, 1 = base speed, boostMult = tap/hold). */
  drive: number;
  ledger: { t: number; a: number }[];
  m: Metrics;
  startTime: number;
}

export interface MergePlan {
  tier: Tier;
  kept: HarvesterState;
  removed: HarvesterState;
}

export interface FieldUnlockInfo {
  unlocked: boolean;
  cost: number;
  lifetimeNeeded: number;
  lifetimeProgress: number;
  needsAuto: FieldId | null;
  canBuy: boolean;
  reason: string;
}

const hash01 = (i: number, salt: number): number => {
  let x = (i + 1) * 374761393 + salt * 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

export const headerOffset = (tier: Tier): number => GEOMETRY.headerAhead * TIERS[tier - 1].scale;
export const reachOf = (tier: Tier): number => TIERS[tier - 1].reach;

export function stageOf(growth: number): 0 | 1 | 2 | 3 {
  if (growth >= 1) return 3;
  if (growth >= STAGES.young) return 2;
  if (growth >= STAGES.sprout) return 1;
  return 0;
}

export function defaultField(id: FieldId): FieldState {
  const cfg = FIELDS[id];
  const layout = buildLayout(cfg, 0);
  const unlocked = cfg.unlock === null;
  return {
    id,
    unlocked,
    expand: 0,
    water: 0,
    speed: 0,
    storage: 0,
    auto: false,
    adds: 0,
    merges: 0,
    harvesters: unlocked ? [{ id: 1, tier: 1, s: layout.siloS + 0.4, cargo: 0 }] : [],
    nextId: 2,
    growth: layout.patches.map((p) => (p.locked ? 0 : 1)),
    sales: 0,
    unitsSold: 0,
    earned: 0,
    mission: 0,
  };
}

export function defaultState(now = Date.now()): GameState {
  return {
    version: SAVE_VERSION,
    money: 0,
    lifetime: 0,
    time: 0,
    current: 'wheat',
    fields: { wheat: defaultField('wheat'), corn: defaultField('corn') },
    muted: false,
    volume: 0.6,
    onboardMoved: 0,
    firstSaleSeen: false,
    simWallClock: now,
  };
}

export class Game {
  state: GameState;
  rt: Record<FieldId, FieldRuntime>;
  events: GameEvent[] = [];
  /** Off during offline catch-up: nothing is shown for fields that aren't on screen. */
  emitEvents = true;
  /** Player input (only ever drives the field on screen). */
  holding = false;
  boost = 0;
  private missionTimer = 0;

  constructor(state: GameState) {
    this.state = state;
    this.rt = {} as Record<FieldId, FieldRuntime>;
    for (const id of FIELD_IDS) this.rt[id] = this.makeRuntime(id);
  }

  private makeRuntime(id: FieldId): FieldRuntime {
    const cfg = FIELDS[id];
    const f = this.state.fields[id];
    const layout = buildLayout(cfg, f.expand);
    const n = layout.patches.length;
    const rate = new Float32Array(n);
    const ripeAt = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      rate[i] = 0.9 + 0.2 * hash01(i, id === 'wheat' ? 7 : 13);
      ripeAt[i] = this.state.time;
    }
    return {
      cfg,
      layout,
      rate,
      ripeAt,
      drive: 0,
      ledger: [],
      m: { cut: 0, passUnripe: 0, dist: 0, fullDist: 0, wait: 0, ripeFrac: 0, deepFrac: 0, sampleT: 0 },
      startTime: this.state.time,
    };
  }

  // ─── Derived stats ────────────────────────────────────────────────────────

  get current(): FieldState {
    return this.state.fields[this.state.current];
  }

  growTime(f: FieldState, level = f.water): number {
    const cfg = FIELDS[f.id];
    return Math.max(cfg.minGrowTime, cfg.growTime * Math.pow(UPGRADE_EFFECT.waterMult, level));
  }

  /** Base (Auto Drive) speed in world units per second. */
  speed(f: FieldState, level = f.speed): number {
    return FIELDS[f.id].baseSpeed * Math.pow(UPGRADE_EFFECT.speedMult, level);
  }

  capacity(f: FieldState, tier: Tier, level = f.storage): number {
    return Math.round((STORAGE.base + STORAGE.perLevel * level) * TIERS[tier - 1].capMult);
  }

  harvesterLimit(f: FieldState): number {
    const cfg = FIELDS[f.id];
    return cfg.harvesterLimit + cfg.harvesterLimitPerExpand * f.expand;
  }

  maxTier(f: FieldState): number {
    let t = 0;
    for (const h of f.harvesters) t = Math.max(t, h.tier);
    return t;
  }

  // ─── Simulation step ──────────────────────────────────────────────────────

  step(dt: number): void {
    const st = this.state;
    st.time += dt;
    for (const id of FIELD_IDS) {
      if (st.fields[id].unlocked) this.stepField(id, dt, id === st.current);
    }
    if (this.boost > 0) this.boost = Math.max(0, this.boost - dt);
    this.missionTimer += dt;
    if (this.missionTimer >= 0.5) {
      this.missionTimer = 0;
      this.checkMissions();
    }
  }

  /** A tap: short burst of movement. Repeated taps refresh but never stack past the cap. */
  tap(): void {
    this.boost = Math.max(this.boost, DRIVE.tapBoostSec);
  }

  isPressing(): boolean {
    return this.holding || this.boost > 0;
  }

  private stepField(id: FieldId, dt: number, active: boolean): void {
    const st = this.state;
    const f = st.fields[id];
    const rt = this.rt[id];
    const L = rt.layout;

    // Regrowth — every patch runs on its own timer.
    const inc = dt / this.growTime(f);
    const g = f.growth;
    const patches = L.patches;
    for (let i = 0; i < g.length; i++) {
      if (g[i] < 1 && !patches[i].locked) {
        g[i] += inc * rt.rate[i];
        if (g[i] >= 1) {
          g[i] = 1;
          rt.ripeAt[i] = st.time;
        }
      }
    }

    // Drive factor.
    const pressing = active && this.isPressing();
    const target = pressing ? DRIVE.boostMult : f.auto ? 1 : 0;
    if (rt.drive < target) rt.drive = Math.min(target, rt.drive + DRIVE.accel * dt);
    else if (rt.drive > target) rt.drive = Math.max(target, rt.drive - DRIVE.decel * dt);

    // Bottleneck metrics: exponential window (~15 s).
    const m = rt.m;
    const decay = Math.exp(-dt / 15);
    m.cut *= decay;
    m.passUnripe *= decay;
    m.dist *= decay;
    m.fullDist *= decay;
    m.wait *= decay;
    m.sampleT += dt;
    if (m.sampleT >= 0.5) {
      m.sampleT = 0;
      this.sampleRipeness(f, rt);
    }

    if (rt.drive <= 1e-4 || f.harvesters.length === 0) return;

    const v = rt.drive * this.speed(f);
    const hs = f.harvesters;
    const n = hs.length;
    const Lp = L.path.length;
    const order = n > 1 ? hs.slice().sort((a, b) => a.s - b.s) : hs;
    const moves: number[] = new Array(n);
    for (let k = 0; k < n; k++) {
      let move = v * dt;
      if (n > 1) {
        const h = order[k];
        const ahead = order[(k + 1) % n];
        const gap = L.path.wrap(ahead.s - h.s);
        if (gap < (Lp / n) * DRIVE.spacingFrac) move *= DRIVE.spacingSlow;
        move = Math.min(move, Math.max(0, gap - DRIVE.minGap));
      }
      moves[k] = move;
    }
    for (let k = 0; k < n; k++) this.advance(id, order[k], moves[k]);
    if (pressing || active) st.onboardMoved += v * dt;
  }

  private sampleRipeness(f: FieldState, rt: FieldRuntime): void {
    const top = this.maxTier(f);
    const reach = top > 0 ? reachOf(top as Tier) : 0;
    let reachN = 0;
    let reachRipe = 0;
    let deepN = 0;
    let deepRipe = 0;
    const patches = rt.layout.patches;
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      if (p.locked) continue;
      if (p.strip <= reach) {
        reachN++;
        if (f.growth[i] >= 1) reachRipe++;
      } else {
        deepN++;
        if (f.growth[i] >= 1) deepRipe++;
      }
    }
    const k = 0.25;
    rt.m.ripeFrac += ((reachN ? reachRipe / reachN : 0) - rt.m.ripeFrac) * k;
    rt.m.deepFrac += ((deepN ? deepRipe / deepN : 0) - rt.m.deepFrac) * k;
  }

  private advance(id: FieldId, h: HarvesterState, move: number): void {
    if (move <= 0) return;
    const L = this.rt[id].layout;
    const Lp = L.path.length;
    const a = L.path.wrap(h.s + headerOffset(h.tier));
    const b = a + move;
    const m = this.rt[id].m;
    m.dist += move;
    if (h.cargo >= this.capacity(this.state.fields[id], h.tier)) m.fullDist += move;
    this.crossColumns(id, h, a, b, Lp);
    const s0 = h.s;
    const s1 = h.s + move;
    const x = L.siloS;
    if ((x > s0 && x <= s1) || (x + Lp > s0 && x + Lp <= s1)) this.sell(id, h);
    h.s = L.path.wrap(s1);
  }

  private crossColumns(id: FieldId, h: HarvesterState, a: number, b: number, Lp: number): void {
    const cols = this.rt[id].layout.columns;
    if (cols.length === 0) return;
    // first column with s > a
    let lo = 0;
    let hi = cols.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cols[mid].s <= a) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < cols.length && cols[i].s <= b; i++) this.harvestColumn(id, h, cols[i]);
    if (b > Lp) {
      const bb = b - Lp;
      for (let i = 0; i < cols.length && cols[i].s <= bb; i++) this.harvestColumn(id, h, cols[i]);
    }
  }

  private harvestColumn(id: FieldId, h: HarvesterState, col: Column): void {
    const st = this.state;
    const f = st.fields[id];
    const rt = this.rt[id];
    const patches = rt.layout.patches;
    const reach = reachOf(h.tier);
    const cap = this.capacity(f, h.tier);
    for (const idx of col.patches) {
      const p = patches[idx];
      if (p.locked || p.strip > reach) continue;
      if (f.growth[idx] >= 1) {
        if (h.cargo < cap) {
          f.growth[idx] = 0;
          h.cargo++;
          rt.m.cut++;
          rt.m.wait += Math.max(0, st.time - rt.ripeAt[idx]);
          if (this.emitEvents) {
            this.events.push({ type: 'cut', field: id, patch: idx, harvester: h.id, dir: p.dir });
            if (h.cargo >= cap) this.events.push({ type: 'full', field: id, harvester: h.id });
          }
        }
      } else {
        rt.m.passUnripe++;
      }
    }
  }

  private sell(id: FieldId, h: HarvesterState): void {
    if (h.cargo <= 0) return; // passing with an empty crate earns nothing
    const st = this.state;
    const f = st.fields[id];
    const units = h.cargo;
    const amount = units * FIELDS[id].unitValue;
    h.cargo = 0;
    this.credit(id, amount, units);
    f.sales++;
    if (this.emitEvents) {
      const first = !st.firstSaleSeen;
      st.firstSaleSeen = true;
      this.events.push({ type: 'sell', field: id, harvester: h.id, units, amount, first });
    }
  }

  private credit(id: FieldId, amount: number, units: number): void {
    const st = this.state;
    const f = st.fields[id];
    st.money += amount;
    st.lifetime += amount;
    f.earned += amount;
    f.unitsSold += units;
    this.rt[id].ledger.push({ t: st.time, a: amount });
  }

  // ─── Readouts ─────────────────────────────────────────────────────────────

  /** Real income per minute from the sales ledger (moving 60 s window). */
  incomePerMin(id: FieldId): number {
    const rt = this.rt[id];
    const now = this.state.time;
    const cutoff = now - INCOME_WINDOW_SEC;
    const led = rt.ledger;
    let drop = 0;
    while (drop < led.length && led[drop].t < cutoff) drop++;
    if (drop) led.splice(0, drop);
    let sum = 0;
    for (const e of led) sum += e.a;
    const span = Math.min(INCOME_WINDOW_SEC, Math.max(15, now - rt.startTime));
    return (sum * 60) / span;
  }

  totalIncomePerMin(): number {
    let t = 0;
    for (const id of FIELD_IDS) if (this.state.fields[id].unlocked) t += this.incomePerMin(id);
    return t;
  }

  bottleneck(id: FieldId = this.state.current): Bottleneck {
    const f = this.state.fields[id];
    const rt = this.rt[id];
    const m = rt.m;
    if (!f.auto && rt.drive < 0.05 && !this.isPressing()) {
      return { kind: 'idle', text: 'Hold the field to drive', hint: null };
    }
    if (m.dist > 3 && m.fullDist / m.dist > 0.35) {
      return { kind: 'storage', text: 'Crates full — crops left behind', hint: 'storage' };
    }
    const gt = this.growTime(f);
    if (m.cut > 1 && m.wait / m.cut > 0.6 * gt && m.ripeFrac > 0.45) {
      const atLimit = f.harvesters.length >= this.harvesterLimit(f);
      return {
        kind: 'harvesters',
        text: 'Needs more harvesters',
        hint: atLimit ? (this.mergePlan(f) ? 'merge' : 'expand') : 'add',
      };
    }
    if (m.passUnripe > 2 && m.passUnripe / (m.passUnripe + m.cut + 1e-3) > 0.6) {
      return { kind: 'crops', text: 'Waiting for crops to regrow', hint: 'water' };
    }
    const top = this.maxTier(f);
    if (top > 0 && top < MAX_TIER && m.deepFrac > 0.6) {
      return { kind: 'reach', text: `Deeper rows need Tier ${top + 1}`, hint: 'merge' };
    }
    return { kind: 'good', text: 'Harvest flowing', hint: null };
  }

  // ─── Upgrades ─────────────────────────────────────────────────────────────

  /** Two same-tier harvesters closest along the loop; never mixes tiers. */
  mergePlan(f: FieldState): MergePlan | null {
    for (let t = 1; t < MAX_TIER; t++) {
      const same = f.harvesters.filter((h) => h.tier === t).sort((a, b) => a.s - b.s);
      if (same.length < 2) continue;
      const Lp = this.rt[f.id].layout.path.length;
      let best: MergePlan | null = null;
      let bestD = Infinity;
      for (let i = 0; i < same.length; i++) {
        const behind = same[i];
        const ahead = same[(i + 1) % same.length];
        const d = (((ahead.s - behind.s) % Lp) + Lp) % Lp;
        if (d < bestD) {
          bestD = d;
          best = { tier: t as Tier, kept: ahead, removed: behind };
        }
      }
      return best;
    }
    return null;
  }

  offer(kind: UpgradeKind, id: FieldId = this.state.current): Offer {
    const f = this.state.fields[id];
    const cfg = FIELDS[id];
    const money = this.state.money;
    const priced = (cost: number, effect: string): Offer => ({ kind, cost, effect, state: money >= cost ? 'ok' : 'poor' });
    switch (kind) {
      case 'add': {
        const n = f.harvesters.length;
        const limit = this.harvesterLimit(f);
        const cost = curveCost(cfg.costs.add, f.adds);
        if (n >= limit) {
          const canExpand = f.expand < cfg.costs.expand.length;
          return { kind, cost, effect: `${n}/${limit}`, state: 'locked', reason: canExpand ? `${n}/${limit} · EXPAND` : `${n}/${limit} max` };
        }
        return priced(cost, `${n} → ${n + 1}`);
      }
      case 'merge': {
        const plan = this.mergePlan(f);
        if (!plan) {
          const allTop = f.harvesters.length > 0 && f.harvesters.every((h) => h.tier === MAX_TIER);
          const low = f.harvesters.length ? Math.min(...f.harvesters.map((h) => h.tier)) : 1;
          return { kind, cost: 0, effect: '', state: allTop ? 'max' : 'locked', reason: allTop ? 'Top tier' : `Need 2× T${low}` };
        }
        const t = plan.tier;
        return priced(cfg.costs.merge[t - 1], `T${t}+T${t} → T${t + 1}`);
      }
      case 'auto': {
        if (f.auto) return { kind, cost: 0, effect: 'ON', state: 'owned' };
        if (f.sales < cfg.autoAfterSales) {
          return {
            kind,
            cost: cfg.costs.auto,
            effect: 'drives itself',
            state: 'locked',
            reason: `Sell loads ${f.sales}/${cfg.autoAfterSales}`,
          };
        }
        return priced(cfg.costs.auto, 'drives itself');
      }
      case 'water': {
        const c = cfg.costs.water;
        const now = Math.round(this.growTime(f));
        if (f.water >= c.max) return { kind, cost: 0, effect: `grow ${now}s`, state: 'max' };
        return priced(curveCost(c, f.water), `${now}s → ${Math.round(this.growTime(f, f.water + 1))}s`);
      }
      case 'speed': {
        const c = cfg.costs.speed;
        const a = this.speed(f);
        if (f.speed >= c.max) return { kind, cost: 0, effect: `${a.toFixed(1)} m/s`, state: 'max' };
        return priced(curveCost(c, f.speed), `${a.toFixed(1)} → ${this.speed(f, f.speed + 1).toFixed(1)} m/s`);
      }
      case 'storage': {
        const c = cfg.costs.storage;
        const tier = (f.harvesters.length ? Math.min(...f.harvesters.map((h) => h.tier)) : 1) as Tier;
        const a = this.capacity(f, tier);
        if (f.storage >= c.max) return { kind, cost: 0, effect: `${a} crate`, state: 'max' };
        return priced(curveCost(c, f.storage), `${a} → ${this.capacity(f, tier, f.storage + 1)}`);
      }
      case 'expand': {
        const list = cfg.costs.expand;
        if (f.expand >= list.length) return { kind, cost: 0, effect: 'Full size', state: 'max' };
        const nextCorr = cfg.corridorsByExpand[Math.min(f.expand + 1, cfg.corridorsByExpand.length - 1)];
        const curCorr = cfg.corridorsByExpand[Math.min(f.expand, cfg.corridorsByExpand.length - 1)];
        const effect = nextCorr > curCorr ? `+${nextCorr - curCorr} corridors` : 'deep rows';
        return priced(list[f.expand], effect);
      }
    }
  }

  buy(kind: UpgradeKind, id: FieldId = this.state.current): boolean {
    const o = this.offer(kind, id);
    if (o.state !== 'ok') return false;
    const f = this.state.fields[id];
    this.state.money -= o.cost;
    switch (kind) {
      case 'add':
        this.spawn(id);
        f.adds++;
        break;
      case 'merge':
        this.merge(id);
        break;
      case 'auto':
        f.auto = true;
        break;
      case 'water':
        f.water++;
        break;
      case 'speed':
        f.speed++;
        break;
      case 'storage':
        f.storage++;
        break;
      case 'expand':
        this.expand(id);
        break;
    }
    if (this.emitEvents) this.events.push({ type: 'upgrade', field: id, kind });
    this.checkMissions();
    return true;
  }

  private spawn(id: FieldId): HarvesterState {
    const f = this.state.fields[id];
    const L = this.rt[id].layout;
    let s = L.siloS + 0.4;
    if (f.harvesters.length > 0) {
      const sorted = f.harvesters.map((h) => h.s).sort((a, b) => a - b);
      let bestGap = -1;
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i];
        const b = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + L.path.length;
        if (b - a > bestGap) {
          bestGap = b - a;
          s = a + (b - a) / 2;
        }
      }
    }
    const h: HarvesterState = { id: f.nextId++, tier: 1, s: L.path.wrap(s), cargo: 0 };
    f.harvesters.push(h);
    if (this.emitEvents) this.events.push({ type: 'spawn', field: id, harvester: h.id });
    return h;
  }

  private merge(id: FieldId): void {
    const f = this.state.fields[id];
    const plan = this.mergePlan(f);
    if (!plan) return;
    const { kept, removed } = plan;
    kept.tier = (plan.tier + 1) as Tier;
    const total = kept.cargo + removed.cargo;
    const cap = this.capacity(f, kept.tier);
    kept.cargo = Math.min(total, cap);
    const overflow = total - kept.cargo;
    // Tier capacities are sized so this never happens; if it ever did, the crops are sold, not lost.
    if (overflow > 0) this.credit(id, overflow * FIELDS[id].unitValue, overflow);
    f.harvesters = f.harvesters.filter((h) => h !== removed);
    f.merges++;
    if (this.emitEvents) {
      this.events.push({ type: 'merge', field: id, kept: kept.id, removed: removed.id, removedS: removed.s, tier: kept.tier });
    }
  }

  private expand(id: FieldId): void {
    const f = this.state.fields[id];
    const rt = this.rt[id];
    const old = rt.layout;
    f.expand++;
    const next = buildLayout(FIELDS[id], f.expand);
    const g: number[] = new Array(next.patches.length);
    for (let i = 0; i < next.patches.length; i++) {
      const np = next.patches[i];
      if (np.locked) g[i] = 0;
      else if (i < old.patches.length && !old.patches[i].locked) g[i] = f.growth[i];
      else g[i] = 1; // freshly opened ground starts ripe so the upgrade pays off right away
    }
    f.growth = g;
    for (const h of f.harvesters) {
      const p = old.path.pointAt(h.s);
      h.s = next.path.nearest(p.x, p.z);
    }
    const n = next.patches.length;
    const rate = new Float32Array(n);
    const ripeAt = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      rate[i] = 0.9 + 0.2 * hash01(i, id === 'wheat' ? 7 : 13);
      ripeAt[i] = i < rt.ripeAt.length ? rt.ripeAt[i] : this.state.time;
    }
    rt.layout = next;
    rt.rate = rate;
    rt.ripeAt = ripeAt;
    if (this.emitEvents) this.events.push({ type: 'expand', field: id, level: f.expand });
  }

  // ─── Fields ───────────────────────────────────────────────────────────────

  unlockInfo(id: FieldId): FieldUnlockInfo {
    const f = this.state.fields[id];
    const u = FIELDS[id].unlock;
    if (!u) return { unlocked: true, cost: 0, lifetimeNeeded: 0, lifetimeProgress: 1, needsAuto: null, canBuy: false, reason: '' };
    const lifeOk = this.state.lifetime >= u.lifetime;
    const autoOk = this.state.fields[u.needsAutoOn].auto;
    let reason = '';
    if (!autoOk) reason = `Needs ${FIELDS[u.needsAutoOn].name} Auto Drive`;
    else if (!lifeOk) reason = `Earn $${Math.ceil(u.lifetime - this.state.lifetime)} more (lifetime)`;
    else if (this.state.money < u.cost) reason = `Need $${u.cost}`;
    return {
      unlocked: f.unlocked,
      cost: u.cost,
      lifetimeNeeded: u.lifetime,
      lifetimeProgress: Math.min(1, this.state.lifetime / u.lifetime),
      needsAuto: autoOk ? null : u.needsAutoOn,
      canBuy: !f.unlocked && lifeOk && autoOk && this.state.money >= u.cost,
      reason,
    };
  }

  unlockField(id: FieldId): boolean {
    const info = this.unlockInfo(id);
    if (!info.canBuy) return false;
    const f = this.state.fields[id];
    this.state.money -= info.cost;
    f.unlocked = true;
    const rt = this.rt[id];
    rt.startTime = this.state.time;
    if (f.harvesters.length === 0) {
      f.harvesters.push({ id: f.nextId++, tier: 1, s: rt.layout.siloS + 0.4, cargo: 0 });
    }
    if (this.emitEvents) this.events.push({ type: 'unlockField', field: id });
    this.switchField(id);
    this.checkMissions();
    return true;
  }

  switchField(id: FieldId): boolean {
    if (!this.state.fields[id].unlocked || this.state.current === id) return false;
    this.state.current = id;
    this.boost = 0;
    if (this.emitEvents) this.events.push({ type: 'switch', field: id });
    return true;
  }

  // ─── Missions ─────────────────────────────────────────────────────────────

  mission(id: FieldId = this.state.current): MissionDef | null {
    const f = this.state.fields[id];
    return FIELDS[id].missions[f.mission] ?? null;
  }

  private missionDone(def: MissionDef, f: FieldState): boolean {
    switch (def.kind) {
      case 'add':
        return f.adds >= 1;
      case 'merge':
        return f.merges >= 1;
      case 'auto':
        return f.auto;
      case 'expand':
        return f.expand >= 1;
      case 'unlockCorn':
        return this.state.fields.corn.unlocked;
      case 'tier3':
        return f.harvesters.some((h) => h.tier === 3);
      case 'deepRows':
        return f.expand >= FIELDS[f.id].deepRowsAtExpand;
    }
  }

  checkMissions(): void {
    for (const id of FIELD_IDS) {
      const f = this.state.fields[id];
      if (!f.unlocked) continue;
      const list = FIELDS[id].missions;
      while (f.mission < list.length && this.missionDone(list[f.mission], f)) {
        const def = list[f.mission];
        this.state.money += def.reward;
        f.mission++;
        if (this.emitEvents) this.events.push({ type: 'mission', field: id, text: def.text, reward: def.reward });
      }
    }
  }

  // ─── Offline / hidden-tab catch-up ────────────────────────────────────────

  /**
   * Runs the real rules (movement, regrowth, crate limits, silo sales) with a coarse step.
   * Fields without Auto Drive only regrow — they produce nothing.
   */
  simulateOffline(seconds: number): OfflineFieldSummary[] {
    const sec = Math.max(0, Math.min(seconds, OFFLINE.maxSec));
    const before = FIELD_IDS.map((id) => {
      const f = this.state.fields[id];
      return { id, earned: f.earned, units: f.unitsSold, sales: f.sales };
    });
    const prevEmit = this.emitEvents;
    const prevHold = this.holding;
    this.emitEvents = false;
    this.holding = false;
    this.boost = 0;
    let t = 0;
    while (t < sec - 1e-9) {
      const dt = Math.min(OFFLINE.stepSec, sec - t);
      this.state.time += dt;
      for (const id of FIELD_IDS) if (this.state.fields[id].unlocked) this.stepField(id, dt, false);
      t += dt;
    }
    this.emitEvents = prevEmit;
    this.holding = prevHold;
    this.checkMissions();
    return before
      .filter((b) => this.state.fields[b.id].unlocked)
      .map((b) => {
        const f = this.state.fields[b.id];
        return {
          field: b.id,
          seconds: sec,
          earned: f.earned - b.earned,
          units: f.unitsSold - b.units,
          loads: f.sales - b.sales,
          auto: f.auto,
        };
      });
  }

  /**
   * Applies the wall-clock gap since the simulation last ran. The clock is advanced *before*
   * simulating, so calling this twice for the same moment can never pay out twice.
   */
  catchUp(nowMs: number): OfflineFieldSummary[] | null {
    const gap = (nowMs - this.state.simWallClock) / 1000;
    this.state.simWallClock = nowMs;
    if (!(gap >= OFFLINE.minSec)) return null;
    return this.simulateOffline(gap);
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
