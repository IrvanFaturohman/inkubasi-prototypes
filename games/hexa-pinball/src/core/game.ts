// Game model: hex board + ball transit + pinball room + beams. Pure TS, no Phaser.
// Everything advances in fixed ticks via step(), so the browser, the harness and
// the Node validator all run the exact same code.
import {
  CLEAR_AT,
  LAUNCH_GAP,
  TRAY_SIZE,
  T_BEAM,
  T_COMPRESS,
  T_MORPH,
  T_MOVE_BASE,
  T_MOVE_PER,
  T_PIPE,
  T_PLACE,
  T_PLUNGE,
  T_ROLL,
} from './config';
import { Rng } from './rng';
import { CELL_COUNT, freeCells, isFree, resolvePlacement, type Board, type BoardEvent } from './board';
import { Table, type TableEvent, type TableOpts } from './table';
import { LEVELS, type LevelDef } from './levels';

export type Status = 'playing' | 'won' | 'lost';

export interface Transit {
  id: number;
  colour: number;
  cell: number;
  count: number;
  start: number;
  launchAt: number;
  needed: boolean;
}

export interface Beam {
  id: number;
  band: number;
  colour: number;
  cell: number; // -1 when nothing is left to unlock
  start: number;
  end: number;
}

export type GameEvent = (
  | BoardEvent
  | TableEvent
  | { kind: 'transit'; id: number; colour: number; cell: number; count: number; needed: boolean }
  | { kind: 'beam'; id: number; band: number; colour: number; cell: number }
  | { kind: 'unlock'; cell: number }
  | { kind: 'tray' }
  | { kind: 'status'; status: Status }
) & { at: number; slot?: number };

export interface GameOpts {
  seed?: number;
  log?: boolean;
  table?: TableOpts;
}

export class Game {
  readonly level: LevelDef;
  readonly levelIndex: number;
  readonly seed: number;
  tick = 0;
  board: Board;
  tray: (number[] | null)[] = [];
  status: Status = 'playing';
  busyUntil = 0;
  transits: Transit[] = [];
  beams: Beam[] = [];
  table: Table;
  events: GameEvent[] = [];
  log: boolean;
  endTick = -1;
  stats = { placements: 0, balls: 0, wasted: 0, maxCombo: 0, clears: 0, unlocks: 0, hitsSame: 0 };
  lastCombo = 0;
  private rng: Rng;
  private lastLaunch = -9999;
  private nextId = 1;

  constructor(levelIndex: number, opts: GameOpts = {}) {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, levelIndex));
    this.level = LEVELS[this.levelIndex];
    this.seed = opts.seed ?? this.level.seed;
    this.log = opts.log ?? true;
    this.rng = new Rng(this.seed);
    this.table = new Table(this.level.bands, new Rng(this.seed ^ 0x51a7), opts.table);
    this.board = {
      stacks: Array.from({ length: CELL_COUNT }, () => []),
      locked: Array.from({ length: CELL_COUNT }, (_, i) => this.level.locked.includes(i)),
    };
    for (const p of this.level.preset ?? []) this.board.stacks[p.cell] = p.stack.slice();
    this.refillTray();
  }

  private emit(e: GameEvent): void {
    if (this.log) this.events.push(e);
  }

  /** Remove and return every event whose time has come. */
  drainEvents(upTo = this.tick): GameEvent[] {
    const out: GameEvent[] = [];
    const keep: GameEvent[] = [];
    for (const e of this.events) (e.at <= upTo ? out : keep).push(e);
    this.events = keep;
    return out;
  }

  genStack(): number[] {
    const L = this.level;
    const h = this.rng.weighted(L.heights);
    const runs = Math.min(h, this.rng.weighted(L.runs));
    const lens = Array.from({ length: runs }, () => 1);
    for (let i = runs; i < h; i++) lens[this.rng.int(runs)]++;
    const out: number[] = [];
    let prev = -1;
    for (const len of lens) {
      let c = L.tileColours[this.rng.int(L.tileColours.length)];
      if (c === prev) c = L.tileColours[(L.tileColours.indexOf(c) + 1 + this.rng.int(L.tileColours.length - 1)) % L.tileColours.length];
      for (let k = 0; k < len; k++) out.push(c);
      prev = c;
    }
    return out;
  }

  private refillTray(): void {
    this.tray = Array.from({ length: TRAY_SIZE }, () => this.genStack());
    this.emit({ kind: 'tray', at: this.tick });
  }

  neededColours(): Set<number> {
    return this.table.neededColours();
  }

  free(): number[] {
    return freeCells(this.board);
  }

  canPlace(): boolean {
    return this.status === 'playing' && this.tick >= this.busyUntil;
  }

  /** Place tray stack `slot` on `cell`. Returns the resolved board events, or null if illegal. */
  place(slot: number, cell: number): BoardEvent[] | null {
    const stack = this.tray[slot];
    if (!this.canPlace() || !stack || cell < 0 || cell >= CELL_COUNT || !isFree(this.board, cell)) return null;
    const { board, events } = resolvePlacement(this.board, cell, stack);
    this.board = board;
    this.tray[slot] = null;
    this.stats.placements++;
    let t = this.tick;
    let moves = 0;
    for (const ev of events) {
      this.emit(ev.kind === 'place' ? { ...ev, at: t, slot } : { ...ev, at: t });
      if (ev.kind === 'place') t += T_PLACE;
      else if (ev.kind === 'move') {
        moves++;
        t += T_MOVE_BASE + T_MOVE_PER * Math.min(ev.count - 1, 8);
      } else {
        this.startTransit(ev.cell, ev.colour, ev.count, t);
        t += T_COMPRESS;
      }
    }
    this.lastCombo = moves;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, moves);
    this.busyUntil = t;
    if (this.tray.every((s) => s === null)) this.refillTray();
    return events;
  }

  private startTransit(cell: number, colour: number, count: number, t: number): void {
    const ready = t + T_MORPH + T_ROLL + T_PIPE + T_PLUNGE;
    const launchAt = Math.max(ready, this.lastLaunch + LAUNCH_GAP);
    this.lastLaunch = launchAt;
    const needed = this.neededColours().has(colour);
    const tr: Transit = { id: this.nextId++, colour, cell, count, start: t, launchAt, needed };
    this.transits.push(tr);
    this.stats.clears++;
    this.stats.balls++;
    if (!needed) this.stats.wasted++;
    this.emit({ kind: 'transit', id: tr.id, colour, cell, count, needed, at: t });
  }

  /** Harness: put a ball of `colour` into the plunger lane now (or through the pipe). */
  injectBall(colour: number, viaPipe = false): void {
    if (viaPipe) this.startTransit(-1, colour, CLEAR_AT, this.tick);
    else this.table.launch(colour);
  }

  /** Harness / beams: unlock a locked cell (next in level order when omitted). */
  unlock(cell?: number): number {
    const c = cell ?? this.level.locked.find((i) => this.board.locked[i]) ?? -1;
    if (c < 0 || !this.board.locked[c]) return -1;
    this.board.locked[c] = false;
    this.stats.unlocks++;
    this.emit({ kind: 'unlock', cell: c, at: this.tick });
    return c;
  }

  /** Locked cell the next beam will open (not already targeted by a beam in flight). */
  private nextBeamCell(): number {
    for (const i of this.level.locked) {
      if (this.board.locked[i] && !this.beams.some((b) => b.cell === i)) return i;
    }
    return -1;
  }

  step(n = 1): void {
    for (let i = 0; i < n; i++) this.tickOnce();
  }

  private tickOnce(): void {
    this.tick++;
    for (let i = this.transits.length - 1; i >= 0; i--) {
      const tr = this.transits[i];
      if (this.tick >= tr.launchAt) {
        this.transits.splice(i, 1);
        this.table.launch(tr.colour);
      }
    }
    this.table.step();
    for (const e of this.table.events) {
      this.emit({ ...e, at: this.tick });
      if (e.kind === 'hit' && e.same) this.stats.hitsSame++;
      if (e.kind === 'group') {
        const cell = this.nextBeamCell();
        const bm: Beam = { id: this.nextId++, band: e.band, colour: e.colour, cell, start: this.tick, end: this.tick + T_BEAM };
        this.beams.push(bm);
        this.emit({ kind: 'beam', id: bm.id, band: e.band, colour: e.colour, cell, at: this.tick });
      }
    }
    this.table.events.length = 0;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const bm = this.beams[i];
      if (this.tick >= bm.end) {
        this.beams.splice(i, 1);
        if (bm.cell >= 0) this.unlock(bm.cell);
      }
    }
    if (this.status !== 'playing') return;
    if (this.table.bandAlive.every((a) => !a)) {
      this.setStatus('won');
    } else if (
      this.tick >= this.busyUntil &&
      this.free().length === 0 &&
      this.transits.length === 0 &&
      this.beams.length === 0 &&
      this.table.balls.length === 0
    ) {
      // overflow: nothing on the table can still open a cell
      this.setStatus('lost');
    }
  }

  private setStatus(s: Status): void {
    this.status = s;
    this.endTick = this.tick;
    this.emit({ kind: 'status', status: s, at: this.tick });
  }

  /** Waiting on the table to free a cell (board is full, but balls/beams are still live). */
  waitingOnTable(): boolean {
    return this.status === 'playing' && this.free().length === 0;
  }

  progress(): number {
    const total = this.table.hpTotal();
    return total ? 1 - this.table.hpLeft() / total : 1;
  }

  snapshot() {
    return {
      level: this.level.id,
      seed: this.seed,
      tick: this.tick,
      status: this.status,
      busy: this.tick < this.busyUntil,
      free: this.free(),
      locked: this.board.locked.flatMap((l, i) => (l ? [i] : [])),
      stacks: this.board.stacks.map((s) => s.slice()),
      tray: this.tray.map((s) => (s ? s.slice() : null)),
      needed: [...this.neededColours()],
      hpLeft: this.table.hpLeft(),
      hpTotal: this.table.hpTotal(),
      bands: this.table.bandAlive.map((alive, i) => ({
        colour: this.level.bands[i].colour,
        alive,
        hp: this.table.bandHp[i],
      })),
      balls: this.table.balls.map((b) => ({ id: b.id, colour: b.colour, x: +b.x.toFixed(1), y: +b.y.toFixed(1) })),
      transits: this.transits.map((t) => ({ id: t.id, colour: t.colour, launchIn: t.launchAt - this.tick })),
      beams: this.beams.map((b) => ({ band: b.band, cell: b.cell, landsIn: b.end - this.tick })),
      stats: { ...this.stats },
    };
  }
}

export type Snapshot = ReturnType<Game['snapshot']>;
