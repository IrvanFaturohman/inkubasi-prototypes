// Seeded course layout. Same seed, same course every run, so upgrades are what change.
import { COURSE_LENGTH, CRATE_SIZE, BARREL_RADIUS, BARREL_HALF_H, RAMP_H } from './config';

export type FeatureType = 'crates' | 'barrels' | 'pad' | 'ramp';

export interface Feature {
  id: number;
  type: FeatureType;
  x: number;
  y: number; // ground height at x (flattened)
  /** local block positions relative to (x, y), for stacks */
  cells: { x: number; y: number }[];
  color: number;
  top: number; // highest point above y
}

export interface Course {
  pts: { x: number; y: number }[];
  features: Feature[];
  groundY: (x: number) => number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CRATE_COLORS = [0xd9822b, 0xc9a24a, 0xb5603a, 0x8f9b3a, 0x4f8fb8];
const BARREL_COLORS = [0xb83a3a, 0x3f7f5a];

const STEP = 5;
export const SLOPE_MIN = -0.2; // ~11 deg downhill
export const SLOPE_MAX = 0.05; // ~3 deg uphill, so a slow arrow does not visibly roll back far
const SLOPE_TURN = 0.035; // max slope change per 5 m segment

function crateCells(rng: () => number): { x: number; y: number }[] {
  const s = CRATE_SIZE;
  const shape = Math.floor(rng() * 4);
  const cells: { x: number; y: number }[] = [];
  if (shape === 0) {
    // pyramid 3-2-1
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) cells.push({ x: (c - (2 - r) / 2) * s, y: s / 2 + r * s });
  } else if (shape === 1) {
    // tower 2 x 3
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) cells.push({ x: (c - 0.5) * s, y: s / 2 + r * s });
  } else if (shape === 2) {
    // wall 1 x 4
    for (let r = 0; r < 4; r++) cells.push({ x: 0, y: s / 2 + r * s });
  } else {
    // big pyramid 4-3-2-1
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4 - r; c++) cells.push({ x: (c - (3 - r) / 2) * s, y: s / 2 + r * s });
  }
  return cells;
}

function barrelCells(rng: () => number): { x: number; y: number }[] {
  // upright barrels, stacked like crates (a lying cylinder pyramid rolls apart on its own)
  const w = BARREL_RADIUS * 2 + 0.02;
  const rows = rng() < 0.5 ? 2 : 3;
  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const n = rows - row;
    for (let c = 0; c < n; c++) cells.push({ x: (c - (n - 1) / 2) * w, y: BARREL_HALF_H + row * BARREL_HALF_H * 2 });
  }
  return cells;
}

export function buildCourse(seed: number): Course {
  const rng = mulberry32(seed);
  const features: Feature[] = [];
  let id = 0;
  const add = (type: FeatureType, x: number, cells: { x: number; y: number }[], color: number) => {
    const half = type === 'barrels' ? BARREL_HALF_H : CRATE_SIZE / 2;
    const top = cells.length ? Math.max(...cells.map((c) => c.y)) + half : type === 'ramp' ? RAMP_H : 0.5;
    features.push({ id: id++, type, x, y: 0, cells, color, top });
  };
  // Hand-placed first 260 m: Lv.1 shots land 15 to 65 m out, so the timing tap has to
  // decide something (pad or no pad) before the first big stack.
  const intro: [FeatureType, number, number][] = [
    ['pad', 60, 0], ['crates', 105, 0], ['pad', 140, 0], ['crates', 168, 2], ['ramp', 200, 0],
    ['barrels', 232, 0], ['pad', 258, 0], ['crates', 285, 3],
  ];
  for (const [type, x, shape] of intro) {
    if (type === 'crates') add(type, x, crateCells(() => shape / 4 + 0.01), CRATE_COLORS[features.length % CRATE_COLORS.length]);
    else if (type === 'barrels') add(type, x, barrelCells(() => 0.9), BARREL_COLORS[0]);
    else add(type, x, [], type === 'ramp' ? 0xf2b632 : 0xe0487a);
  }
  let x = 285;
  while (x < COURSE_LENGTH - 40) {
    x += 16 + rng() * 26;
    const r = rng();
    let type: FeatureType = r < 0.38 ? 'crates' : r < 0.55 ? 'barrels' : r < 0.82 ? 'pad' : 'ramp';
    const prev = features[features.length - 1];
    // Lesson from the original: a stack sitting at the foot of a ramp swallowed almost half
    // the runs. Never put a stack within 18 m before a ramp; make it a pad instead.
    if (type === 'ramp' && prev && (prev.type === 'crates' || prev.type === 'barrels') && x - prev.x < 18) type = 'pad';
    if (type === 'crates') add(type, x, crateCells(rng), CRATE_COLORS[Math.floor(rng() * CRATE_COLORS.length)]);
    else if (type === 'barrels') add(type, x, barrelCells(rng), BARREL_COLORS[Math.floor(rng() * BARREL_COLORS.length)]);
    else add(type, x, [], type === 'ramp' ? 0xf2b632 : 0xe0487a);
  }

  // Flat zones under features so stacks start asleep on level ground.
  const flat = (px: number) =>
    features.some((f) => (f.type === 'ramp' ? px >= f.x - 6 && px <= f.x + 12 : Math.abs(px - f.x) <= 7));

  const pts: { x: number; y: number }[] = [];
  const ph1 = rng() * 6.28;
  const ph2 = rng() * 6.28;
  const xs: number[] = [];
  const sl: number[] = [];
  const fixed: boolean[] = [];
  for (let px = 0; px <= COURSE_LENGTH + 400; px += STEP) {
    let sv: number;
    if (px < 8) sv = 0;
    else if (px < 90) sv = -0.07; // start area: gentle downhill so early landings slide forward
    else sv = -0.045 + 0.085 * Math.sin(px / 47 + ph1) + 0.05 * Math.sin(px / 19 + ph2);
    const fz = flat(px + STEP * 0.5) || px > COURSE_LENGTH + 40 || px < 8;
    xs.push(px);
    sl.push(fz ? 0 : Math.max(SLOPE_MIN, Math.min(SLOPE_MAX, sv)));
    fixed.push(fz);
  }
  // Limit how fast the slope can change: sharp valleys slam a sliding shaft and eat its speed.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < sl.length; i++) if (!fixed[i]) sl[i] = Math.max(sl[i - 1] - SLOPE_TURN, Math.min(sl[i - 1] + SLOPE_TURN, sl[i]));
    for (let i = sl.length - 2; i >= 0; i--) if (!fixed[i]) sl[i] = Math.max(sl[i + 1] - SLOPE_TURN, Math.min(sl[i + 1] + SLOPE_TURN, sl[i]));
  }
  let h = 0;
  pts.push({ x: -40, y: 0 });
  for (let i = 0; i < xs.length; i++) {
    pts.push({ x: xs[i], y: h });
    h += sl[i] * STEP;
  }

  const groundY = (qx: number): number => {
    if (qx <= pts[0].x) return pts[0].y;
    // pts[1].x = 0, uniform STEP after that
    if (qx < 0) return pts[1].y;
    const i = Math.min(pts.length - 2, 1 + Math.floor(qx / STEP));
    const a = pts[i];
    const b = pts[i + 1];
    const t = Math.max(0, Math.min(1, (qx - a.x) / (b.x - a.x)));
    return a.y + (b.y - a.y) * t;
  };

  for (const f of features) f.y = groundY(f.x);
  return { pts, features, groundY };
}
