// Game flow on fixed steps (aim -> windup -> flight -> result). No DOM: the browser,
// window.__ao and the validator all drive this same object.
import {
  DT, COURSE_SEED, METER_GOOD, METER_PERFECT, UPGRADES, UpgradeId, meterAt, upgradeCost, segmentCount,
} from './config';
import { buildCourse, Course } from './course';
import { KV, SaveData, loadSave, writeSave } from './save';
import { RunResult, Sim, SimEvent } from './sim';

export type GPhase = 'aim' | 'windup' | 'flight' | 'result';

export type GameEvent =
  | SimEvent
  | { t: 'tap'; meter: number; perfect: boolean; good: boolean }
  | { t: 'result'; result: RunResult; newBest: boolean }
  | { t: 'collect' }
  | { t: 'buy'; id: UpgradeId; lvl: number }
  | { t: 'deny'; id: UpgradeId };

export const WINDUP_STEPS = Math.round(0.11 / DT); // 110 ms anticipation squash

export class Game {
  readonly kv: KV | null;
  readonly course: Course;
  save: SaveData;
  sim: Sim;
  phase: GPhase = 'aim';
  meterT = 0;
  meter = 0;
  tapMeter = 0;
  perfect = false;
  windupLeft = 0;
  resultSteps = 0;
  lastResult: RunResult | null = null;
  newBest = false;
  prevBest = 0;
  events: GameEvent[] = [];

  constructor(kv: KV | null) {
    this.kv = kv;
    this.save = loadSave(kv);
    this.course = buildCourse(COURSE_SEED);
    this.sim = new Sim(this.course, this.save.levels);
    this.prevBest = this.save.best;
  }

  private persist(): void {
    writeSave(this.kv, this.save);
  }

  private freshSim(): void {
    this.sim.dispose();
    this.sim = new Sim(this.course, this.save.levels);
  }

  tick(): void {
    if (this.phase === 'aim') {
      this.meterT += DT;
      this.meter = meterAt(this.meterT);
    } else if (this.phase === 'windup') {
      if (--this.windupLeft <= 0) {
        this.sim.launch(this.tapMeter, this.perfect);
        this.phase = 'flight';
      }
    }
    this.sim.step();
    for (const e of this.sim.drainEvents()) this.events.push(e);
    if (this.phase === 'flight' && this.sim.phase === 'done' && this.sim.result) this.onResult(this.sim.result);
    else if (this.phase === 'result') this.resultSteps++;
  }

  private onResult(r: RunResult): void {
    this.phase = 'result';
    this.resultSteps = 0;
    this.lastResult = r;
    this.prevBest = this.save.best;
    this.newBest = r.distance > this.save.best;
    this.save.coins += r.total; // paid immediately, so a reload never loses a run
    this.save.best = Math.max(this.save.best, r.distance);
    this.save.runs++;
    this.persist();
    this.events.push({ t: 'result', result: r, newBest: this.newBest });
  }

  /** The one input. Aim: lock the clicker gauge. Result: collect and go again. */
  tap(): boolean {
    if (this.phase === 'aim') {
      this.tapMeter = this.meter;
      this.perfect = this.meter >= METER_PERFECT;
      this.phase = 'windup';
      this.windupLeft = WINDUP_STEPS;
      this.events.push({ t: 'tap', meter: this.meter, perfect: this.perfect, good: this.meter >= METER_GOOD });
      return true;
    }
    if (this.phase === 'result' && this.resultSteps >= 24) {
      this.collect();
      return true;
    }
    return false;
  }

  collect(): void {
    if (this.phase !== 'result') return;
    this.freshSim();
    this.phase = 'aim';
    this.meterT = 0;
    this.meter = 0;
    this.events.push({ t: 'collect' });
  }

  /** Harness: skip the gauge and launch at an exact meter value. */
  launchNow(meter: number): void {
    if (this.phase === 'result') this.collect();
    if (this.phase === 'flight') return;
    this.tapMeter = meter;
    this.perfect = meter >= METER_PERFECT;
    this.sim.launch(meter, this.perfect);
    this.phase = 'flight';
  }

  canBuy(id: UpgradeId): boolean {
    const lvl = this.save.levels[id];
    return lvl < UPGRADES[id].max && this.save.coins >= upgradeCost(id, lvl);
  }

  buy(id: UpgradeId): boolean {
    if (!(id in UPGRADES) || (this.phase !== 'aim' && this.phase !== 'result')) return false;
    if (!this.canBuy(id)) {
      this.events.push({ t: 'deny', id });
      return false;
    }
    this.save.coins -= upgradeCost(id, this.save.levels[id]);
    this.save.levels[id]++;
    this.persist();
    if (this.phase === 'aim') this.freshSim(); // LENGTH changes the real body count
    this.events.push({ t: 'buy', id, lvl: this.save.levels[id] });
    return true;
  }

  grant(n: number): number {
    this.save.coins = Math.max(0, Math.floor(this.save.coins + n));
    this.persist();
    return this.save.coins;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  state() {
    const s = this.sim;
    return {
      phase: this.phase,
      meter: this.meter,
      coins: this.save.coins,
      best: this.save.best,
      runs: this.save.runs,
      levels: { ...this.save.levels },
      segments: segmentCount(this.save.levels.length),
      arrowColliders: s.arrowColliderCount(),
      bodies: s.world.bodies.len(),
      colliders: s.world.colliders.len(),
      distance: Math.floor(s.maxX),
      smashed: s.smashed,
      combo: s.combo,
      headX: s.headX,
      headY: s.headY,
      lastResult: this.lastResult,
      guardKills: s.guardKills,
    };
  }
}
