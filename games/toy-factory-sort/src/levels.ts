// Level data. Each level is generated from a fixed seed so it is identical on
// every load, then checked with a timeless greedy solver so the fixed bin order
// never demands more belt space than the level's capacity allows.

export interface LevelSpec {
  name: string;
  colors: number; // how many toy families are in play
  toys: number[]; // work orders per machine (machine count = length)
  cap: number; // belt capacity, overflow = fail
  seed: number;
  disp: number; // how far parts may be shuffled ahead of when they are needed
  target: number; // wanted peak of parts parked on the belt by a greedy player
}

export interface PartDef {
  color: number;
  piece: number; // 0 base, 1 body, 2 head
}

export interface LevelData {
  spec: LevelSpec;
  queues: number[][]; // colour of each work order, per machine
  trays: PartDef[][]; // index 0 = front (next to drop)
  peak: number;
  dumps: number;
}

export const TRAY_COUNT = 4;

export const LEVELS: LevelSpec[] = [
  { name: 'SHIFT 1', colors: 3, toys: [2, 2, 2], cap: 10, seed: 101, disp: 3, target: 2 },
  { name: 'SHIFT 2', colors: 4, toys: [3, 3, 2], cap: 9, seed: 202, disp: 6, target: 3 },
  { name: 'SHIFT 3', colors: 5, toys: [3, 3, 3], cap: 8, seed: 303, disp: 7, target: 3 },
  { name: 'SHIFT 4', colors: 5, toys: [4, 4, 3], cap: 7, seed: 404, disp: 8, target: 3 },
  { name: 'SHIFT 5', colors: 6, toys: [4, 4, 4], cap: 6, seed: 505, disp: 9, target: 3 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeQueues(spec: LevelSpec, rng: () => number): number[][] {
  const total = spec.toys.reduce((a, b) => a + b, 0);
  const pool = shuffle(Array.from({ length: total }, (_, i) => i % spec.colors), rng);
  const q: number[][] = spec.toys.map(() => []);
  const rounds = Math.max(...spec.toys);
  for (let r = 0; r < rounds; r++) {
    for (let m = 0; m < spec.toys.length; m++) {
      if (r >= spec.toys[m]) continue;
      const prev = r > 0 ? q[m][r - 1] : -1;
      const busy = new Set(q.slice(0, m).map((mq) => mq[r]));
      let k = pool.findIndex((c) => c !== prev && !busy.has(c));
      if (k < 0) k = pool.findIndex((c) => c !== prev);
      if (k < 0) k = 0;
      q[m].push(pool.splice(k, 1)[0]);
    }
  }
  return q;
}

function makeTrays(spec: LevelSpec, queues: number[][], rng: () => number): PartDef[][] {
  // Ideal consumption order, round by round, then shuffled within a window.
  const ideal: number[] = [];
  const rounds = Math.max(...spec.toys);
  for (let r = 0; r < rounds; r++) {
    for (const mq of queues) if (r < mq.length) ideal.push(mq[r], mq[r], mq[r]);
  }
  const keyed = ideal.map((c, i) => ({ c, k: i + rng() * spec.disp }));
  keyed.sort((a, b) => a.k - b.k);
  const per = Math.ceil(keyed.length / TRAY_COUNT);
  const trays: PartDef[][] = Array.from({ length: TRAY_COUNT }, () => []);
  const seen = new Array(8).fill(0);
  for (const { c } of keyed) {
    const open = trays.map((t, i) => (t.length < per ? i : -1)).filter((i) => i >= 0);
    const t = open[Math.floor(rng() * open.length)];
    trays[t].push({ color: c, piece: seen[c]++ % 3 });
  }
  return trays;
}

/** Timeless greedy play: take a needed front part if any, else dump the
 * cheapest blocker. Returns the peak number of parts sitting on the belt. */
export function solveAbstract(queues: number[][], trays: number[][]): { ok: boolean; peak: number; dumps: number } {
  const tr = trays.map((t) => t.slice());
  const ms = queues.map((q) => ({ q, o: 0, f: 0 }));
  const belt = new Array(8).fill(0);
  let total = 0;
  let peak = 0;
  let dumps = 0;
  const consume = () => {
    let ch = true;
    while (ch) {
      ch = false;
      for (const m of ms) {
        if (m.o >= m.q.length) continue;
        const c = m.q[m.o];
        while (m.f < 3 && belt[c] > 0) {
          belt[c]--;
          total--;
          m.f++;
          ch = true;
        }
        if (m.f === 3) {
          m.o++;
          m.f = 0;
          ch = true;
        }
      }
    }
  };
  for (let guard = 0; guard < 10000; guard++) {
    consume();
    if (tr.every((t) => t.length === 0)) break;
    const active = new Set(ms.filter((m) => m.o < m.q.length).map((m) => m.q[m.o]));
    const pick = tr.findIndex((t) => t.length > 0 && active.has(t[0]));
    if (pick >= 0) {
      belt[tr[pick].shift()!]++;
      total++;
      peak = Math.max(peak, total);
      continue;
    }
    let best = -1;
    let bestD = Infinity;
    tr.forEach((t, i) => {
      const d = t.findIndex((c) => active.has(c));
      if (d > 0 && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return { ok: false, peak, dumps };
    belt[tr[best].shift()!]++;
    total++;
    dumps++;
    peak = Math.max(peak, total);
  }
  consume();
  return { ok: total === 0 && ms.every((m) => m.o >= m.q.length), peak, dumps };
}

const cache = new Map<number, LevelData>();

export function buildLevel(index: number): LevelData {
  const hit = cache.get(index);
  if (hit) return hit;
  const spec = LEVELS[index];
  let best: LevelData | null = null;
  for (let a = 0; a < 400; a++) {
    const rng = mulberry32(spec.seed + a * 7919);
    const queues = makeQueues(spec, rng);
    const trays = makeTrays(spec, queues, rng);
    const res = solveAbstract(queues, trays.map((t) => t.map((p) => p.color)));
    if (!res.ok || res.peak > spec.target) continue;
    const cand: LevelData = { spec, queues, trays, peak: res.peak, dumps: res.dumps };
    if (!best || res.peak > best.peak || (res.peak === best.peak && res.dumps > best.dumps)) best = cand;
    if (res.peak === spec.target && res.dumps >= 2) break;
  }
  if (!best) throw new Error(`level ${index} could not be generated`);
  cache.set(index, best);
  return best;
}
