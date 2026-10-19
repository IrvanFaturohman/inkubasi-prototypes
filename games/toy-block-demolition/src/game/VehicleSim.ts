import type { BlockField } from './BlockField';
import { GRID, VEHICLE } from './config';
import { clamp, damp, wrapAngle } from './util';

export interface DriveInput {
  /** Unit direction in screen space (x right, y down). */
  x: number;
  y: number;
  /** 0..1 throttle. */
  mag: number;
}

export interface Pose {
  x: number;
  z: number;
  h: number;
}

export interface StaticBox {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Optional opening in the southern edge (the next-area gate). */
  gateOpen: boolean;
  gateMinX: number;
  gateMaxX: number;
}

export interface CollisionWorld {
  field: BlockField;
  statics: StaticBox[];
  bounds: WorldBounds;
}

interface Circle {
  lx: number;
  lz: number;
  r: number;
}

/**
 * Kinematic arcade vehicle. Heading turns quickly toward the input direction,
 * speed ramps over ~140 ms, and collisions are resolved as a small set of
 * circles against intact cells, depot equipment and world bounds.
 *
 * Forward is local +Z; world forward = (sin h, cos h).
 */
export class VehicleSim {
  x = 0;
  z = 0;
  h = Math.PI;
  prevX = 0;
  prevZ = 0;
  prevH = Math.PI;

  /** Signed speed along heading (negative when reversing). */
  speed = 0;
  /** Actual velocity after collision, world units/s. */
  vx = 0;
  vz = 0;
  /** Signed distance travelled along the heading (drives wheel rotation). */
  odometer = 0;
  yawRate = 0;
  throttle = 0;
  /** K-turn reverse (target is behind and the body can't pivot). */
  reversing = false;
  /** Backing out along the recorded track (auto-unstick). */
  retracing = false;
  private reverseDist = 0;
  private blockedTime = 0;
  /** Time the body has been unable to rotate toward the input. */
  private turnStuck = 0;
  private reverseStall = 0;
  /** Net-progress window: position samples every 0.1 s. */
  private readonly trail: number[] = [];
  private trailClock = 0;
  private sinceCrush = 99;
  /**
   * Breadcrumbs of recent valid poses (x, z, h triples). Blocks never come
   * back, so every recorded pose stays collision-free: retracing them is a
   * guaranteed way out of any pocket the truck drove into.
   */
  private readonly crumbs: number[] = [];
  private crumbDist = 0;
  private retraceLeft = 0;
  /**
   * Consecutive retraces back out twice as far each time; the streak only
   * resets once the truck has really left the spot. Worst case it retraces its
   * whole recorded track, so it can never stay trapped.
   */
  private retraceStreak = 0;
  private sinceRetrace = 99;
  private retraceOriginX = 0;
  private retraceOriginZ = 0;
  /** Ideal point on the recorded track while retracing. */
  private trackX = 0;
  private trackZ = 0;
  private trackH = 0;

  /** Diagnostics for tests/debug overlays. */
  readonly stats = { retraces: 0, maxStreak: 0 };
  get crumbCount(): number {
    return this.crumbs.length / 3;
  }

  rollerWidth: number = 1.45;
  private circles: Circle[] = [];

  constructor() {
    this.setRollerWidth(this.rollerWidth);
  }

  setPose(x: number, z: number, h: number): void {
    this.x = this.prevX = x;
    this.z = this.prevZ = z;
    this.h = this.prevH = h;
    this.speed = 0;
    this.vx = this.vz = 0;
    this.reversing = false;
    this.retracing = false;
    this.blockedTime = 0;
    this.trail.length = 0;
    this.crumbs.length = 0;
  }

  setRollerWidth(w: number): void {
    this.rollerWidth = w;
    const rc = VEHICLE.rollerColliderRadius;
    const half = Math.max(0, w / 2 - VEHICLE.rollerEndInset - rc);
    const count = Math.max(2, Math.ceil((half * 2) / 0.28) + 1);
    const circles: Circle[] = VEHICLE.bodyCircles.map((c) => ({ lx: 0, lz: c.z, r: c.r }));
    for (let k = 0; k < count; k++) {
      const t = count === 1 ? 0.5 : k / (count - 1);
      circles.push({ lx: -half + t * half * 2, lz: VEHICLE.rollerZ, r: rc });
    }
    this.circles = circles;
    // Old breadcrumbs were validated with a narrower drum.
    this.crumbs.length = 0;
  }

  get actualSpeed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * One fixed simulation step.
   * `beforeCollide` runs with the proposed pose so front damage is resolved
   * before chassis movement is pushed out of surviving cells. It returns the
   * number of layers damaged (chewing counts as progress, not a wedge).
   */
  step(dt: number, input: DriveInput, maxSpeed: number, world: CollisionWorld, beforeCollide: (from: Pose, to: Pose) => number): void {
    this.prevX = this.x;
    this.prevZ = this.z;
    this.prevH = this.h;

    const mag = clamp(input.mag, 0, 1);
    this.throttle = mag;
    if (mag <= 0.02) {
      this.reversing = false;
      this.retracing = false;
      this.reverseDist = 0;
      this.blockedTime = 0;
      this.turnStuck = 0;
      this.trail.length = 0;
    }
    if (this.retracing) {
      this.stepRetrace(dt, maxSpeed, world);
      return;
    }
    this.sinceRetrace += dt;
    // Just backed out of a pocket: turn in the new room instead of creeping
    // straight back into it.
    const afterRetrace = this.sinceRetrace < 1.5;

    let targetSpeed = 0;
    let dh = 0;
    let diff = 0;
    if (mag > 0.02) {
      const targetH = Math.atan2(input.x, input.y);
      diff = wrapAngle(targetH - this.h);
      if (this.reversing && (Math.abs(diff) < Math.PI * 0.25 || this.reverseDist > 1.1)) {
        this.reversing = false;
        this.reverseDist = 0;
        this.blockedTime = 0;
      }
      if (this.reversing) {
        // K-turn: keep rotating toward the wanted heading while backing up, so
        // alternating forward/reverse phases always make progress in one direction.
        dh = clamp(diff * damp(VEHICLE.turnSharpness * 0.6, dt), -VEHICLE.turnRate * 0.6 * dt, VEHICLE.turnRate * 0.6 * dt);
        targetSpeed = -maxSpeed * VEHICLE.reverseFactor * mag;
      } else {
        dh = clamp(diff * damp(VEHICLE.turnSharpness, dt), -VEHICLE.turnRate * dt, VEHICLE.turnRate * dt);
        let align = clamp(Math.cos(diff) * 1.25 - 0.25, 0, 1);
        // Can't pivot here: creep forward while turning, like a car, so the drum
        // chews a curved path and the body follows it.
        if (!afterRetrace && this.turnStuck > 0.05 && Math.abs(diff) < Math.PI * 0.62) align = Math.max(align, 0.45);
        targetSpeed = maxSpeed * mag * align;
      }
    }

    // Speed ramps: quick acceleration, slightly quicker braking.
    const accel = maxSpeed / VEHICLE.accelTime;
    const brake = maxSpeed / VEHICLE.brakeTime;
    const slowing = Math.abs(targetSpeed) < Math.abs(this.speed) || Math.sign(targetSpeed) !== Math.sign(this.speed);
    const rate = slowing ? brake : accel;
    this.speed += clamp(targetSpeed - this.speed, -rate * dt, rate * dt);

    const from: Pose = { x: this.x, z: this.z, h: this.h };
    // Yaw normally pivots near the rear axles (the drum swings and chews, the
    // bin follows). In tight spots the centre or the drum end is tried too.
    const propose = (d: number, pz: number, move = 1) => {
      const pivotX = this.x + Math.sin(this.h) * pz;
      const pivotZ = this.z + Math.cos(this.h) * pz;
      const h = this.h + d;
      return {
        h,
        x: pivotX - Math.sin(h) * pz + Math.sin(h) * this.speed * dt * move,
        z: pivotZ - Math.cos(h) * pz + Math.cos(h) * this.speed * dt * move,
      };
    };

    // Damage uses the full intended swing so blocks in the way get chewed even
    // if the body can't rotate into them yet.
    const want = propose(dh, VEHICLE.pivotZ);
    const crushing = beforeCollide(from, want) > 0;

    // [turn fraction, pivot, translation fraction] — full turn first, then
    // smaller turns and other pivots, then a straight move, then turn-only.
    const attempts: [number, number, number][] =
      dh !== 0
        ? [
            [1, VEHICLE.pivotZ, 1],
            [0.5, VEHICLE.pivotZ, 1],
            [1, 0, 1],
            [0.5, 0, 1],
            [0.5, VEHICLE.rollerZ * 0.7, 1],
            [0.25, VEHICLE.pivotZ, 1],
            [0.25, 0, 1],
            [0, 0, 1],
            [0.5, 0, 0],
            [0.5, VEHICLE.pivotZ, 0],
            [0.5, VEHICLE.rollerZ * 0.7, 0],
          ]
        : [[0, 0, 1]];
    let res: { x: number; z: number; pen: number } | null = null;
    let h1 = this.h;
    let accepted = 0;
    for (const [frac, pz, move] of attempts) {
      const p = frac === 1 && pz === VEHICLE.pivotZ && move === 1 ? want : propose(dh * frac, pz, move);
      const r = this.resolve(p.x, p.z, p.h, world);
      if (r.pen <= VEHICLE.maxPenetration) {
        res = r;
        h1 = p.h;
        accepted = frac;
        break;
      }
    }
    // Steering assist: nudge the heading a little either way so the truck can
    // funnel into a corridor it is slightly misaligned with.
    if (!res && Math.abs(this.speed) > 0.05) {
      for (const d of [0.04, -0.04, 0.08, -0.08, 0.14, -0.14]) {
        const p = propose(dh + d, VEHICLE.pivotZ, 0.6);
        const r = this.resolve(p.x, p.z, p.h, world);
        if (r.pen <= VEHICLE.maxPenetration) {
          res = r;
          h1 = p.h;
          break;
        }
      }
    }
    // Nothing fits: stay put rather than force through blocks.
    if (!res) res = { x: this.x, z: this.z, pen: 0 };
    const rotationRejected = dh !== 0 && accepted < 0.5;

    const mx = res.x - this.x;
    const mz = res.z - this.z;
    this.commit(res.x, res.z, h1, dt);
    this.recordCrumb(Math.hypot(mx, mz) + Math.abs(h1 - from.h) * 0.8);

    const moved = Math.hypot(mx, mz);
    if (this.reversing) {
      this.reverseDist += moved;
      // Backed into something while K-turning: back out along the track instead.
      if (moved < 0.15 * maxSpeed * dt) {
        this.reverseStall += dt;
        if (this.reverseStall > 0.25) {
          this.reversing = false;
          this.reverseStall = 0;
          this.startRetrace(1.2);
          return;
        }
      } else {
        this.reverseStall = 0;
      }
    }

    // Net progress over a short window (jitter in place doesn't count).
    this.sinceCrush = crushing ? 0 : this.sinceCrush + dt;
    this.trailClock += dt;
    if (this.trailClock >= 0.1) {
      this.trailClock = 0;
      this.trail.push(this.x, this.z, this.h);
      if (this.trail.length > 18) this.trail.splice(0, 3);
    }
    // Turning on the spot (a K-turn in progress) counts as progress too.
    const pinned =
      mag > 0.3 &&
      this.sinceCrush > 0.4 &&
      this.trail.length >= 15 &&
      Math.hypot(this.x - this.trail[0], this.z - this.trail[1]) < 0.1 &&
      Math.abs(wrapAngle(this.h - this.trail[2])) < 0.15;
    if (pinned) {
      // Wedged with nowhere to go: back out along the track, then try again.
      this.reversing = false;
      this.startRetrace(1.2);
      return;
    }

    // A blocked turn toward the rear starts a K-turn reverse.
    if (!this.reversing && mag > 0.3) {
      if (rotationRejected) this.turnStuck += dt;
      else this.turnStuck = Math.max(0, this.turnStuck - dt * 2);
      if (!crushing && rotationRejected && Math.abs(diff) > (afterRetrace ? Math.PI * 0.25 : Math.PI * 0.55)) {
        this.blockedTime += dt;
        if (this.blockedTime > 0.12) {
          this.reversing = true;
          this.reverseDist = 0;
          this.blockedTime = 0;
          this.turnStuck = 0;
        }
      } else {
        this.blockedTime = Math.max(0, this.blockedTime - dt);
      }
    }
  }

  private commit(x: number, z: number, h: number, dt: number): void {
    const mx = x - this.x;
    const mz = z - this.z;
    this.vx = mx / dt;
    this.vz = mz / dt;
    this.odometer += mx * Math.sin(h) + mz * Math.cos(h);
    this.yawRate = wrapAngle(h - this.h) / dt;
    this.x = x;
    this.z = z;
    this.h = wrapAngle(h);
  }

  private recordCrumb(travel: number): void {
    this.crumbDist += travel;
    if (this.crumbDist < 0.12 && this.crumbs.length > 0) return;
    this.crumbDist = 0;
    this.crumbs.push(this.x, this.z, this.h);
    if (this.crumbs.length > 3 * 3000) this.crumbs.splice(0, 3 * 300);
  }

  /** Back out along the entire recorded track (tests / debug). */
  retraceAll(): void {
    this.startRetrace(1);
    if (this.retracing) this.retraceLeft = Infinity;
  }

  private startRetrace(distance: number): void {
    this.trail.length = 0;
    this.blockedTime = 0;
    this.turnStuck = 0;
    // Drop crumbs at the current spot; retrace needs somewhere to go.
    while (this.crumbs.length >= 3 && Math.hypot(this.crumbs[this.crumbs.length - 3] - this.x, this.crumbs[this.crumbs.length - 2] - this.z) < 0.02) {
      this.crumbs.length -= 3;
    }
    if (this.crumbs.length < 3) return;
    const far = Math.hypot(this.x - this.retraceOriginX, this.z - this.retraceOriginZ) > 4;
    this.retraceStreak = far || this.sinceRetrace > 20 ? 0 : this.retraceStreak + 1;
    if (this.retraceStreak === 0) {
      this.retraceOriginX = this.x;
      this.retraceOriginZ = this.z;
    }
    this.retracing = true;
    this.trackX = this.x;
    this.trackZ = this.z;
    this.trackH = this.h;
    this.retraceLeft = Math.min(8, distance * Math.pow(2, this.retraceStreak));
    this.stats.retraces++;
    this.stats.maxStreak = Math.max(this.stats.maxStreak, this.retraceStreak);
  }

  /**
   * Back up along recorded poses. The ideal track point advances exactly along
   * the crumbs; the committed pose is that point settled by a push-out, so the
   * settle can never stall progress along the track.
   */
  private stepRetrace(dt: number, maxSpeed: number, world: CollisionWorld): void {
    const speed = maxSpeed * 0.75;
    let budget = speed * dt;
    let x = this.trackX;
    let z = this.trackZ;
    let h = this.trackH;
    while (budget > 1e-6 && this.crumbs.length >= 3) {
      const n = this.crumbs.length;
      const cx = this.crumbs[n - 3];
      const cz = this.crumbs[n - 2];
      const ch = this.crumbs[n - 1];
      const dh = wrapAngle(ch - h);
      const d = Math.hypot(cx - x, cz - z) + Math.abs(dh) * 0.8;
      if (d <= budget) {
        x = cx;
        z = cz;
        h = ch;
        budget -= d;
        this.crumbs.length -= 3;
      } else {
        const t = budget / d;
        x += (cx - x) * t;
        z += (cz - z) * t;
        h += dh * t;
        budget = 0;
      }
    }
    this.trackX = x;
    this.trackZ = z;
    this.trackH = h;
    const consumed = speed * dt - budget;
    const settled = this.resolve(x, z, h, world);
    const px = settled.pen <= VEHICLE.maxPenetration ? settled.x : x;
    const pz = settled.pen <= VEHICLE.maxPenetration ? settled.z : z;
    this.commit(px, pz, h, dt);
    this.speed = -speed;
    this.retraceLeft -= consumed;
    if (this.retraceLeft <= 0 || this.crumbs.length < 3 || consumed < 1e-6) {
      this.retracing = false;
      this.sinceRetrace = 0;
      this.speed = 0;
      // Leave a crumb here so the track stays continuous.
      this.crumbs.push(this.trackX, this.trackZ, this.trackH);
    }
  }

  /** Deepest overlap of any collision circle at a pose (no push-out). */
  penetration(px: number, pz: number, h: number, world: CollisionWorld): number {
    const cos = Math.cos(h);
    const sin = Math.sin(h);
    let pen = 0;
    for (const c of this.circles) {
      const p = pushCircle(px + c.lx * cos + c.lz * sin, pz - c.lx * sin + c.lz * cos, c.r, world, false);
      pen = Math.max(pen, p.pen);
    }
    return pen;
  }

  /** Iterative circle push-out. Returns the resolved position and the residual penetration. */
  resolve(px: number, pz: number, h: number, world: CollisionWorld): { x: number; z: number; pen: number } {
    const cos = Math.cos(h);
    const sin = Math.sin(h);
    for (let it = 0; it < VEHICLE.collisionIterations; it++) {
      let moved = false;
      for (const c of this.circles) {
        const wx = px + c.lx * cos + c.lz * sin;
        const wz = pz - c.lx * sin + c.lz * cos;
        const p = pushCircle(wx, wz, c.r, world, true);
        if (p.dx !== 0 || p.dz !== 0) {
          px += p.dx;
          pz += p.dz;
          moved = true;
        }
      }
      if (!moved) break;
    }
    let pen = 0;
    for (const c of this.circles) {
      const wx = px + c.lx * cos + c.lz * sin;
      const wz = pz - c.lx * sin + c.lz * cos;
      const p = pushCircle(wx, wz, c.r, world, false);
      pen = Math.max(pen, p.pen);
    }
    return { x: px, z: pz, pen };
  }

  /** Circles in world space (debug / tests). */
  worldCircles(): { x: number; z: number; r: number }[] {
    const cos = Math.cos(this.h);
    const sin = Math.sin(this.h);
    return this.circles.map((c) => ({ x: this.x + c.lx * cos + c.lz * sin, z: this.z - c.lx * sin + c.lz * cos, r: c.r }));
  }
}

const _push = { dx: 0, dz: 0, pen: 0 };

/**
 * Accumulated push for one circle against cells, statics and bounds.
 * With `apply` the circle position is advanced after each contact (Gauss-Seidel)
 * so corners resolve into smooth slides.
 */
function pushCircle(x: number, z: number, r: number, world: CollisionWorld, apply: boolean): typeof _push {
  let tx = 0;
  let tz = 0;
  let maxPen = 0;
  const f = world.field;
  const hb = GRID.collisionHalf;
  const c0 = f.colAt(x - r - hb);
  const c1 = f.colAt(x + r + hb);
  const r0 = f.rowAt(z - r - hb);
  const r1 = f.rowAt(z + r + hb);
  for (let rr = Math.max(0, r0); rr <= Math.min(f.rows - 1, r1); rr++) {
    for (let cc = Math.max(0, c0); cc <= Math.min(f.cols - 1, c1); cc++) {
      if (f.remaining[rr * f.cols + cc] === 0) continue;
      const bx = f.originX + (cc + 0.5) * f.pitch;
      const bz = f.originZ + (rr + 0.5) * f.pitch;
      const p = circleBox(x + tx, z + tz, r, bx, bz, hb, hb);
      if (p.pen > 0) {
        maxPen = Math.max(maxPen, p.pen);
        if (apply) {
          tx += p.dx;
          tz += p.dz;
        }
      }
    }
  }
  for (const s of world.statics) {
    const p = circleBox(x + tx, z + tz, r, s.x, s.z, s.hw, s.hd);
    if (p.pen > 0) {
      maxPen = Math.max(maxPen, p.pen);
      if (apply) {
        tx += p.dx;
        tz += p.dz;
      }
    }
  }
  // World bounds (inside a rectangle), with an optional southern gate opening.
  const b = world.bounds;
  const cx = x + tx;
  const cz = z + tz;
  if (cx - r < b.minX) {
    const pen = b.minX - (cx - r);
    maxPen = Math.max(maxPen, pen);
    if (apply) tx += pen;
  } else if (cx + r > b.maxX) {
    const pen = cx + r - b.maxX;
    maxPen = Math.max(maxPen, pen);
    if (apply) tx -= pen;
  }
  if (cz - r < b.minZ) {
    const pen = b.minZ - (cz - r);
    maxPen = Math.max(maxPen, pen);
    if (apply) tz += pen;
  } else if (cz + r > b.maxZ) {
    const inGate = b.gateOpen && cx > b.gateMinX && cx < b.gateMaxX;
    if (!inGate) {
      const pen = cz + r - b.maxZ;
      maxPen = Math.max(maxPen, pen);
      if (apply) tz -= pen;
    }
  }
  _push.dx = tx;
  _push.dz = tz;
  _push.pen = maxPen;
  return _push;
}

const _cb = { dx: 0, dz: 0, pen: 0 };

function circleBox(x: number, z: number, r: number, bx: number, bz: number, hw: number, hd: number): typeof _cb {
  const qx = clamp(x, bx - hw, bx + hw);
  const qz = clamp(z, bz - hd, bz + hd);
  const dx = x - qx;
  const dz = z - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) {
    _cb.pen = 0;
    _cb.dx = 0;
    _cb.dz = 0;
    return _cb;
  }
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const pen = r - d;
    _cb.dx = (dx / d) * pen;
    _cb.dz = (dz / d) * pen;
    _cb.pen = pen;
    return _cb;
  }
  // Centre inside the box: exit through the nearest face.
  const ex = hw - Math.abs(x - bx);
  const ez = hd - Math.abs(z - bz);
  if (ex < ez) {
    const pen = ex + r;
    _cb.dx = (x >= bx ? 1 : -1) * pen;
    _cb.dz = 0;
    _cb.pen = pen;
  } else {
    const pen = ez + r;
    _cb.dx = 0;
    _cb.dz = (z >= bz ? 1 : -1) * pen;
    _cb.pen = pen;
  }
  return _cb;
}
