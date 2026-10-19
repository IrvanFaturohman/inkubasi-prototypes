import type { BlockKind, Resource } from '../game/types';

/**
 * Angka balancing global. Ubah di sini untuk menyetel rasa permainan;
 * angka per level (target bangunan, sewa, biaya rel, zona hutan) ada di levels.ts.
 */
export const BALANCE = {
  /** Kecepatan dasar kereta (unit dunia per detik) & kenaikan per level Kecepatan. */
  speed: { base: 3.4, perLevel: 0.1, maxLevel: 20 },
  /** Kapasitas muatan dasar & pengali per level Kapasitas. */
  capacity: { base: 20, growth: 1.3, maxLevel: 20 },
  /** Kerusakan gergaji per detik gerbong Lv1 & pengali per level (hasil merge); jangkauan melebar tiap level. */
  saw: { dps: 2.6, growth: 1.8, reach: 2.65, reachPerLevel: 0.22 },
  /** Jarak antar gerbong di rel. */
  wagonSpacing: 1.05,
  maxWagons: 12,
  maxWagonLevel: 8,

  boost: {
    mult: 1.7,
    tapDuration: 0.65,
    maxHoldSeconds: 7,
    rechargeSeconds: 4.5,
    rechargeDelay: 0.5,
    resumeAt: 0.3,
    accel: 10,
    decel: 3.2,
  },

  cost: {
    add: { base: 10, growth: 1.55 },
    merge: { base: 15, growth: 1.45 },
    speed: { base: 20, growth: 1.6 },
    capacity: { base: 20, growth: 1.6 },
  },

  /** Harga jual per unit muatan di stasiun. */
  price: { wood: 1, stone: 2, gem: 10 } as Record<Resource, number>,

  /**
   * Blok hutan: HP, hasil tebang, uang langsung (tumpukan koin), dan waktu tumbuh kembali
   * (detik; 0 = tidak tumbuh lagi). Hutan yang tumbuh kembali membuat kereta selalu punya
   * sesuatu untuk ditebang — pasokan bahan tidak pernah habis (tidak ada softlock).
   */
  blocks: {
    tree: { hp: 2, res: 'wood', amount: 2, regrow: 30 },
    treeGold: { hp: 4, res: 'wood', amount: 3, regrow: 40 },
    treeRed: { hp: 7, res: 'wood', amount: 5, regrow: 55 },
    rock: { hp: 6, res: 'stone', amount: 3, regrow: 45 },
    crystal: { hp: 12, res: 'gem', amount: 1, regrow: 90 },
    coins: { hp: 1, res: null, amount: 0, money: 20, regrow: 0 },
  } as Record<BlockKind, { hp: number; res: Resource | null; amount: number; money?: number; regrow: number }>,

  /** Pengali biaya, target, harga & sewa tiap putaran ulang daftar level. */
  cycleScale: 0.6,
  expandFreeze: 1.35,
  maxFrameDt: 0.1,
  maxStepDt: 1 / 30,
  autosaveSeconds: 5,
};
