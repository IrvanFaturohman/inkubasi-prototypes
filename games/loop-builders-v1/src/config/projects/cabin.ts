import type { ProjectDefinition } from '../../game/types';
import { box, gableRoofStrips, log, ProjectBuilder, sphere, splitSpan, cone } from './builder';

/**
 * Proyek 1 — Kabin Kayu Mungil (hutan).
 * Kabin log klasik: fondasi batu, dinding batang kayu bertumpuk, atap pelana merah
 * (bubungan sejajar sumbu x sehingga lereng depan menghadap kamera), teras depan, cerobong batu.
 * Koordinat lokal: y ke atas, +z menghadap lintasan.
 */
export function buildCabin(): ProjectDefinition {
  const b = new ProjectBuilder();
  const STONE = ['#bdb6aa', '#aea797'];
  const PLANK = ['#e6b877', '#d9a866'];
  const LOG = ['#c98b4f', '#b67943'];
  const TRIM = '#f6e7c8';
  const GLASS = '#a6dcf6';
  const SHUTTER = '#58a86a';
  const ROOF: [string, string] = ['#e05a42', '#cc4a34'];

  // --- Tahap 0: Fondasi -----------------------------------------------------
  const slabW = 4.4 / 3;
  for (const z of [0.83, -0.83]) {
    for (let i = 0; i < 3; i++) {
      const x = -4.4 / 2 + slabW * (i + 0.5);
      b.mod(0, 1, box([x, 0.18, z], [slabW - 0.04, 0.36, 1.62], STONE[(i + (z > 0 ? 0 : 1)) % 2], 0.05));
    }
  }
  for (let i = 0; i < 4; i++) {
    const z = 1.2 - i * 0.8;
    b.mod(0, 1.2, box([0, 0.4, z], [4.3, 0.08, 0.76], PLANK[i % 2], 0.02));
  }
  // Teras depan.
  b.mod(0, 1.2, [
    box([-1.3, 0.18, 2.1], [0.26, 0.36, 0.26], STONE[1], 0.04),
    box([1.3, 0.18, 2.1], [0.26, 0.36, 0.26], STONE[1], 0.04),
    box([0, 0.4, 1.9], [3.2, 0.08, 0.44], PLANK[1], 0.02),
  ]);
  b.mod(0, 1.2, box([0, 0.4, 2.36], [3.2, 0.08, 0.44], PLANK[0], 0.02));
  b.mod(0, 1, [box([0, 0.24, 2.78], [1.1, 0.16, 0.36], STONE[0], 0.04), box([0, 0.1, 3.08], [1.1, 0.1, 0.3], STONE[1], 0.04)]);

  // --- Tahap 1: Dinding batang kayu ----------------------------------------
  const R = 0.17;
  const rowY = (i: number) => 0.44 + R + i * 0.32;
  const FZ = 1.45; // dinding depan/belakang
  const SX = 1.95; // dinding samping
  // Bukaan: [min, max] sepanjang dinding, rows [r0, r1] inklusif.
  const frontHoles = [
    { span: [-0.5, 0.5] as [number, number], rows: [0, 4] },
    { span: [-1.55, -0.85] as [number, number], rows: [2, 3] },
    { span: [0.85, 1.55] as [number, number], rows: [2, 3] },
  ];
  const sideHoles = [{ span: [-0.4, 0.4] as [number, number], rows: [2, 3] }];
  const holesFor = (holes: typeof frontHoles, row: number) =>
    holes.filter((h) => row >= h.rows[0] && row <= h.rows[1]).map((h) => h.span);

  for (let row = 0; row < 6; row++) {
    const c = LOG[row % 2];
    const y = rowY(row);
    // depan
    b.mod(
      1,
      2.4,
      splitSpan(-2.2, 2.2, holesFor(frontHoles, row)).map(([a, e]) => log([(a + e) / 2, y, FZ], e - a, 'x', R, c)),
    );
    // kanan (sedikit lebih tinggi → kesan sambungan kabin)
    b.mod(
      1,
      2.4,
      splitSpan(-1.7, 1.7, holesFor(sideHoles, row)).map(([a, e]) => log([SX, y + 0.16, (a + e) / 2], e - a, 'z', R, LOG[(row + 1) % 2])),
    );
    // belakang
    b.mod(1, 2.4, log([0, y, -FZ], 4.4, 'x', R, c));
    // kiri
    b.mod(
      1,
      2.4,
      splitSpan(-1.7, 1.7, holesFor(sideHoles, row)).map(([a, e]) => log([-SX, y + 0.16, (a + e) / 2], e - a, 'z', R, LOG[(row + 1) % 2])),
    );
  }

  // --- Tahap 2: Rangka & bukaan --------------------------------------------
  // Pintu
  b.mod(2, 3, [
    box([-0.56, 1.26, FZ + 0.14], [0.1, 1.72, 0.1], TRIM),
    box([0.56, 1.26, FZ + 0.14], [0.1, 1.72, 0.1], TRIM),
    box([0, 2.14, FZ + 0.14], [1.22, 0.12, 0.12], TRIM),
    box([0, 1.24, FZ - 0.02], [1.0, 1.6, 0.08], '#3e8f7c', 0.04),
    box([0, 1.24, FZ + 0.03], [0.7, 0.08, 0.04], '#2f7566', 0.01),
    sphere([0.34, 1.2, FZ + 0.08], 0.06, '#ffd35a'),
  ]);
  const windowFront = (cx: number) => [
    box([cx, 1.44, FZ + 0.02], [0.7, 0.66, 0.06], GLASS, 0.01),
    box([cx, 1.83, FZ + 0.15], [0.86, 0.1, 0.12], TRIM),
    box([cx, 1.05, FZ + 0.15], [0.86, 0.1, 0.12], TRIM),
    box([cx - 0.38, 1.44, FZ + 0.15], [0.08, 0.72, 0.1], TRIM),
    box([cx + 0.38, 1.44, FZ + 0.15], [0.08, 0.72, 0.1], TRIM),
    box([cx, 1.44, FZ + 0.06], [0.05, 0.66, 0.05], TRIM),
    box([cx - 0.56, 1.44, FZ + 0.19], [0.24, 0.74, 0.05], SHUTTER),
    box([cx + 0.56, 1.44, FZ + 0.19], [0.24, 0.74, 0.05], SHUTTER),
  ];
  b.mod(2, 2.5, windowFront(-1.2));
  b.mod(2, 2.5, windowFront(1.2));
  const windowSide = (sx: number) => {
    const s = Math.sign(sx);
    const y = 1.6;
    return [
      box([sx, y, 0], [0.06, 0.66, 0.72], GLASS, 0.01),
      box([sx + s * 0.16, y + 0.39, 0], [0.12, 0.1, 0.9], TRIM),
      box([sx + s * 0.16, y - 0.39, 0], [0.12, 0.1, 0.9], TRIM),
      box([sx + s * 0.16, y, -0.4], [0.1, 0.72, 0.08], TRIM),
      box([sx + s * 0.16, y, 0.4], [0.1, 0.72, 0.08], TRIM),
      box([sx + s * 0.2, y, -0.58], [0.05, 0.74, 0.24], SHUTTER),
      box([sx + s * 0.2, y, 0.58], [0.05, 0.74, 0.24], SHUTTER),
    ];
  };
  b.mod(2, 2.5, windowSide(SX));
  b.mod(2, 2.5, windowSide(-SX));
  // Balok atas (top plate) depan/belakang supaya dinding bertemu atap.
  b.mod(2, 2, log([0, 2.55, FZ], 4.5, 'x', 0.15, LOG[0]));
  b.mod(2, 2, log([0, 2.55, -FZ], 4.5, 'x', 0.15, LOG[0]));
  // Segitiga gable di dinding samping (batang kayu memendek).
  const RIDGE_Y = 3.62;
  const EAVE_Y = 2.4;
  const HALF = 2.0;
  const halfAt = (y: number) => ((RIDGE_Y - y) / (RIDGE_Y - EAVE_Y)) * HALF - 0.12;
  for (let k = 0; k < 3; k++) {
    const y = 2.72 + k * 0.3;
    const h = halfAt(y + R * 0.5);
    for (const sx of [SX, -SX]) {
      b.mod(2, 1.8, log([sx, y, 0], h * 2, 'z', R * 0.95, LOG[k % 2]));
    }
  }

  // --- Tahap 3: Atap --------------------------------------------------------
  const strips = gableRoofStrips({
    ridgeAxis: 'x',
    cx: 0,
    cz: 0,
    length: 5.0,
    halfSpan: HALF,
    eaveY: EAVE_Y,
    ridgeY: RIDGE_Y,
    strips: 4,
    thickness: 0.14,
    colors: ROOF,
  });
  for (const s of strips) b.mod(3, 3.2, s.prim);
  b.mod(3, 2, box([0, RIDGE_Y + 0.1, 0], [5.1, 0.2, 0.2], '#a83a2a', 0.04, [Math.PI / 4, 0, 0]));

  // --- Tahap 4: Detail ------------------------------------------------------
  // Cerobong batu di sisi kanan luar.
  b.mod(4, 2.2, [box([SX + 0.42, 1.1, -0.55], [0.7, 2.2, 0.7], STONE[0], 0.06), box([SX + 0.42, 0.25, -0.55], [0.86, 0.5, 0.86], STONE[1], 0.06)]);
  b.mod(4, 2.2, [box([SX + 0.42, 3.2, -0.55], [0.52, 2.0, 0.52], STONE[1], 0.05), box([SX + 0.42, 4.25, -0.55], [0.66, 0.14, 0.66], '#8d8678', 0.03)]);
  // Tiang teras + atap teras.
  b.mod(4, 2.2, [log([-1.45, 1.3, 2.45], 1.75, 'y', 0.09, LOG[0]), log([1.45, 1.3, 2.45], 1.75, 'y', 0.09, LOG[0])]);
  b.mod(4, 2.2, [
    box([0, 2.28, 2.3], [3.4, 0.1, 0.9], ROOF[1], 0.03, [0.28, 0, 0]),
    log([0, 2.14, 2.5], 3.2, 'x', 0.08, LOG[1]),
  ]);
  // Lampu teras.
  b.mod(4, 2, [box([0.78, 1.72, FZ + 0.22], [0.08, 0.3, 0.08], '#3b3b3b', 0.01), sphere([0.78, 1.9, FZ + 0.3], 0.1, '#ffe08a')]);
  // Kotak bunga di bawah jendela depan.
  const flowerBox = (cx: number) => [
    box([cx, 0.96, FZ + 0.22], [0.82, 0.16, 0.2], '#9a6a3c', 0.03),
    sphere([cx - 0.24, 1.08, FZ + 0.22], 0.09, '#ff7aa2'),
    sphere([cx, 1.1, FZ + 0.22], 0.09, '#ffd24a'),
    sphere([cx + 0.24, 1.08, FZ + 0.22], 0.09, '#ff7aa2'),
  ];
  b.mod(4, 2, flowerBox(-1.2));
  b.mod(4, 2, flowerBox(1.2));
  // Tumpukan kayu bakar di sisi kiri.
  const pile = [];
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 3 - r; i++) {
      pile.push(log([-SX - 0.5, 0.14 + r * 0.22, -0.6 + i * 0.26 + r * 0.13], 0.7, 'x', 0.11, LOG[(i + r) % 2]));
    }
  }
  b.mod(4, 2, pile);
  // Pagar kecil + kotak surat.
  b.mod(4, 2, [
    box([-1.9, 0.35, 2.9], [0.08, 0.7, 0.08], TRIM),
    box([-1.3, 0.35, 2.9], [0.08, 0.7, 0.08], TRIM),
    box([-1.6, 0.5, 2.9], [0.7, 0.07, 0.05], TRIM),
    box([-1.6, 0.3, 2.9], [0.7, 0.07, 0.05], TRIM),
    box([1.8, 0.45, 2.95], [0.06, 0.9, 0.06], '#7a5230'),
    box([1.8, 0.95, 2.95], [0.26, 0.2, 0.36], '#e0503f', 0.06),
  ]);
  // Semak & bunga kecil di teras.
  b.mod(4, 2, [sphere([-2.4, 0.3, 1.6], 0.34, '#5fb34f'), sphere([-2.55, 0.22, 1.1], 0.26, '#4fa244'), cone([2.6, 0.02, 1.6], 0.28, 0.7, '#5fb34f')]);

  return {
    id: 'cabin',
    name: 'Kabin Kayu Mungil',
    material: 'wood',
    target: 460,
    stageNames: ['Fondasi', 'Dinding', 'Rangka & Bukaan', 'Atap', 'Detail'],
    stageBonus: [10, 20, 30, 40],
    completionBonus: 80,
    modules: b.modules,
  };
}
