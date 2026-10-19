/** Angka singkat gaya Indonesia: 1234 → "1,2K". */
export function fmt(n: number): string {
  const v = Math.floor(n);
  if (Math.abs(v) < 1000) return String(v);
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [d, u] of units) {
    if (Math.abs(v) >= d) {
      const x = v / d;
      const s = Math.abs(x) >= 100 ? Math.floor(x).toString() : (Math.floor(x * 10) / 10).toString();
      return s.replace('.', ',') + u;
    }
  }
  return String(v);
}

/** Angka penuh dengan pemisah ribuan: 1200 → "1.200" (untuk progres material). */
export function fmtFull(n: number): string {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 1.25 → "1,3" */
export function fmtRate(r: number): string {
  return (Math.round(r * 10) / 10).toString().replace('.', ',');
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function coin(n: number): string {
  return `<span class="c">${fmt(n)}</span>`;
}
