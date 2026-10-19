/**
 * Struktur data inti permainan. Semua yang ada di sini murni data (tanpa Three.js / DOM),
 * sehingga logika simulasi bisa diuji di Node dan disimpan ke localStorage.
 *
 * Konsep "Tebang & Bangun": satu kereta dengan gerbong gergaji berkeliling rel yang
 * bercabang ke hutan. Gergaji menebang blok (pohon, batu, kristal) di sekitar rel; lahan
 * kavling yang sudah bersih menjadi tempat membangun rumah dari kayu/batu hasil tebangan.
 * Rumah yang jadi membayar sewa tiap kereta lewat, sisa muatan dijual di stasiun.
 * Seluruh jaringan rel secara teknis tetap SATU loop tertutup (keliling stasiun + setiap
 * cabang keluar-masuk), jadi aturan crossing tetap sederhana dan teruji.
 */

export type MaterialKind = 'wood' | 'brick';
export type ThemeKind = 'forest' | 'meadow' | 'city';
export type HubSide = 'N' | 'E' | 'S' | 'W';
/** Jenis muatan kereta. */
export type Resource = 'wood' | 'stone' | 'gem';

export interface Vec2 {
  x: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Definisi konten (config, tidak disimpan)
// ---------------------------------------------------------------------------

/** Satu kavling bangunan di sisi luar rel. */
export interface PlotDef {
  /** 'out' = lajur berangkat, 'ret' = lajur pulang, 'end' = ujung cabang (di balik putaran U). */
  lane: 'out' | 'ret' | 'end';
  /** Jarak dari pangkal cabang (sisi stasiun) untuk lajur out/ret. Diabaikan untuk 'end'. */
  at: number;
  /** Id tipe bangunan (lihat config/buildings). */
  building: string;
  variant: number;
  /** Material yang dibutuhkan. */
  target: number;
  /** Uang sewa setiap kali kereta melewati bangunan yang sudah jadi. */
  rent: number;
}

export interface StreetDef {
  name: string;
  side: HubSide;
  length: number;
  unlockStage: number;
  plots: PlotDef[];
}

/** Zona hutan berdasar jarak dari stasiun: bobot tiap jenis blok. */
export interface ZoneDef {
  /** Berlaku untuk jarak < maxR (zona pertama yang cocok dipakai). */
  maxR: number;
  weights: Partial<Record<BlockKind, number>>;
}

export type BlockKind = 'tree' | 'treeGold' | 'treeRed' | 'rock' | 'crystal' | 'coins';

export interface LevelDefinition {
  id: string;
  name: string;
  theme: ThemeKind;
  /** Tampilan bangunan: kayu atau bata. */
  material: MaterialKind;
  /** Muatan yang dipakai membangun (kayu → rumah kayu, batu → rumah bata). */
  buildResource: Resource;
  hubHalf: number;
  laneHalf: number;
  radius: number;
  streets: StreetDef[];
  expandCosts: number[];
  /** Setengah lebar peta hutan (blok ada di [-mapHalf, mapHalf]). */
  mapHalf: number;
  zones: ZoneDef[];
  seed: number;
  costScale: number;
  streetBonus: number[];
  completionBonus: number;
}

/** Primitive geometri bangunan (koordinat lokal bangunan, satuan dunia). */
export type Prim = PrimShape & {
  /** true = hanya tampil di model solid (detail kecil), tidak ikut siluet ghost. */
  noGhost?: boolean;
};

export type PrimShape =
  | { kind: 'box'; p: [number, number, number]; s: [number, number, number]; r?: [number, number, number]; c: string; round?: number }
  | { kind: 'cyl'; p: [number, number, number]; radius: number; len: number; axis: 'x' | 'y' | 'z'; c: string; cap?: string; seg?: number }
  | { kind: 'prism'; p: [number, number, number]; w: number; h: number; d: number; r?: [number, number, number]; c: string }
  | { kind: 'sphere'; p: [number, number, number]; radius: number; c: string }
  | { kind: 'cone'; p: [number, number, number]; radius: number; h: number; c: string; seg?: number; r?: [number, number, number] };

export interface ModuleDef {
  stage: number;
  weight: number;
  prims: Prim[];
}

export interface ProjectDefinition {
  id: string;
  name: string;
  material: MaterialKind;
  target: number;
  stageNames: string[];
  modules: ModuleDef[];
}

/** Proyek yang sudah difinalisasi: tiap modul punya biaya integer & ambang kumulatif. */
export interface FinalProject extends ProjectDefinition {
  costs: number[];
  thresholds: number[];
}

// ---------------------------------------------------------------------------
// State yang disimpan
// ---------------------------------------------------------------------------

export interface Cargo {
  wood: number;
  stone: number;
  gem: number;
}

export interface Train {
  /** Jarak tempuh lokomotif di lintasan, 0 <= distance < panjang lintasan. */
  distance: number;
  /** Tingkat tiap gerbong gergaji, urut dari belakang lokomotif (tertinggi di depan). */
  wagons: number[];
  cargo: Cargo;
}

export interface TutorialFlags {
  boost: boolean;
  add: boolean;
  merge: boolean;
  expand: boolean;
  capacity: boolean;
  speed: boolean;
}

export interface GameStats {
  levelTime: number;
  totalTime: number;
  totalCut: number;
  totalRent: number;
  totalSold: number;
  lastCompletionBonus: number;
  lastLeftoverMoney: number;
}

export interface GameState {
  levelIndex: number;
  cycle: number;
  money: number;
  /**
   * HP sisa tiap sel hutan: >0 blok hidup, 0 = sudah ditebang (tunggul), -1 = kosong
   * (tidak pernah ada blok / jalur rel).
   */
  blocks: number[];
  /** Progres tumbuh kembali (0..1) tunggul; saat mencapai 1 blok hidup lagi dengan HP penuh. */
  growth: number[];
  /** Material terpasang per kavling. */
  plots: number[];
  streetsPaid: boolean[];
  completed: boolean;
  expandStage: number;
  train: Train;
  speedLevel: number;
  capacityLevel: number;
  addsPurchased: number;
  mergesPurchased: number;
  tutorial: TutorialFlags;
  stats: GameStats;
}

// ---------------------------------------------------------------------------
// State sementara (tidak disimpan)
// ---------------------------------------------------------------------------

export interface BoostState {
  energy: number;
  holding: boolean;
  tapTimer: number;
  exhausted: boolean;
  rechargeDelay: number;
  mult: number;
  usedSeconds: number;
}

export interface Runtime {
  boost: BoostState;
  /** Detik kereta dibekukan (animasi rel baru). */
  freeze: number;
  /** Detik terakhir gergaji menebang (untuk audio/visual). */
  cutHeat: number;
  /** Detik muatan penuh berturut-turut (untuk hint kapasitas). */
  fullTime: number;
}
