import { BlockField } from './BlockField';
import {
  C_BLUE,
  C_CORAL,
  C_GREEN,
  C_VIOLET,
  C_YELLOW,
  MAT_BONUS,
  MAT_NORMAL,
  MAT_REINFORCED,
  type AreaDef,
} from './config';
import { createRng } from './util';

/**
 * Seeded area generation. Every target cell is filled (dense field, straight
 * southern starting edge). Colors are organised into bands, clusters and
 * geometric patches; ratios for double layers, reinforced and bonus layers are
 * hit exactly by ranking pattern scores and taking the top K.
 */
export function generateArea(def: AreaDef): BlockField {
  const rng = createRng(def.seed);
  const f = new BlockField(def.cols, def.rows);
  const { cols, rows, n } = f;

  const baseColor = new Uint8Array(n);
  const topColor = new Uint8Array(n);
  const doubleScore = new Float32Array(n);

  // Low frequency value noise for organic cluster shapes.
  const noise = makeValueNoise(rng, cols, rows, 5);

  if (def.pattern === 'stripes') {
    const seq = [C_CORAL, C_YELLOW, C_BLUE, C_GREEN];
    const ph1 = rng() * 6.28;
    const ph2 = rng() * 6.28;
    const blobs = makeBlobs(rng, cols, rows, 7, 1.5, 2.7);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const wave = Math.round(Math.sin(c * 0.42 + ph1) * 1.1 + Math.sin(c * 0.17 + ph2) * 0.9);
        const band = Math.floor((r + wave + 60) / 3);
        let col = seq[band % seq.length];
        for (const b of blobs) {
          const d = Math.hypot(c - b.c, (r - b.r) * 1.15);
          if (d < b.rad) {
            col = seq[(band + 1 + b.shift) % seq.length];
            break;
          }
        }
        baseColor[i] = col;
        topColor[i] = seq[(band + 2) % seq.length];
        doubleScore[i] = noise(c, r);
      }
    }
  } else if (def.pattern === 'terraces') {
    const seq = [C_BLUE, C_GREEN, C_YELLOW, C_CORAL];
    const ph = rng() * 6.28;
    const rects = makeRects(rng, cols, rows, 9);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const band = Math.floor((c + Math.round(Math.sin(r * 0.33 + ph) * 1.6) + 40) / 4);
        const base = seq[band % seq.length];
        baseColor[i] = base;
        let score = noise(c, r) * 0.35;
        let top = seq[(band + 2) % seq.length];
        for (let k = 0; k < rects.length; k++) {
          const q = rects[k];
          if (c >= q.c0 && c <= q.c1 && r >= q.r0 && r <= q.r1) {
            // Nested rectangles build stepped plateaus.
            score += 1;
            top = seq[(k + 1) % seq.length];
          }
        }
        if (top === base) top = seq[(seq.indexOf(top) + 1) % seq.length];
        topColor[i] = top;
        doubleScore[i] = score;
      }
    }
  } else {
    // carnival: diagonal stripes, concentric blocks and a checker patch.
    const seq = [C_CORAL, C_YELLOW, C_BLUE, C_GREEN];
    const ringSeq = [C_VIOLET, C_YELLOW, C_CORAL, C_BLUE];
    const ringC = Math.floor(cols * (0.25 + rng() * 0.12));
    const ringR = Math.floor(rows * (0.3 + rng() * 0.12));
    const ringRad = 5 + Math.floor(rng() * 2);
    const chkC0 = Math.floor(cols * 0.55 + rng() * 3);
    const chkR0 = Math.floor(rows * 0.12 + rng() * 3);
    const chkC1 = chkC0 + 9;
    const chkR1 = chkR0 + 8;
    const patchC0 = Math.floor(cols * 0.5 + rng() * 4);
    const patchR0 = Math.floor(rows * 0.58);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const diag = Math.floor((c + r + 90) / 3);
        const anti = Math.floor((c - r + 90) / 3);
        let base = seq[diag % seq.length];
        let top = seq[(anti + 1) % seq.length];
        let score = (diag % 2 === 0 ? 0.6 : 0) + noise(c, r) * 0.5;
        const ring = Math.max(Math.abs(c - ringC), Math.abs(r - ringR));
        if (ring <= ringRad) {
          base = ringSeq[ring % ringSeq.length];
          top = ringSeq[(ring + 1) % ringSeq.length];
          score = (ring % 2 === 0 ? 1.2 : 0.1) + noise(c, r) * 0.2;
        } else if (c >= chkC0 && c <= chkC1 && r >= chkR0 && r <= chkR1) {
          const chk = ((Math.floor((c - chkC0) / 2) + Math.floor((r - chkR0) / 2)) & 1) === 0;
          base = chk ? C_GREEN : C_BLUE;
          top = chk ? C_YELLOW : C_CORAL;
          score = chk ? 1.1 : 0.2;
        } else if (c >= patchC0 && c < patchC0 + 8 && r >= patchR0 && r < patchR0 + 6) {
          base = C_YELLOW;
          top = C_GREEN;
          score = 0.9 + noise(c, r) * 0.2;
        }
        if (top === base) top = seq[(seq.indexOf(top) + 2) % seq.length] ?? C_CORAL;
        baseColor[i] = base;
        topColor[i] = top;
        doubleScore[i] = score;
      }
    }
  }

  // Double-layer selection: top K by score.
  const layers = new Uint8Array(n).fill(1);
  const doubleCount = Math.round(def.doubleRatio * n);
  if (doubleCount > 0) {
    for (const i of topK(n, doubleCount, (i) => doubleScore[i] + rng() * 0.05)) layers[i] = 2;
  }

  // All layers start normal.
  for (let i = 0; i < n; i++) {
    f.setCell(i, layers[i], MAT_NORMAL, baseColor[i], MAT_NORMAL, topColor[i]);
  }

  // Reinforced layers: clustered, more common further from the depot, none in
  // the first rows so the opening stays gentle.
  let totalLayers = 0;
  for (let i = 0; i < n; i++) totalLayers += layers[i];
  const reinforcedCount = Math.round(def.reinforcedRatio * totalLayers);
  const bonusCount = Math.round(def.bonusRatio * totalLayers);
  const introRows = 3;
  if (reinforcedCount > 0) {
    const cand: number[] = [];
    for (let i = 0; i < n; i++) {
      if (f.row(i) >= rows - introRows) continue;
      for (let l = 0; l < layers[i]; l++) cand.push(i * 2 + l);
    }
    const rNoise = makeValueNoise(rng, cols, rows, 4);
    const chosen = topKOf(cand, reinforcedCount, (k) => {
      const i = k >> 1;
      const north = 1 - f.row(i) / rows;
      const isTop = (k & 1) === layers[i] - 1 ? 0.15 : 0;
      return north * 0.55 + rNoise(f.col(i), f.row(i)) * 0.8 + isTop + rng() * 0.08;
    });
    for (const k of chosen) f.mat[k] = MAT_REINFORCED;
  }
  if (bonusCount > 0) {
    // Spread bonus layers out; prefer visible top layers.
    const cand: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = i * 2 + layers[i] - 1;
      if (f.mat[k] === MAT_NORMAL) cand.push(k);
    }
    shuffle(cand, rng);
    const taken: number[] = [];
    for (const k of cand) {
      if (taken.length >= bonusCount) break;
      const i = k >> 1;
      const c = f.col(i);
      const r = f.row(i);
      let ok = true;
      for (const t of taken) {
        const ti = t >> 1;
        if (Math.abs(f.col(ti) - c) + Math.abs(f.row(ti) - r) < 3) {
          ok = false;
          break;
        }
      }
      if (ok) taken.push(k);
    }
    // Fallback fill if spacing was too strict.
    for (const k of cand) {
      if (taken.length >= bonusCount) break;
      if (!taken.includes(k)) taken.push(k);
    }
    for (const k of taken) f.mat[k] = MAT_BONUS;
  }

  buildPairs(f, rng);
  f.finalize();
  return f;
}

/** Pair adjacent same-colour normal layers into long bricks for visual variety. */
function buildPairs(f: BlockField, rng: () => number): void {
  const { cols, rows } = f;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      for (let l = 0; l < f.orig[i]; l++) {
        const k = i * 2 + l;
        if (f.pairWith[k] >= 0 || f.mat[k] !== MAT_NORMAL) continue;
        if (rng() > 0.42) continue;
        const tryPair = (j: number): boolean => {
          if (f.orig[j] <= l) return false;
          const kj = j * 2 + l;
          if (f.pairWith[kj] >= 0 || f.mat[kj] !== MAT_NORMAL || f.color[kj] !== f.color[k]) return false;
          f.pairWith[k] = kj;
          f.pairWith[kj] = k;
          return true;
        };
        const horizontalFirst = rng() < 0.6;
        const right = c + 1 < cols ? i + 1 : -1;
        const down = r + 1 < rows ? i + cols : -1;
        if (horizontalFirst) {
          if (right >= 0 && tryPair(right)) continue;
          if (down >= 0) tryPair(down);
        } else {
          if (down >= 0 && tryPair(down)) continue;
          if (right >= 0) tryPair(right);
        }
      }
    }
  }
}

function makeValueNoise(rng: () => number, cols: number, rows: number, cell: number) {
  const gw = Math.ceil(cols / cell) + 2;
  const gh = Math.ceil(rows / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (c: number, r: number): number => {
    const x = c / cell;
    const y = r / cell;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = g[y0 * gw + x0];
    const b = g[y0 * gw + x0 + 1];
    const cc = g[(y0 + 1) * gw + x0];
    const d = g[(y0 + 1) * gw + x0 + 1];
    return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
  };
}

function makeBlobs(rng: () => number, cols: number, rows: number, count: number, rMin: number, rMax: number) {
  const out: { c: number; r: number; rad: number; shift: number }[] = [];
  for (let k = 0; k < count; k++) {
    out.push({
      c: 2 + rng() * (cols - 4),
      r: 1 + rng() * (rows - 5),
      rad: rMin + rng() * (rMax - rMin),
      shift: Math.floor(rng() * 2),
    });
  }
  return out;
}

function makeRects(rng: () => number, cols: number, rows: number, count: number) {
  const out: { c0: number; c1: number; r0: number; r1: number }[] = [];
  for (let k = 0; k < count; k++) {
    const w = 4 + Math.floor(rng() * 6);
    const h = 3 + Math.floor(rng() * 4);
    const c0 = Math.floor(rng() * (cols - w));
    const r0 = Math.floor(rng() * (rows - h - 2));
    out.push({ c0, c1: c0 + w - 1, r0, r1: r0 + h - 1 });
  }
  return out;
}

function topK(n: number, k: number, score: (i: number) => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  return topKOf(idx, k, score);
}

function topKOf(items: number[], k: number, score: (i: number) => number): number[] {
  const scored = items.map((i) => ({ i, s: score(i) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, Math.min(k, scored.length)).map((e) => e.i);
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

