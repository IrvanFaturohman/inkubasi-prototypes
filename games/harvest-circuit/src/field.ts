/**
 * Field layout: corridors, crop patches, the serpentine loop path and the silo position.
 * The layout is derived from config + expand level only, so it is never saved.
 *
 *   silo ─╮  C0  ──────────────────▶ ╮
 *         │                          │   (right U-turn)
 *         │  C1  ◀────────────────── ╯
 *         ╰───── return road (left) ◀╯
 *
 * Each corridor has crop rows on both sides of its lane: strip 1 (near), strip 2, strip 3 (deep).
 * A Tier N harvester's header reaches strips 1..N — the simulation uses exactly that.
 */
import { GEOMETRY, type FieldConfig } from './config';
import { Path } from './path';

export interface PatchMeta {
  idx: number;
  corridor: number;
  strip: number;
  side: number;
  col: number;
  x: number;
  z: number;
  /** Arc length where the harvester header passes this patch. */
  s: number;
  /** Lane travel direction (+1 east, -1 west) — used for the cut animation. */
  dir: number;
  locked: boolean;
}

export interface Column {
  s: number;
  patches: number[];
}

export interface Bed {
  corridor: number;
  strip: number;
  side: number;
  z: number;
  x0: number;
  x1: number;
  locked: boolean;
}

export interface FieldLayout {
  corridors: number;
  laneZ: number[];
  xA: number;
  xB: number;
  patches: PatchMeta[];
  columns: Column[];
  beds: Bed[];
  path: Path;
  /** Arc-length ranges of the straight harvesting lanes (headers fold outside them). */
  lanes: { s0: number; s1: number }[];
  siloS: number;
  silo: { x: number; z: number };
  hopper: { x: number; z: number };
  deepUnlocked: boolean;
  /** Framing bounds on the ground plane (road + crops + silo). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export function corridorsFor(cfg: FieldConfig, expand: number): number {
  const list = cfg.corridorsByExpand;
  return list[Math.min(expand, list.length - 1)];
}

export function patchCountFor(cfg: FieldConfig, expand: number): number {
  return corridorsFor(cfg, expand) * 3 * 2 * cfg.patchesPerRow;
}

export function buildLayout(cfg: FieldConfig, expand: number): FieldLayout {
  const G = GEOMETRY;
  const n = corridorsFor(cfg, expand);
  const xA = -G.laneHalf;
  const xB = G.laneHalf;
  const laneLen = xB - xA;
  const laneZ: number[] = [];
  for (let c = 0; c < n; c++) laneZ.push(c * G.corridorPitch);

  const path = new Path(xA, 0, 0);
  const laneStartS: number[] = [];
  for (let c = 0; c < n; c++) {
    laneStartS.push(path.length);
    path.line(laneLen);
    if (c < n - 1) {
      const sign = c % 2 === 0 ? 1 : -1;
      path.arc(G.turnRadius, (sign * Math.PI) / 2);
      path.line(G.corridorPitch - 2 * G.turnRadius);
      path.arc(G.turnRadius, (sign * Math.PI) / 2);
    }
  }
  // Return road up the left side back to the start of corridor 0.
  const R = G.returnRadius;
  path.arc(R, Math.PI / 2);
  path.line(laneZ[n - 1] - 2 * R);
  path.arc(R, Math.PI / 2);

  // Silo sits on the outside of the final corner arc.
  const siloS = path.length - (Math.PI / 2) * R * 0.5;
  const sp = path.pointAt(siloS);
  const ox = Math.cos(sp.heading - Math.PI / 2);
  const oz = Math.sin(sp.heading - Math.PI / 2);
  const hopper = { x: sp.x + ox * 0.72, z: sp.z + oz * 0.72 };
  // Silo stands north of the corner (behind it for the camera), inside the road's width
  // so the field can be framed tightly on a portrait screen.
  const silo = { x: xA - R + 0.55, z: -G.stripOffsets[2] - 0.6 };

  const deepUnlocked = expand >= cfg.deepRowsAtExpand;
  const P = cfg.patchesPerRow;
  const x0 = (-(P - 1) / 2) * cfg.patchSpacing;
  const patches: PatchMeta[] = [];
  const beds: Bed[] = [];
  const colMap = new Map<string, Column>();
  const bedHalf = (P * cfg.patchSpacing) / 2 + 0.05;

  for (let c = 0; c < n; c++) {
    const dir = c % 2 === 0 ? 1 : -1;
    for (let strip = 1; strip <= 3; strip++) {
      for (const side of [-1, 1]) {
        const z = laneZ[c] + side * G.stripOffsets[strip - 1];
        const locked = strip === 3 && !deepUnlocked;
        beds.push({ corridor: c, strip, side, z, x0: -bedHalf, x1: bedHalf, locked });
        for (let i = 0; i < P; i++) {
          const x = x0 + i * cfg.patchSpacing;
          const s = laneStartS[c] + (dir > 0 ? x - xA : xB - x);
          const meta: PatchMeta = { idx: patches.length, corridor: c, strip, side, col: i, x, z, s, dir, locked };
          patches.push(meta);
          const key = `${c}:${i}`;
          let col = colMap.get(key);
          if (!col) {
            col = { s, patches: [] };
            colMap.set(key, col);
          }
          col.patches.push(meta.idx);
        }
      }
    }
  }
  const columns = [...colMap.values()].sort((a, b) => a.s - b.s);
  // Cut order inside a column: near strip first.
  for (const col of columns) col.patches.sort((a, b) => patches[a].strip - patches[b].strip || patches[a].side - patches[b].side);

  // Road edge plus half a folded header (≈0.6) so machines on the outer roads stay in frame.
  const margin = 0.64;
  const bounds = {
    minX: Math.min(xA - R - margin, hopper.x - 0.45),
    maxX: xB + G.turnRadius + margin,
    minZ: Math.min(-G.stripOffsets[2] - 0.3, silo.z - 0.9),
    maxZ: laneZ[n - 1] + G.stripOffsets[2] + 0.3,
  };

  const lanes = laneStartS.map((s0) => ({ s0, s1: s0 + laneLen }));
  return { corridors: n, laneZ, xA, xB, patches, columns, beds, path, lanes, siloS, silo, hopper, deepUnlocked, bounds };
}
