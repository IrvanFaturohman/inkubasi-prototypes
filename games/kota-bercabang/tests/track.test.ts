import { describe, expect, it } from 'vitest';
import { buildStageMapping, computeCrossings, TrackPath } from '../src/game/track';

const rect = (top: number, bottom: number, hw: number, r: number) =>
  new TrackPath({
    corners: [
      [0, top],
      [hw, top],
      [hw, bottom],
      [-hw, bottom],
      [-hw, top],
    ],
    radius: r,
  });

describe('TrackPath', () => {
  it('punya panjang eksak persegi membulat & mulai di titik bongkar', () => {
    const t = rect(-4, 1, 3, 1);
    const expected = 2 * (6 + 5) - (8 - 2 * Math.PI) * 1;
    expect(t.length).toBeCloseTo(expected, 6);
    const p = t.pointAt(0);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-4);
    // arah awal ke kanan (+x) karena searah jarum jam di layar
    const tan = t.tangentAt(0.01);
    expect(tan.x).toBeCloseTo(1);
    expect(t.clockwise).toBe(true);
    // normal luar di ruas atas mengarah ke -z (atas layar)
    expect(t.outwardAt(0.01).z).toBeCloseTo(-1);
  });

  it('kontinu di sepanjang loop (tidak ada lompatan posisi)', () => {
    const t = rect(-4, 1, 3, 1.4);
    let prev = t.pointAt(0);
    for (let d = 0.05; d <= t.length + 0.05; d += 0.05) {
      const p = t.pointAt(d);
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(0.051);
      prev = p;
    }
  });
});

describe('computeCrossings', () => {
  const pts = [
    { d: 0, data: 'bongkar' },
    { d: 5, data: 'A' },
    { d: 12, data: 'B' },
  ];

  it('memakai interval setengah-terbuka (prev, prev+move]', () => {
    expect(computeCrossings(4, 1, 20, pts).map((p) => p.data)).toEqual(['A']);
    // mulai tepat di titik → tidak terpicu lagi
    expect(computeCrossings(5, 1, 20, pts)).toEqual([]);
    expect(computeCrossings(4.9, 0.05, 20, pts)).toEqual([]);
  });

  it('menangani wrap di ujung putaran dan urutan', () => {
    const got = computeCrossings(19, 7, 20, pts).map((p) => p.data);
    expect(got).toEqual(['bongkar', 'A']);
  });

  it('langkah besar (boost) tidak melompati trigger dan urutannya benar', () => {
    const got = computeCrossings(1, 15, 20, pts).map((p) => p.data);
    expect(got).toEqual(['A', 'B']);
    const lap = computeCrossings(13, 19.99, 20, pts).map((p) => p.data);
    expect(lap).toEqual(['bongkar', 'A', 'B']);
  });

  it('total pemicu = jumlah putaran × titik, apa pun ukuran langkahnya', () => {
    for (const stepSize of [0.01, 0.37, 1.9, 7.3]) {
      let d = 0.5;
      const hits: string[] = [];
      let travelled = 0;
      while (travelled < 20 * 3) {
        const move = Math.min(stepSize, 20 * 3 - travelled);
        hits.push(...computeCrossings(d, move, 20, pts).map((p) => p.data));
        d = (d + move) % 20;
        travelled += move;
      }
      expect(hits.filter((h) => h === 'bongkar').length).toBe(3);
      expect(hits.filter((h) => h === 'A').length).toBe(3);
      expect(hits.filter((h) => h === 'B').length).toBe(3);
    }
  });
});

describe('StageMapping', () => {
  it('bagian lintasan yang sama dipetakan 1:1, sisanya proporsional & monoton', () => {
    const a = rect(-4, 1, 3, 1.4);
    const b = rect(-4, 5, 3, 1.4);
    const m = buildStageMapping(a, b, [{ x: 4.2, z: -2 }]);
    expect(m.map(0)).toBeCloseTo(0);
    // titik di sisi kanan atas (tidak berubah) tetap di posisi dunia yang sama
    for (const d of [1, 3, 4.5]) {
      const pa = a.pointAt(d);
      const pb = b.pointAt(m.map(d));
      expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeLessThan(0.02);
    }
    // ujung loop juga identik (sisi kiri atas)
    const dEnd = a.length - 1;
    const pa = a.pointAt(dEnd);
    const pb = b.pointAt(m.map(dEnd));
    expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeLessThan(0.02);
    let prev = -1;
    for (let d = 0; d < a.length; d += 0.1) {
      const x = m.map(d);
      expect(x).toBeGreaterThan(prev);
      expect(x).toBeLessThan(b.length);
      prev = x;
    }
  });
});
