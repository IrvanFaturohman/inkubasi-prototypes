import { BALANCE } from '../config/balance';
import { LEVELS } from '../config/levels';
import { LOT_D, LOT_W, plotsOfLevel, stageCount } from './layout';
import { trackFor } from './tracks';
import type { BlockKind } from './types';

/**
 * Hutan: grid sel 1×1 di sekitar stasiun. Tiap sel berisi satu blok (pohon/batu/kristal/koin)
 * atau kosong. Jenis blok diacak deterministik (seed level) menurut zona jarak dari stasiun.
 * Data ini tidak disimpan — hanya HP sisa tiap sel yang masuk save.
 */

export const KINDS: BlockKind[] = ['tree', 'treeGold', 'treeRed', 'rock', 'crystal', 'coins'];
export const CELL = 1;
/** Lebar setengah jalur rel yang dibersihkan dari blok. */
const RAIL_CLEAR = 0.85;

export interface Field {
  half: number;
  cols: number;
  n: number;
  /** Indeks jenis di KINDS, atau -1 bila sel kosong. */
  kind: Int8Array;
  x: Float32Array;
  z: Float32Array;
  /** Tahap expand yang meletakkan rel di atas sel ini (-1 = tidak pernah). */
  railStage: Int8Array;
  /** Kavling yang menempati sel ini (-1 = tidak ada). */
  plotOf: Int16Array;
  /** Sel-sel yang harus bersih sebelum kavling bisa dibangun. */
  plotCells: number[][];
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const cache = new Map<number, Field>();

export function fieldFor(levelIndex: number): Field {
  let f = cache.get(levelIndex);
  if (f) return f;
  const level = LEVELS[levelIndex];
  const half = level.mapHalf;
  const cols = Math.round((half * 2) / CELL);
  const n = cols * cols;
  const kind = new Int8Array(n).fill(-1);
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const railStage = new Int8Array(n).fill(-1);
  const plotOf = new Int16Array(n).fill(-1);
  const r = rng(level.seed);
  const H = level.hubHalf - 0.35;
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < cols; i++) {
      const c = j * cols + i;
      x[c] = -half + (i + 0.5) * CELL;
      z[c] = -half + (j + 0.5) * CELL;
      const roll = r();
      const pick = r();
      if (Math.abs(x[c]) < H && Math.abs(z[c]) < H) continue; // lapangan stasiun
      if (roll < 0.035) continue; // celah alami
      const dist = Math.hypot(x[c], z[c]);
      const zone = level.zones.find((zn) => dist < zn.maxR) ?? level.zones[level.zones.length - 1];
      const entries = KINDS.map((k) => [k, zone.weights[k] ?? 0] as const).filter(([, w]) => w > 0);
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let acc = 0;
      for (const [k, w] of entries) {
        acc += w / total;
        if (pick <= acc) {
          kind[c] = KINDS.indexOf(k);
          break;
        }
      }
      if (kind[c] < 0) kind[c] = KINDS.indexOf(entries[entries.length - 1][0]);
    }
  }
  // Jalur rel tiap tahap: sel di bawah rel dibersihkan saat rel diletakkan.
  for (let s = stageCount(level) - 1; s >= 0; s--) {
    const t = trackFor(levelIndex, s);
    const p = { x: 0, z: 0 };
    for (let d = 0; d < t.length; d += 0.2) {
      t.pointAt(d, p);
      forCellsInRadius(half, cols, p.x, p.z, RAIL_CLEAR + 0.5, (c) => {
        if (Math.hypot(x[c] - p.x, z[c] - p.z) < RAIL_CLEAR) railStage[c] = s;
      });
    }
  }
  // Sel kavling
  const plots = plotsOfLevel(levelIndex);
  const plotCells: number[][] = plots.map(() => []);
  for (const p of plots) {
    const alongX = Math.abs(p.facing.z) > 0.5;
    const hx = (alongX ? LOT_W : LOT_D) / 2;
    const hz = (alongX ? LOT_D : LOT_W) / 2;
    for (let c = 0; c < n; c++) {
      if (Math.abs(x[c] - p.pos.x) < hx && Math.abs(z[c] - p.pos.z) < hz) {
        plotOf[c] = p.index;
        plotCells[p.index].push(c);
        // Kavling selalu tertutup hutan (supaya ada yang ditebang dulu).
        if (kind[c] < 0 || KINDS[kind[c]] === 'coins') kind[c] = KINDS.indexOf(level.buildResource === 'stone' ? 'rock' : 'tree');
      }
    }
  }
  f = { half, cols, n, kind, x, z, railStage, plotOf, plotCells };
  cache.set(levelIndex, f);
  return f;
}

/** HP awal semua sel untuk permainan baru (rel tahap 0 sudah bersih). */
export function initialBlocks(levelIndex: number): number[] {
  const f = fieldFor(levelIndex);
  const out: number[] = new Array(f.n);
  for (let c = 0; c < f.n; c++) {
    out[c] = f.kind[c] < 0 || f.railStage[c] === 0 ? -1 : BALANCE.blocks[KINDS[f.kind[c]]].hp;
  }
  return out;
}

export function maxHp(f: Field, c: number): number {
  return f.kind[c] < 0 ? -1 : BALANCE.blocks[KINDS[f.kind[c]]].hp;
}

/** Panggil cb untuk setiap sel yang pusatnya mungkin berada dalam radius r dari (px, pz). */
export function forCellsInRadius(half: number, cols: number, px: number, pz: number, r: number, cb: (c: number) => void): void {
  const i0 = Math.max(0, Math.floor((px - r + half) / CELL));
  const i1 = Math.min(cols - 1, Math.floor((px + r + half) / CELL));
  const j0 = Math.max(0, Math.floor((pz - r + half) / CELL));
  const j1 = Math.min(cols - 1, Math.floor((pz + r + half) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cb(j * cols + i);
}
