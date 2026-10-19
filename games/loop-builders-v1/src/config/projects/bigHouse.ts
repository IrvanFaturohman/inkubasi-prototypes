import type { Prim, ProjectDefinition } from '../../game/types';
import { box, gableRoofStrips, ProjectBuilder, sphere, splitSpan, cone } from './builder';

/**
 * Proyek 2 — Rumah Kayu Dua Lantai (pinggir hutan).
 * Siluet berbeda dari kabin: blok utama dua lantai dengan gable menghadap depan,
 * sayap satu lantai di kiri, teras + balkon, dinding papan (siding) warna madu dan atap teal.
 */
export function buildBigHouse(): ProjectDefinition {
  const b = new ProjectBuilder();
  const STONE = ['#bdb6aa', '#aba493'];
  const DECK = ['#cf9a62', '#c28d56'];
  const SIDING = ['#f3d192', '#e7c27f'];
  const TRIM = '#ffffff';
  const GLASS = '#a6dcf6';
  const ROOF: [string, string] = ['#2f8f8c', '#277a78'];
  const DOOR = '#d9534a';

  // Geometri blok
  const MAIN = { x0: -0.7, x1: 3.3, z0: -1.8, z1: 1.8 };
  const WING = { x0: -3.3, x1: -0.7, z0: -1.3, z1: 1.5 };
  const Y0 = 0.4;
  const STORY = 1.9;
  const Y2 = Y0 + STORY + 0.12; // lantai 2
  const ROW_H = 0.38;
  const T = 0.1; // tebal papan

  type Hole = { span: [number, number]; rows: [number, number] };
  const holesAt = (holes: Hole[], row: number) => holes.filter((h) => row >= h.rows[0] && row <= h.rows[1]).map((h) => h.span);

  /** Satu baris papan pada dinding yang sejajar sumbu x (z tetap) atau sumbu z (x tetap). */
  const sidingRow = (axis: 'x' | 'z', plane: number, a: number, e: number, yBase: number, row: number, holes: Hole[], outward: number): Prim[] => {
    const y = yBase + ROW_H * (row + 0.5);
    const c = SIDING[row % 2];
    return splitSpan(a, e, holesAt(holes, row)).map(([s0, s1]) => {
      const mid = (s0 + s1) / 2;
      const len = s1 - s0;
      return axis === 'x'
        ? box([mid, y, plane + outward * 0.01 * (row % 2)], [len, ROW_H + 0.02, T], c, 0.02)
        : box([plane + outward * 0.01 * (row % 2), y, mid], [T, ROW_H + 0.02, len], c, 0.02);
    });
  };

  // --- Tahap 0: Fondasi ------------------------------------------------------
  const mainW = MAIN.x1 - MAIN.x0;
  const mainD = MAIN.z1 - MAIN.z0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const x = MAIN.x0 + mainW * (i + 0.5) * 0.5;
      const z = MAIN.z1 - mainD * (j + 0.5) * 0.5;
      b.mod(0, 0.35, box([x, Y0 / 2, z], [mainW / 2 - 0.04, Y0, mainD / 2 - 0.04], STONE[(i + j) % 2], 0.05));
    }
  }
  const wingW = WING.x1 - WING.x0;
  const wingD = WING.z1 - WING.z0;
  for (let j = 0; j < 2; j++) {
    const z = WING.z1 - wingD * (j + 0.5) * 0.5;
    b.mod(0, 0.5, box([(WING.x0 + WING.x1) / 2, Y0 / 2, z], [wingW - 0.04, Y0, wingD / 2 - 0.04], STONE[j % 2], 0.05));
  }
  for (let i = 0; i < 3; i++) {
    const z = MAIN.z1 - mainD * (i + 0.5) / 3;
    b.mod(0, 1.2, box([(MAIN.x0 + MAIN.x1) / 2, Y0 + 0.04, z], [mainW, 0.08, mainD / 3 - 0.03], DECK[i % 2], 0.02));
  }
  b.mod(0, 1.2, box([(WING.x0 + WING.x1) / 2, Y0 + 0.04, (WING.z0 + WING.z1) / 2], [wingW, 0.08, wingD], DECK[1], 0.02));
  // Teras
  const PORCH = { x0: 0.1, x1: 3.2, z0: MAIN.z1, z1: MAIN.z1 + 1.15 };
  b.mod(0, 1.2, [
    box([PORCH.x0 + 0.15, Y0 / 2, PORCH.z1 - 0.15], [0.26, Y0, 0.26], STONE[1], 0.04),
    box([PORCH.x1 - 0.15, Y0 / 2, PORCH.z1 - 0.15], [0.26, Y0, 0.26], STONE[1], 0.04),
    box([(PORCH.x0 + PORCH.x1) / 2, Y0 + 0.04, (PORCH.z0 + PORCH.z1) / 2], [PORCH.x1 - PORCH.x0, 0.08, PORCH.z1 - PORCH.z0], DECK[0], 0.02),
  ]);
  b.mod(0, 1, [
    box([1.3, 0.28, PORCH.z1 + 0.2], [1.2, 0.16, 0.38], STONE[0], 0.04),
    box([1.3, 0.12, PORCH.z1 + 0.52], [1.2, 0.12, 0.32], STONE[1], 0.04),
  ]);

  // --- Tahap 1: Dinding (lantai 1 → sayap → lantai 2) --------------------------
  const DOOR_SPAN: [number, number] = [0.95, 1.65];
  const mainFront1: Hole[] = [
    { span: DOOR_SPAN, rows: [0, 3] },
    { span: [-0.35, 0.45], rows: [1, 3] },
    { span: [2.2, 2.95], rows: [1, 3] },
  ];
  const mainSide1: Hole[] = [{ span: [-0.45, 0.45], rows: [1, 3] }];
  const wingFront: Hole[] = [{ span: [-2.65, -1.35], rows: [1, 3] }];
  const wingSide: Hole[] = [{ span: [-0.35, 0.55], rows: [1, 3] }];
  for (let row = 0; row < 5; row++) {
    b.mod(1, 2.4, sidingRow('x', MAIN.z1, MAIN.x0 - 0.05, MAIN.x1 + 0.05, Y0, row, mainFront1, 1));
    b.mod(1, 2.4, sidingRow('z', MAIN.x1, MAIN.z0, MAIN.z1, Y0, row, mainSide1, 1));
    b.mod(1, 2.0, sidingRow('x', MAIN.z0, MAIN.x0 - 0.05, MAIN.x1 + 0.05, Y0, row, [], -1));
    b.mod(1, 1.6, sidingRow('z', MAIN.x0, MAIN.z0, MAIN.z1, Y0, row, [], -1));
  }
  for (let row = 0; row < 5; row++) {
    b.mod(1, 2.0, sidingRow('x', WING.z1, WING.x0 - 0.05, WING.x1, Y0, row, wingFront, 1));
    b.mod(1, 2.0, sidingRow('z', WING.x0, WING.z0, WING.z1, Y0, row, wingSide, -1));
    b.mod(1, 1.8, sidingRow('x', WING.z0, WING.x0 - 0.05, WING.x1, Y0, row, [], -1));
  }
  // Lantai 2 (dek)
  b.mod(1, 2, box([(MAIN.x0 + MAIN.x1) / 2, Y2 - 0.06, MAIN.z1 - mainD / 4], [mainW + 0.1, 0.12, mainD / 2], DECK[0], 0.02));
  b.mod(1, 2, box([(MAIN.x0 + MAIN.x1) / 2, Y2 - 0.06, MAIN.z0 + mainD / 4], [mainW + 0.1, 0.12, mainD / 2], DECK[1], 0.02));
  const mainFront2: Hole[] = [
    { span: DOOR_SPAN, rows: [0, 3] },
    { span: [-0.3, 0.5], rows: [1, 3] },
    { span: [2.15, 2.95], rows: [1, 3] },
  ];
  const mainSide2: Hole[] = [{ span: [-0.45, 0.45], rows: [1, 3] }];
  for (let row = 0; row < 5; row++) {
    b.mod(1, 2.4, sidingRow('x', MAIN.z1, MAIN.x0 - 0.05, MAIN.x1 + 0.05, Y2, row, mainFront2, 1));
    b.mod(1, 2.4, sidingRow('z', MAIN.x1, MAIN.z0, MAIN.z1, Y2, row, mainSide2, 1));
    b.mod(1, 2.0, sidingRow('x', MAIN.z0, MAIN.x0 - 0.05, MAIN.x1 + 0.05, Y2, row, [], -1));
    b.mod(1, 2.0, sidingRow('z', MAIN.x0, MAIN.z0, MAIN.z1, Y2, row, mainSide2, -1));
  }

  // --- Tahap 2: Rangka & bukaan ------------------------------------------------
  const winX = (x0: number, x1: number, yb: number, z: number, out: number): Prim[] => {
    const cx = (x0 + x1) / 2;
    const w = x1 - x0;
    const y0 = yb + ROW_H;
    const y1 = yb + ROW_H * 4;
    const cy = (y0 + y1) / 2;
    const h = y1 - y0;
    const zf = z + out * 0.08;
    return [
      box([cx, cy, z], [w, h, 0.05], GLASS, 0.01),
      box([cx, y1 + 0.05, zf], [w + 0.2, 0.1, 0.1], TRIM),
      box([cx, y0 - 0.05, zf + out * 0.03], [w + 0.26, 0.1, 0.16], TRIM),
      box([x0 - 0.04, cy, zf], [0.08, h, 0.08], TRIM),
      box([x1 + 0.04, cy, zf], [0.08, h, 0.08], TRIM),
      box([cx, cy, z + out * 0.03], [0.05, h, 0.04], TRIM),
      box([cx, cy, z + out * 0.03], [w, 0.05, 0.04], TRIM),
    ];
  };
  const winZ = (z0: number, z1: number, yb: number, x: number, out: number): Prim[] => {
    const cz = (z0 + z1) / 2;
    const w = z1 - z0;
    const y0 = yb + ROW_H;
    const y1 = yb + ROW_H * 4;
    const cy = (y0 + y1) / 2;
    const h = y1 - y0;
    const xf = x + out * 0.08;
    return [
      box([x, cy, cz], [0.05, h, w], GLASS, 0.01),
      box([xf, y1 + 0.05, cz], [0.1, 0.1, w + 0.2], TRIM),
      box([xf + out * 0.03, y0 - 0.05, cz], [0.16, 0.1, w + 0.26], TRIM),
      box([xf, cy, z0 - 0.04], [0.08, h, 0.08], TRIM),
      box([xf, cy, z1 + 0.04], [0.08, h, 0.08], TRIM),
      box([x + out * 0.03, cy, cz], [0.04, h, 0.05], TRIM),
    ];
  };
  // Pintu depan
  b.mod(2, 3, [
    box([1.3, Y0 + 0.76, MAIN.z1], [0.7, 1.5, 0.08], DOOR, 0.03),
    box([1.3, Y0 + 1.56, MAIN.z1 + 0.08], [0.92, 0.12, 0.12], TRIM),
    box([0.9, Y0 + 0.76, MAIN.z1 + 0.08], [0.1, 1.56, 0.1], TRIM),
    box([1.7, Y0 + 0.76, MAIN.z1 + 0.08], [0.1, 1.56, 0.1], TRIM),
    sphere([1.52, Y0 + 0.74, MAIN.z1 + 0.07], 0.05, '#ffd35a'),
    box([1.3, Y0 + 1.1, MAIN.z1 + 0.05], [0.36, 0.36, 0.03], GLASS, 0.01),
  ]);
  b.mod(2, 2.5, winX(-0.35, 0.45, Y0, MAIN.z1, 1));
  b.mod(2, 2.5, winX(2.2, 2.95, Y0, MAIN.z1, 1));
  b.mod(2, 2.5, winZ(-0.45, 0.45, Y0, MAIN.x1, 1));
  b.mod(2, 2.5, winX(-2.65, -1.35, Y0, WING.z1, 1));
  b.mod(2, 2.5, winZ(-0.35, 0.55, Y0, WING.x0, -1));
  // Lantai 2
  b.mod(2, 3, [
    box([1.3, Y2 + 0.76, MAIN.z1], [0.7, 1.5, 0.06], GLASS, 0.01),
    box([1.3, Y2 + 1.56, MAIN.z1 + 0.08], [0.92, 0.12, 0.12], TRIM),
    box([0.9, Y2 + 0.76, MAIN.z1 + 0.08], [0.1, 1.56, 0.1], TRIM),
    box([1.7, Y2 + 0.76, MAIN.z1 + 0.08], [0.1, 1.56, 0.1], TRIM),
    box([1.3, Y2 + 0.76, MAIN.z1 + 0.04], [0.05, 1.5, 0.04], TRIM),
  ]);
  b.mod(2, 2.5, winX(-0.3, 0.5, Y2, MAIN.z1, 1));
  b.mod(2, 2.5, winX(2.15, 2.95, Y2, MAIN.z1, 1));
  b.mod(2, 2.5, winZ(-0.45, 0.45, Y2, MAIN.x1, 1));
  b.mod(2, 2.5, winZ(-0.45, 0.45, Y2, MAIN.x0, -1));
  // List sudut (corner boards)
  const cornerBoards = (pts: [number, number][], h: number): Prim[] => pts.map(([x, z]) => box([x, Y0 + h / 2, z], [0.16, h, 0.16], TRIM, 0.02));
  b.mod(2, 2, cornerBoards([[MAIN.x1, MAIN.z1], [MAIN.x0, MAIN.z1], [MAIN.x1, MAIN.z0], [MAIN.x0, MAIN.z0]], Y2 - Y0 + STORY));
  b.mod(2, 1.6, [
    ...cornerBoards([[WING.x0, WING.z1], [WING.x0, WING.z0]], STORY),
    box([(MAIN.x0 + MAIN.x1) / 2, Y2 - 0.02, MAIN.z1 + 0.06], [mainW + 0.2, 0.14, 0.14], TRIM),
  ]);
  // Gable depan & belakang (atap bubungan sejajar z)
  const RIDGE_Y = 5.62;
  const EAVE_Y = 4.0;
  const HALF = 2.35;
  const cxMain = (MAIN.x0 + MAIN.x1) / 2;
  const Y3 = Y2 + STORY; // puncak dinding lantai 2
  const halfAt = (y: number) => ((RIDGE_Y - y) / (RIDGE_Y - EAVE_Y)) * HALF - 0.1;
  const atticHole: [number, number] = [cxMain - 0.3, cxMain + 0.3];
  for (const [z, out] of [
    [MAIN.z1, 1],
    [MAIN.z0, -1],
  ] as const) {
    for (let k = 0; k < 3; k++) {
      const y = Y3 + ROW_H * (k + 0.5);
      const h = halfAt(y + ROW_H / 2);
      const holes = out > 0 && k < 2 ? [atticHole] : [];
      b.mod(
        2,
        1.8,
        splitSpan(cxMain - h, cxMain + h, holes).map(([a, e]) => box([(a + e) / 2, y, z + out * 0.01 * k], [e - a, ROW_H + 0.02, T], SIDING[k % 2], 0.02)),
      );
    }
  }
  b.mod(2, 2, [
    box([cxMain, Y3 + ROW_H, MAIN.z1], [0.6, 0.72, 0.05], GLASS, 0.01),
    box([cxMain, Y3 + ROW_H * 2 + 0.05, MAIN.z1 + 0.07], [0.8, 0.1, 0.1], TRIM),
    box([cxMain, Y3 + 0.02, MAIN.z1 + 0.07], [0.8, 0.1, 0.1], TRIM),
    box([cxMain - 0.34, Y3 + ROW_H, MAIN.z1 + 0.07], [0.08, 0.76, 0.08], TRIM),
    box([cxMain + 0.34, Y3 + ROW_H, MAIN.z1 + 0.07], [0.08, 0.76, 0.08], TRIM),
  ]);
  // Gable sayap (sisi kiri) — atap sayap bubungan sejajar x
  const W_RIDGE = 3.35;
  const W_HALF = 1.7;
  const W_EAVE = 2.08;
  const wcz = (WING.z0 + WING.z1) / 2;
  for (let k = 0; k < 2; k++) {
    const y = Y0 + STORY + ROW_H * (k + 0.5);
    const h = ((W_RIDGE - (y + ROW_H / 2)) / (W_RIDGE - W_EAVE)) * W_HALF - 0.1;
    b.mod(2, 1.6, box([WING.x0, y, wcz], [T, ROW_H + 0.02, h * 2], SIDING[k % 2], 0.02));
  }

  // --- Tahap 3: Atap -----------------------------------------------------------
  const mainStrips = gableRoofStrips({
    ridgeAxis: 'z',
    cx: cxMain,
    cz: 0.05,
    length: mainD + 0.7,
    halfSpan: HALF,
    eaveY: EAVE_Y,
    ridgeY: RIDGE_Y,
    strips: 5,
    thickness: 0.15,
    colors: ROOF,
  });
  for (const s of mainStrips) b.mod(3, 3.2, s.prim);
  b.mod(3, 2, box([cxMain, RIDGE_Y + 0.12, 0.05], [0.22, 0.22, mainD + 0.8], '#1f6664', 0.04, [0, 0, Math.PI / 4]));
  const wingStrips = gableRoofStrips({
    ridgeAxis: 'x',
    cx: (WING.x0 - 0.35 + WING.x1) / 2,
    cz: wcz,
    length: wingW + 0.35,
    halfSpan: W_HALF,
    eaveY: W_EAVE,
    ridgeY: W_RIDGE,
    strips: 3,
    thickness: 0.14,
    colors: ROOF,
  });
  for (const s of wingStrips) b.mod(3, 2.8, s.prim);
  b.mod(3, 1.6, box([(WING.x0 - 0.35 + WING.x1) / 2, W_RIDGE + 0.1, wcz], [wingW + 0.4, 0.2, 0.2], '#1f6664', 0.04, [Math.PI / 4, 0, 0]));

  // --- Tahap 4: Detail ---------------------------------------------------------
  // Tiang teras
  b.mod(4, 2.2, [
    box([PORCH.x0 + 0.15, Y0 + STORY / 2 + 0.06, PORCH.z1 - 0.15], [0.16, STORY, 0.16], TRIM, 0.03),
    box([PORCH.x1 - 0.15, Y0 + STORY / 2 + 0.06, PORCH.z1 - 0.15], [0.16, STORY, 0.16], TRIM, 0.03),
  ]);
  // Lantai balkon (atap teras)
  b.mod(4, 2.4, box([(PORCH.x0 + PORCH.x1) / 2, Y2 - 0.06, (PORCH.z0 + PORCH.z1) / 2 + 0.02], [PORCH.x1 - PORCH.x0 + 0.1, 0.14, PORCH.z1 - PORCH.z0 + 0.08], DECK[1], 0.03));
  // Pagar balkon
  const rail: Prim[] = [
    box([(PORCH.x0 + PORCH.x1) / 2, Y2 + 0.62, PORCH.z1 - 0.06], [PORCH.x1 - PORCH.x0, 0.08, 0.08], TRIM, 0.02),
    box([PORCH.x0 + 0.04, Y2 + 0.62, (PORCH.z0 + PORCH.z1) / 2], [0.08, 0.08, PORCH.z1 - PORCH.z0], TRIM, 0.02),
    box([PORCH.x1 - 0.04, Y2 + 0.62, (PORCH.z0 + PORCH.z1) / 2], [0.08, 0.08, PORCH.z1 - PORCH.z0], TRIM, 0.02),
  ];
  for (let i = 0; i <= 10; i++) {
    rail.push(box([PORCH.x0 + 0.05 + ((PORCH.x1 - PORCH.x0 - 0.1) * i) / 10, Y2 + 0.32, PORCH.z1 - 0.06], [0.05, 0.56, 0.05], TRIM, 0));
  }
  b.mod(4, 2.4, rail);
  // Cerobong
  b.mod(4, 2.2, [box([2.55, 5.2, -1.0], [0.62, 1.9, 0.62], '#b0685a', 0.05), box([2.55, 6.2, -1.0], [0.76, 0.14, 0.76], '#8a5046', 0.03)]);
  // Lampu teras & pot bunga
  b.mod(4, 2, [box([0.72, Y0 + 1.25, MAIN.z1 + 0.1], [0.08, 0.26, 0.08], '#3b3b3b', 0.01), sphere([0.72, Y0 + 1.42, MAIN.z1 + 0.16], 0.1, '#ffe08a')]);
  const planter = (x: number, z: number): Prim[] => [
    box([x, Y0 + 0.2, z], [0.4, 0.34, 0.4], '#b86b45', 0.06),
    sphere([x, Y0 + 0.5, z], 0.24, '#5fb34f'),
    sphere([x + 0.08, Y0 + 0.62, z + 0.05], 0.08, '#ff7aa2'),
  ];
  b.mod(4, 2, planter(PORCH.x0 + 0.5, PORCH.z1 - 0.35));
  b.mod(4, 2, planter(PORCH.x1 - 0.5, PORCH.z1 - 0.35));
  // Kotak bunga jendela sayap
  b.mod(4, 2, [
    box([-2.0, Y0 + ROW_H - 0.12, WING.z1 + 0.16], [1.3, 0.16, 0.2], '#9a6a3c', 0.03),
    sphere([-2.4, Y0 + ROW_H, WING.z1 + 0.16], 0.1, '#ff7aa2'),
    sphere([-2.0, Y0 + ROW_H + 0.02, WING.z1 + 0.16], 0.1, '#ffd24a'),
    sphere([-1.6, Y0 + ROW_H, WING.z1 + 0.16], 0.1, '#b388ff'),
  ]);
  // Bangku teras + semak
  b.mod(4, 2, [
    box([2.45, Y0 + 0.3, MAIN.z1 + 0.35], [0.9, 0.08, 0.32], DECK[1], 0.02),
    box([2.45, Y0 + 0.5, MAIN.z1 + 0.2], [0.9, 0.3, 0.06], DECK[0], 0.02),
    box([2.08, Y0 + 0.15, MAIN.z1 + 0.35], [0.06, 0.3, 0.3], DECK[1], 0),
    box([2.82, Y0 + 0.15, MAIN.z1 + 0.35], [0.06, 0.3, 0.3], DECK[1], 0),
  ]);
  b.mod(4, 2, [sphere([-3.0, 0.32, 2.0], 0.38, '#5fb34f'), sphere([-2.45, 0.26, 2.15], 0.3, '#4fa244'), cone([3.75, 0.02, 1.4], 0.32, 0.9, '#4fa244')]);

  return {
    id: 'bighouse',
    name: 'Rumah Kayu Dua Lantai',
    material: 'wood',
    target: 1200,
    stageNames: ['Fondasi', 'Dinding', 'Rangka & Bukaan', 'Atap', 'Detail'],
    stageBonus: [30, 60, 80, 100],
    completionBonus: 250,
    modules: b.modules,
  };
}
