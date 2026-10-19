import type { BlockField } from './BlockField';
import type { CargoLedger } from './CargoLedger';
import { CRUSHER, GRID, VEHICLE, type MaterialId } from './config';
import type { Pose } from './VehicleSim';

export interface BreakEvent {
  cell: number;
  key: number;
  mat: MaterialId;
  color: number;
  x: number;
  y: number;
  z: number;
}

export interface CrushResult {
  /** Layers receiving damage this step. */
  contacts: number;
  /** Layers that were touched for the first time this step (for compression cues). */
  firstHits: number;
  hitReinforced: boolean;
  /** Damage was withheld because the bin is full. */
  blockedByFull: boolean;
}

/** Local-space extents of the crusher's working region (cell centres). */
export function crusherRegion(rollerWidth: number) {
  const colliderHalf = rollerWidth / 2 - VEHICLE.rollerEndInset;
  const halfW = colliderHalf + GRID.collisionHalf + CRUSHER.sideMargin;
  const zMin = VEHICLE.rollerZ - CRUSHER.regionBack;
  const zMax = VEHICLE.rollerZ + VEHICLE.rollerColliderRadius + GRID.collisionHalf + CRUSHER.regionLead;
  return { halfW, zMin, zMax };
}

/**
 * Applies powered-drum damage to layers inside the oriented working region in
 * front of the chassis, sweeping between the previous and proposed pose.
 * Breaking reserves a cargo slot first; if none is free the layer waits.
 */
export class CrusherSystem {
  /** Cells damaged during the most recent step (for compression/jiggle visuals). */
  readonly touched: number[] = [];
  private readonly touchedMark: Uint8Array;
  private stepSeen = 0;

  constructor(n: number) {
    this.touchedMark = new Uint8Array(n);
  }

  apply(
    field: BlockField,
    ledger: CargoLedger,
    from: Pose,
    to: Pose,
    rollerWidth: number,
    power: number,
    dt: number,
    step: number,
    powered: boolean,
    rand: () => number,
    onBreak: (e: BreakEvent) => void,
  ): CrushResult {
    for (const i of this.touched) this.touchedMark[i] = 0;
    this.touched.length = 0;
    this.stepSeen = step;
    const result: CrushResult = { contacts: 0, firstHits: 0, hitReinforced: false, blockedByFull: false };
    if (!powered) return result;

    const reg = crusherRegion(rollerWidth);
    // Sweep: sample intermediate poses if the step moved further than a fraction of a cell.
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const samples = Math.max(1, Math.ceil(dist / (GRID.pitch * 0.35)));
    const dmg = CRUSHER.baseDamage * power * dt;
    const space = () => ledger.hasSpace();

    for (let s = 1; s <= samples; s++) {
      const t = s / samples;
      const px = from.x + (to.x - from.x) * t;
      const pz = from.z + (to.z - from.z) * t;
      const h = from.h + wrapDelta(to.h - from.h) * t;
      const sin = Math.sin(h);
      const cos = Math.cos(h);
      // Region centre and bounding box in world space.
      const midZ = (reg.zMin + reg.zMax) / 2;
      const cx = px + midZ * sin;
      const cz = pz + midZ * cos;
      const ext = Math.hypot(reg.halfW, (reg.zMax - reg.zMin) / 2);
      const c0 = Math.max(0, field.colAt(cx - ext));
      const c1 = Math.min(field.cols - 1, field.colAt(cx + ext));
      const r0 = Math.max(0, field.rowAt(cz - ext));
      const r1 = Math.min(field.rows - 1, field.rowAt(cz + ext));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * field.cols + c;
          if (field.remaining[i] === 0 || this.touchedMark[i]) continue;
          const dx = field.originX + (c + 0.5) * field.pitch - px;
          const dz = field.originZ + (r + 0.5) * field.pitch - pz;
          // World → local (inverse rotation).
          const lx = dx * cos - dz * sin;
          const lz = dx * sin + dz * cos;
          if (lz < reg.zMin || lz > reg.zMax || Math.abs(lx) > reg.halfW) continue;
          this.touchedMark[i] = 1;
          this.touched.push(i);
          if (!field.canBreakThisStep(i, step)) continue; // next layer becomes available next step
          if (!space()) {
            result.blockedByFull = true;
            continue;
          }
          const key = field.topKey(i);
          const max = field.maxHp(key);
          if (field.hp[key] >= max) result.firstHits++;
          const mat = field.mat[key] as MaterialId;
          if (mat === 2) result.hitReinforced = true;
          result.contacts++;
          field.hp[key] -= dmg;
          if (field.hp[key] <= 0) {
            const layer = key & 1;
            const x = field.originX + (c + 0.5) * field.pitch;
            const z = field.originZ + (r + 0.5) * field.pitch;
            const y = layer * GRID.layerHeight + GRID.layerHeight * 0.5;
            // Outward burst: mostly sideways/up relative to the drum.
            const side = lx >= 0 ? 1 : -1;
            const bx = cos * side * 0.6 + sin * 0.35;
            const bz = -sin * side * 0.6 + cos * 0.35;
            if (ledger.reserve(mat, field.color[key], x, y, z, bx, bz, rand())) {
              field.breakTop(i, step);
              onBreak({ cell: i, key, mat, color: field.color[key], x, y, z });
            } else {
              // No slot left this step: hold the layer at the brink.
              field.hp[key] = 0.0001;
              result.blockedByFull = true;
            }
          }
        }
      }
    }
    return result;
  }

  get lastStep(): number {
    return this.stepSeen;
  }
}

function wrapDelta(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
