import { finalizeProject } from '../../game/building';
import type { FinalProject, MaterialKind, ModuleDef } from '../../game/types';
import { house } from './house';
import { clockTower, waterTower } from './special';

/**
 * Katalog tipe bangunan kavling. Tambah tipe baru di sini lalu pakai id-nya di config/cities.ts.
 * Setiap tipe punya beberapa varian warna supaya kota tidak monoton.
 */
export interface BuildingType {
  name: string;
  material: MaterialKind;
  build(variant: number): ModuleDef[];
}

const pick = <T,>(arr: T[], v: number): T => arr[((v % arr.length) + arr.length) % arr.length];

const LOGS: [string, string][] = [
  ['#c98b4f', '#b67943'],
  ['#b8743f', '#a8652f'],
  ['#d09a5e', '#bf8850'],
];
const ROOFS: [string, string][] = [
  ['#e05a42', '#cc4a34'],
  ['#2f8f8c', '#277a78'],
  ['#e8a23a', '#d08a26'],
  ['#6c7bd6', '#5a69c4'],
];
const PASTEL: [string, string][] = [
  ['#f3d192', '#e7c27f'],
  ['#bfe0f2', '#aad2e8'],
  ['#c8e6c1', '#b5d9ad'],
  ['#f6c3c8', '#eeb0b7'],
];
const BRICK: [string, string][] = [
  ['#c9563c', '#b94b34'],
  ['#b5523f', '#a3463a'],
  ['#d06f4f', '#bf6044'],
  ['#a95a48', '#984d3d'],
];

export const BUILDINGS: Record<string, BuildingType> = {
  'rumah-kayu': {
    name: 'Rumah Kayu',
    material: 'wood',
    build: (v) =>
      house({ w: 1.7, d: 1.4, floors: 1, floorH: 0.95, wall: 'log', wallColors: pick(LOGS, v), trim: '#f6e7c8', roof: 'gable', roofColors: pick(ROOFS, v), ridge: 'x', door: '#3e8f7c', frontWindows: 2, sideWindows: true, chimney: '#b8b2a7', flowers: true }),
  },
  'rumah-papan': {
    name: 'Rumah Papan',
    material: 'wood',
    build: (v) =>
      house({ w: 1.6, d: 1.4, floors: 1, floorH: 1.0, wall: 'plank', wallColors: pick(PASTEL, v), trim: '#ffffff', roof: 'gable', roofColors: pick(ROOFS, v + 1), ridge: 'z', door: '#d9534a', frontWindows: 1, sideWindows: true, porch: '#c89660', fence: '#ffffff' }),
  },
  warung: {
    name: 'Warung',
    material: 'wood',
    build: (v) =>
      house({ w: 1.8, d: 1.4, floors: 1, floorH: 1.0, wall: 'plank', wallColors: pick([['#ffd66b', '#f5c64f'], ['#ffb08a', '#f59c73'], ['#9fdcc0', '#86cfae']], v), trim: '#ffffff', roof: 'flat', roofColors: ['#8b6a4a', '#a57c55'], door: '#6b4a2b', frontWindows: 1, awning: pick([['#ff5a5f', '#ffffff'], ['#3d9bff', '#ffffff'], ['#2fbf71', '#ffffff']], v), sign: pick(['#2f7d5b', '#6a4fd9', '#d9534a'], v) }),
  },
  'rumah-panggung': {
    name: 'Rumah Panggung',
    material: 'wood',
    build: (v) =>
      house({ w: 1.7, d: 1.4, floors: 1, floorH: 0.95, wall: 'plank', wallColors: pick(LOGS, v + 1), trim: '#f6e7c8', roof: 'gable', roofColors: pick([['#8a5a36', '#7a4e2e'], ['#c0503a', '#ad4532']], v), ridge: 'x', door: '#3e8f7c', frontWindows: 2, stilts: 0.45, porch: '#c89660' }),
  },
  lumbung: {
    name: 'Lumbung',
    material: 'wood',
    build: (v) =>
      house({ w: 1.8, d: 1.5, floors: 1, floorH: 1.2, wall: 'plank', wallColors: pick([['#d9534a', '#c8473f'], ['#c97b3a', '#b86d30']], v), trim: '#ffffff', roof: 'gable', roofColors: ['#5b6474', '#4b5563'], ridge: 'z', door: '#8f2f2a', frontWindows: 0, bigDoor: true, fence: '#ffffff' }),
  },
  'rumah-loteng': {
    name: 'Rumah Loteng',
    material: 'wood',
    build: (v) =>
      house({ w: 1.7, d: 1.4, floors: 2, floorH: 0.85, wall: 'plank', wallColors: pick(PASTEL, v + 2), trim: '#ffffff', roof: 'gable', roofColors: pick(ROOFS, v + 2), ridge: 'x', door: '#2f7d5b', frontWindows: 2, balcony: '#c89660', chimney: '#b0685a', flowers: true }),
  },
  'menara-air': {
    name: 'Menara Air',
    material: 'wood',
    build: (v) => waterTower(pick(['#b98a5a', '#9fb7c9', '#c9a36b'], v), pick(['#e05a42', '#2f8f8c', '#6c7bd6'], v)),
  },
  'rumah-bata': {
    name: 'Rumah Bata',
    material: 'brick',
    build: (v) =>
      house({ w: 1.7, d: 1.4, floors: 1, floorH: 1.0, wall: 'brick', wallColors: pick(BRICK, v), trim: '#fbfaf5', roof: 'gable', roofColors: pick([['#5b6474', '#4b5563'], ['#8a6f5a', '#7a604c']], v), ridge: 'x', door: '#2f7d5b', frontWindows: 2, sideWindows: true, chimney: '#8b8f96', flowers: true }),
  },
  'toko-roti': {
    name: 'Toko Roti',
    material: 'brick',
    build: (v) =>
      house({ w: 1.8, d: 1.4, floors: 1, floorH: 1.1, wall: 'brick', wallColors: pick(BRICK, v + 1), trim: '#fbfaf5', roof: 'flat', roofColors: ['#7e848b', '#b94b34'], door: '#6b4a2b', frontWindows: 1, awning: pick([['#ff8fb1', '#ffffff'], ['#ffcf3a', '#ffffff'], ['#3aa877', '#ffffff']], v), sign: pick(['#8a4b2a', '#1f4e79', '#6a4fd9'], v) }),
  },
  ruko: {
    name: 'Ruko',
    material: 'brick',
    build: (v) =>
      house({ w: 1.8, d: 1.5, floors: 2, floorH: 0.9, wall: 'brick', wallColors: pick(BRICK, v + 2), trim: '#fbfaf5', roof: 'flat', roofColors: ['#7e848b', '#a3463a'], door: '#2d3748', frontWindows: 2, awning: pick([['#3aa877', '#ffffff'], ['#3d9bff', '#ffffff'], ['#ff5a5f', '#ffffff']], v), sign: pick(['#1f4e79', '#2f7d5b', '#d9534a'], v) }),
  },
  'rumah-bata-2': {
    name: 'Rumah Bata Tingkat',
    material: 'brick',
    build: (v) =>
      house({ w: 1.7, d: 1.4, floors: 2, floorH: 0.85, wall: 'brick', wallColors: pick(BRICK, v + 3), trim: '#fbfaf5', roof: 'gable', roofColors: pick([['#4b5563', '#3d4452'], ['#2f8f8c', '#277a78']], v), ridge: 'z', door: '#2f7d5b', frontWindows: 2, balcony: '#6b7280', flowers: true }),
  },
  apartemen: {
    name: 'Apartemen',
    material: 'brick',
    build: (v) =>
      house({ w: 1.8, d: 1.5, floors: 4, floorH: 0.75, wall: 'brick', wallColors: pick(BRICK, v), trim: '#fbfaf5', roof: 'flat', roofColors: ['#7e848b', '#b5523f'], door: '#2d3748', frontWindows: 3, balcony: '#9aa3ad', sideWindows: true }),
  },
  'menara-jam': {
    name: 'Menara Jam',
    material: 'brick',
    build: (v) => clockTower(pick(['#c9563c', '#b5523f'], v), pick(['#2f8f8c', '#4b5563'], v)),
  },
};

const cache = new Map<string, FinalProject>();

/** Proyek final sebuah kavling (biaya modul integer, total = target). Di-cache. */
export function getBuilding(type: string, variant: number, target: number): FinalProject {
  const key = `${type}|${variant}|${target}`;
  let p = cache.get(key);
  if (!p) {
    const t = BUILDINGS[type];
    if (!t) throw new Error(`Tipe bangunan tidak dikenal: ${type}`);
    p = finalizeProject(
      { id: key, name: t.name, material: t.material, target, stageNames: ['Fondasi', 'Dinding', 'Bukaan', 'Atap', 'Detail'], modules: t.build(variant) },
      1,
    );
    cache.set(key, p);
  }
  return p;
}
