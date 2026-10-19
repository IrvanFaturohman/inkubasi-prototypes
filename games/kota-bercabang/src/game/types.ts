/**
 * Struktur data inti permainan. Semua yang ada di sini murni data (tanpa Three.js / DOM),
 * sehingga logika simulasi bisa diuji di Node dan disimpan ke localStorage.
 *
 * Konsep "Kota Bercabang": pabrik (depot) di tengah dikelilingi jalan persegi. Setiap jalan
 * baru tumbuh keluar dari salah satu sisi depot sebagai jalan dua lajur dengan kavling di kedua
 * sisinya. Secara teknis seluruh jaringan tetap SATU loop tertutup (keliling depot + setiap
 * jalan keluar-masuk), jadi aturan crossing/pickup tetap sederhana dan teruji.
 */

export type MaterialKind = 'wood' | 'brick';
export type ThemeKind = 'forest' | 'meadow' | 'city';
export type HubSide = 'N' | 'E' | 'S' | 'W';

export interface Vec2 {
  x: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Definisi konten (config, tidak disimpan)
// ---------------------------------------------------------------------------

/** Satu kavling bangunan di sisi luar jalan. */
export interface PlotDef {
  /** 'out' = lajur berangkat, 'ret' = lajur pulang, 'end' = ujung jalan (di balik putaran U). */
  lane: 'out' | 'ret' | 'end';
  /** Jarak dari pangkal jalan (sisi depot) untuk lajur out/ret. Diabaikan untuk 'end'. */
  at: number;
  /** Id tipe bangunan (lihat config/buildings). */
  building: string;
  /** Indeks varian warna. */
  variant: number;
  /** Material yang dibutuhkan. */
  target: number;
  /** Uang sewa setiap kali truk melewati bangunan yang sudah jadi. */
  rent: number;
}

export interface StreetDef {
  name: string;
  /** Sisi depot tempat jalan tumbuh. */
  side: HubSide;
  /** Panjang jalan dari pangkal ke ujung. */
  length: number;
  /** Tahap expand saat jalan ini dibuka (0 = sejak awal). */
  unlockStage: number;
  plots: PlotDef[];
}

export interface CityDefinition {
  id: string;
  name: string;
  theme: ThemeKind;
  material: MaterialKind;
  /** Setengah sisi persegi jalan keliling depot (garis tengah jalan). */
  hubHalf: number;
  /** Setengah jarak antar lajur sebuah jalan (garis tengah ke garis tengah). */
  laneHalf: number;
  /** Radius lengkung sudut jalan. */
  radius: number;
  streets: StreetDef[];
  /** Biaya expand ke tahap 1, 2, ... (panjang = jumlah tahap − 1). */
  expandCosts: number[];
  /** Biaya mesin ke-1..4 (mesin pertama gratis). */
  machineCosts: number[];
  costScale: number;
  moneyPerUnit: number;
  baseInterval: number;
  startStorage: number;
  /** Bonus saat semua bangunan di satu jalan selesai (per jalan, urut definisi). */
  streetBonus: number[];
  completionBonus: number;
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
      /** Prisma segitiga: alas w di sumbu x, tinggi h di y, tebal d di z. */
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
      r?: [number, number, number];
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
  modules: ModuleDef[];
}

/** Proyek yang sudah difinalisasi: tiap modul punya biaya integer & ambang kumulatif. */
export interface FinalProject extends ProjectDefinition {
  costs: number[];
  /** thresholds[i] = total material sampai modul i selesai (inklusif). */
  thresholds: number[];
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

/** Pabrik pusat: beberapa jalur mesin + conveyor mengisi SATU penyimpanan bersama. */
export interface Depot {
  /** Produksi Lv (berlaku untuk semua mesin). */
  level: number;
  /** Jumlah mesin aktif (1..4). */
  machines: number;
  /** Stok yang SUDAH masuk penyimpanan (satu-satunya yang boleh diambil kendaraan). */
  storage: number;
  /**
   * Item di conveyor tiap mesin: progress 0..1 (1 = tiba di penyimpanan).
   * Invarian: storage + total item di semua conveyor <= kapasitas.
   */
  lines: number[][];
  /** Akumulator waktu produksi per mesin (detik). */
  timers: number[];
}

export interface TutorialFlags {
  boost: boolean;
  add: boolean;
  merge: boolean;
  expand: boolean;
  machine: boolean;
  upgrade: boolean;
}

export interface GameStats {
  levelTime: number;
  totalTime: number;
  totalDelivered: number;
  totalRent: number;
  lastLeftoverMoney: number;
  lastCompletionBonus: number;
}

export interface GameState {
  /** Indeks kota (level). */
  levelIndex: number;
  /** Berapa kali seluruh daftar kota sudah diputari (skala kesulitan). */
  cycle: number;
  money: number;
  /** Material terpasang per kavling (urutan: jalan demi jalan, kavling demi kavling). */
  plots: number[];
  /** Jalan yang bonusnya sudah dibayar. */
  streetsPaid: boolean[];
  completed: boolean;
  expandStage: number;
  addsPurchased: number;
  vehicles: Vehicle[];
  nextVehicleId: number;
  depot: Depot;
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
  /** Rasio muatan saat meninggalkan depot (untuk hint bottleneck). */
  recentLoads: number[];
  /** Rata-rata bergerak rasio isi penyimpanan. */
  storageFill: number;
}
