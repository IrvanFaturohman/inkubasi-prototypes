/**
 * Angka balancing global. Ubah di sini untuk menyetel rasa permainan;
 * angka per kota (target bangunan, sewa, biaya jalan/mesin) ada di cities.ts.
 */
export const BALANCE = {
  /** Kapasitas per tingkat kendaraan (Lv1..Lv6). 2×cap(n) <= cap(n+1) supaya merge tidak overflow. */
  vehicleCapacity: [4, 10, 24, 55, 120, 260],
  /** Kecepatan dasar kendaraan (unit dunia per detik). */
  vehicleSpeed: 5.0,
  /** Jarak minimum antar kendaraan (visual) sebelum yang di belakang mengerem. */
  minVehicleGap: 1.25,
  /** Kekuatan penyeimbang jarak antar kendaraan (0 = mati). */
  spacingGain: 0.14,
  /** Panjang lintasan per kendaraan maksimum (batas jumlah kendaraan). */
  lengthPerVehicle: 3.4,

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

  add: { base: 10, growth: 1.45 },
  /** Upgrade produksi depot (berlaku ke semua mesin). */
  upgrade: { base: 16, growth: 1.7, maxLevel: 12 },
  /** Setiap Produksi Lv. menambah throughput tiap mesin sebesar faktor ini (+40%). */
  productionGrowth: 1.4,
  /** Kapasitas penyimpanan depot: dasar + per level + per mesin tambahan. */
  storage: { base: 12, perLevel: 4, perMachine: 6 },
  maxMachines: 4,
  /** Waktu item menempuh conveyor (detik). */
  conveyorTime: 0.9,

  /** Pengali biaya, target & sewa tiap putaran ulang daftar kota. */
  cycleScale: 0.6,
  /** Durasi pembekuan kendaraan selama animasi jalan baru (detik). */
  expandFreeze: 1.35,
  /** Batas dt per frame & per sub-step simulasi. */
  maxFrameDt: 0.1,
  maxStepDt: 1 / 30,
  autosaveSeconds: 5,
};

export const MAX_VEHICLE_LEVEL = BALANCE.vehicleCapacity.length;
