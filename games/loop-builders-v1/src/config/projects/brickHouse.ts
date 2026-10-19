import type { Prim, ProjectDefinition } from '../../game/types';
import { box, cyl, ProjectBuilder, sphere, splitSpan } from './builder';

/**
 * Proyek 3 — Rumah Bata Kota.
 * Komposisi berbeda dari level kayu: rumah deret tiga lantai beratap datar dengan parapet,
 * dinding bata (susunan running bond), kusen putih, kanopi pintu hijau, tangki air di atap.
 * Tiap modul dinding = satu "pita" dua lapis bata; ghost memakai pita polos (tanpa detail bata)
 * supaya siluet tetap bersih.
 */
export function buildBrickHouse(): ProjectDefinition {
  const b = new ProjectBuilder();
  const BRICK = ['#c9563c', '#b94b34', '#d8664a', '#c05a44'];
  const MORTAR = '#eadfce';
  const CONCRETE = ['#cfd3d6', '#bfc4c8'];
  const TRIM = '#fbfaf5';
  const GLASS = '#8fc9ea';
  const AWNING = '#3aa877';

  const X0 = -2.5;
  const X1 = 2.5;
  const Z0 = -1.8;
  const Z1 = 1.8;
  const BASE = 0.3;
  const FLOOR = 1.7;
  const BAND = 0.34; // dua lapis bata per modul
  const BANDS = 5;
  const BRICK_H = 0.155;
  const BRICK_L = 0.44;
  const T = 0.16;

  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  type Hole = { span: [number, number]; bands: [number, number] };
  const holesAt = (holes: Hole[], band: number) => holes.filter((h) => band >= h.bands[0] && band <= h.bands[1]).map((h) => h.span);

  /** Satu pita dinding bata di bidang x (z tetap) atau z (x tetap). */
  const band = (axis: 'x' | 'z', plane: number, a: number, e: number, y0: number, bi: number, holes: Hole[], out: number, veneer = true): Prim[] => {
    const prims: Prim[] = [];
    const yc = y0 + BAND * (bi + 0.5);
    for (const [s0, s1] of splitSpan(a, e, holesAt(holes, bi), 0.005)) {
      const mid = (s0 + s1) / 2;
      const len = s1 - s0;
      prims.push(
        axis === 'x'
          ? box([mid, yc, plane], [len, BAND, T], veneer ? MORTAR : BRICK[bi % 2], 0)
          : box([plane, yc, mid], [T, BAND, len], veneer ? MORTAR : BRICK[bi % 2], 0),
      );
      if (!veneer) continue;
      // Bata tampak (running bond) sedikit menonjol dari adukan.
      for (let r = 0; r < 2; r++) {
        const y = y0 + BAND * bi + BRICK_H * 0.5 + 0.012 + r * (BAND / 2);
        const offset = (bi * 2 + r) % 2 === 0 ? 0 : BRICK_L / 2;
        let s = s0 - offset;
        while (s < s1 - 0.02) {
          const bs = Math.max(s, s0) + 0.012;
          const be = Math.min(s + BRICK_L, s1) - 0.012;
          if (be - bs > 0.06) {
            const c = BRICK[Math.floor(rnd() * BRICK.length)];
            const m = (bs + be) / 2;
            const depth = plane + out * (T / 2 + 0.02);
            prims.push({
              ...(axis === 'x' ? box([m, y, depth], [be - bs, BRICK_H, 0.05], c, 0) : box([depth, y, m], [0.05, BRICK_H, be - bs], c, 0)),
              noGhost: true,
            });
          }
          s += BRICK_L;
        }
      }
    }
    return prims;
  };

  // --- Tahap 0: Fondasi --------------------------------------------------------
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const w = (X1 - X0) / 3;
      const d = (Z1 - Z0) / 2;
      b.mod(0, 0.3, box([X0 + w * (i + 0.5), BASE / 2, Z1 - d * (j + 0.5)], [w - 0.03, BASE, d - 0.03], CONCRETE[(i + j) % 2], 0.03));
    }
  }
  b.mod(0, 1.2, [box([0, 0.2, Z1 + 0.35], [1.6, 0.2, 0.5], CONCRETE[0], 0.03), box([0, 0.08, Z1 + 0.75], [1.6, 0.12, 0.34], CONCRETE[1], 0.03)]);
  b.mod(0, 1.2, [box([-1.9, 0.04, Z1 + 0.6], [1.6, 0.08, 1.0], '#d9d4c8', 0.02), box([1.9, 0.04, Z1 + 0.6], [1.6, 0.08, 1.0], '#d9d4c8', 0.02)]);

  // --- Tahap 1: Dinding bata (lantai demi lantai) --------------------------------
  const frontHoles = (floor: number): Hole[] =>
    floor === 0
      ? [
          { span: [-0.5, 0.5], bands: [0, 3] },
          { span: [-2.0, -1.05], bands: [1, 3] },
          { span: [1.05, 2.0], bands: [1, 3] },
        ]
      : [
          { span: [-2.0, -1.2], bands: [1, 3] },
          { span: [-0.4, 0.4], bands: [1, 3] },
          { span: [1.2, 2.0], bands: [1, 3] },
        ];
  const sideHoles: Hole[] = [{ span: [-0.4, 0.4], bands: [1, 3] }];
  for (let f = 0; f < 3; f++) {
    const y0 = BASE + f * FLOOR;
    for (let bi = 0; bi < BANDS; bi++) {
      b.mod(1, 2.4, band('x', Z1 - T / 2, X0, X1, y0, bi, frontHoles(f), 1));
      b.mod(1, 2.2, band('z', X1 - T / 2, Z0, Z1 - T, y0, bi, sideHoles, 1));
      b.mod(1, 1.6, band('x', Z0 + T / 2, X0, X1, y0, bi, [], -1, false));
      b.mod(1, 2.2, band('z', X0 + T / 2, Z0, Z1 - T, y0, bi, sideHoles, -1));
    }
    if (f < 2) {
      // Pelat lantai berikutnya.
      b.mod(1, 2, box([0, y0 + FLOOR - 0.05, 0], [X1 - X0 - 0.1, 0.1, Z1 - Z0 - 0.1], CONCRETE[1], 0.02));
    }
  }

  // --- Tahap 2: Kusen, pintu, list lantai ---------------------------------------
  const winFront = (x0: number, x1: number, y0: number): Prim[] => {
    const cx = (x0 + x1) / 2;
    const w = x1 - x0;
    const yb = y0 + BAND;
    const yt = y0 + BAND * 4;
    const cy = (yb + yt) / 2;
    const h = yt - yb;
    const z = Z1 - T / 2;
    return [
      box([cx, cy, z], [w, h, 0.05], GLASS, 0),
      box([cx, yt + 0.06, z + 0.12], [w + 0.18, 0.12, 0.1], TRIM, 0.02),
      box([cx, yb - 0.05, z + 0.14], [w + 0.24, 0.1, 0.16], TRIM, 0.02),
      box([x0 + 0.04, cy, z + 0.1], [0.08, h, 0.06], TRIM, 0),
      box([x1 - 0.04, cy, z + 0.1], [0.08, h, 0.06], TRIM, 0),
      box([cx, cy, z + 0.06], [0.05, h, 0.04], TRIM, 0),
      box([cx, cy + h * 0.18, z + 0.06], [w, 0.05, 0.04], TRIM, 0),
    ];
  };
  const winSide = (sx: number, out: number, y0: number): Prim[] => {
    const yb = y0 + BAND;
    const yt = y0 + BAND * 4;
    const cy = (yb + yt) / 2;
    const h = yt - yb;
    return [
      box([sx, cy, 0], [0.05, h, 0.8], GLASS, 0),
      box([sx + out * 0.12, yt + 0.06, 0], [0.1, 0.12, 0.98], TRIM, 0.02),
      box([sx + out * 0.14, yb - 0.05, 0], [0.16, 0.1, 1.02], TRIM, 0.02),
      box([sx + out * 0.06, cy, 0], [0.04, h, 0.05], TRIM, 0),
    ];
  };
  b.mod(2, 3, [
    box([0, BASE + 0.66, Z1 - T / 2], [1.0, 1.32, 0.08], '#2f7d5b', 0.03),
    box([0, BASE + 0.66, Z1 - T / 2 + 0.05], [0.7, 1.0, 0.03], '#276a4d', 0.02),
    box([0, BASE + 1.4, Z1 + 0.02], [1.24, 0.14, 0.12], TRIM, 0.02),
    box([-0.56, BASE + 0.68, Z1 + 0.02], [0.12, 1.36, 0.1], TRIM, 0),
    box([0.56, BASE + 0.68, Z1 + 0.02], [0.12, 1.36, 0.1], TRIM, 0),
    sphere([0.3, BASE + 0.66, Z1 + 0.0], 0.05, '#ffd35a'),
  ]);
  b.mod(2, 2.4, winFront(-2.0, -1.05, BASE));
  b.mod(2, 2.4, winFront(1.05, 2.0, BASE));
  b.mod(2, 2, [...winSide(X1 - T / 2, 1, BASE), ...winSide(X0 + T / 2, -1, BASE)]);
  b.mod(2, 2, box([0, BASE + FLOOR, Z1 + 0.04], [X1 - X0 + 0.2, 0.16, 0.14], TRIM, 0.02));
  for (let f = 1; f < 3; f++) {
    const y0 = BASE + f * FLOOR;
    b.mod(2, 2.4, winFront(-2.0, -1.2, y0));
    b.mod(2, 2.4, winFront(-0.4, 0.4, y0));
    b.mod(2, 2.4, winFront(1.2, 2.0, y0));
    b.mod(2, 2, [...winSide(X1 - T / 2, 1, y0), ...winSide(X0 + T / 2, -1, y0)]);
    if (f === 1) b.mod(2, 2, box([0, BASE + FLOOR * 2, Z1 + 0.04], [X1 - X0 + 0.2, 0.16, 0.14], TRIM, 0.02));
  }
  // Batu sudut (quoin) krem di keempat sudut depan.
  const quoins: Prim[] = [];
  for (let k = 0; k < 9; k++) {
    const y = BASE + 0.28 + k * 0.56;
    const w = k % 2 === 0 ? 0.36 : 0.24;
    quoins.push(box([X0 + w / 2 - 0.02, y, Z1 + 0.01], [w, 0.24, 0.06], '#efe3cc', 0.01));
    quoins.push(box([X1 - w / 2 + 0.02, y, Z1 + 0.01], [w, 0.24, 0.06], '#efe3cc', 0.01));
  }
  b.mod(2, 2.4, quoins);

  // --- Tahap 3: Atap datar + parapet --------------------------------------------
  const TOP = BASE + FLOOR * 3;
  for (let i = 0; i < 3; i++) {
    const d = (Z1 - Z0) / 3;
    b.mod(3, 2.6, box([0, TOP + 0.07, Z1 - d * (i + 0.5)], [X1 - X0 + 0.06, 0.14, d + 0.02], i % 2 ? '#8b9096' : '#7e848b', 0.02));
  }
  const PH = 0.5;
  b.mod(3, 2.6, band('x', Z1 - T / 2, X0, X1, TOP + 0.14, 0, [], 1).concat([box([0, TOP + 0.14 + BAND + 0.07, Z1 - T / 2], [X1 - X0 + 0.12, 0.14, T + 0.1], TRIM, 0.02)]));
  b.mod(3, 2.2, [box([X1 - T / 2, TOP + 0.14 + PH / 2, 0], [T, PH, Z1 - Z0], BRICK[1], 0), box([X1 - T / 2, TOP + 0.14 + PH + 0.04, 0], [T + 0.08, 0.08, Z1 - Z0 + 0.04], TRIM, 0.02)]);
  b.mod(3, 2.2, [box([X0 + T / 2, TOP + 0.14 + PH / 2, 0], [T, PH, Z1 - Z0], BRICK[1], 0), box([X0 + T / 2, TOP + 0.14 + PH + 0.04, 0], [T + 0.08, 0.08, Z1 - Z0 + 0.04], TRIM, 0.02)]);
  b.mod(3, 2, box([0, TOP + 0.14 + PH / 2, Z0 + T / 2], [X1 - X0, PH, T], BRICK[0], 0));
  // Cornice dekoratif depan
  const dentils: Prim[] = [box([0, TOP - 0.06, Z1 + 0.1], [X1 - X0 + 0.3, 0.14, 0.24], TRIM, 0.02)];
  for (let i = 0; i < 16; i++) dentils.push(box([X0 + 0.16 + i * 0.312, TOP - 0.2, Z1 + 0.06], [0.14, 0.12, 0.14], TRIM, 0));
  b.mod(3, 2.4, dentils);

  // --- Tahap 4: Detail -----------------------------------------------------------
  // Kanopi pintu bergaris
  const awning: Prim[] = [];
  for (let i = 0; i < 6; i++) {
    awning.push(box([-0.7 + 0.28 * i, BASE + 1.62, Z1 + 0.32], [0.28, 0.06, 0.72], i % 2 ? '#ffffff' : AWNING, 0.01, [0.35, 0, 0]));
  }
  b.mod(4, 2.4, awning);
  // Kotak bunga jendela lantai 2
  for (const cx of [-1.6, 0, 1.6]) {
    b.mod(4, 2, [
      box([cx, BASE + FLOOR + BAND - 0.18, Z1 + 0.2], [0.8, 0.16, 0.22], '#6d4c3d', 0.03),
      sphere([cx - 0.22, BASE + FLOOR + BAND - 0.06, Z1 + 0.2], 0.09, '#ff6f91'),
      sphere([cx, BASE + FLOOR + BAND - 0.04, Z1 + 0.2], 0.1, '#6fcf5f'),
      sphere([cx + 0.22, BASE + FLOOR + BAND - 0.06, Z1 + 0.2], 0.09, '#ffd24a'),
    ]);
  }
  // Tangki air di atap
  b.mod(4, 2.6, [
    cyl([1.2, TOP + 1.0, -0.6], 0.9, 'y', 0.45, '#b98a5a', 14),
    { kind: 'cone', p: [1.2, TOP + 1.45, -0.6], radius: 0.52, h: 0.4, c: '#8a6440', seg: 14 },
    box([1.2, TOP + 0.36, -0.6], [0.9, 0.44, 0.9], '#6b7280', 0.02),
  ]);
  // Unit AC + ventilasi
  b.mod(4, 2, [box([-1.3, TOP + 0.36, -0.5], [0.7, 0.44, 0.5], '#e5e7eb', 0.05), cyl([-1.3, TOP + 0.6, -0.5], 0.04, 'y', 0.16, '#9ca3af', 12)]);
  // Lampu dinding + nomor rumah
  b.mod(4, 2, [
    box([-0.82, BASE + 1.2, Z1 + 0.08], [0.1, 0.28, 0.1], '#2d3748', 0.02),
    sphere([-0.82, BASE + 1.38, Z1 + 0.14], 0.09, '#ffe08a'),
    box([0.82, BASE + 1.25, Z1 + 0.05], [0.3, 0.22, 0.04], '#1f4e79', 0.02),
  ]);
  // Tangga darurat samping kanan
  const ladder: Prim[] = [];
  for (let f = 1; f < 3; f++) {
    const y = BASE + f * FLOOR + 0.05;
    ladder.push(box([X1 + 0.35, y, 0], [0.6, 0.06, 1.3], '#374151', 0.01));
    ladder.push(box([X1 + 0.63, y + 0.35, 0], [0.04, 0.04, 1.3], '#374151', 0));
  }
  ladder.push(box([X1 + 0.6, BASE + FLOOR * 1.5, 0.55], [0.05, FLOOR * 1.1, 0.05], '#374151', 0));
  ladder.push(box([X1 + 0.6, BASE + FLOOR * 1.5, 0.3], [0.05, FLOOR * 1.1, 0.05], '#374151', 0));
  b.mod(4, 2.4, ladder);
  // Pot tanaman di tangga depan
  b.mod(4, 2, [
    box([-1.0, 0.25, Z1 + 0.45], [0.36, 0.42, 0.36], '#9aa3ad', 0.05),
    sphere([-1.0, 0.62, Z1 + 0.45], 0.26, '#4fa244'),
    box([1.0, 0.25, Z1 + 0.45], [0.36, 0.42, 0.36], '#9aa3ad', 0.05),
    sphere([1.0, 0.62, Z1 + 0.45], 0.26, '#4fa244'),
  ]);

  return {
    id: 'brickhouse',
    name: 'Rumah Bata Kota',
    material: 'brick',
    target: 1800,
    stageNames: ['Fondasi', 'Dinding Bata', 'Kusen & Bukaan', 'Atap', 'Detail'],
    stageBonus: [80, 160, 200, 240],
    completionBonus: 600,
    modules: b.modules,
  };
}
