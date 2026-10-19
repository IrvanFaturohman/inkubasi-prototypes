/**
 * Struktur data inti permainan. Semua yang ada di sini murni data (tanpa Three.js / DOM),
 * sehingga logika simulasi bisa diuji di Node dan disimpan ke localStorage.
 */

export type MaterialKind = 'wood' | 'brick';
export type ThemeKind = 'forest' | 'meadow' | 'city';

export interface Vec2 {
  x: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Definisi konten (config, tidak disimpan)
// ---------------------------------------------------------------------------

/** Satu konfigurasi bentuk lintasan (expand tahap 0/1/2). */
export interface TrackStageDef {
  /**
   * Titik sudut poligon tertutup, searah jalannya kendaraan. Titik pertama WAJIB titik bongkar
   * (berada di tengah ruas lurus) karena jarak 0 lintasan = titik bongkar.
   */
  corners: [number, number][];
  /** Radius lengkung tiap sudut (titik pertama diabaikan). */
  radius: number;
  /** Batas jumlah kendaraan pada panjang lintasan ini. */
  maxVehicles: number;
}

/** Slot stasiun produksi di tepi lintasan. */
export interface StationSlotDef {
  name: string;
  /** Tahap expand saat slot ini terbuka (0 = dari awal). */
  unlockStage: number;
  /** Posisi pusat mesin (dunia). */
  machine: [number, number];
  /** Posisi pusat penyimpanan (dunia) — harus tepat di tepi jalan. */
  storage: [number, number];
  /** Biaya membangun mesin (slot 0 sudah terbangun gratis). */
  buildCost: number;
}

export interface LevelDefinition {
  id: string;
  areaName: string;
  theme: ThemeKind;
  material: MaterialKind;
  projectId: string;
  /** Posisi & rotasi (radian) bangunan. */
  housePos: [number, number];
  houseRotation: number;
  trackStages: TrackStageDef[];
  slots: StationSlotDef[];
  /** Biaya expand ke tahap 1, 2, ... */
  expandCosts: number[];
  /** Pengali seluruh biaya (Add, upgrade) level ini. */
  costScale: number;
  /** Uang per material yang benar-benar sampai di bangunan. */
  moneyPerUnit: number;
  /** Stok awal penyimpanan pertama supaya pengiriman pertama cepat terlihat. */
  startStorage: number;
  /** Interval produksi dasar (detik per item) pada Produksi Lv. 1. */
  baseInterval: number;
}

/** Primitive geometri bangunan (koordinat lokal bangunan, satuan dunia). */
export type Prim = PrimShape & {
  /** true = hanya tampil di model solid (detail kecil), tidak ikut siluet ghost. */
  noGhost?: boolean;
};

export type PrimShape =
  | {
      kind: 'box';
      p: [number, number, number];
      s: [number, number, number];
      r?: [number, number, number];
      c: string;
      /** Radius pembulatan sudut (0 = kotak tajam). */
      round?: number;
    }
  | {
      /** Silinder (misal batang kayu). axis menentukan arah panjangnya. */
      kind: 'cyl';
      p: [number, number, number];
      radius: number;
      len: number;
      axis: 'x' | 'y' | 'z';
      c: string;
      /** Warna tutup ujung (serat kayu). */
      cap?: string;
      seg?: number;
    }
  | {
      /** Prisma segitiga (dinding gable): alas w di sumbu x, tinggi h di y, tebal d di z. */
      kind: 'prism';
      p: [number, number, number];
      w: number;
      h: number;
      d: number;
      r?: [number, number, number];
      c: string;
    }
  | {
      kind: 'sphere';
      p: [number, number, number];
      radius: number;
      c: string;
    }
  | {
      kind: 'cone';
      p: [number, number, number];
      radius: number;
      h: number;
      c: string;
      seg?: number;
    };

export interface ModuleDef {
  /** Indeks tahap bangunan (0 = fondasi, dst). */
  stage: number;
  /** Bobot relatif; biaya material final dihitung dari bobot ini. */
  weight: number;
  prims: Prim[];
}

export interface ProjectDefinition {
  id: string;
  name: string;
  material: MaterialKind;
  /** Total material yang dibutuhkan. */
  target: number;
  stageNames: string[];
  /** Bonus uang saat tahap ke-i selesai (tahap terakhir memakai completionBonus). */
  stageBonus: number[];
  completionBonus: number;
  modules: ModuleDef[];
}

/** Proyek yang sudah difinalisasi: tiap modul punya biaya integer & ambang kumulatif. */
export interface FinalProject extends ProjectDefinition {
  costs: number[];
  /** thresholds[i] = total material sampai modul i selesai (inklusif). */
  thresholds: number[];
  /** stageEnd[s] = total material saat seluruh tahap s selesai. */
  stageEnd: number[];
  /** Indeks modul pertama tiap tahap. */
  stageFirstModule: number[];
}

// ---------------------------------------------------------------------------
// State yang disimpan
// ---------------------------------------------------------------------------

export interface Vehicle {
  /** Identitas stabil (tidak berubah walau merge/expand). */
  id: number;
  /** Tingkat 1..MAX (kapasitas diambil dari config). */
  level: number;
  cargo: number;
  /** Jarak tempuh di lintasan saat ini, 0 <= distance < panjang lintasan. */
  distance: number;
}

export interface Station {
  slot: number;
  built: boolean;
  /** Produksi Lv. */
  level: number;
  /** Stok yang SUDAH masuk penyimpanan (satu-satunya yang boleh diambil kendaraan). */
  storage: number;
  /**
   * Item yang masih di conveyor: progress 0..1 (1 = tiba di penyimpanan).
   * Invarian: storage + conveyor.length <= storageCapacity.
   */
  conveyor: number[];
  /** Akumulator waktu produksi (detik). */
  timer: number;
}

export interface TutorialFlags {
  boost: boolean;
  add: boolean;
  merge: boolean;
  expand: boolean;
  build: boolean;
  upgrade: boolean;
}

export interface GameStats {
  levelTime: number;
  totalTime: number;
  totalDelivered: number;
  /** Uang dari penjualan sisa material saat proyek selesai (untuk layar hasil). */
  lastLeftoverMoney: number;
  lastCompletionBonus: number;
}

export interface GameState {
  levelIndex: number;
  /** Berapa kali seluruh daftar level sudah diputari (untuk skala kesulitan). */
  cycle: number;
  money: number;
  /** Material yang sudah terpasang di bangunan aktif. */
  delivered: number;
  /** Jumlah tahap yang bonusnya sudah dibayar. */
  stagesPaid: number;
  completed: boolean;
  expandStage: number;
  addsPurchased: number;
  vehicles: Vehicle[];
  nextVehicleId: number;
  stations: Station[];
  tutorial: TutorialFlags;
  stats: GameStats;
}

// ---------------------------------------------------------------------------
// State sementara (tidak disimpan)
// ---------------------------------------------------------------------------

export interface BoostState {
  /** 0..1 energi boost; habis → boost berhenti sampai terisi lagi. */
  energy: number;
  holding: boolean;
  tapTimer: number;
  exhausted: boolean;
  rechargeDelay: number;
  /** Pengali kecepatan saat ini (eased). */
  mult: number;
  /** Total detik boost dipakai (untuk tutorial). */
  usedSeconds: number;
}

export interface Runtime {
  boost: BoostState;
  /** Detik kendaraan dibekukan (animasi expand). */
  freeze: number;
  /** Rasio muatan per pengiriman terakhir (untuk hint bottleneck). */
  recentLoads: number[];
  /** Rata-rata bergerak rasio isi penyimpanan. */
  storageFill: number;
}
