import type { TrackStageDef, Vec2 } from './types';

/**
 * Lintasan loop tertutup satu arah, dibentuk dari poligon bersudut membulat
 * (ruas lurus + busur lingkaran). Panjangnya eksak sehingga "jarak tempuh" kendaraan
 * dan titik pickup/bongkar bisa dihitung tanpa ambiguitas.
 *
 * Jarak 0 = titik sudut pertama = titik bongkar.
 */

interface LineSeg {
  kind: 'line';
  start: number;
  len: number;
  ax: number;
  az: number;
  dx: number;
  dz: number;
}

interface ArcSeg {
  kind: 'arc';
  start: number;
  len: number;
  cx: number;
  cz: number;
  r: number;
  a0: number;
  /** +1 atau -1 (arah sapuan sudut). */
  dir: number;
}

type Seg = LineSeg | ArcSeg;

export class TrackPath {
  readonly segs: Seg[] = [];
  readonly length: number;
  /** +1 jika loop berputar searah jarum jam dilihat dari atas (x kanan, z ke bawah layar). */
  readonly clockwise: boolean;
  private readonly samples: Vec2[] = [];
  private readonly sampleStep = 0.1;

  constructor(readonly def: TrackStageDef) {
    const pts = def.corners.map(([x, z]) => ({ x, z }));
    const n = pts.length;
    if (n < 3) throw new Error('Track butuh minimal 3 titik');

    // Luas bertanda untuk arah putaran.
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      area += a.x * b.z - b.x * a.z;
    }
    this.clockwise = area > 0;

    // Titik singgung fillet untuk tiap sudut.
    type Corner = { t1: Vec2; t2: Vec2; arc: Omit<ArcSeg, 'start'> | null };
    const corners: Corner[] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const u = norm({ x: p.x - prev.x, z: p.z - prev.z });
      const w = norm({ x: next.x - p.x, z: next.z - p.z });
      const cross = u.x * w.z - u.z * w.x;
      const dot = clamp(u.x * w.x + u.z * w.z, -1, 1);
      const theta = Math.acos(dot); // sudut belok
      if (i === 0 || theta < 1e-4) {
        corners.push({ t1: p, t2: p, arc: null });
        continue;
      }
      const lenIn = dist(prev, p);
      const lenOut = dist(p, next);
      const r = Math.min(def.radius, (Math.min(lenIn, lenOut) * 0.5) / Math.tan(theta / 2));
      const t = r * Math.tan(theta / 2);
      const t1 = { x: p.x - u.x * t, z: p.z - u.z * t };
      const t2 = { x: p.x + w.x * t, z: p.z + w.z * t };
      // Normal ke arah belokan.
      const side = cross > 0 ? 1 : -1;
      const nx = -u.z * side;
      const nz = u.x * side;
      const cx = t1.x + nx * r;
      const cz = t1.z + nz * r;
      const a0 = Math.atan2(t1.z - cz, t1.x - cx);
      corners.push({ t1, t2, arc: { kind: 'arc', len: r * theta, cx, cz, r, a0, dir: side } });
    }

    let acc = 0;
    for (let i = 0; i < n; i++) {
      const c = corners[i];
      if (c.arc) {
        this.segs.push({ ...c.arc, start: acc });
        acc += c.arc.len;
      }
      const nextC = corners[(i + 1) % n];
      const a = c.t2;
      const b = nextC.t1;
      const len = dist(a, b);
      if (len > 1e-6) {
        this.segs.push({ kind: 'line', start: acc, len, ax: a.x, az: a.z, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len });
        acc += len;
      }
    }
    this.length = acc;

    const count = Math.ceil(this.length / this.sampleStep);
    for (let i = 0; i < count; i++) this.samples.push(this.pointAt((i / count) * this.length));
  }

  private segAt(d: number): Seg {
    const segs = this.segs;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].start <= d) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo];
  }

  wrap(d: number): number {
    const L = this.length;
    const r = d % L;
    return r < 0 ? r + L : r;
  }

  pointAt(d: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    d = this.wrap(d);
    const s = this.segAt(d);
    const t = d - s.start;
    if (s.kind === 'line') {
      out.x = s.ax + s.dx * t;
      out.z = s.az + s.dz * t;
    } else {
      const a = s.a0 + (s.dir * t) / s.r;
      out.x = s.cx + Math.cos(a) * s.r;
      out.z = s.cz + Math.sin(a) * s.r;
    }
    return out;
  }

  /** Vektor arah (unit) pada jarak d. */
  tangentAt(d: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    d = this.wrap(d);
    const s = this.segAt(d);
    if (s.kind === 'line') {
      out.x = s.dx;
      out.z = s.dz;
    } else {
      const a = s.a0 + (s.dir * (d - s.start)) / s.r;
      out.x = -Math.sin(a) * s.dir;
      out.z = Math.cos(a) * s.dir;
    }
    return out;
  }

  /** Normal ke arah LUAR loop (unit). */
  outwardAt(d: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    const t = this.tangentAt(d, out);
    // Untuk loop searah jarum jam (x kanan, z ke bawah layar), luar = kiri dari arah jalan.
    const s = this.clockwise ? 1 : -1;
    const x = t.z * s;
    const z = -t.x * s;
    out.x = x;
    out.z = z;
    return out;
  }

  /** Jarak tempuh titik lintasan terdekat dengan p. */
  closestDistance(p: Vec2): { d: number; gap: number } {
    let best = Infinity;
    let bestI = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const q = this.samples[i];
      const dd = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (dd < best) {
        best = dd;
        bestI = i;
      }
    }
    // Perhalus di sekitar sampel terbaik.
    let d0 = (bestI / this.samples.length) * this.length;
    let step = this.sampleStep;
    const tmp = { x: 0, z: 0 };
    for (let k = 0; k < 20; k++) {
      step *= 0.5;
      const a = this.pointAt(d0 - step, tmp);
      const da = (a.x - p.x) ** 2 + (a.z - p.z) ** 2;
      const b = this.pointAt(d0 + step, tmp);
      const db = (b.x - p.x) ** 2 + (b.z - p.z) ** 2;
      if (da < best && da <= db) {
        best = da;
        d0 -= step;
      } else if (db < best) {
        best = db;
        d0 += step;
      }
    }
    return { d: this.wrap(d0), gap: Math.sqrt(best) };
  }

  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of this.samples) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    return { minX, maxX, minZ, maxZ };
  }
}

// ---------------------------------------------------------------------------
// Crossing — aturan inti yang rawan bug
// ---------------------------------------------------------------------------

export interface KeyPoint<T> {
  d: number;
  data: T;
}

/**
 * Mengembalikan titik kunci yang DILEWATI saat kendaraan bergerak dari `prev` sejauh `move`
 * (move >= 0), berurutan sepanjang arah jalan, termasuk saat melewati ujung putaran (wrap).
 *
 * Interval yang dipakai adalah setengah-terbuka (prev, prev + move]:
 *  - titik tepat di `prev` TIDAK dihitung (kendaraan baru saja memicunya di langkah sebelumnya),
 *  - titik tepat di `prev + move` dihitung sekarang, sehingga langkah berikutnya tidak memicu ulang.
 * Dengan begitu satu titik terpicu tepat sekali per lintasan, sebesar apa pun langkah per frame
 * (boost tidak bisa "melompati" trigger), tanpa pemeriksaan jarak mentah.
 *
 * `move` diasumsikan < panjang lintasan (simulasi membatasinya); jika lebih, sisa putaran
 * penuh diabaikan secara eksplisit.
 */
export function computeCrossings<T>(prev: number, move: number, length: number, points: readonly KeyPoint<T>[]): KeyPoint<T>[] {
  if (move <= 0 || points.length === 0) return [];
  // Catatan presisi: perbandingan memakai aritmetika yang SAMA dengan pembaruan posisi
  // (prev + move, lalu dibungkus dengan %), tanpa epsilon — epsilon justru bisa memicu dua kali.
  const end = prev + Math.min(move, length);
  const hits: { off: number; p: KeyPoint<T> }[] = [];
  for (const p of points) {
    // Titik tepat di `prev` dianggap di belakang: baru terpicu setelah satu putaran penuh.
    const target = p.d > prev ? p.d : p.d + length;
    if (target <= end) hits.push({ off: target - prev, p });
  }
  hits.sort((a, b) => a.off - b.off);
  return hits.map((h) => h.p);
}

// ---------------------------------------------------------------------------
// Pemetaan posisi antar tahap expand
// ---------------------------------------------------------------------------

/**
 * Peta linear sepotong-sepotong dari jarak di lintasan lama → jarak di lintasan baru.
 * Bagian lintasan yang identik (awal & akhir loop) dipetakan 1:1, bagian yang berubah
 * dipetakan proporsional. Urutan relatif terhadap titik bongkar & stasiun lama tetap terjaga,
 * sehingga tidak ada pickup/bongkar yang terlewat atau terpicu dua kali karena expand.
 */
export class StageMapping {
  constructor(
    readonly fromKeys: number[],
    readonly toKeys: number[],
  ) {}

  map(d: number): number {
    const fk = this.fromKeys;
    const tk = this.toKeys;
    const L = fk[fk.length - 1];
    d = ((d % L) + L) % L;
    for (let i = 0; i < fk.length - 1; i++) {
      if (d >= fk[i] && d <= fk[i + 1]) {
        const span = fk[i + 1] - fk[i];
        const t = span > 1e-9 ? (d - fk[i]) / span : 0;
        const out = tk[i] + t * (tk[i + 1] - tk[i]);
        return out >= tk[tk.length - 1] ? 0 : out;
      }
    }
    return 0;
  }

  inverse(): StageMapping {
    return new StageMapping(this.toKeys, this.fromKeys);
  }
}

const SAME_EPS = 0.01;

export function buildStageMapping(from: TrackPath, to: TrackPath, sharedPoints: Vec2[] = []): StageMapping {
  const step = 0.05;
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  // Prefix identik dari jarak 0.
  let head = 0;
  const maxCommon = Math.min(from.length, to.length);
  while (head + step < maxCommon) {
    from.pointAt(head + step, a);
    to.pointAt(head + step, b);
    if (Math.hypot(a.x - b.x, a.z - b.z) > SAME_EPS) break;
    head += step;
  }
  // Suffix identik (dihitung mundur dari akhir loop).
  let tail = 0;
  while (tail + step < maxCommon - head) {
    from.pointAt(from.length - (tail + step), a);
    to.pointAt(to.length - (tail + step), b);
    if (Math.hypot(a.x - b.x, a.z - b.z) > SAME_EPS) break;
    tail += step;
  }
  const pairs: [number, number][] = [
    [0, 0],
    [head, head],
    [from.length - tail, to.length - tail],
  ];
  for (const p of sharedPoints) {
    pairs.push([from.closestDistance(p).d, to.closestDistance(p).d]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const fk: number[] = [];
  const tk: number[] = [];
  for (const [f, t] of pairs) {
    const lastF = fk.length ? fk[fk.length - 1] : -1;
    const lastT = tk.length ? tk[tk.length - 1] : -1;
    if (f <= lastF + 1e-6 || t <= lastT + 1e-6) continue; // jaga monoton
    if (f >= from.length - 1e-6 || t >= to.length - 1e-6) continue;
    fk.push(f);
    tk.push(t);
  }
  fk.push(from.length);
  tk.push(to.length);
  return new StageMapping(fk, tk);
}

// ---------------------------------------------------------------------------

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / l, z: v.z / l };
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
