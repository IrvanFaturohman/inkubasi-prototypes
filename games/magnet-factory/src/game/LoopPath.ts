// Stadium-shaped closed loop, travelled clockwise on screen (top run moves right).
// s = arc length from the left end of the top run.

export interface PathPoint {
  x: number;
  y: number;
  tx: number; // unit tangent (direction of travel)
  ty: number;
}

export class LoopPath {
  readonly length: number;

  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly a: number, // half length of a straight run
    readonly r: number, // end radius
  ) {
    this.length = 4 * a + 2 * Math.PI * r;
  }

  at(sIn: number, out: PathPoint = { x: 0, y: 0, tx: 1, ty: 0 }): PathPoint {
    const { cx, cy, a, r } = this;
    const L = this.length;
    let s = sIn % L;
    if (s < 0) s += L;
    const top = 2 * a;
    const arc = Math.PI * r;
    if (s < top) {
      out.x = cx - a + s; out.y = cy - r; out.tx = 1; out.ty = 0;
    } else if (s < top + arc) {
      const th = -Math.PI / 2 + (s - top) / r;
      out.x = cx + a + r * Math.cos(th); out.y = cy + r * Math.sin(th);
      out.tx = -Math.sin(th); out.ty = Math.cos(th);
    } else if (s < 2 * top + arc) {
      out.x = cx + a - (s - top - arc); out.y = cy + r; out.tx = -1; out.ty = 0;
    } else {
      const th = Math.PI / 2 + (s - 2 * top - arc) / r;
      out.x = cx - a + r * Math.cos(th); out.y = cy + r * Math.sin(th);
      out.tx = -Math.sin(th); out.ty = Math.cos(th);
    }
    return out;
  }
}
