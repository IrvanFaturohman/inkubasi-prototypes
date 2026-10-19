import type { ModuleDef, Prim } from '../../game/types';

type V3 = [number, number, number];

/**
 * Helper kecil untuk menyusun modul bangunan secara prosedural namun tetap data-driven.
 * Setiap panggilan `mod()` menambahkan satu modul (satu unit ghost → solid).
 */
export class ProjectBuilder {
  readonly modules: ModuleDef[] = [];

  mod(stage: number, weight: number, ...prims: (Prim | Prim[])[]): void {
    this.modules.push({ stage, weight, prims: prims.flat() });
  }

  done(): ModuleDef[] {
    return this.modules;
  }
}

export function box(p: V3, s: V3, c: string, round = 0.03, r?: V3): Prim {
  return { kind: 'box', p, s, c, round, r };
}

export function log(p: V3, len: number, axis: 'x' | 'y' | 'z', radius: number, c: string, cap = '#f1d3a0'): Prim {
  return { kind: 'cyl', p, len, axis, radius, c, cap, seg: 10 };
}

export function cyl(p: V3, len: number, axis: 'x' | 'y' | 'z', radius: number, c: string, seg = 12): Prim {
  return { kind: 'cyl', p, len, axis, radius, c, seg };
}

export function prism(p: V3, w: number, h: number, d: number, c: string, r?: V3): Prim {
  return { kind: 'prism', p, w, h, d, c, r };
}

export function sphere(p: V3, radius: number, c: string): Prim {
  return { kind: 'sphere', p, radius, c };
}

export function cone(p: V3, radius: number, h: number, c: string, seg = 8, r?: V3): Prim {
  return { kind: 'cone', p, radius, h, c, seg, r };
}

/**
 * Memotong rentang [a, b] dengan lubang-lubang (bukaan pintu/jendela).
 * Mengembalikan potongan-potongan yang tersisa (untuk batang kayu / papan dinding).
 */
export function splitSpan(a: number, b: number, holes: [number, number][], gap = 0.02): [number, number][] {
  const sorted = [...holes].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let cur = a;
  for (const [h0, h1] of sorted) {
    if (h1 <= cur || h0 >= b) continue;
    if (h0 - gap > cur + 0.05) out.push([cur, h0 - gap]);
    cur = Math.max(cur, h1 + gap);
  }
  if (b > cur + 0.05) out.push([cur, b]);
  return out;
}

/** Atap pelana: potongan strip dari lis ke bubungan. */
export interface GableRoofSpec {
  /** Sumbu bubungan: 'x' (lereng menghadap ±z) atau 'z' (lereng menghadap ±x). */
  ridgeAxis: 'x' | 'z';
  /** Pusat bangunan di bidang horizontal. */
  cx: number;
  cz: number;
  /** Panjang atap sepanjang bubungan (termasuk overhang). */
  length: number;
  /** Setengah bentang horizontal dari bubungan ke lis. */
  halfSpan: number;
  eaveY: number;
  ridgeY: number;
  strips: number;
  thickness: number;
  colors: [string, string];
}

export interface RoofStrip {
  prim: Prim;
  side: number;
  index: number;
}

export function gableRoofStrips(spec: GableRoofSpec): RoofStrip[] {
  const rise = spec.ridgeY - spec.eaveY;
  const slopeLen = Math.hypot(rise, spec.halfSpan);
  const angle = Math.atan2(rise, spec.halfSpan);
  const stripLen = slopeLen / spec.strips;
  const out: RoofStrip[] = [];
  for (let i = 0; i < spec.strips; i++) {
    for (const side of [1, -1]) {
      // Titik tengah strip, diukur dari lis naik ke bubungan.
      const s = (i + 0.5) * stripLen;
      const horiz = spec.halfSpan - (s / slopeLen) * spec.halfSpan;
      const y = spec.eaveY + (s / slopeLen) * rise + spec.thickness * 0.5 * Math.cos(angle);
      const off = side * horiz + side * spec.thickness * 0.5 * Math.sin(angle);
      const color = spec.colors[(i + (side > 0 ? 0 : 1)) % 2];
      const lenStrip = stripLen + 0.04;
      let prim: Prim;
      if (spec.ridgeAxis === 'x') {
        prim = box([spec.cx, y, spec.cz + off], [spec.length, spec.thickness, lenStrip], color, 0.03, [side * angle, 0, 0]);
      } else {
        prim = box([spec.cx + off, y, spec.cz], [lenStrip, spec.thickness, spec.length], color, 0.03, [0, 0, -side * angle]);
      }
      out.push({ prim, side, index: i });
    }
  }
  return out;
}
