import Phaser from 'phaser';
import { GameConfig as C, RoundConfig } from '../config/GameConfig';
import { LoopPath, PathPoint } from './LoopPath';

// Gameplay simulation. Runs in fixed 1/60 s steps (scene accumulator or the
// window.__mf.step hook). Matter.js is stepped manually with world.step(), and
// world.pause()/resume() are called ONLY when a hitstop starts / ends:
// in Phaser 3.90 resume() resets the runner clock to performance.now(), so
// calling it every frame starves the fixed-step accumulator and balls freeze.

export const DT = 1 / 60;
const CAT_MAGNET = 0x0001;
const CAT_BALL = 0x0002;

export type BallMode = 'drop' | 'seated' | 'free' | 'attached' | 'flying' | 'return' | 'celebrate';
export type Phase = 'intro' | 'play' | 'clear' | 'failed' | 'won';

export interface Ball {
  id: number;
  colour: number;
  mode: BallMode;
  body: MatterJS.BodyType;
  x: number; y: number; vx: number; vy: number; // px, px/s
  slot: number;
  offX: number; offY: number; offVX: number; offVY: number; // offset from its cup
  noPull: number;
  attachOrder: number;
  // ballistic flight
  fx0: number; fy0: number; fvx: number; fvy: number; ft: number; fT: number; fg: number;
  target: number;
  purge: boolean;
  dead: boolean;
}

export interface Machine {
  colour: number;
  x: number;
  width: number;
  mouthX: number;
  mouthY: number;
  delivered: number;
  combo: number;
  idle: number;
  suckTimer: number;
  inside: boolean;
  overdriveT: number;
  overdriveFired: boolean;
  purgeLeft: number;
  purgeTimer: number;
  inFlight: number;
  mismatchShown: boolean;
}

export type SimEvent =
  | { type: 'roundStart'; round: number }
  | { type: 'roundGo' }
  | { type: 'drop'; ball: Ball }
  | { type: 'land'; ball: Ball }
  | { type: 'unseat'; ball: Ball }
  | { type: 'attach'; ball: Ball; nx: number; ny: number; count: number }
  | { type: 'full' }
  | { type: 'suck'; ball: Ball; machine: Machine }
  | { type: 'deliver'; ball: Ball; machine: Machine; combo: number; points: number; purge: boolean; progress: number }
  | { type: 'overdrive'; machine: Machine }
  | { type: 'mismatch'; machine: Machine; balls: Ball[] }
  | { type: 'reject'; ball: Ball }
  | { type: 'returned'; ball: Ball }
  | { type: 'queue'; colour: number }
  | { type: 'warn'; level: number }
  | { type: 'fail' }
  | { type: 'clear' }
  | { type: 'celebrate'; ball: Ball; machine: Machine; index: number }
  | { type: 'won' };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Sim {
  readonly world: Phaser.Physics.Matter.World;
  private readonly B: MatterJS.BodyFactory;
  path!: LoopPath;
  balls: Ball[] = [];
  slots: number[] = [];
  slotPts: PathPoint[] = [];
  spacing = 0;
  beltOffset = 0;
  beltSpeedNow = 0;
  private prevInletK = -1;
  inletS = 0;
  inletX = 0;
  inletY = 0;
  hopperTopY = 100;

  phase: Phase = 'intro';
  phaseT = 0;
  roundIndex = 0;
  round!: RoundConfig;
  delivered = 0;
  score = 0;
  private scoreAtRoundStart = 0;
  roundT = 0;
  t = 0;
  hopper: number[] = [];
  private spawnTimer = 0;
  private lastColour = 0;
  machines: Machine[] = [];
  reject = { timer: 0, inside: false };
  magnet: { x: number; y: number; vx: number; vy: number; tx: number; ty: number; body: MatterJS.BodyType };
  hitstop = 0;
  warnLevel = 0;
  private warnTimer = 0;
  private celebrateTimer = 0;
  private celebrateIndex = 0;
  fails = 0;
  clears = 0;
  pauses = 0;  // matter.world.pause() calls (hitstop starts)
  resumes = 0; // matter.world.resume() calls (hitstop ends)
  attachedCount = 0;

  private listeners: ((e: SimEvent) => void)[] = [];
  private nextId = 1;
  private attachCounter = 0;
  private rng: () => number;
  private px = 0;
  private py = 0;
  private magDvx = 0; // puck velocity change this step, carried by the cluster
  private magDvy = 0;

  constructor(private readonly matter: Phaser.Physics.Matter.MatterPhysics) {
    this.world = matter.world;
    this.B = matter.body;
    this.rng = mulberry32(C.seed);
    const body = matter.add.circle(270, 640, C.magnet.radius, {
      density: 0.05,
      frictionAir: 0,
      friction: 0,
      frictionStatic: 0,
      restitution: 0.1,
      collisionFilter: { group: 0, category: CAT_MAGNET, mask: CAT_BALL },
    });
    this.magnet = { x: 270, y: 640, vx: 0, vy: 0, tx: 270, ty: 640, body };
    // caller attaches listeners, then calls startRound(0)
  }

  on(fn: (e: SimEvent) => void) { this.listeners.push(fn); }
  private emit(e: SimEvent) { for (const fn of this.listeners) fn(e); }

  setTarget(x: number, y: number) {
    this.magnet.tx = Phaser.Math.Clamp(x, 20, C.view.width - 20);
    this.magnet.ty = Phaser.Math.Clamp(y, C.magnet.minY, C.magnet.maxY);
  }

  // ---------------------------------------------------------------- rounds
  startRound(i: number) {
    for (const b of this.balls) this.world.remove(b.body);
    this.balls = [];
    if (this.hitstop > 0) { this.hitstop = 0; this.world.resume(); this.resumes++; }
    this.roundIndex = i;
    this.round = C.rounds[i];
    const bc = C.belt;
    this.path = new LoopPath(bc.centerX, bc.centerY, bc.halfStraight, bc.radius);
    const S = this.round.slots;
    this.spacing = this.path.length / S;
    this.slots = new Array(S).fill(0);
    this.slotPts = Array.from({ length: S }, () => ({ x: 0, y: 0, tx: 1, ty: 0 }));
    this.beltOffset = 0;
    this.prevInletK = -1;
    this.inletS = bc.inletAt * 2 * bc.halfStraight;
    const ip = this.path.at(this.inletS);
    this.inletX = ip.x;
    this.inletY = ip.y;
    this.hopper = [];
    this.delivered = 0;
    this.roundT = 0;
    this.phase = 'intro';
    this.phaseT = 0;
    this.spawnTimer = this.round.spawnStart;
    this.lastColour = Math.floor(this.rng() * this.round.colours);
    this.scoreAtRoundStart = this.score;
    this.warnLevel = 0;
    this.attachedCount = 0;
    this.celebrateIndex = 0;

    // machines, shuffled after round 1 so colour is read, not position
    const n = this.round.colours;
    const order = Array.from({ length: n }, (_, k) => k);
    if (i > 0) {
      for (let k = n - 1; k > 0; k--) {
        const j = Math.floor(this.rng() * (k + 1));
        [order[k], order[j]] = [order[j], order[k]];
      }
    }
    const sp = C.view.width / n;
    this.machines = order.map((colour, k) => ({
      colour,
      x: sp * (k + 0.5),
      width: Math.min(150, sp - 16),
      mouthX: sp * (k + 0.5),
      mouthY: C.machine.y - C.machine.height + 4,
      delivered: 0, combo: 0, idle: 0, suckTimer: 0, inside: false,
      overdriveT: 0, overdriveFired: false, purgeLeft: 0, purgeTimer: 0, inFlight: 0, mismatchShown: false,
    }));

    // prefill the belt
    this.beltSpeedNow = 0;
    this.updateSlotPoints();
    const cups = Array.from({ length: S }, (_, k) => k);
    for (let k = S - 1; k > 0; k--) {
      const j = Math.floor(this.rng() * (k + 1));
      [cups[k], cups[j]] = [cups[j], cups[k]];
    }
    const fill = cups.slice(0, Math.round(this.round.prefill * S)).sort((a, b) => a - b);
    for (const k of fill) {
      const p = this.slotPts[k];
      const b = this.makeBall(this.nextColour(), p.x, p.y);
      this.seat(b, k, false);
    }
    const m = this.magnet;
    m.x = m.tx = 270; m.y = m.ty = 640; m.vx = m.vy = 0;
    this.B.setPosition(m.body, { x: m.x, y: m.y }, false);
    this.emit({ type: 'roundStart', round: i });
  }

  tap() {
    if (this.phase === 'failed') {
      this.score = this.scoreAtRoundStart;
      this.startRound(this.roundIndex);
    } else if (this.phase === 'won') {
      this.score = 0;
      this.startRound(0);
    }
  }

  private fail() {
    if (this.phase === 'failed') return;
    this.phase = 'failed';
    this.phaseT = 0;
    this.fails++;
    this.emit({ type: 'fail' });
  }

  // ---------------------------------------------------------------- step
  step() {
    if (this.hitstop > 0) {
      this.hitstop -= DT;
      if (this.hitstop <= 0) {
        this.hitstop = 0;
        this.world.resume(); // transition only, never per frame
        this.resumes++;
      }
      return;
    }
    this.t += DT;
    this.phaseT += DT;
    if (this.phase === 'play') this.roundT += DT;

    this.updatePhase();
    this.updateMagnet();
    this.updateBelt();
    this.updateSpawner();
    this.updateBalls();
    this.updateMachines();
    this.updateReject();
    this.updateCelebrate();

    this.world.step(DT * 1000);

    let anyDead = false;
    for (const b of this.balls) {
      if (b.dead) { anyDead = true; continue; }
      if (b.mode === 'free' || b.mode === 'attached') {
        b.x = b.body.position.x;
        b.y = b.body.position.y;
        b.vx = b.body.velocity.x * 60;
        b.vy = b.body.velocity.y * 60;
      }
    }
    if (anyDead) this.balls = this.balls.filter((b) => !b.dead);

    if (this.phase === 'play' && this.delivered >= this.round.quota) {
      this.phase = 'clear';
      this.phaseT = 0;
      this.clears++;
      this.celebrateTimer = 0.35;
      this.emit({ type: 'clear' });
    }
  }

  get live() { return this.phase === 'play' || this.phase === 'intro'; }

  hitstopFor(ms: number) {
    if (ms <= 0) return;
    if (this.hitstop <= 0) { this.world.pause(); this.pauses++; } // transition only
    this.hitstop = Math.max(this.hitstop, ms / 1000);
  }

  private updatePhase() {
    if (this.phase === 'intro' && this.phaseT >= C.phases.introTime) {
      this.phase = 'play';
      this.phaseT = 0;
      this.emit({ type: 'roundGo' });
    } else if (this.phase === 'clear' && this.phaseT >= C.phases.clearTime) {
      if (this.roundIndex >= C.rounds.length - 1) {
        this.phase = 'won';
        this.phaseT = 0;
        this.emit({ type: 'won' });
      } else {
        this.startRound(this.roundIndex + 1);
      }
    }
  }

  private updateMagnet() {
    const m = this.magnet;
    const mc = C.magnet;
    const ovx = m.vx, ovy = m.vy;
    const ax = mc.followStiffness * (m.tx - m.x) - mc.followDamping * m.vx;
    const ay = mc.followStiffness * (m.ty - m.y) - mc.followDamping * m.vy;
    m.vx += ax * DT;
    m.vy += ay * DT;
    const sp = Math.hypot(m.vx, m.vy);
    if (sp > mc.maxSpeed) { m.vx *= mc.maxSpeed / sp; m.vy *= mc.maxSpeed / sp; }
    m.x += m.vx * DT;
    m.y += m.vy * DT;
    this.magDvx = m.vx - ovx;
    this.magDvy = m.vy - ovy;
    this.B.setPosition(m.body, { x: m.x, y: m.y }, false);
    this.B.setVelocity(m.body, { x: m.vx / 60, y: m.vy / 60 });
  }

  private updateSlotPoints() {
    for (let i = 0; i < this.slots.length; i++) this.path.at(this.beltOffset + i * this.spacing, this.slotPts[i]);
  }

  private updateBelt() {
    const speed = this.phase === 'failed' ? 0 : this.round.beltSpeed * C.belt.speedScale;
    this.beltSpeedNow = speed;
    const L = this.path.length;
    this.beltOffset = (this.beltOffset + speed * DT) % L;
    this.updateSlotPoints();
    const S = this.slots.length;
    const u = (((this.inletS - this.beltOffset) % L) + L) % L;
    const k = Math.floor(u / this.spacing) % S;
    if (this.prevInletK >= 0 && k !== this.prevInletK) {
      const passed = this.prevInletK;
      if (this.slots[passed] === 0 && this.hopper.length > 0 && this.live) this.dropFromHopper(passed);
    }
    this.prevInletK = k;
  }

  private dropFromHopper(slot: number) {
    const colour = this.hopper.shift()!;
    const b = this.makeBall(colour, this.inletX, this.inletY - 30);
    const T = C.hopper.dropTime;
    const p = this.path.at(this.beltOffset + slot * this.spacing + this.beltSpeedNow * T);
    this.launch(b, 'drop', p.x, p.y, T, 2600, -1);
    this.slots[slot] = b.id; // reserve the cup after launch() (launch frees seated cups)
    b.slot = slot;
    this.emit({ type: 'drop', ball: b });
  }

  private nextColour() {
    const n = this.round.colours;
    if (this.rng() >= this.round.sameColourChance) this.lastColour = Math.floor(this.rng() * n);
    return Math.min(this.lastColour, n - 1);
  }

  private updateSpawner() {
    if (this.phase !== 'play') { this.warnLevel = 0; return; }
    this.spawnTimer -= DT;
    if (this.spawnTimer <= 0) {
      const r = this.round;
      const k = Math.min(1, this.roundT / r.rampTime);
      this.spawnTimer += r.spawnStart + (r.spawnEnd - r.spawnStart) * k;
      const colour = this.nextColour();
      this.hopper.push(colour);
      this.emit({ type: 'queue', colour });
      if (this.hopper.length > C.hopper.capacity) { this.fail(); return; }
    }
    const occ = this.occupied() / this.slots.length;
    this.warnLevel = this.hopper.length >= C.hopper.capacity - 1 ? 2 : occ > 0.85 ? 1 : 0;
    this.warnTimer -= DT;
    if (this.warnLevel > 0 && this.warnTimer <= 0) {
      this.warnTimer = this.warnLevel === 2 ? 0.45 : 0.9;
      this.emit({ type: 'warn', level: this.warnLevel });
    }
  }

  occupied() {
    let n = 0;
    for (const s of this.slots) if (s !== 0) n++;
    return n;
  }

  // ---------------------------------------------------------------- balls
  private makeBall(colour: number, x: number, y: number): Ball {
    const body = this.matter.add.circle(x, y, C.ball.radius, {
      frictionAir: C.ball.frictionAir,
      friction: 0,
      frictionStatic: 0,
      restitution: C.ball.restitution,
      collisionFilter: { group: 0, category: CAT_BALL, mask: 0 },
    });
    const b: Ball = {
      id: this.nextId++, colour, mode: 'seated', body,
      x, y, vx: 0, vy: 0, slot: -1, offX: 0, offY: 0, offVX: 0, offVY: 0,
      noPull: 0, attachOrder: 0, fx0: 0, fy0: 0, fvx: 0, fvy: 0, ft: 0, fT: 1, fg: 0,
      target: -1, purge: false, dead: false,
    };
    this.balls.push(b);
    return b;
  }

  private setCollide(b: Ball, on: boolean) {
    b.body.collisionFilter.mask = on ? CAT_MAGNET | CAT_BALL : 0;
    if (on) b.body.frictionAir = C.ball.frictionAir;
  }

  private kill(b: Ball) {
    if (b.dead) return;
    b.dead = true;
    this.world.remove(b.body);
  }

  private seat(b: Ball, slot: number, emit = true) {
    const p = this.slotPts[slot];
    this.slots[slot] = b.id;
    b.slot = slot;
    b.mode = 'seated';
    b.offX = b.x - p.x;
    b.offY = b.y - p.y;
    b.offVX = b.vx - p.tx * this.beltSpeedNow;
    b.offVY = b.vy - p.ty * this.beltSpeedNow;
    this.setCollide(b, false);
    if (emit) this.emit({ type: 'land', ball: b });
  }

  private launch(b: Ball, mode: BallMode, tx: number, ty: number, T: number, g: number, target: number) {
    if (b.mode === 'seated' && b.slot >= 0 && this.slots[b.slot] === b.id) this.slots[b.slot] = 0;
    if (b.mode === 'attached') this.attachedCount--;
    b.mode = mode;
    b.target = target;
    this.setCollide(b, false);
    b.fx0 = b.x; b.fy0 = b.y; b.ft = 0; b.fT = T; b.fg = g;
    b.fvx = (tx - b.x) / T;
    b.fvy = (ty - b.y) / T - 0.5 * g * T;
  }

  /** pull = strength * (1 - d/R)^2 toward the puck; result in this.px/py */
  private pull(x: number, y: number): boolean {
    const m = this.magnet;
    const dx = m.x - x, dy = m.y - y;
    const d = Math.hypot(dx, dy);
    const R = C.magnet.pullRadius;
    if (d >= R || d < 0.001) return false;
    const k = 1 - d / R;
    const f = C.magnet.pullStrength * k * k;
    this.px = (dx / d) * f;
    this.py = (dy / d) * f;
    return true;
  }

  private nearestEmptySlot(x: number, y: number) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i] !== 0) continue;
      const p = this.slotPts[i];
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  private updateBalls() {
    const cap = this.round.capacity;
    const m = this.magnet;
    const attached: Ball[] = [];
    for (const b of this.balls) if (!b.dead && b.mode === 'attached') attached.push(b);
    this.attachedCount = attached.length;
    let pullOn = this.live && attached.length < cap;
    const bc = C.belt, cc = C.cluster, ballc = C.ball;
    const r = ballc.radius;
    const speed = this.beltSpeedNow;

    for (const b of this.balls) {
      if (b.dead) continue;
      switch (b.mode) {
        case 'seated': {
          const p = this.slotPts[b.slot];
          let ax = -bc.gripStiffness * b.offX - bc.gripDamping * b.offVX;
          let ay = -bc.gripStiffness * b.offY - bc.gripDamping * b.offVY;
          if (pullOn && this.pull(p.x + b.offX, p.y + b.offY)) { ax += this.px; ay += this.py; }
          b.offVX += ax * DT; b.offVY += ay * DT;
          b.offX += b.offVX * DT; b.offY += b.offVY * DT;
          b.x = p.x + b.offX; b.y = p.y + b.offY;
          b.vx = p.tx * speed + b.offVX; b.vy = p.ty * speed + b.offVY;
          if (pullOn && Math.hypot(b.offX, b.offY) > bc.breakDistance) {
            this.slots[b.slot] = 0;
            b.slot = -1;
            b.mode = 'free';
            b.noPull = 0;
            this.setCollide(b, true);
            this.B.setPosition(b.body, { x: b.x, y: b.y }, false);
            this.B.setVelocity(b.body, { x: b.vx / 60, y: b.vy / 60 });
            this.emit({ type: 'unseat', ball: b });
          } else {
            this.B.setPosition(b.body, { x: b.x, y: b.y }, false);
            this.B.setVelocity(b.body, { x: 0, y: 0 });
          }
          break;
        }
        case 'free': {
          let ax = 0, ay = 0;
          let pulled = false;
          if (pullOn && this.pull(b.x, b.y)) { ax += this.px; ay += this.py; pulled = true; b.noPull = 0; }
          else b.noPull += DT;
          if (!pulled && b.noPull > ballc.returnDelay) {
            const si = this.nearestEmptySlot(b.x, b.y);
            if (si < 0) {
              if (b.noPull > 1.2) {
                this.launch(b, 'return', this.inletX, this.hopperTopY, C.reject.flightTime, 2600, -1);
                break;
              }
            } else {
              const p = this.slotPts[si];
              const dx = p.x - b.x, dy = p.y - b.y;
              if (Math.hypot(dx, dy) < ballc.seatDistance) { this.seat(b, si); break; }
              ax += ballc.homingStiffness * dx - ballc.homingDamping * (b.vx - p.tx * speed);
              ay += ballc.homingStiffness * dy - ballc.homingDamping * (b.vy - p.ty * speed);
            }
          }
          b.vx += ax * DT; b.vy += ay * DT;
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > ballc.maxSpeed) { b.vx *= ballc.maxSpeed / sp; b.vy *= ballc.maxSpeed / sp; }
          this.B.setVelocity(b.body, { x: b.vx / 60, y: b.vy / 60 });
          if (pullOn) {
            const contact = C.magnet.radius + r + C.magnet.attachSlack;
            let touching = Math.hypot(b.x - m.x, b.y - m.y) < contact;
            if (!touching) {
              const c2 = 2 * r + C.magnet.attachSlack;
              for (const o of attached) {
                if (Math.hypot(b.x - o.x, b.y - o.y) < c2) { touching = true; break; }
              }
            }
            if (touching) {
              b.mode = 'attached';
              b.body.frictionAir = C.cluster.frictionAir;
              b.attachOrder = ++this.attachCounter;
              attached.push(b);
              this.attachedCount = attached.length;
              const d = Math.hypot(b.x - m.x, b.y - m.y) || 1;
              this.emit({ type: 'attach', ball: b, nx: (b.x - m.x) / d, ny: (b.y - m.y) / d, count: attached.length });
              if (attached.length >= cap) { pullOn = false; this.emit({ type: 'full' }); }
            }
          }
          break;
        }
        case 'attached': {
          const dx = b.x - m.x, dy = b.y - m.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d > cc.breakDistance) {
            b.mode = 'free';
            b.noPull = 0;
            b.body.frictionAir = ballc.frictionAir;
            this.attachedCount--;
            break;
          }
          const nx = dx / d, ny = dy / d;
          const r0 = C.magnet.radius + r + cc.restPadding;
          const f = -cc.stiffness * (d - r0);
          // carry most of the puck's acceleration; the spring only does the wobble
          b.vx += cc.carry * this.magDvx + (f * nx - cc.damping * (b.vx - m.vx)) * DT;
          b.vy += cc.carry * this.magDvy + (f * ny - cc.damping * (b.vy - m.vy)) * DT;
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > ballc.maxSpeed) { b.vx *= ballc.maxSpeed / sp; b.vy *= ballc.maxSpeed / sp; }
          this.B.setVelocity(b.body, { x: b.vx / 60, y: b.vy / 60 });
          break;
        }
        default: {
          // ballistic flight: drop / flying / return / celebrate
          b.ft += DT;
          const t = Math.min(b.ft, b.fT);
          b.x = b.fx0 + b.fvx * t;
          b.y = b.fy0 + b.fvy * t + 0.5 * b.fg * t * t;
          b.vx = b.fvx;
          b.vy = b.fvy + b.fg * t;
          this.B.setPosition(b.body, { x: b.x, y: b.y }, false);
          this.B.setVelocity(b.body, { x: 0, y: 0 });
          if (b.ft >= b.fT) this.arrive(b);
        }
      }
    }
  }

  private arrive(b: Ball) {
    switch (b.mode) {
      case 'drop': {
        const p = this.slotPts[b.slot];
        b.mode = 'seated';
        b.offX = b.x - p.x; b.offY = b.y - p.y; b.offVX = 0; b.offVY = 0;
        this.emit({ type: 'land', ball: b });
        break;
      }
      case 'flying':
        this.deliver(b, this.machines[b.target]);
        break;
      case 'return':
        this.kill(b);
        this.hopper.unshift(b.colour);
        this.emit({ type: 'returned', ball: b });
        if (this.phase === 'play' && this.hopper.length > C.hopper.capacity) this.fail();
        break;
      case 'celebrate': {
        this.kill(b);
        const mc = this.machines[b.target];
        if (mc) this.emit({ type: 'celebrate', ball: b, machine: mc, index: this.celebrateIndex++ });
        break;
      }
    }
  }

  // ---------------------------------------------------------------- machines
  private sendToMachine(b: Ball, mi: number, T: number) {
    const mc = this.machines[mi];
    this.launch(b, 'flying', mc.mouthX, mc.mouthY, T, C.machine.flightGravity, mi);
    mc.inFlight++;
  }

  private deliver(b: Ball, mc: Machine) {
    this.kill(b);
    mc.inFlight--;
    mc.combo++;
    mc.delivered++;
    this.delivered++;
    const mult = mc.overdriveT > 0 ? C.overdrive.scoreMult : 1;
    const points = C.score.base * mc.combo * mult;
    this.score += points;
    this.emit({
      type: 'deliver', ball: b, machine: mc, combo: mc.combo, points, purge: b.purge,
      progress: Math.min(1, this.delivered / this.round.quota),
    });
    this.hitstopFor(b.purge ? C.juice.hitstopPurgeMs : C.juice.hitstopMs);
    if (!b.purge && !mc.overdriveFired && mc.combo >= C.overdrive.count) {
      mc.overdriveFired = true;
      mc.overdriveT = C.overdrive.duration;
      mc.purgeLeft = C.overdrive.purgeMax;
      mc.purgeTimer = 0.3;
      this.score += C.overdrive.bonus;
      this.emit({ type: 'overdrive', machine: mc });
      this.hitstopFor(C.juice.hitstopOverdriveMs);
    }
  }

  private updateMachines() {
    const m = this.magnet;
    const mcfg = C.machine;
    for (let i = 0; i < this.machines.length; i++) {
      const mc = this.machines[i];
      mc.overdriveT = Math.max(0, mc.overdriveT - DT);
      const inside = this.live && Math.hypot(m.x - mc.mouthX, m.y - mc.mouthY) < mcfg.intakeRadius;
      if (!inside) { mc.inside = false; mc.mismatchShown = false; }
      if (inside) {
        mc.inside = true;
        mc.suckTimer -= DT;
        let best: Ball | null = null, bd = Infinity, odd = 0;
        for (const b of this.balls) {
          if (b.dead || b.mode !== 'attached') continue;
          if (b.colour !== mc.colour) { odd++; continue; }
          const d = Math.hypot(b.x - mc.mouthX, b.y - mc.mouthY);
          if (d < bd) { bd = d; best = b; }
        }
        if (best && mc.suckTimer <= 0) {
          const T = Math.min(0.5, mcfg.flightBase + bd * mcfg.flightPerPx);
          this.sendToMachine(best, i, T);
          mc.suckTimer = mcfg.suckInterval;
          this.emit({ type: 'suck', ball: best, machine: mc });
        } else if (!best) {
          mc.suckTimer = Math.max(mc.suckTimer, 0);
          if (odd > 0 && !mc.mismatchShown && mc.inFlight === 0) {
            mc.mismatchShown = true;
            const oddBalls = this.balls.filter((b) => !b.dead && b.mode === 'attached' && b.colour !== mc.colour);
            this.emit({ type: 'mismatch', machine: mc, balls: oddBalls });
          }
        }
      }
      // feed session: combo survives while feeding, resets after a short gap
      if (inside || mc.inFlight > 0 || mc.purgeLeft > 0) mc.idle = 0;
      else {
        mc.idle += DT;
        if (mc.idle > mcfg.feedGap) { mc.combo = 0; mc.overdriveFired = false; }
      }
      // OVERDRIVE purge: vacuum this colour off the belt
      if (mc.purgeLeft > 0 && this.phase !== 'failed') {
        mc.purgeTimer -= DT;
        if (mc.purgeTimer <= 0) {
          let best: Ball | null = null, bd = Infinity;
          for (const b of this.balls) {
            if (b.dead || b.mode !== 'seated' || b.colour !== mc.colour) continue;
            const d = Math.hypot(b.x - mc.mouthX, b.y - mc.mouthY);
            if (d < bd) { bd = d; best = b; }
          }
          if (best) {
            best.purge = true;
            this.sendToMachine(best, i, C.overdrive.purgeFlight);
            mc.purgeLeft--;
            mc.purgeTimer = C.overdrive.purgeInterval;
          } else mc.purgeLeft = 0;
        }
      }
    }
  }

  /** colour the REJECT pad keeps: majority, ties go to the colour stuck first */
  keepColour(): number {
    const counts = new Map<number, { n: number; first: number }>();
    for (const b of this.balls) {
      if (b.dead || b.mode !== 'attached') continue;
      const c = counts.get(b.colour);
      if (c) { c.n++; c.first = Math.min(c.first, b.attachOrder); }
      else counts.set(b.colour, { n: 1, first: b.attachOrder });
    }
    let keep = -1, bn = -1, bf = Infinity;
    for (const [colour, c] of counts) {
      if (c.n > bn || (c.n === bn && c.first < bf)) { keep = colour; bn = c.n; bf = c.first; }
    }
    return keep;
  }

  private updateReject() {
    const m = this.magnet;
    const rc = C.reject;
    const inside = this.live && Math.hypot(m.x - rc.x, m.y - rc.y) < rc.radius;
    this.reject.inside = inside;
    if (!inside) { this.reject.timer = 0.06; return; }
    this.reject.timer -= DT;
    if (this.reject.timer > 0) return;
    const keep = this.keepColour();
    let pick: Ball | null = null, bd = -1;
    for (const b of this.balls) {
      if (b.dead || b.mode !== 'attached' || b.colour === keep) continue;
      const d = Math.hypot(b.x - m.x, b.y - m.y);
      if (d > bd) { bd = d; pick = b; }
    }
    if (!pick) { this.reject.timer = 0.06; return; }
    // toss it back into the nearest empty cup; only a full belt sends it to the hopper
    const si = this.nearestEmptySlot(pick.x, pick.y);
    if (si >= 0) {
      const p = this.path.at(this.beltOffset + si * this.spacing + this.beltSpeedNow * rc.flightTime);
      this.launch(pick, 'drop', p.x, p.y, rc.flightTime, 2600, -1);
      this.slots[si] = pick.id;
      pick.slot = si;
    } else {
      this.launch(pick, 'return', this.inletX, this.hopperTopY, rc.flightTime, 2600, -1);
    }
    this.score = Math.max(0, this.score - rc.penalty);
    this.reject.timer = rc.interval;
    this.emit({ type: 'reject', ball: pick });
  }

  private updateCelebrate() {
    if (this.phase !== 'clear') return;
    this.celebrateTimer -= DT;
    if (this.celebrateTimer > 0) return;
    this.celebrateTimer = C.phases.celebrateInterval;
    for (const b of this.balls) {
      if (b.dead || !(b.mode === 'seated' || b.mode === 'attached' || b.mode === 'free')) continue;
      const mi = this.machines.findIndex((mc) => mc.colour === b.colour);
      if (mi < 0) continue;
      this.launch(b, 'celebrate', this.machines[mi].mouthX, this.machines[mi].mouthY, 0.5, 2600, mi);
      return;
    }
  }

  // ---------------------------------------------------------------- test hook
  snapshot() {
    const cluster = this.balls.filter((b) => !b.dead && b.mode === 'attached');
    return {
      phase: this.phase,
      round: this.roundIndex + 1,
      rounds: C.rounds.length,
      roundName: this.round.name,
      t: +this.t.toFixed(3),
      roundTime: +this.roundT.toFixed(3),
      delivered: this.delivered,
      quota: this.round.quota,
      score: this.score,
      hitstop: this.hitstop,
      belt: { slots: this.slots.length, occupied: this.occupied(), speed: this.beltSpeedNow },
      hopper: { queue: this.hopper.length, cap: C.hopper.capacity },
      magnet: { x: this.magnet.x, y: this.magnet.y, tx: this.magnet.tx, ty: this.magnet.ty },
      cluster: { count: cluster.length, cap: this.round.capacity, colours: cluster.map((b) => b.colour), keep: this.keepColour() },
      machines: this.machines.map((mc) => ({
        colour: mc.colour, x: mc.mouthX, y: mc.mouthY, delivered: mc.delivered, combo: mc.combo,
        overdrive: mc.overdriveT > 0, inside: mc.inside,
      })),
      reject: { x: C.reject.x, y: C.reject.y, radius: C.reject.radius },
      intakeRadius: C.machine.intakeRadius,
      balls: this.balls.filter((b) => !b.dead).map((b) => ({ id: b.id, colour: b.colour, mode: b.mode, x: Math.round(b.x), y: Math.round(b.y) })),
      fails: this.fails,
      clears: this.clears,
      pauses: this.pauses,
      resumes: this.resumes,
      worldEnabled: this.world.enabled,
    };
  }
}
