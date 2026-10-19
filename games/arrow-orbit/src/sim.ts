// Rapier world + run logic. No DOM, no Three.js, so it runs headless in validate/inspect.
import RAPIER from '@dimforge/rapier3d-compat';
import {
  DT, GRAVITY, LAUNCH_ANGLE_DEG, LAUNCH_TAIL, MAX_RUN_STEPS, BOUNDS, SEG_LEN, SHAFT_RADIUS, HEAD_RADIUS,
  SHAFT_DENSITY, HEAD_DENSITY, ARROW_FRICTION, BEND_K, BEND_C, BEND_LIMIT, BEND_LIMIT_K, FLETCH_ALIGN, BEND_HARD, AIR_DRAG,
  CRATE_SIZE, CRATE_DENSITY, SHATTER_CRATE, SHATTER_BARREL, SHATTER_SHARE, RAMP_H, PAD_H, BARREL_RADIUS, BARREL_HALF_H, BARREL_DENSITY, SMASH_SPEED, COMBO_WINDOW_STEPS,
  Levels, launchSpeed, arrowRestitution, padBoost, segmentCount, coinsForDistance, coinsForSmash,
} from './config';
import { Course, Feature } from './course';

export { RAPIER };

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

// Collision groups: arrow segments never collide with each other (adjacent ones overlap at the joint).
const G_WORLD = 0x0001;
const G_ARROW = 0x0002;
const WORLD_GROUPS = (G_WORLD << 16) | 0xffff;
const ARROW_GROUPS = (G_ARROW << 16) | (0xffff & ~G_ARROW);

export type SimEvent =
  | { t: 'launch'; x: number; y: number; speed: number }
  | { t: 'impact'; x: number; y: number; s: number }
  | { t: 'smash'; x: number; y: number; color: number; combo: number; coins: number; kind: 'crate' | 'barrel'; burst: boolean }
  | { t: 'pad'; x: number; y: number; id: number }
  | { t: 'nearmiss'; x: number; y: number }
  | { t: 'oob'; x: number; y: number; what: 'arrow' | 'body' }
  | { t: 'stop'; reason: string };

export interface DynObj {
  kind: 'crate' | 'barrel';
  body: RAPIER.RigidBody;
  color: number;
  feature: number;
  smashed: boolean;
  shattered: boolean;
  alive: boolean;
}

export interface PadObj {
  id: number;
  x: number;
  y: number;
  handle: number;
  cooldown: number;
}

export interface RunResult {
  distance: number;
  smashed: number;
  maxCombo: number;
  coinsDistance: number;
  coinsDestruction: number;
  total: number;
  reason: string;
  steps: number;
}

export type Phase = 'ready' | 'flying' | 'done';

const quatZ = (a: number) => ({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) });
const angleOf = (q: { z: number; w: number }) => 2 * Math.atan2(q.z, q.w);
const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export class Sim {
  readonly world: RAPIER.World;
  readonly course: Course;
  readonly levels: Levels;
  readonly nSeg: number;
  readonly eq: RAPIER.EventQueue;
  arrow: RAPIER.RigidBody[] = [];
  private inertia: number[] = [];
  arrowAlive = false;
  objs: DynObj[] = [];
  pads: PadObj[] = [];
  phase: Phase = 'ready';
  events: SimEvent[] = [];

  stepCount = 0;
  flightSteps = 0;
  maxX = 0;
  headX = 0;
  headY = 0;
  smashed = 0;
  combo = 0;
  maxCombo = 0;
  lastSmashStep = -1e9;
  coinsDestruction = 0;
  result: RunResult | null = null;
  guardKills = 0;
  maxStepMs = 0;
  maxAbsZ = 0;
  shaftClamps = 0;
  launchSpeedUsed = 0;

  private padByHandle = new Map<number, PadObj>();
  private objIdx = new Map<number, number>();
  private preV: { x: number; y: number; z: number }[] = [];
  private arrowMass = 1;
  private arrowHandles = new Set<number>();
  private touched = new Set<number>();
  private prevV = { x: 0, y: 0 };
  private lastImpactStep = -1e9;
  private stillSteps = 0;
  private watchX = 0;
  private watchStep = 0;

  constructor(course: Course, levels: Levels) {
    this.course = course;
    this.levels = { ...levels };
    this.nSeg = segmentCount(levels.length);
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = DT;
    this.eq = new RAPIER.EventQueue(true);
    this.buildStatic();
    this.buildStacks();
  }

  // ---------- construction ----------
  private buildStatic(): void {
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const pts = this.course.pts;
    const HT = 1.5;
    // merge runs of equal slope into one cuboid
    let i = 0;
    while (i < pts.length - 1) {
      const a = pts[i];
      const s0 = (pts[i + 1].y - a.y) / (pts[i + 1].x - a.x);
      let j = i + 1;
      while (j < pts.length - 1 && Math.abs((pts[j + 1].y - pts[j].y) / (pts[j + 1].x - pts[j].x) - s0) < 1e-9) j++;
      const b = pts[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      const desc = RAPIER.ColliderDesc.cuboid(len / 2 + 0.02, HT, 3)
        .setTranslation((a.x + b.x) / 2 - nx * HT, (a.y + b.y) / 2 - ny * HT, 0)
        .setRotation(quatZ(ang))
        .setFriction(0.7)
        .setCollisionGroups(WORLD_GROUPS);
      this.world.createCollider(desc, ground);
      i = j;
    }
    // back wall behind the launcher, so nothing tumbles off the start
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 30, 3).setTranslation(-41, 30, 0).setCollisionGroups(WORLD_GROUPS),
      ground,
    );
    for (const f of this.course.features) {
      if (f.type === 'pad') {
        // trapezoid with 22 deg sides: a sliding arrow rides onto it instead of hitting a wall
        const hp: number[] = [];
        for (const z of [-2, 2]) hp.push(f.x - 2.6, f.y - 0.2, z, f.x + 2.6, f.y - 0.2, z, f.x + 1.6, f.y + PAD_H, z, f.x - 1.6, f.y + PAD_H, z);
        const c = this.world.createCollider(
          RAPIER.ColliderDesc.convexHull(new Float32Array(hp))!
            .setFriction(0.3)
            .setCollisionGroups(WORLD_GROUPS)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          ground,
        );
        const pad: PadObj = { id: f.id, x: f.x, y: f.y + PAD_H, handle: c.handle, cooldown: 0 };
        this.pads.push(pad);
        this.padByHandle.set(c.handle, pad);
      } else if (f.type === 'ramp') {
        const x0 = f.x - 0.5;
        const x1 = f.x + 7.2;
        const y = f.y;
        const p: number[] = [];
        for (const z of [-2, 2]) p.push(x0, y - 0.6, z, x1, y - 0.6, z, x1, y + RAMP_H, z, x0, y + 0.0, z);
        const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(p));
        if (desc) this.world.createCollider(desc.setFriction(0.1).setCollisionGroups(WORLD_GROUPS), ground);
      }
    }
  }

  private buildStacks(): void {
    for (const f of this.course.features) {
      if (f.type !== 'crates' && f.type !== 'barrels') continue;
      for (const c of f.cells) {
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(f.x + c.x, f.y + c.y, 0)
            .enabledRotations(false, false, true)
            .setSleeping(true)
            .setLinearDamping(0.05)
            .setAngularDamping(0.2),
        );
        const desc =
          f.type === 'crates'
            ? RAPIER.ColliderDesc.cuboid(CRATE_SIZE / 2, CRATE_SIZE / 2, CRATE_SIZE / 2).setDensity(CRATE_DENSITY)
            : RAPIER.ColliderDesc.cylinder(BARREL_HALF_H, BARREL_RADIUS).setDensity(BARREL_DENSITY);
        const col = this.world.createCollider(desc.setFriction(0.6).setCollisionGroups(WORLD_GROUPS), body);
        this.objIdx.set(col.handle, this.objs.length);
        this.objs.push({ kind: f.type === 'crates' ? 'crate' : 'barrel', body, color: f.color, feature: f.id, smashed: false, shattered: false, alive: true });
      }
    }
    // New contact pairs wake everything on the first step. Let the narrow phase find the
    // resting contacts once, then put every stack back to sleep until the arrow arrives.
    this.world.step(this.eq);
    this.eq.clear();
    for (const o of this.objs) {
      o.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      o.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      o.body.sleep();
    }
  }

  /** Where each segment sits on the launcher before release (index 0 = head). */
  restPose(pull = 0): { x: number; y: number; a: number }[] {
    const a = (LAUNCH_ANGLE_DEG * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const out: { x: number; y: number; a: number }[] = [];
    for (let i = 0; i < this.nSeg; i++) {
      const d = (this.nSeg - 1 - i + 0.5) * SEG_LEN - pull;
      out.push({ x: LAUNCH_TAIL.x + dx * d, y: LAUNCH_TAIL.y + dy * d, a });
    }
    return out;
  }

  launch(meter: number, perfect: boolean): void {
    if (this.phase !== 'ready') return;
    const ang = (LAUNCH_ANGLE_DEG * Math.PI) / 180;
    const speed = launchSpeed(this.levels.power, meter, perfect);
    this.launchSpeedUsed = speed;
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;
    const e = arrowRestitution(this.levels.bounce);
    const pose = this.restPose();
    for (let i = 0; i < this.nSeg; i++) {
      const head = i === 0;
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pose[i].x, pose[i].y, 0)
        .setRotation(quatZ(ang))
        .setLinvel(vx, vy, 0)
        .enabledRotations(false, false, true)
        .setLinearDamping(0.015)
        .setAngularDamping(0.3);
      // Hard CCD on the head only; hard CCD on every jointed body is a perf disaster.
      if (head) desc.setCcdEnabled(true);
      else desc.setSoftCcdPrediction(1.4);
      const body = this.world.createRigidBody(desc);
      const r = head ? HEAD_RADIUS : SHAFT_RADIUS;
      const col = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(SEG_LEN / 2 - r, r)
          .setRotation(quatZ(Math.PI / 2))
          .setDensity(head ? HEAD_DENSITY : SHAFT_DENSITY)
          .setFriction(ARROW_FRICTION)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setRestitution(e)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setCollisionGroups(ARROW_GROUPS)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      this.arrowHandles.add(col.handle);
      this.arrow.push(body);
      const pi = body.principalInertia();
      const fallback = (head ? 2.05 : 1.0) * (SEG_LEN * SEG_LEN) / 12;
      this.inertia.push(Math.max(pi.x, pi.y, pi.z) || fallback);
    }
    // Spherical joints. With rotations locked to Z they behave exactly like a revolute,
    // without the redundant constraint that made revolute + locked rotations singular.
    for (let i = 0; i < this.nSeg - 1; i++) {
      const jd = RAPIER.JointData.spherical({ x: -SEG_LEN / 2, y: 0, z: 0 }, { x: SEG_LEN / 2, y: 0, z: 0 });
      this.world.createImpulseJoint(jd, this.arrow[i], this.arrow[i + 1], true);
    }
    this.arrowMass = this.arrow.reduce((m, b) => m + b.mass(), 0);
    this.arrowAlive = true;
    this.phase = 'flying';
    this.prevV = { x: vx, y: vy };
    this.headX = pose[0].x;
    this.headY = pose[0].y;
    this.maxX = Math.max(0, this.headX);
    this.watchX = this.maxX;
    this.watchStep = 0;
    this.events.push({ t: 'launch', x: pose[0].x, y: pose[0].y, speed });
  }

  // ---------- stepping ----------
  step(): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const live = this.arrowAlive && this.phase === 'flying';
    if (this.arrowAlive) this.applyArrowForces();
    if (live) for (let i = 0; i < this.arrow.length; i++) this.preV[i] = { ...this.arrow[i].linvel() };
    this.world.step(this.eq);
    if (this.arrowAlive) this.clampShaft();
    let pad: PadObj | null = null;
    const hits: DynObj[] = [];
    this.eq.drainCollisionEvents((h1, h2, started) => {
      if (!started || !live) return;
      const a1 = this.arrowHandles.has(h1);
      const a2 = this.arrowHandles.has(h2);
      if (a1 === a2) return;
      const other = a1 ? h2 : h1;
      const p = this.padByHandle.get(other);
      if (p && p.cooldown <= 0) pad = p;
      const oi = this.objIdx.get(other);
      const o = oi === undefined ? undefined : this.objs[oi];
      if (o && o.alive && !hits.includes(o)) hits.push(o);
    });
    if (hits.length) this.shatter(hits);
    if (pad) {
      const p: PadObj = pad;
      p.cooldown = 30;
      const boost = padBoost(this.levels.bounce);
      for (const b of this.arrow) {
        const v = b.linvel();
        b.setLinvel({ x: Math.min(110, Math.max(v.x, 10) * boost.vxMul), y: Math.max(v.y, boost.vy), z: 0 }, true);
      }
      this.events.push({ t: 'pad', x: p.x, y: p.y, id: p.id });
    }
    for (const p of this.pads) if (p.cooldown > 0) p.cooldown--;
    this.guard();
    if (this.phase === 'flying') this.track(pad !== null);
    this.stepCount++;
    if (t0) {
      const ms = performance.now() - t0;
      if (ms > this.maxStepMs) this.maxStepMs = ms;
    }
  }

  /**
   * Hand-written angular springs between segments (stiffness + bend limit), solved
   * implicitly so a stiff shaft stays stable at 60 Hz, plus fletching alignment in the air.
   */
  private applyArrowForces(): void {
    const n = this.arrow.length;
    for (let i = 0; i < n - 1; i++) {
      const a = this.arrow[i];
      const b = this.arrow[i + 1];
      const d = wrap(angleOf(b.rotation()) - angleOf(a.rotation()));
      const w = b.angvel().z - a.angvel().z;
      const over = Math.abs(d) - BEND_LIMIT;
      let k = BEND_K;
      let target = BEND_K * d; // spring "force" k * theta
      if (over > 0) {
        k += BEND_LIMIT_K;
        target += BEND_LIMIT_K * over * Math.sign(d);
      }
      const iRel = 1 / (1 / this.inertia[i] + 1 / this.inertia[i + 1]);
      // implicit Euler: w' = (w - dt * F / I) / (1 + dt c / I + dt^2 k / I)
      const wNew = (w - (DT * target) / iRel) / (1 + (DT * BEND_C) / iRel + (DT * DT * k) / iRel);
      const j = iRel * (wNew - w);
      b.applyTorqueImpulse({ x: 0, y: 0, z: j }, true);
      a.applyTorqueImpulse({ x: 0, y: 0, z: -j }, true);
    }
    // Air drag on the whole shaft: same frontal area at any LENGTH, so a longer (heavier)
    // arrow keeps its speed better. Sectional density, like real flight arrows.
    for (const sgm of this.arrow) {
      const v = sgm.linvel();
      const sp = Math.hypot(v.x, v.y);
      const k = Math.min(0.5, (AIR_DRAG * sp * DT * sgm.mass()) / this.arrowMass); // never reverses
      sgm.applyImpulse({ x: -v.x * k, y: -v.y * k, z: 0 }, true);
    }
    // Fletching: in the air the whole shaft turns into its velocity, like a real arrow.
    const head = this.arrow[0];
    const tail = this.arrow[n - 1];
    const hp = head.translation();
    const tp = tail.translation();
    const g = this.course.groundY;
    if (hp.y - g(hp.x) < 1.6 || tp.y - g(tp.x) < 1.2) return;
    let vx = 0;
    let vy = 0;
    for (const s of this.arrow) {
      const v = s.linvel();
      vx += v.x;
      vy += v.y;
    }
    const sp = Math.hypot(vx, vy) / n;
    if (sp < 8) return;
    const err = wrap(Math.atan2(vy, vx) - Math.atan2(hp.y - tp.y, hp.x - tp.x));
    const wT = FLETCH_ALIGN * err;
    for (const s of this.arrow) {
      const wz = s.angvel().z;
      s.setAngvel({ x: 0, y: 0, z: wz + (wT - wz) * 0.25 }, true);
    }
  }

  /**
   * Crates (and barrels, harder) burst when the arrow hits them fast enough. The arrow keeps
   * its pre-impact velocity minus a momentum share, so a heavier (longer) arrow sweeps
   * through a stack instead of stopping dead against it.
   */
  private shatter(hits: DynObj[]): void {
    const head = this.preV[0];
    let keep = 1;
    for (const o of hits) {
      const ov = o.body.linvel();
      const rel = Math.hypot(head.x - ov.x, head.y - ov.y);
      // momentum, not speed: a longer (heavier) shaft bursts crates it would otherwise just push
      if (rel * this.arrowMass < (o.kind === 'crate' ? SHATTER_CRATE : SHATTER_BARREL)) continue;
      const p = o.body.translation();
      const m = o.body.mass();
      keep *= this.arrowMass / (this.arrowMass + m * SHATTER_SHARE);
      this.world.removeRigidBody(o.body);
      o.alive = false;
      o.shattered = true;
      if (!o.smashed) this.addSmash(o, p.x, p.y, true);
      for (const n of this.objs) if (n.alive && n.feature === o.feature) n.body.wakeUp();
    }
    if (keep < 1) {
      for (let i = 0; i < this.arrow.length; i++) {
        const v = this.preV[i];
        this.arrow[i].setLinvel({ x: v.x * keep, y: v.y * keep, z: 0 }, true);
      }
    }
  }

  private addSmash(o: DynObj, x: number, y: number, burst: boolean): void {
    o.smashed = true;
    this.touched.add(o.feature);
    this.combo = this.stepCount - this.lastSmashStep <= COMBO_WINDOW_STEPS ? this.combo + 1 : 1;
    this.lastSmashStep = this.stepCount;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const coins = coinsForSmash(this.combo);
    this.coinsDestruction += coins;
    this.smashed++;
    this.events.push({ t: 'smash', x, y, color: o.color, combo: this.combo, coins, kind: o.kind, burst });
  }

  /**
   * Hard bend limit, enforced on positions after the step (head to tail). Springs alone
   * cannot stop a 10-body chain from buckling into a zigzag when it slams into the turf.
   */
  private clampShaft(): void {
    const n = this.arrow.length;
    for (let i = 0; i < n - 1; i++) {
      const a = this.arrow[i];
      const b = this.arrow[i + 1];
      const aa = angleOf(a.rotation());
      const ba = angleOf(b.rotation());
      const d = wrap(ba - aa);
      if (Math.abs(d) <= BEND_HARD) continue;
      this.shaftClamps++;
      // inelastic stop: the pair stops opening further (no energy added)
      const wa = a.angvel().z;
      const wb = b.angvel().z;
      if ((wb - wa) * d > 0) {
        const ia = this.inertia[i];
        const ib = this.inertia[i + 1];
        const w = (ia * wa + ib * wb) / (ia + ib);
        a.setAngvel({ x: 0, y: 0, z: w }, true);
        b.setAngvel({ x: 0, y: 0, z: w }, true);
      }
      // split the excess rotation between both bodies; the joint pulls the anchors back
      // softly (teleporting segments onto the anchor injected energy and kicked the tail)
      const ex = (d - Math.sign(d) * BEND_HARD) * 0.5;
      a.setRotation(quatZ(aa + ex), true);
      b.setRotation(quatZ(ba - ex), true);
    }
  }

  /**
   * Sanity check + keep the body on the z = 0 plane. Translation Z is NOT locked on purpose:
   * locking translation Z together with rotations X/Y makes the friction block singular in
   * this Rapier build (friction silently drops to zero), so Z is projected here instead.
   */
  private sane(b: RAPIER.RigidBody): boolean {
    const p = b.translation();
    const v = b.linvel();
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return false;
    if (p.x < BOUNDS.minX || p.x > BOUNDS.maxX || p.y < BOUNDS.minY || p.y > BOUNDS.maxY) return false;
    if (v.x * v.x + v.y * v.y > BOUNDS.maxSpeed * BOUNDS.maxSpeed) return false;
    if (Math.abs(p.z) > 1e-3) b.setTranslation({ x: p.x, y: p.y, z: 0 }, false);
    if (Math.abs(v.z) > 1e-3) b.setLinvel({ x: v.x, y: v.y, z: 0 }, false);
    if (Math.abs(p.z) > this.maxAbsZ) this.maxAbsZ = Math.abs(p.z);
    return true;
  }

  /** Kill anything that left sane coordinates before the broad phase has to span it. */
  private guard(): void {
    if (this.arrowAlive) {
      for (const b of this.arrow) {
        if (!this.sane(b)) {
          this.killArrow();
          break;
        }
      }
    }
    for (const o of this.objs) {
      if (!o.alive || o.body.isSleeping()) continue;
      if (!this.sane(o.body)) {
        const p = o.body.translation();
        this.events.push({ t: 'oob', x: p.x, y: p.y, what: 'body' });
        this.world.removeRigidBody(o.body);
        o.alive = false;
        this.guardKills++;
      }
    }
  }

  private killArrow(): void {
    this.events.push({ t: 'oob', x: this.headX, y: this.headY, what: 'arrow' });
    for (const b of this.arrow) this.world.removeRigidBody(b);
    this.arrow = [];
    this.arrowAlive = false;
    this.guardKills++;
    if (this.phase === 'flying') this.finish('oob');
  }

  private track(padHit: boolean): void {
    this.flightSteps++;
    if (!this.arrowAlive) return;
    const head = this.arrow[0];
    const p = head.translation();
    const v = head.linvel();
    const prevX = this.headX;
    this.headX = p.x;
    this.headY = p.y;
    if (p.x > this.maxX) this.maxX = p.x;

    const dv = Math.hypot(v.x - this.prevV.x, v.y - this.prevV.y);
    this.prevV = { x: v.x, y: v.y };
    if (!padHit && dv > 5 && this.stepCount - this.lastImpactStep > 8) {
      this.lastImpactStep = this.stepCount;
      this.events.push({ t: 'impact', x: p.x, y: p.y, s: dv });
    }

    // smashes (deterministic: decided inside the fixed step)
    for (const o of this.objs) {
      if (!o.alive || o.smashed || o.body.isSleeping()) continue;
      const ov = o.body.linvel();
      if (ov.x * ov.x + ov.y * ov.y > SMASH_SPEED * SMASH_SPEED || Math.abs(o.body.angvel().z) > 3) {
        const op = o.body.translation();
        this.addSmash(o, op.x, op.y, false);
      }
    }

    // near miss: head skims over an untouched stack
    for (const f of this.course.features) {
      if ((f.type !== 'crates' && f.type !== 'barrels') || this.touched.has(f.id)) continue;
      if (prevX < f.x && p.x >= f.x) {
        const clear = p.y - (f.y + f.top);
        if (clear > 0.15 && clear < 1.8) this.events.push({ t: 'nearmiss', x: p.x, y: p.y });
      }
    }

    // stop detection
    let maxSeg = 0;
    for (const b of this.arrow) {
      const bv = b.linvel();
      maxSeg = Math.max(maxSeg, bv.x * bv.x + bv.y * bv.y);
    }
    const headSp = Math.hypot(v.x, v.y);
    // Rolling backwards reads as a bug in a distance game. A slow arrow on the ground that
    // starts going back (up a ramp, off a stack) digs its head in and the run ends there.
    if (v.x < -0.3 && headSp < 4 && this.flightSteps > 30 && p.y - this.course.groundY(p.x) < 2.6) return this.finish('stuck');
    this.stillSteps = headSp < 1.2 && maxSeg < 4 ? this.stillSteps + 1 : 0;
    if (this.stillSteps >= 36) return this.finish('stopped');
    // progress watchdog: crawling or rocking in a dip for 1.5 s ends the run
    if (++this.watchStep >= 90) {
      if (this.maxX - this.watchX < 0.8) return this.finish('stalled');
      this.watchX = this.maxX;
      this.watchStep = 0;
    }
    if (this.flightSteps >= MAX_RUN_STEPS) this.finish('timeout');
  }

  private finish(reason: string): void {
    if (this.phase !== 'flying') return;
    this.phase = 'done';
    if (this.arrowAlive && reason !== 'timeout') {
      // the head bites into the ground: freeze the shaft where it stopped
      for (const b of this.arrow) {
        b.setLinvel({ x: 0, y: 0, z: 0 }, false);
        b.setAngvel({ x: 0, y: 0, z: 0 }, false);
        b.setBodyType(RAPIER.RigidBodyType.Fixed, false);
      }
    }
    const distance = Math.max(0, Math.floor(this.maxX));
    const cd = coinsForDistance(distance);
    this.result = {
      distance,
      smashed: this.smashed,
      maxCombo: this.maxCombo,
      coinsDistance: cd,
      coinsDestruction: this.coinsDestruction,
      total: cd + this.coinsDestruction,
      reason,
      steps: this.flightSteps,
    };
    this.events.push({ t: 'stop', reason });
  }

  /** Run to completion headless. */
  runToEnd(maxSteps = MAX_RUN_STEPS + 60): RunResult | null {
    let n = 0;
    while (this.phase === 'flying' && n++ < maxSteps) this.step();
    return this.result;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  arrowColliderCount(): number {
    let n = 0;
    for (const b of this.arrow) n += b.numColliders();
    return n;
  }

  featureOf(id: number): Feature | undefined {
    return this.course.features[id];
  }

  dispose(): void {
    this.eq.free();
    this.world.free();
  }
}
