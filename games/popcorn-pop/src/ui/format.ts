const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];

/** 1,234 · 12.3K · 4.56M */
export function fmt(n: number): string {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString('en-US');
  let i = 0;
  let v = n;
  while (v >= 1000 && i < SUFFIX.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${(Math.floor(v * 10 ** digits) / 10 ** digits).toFixed(digits)}${SUFFIX[i]}`;
}

/** Rates: 0.85 · 4.3 · 12 · 1.2K */
export function fmtRate(n: number): string {
  if (n < 1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  return fmt(n);
}

export function fmtDuration(sec: number): string {
  const s = Math.floor(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
