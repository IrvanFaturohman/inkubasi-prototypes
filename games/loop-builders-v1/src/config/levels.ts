import type { LevelDefinition, TrackStageDef } from '../game/types';

/**
 * Data level. Untuk menambah level: tambahkan objek baru di LEVELS
 * (lihat README bagian "Menambah level"). Semua posisi dalam satuan dunia:
 * x ke kanan layar, z ke arah kamera (bawah layar), bangunan di z negatif (atas layar).
 */

/** Lintasan persegi membulat. dir=1 searah jarum jam di layar (bongkar → kanan → bawah → kiri). */
function rectStage(top: number, bottom: number, halfW: number, radius: number, maxVehicles: number, dir: 1 | -1 = 1): TrackStageDef {
  const corners: [number, number][] =
    dir === 1
      ? [
          [0, top],
          [halfW, top],
          [halfW, bottom],
          [-halfW, bottom],
          [-halfW, top],
        ]
      : [
          [0, top],
          [-halfW, top],
          [-halfW, bottom],
          [halfW, bottom],
          [halfW, top],
        ];
  return { corners, radius, maxVehicles };
}

export const LEVELS: LevelDefinition[] = [
  {
    id: 'forest-cabin',
    areaName: 'Hutan Cerah',
    theme: 'forest',
    material: 'wood',
    projectId: 'cabin',
    housePos: [0, -8.6],
    houseRotation: 0,
    trackStages: [rectStage(-4.2, 1.0, 2.8, 1.4, 6), rectStage(-4.2, 4.8, 2.8, 1.4, 8), rectStage(-4.2, 8.4, 2.8, 1.4, 10)],
    slots: [
      { name: 'Penggergajian A', unlockStage: 0, machine: [4.2, -4.4], storage: [4.2, -1.9], buildCost: 0 },
      { name: 'Penggergajian B', unlockStage: 1, machine: [4.2, 0.1], storage: [4.2, 2.6], buildCost: 20 },
      { name: 'Penggergajian C', unlockStage: 2, machine: [-4.2, 2.1], storage: [-4.2, 4.6], buildCost: 40 },
    ],
    expandCosts: [30, 70],
    costScale: 1,
    moneyPerUnit: 1,
    startStorage: 4,
    baseInterval: 0.8,
  },
  {
    id: 'meadow-house',
    areaName: 'Pinggir Hutan',
    theme: 'meadow',
    material: 'wood',
    projectId: 'bighouse',
    housePos: [-0.6, -9.5],
    houseRotation: 0,
    trackStages: [rectStage(-4.6, 0.8, 3.1, 2.0, 6), rectStage(-4.6, 4.6, 3.1, 2.0, 8), rectStage(-4.6, 8.4, 3.1, 2.0, 10)],
    slots: [
      { name: 'Penggergajian A', unlockStage: 0, machine: [4.5, -4.6], storage: [4.5, -2.1], buildCost: 0 },
      { name: 'Penggergajian B', unlockStage: 1, machine: [4.5, 0.2], storage: [4.5, 2.7], buildCost: 55 },
      { name: 'Penggergajian C', unlockStage: 2, machine: [-4.5, 2.2], storage: [-4.5, 4.7], buildCost: 120 },
    ],
    expandCosts: [80, 190],
    costScale: 2.2,
    moneyPerUnit: 1,
    startStorage: 6,
    baseInterval: 0.7,
  },
  {
    id: 'city-brick',
    areaName: 'Pinggir Kota',
    theme: 'city',
    material: 'brick',
    projectId: 'brickhouse',
    housePos: [0, -8.9],
    houseRotation: 0,
    trackStages: [rectStage(-4.8, 0.6, 3.0, 1.0, 6, -1), rectStage(-4.8, 4.4, 3.0, 1.0, 8, -1), rectStage(-4.8, 8.2, 3.0, 1.0, 10, -1)],
    slots: [
      { name: 'Cetak Bata A', unlockStage: 0, machine: [-4.4, -5.0], storage: [-4.4, -2.5], buildCost: 0 },
      { name: 'Cetak Bata B', unlockStage: 1, machine: [-4.4, -0.2], storage: [-4.4, 2.3], buildCost: 110 },
      { name: 'Cetak Bata C', unlockStage: 2, machine: [4.4, 2.1], storage: [4.4, 4.6], buildCost: 240 },
    ],
    expandCosts: [170, 420],
    costScale: 4,
    moneyPerUnit: 2,
    startStorage: 6,
    baseInterval: 0.65,
  },
];
