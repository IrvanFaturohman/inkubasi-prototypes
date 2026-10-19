/**
 * Angka balancing global. Ubah di sini untuk menyetel rasa permainan;
 * angka per-level (biaya expand, target, dll.) ada di levels.ts dan projects/.
 */
export const BALANCE = {
  /** Kapasitas per tingkat kendaraan (Lv1..Lv6). 2×cap(n) <= cap(n+1) supaya merge tidak overflow. */
  vehicleCapacity: [4, 10, 24, 55, 120, 260],
  /** Kecepatan dasar kendaraan (unit dunia per detik). */
  vehicleSpeed: 4.3,
  /** Jarak minimum antar kendaraan (visual) sebelum yang di belakang mengerem. */
  minVehicleGap: 1.25,
  /** Kekuatan penyeimbang jarak antar kendaraan (0 = mati). */
  spacingGain: 0.14,

  boost: {
    /** Pengali kecepatan saat boost (+70%). */
    mult: 1.7,
    /** Lama boost dari satu ketukan (detik). */
    tapDuration: 0.65,
    /** Energi penuh cukup untuk berapa detik boost terus-menerus (batas hold). */
    maxHoldSeconds: 7,
    /** Detik untuk mengisi energi dari 0 ke penuh. */
    rechargeSeconds: 4.5,
    /** Jeda sebelum energi mulai terisi lagi. */
    rechargeDelay: 0.5,
    /** Setelah habis, boost aktif lagi saat energi >= nilai ini. */
    resumeAt: 0.3,
    accel: 10,
    decel: 3.2,
  },

  add: { base: 10, growth: 1.5 },
  upgrade: { base: 16, growth: 1.72, maxLevel: 10 },
  /** Setiap Produksi Lv. menambah throughput sebesar faktor ini (+50%). */
  productionGrowth: 1.5,
  storage: { base: 12, perLevel: 4 },
  /** Waktu item menempuh conveyor (detik). */
  conveyorTime: 1.15,
  /** Biaya upgrade slot 2/3 sedikit lebih mahal. */
  slotUpgradeFactor: [1, 1.25, 1.5],

  /** Pengali biaya & target tiap putaran ulang daftar level. */
  cycleScale: 0.6,
  /** Durasi pembekuan kendaraan selama animasi expand (detik). */
  expandFreeze: 1.35,
  /** Batas dt per frame & per sub-step simulasi. */
  maxFrameDt: 0.1,
  maxStepDt: 1 / 30,
  autosaveSeconds: 5,
};

export const MAX_VEHICLE_LEVEL = BALANCE.vehicleCapacity.length;
