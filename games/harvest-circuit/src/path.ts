/**
 * Closed loop path built from straight lines and circular arcs (turtle style).
 * Positions are parameterised by arc length `s`, which the simulation uses directly.
 * Heading h: direction (cos h, sin h) in the (x, z) plane.
 */
export interface PathPoint {
  x: number;
  z: number;
  heading: number;
}

interface Segment {
  kind: 'line' | 'arc';
  s0: number;
  len: number;
  x0: number;
  z0: number;
  h0: number;
  cx: number;
  cz: number;
  r: number;
  sign: number;
}

export class Path {
  readonly segs: Segment[] = [];
  length = 0;
  private x: number;
  private z: number;
  private h: number;

  constructor(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.h = heading;
  }

  line(len: number): this {
    this.segs.push({ kind: 'line', s0: this.length, len, x0: this.x, z0: this.z, h0: this.h, cx: 0, cz: 0, r: 0, sign: 0 });
    this.x += Math.cos(this.h) * len;
    this.z += Math.sin(this.h) * len;
    this.length += len;
    return this;
  }

  /** Turn by `angle` radians (positive = heading increases) on a circle of radius r. */
  arc(r: number, angle: number): this {
    const sign = Math.sign(angle);
    const cx = this.x + r * Math.cos(this.h + (sign * Math.PI) / 2);
    const cz = this.z + r * Math.sin(this.h + (sign * Math.PI) / 2);
    const len = Math.abs(angle) * r;
    this.segs.push({ kind: 'arc', s0: this.length, len, x0: this.x, z0: this.z, h0: this.h, cx, cz, r, sign });
    const a = this.h - (sign * Math.PI) / 2 + angle;
    this.x = cx + r * Math.cos(a);
    this.z = cz + r * Math.sin(a);
    this.h += angle;
    this.length += len;
    return this;
  }

  wrap(s: number): number {
    const L = this.length;
    s %= L;
    return s < 0 ? s + L : s;
  }

  private segAt(s: number): Segment {
    const segs = this.segs;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].s0 <= s) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo];
  }

  pointAt(sIn: number, out: PathPoint = { x: 0, z: 0, heading: 0 }): PathPoint {
    const s = this.wrap(sIn);
    const g = this.segAt(s);
    const t = Math.min(g.len, Math.max(0, s - g.s0));
    if (g.kind === 'line') {
      out.x = g.x0 + Math.cos(g.h0) * t;
      out.z = g.z0 + Math.sin(g.h0) * t;
      out.heading = g.h0;
    } else {
      const phi = t / g.r;
      const a = g.h0 - (g.sign * Math.PI) / 2 + g.sign * phi;
      out.x = g.cx + g.r * Math.cos(a);
      out.z = g.cz + g.r * Math.sin(a);
      out.heading = g.h0 + g.sign * phi;
    }
    return out;
  }

  /** Arc-length of the closest point on the path (sampled; used only when the layout changes). */
  nearest(x: number, z: number, step = 0.05): number {
    let best = 0;
    let bestD = Infinity;
    const p: PathPoint = { x: 0, z: 0, heading: 0 };
    for (let s = 0; s < this.length; s += step) {
      this.pointAt(s, p);
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Evenly spaced points around the closed loop (the last point connects back to the first). */
  sample(step: number): PathPoint[] {
    const pts: PathPoint[] = [];
    const n = Math.max(8, Math.ceil(this.length / step));
    for (let i = 0; i < n; i++) pts.push(this.pointAt((i / n) * this.length));
    return pts;
  }
}
