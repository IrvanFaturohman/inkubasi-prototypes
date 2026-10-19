import type { CityDefinition, PlotDef } from '../game/types';

/**
 * Data kota (level). Tiap kota: depot di tengah + 4 jalan (utara, selatan, timur, barat)
 * yang dibuka bertahap lewat "Jalan Baru". Kavling ditulis berurutan sesuai arah jalan truk:
 * lajur berangkat (at naik) → ujung → lajur pulang (at turun).
 * Untuk menambah kota: salin satu objek di CITIES lalu ubah jalan, kavling, dan harga.
 */

const P = (lane: PlotDef['lane'], at: number, building: string, variant: number, target: number, rent: number): PlotDef => ({ lane, at, building, variant, target, rent });

/** Panjang jalan standar: dua kavling per sisi (6,6) atau satu kavling per sisi (4,3). */
const LONG = 6.6;
const SHORT = 4.3;

export const CITIES: CityDefinition[] = [
  {
    id: 'desa-kayu',
    name: 'Desa Kayu Rimbun',
    theme: 'forest',
    material: 'wood',
    hubHalf: 2.8,
    laneHalf: 1.0,
    radius: 0.9,
    streets: [
      {
        name: 'Jalan Cemara',
        side: 'N',
        length: LONG,
        unlockStage: 0,
        plots: [
          P('out', 2.4, 'rumah-kayu', 0, 20, 1),
          P('out', 4.7, 'rumah-papan', 0, 25, 1),
          P('end', 0, 'warung', 0, 30, 2),
          P('ret', 4.7, 'rumah-panggung', 0, 32, 2),
          P('ret', 2.4, 'rumah-kayu', 1, 28, 1),
        ],
      },
      {
        name: 'Jalan Pinus',
        side: 'S',
        length: LONG,
        unlockStage: 1,
        plots: [
          P('out', 2.4, 'rumah-papan', 1, 32, 2),
          P('out', 4.7, 'warung', 1, 38, 2),
          P('end', 0, 'lumbung', 0, 50, 3),
          P('ret', 4.7, 'rumah-kayu', 2, 35, 2),
          P('ret', 2.4, 'rumah-loteng', 0, 52, 3),
        ],
      },
      {
        name: 'Jalan Mahoni',
        side: 'E',
        length: SHORT,
        unlockStage: 2,
        plots: [P('out', 2.4, 'rumah-panggung', 1, 48, 3), P('end', 0, 'menara-air', 0, 69, 4), P('ret', 2.4, 'lumbung', 1, 58, 3)],
      },
      {
        name: 'Jalan Jati',
        side: 'W',
        length: LONG,
        unlockStage: 3,
        plots: [
          P('out', 2.4, 'rumah-loteng', 1, 62, 3),
          P('out', 4.7, 'rumah-papan', 2, 50, 3),
          P('end', 0, 'menara-air', 1, 81, 5),
          P('ret', 4.7, 'warung', 2, 55, 3),
          P('ret', 2.4, 'rumah-kayu', 3, 45, 2),
        ],
      },
    ],
    expandCosts: [30, 90, 150],
    machineCosts: [0, 25, 70, 160],
    costScale: 1,
    moneyPerUnit: 1,
    baseInterval: 0.8,
    startStorage: 6,
    streetBonus: [20, 40, 60, 90],
    completionBonus: 150,
  },
  {
    id: 'kota-bata',
    name: 'Kota Bata Senja',
    theme: 'city',
    material: 'brick',
    hubHalf: 2.8,
    laneHalf: 1.0,
    radius: 0.9,
    streets: [
      {
        name: 'Jalan Merdeka',
        side: 'N',
        length: LONG,
        unlockStage: 0,
        plots: [
          P('out', 2.4, 'rumah-bata', 0, 39, 3),
          P('out', 4.7, 'toko-roti', 0, 44, 3),
          P('end', 0, 'apartemen', 0, 104, 6),
          P('ret', 4.7, 'ruko', 0, 65, 4),
          P('ret', 2.4, 'rumah-bata', 1, 44, 3),
        ],
      },
      {
        name: 'Jalan Sudirman',
        side: 'S',
        length: LONG,
        unlockStage: 1,
        plots: [
          P('out', 2.4, 'ruko', 1, 73, 5),
          P('out', 4.7, 'rumah-bata-2', 0, 78, 5),
          P('end', 0, 'menara-jam', 0, 143, 9),
          P('ret', 4.7, 'toko-roti', 1, 57, 4),
          P('ret', 2.4, 'rumah-bata', 2, 52, 3),
        ],
      },
      {
        name: 'Jalan Thamrin',
        side: 'E',
        length: SHORT,
        unlockStage: 2,
        plots: [P('out', 2.4, 'apartemen', 1, 117, 7), P('end', 0, 'rumah-bata-2', 1, 91, 6), P('ret', 2.4, 'ruko', 2, 83, 5)],
      },
      {
        name: 'Jalan Diponegoro',
        side: 'W',
        length: LONG,
        unlockStage: 3,
        plots: [
          P('out', 2.4, 'rumah-bata-2', 2, 91, 6),
          P('out', 4.7, 'toko-roti', 2, 70, 5),
          P('end', 0, 'apartemen', 2, 143, 8),
          P('ret', 4.7, 'ruko', 0, 91, 6),
          P('ret', 2.4, 'rumah-bata', 3, 65, 4),
        ],
      },
    ],
    expandCosts: [120, 300, 460],
    machineCosts: [0, 90, 240, 520],
    costScale: 3,
    moneyPerUnit: 2,
    baseInterval: 0.7,
    startStorage: 8,
    streetBonus: [80, 160, 240, 360],
    completionBonus: 600,
  },
];
