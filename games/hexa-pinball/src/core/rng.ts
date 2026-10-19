/** mulberry32: tiny seeded PRNG, identical in browser and Node. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  weighted(pairs: [number, number][]): number {
    let total = 0;
    for (const [, w] of pairs) total += w;
    let x = this.next() * total;
    for (const [v, w] of pairs) {
      x -= w;
      if (x < 0) return v;
    }
    return pairs[pairs.length - 1][0];
  }
}
