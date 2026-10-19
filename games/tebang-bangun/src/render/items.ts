import * as THREE from 'three';
import type { Resource } from '../game/types';
import { cbox, ccyl, colored, mergeFlat, place } from './geom';

/** Jenis item yang bisa digambar (muatan kereta, material terbang). */
export type ItemKind = Resource | 'brick' | 'coin';

/** Dimensi satu unit material (dipakai bak kereta & efek). */
export const ITEM_SIZE: Record<ItemKind, { l: number; h: number; w: number }> = {
  wood: { l: 0.46, h: 0.2, w: 0.2 },
  stone: { l: 0.3, h: 0.22, w: 0.26 },
  gem: { l: 0.2, h: 0.3, w: 0.2 },
  brick: { l: 0.36, h: 0.16, w: 0.2 },
  coin: { l: 0.3, h: 0.06, w: 0.3 },
};

const cache = new Map<ItemKind, THREE.BufferGeometry>();

/** Geometri satu item, sumbu panjang = x. Di-cache & dibagi semua pemakai. */
export function itemGeometry(kind: ItemKind): THREE.BufferGeometry {
  let g = cache.get(kind);
  if (g) return g;
  if (kind === 'wood') g = ccyl(0.1, ITEM_SIZE.wood.l, '#b8743f', 9, 0, 0, 0, 0, 0, Math.PI / 2, '#f3d39c');
  else if (kind === 'stone') g = mergeFlat([cbox(0.3, 0.2, 0.26, '#9aa1ab', 0, 0, 0, 0.06), cbox(0.18, 0.08, 0.16, '#b7bdc6', 0.03, 0.12, 0, 0.03)]);
  else if (kind === 'gem') g = mergeFlat([place(colored(new THREE.OctahedronGeometry(0.15, 0), '#ff4f6d'), 0, 0.05, 0), place(colored(new THREE.OctahedronGeometry(0.09, 0), '#ff8aa0'), 0.1, 0, 0.05)]);
  else if (kind === 'coin') g = ccyl(0.16, 0.05, '#f5c020', 14, 0, 0, 0, Math.PI / 2, 0, 0, '#ffe06a');
  else g = mergeFlat([cbox(0.36, 0.16, 0.2, '#d65a3d', 0, 0, 0, 0.025)]);
  cache.set(kind, g);
  return g;
}
