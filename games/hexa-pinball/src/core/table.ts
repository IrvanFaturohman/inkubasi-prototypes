// Pinball room: a small seeded circle-vs-segment / circle-vs-circle solver.
// No flippers on purpose: the player controls the ammo (colour), never the trajectory.
// One call to step() is one fixed 1/60 s tick split into SUB substeps.
import { Rng } from './rng';

export const TW = 660;
export const TH = 500;
export const BALL_R = 12;
export const LANE_X = 606; // inner wall of the plunger lane
export const LANE_CX = 633;
export const LANE_TOP = 140;
export const GRAV = 1300;
export const SUB = 4;
const DT = 1 / 60 / SUB;
const MAX_V = 1800;

/** Five alternating bands: even bands hold 5 targets, odd bands 4, offset by half a gap. */
export const BAND_Y = [128, 184, 240, 296, 352];
export const TARGET_R = 17;
export const BUMPER_R = 21;
/** Same-colour targets kick like pop bumpers. */
export const SAME_KICK = 480;
export const BUMP_KICK = 620;
export const SLING_KICK = 430;
/** Damage of the n-th same-colour hit by one ball is min(n, STREAK_CAP). */
export const STREAK_CAP = 3;

/** One band = one target group. HP is pooled: any same-colour hit on any of its targets counts. */
export interface BandDef {
  colour: number;
  hp: number;
}

export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nx: number; // unit normal (used for one-way gates and degenerate contacts)
  ny: number;
  e: number; // restitution
  f: number; // tangential friction
  kind: 'wall' | 'arc' | 'sling' | 'gate';
}

export interface Bumper {
  id: number;
  x: number;
  y: number;
  r: number;
}

export interface Target {
  id: number;
  band: number;
  x: number;
  y: number;
  r: number;
  colour: number;
  alive: boolean;
}

export interface Ball {
  id: number;
  colour: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  px: number;
  py: number;
  age: number;
  slow: number;
  laneRest: number;
  leftLane: boolean;
  streak: number;
  hits: number;
  cool: Map<number, number>;
  touched: Set<number>;
}

export type TableEvent =
  | { kind: 'launch'; ball: number; colour: number; power: number }
  | { kind: 'hit'; ball: number; target: number; band: number; colour: number; same: boolean; dmg: number; hp: number; streak: number }
  | { kind: 'group'; ball: number; band: number; colour: number }
  | { kind: 'bump'; ball: number; bumper: number; speed: number }
  | { kind: 'sling'; ball: number; speed: number }
  | { kind: 'drain'; ball: number; colour: number; hits: number }
  | { kind: 'kickback'; ball: number }
  | { kind: 'fizzle'; ball: number };

function seg(ax: number, ay: number, bx: number, by: number, e: number, f: number, kind: Seg['kind']): Seg {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy) || 1;
  // normal pointing "up" (negative y) or left when vertical
  let nx = dy / l;
  let ny = -dx / l;
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { ax, ay, bx, by, nx, ny, e, f, kind };
}

function arc(out: Seg[], cx: number, cy: number, r: number, a0: number, a1: number, n: number, e: number): void {
  let px = cx + r * Math.cos(a0);
  let py = cy + r * Math.sin(a0);
  for (let i = 1; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    out.push(seg(px, py, x, y, e, 0, 'arc'));
    px = x;
    py = y;
  }
}

export function buildWalls(): Seg[] {
  const s: Seg[] = [];
  const D = Math.PI / 180;
  arc(s, 110, 110, 110, 180 * D, 270 * D, 12, 0.35); // top-left corner
  s.push(seg(110, 0, 560, 0, 0.2, 0, 'arc')); // ceiling
  arc(s, 560, 100, 100, 270 * D, 360 * D, 12, 0.12); // top-right guide out of the lane
  s.push(seg(TW, 100, TW, TH, 0.3, 0, 'wall')); // outer right wall
  s.push(seg(0, 110, 0, 420, 0.45, 0, 'wall')); // left wall
  s.push(seg(0, 420, 255, 486, 0.55, 0.02, 'sling')); // left slope to drain
  s.push(seg(LANE_X, 420, 351, 486, 0.55, 0.02, 'sling')); // right slope to drain
  s.push(seg(LANE_X, LANE_TOP, LANE_X, TH, 0.3, 0, 'wall')); // lane inner wall
  s.push(seg(LANE_X, TH, TW, TH, 0.1, 0.3, 'wall')); // lane floor
  // one-way gate over the lane mouth: balls leave the lane, nothing falls back in
  const g = seg(TW, LANE_TOP - 24, LANE_X, LANE_TOP, 0.3, 0, 'gate');
  s.push(g);
  return s;
}

/** Lower bumpers only: the entry corridor (lane + top guide) stays clear. */
export function buildBumpers(): Bumper[] {
  return [
    { id: 0, x: 132, y: 418, r: BUMPER_R },
    { id: 1, x: 474, y: 418, r: BUMPER_R },
  ];
}

export function bandXs(band: number): number[] {
  const n = band % 2 === 0 ? 5 : 4;
  const step = LANE_X / 5;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(band % 2 === 0 ? step * (i + 0.5) : step * (i + 1));
  return xs;
}

export function buildTargets(bands: BandDef[]): Target[] {
  const out: Target[] = [];
  bands.forEach((b, bi) => {
    const xs = bandXs(bi);
    for (const x of xs) out.push({ id: out.length, band: bi, x, y: BAND_Y[bi], r: TARGET_R, colour: b.colour, alive: true });
  });
  return out;
}

export interface TableOpts {
  /** Targets register hits but never lose HP (used by the traffic heat map). */
  invulnerable?: boolean;
  launchMin?: number;
  launchMax?: number;
}

export class Table {
  readonly segs = buildWalls();
  readonly bumpers = buildBumpers();
  readonly targets: Target[];
  readonly bands: BandDef[];
  balls: Ball[] = [];
  events: TableEvent[] = [];
  tick = 0;
  invulnerable: boolean;
  launchMin: number;
  launchMax: number;
  bandAlive: boolean[];
  bandHp: number[];
  private nextId = 1;
  // instrumentation
  touch: number[];
  firstHit: number[];
  kickbacks = 0;
  launched = 0;

  constructor(
    bands: BandDef[],
    private rng: Rng,
    opts: TableOpts = {},
  ) {
    this.bands = bands;
    this.targets = buildTargets(bands);
    this.bandAlive = bands.map(() => true);
    this.bandHp = bands.map((b) => b.hp);
    this.invulnerable = !!opts.invulnerable;
    this.launchMin = opts.launchMin ?? 1150;
    this.launchMax = opts.launchMax ?? 1800;
    this.touch = this.targets.map(() => 0);
    this.firstHit = this.targets.map(() => 0);
  }

  neededColours(): Set<number> {
    const s = new Set<number>();
    for (const t of this.targets) if (t.alive) s.add(t.colour);
    return s;
  }

  hpLeft(): number {
    return this.bandHp.reduce((a, b) => a + b, 0);
  }

  hpTotal(): number {
    return this.bands.reduce((a, b) => a + b.hp, 0);
  }

  private makeBall(colour: number, x: number, y: number, vx: number, vy: number): Ball {
    const b: Ball = {
      id: this.nextId++,
      colour,
      x,
      y,
      vx,
      vy,
      px: x,
      py: y,
      age: 0,
      slow: 0,
      laneRest: 0,
      leftLane: y < LANE_TOP,
      streak: 0,
      hits: 0,
      cool: new Map(),
      touched: new Set(),
    };
    this.balls.push(b);
    return b;
  }

  /** Plunger shot. Power jitter is seeded, so the same seed gives the same table. */
  launch(colour: number, power?: number): Ball {
    const p = power ?? this.rng.range(this.launchMin, this.launchMax);
    const b = this.makeBall(colour, LANE_CX, TH - BALL_R - 2, 0, -p);
    this.launched++;
    this.events.push({ kind: 'launch', ball: b.id, colour, power: p });
    return b;
  }

  /** Test helper: drop a ball anywhere. */
  spawnAt(colour: number, x: number, y: number, vx = 0, vy = 0): Ball {
    return this.makeBall(colour, x, y, vx, vy);
  }

  step(): void {
    this.tick++;
    for (const b of this.balls) {
      b.px = b.x;
      b.py = b.y;
    }
    for (let s = 0; s < SUB; s++) {
      for (const b of this.balls) {
        b.vy += GRAV * DT;
        b.x += b.vx * DT;
        b.y += b.vy * DT;
        this.collideStatic(b);
      }
      this.collideBalls();
    }
    this.housekeeping();
  }

  private collideStatic(b: Ball): void {
    const r = BALL_R;
    for (const sg of this.segs) {
      const abx = sg.bx - sg.ax;
      const aby = sg.by - sg.ay;
      const len2 = abx * abx + aby * aby;
      let t = ((b.x - sg.ax) * abx + (b.y - sg.ay) * aby) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = sg.ax + abx * t;
      const cy = sg.ay + aby * t;
      let dx = b.x - cx;
      let dy = b.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (sg.kind === 'gate') {
        const side = (b.x - sg.ax) * sg.nx + (b.y - sg.ay) * sg.ny;
        if (side < 0 || b.vx * sg.nx + b.vy * sg.ny > 0) continue;
      }
      let d = Math.sqrt(d2);
      if (d < 1e-6) {
        dx = sg.nx;
        dy = sg.ny;
        d = 1;
      }
      const nx = dx / d;
      const ny = dy / d;
      const pen = r - Math.min(d, r);
      b.x += nx * pen;
      b.y += ny * pen;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        let out = -vn * sg.e;
        if (sg.kind === 'sling' && -vn > 140) {
          out = Math.max(out, SLING_KICK);
          this.events.push({ kind: 'sling', ball: b.id, speed: -vn });
        }
        b.vx += (-vn + out) * nx;
        b.vy += (-vn + out) * ny;
        if (sg.f > 0) {
          const tx = -ny;
          const ty = nx;
          const vt = b.vx * tx + b.vy * ty;
          b.vx -= vt * sg.f * tx;
          b.vy -= vt * sg.f * ty;
        }
      }
    }
    for (const bp of this.bumpers) {
      const dx = b.x - bp.x;
      const dy = b.y - bp.y;
      const rr = r + bp.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1;
      const nx = dx / d;
      const ny = dy / d;
      b.x = bp.x + nx * rr;
      b.y = bp.y + ny * rr;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        const out = Math.max(-vn * 0.9, BUMP_KICK);
        b.vx += (-vn + out) * nx;
        b.vy += (-vn + out) * ny;
        this.events.push({ kind: 'bump', ball: b.id, bumper: bp.id, speed: out });
      }
    }
    // Broken bands stay as grey spent pegs, so the table's traffic never changes.
    for (const tg of this.targets) {
      const dx = b.x - tg.x;
      const dy = b.y - tg.y;
      const rr = r + tg.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1;
      const nx = dx / d;
      const ny = dy / d;
      b.x = tg.x + nx * rr;
      b.y = tg.y + ny * rr;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        // a live target of the ball's own colour kicks like a pop bumper; anything else is a dead bounce
        const live = tg.alive && tg.colour === b.colour;
        const out = live ? Math.max(-vn * 0.9, SAME_KICK) : Math.max(-vn * 0.5, 80);
        b.vx += (-vn + out) * nx;
        b.vy += (-vn + out) * ny;
      }
      if (tg.alive) this.registerHit(b, tg);
    }
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_V) {
      b.vx *= MAX_V / sp;
      b.vy *= MAX_V / sp;
    }
  }

  private registerHit(b: Ball, tg: Target): void {
    const last = b.cool.get(tg.id);
    if (last !== undefined && this.tick - last < 8) return;
    b.cool.set(tg.id, this.tick);
    if (!b.touched.size) this.firstHit[tg.id]++;
    if (!b.touched.has(tg.id)) {
      b.touched.add(tg.id);
      this.touch[tg.id]++;
    }
    b.hits++;
    const same = b.colour === tg.colour;
    // combo escalation: each same-colour hit by one ball hits harder (1, 2, 3, capped)
    let dmg = 0;
    if (same) {
      b.streak++;
      dmg = Math.min(b.streak, STREAK_CAP);
      if (!this.invulnerable) this.bandHp[tg.band] = Math.max(0, this.bandHp[tg.band] - dmg);
    }
    const hp = this.bandHp[tg.band];
    this.events.push({ kind: 'hit', ball: b.id, target: tg.id, band: tg.band, colour: b.colour, same, dmg, hp, streak: b.streak });
    if (hp <= 0 && !this.invulnerable) {
      this.bandHp[tg.band] = 0;
      this.bandAlive[tg.band] = false;
      for (const t of this.targets) if (t.band === tg.band) t.alive = false;
      this.events.push({ kind: 'group', ball: b.id, band: tg.band, colour: tg.colour });
    }
  }

  private collideBalls(): void {
    const bs = this.balls;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const c = bs[j];
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const rr = BALL_R * 2;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1;
        const nx = dx / d;
        const ny = dy / d;
        const pen = (rr - d) / 2;
        a.x -= nx * pen;
        a.y -= ny * pen;
        c.x += nx * pen;
        c.y += ny * pen;
        const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (rel < 0) {
          const jm = (-(1 + 0.85) * rel) / 2;
          a.vx -= jm * nx;
          a.vy -= jm * ny;
          c.vx += jm * nx;
          c.vy += jm * ny;
        }
      }
    }
  }

  private housekeeping(): void {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.age++;
      if (!b.leftLane && b.y < LANE_TOP - 4) b.leftLane = true;
      const inLane = b.x > LANE_X;
      const sp = Math.hypot(b.vx, b.vy);
      if (inLane && b.y > TH - 60 && sp < 60) {
        b.laneRest++;
        if (b.laneRest > 20) {
          // ball came back down the lane: plunger fires again
          if (b.leftLane) {
            this.kickbacks++;
            this.events.push({ kind: 'kickback', ball: b.id });
          }
          b.laneRest = 0;
          b.leftLane = false;
          b.vy = -this.rng.range(this.launchMin, this.launchMax);
          b.vx = 0;
        }
      } else b.laneRest = 0;
      if (!inLane && sp < 22) {
        b.slow++;
        if (b.slow > 45) {
          b.slow = 0;
          b.vx += this.rng.range(-140, 140);
          b.vy -= 160;
        }
      } else b.slow = 0;
      if (b.y > TH + 40) {
        this.balls.splice(i, 1);
        this.events.push({ kind: 'drain', ball: b.id, colour: b.colour, hits: b.hits });
      } else if (b.age > 60 * 30) {
        this.balls.splice(i, 1);
        this.events.push({ kind: 'fizzle', ball: b.id });
      }
    }
  }
}
