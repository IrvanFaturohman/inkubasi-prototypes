import type { LevelDefinition, PlotDef } from '../game/types';

/**
 * Data level. Tiap level: stasiun di tengah hutan + 4 cabang rel (utara, selatan, timur, barat)
 * yang dibuka bertahap lewat "Rel Baru". Kavling ditulis berurutan sesuai arah kereta:
 * lajur berangkat (at naik) → ujung → lajur pulang (at turun). Kavling tertutup hutan dan
 * baru bisa dibangun setelah semua blok di atasnya ditebang.
 * Untuk menambah level: salin satu objek di LEVELS lalu ubah cabang, kavling, zona, dan harga.
 */

const P = (lane: PlotDef['lane'], at: number, building: string, variant: number, target: number, rent: number): PlotDef => ({ lane, at, building, variant, target, rent });

const LONG = 6.6;
const SHORT = 4.3;

export const LEVELS: LevelDefinition[] = [
  {
    id: 'hutan-cemara',
    name: 'Hutan Cemara',
    theme: 'forest',
    material: 'wood',
    buildResource: 'wood',
    hubHalf: 2.8,
    laneHalf: 1.0,
    radius: 0.9,
    streets: [
      {
        name: 'Jalur Cemara',
        side: 'N',
        length: LONG,
        unlockStage: 0,
        plots: [
          P('out', 2.4, 'rumah-kayu', 0, 16, 1),
          P('out', 4.7, 'rumah-papan', 0, 20, 1),
          P('end', 0, 'warung', 0, 24, 2),
          P('ret', 4.7, 'rumah-panggung', 0, 26, 2),
          P('ret', 2.4, 'rumah-kayu', 1, 22, 2),
        ],
      },
      {
        name: 'Jalur Pinus',
        side: 'S',
        length: LONG,
        unlockStage: 1,
        plots: [
          P('out', 2.4, 'rumah-papan', 1, 28, 2),
          P('out', 4.7, 'warung', 1, 32, 3),
          P('end', 0, 'lumbung', 0, 44, 4),
          P('ret', 4.7, 'rumah-kayu', 2, 30, 3),
          P('ret', 2.4, 'rumah-loteng', 0, 46, 4),
        ],
      },
      {
        name: 'Jalur Mahoni',
        side: 'E',
        length: SHORT,
        unlockStage: 2,
        plots: [P('out', 2.4, 'rumah-panggung', 1, 42, 4), P('end', 0, 'menara-air', 0, 60, 6), P('ret', 2.4, 'lumbung', 1, 50, 5)],
      },
      {
        name: 'Jalur Jati',
        side: 'W',
        length: LONG,
        unlockStage: 3,
        plots: [
          P('out', 2.4, 'rumah-loteng', 1, 54, 5),
          P('out', 4.7, 'rumah-papan', 2, 44, 4),
          P('end', 0, 'menara-air', 1, 70, 7),
          P('ret', 4.7, 'warung', 2, 48, 5),
          P('ret', 2.4, 'rumah-kayu', 3, 40, 4),
        ],
      },
    ],
    expandCosts: [60, 160, 320],
    mapHalf: 16,
    zones: [
      { maxR: 8, weights: { tree: 92, coins: 4, rock: 4 } },
      { maxR: 12, weights: { treeGold: 70, tree: 16, rock: 10, coins: 4 } },
      { maxR: 99, weights: { treeRed: 58, rock: 24, crystal: 14, coins: 4 } },
    ],
    seed: 1337,
    costScale: 1,
    streetBonus: [20, 40, 60, 90],
    completionBonus: 200,
  },
  {
    id: 'lembah-batu',
    name: 'Lembah Batu',
    theme: 'meadow',
    material: 'brick',
    buildResource: 'stone',
    hubHalf: 2.8,
    laneHalf: 1.0,
    radius: 0.9,
    streets: [
      {
        name: 'Jalur Granit',
        side: 'N',
        length: LONG,
        unlockStage: 0,
        plots: [
          P('out', 2.4, 'rumah-bata', 0, 24, 3),
          P('out', 4.7, 'toko-roti', 0, 28, 3),
          P('end', 0, 'apartemen', 0, 60, 6),
          P('ret', 4.7, 'ruko', 0, 40, 4),
          P('ret', 2.4, 'rumah-bata', 1, 28, 3),
        ],
      },
      {
        name: 'Jalur Marmer',
        side: 'S',
        length: LONG,
        unlockStage: 1,
        plots: [
          P('out', 2.4, 'ruko', 1, 44, 5),
          P('out', 4.7, 'rumah-bata-2', 0, 48, 5),
          P('end', 0, 'menara-jam', 0, 90, 9),
          P('ret', 4.7, 'toko-roti', 1, 36, 4),
          P('ret', 2.4, 'rumah-bata', 2, 32, 4),
        ],
      },
      {
        name: 'Jalur Kapur',
        side: 'E',
        length: SHORT,
        unlockStage: 2,
        plots: [P('out', 2.4, 'apartemen', 1, 70, 7), P('end', 0, 'rumah-bata-2', 1, 56, 6), P('ret', 2.4, 'ruko', 2, 50, 5)],
      },
      {
        name: 'Jalur Andesit',
        side: 'W',
        length: LONG,
        unlockStage: 3,
        plots: [
          P('out', 2.4, 'rumah-bata-2', 2, 56, 6),
          P('out', 4.7, 'toko-roti', 2, 44, 5),
          P('end', 0, 'apartemen', 2, 90, 8),
          P('ret', 4.7, 'ruko', 0, 56, 6),
          P('ret', 2.4, 'rumah-bata', 3, 40, 4),
        ],
      },
    ],
    expandCosts: [160, 400, 800],
    mapHalf: 16,
    zones: [
      { maxR: 8, weights: { rock: 60, tree: 34, coins: 6 } },
      { maxR: 12, weights: { rock: 55, treeGold: 35, crystal: 6, coins: 4 } },
      { maxR: 99, weights: { rock: 45, treeRed: 30, crystal: 21, coins: 4 } },
    ],
    seed: 4242,
    costScale: 2.5,
    streetBonus: [60, 120, 180, 260],
    completionBonus: 500,
  },
];
