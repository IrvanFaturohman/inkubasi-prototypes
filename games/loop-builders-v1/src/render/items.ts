import * as THREE from 'three';
import type { MaterialKind } from '../game/types';
import { cbox, ccyl, mergeFlat } from './geom';
import { MATERIAL_LOOK } from './palette';

/** Dimensi satu unit material (dipakai conveyor, penyimpanan, bak kendaraan, efek). */
export const ITEM_SIZE: Record<MaterialKind, { l: number; h: number; w: number }> = {
  wood: { l: 0.46, h: 0.2, w: 0.2 },
  brick: { l: 0.36, h: 0.16, w: 0.2 },
};

const cache = new Map<MaterialKind, THREE.BufferGeometry>();

/** Geometri satu item, sumbu panjang = x. Di-cache & dibagi semua pemakai. */
export function itemGeometry(kind: MaterialKind): THREE.BufferGeometry {
  let g = cache.get(kind);
  if (g) return g;
  const look = MATERIAL_LOOK[kind];
  if (kind === 'wood') {
    // Batang kayu dengan tutup serat terang.
    g = ccyl(0.1, ITEM_SIZE.wood.l, look.main, 9, 0, 0, 0, 0, 0, Math.PI / 2, look.end);
  } else {
    const s = ITEM_SIZE.brick;
    g = mergeFlat([cbox(s.l, s.h, s.w, look.main, 0, 0, 0, 0.025), cbox(s.l * 0.7, 0.02, s.w * 0.55, look.alt, 0, s.h / 2, 0, 0.005)]);
  }
  cache.set(kind, g);
  return g;
}
