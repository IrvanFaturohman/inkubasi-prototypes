// Small math and PRNG helpers shared by simulation and rendering.

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Frame-rate independent exponential approach factor. */
export const damp = (sharpness: number, dt: number): number => 1 - Math.exp(-sharpness * dt);

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export const easeOutBack = (t: number, s = 1.70158): number => {
  const x = t - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/** mulberry32: small deterministic PRNG used for seeded level generation. */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of two ints to [0,1) for cosmetic per-cell variation. */
export function hash2(a: number, b: number, seed = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + seed, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
