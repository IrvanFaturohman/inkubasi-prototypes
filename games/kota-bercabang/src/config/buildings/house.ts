import type { Prim } from '../../game/types';
import type { ModuleDef } from '../../game/types';
import { box, cone, gableRoofStrips, log, prism, ProjectBuilder, sphere, splitSpan } from './builder';

/**
 * Generator bangunan kecil parametrik untuk kavling kota (tapak ± 1,8 × 1,5).
 * Koordinat lokal: y ke atas, +z menghadap jalan. Modul disusun berurutan
 * fondasi → dinding (baris demi baris, lantai demi lantai) → bukaan → atap → detail,
 * sehingga tiap kiriman kecil menumbuhkan bangunan secara kasatmata.
 */
export interface HouseSpec {
  w: number;
  d: number;
  floors: number;
  floorH: number;
  wall: 'log' | 'plank' | 'brick';
  wallColors: [string, string];
  trim: string;
  roof: 'gable' | 'flat';
  roofColors: [string, string];
  /** Sumbu bubungan atap pelana: 'x' (lereng menghadap depan) atau 'z' (segitiga di depan). */
  ridge?: 'x' | 'z';
  door: string;
  /** Jumlah jendela depan per lantai. */
  frontWindows: number;
  sideWindows?: boolean;
  glass?: string;
  /** Tinggi tiang rumah panggung. */
  stilts?: number;
  awning?: [string, string];
  chimney?: string;
  sign?: string;
  balcony?: string;
  flowers?: boolean;
  bigDoor?: boolean;
  foundation?: string;
  porch?: string;
  fence?: string;
}

const W = { found: 0.25, row: 1, slab: 0.8, open: 0.9, gable: 0.6, strip: 0.9, ridge: 0.5, flat: 1.2, parapet: 0.8, detail: 0.7 };

export function house(spec: HouseSpec): ModuleDef[] {
  const b = new ProjectBuilder();
  const { w, d, floors, floorH } = spec;
  const rows = 3;
  const rh = floorH / rows;
  const glass = spec.glass ?? '#a6dcf6';
  const found = spec.foundation ?? '#bdb6aa';
  const T = 0.08; // tebal dinding papan
  const hw = w / 2;
  const hd = d / 2;

  // --- Tahap 0: fondasi / panggung -----------------------------------------------
  let y0 = 0.12;
  if (spec.stilts) {
    const sh = spec.stilts;
    const posts: Prim[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.push(log([sx * (hw - 0.1), sh / 2, sz * (hd - 0.1)], sh, 'y', 0.07, '#8a5a36'));
    b.mod(0, W.found, posts);
    b.mod(0, W.found, [box([0, sh - 0.04, 0], [w + 0.1, 0.08, d + 0.1], spec.porch ?? '#c89660', 0.02)]);
    y0 = sh + 0.02;
  } else {
    b.mod(0, W.found, box([-w / 4, 0.06, 0], [w / 2 - 0.02, 0.12, d + 0.08], found, 0.03));
    b.mod(0, W.found, box([w / 4, 0.06, 0], [w / 2 - 0.02, 0.12, d + 0.08], found, 0.03));
  }
  if (spec.porch && !spec.stilts) b.mod(0, W.found, box([0, 0.08, hd + 0.2], [w * 0.7, 0.08, 0.36], spec.porch, 0.02));

  // --- Bukaan per lantai ---------------------------------------------------------
  type Hole = { span: [number, number]; rows: [number, number] };
  const doorW = spec.bigDoor ? w * 0.46 : 0.34;
  const frontHoles = (f: number): Hole[] => {
    const holes: Hole[] = [];
    const n = spec.frontWindows;
    const ww = Math.min(0.34, (w / Math.max(1, n + (f === 0 ? 1 : 0))) * 0.5);
    if (f === 0) {
      holes.push({ span: [-doorW / 2, doorW / 2], rows: [0, spec.bigDoor ? 2 : 1] });
      if (!spec.bigDoor) {
        const xs = n === 1 ? [w * 0.3] : n >= 2 ? [-w * 0.3, w * 0.3] : [];
        for (const x of xs) holes.push({ span: [x - ww / 2, x + ww / 2], rows: [1, 1] });
      }
    } else {
      for (let i = 0; i < n; i++) {
        const x = -hw + ((i + 0.5) * w) / n;
        holes.push({ span: [x - ww / 2, x + ww / 2], rows: [1, 1] });
      }
    }
    return holes;
  };
  const sideHoles: Hole[] = spec.sideWindows ? [{ span: [-Math.min(0.2, d * 0.15), Math.min(0.2, d * 0.15)], rows: [1, 1] }] : [];
  const holesAt = (holes: Hole[], r: number) => holes.filter((h) => r >= h.rows[0] && r <= h.rows[1]).map((h) => h.span);

  // --- Tahap 1: dinding baris demi baris ------------------------------------------
  let brickSeed = 17;
  const rnd = () => {
    brickSeed = (brickSeed * 16807) % 2147483647;
    return brickSeed / 2147483647;
  };
  const BRICKS = [spec.wallColors[0], spec.wallColors[1], shade(spec.wallColors[0], 0.06)];

  const wallRow = (f: number, r: number): Prim[] => {
    const y = y0 + f * floorH + (r + 0.5) * rh;
    const c = spec.wallColors[(r + f) % 2];
    const fh = holesAt(frontHoles(f), r);
    const sh = holesAt(sideHoles, r);
    const prims: Prim[] = [];
    if (spec.wall === 'log') {
      const R = rh * 0.5;
      for (const [a, e] of splitSpan(-hw - 0.06, hw + 0.06, fh)) prims.push(log([(a + e) / 2, y, hd], e - a, 'x', R, c));
      prims.push(log([0, y, -hd], w + 0.12, 'x', R, c));
      for (const sx of [-1, 1]) for (const [a, e] of splitSpan(-hd - 0.06, hd + 0.06, sh)) prims.push(log([sx * hw, y, (a + e) / 2], e - a, 'z', R * 0.96, spec.wallColors[(r + f + 1) % 2]));
      return prims;
    }
    const face = (axis: 'x' | 'z', plane: number, a: number, e: number, holes: [number, number][], out: number, veneer: boolean) => {
      for (const [s0, s1] of splitSpan(a, e, holes, 0.01)) {
        const mid = (s0 + s1) / 2;
        const len = s1 - s0;
        const thick = spec.wall === 'brick' ? 0.1 : T;
        const col = spec.wall === 'brick' ? (veneer ? '#e8ddd0' : spec.wallColors[0]) : c;
        prims.push(axis === 'x' ? box([mid, y, plane], [len, rh + 0.005, thick], col, 0) : box([plane, y, mid], [thick, rh + 0.005, len], col, 0));
        if (spec.wall === 'brick' && veneer) {
          const BL = 0.2;
          for (let k = 0; k < 2; k++) {
            const by = y - rh / 2 + rh * (k + 0.5) / 2;
            const off = (r * 2 + k + f) % 2 === 0 ? 0 : BL / 2;
            for (let s = s0 - off; s < s1 - 0.01; s += BL) {
              const bs = Math.max(s, s0) + 0.008;
              const be = Math.min(s + BL, s1) - 0.008;
              if (be - bs < 0.04) continue;
              const m = (bs + be) / 2;
              const depth = plane + out * 0.06;
              const bc = BRICKS[Math.floor(rnd() * BRICKS.length)];
              prims.push({
                ...(axis === 'x' ? box([m, by, depth], [be - bs, rh / 2 - 0.018, 0.03], bc, 0) : box([depth, by, m], [0.03, rh / 2 - 0.018, be - bs], bc, 0)),
                noGhost: true,
              });
            }
          }
        }
      }
    };
    face('x', hd, -hw, hw, fh, 1, true);
    face('z', hw, -hd + 0.05, hd - 0.05, sh, 1, true);
    face('x', -hd, -hw, hw, [], -1, false);
    face('z', -hw, -hd + 0.05, hd - 0.05, sh, -1, false);
    return prims;
  };

  for (let f = 0; f < floors; f++) {
    if (f > 0) b.mod(1, W.slab, box([0, y0 + f * floorH, 0], [w + 0.1, 0.06, d + 0.1], spec.trim, 0.01));
    for (let r = 0; r < rows; r++) b.mod(1, W.row, wallRow(f, r));
  }
  const top = y0 + floors * floorH;

  // --- Tahap 2: pintu, jendela, list --------------------------------------------------
  const fz = hd + (spec.wall === 'log' ? rh * 0.45 : 0.06);
  for (let f = 0; f < floors; f++) {
    const prims: Prim[] = [];
    const base = y0 + f * floorH;
    for (const h of frontHoles(f)) {
      const x0 = h.span[0];
      const x1 = h.span[1];
      const cx = (x0 + x1) / 2;
      const hwid = x1 - x0;
      const yb = base + h.rows[0] * rh;
      const yt = base + (h.rows[1] + 1) * rh;
      const isDoor = f === 0 && h.rows[0] === 0;
      prims.push(box([cx, (yb + yt) / 2, hd - 0.01], [hwid, yt - yb, 0.05], isDoor ? spec.door : glass, 0.01));
      prims.push(box([cx, yt + 0.03, fz], [hwid + 0.1, 0.06, 0.06], spec.trim, 0.01));
      prims.push(box([x0 - 0.02, (yb + yt) / 2, fz], [0.04, yt - yb, 0.05], spec.trim, 0));
      prims.push(box([x1 + 0.02, (yb + yt) / 2, fz], [0.04, yt - yb, 0.05], spec.trim, 0));
      if (!isDoor) {
        prims.push(box([cx, yb - 0.02, fz + 0.02], [hwid + 0.12, 0.04, 0.08], spec.trim, 0));
        prims.push(box([cx, (yb + yt) / 2, hd + 0.01], [0.03, yt - yb, 0.03], spec.trim, 0));
      } else if (!spec.bigDoor) {
        prims.push(sphere([cx + hwid * 0.3, yb + rh * 0.9, hd + 0.04], 0.03, '#ffd35a'));
      } else {
        prims.push(box([cx, (yb + yt) / 2, hd + 0.02], [hwid * 0.95, 0.04, 0.03], spec.trim, 0), box([cx, (yb + yt) / 2, hd + 0.02], [0.04, yt - yb, 0.03], spec.trim, 0));
      }
    }
    if (spec.sideWindows) {
      for (const sx of [-1, 1]) {
        const yb = base + rh;
        const yt = base + 2 * rh;
        const zw = Math.min(0.2, d * 0.15);
        const px = sx * (hw + (spec.wall === 'log' ? rh * 0.45 : 0.06));
        prims.push(box([sx * hw, (yb + yt) / 2, 0], [0.05, yt - yb, zw * 2], glass, 0.01));
        prims.push(box([px, yt + 0.03, 0], [0.06, 0.06, zw * 2 + 0.1], spec.trim, 0.01));
        prims.push(box([px, yb - 0.02, 0], [0.08, 0.04, zw * 2 + 0.12], spec.trim, 0));
      }
    }
    b.mod(2, W.open, prims);
  }

  // Segitiga gable (bagian dari rangka) — sebelum atap.
  const ridge = spec.ridge ?? 'x';
  const rise = (ridge === 'x' ? d : w) * 0.42;
  if (spec.roof === 'gable') {
    const gc = spec.wall === 'brick' ? spec.wallColors[1] : spec.wallColors[0];
    if (ridge === 'x') {
      for (const sx of [-1, 1]) b.mod(2, W.gable, prism([sx * hw, top, 0], d, rise * 0.92, 0.08, gc, [0, Math.PI / 2, 0]));
    } else {
      for (const sz of [-1, 1]) b.mod(2, W.gable, prism([0, top, sz * hd], w, rise * 0.92, 0.08, gc));
    }
  }

  // --- Tahap 3: atap ----------------------------------------------------------------
  if (spec.roof === 'gable') {
    const over = 0.16;
    const strips = gableRoofStrips({
      ridgeAxis: ridge,
      cx: 0,
      cz: 0,
      length: (ridge === 'x' ? w : d) + over * 2,
      halfSpan: (ridge === 'x' ? hd : hw) + over,
      eaveY: top - over * (rise / (ridge === 'x' ? hd : hw)),
      ridgeY: top + rise,
      strips: 2,
      thickness: 0.08,
      colors: spec.roofColors,
    });
    for (const s of strips) b.mod(3, W.strip, s.prim);
    const rl = (ridge === 'x' ? w : d) + over * 2 + 0.04;
    b.mod(3, W.ridge, box([0, top + rise + 0.05, 0], ridge === 'x' ? [rl, 0.1, 0.1] : [0.1, 0.1, rl], shade(spec.roofColors[0], -0.12), 0.02, ridge === 'x' ? [Math.PI / 4, 0, 0] : [0, 0, Math.PI / 4]));
  } else {
    b.mod(3, W.flat, box([0, top + 0.05, 0], [w + 0.1, 0.1, d + 0.1], spec.roofColors[0], 0.02));
    b.mod(3, W.parapet, [
      box([0, top + 0.18, hd + 0.02], [w + 0.14, 0.18, 0.08], spec.roofColors[1], 0.01),
      box([0, top + 0.18, -hd - 0.02], [w + 0.14, 0.18, 0.08], spec.roofColors[1], 0.01),
      box([hw + 0.02, top + 0.18, 0], [0.08, 0.18, d], spec.roofColors[1], 0.01),
      box([-hw - 0.02, top + 0.18, 0], [0.08, 0.18, d], spec.roofColors[1], 0.01),
      box([0, top + 0.29, hd + 0.04], [w + 0.2, 0.05, 0.12], spec.trim, 0.01),
    ]);
  }

  // --- Tahap 4: detail --------------------------------------------------------------
  if (spec.chimney) {
    const cy = spec.roof === 'gable' ? top + rise * 0.7 : top + 0.3;
    b.mod(4, W.detail, [box([hw * 0.55, cy, -hd * 0.3], [0.22, rise * 0.9 + 0.3, 0.22], spec.chimney, 0.03), box([hw * 0.55, cy + rise * 0.45 + 0.17, -hd * 0.3], [0.28, 0.05, 0.28], shade(spec.chimney, -0.15), 0.01)]);
  }
  if (spec.awning) {
    const aw: Prim[] = [];
    const n = 6;
    const aw0 = spec.bigDoor ? w * 0.9 : w * 0.8;
    for (let i = 0; i < n; i++) aw.push(box([-aw0 / 2 + (aw0 / n) * (i + 0.5), y0 + floorH * 0.86, hd + 0.2], [aw0 / n, 0.04, 0.42], spec.awning[i % 2], 0.01, [0.35, 0, 0]));
    b.mod(4, W.detail, aw);
  }
  if (spec.sign) {
    const sy = spec.roof === 'flat' ? top + 0.42 : y0 + floorH * 0.98;
    b.mod(4, W.detail, [box([0, sy, hd + 0.06], [w * 0.62, 0.2, 0.05], spec.sign, 0.02), box([0, sy, hd + 0.09], [w * 0.4, 0.06, 0.02], '#ffffff', 0)]);
  }
  if (spec.balcony && floors > 1) {
    const bal: Prim[] = [];
    for (let f = 1; f < floors; f++) {
      const by = y0 + f * floorH;
      bal.push(box([0, by + 0.02, hd + 0.18], [w * 0.7, 0.05, 0.34], spec.balcony, 0.01));
      bal.push(box([0, by + 0.2, hd + 0.34], [w * 0.7, 0.04, 0.03], spec.trim, 0));
      for (let i = 0; i <= 5; i++) bal.push(box([-w * 0.35 + (w * 0.7 * i) / 5, by + 0.11, hd + 0.34], [0.025, 0.18, 0.025], spec.trim, 0));
    }
    b.mod(4, W.detail, bal);
  }
  if (spec.flowers) {
    const xs = spec.frontWindows >= 2 ? [-w * 0.3, w * 0.3] : [w * 0.3];
    const fl: Prim[] = [];
    for (const x of xs) {
      fl.push(box([x, y0 + rh - 0.06, hd + 0.08], [0.36, 0.07, 0.1], '#9a6a3c', 0.02));
      fl.push(sphere([x - 0.1, y0 + rh, hd + 0.08], 0.05, '#ff7aa2'), sphere([x + 0.1, y0 + rh, hd + 0.08], 0.05, '#ffd24a'));
    }
    b.mod(4, W.detail, fl);
  }
  if (spec.stilts) {
    const st: Prim[] = [];
    const steps = 4;
    for (let i = 0; i < steps; i++) st.push(box([0, (spec.stilts * (i + 0.5)) / steps, hd + 0.6 - (i * 0.4) / steps], [0.4, 0.05, 0.14], '#b98246', 0.01));
    st.push(box([0.22, spec.stilts / 2, hd + 0.4], [0.04, spec.stilts + 0.1, 0.04], '#8a5a36', 0), box([-0.22, spec.stilts / 2, hd + 0.4], [0.04, spec.stilts + 0.1, 0.04], '#8a5a36', 0));
    b.mod(4, W.detail, st);
  }
  if (spec.fence) {
    const fe: Prim[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * (hw + 0.1);
      fe.push(box([x, 0.18, hd + 0.35], [0.04, 0.36, 0.04], spec.fence, 0));
      fe.push(box([x - sx * 0.2, 0.25, hd + 0.35], [0.4, 0.04, 0.03], spec.fence, 0), box([x - sx * 0.2, 0.13, hd + 0.35], [0.4, 0.04, 0.03], spec.fence, 0));
    }
    b.mod(4, W.detail, fe);
  }
  // Semak kecil di samping (selalu ada: penutup yang manis)
  b.mod(4, W.detail, [sphere([-hw - 0.05, 0.16, hd - 0.1], 0.17, '#5fb34f'), cone([hw + 0.08, 0.02, hd - 0.2], 0.14, 0.42, '#4fa244', 7)]);

  return b.done();
}

export function shade(hex: string, l: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const bl = n & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + l * 255)));
  return '#' + [f(r), f(g), f(bl)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
