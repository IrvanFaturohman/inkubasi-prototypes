import type { TrackShape } from './track';
import type { CityDefinition, HubSide, PlotDef, Vec2 } from './types';

/**
 * Tata letak kota: menghasilkan titik sudut loop tertutup untuk sebuah tahap expand,
 * posisi kavling, dan titik pickup di sisi depot.
 *
 * Loop berjalan searah jarum jam (di layar: x ke kanan, z ke bawah) mengelilingi depot.
 * Setiap jalan yang terbuka menjadi "ekskursi" dari tengah sisi depot:
 *   pangkal lajur berangkat → keluar sejauh `length` → putaran U → lajur pulang → kembali ke sisi.
 * Hasilnya satu kurva tertutup tanpa persimpangan, tetapi terlihat seperti jaringan jalan
 * dua lajur yang bercabang dari pusat.
 */

export const LOT_W = 2.0; // lebar kavling sepanjang jalan
export const LOT_D = 1.8; // kedalaman kavling
/** Jarak pusat kavling dari garis tengah lajur (setengah jalan + kerb + trotoar + setengah kavling). */
export const LOT_OFFSET = 1.95;

interface SideGeo {
  start: Vec2;
  dir: Vec2;
  out: Vec2;
}

export const SIDE_ORDER: HubSide[] = ['N', 'E', 'S', 'W'];

const SIDES: Record<HubSide, SideGeo> = {
  N: { start: { x: -1, z: -1 }, dir: { x: 1, z: 0 }, out: { x: 0, z: -1 } },
  E: { start: { x: 1, z: -1 }, dir: { x: 0, z: 1 }, out: { x: 1, z: 0 } },
  S: { start: { x: 1, z: 1 }, dir: { x: -1, z: 0 }, out: { x: 0, z: 1 } },
  W: { start: { x: -1, z: 1 }, dir: { x: 0, z: -1 }, out: { x: -1, z: 0 } },
};

/** Normal kiri (di layar) dari arah v — untuk loop searah jarum jam ini = sisi luar. */
function left(v: Vec2): Vec2 {
  return { x: v.z, z: -v.x };
}

function add(a: Vec2, b: Vec2, s = 1): Vec2 {
  return { x: a.x + b.x * s, z: a.z + b.z * s };
}

export interface ResolvedPlot {
  /** Indeks global kavling (urutan jalan lalu kavling). */
  index: number;
  street: number;
  def: PlotDef;
  /** Pusat kavling. */
  pos: Vec2;
  /** Arah hadap bangunan (lokal +z menghadap jalan). */
  rotY: number;
  /** Titik di garis tengah lajur tempat truk "melintasi" kavling. */
  anchor: Vec2;
  /** Arah hadap (unit) dari kavling ke jalan. */
  facing: Vec2;
}

export interface StreetGeo {
  street: number;
  side: HubSide;
  /** Empat sudut ekskursi: pangkal berangkat, ujung berangkat, ujung pulang, pangkal pulang. */
  a: Vec2;
  b: Vec2;
  c: Vec2;
  d: Vec2;
  out: Vec2;
}

function streetGeo(city: CityDefinition, si: number): StreetGeo {
  const st = city.streets[si];
  const H = city.hubHalf;
  const L = city.laneHalf;
  const g = SIDES[st.side];
  const start = { x: g.start.x * H, z: g.start.z * H };
  const a = add(start, g.dir, H - L);
  const d = add(start, g.dir, H + L);
  const b = add(a, g.out, st.length);
  const c = add(d, g.out, st.length);
  return { street: si, side: st.side, a, b, c, d, out: g.out };
}

/** Semua kavling kota (posisi tidak bergantung tahap). */
export function resolvePlots(city: CityDefinition): ResolvedPlot[] {
  const out: ResolvedPlot[] = [];
  city.streets.forEach((st, si) => {
    const g = streetGeo(city, si);
    for (const def of st.plots) {
      let anchor: Vec2;
      let facing: Vec2;
      let pos: Vec2;
      if (def.lane === 'out') {
        anchor = add(g.a, g.out, def.at);
        const n = left(g.out);
        pos = add(anchor, n, LOT_OFFSET);
        facing = { x: -n.x, z: -n.z };
      } else if (def.lane === 'ret') {
        anchor = add(g.d, g.out, def.at);
        const n = left({ x: -g.out.x, z: -g.out.z });
        pos = add(anchor, n, LOT_OFFSET);
        facing = { x: -n.x, z: -n.z };
      } else {
        anchor = { x: (g.b.x + g.c.x) / 2, z: (g.b.z + g.c.z) / 2 };
        pos = add(anchor, g.out, LOT_OFFSET);
        facing = { x: -g.out.x, z: -g.out.z };
      }
      out.push({ index: out.length, street: si, def, pos, anchor, facing, rotY: Math.atan2(facing.x, facing.z) });
    }
  });
  return out;
}

/** Titik sudut loop untuk tahap `stage` (titik pertama = titik awal di sisi barat, di ruas lurus). */
export function stageCorners(city: CityDefinition, stage: number): [number, number][] {
  const H = city.hubHalf;
  const L = city.laneHalf;
  const r = city.radius;
  const pts: Vec2[] = [];
  const W = SIDES.W;
  // Titik awal: sisi barat, antara lajur pulang jalan barat dan sudut barat laut (selalu lurus).
  const ts = (H + L + 2 * H - r) / 2;
  pts.push(add({ x: W.start.x * H, z: W.start.z * H }, W.dir, ts));
  for (const side of SIDE_ORDER) {
    const g = SIDES[side];
    pts.push({ x: g.start.x * H, z: g.start.z * H });
    const si = city.streets.findIndex((s) => s.side === side && s.unlockStage <= stage);
    if (si >= 0) {
      const sg = streetGeo(city, si);
      pts.push(sg.a, sg.b, sg.c, sg.d);
    }
  }
  return pts.map((p) => [round(p.x), round(p.z)]);
}

/** Titik pickup di keempat sisi depot, tepat sebelum pangkal jalan di sisi tersebut. */
export function pickupPoints(city: CityDefinition): Vec2[] {
  const H = city.hubHalf;
  const L = city.laneHalf;
  return SIDE_ORDER.map((side) => {
    const g = SIDES[side];
    return add({ x: g.start.x * H, z: g.start.z * H }, g.dir, (H - L) / 2);
  });
}

export function stageDef(city: CityDefinition, stage: number): TrackShape {
  return { corners: stageCorners(city, stage), radius: city.radius };
}

export function stageCount(city: CityDefinition): number {
  return city.expandCosts.length + 1;
}

export function streetsUnlocked(city: CityDefinition, stage: number): number[] {
  return city.streets.map((s, i) => (s.unlockStage <= stage ? i : -1)).filter((i) => i >= 0);
}

export function streetGeometry(city: CityDefinition, si: number): StreetGeo {
  return streetGeo(city, si);
}

/** Kotak batas (x/z) area yang terpakai pada tahap tertentu (jalan + kavling terbuka). */
export function stageBounds(city: CityDefinition, stage: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const H = city.hubHalf + 0.9;
  let b = { minX: -H, maxX: H, minZ: -H, maxZ: H };
  const plots = resolvePlots(city);
  for (const p of plots) {
    if (city.streets[p.street].unlockStage > stage) continue;
    const ext = Math.max(LOT_W, LOT_D) / 2 + 0.2;
    b = { minX: Math.min(b.minX, p.pos.x - ext), maxX: Math.max(b.maxX, p.pos.x + ext), minZ: Math.min(b.minZ, p.pos.z - ext), maxZ: Math.max(b.maxZ, p.pos.z + ext) };
  }
  for (const si of streetsUnlocked(city, stage)) {
    const g = streetGeo(city, si);
    for (const q of [g.b, g.c]) {
      b = { minX: Math.min(b.minX, q.x - 0.9), maxX: Math.max(b.maxX, q.x + 0.9), minZ: Math.min(b.minZ, q.z - 0.9), maxZ: Math.max(b.maxZ, q.z + 0.9) };
    }
  }
  return b;
}

/** Kotak batas satu jalan beserta kavlingnya. */
export function streetBounds(city: CityDefinition, si: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const g = streetGeo(city, si);
  let b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const grow = (x: number, z: number, e: number) => {
    b = { minX: Math.min(b.minX, x - e), maxX: Math.max(b.maxX, x + e), minZ: Math.min(b.minZ, z - e), maxZ: Math.max(b.maxZ, z + e) };
  };
  for (const q of [g.a, g.b, g.c, g.d]) grow(q.x, q.z, 0.9);
  for (const p of resolvePlots(city)) if (p.street === si) grow(p.pos.x, p.pos.z, Math.max(LOT_W, LOT_D) / 2 + 0.2);
  return b;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
