// Shared simulation drivers for the headless tests (no rendering involved).
import { expect } from 'vitest';
import { GRID, SIM } from '../src/game/config';
import type { GameSim } from '../src/game/GameSim';
import { createRng } from '../src/game/util';

export const DT = SIM.step;
/** Resolution tolerance of the collision solver; the body never goes deeper. */
export const MAX_GRAZE = 0.06;

/** Deepest overlap of the truck's collision circles into any intact cell. */
export function maxCellPenetration(sim: GameSim): number {
  const f = sim.field;
  const hb = GRID.collisionHalf;
  let worst = 0;
  for (const c of sim.vehicle.worldCircles()) {
    const c0 = Math.max(0, f.colAt(c.x - c.r - hb));
    const c1 = Math.min(f.cols - 1, f.colAt(c.x + c.r + hb));
    const r0 = Math.max(0, f.rowAt(c.z - c.r - hb));
    const r1 = Math.min(f.rows - 1, f.rowAt(c.z + c.r + hb));
    for (let r = r0; r <= r1; r++) {
      for (let cc = c0; cc <= c1; cc++) {
        if (!f.solidAt(cc, r)) continue;
        const bx = f.originX + (cc + 0.5) * f.pitch;
        const bz = f.originZ + (r + 0.5) * f.pitch;
        const qx = Math.min(Math.max(c.x, bx - hb), bx + hb);
        const qz = Math.min(Math.max(c.z, bz - hb), bz + hb);
        worst = Math.max(worst, c.r - Math.hypot(c.x - qx, c.z - qz));
      }
    }
  }
  return worst;
}

/** Random-walk harvesting: the player wanders with the stick until the bin is full. */
export function wander(sim: GameSim, seed: number, maxSeconds: number): void {
  const rng = createRng(seed);
  let dir = { x: 0, y: -1 };
  let hold = 0;
  const f = sim.field;
  for (let s = 0; s < maxSeconds / DT && !sim.ledger.isFull; s++) {
    hold -= DT;
    if (hold <= 0) {
      // Bias toward the field so the walk keeps harvesting.
      const v = sim.vehicle;
      const a = Math.atan2(0 - v.x, f.originZ + f.depth / 2 - v.z) + (rng() - 0.5) * 3.2;
      dir = { x: Math.sin(a), y: Math.cos(a) };
      hold = 0.6 + rng() * 1.6;
    }
    sim.update(DT, { x: dir.x, y: dir.y, mag: 0.6 + rng() * 0.4 });
    expect(maxCellPenetration(sim)).toBeLessThan(MAX_GRAZE);
  }
}

/**
 * Route over cleared/open space to a target, then pure-pursuit steering along
 * it. The planner uses cell corners with a free 2x2 block around them so the
 * route is always at least truck-wide, with a wall-clearance penalty.
 * Returns the simulated seconds taken, or -1 on timeout / no route.
 */
export function driveTo(sim: GameSim, tx: number, tz: number, arrived: () => boolean, maxSeconds: number, check = true): number {
  const f = sim.field;
  const pitch = f.pitch;
  const b = sim.world.bounds;
  const minC = Math.floor((b.minX - f.originX) / pitch) - 1;
  const maxC = Math.ceil((b.maxX - f.originX) / pitch) + 1;
  const minR = Math.floor((b.minZ - f.originZ) / pitch) - 1;
  const maxR = Math.ceil((b.maxZ + 3 - f.originZ) / pitch) + 1;
  const W = maxC - minC + 1;
  const H = maxR - minR + 1;
  const free = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= f.cols || r >= f.rows) {
      const x = f.originX + (c + 0.5) * pitch;
      const z = f.originZ + (r + 0.5) * pitch;
      for (const s of sim.world.statics) if (Math.abs(x - s.x) < s.hw + 0.4 && Math.abs(z - s.z) < s.hd + 0.4) return false;
      return true;
    }
    return f.remaining[r * f.cols + c] === 0;
  };
  const idx = (c: number, r: number) => (r - minR) * W + (c - minC);
  const cornerFree = (c: number, r: number) => free(c - 1, r - 1) && free(c, r - 1) && free(c - 1, r) && free(c, r);
  const cornerPos = (c: number, r: number) => ({ x: f.originX + c * pitch, z: f.originZ + r * pitch });
  const nearestCorner = (x: number, z: number): [number, number] | null => {
    const c0 = Math.round((x - f.originX) / pitch);
    const r0 = Math.round((z - f.originZ) / pitch);
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let dr = -3; dr <= 3; dr++)
      for (let dc = -3; dc <= 3; dc++) {
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < minC || c > maxC || r < minR || r > maxR || !cornerFree(c, r)) continue;
        const p = cornerPos(c, r);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) {
          bd = d;
          best = [c, r];
        }
      }
    return best;
  };
  const wallCost = (c: number, r: number) => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dc || dr) && !cornerFree(c + dc, r + dr)) return 3;
    return 0;
  };
  const replan = () => {
    const v = sim.vehicle;
    const start = nearestCorner(v.x, v.z);
    const goal = nearestCorner(tx, tz);
    if (!start || !goal) return [];
    const prev = new Int32Array(W * H).fill(-2);
    const dist = new Float64Array(W * H).fill(Infinity);
    const buckets: number[][] = [];
    const s0 = idx(start[0], start[1]);
    prev[s0] = -1;
    dist[s0] = 0;
    buckets[0] = [s0];
    for (let d = 0; d < buckets.length; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const cur = bucket[k];
        if (dist[cur] !== d) continue;
        const c = (cur % W) + minC;
        const r = Math.floor(cur / W) + minR;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < minC || nc > maxC || nr < minR || nr > maxR || !cornerFree(nc, nr)) continue;
          const ni = idx(nc, nr);
          const nd = d + 1 + wallCost(nc, nr);
          if (nd < dist[ni]) {
            dist[ni] = nd;
            prev[ni] = cur;
            (buckets[nd] ??= []).push(ni);
          }
        }
      }
    }
    const path: { x: number; z: number }[] = [];
    let cur = idx(goal[0], goal[1]);
    if (prev[cur] === -2) return path;
    while (cur !== -1) {
      path.unshift(cornerPos((cur % W) + minC, Math.floor(cur / W) + minR));
      cur = prev[cur];
    }
    path.push({ x: tx, z: tz });
    return path;
  };
  let path = replan();
  if (path.length === 0) return -1;
  let replanClock = 0;
  for (let s = 0; s < maxSeconds / DT; s++) {
    if (arrived()) return s * DT;
    const v = sim.vehicle;
    replanClock += DT;
    if (replanClock > 1.5) {
      replanClock = 0;
      const p = replan();
      if (p.length) path = p;
    }
    // Pure pursuit: aim at the first path point at least ~1.2 units away.
    let nearest = 0;
    let nd = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = Math.hypot(path[i].x - v.x, path[i].z - v.z);
      if (d < nd) {
        nd = d;
        nearest = i;
      }
    }
    let target = path[path.length - 1];
    for (let i = nearest; i < path.length; i++) {
      if (Math.hypot(path[i].x - v.x, path[i].z - v.z) > 1.2) {
        target = path[i];
        break;
      }
    }
    const dx = target.x - v.x;
    const dz = target.z - v.z;
    const d = Math.hypot(dx, dz) || 1;
    sim.update(DT, { x: dx / d, y: dz / d, mag: 1 });
    if (check) expect(maxCellPenetration(sim)).toBeLessThan(MAX_GRAZE);
  }
  return -1;
}

export function driveToPad(sim: GameSim, maxSeconds: number): boolean {
  const pad = sim.depot.layout.pad;
  const arrived = () => Math.abs(sim.vehicle.x - pad.x) < pad.hw * 0.8 && Math.abs(sim.vehicle.z - pad.z) < pad.hd * 0.8;
  return driveTo(sim, pad.x, pad.z, arrived, maxSeconds) >= 0;
}
