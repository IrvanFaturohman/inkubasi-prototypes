import { GRID, MATERIALS, MAT_NONE, type MaterialId } from './config';

/**
 * Authoritative occupancy grid for one clearing area.
 *
 * Each cell holds zero, one or two destructible layers. Layers are destroyed
 * top-down; `remaining[cell]` is the number of intact layers, so the top
 * layer index is `remaining - 1`. Per-layer data is stored at `cell * 2 + layer`.
 *
 * Row 0 is the northern (far) edge; the southern edge sits at world z = 0,
 * next to the depot. Pure logic, no rendering dependencies.
 */
export class BlockField {
  readonly cols: number;
  readonly rows: number;
  readonly n: number;
  readonly pitch: number;
  readonly originX: number;
  readonly originZ: number;

  readonly orig: Uint8Array;
  readonly remaining: Uint8Array;
  readonly mat: Uint8Array;
  readonly color: Uint8Array;
  readonly hp: Float32Array;
  /** Simulation step of the most recent break per cell (prevents same-step stack deletion). */
  readonly lastBreak: Int32Array;
  /** Visual pairing: partner layer key or -1. Purely cosmetic, deterministic from the seed. */
  readonly pairWith: Int32Array;

  totalLayers = 0;
  destroyedLayers = 0;

  constructor(cols: number, rows: number, pitch = GRID.pitch) {
    this.cols = cols;
    this.rows = rows;
    this.n = cols * rows;
    this.pitch = pitch;
    this.originX = (-cols * pitch) / 2;
    this.originZ = -rows * pitch;
    this.orig = new Uint8Array(this.n);
    this.remaining = new Uint8Array(this.n);
    this.mat = new Uint8Array(this.n * 2);
    this.color = new Uint8Array(this.n * 2);
    this.hp = new Float32Array(this.n * 2);
    this.lastBreak = new Int32Array(this.n).fill(-1);
    this.pairWith = new Int32Array(this.n * 2).fill(-1);
  }

  get width(): number {
    return this.cols * this.pitch;
  }
  get depth(): number {
    return this.rows * this.pitch;
  }
  get remainingLayers(): number {
    return this.totalLayers - this.destroyedLayers;
  }
  get progress(): number {
    return this.totalLayers > 0 ? this.destroyedLayers / this.totalLayers : 1;
  }

  index(c: number, r: number): number {
    return r * this.cols + c;
  }
  col(i: number): number {
    return i % this.cols;
  }
  row(i: number): number {
    return (i / this.cols) | 0;
  }
  centerX(i: number): number {
    return this.originX + (this.col(i) + 0.5) * this.pitch;
  }
  centerZ(i: number): number {
    return this.originZ + (this.row(i) + 0.5) * this.pitch;
  }
  colAt(x: number): number {
    return Math.floor((x - this.originX) / this.pitch);
  }
  rowAt(z: number): number {
    return Math.floor((z - this.originZ) / this.pitch);
  }

  /** Define a cell during generation. */
  setCell(i: number, layers: number, mat0: number, col0: number, mat1 = MAT_NONE, col1 = 0): void {
    this.orig[i] = layers;
    this.remaining[i] = layers;
    this.mat[i * 2] = layers > 0 ? mat0 : MAT_NONE;
    this.color[i * 2] = col0;
    this.mat[i * 2 + 1] = layers > 1 ? mat1 : MAT_NONE;
    this.color[i * 2 + 1] = col1;
  }

  /** Recompute totals and restore full HP on every intact layer. */
  finalize(): void {
    let total = 0;
    let destroyed = 0;
    for (let i = 0; i < this.n; i++) {
      total += this.orig[i];
      destroyed += this.orig[i] - this.remaining[i];
      for (let l = 0; l < 2; l++) {
        const k = i * 2 + l;
        const m = this.mat[k] as MaterialId;
        this.hp[k] = m ? MATERIALS[m].hp : 0;
      }
    }
    this.totalLayers = total;
    this.destroyedLayers = destroyed;
    this.lastBreak.fill(-1);
  }

  isSolid(i: number): boolean {
    return this.remaining[i] > 0;
  }

  solidAt(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this.remaining[r * this.cols + c] > 0;
  }

  topKey(i: number): number {
    return this.remaining[i] > 0 ? i * 2 + this.remaining[i] - 1 : -1;
  }

  maxHp(key: number): number {
    const m = this.mat[key] as MaterialId;
    return m ? MATERIALS[m].hp : 0;
  }

  /** A cell may lose at most one layer per simulation step. */
  canBreakThisStep(i: number, step: number): boolean {
    return this.remaining[i] > 0 && this.lastBreak[i] !== step;
  }

  /**
   * Remove the top layer exactly once. Returns the layer key, or -1 if the
   * call was invalid (already empty, or already broke this step).
   */
  breakTop(i: number, step: number): number {
    if (!this.canBreakThisStep(i, step)) return -1;
    const key = i * 2 + this.remaining[i] - 1;
    this.remaining[i]--;
    this.hp[key] = 0;
    this.lastBreak[i] = step;
    this.destroyedLayers++;
    return key;
  }

  exportRemaining(): Uint8Array {
    return this.remaining.slice();
  }

  /** Restore saved clearing state. Returns false if the data doesn't fit this layout. */
  importRemaining(data: ArrayLike<number>): boolean {
    if (data.length !== this.n) return false;
    for (let i = 0; i < this.n; i++) {
      const v = data[i];
      if (!Number.isInteger(v) || v < 0 || v > this.orig[i]) return false;
    }
    for (let i = 0; i < this.n; i++) this.remaining[i] = data[i];
    this.finalize();
    return true;
  }

  /** Cells that still have at least one layer (used for end-of-area markers). */
  listRemainingCells(limit: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.n && out.length < limit; i++) if (this.remaining[i] > 0) out.push(i);
    return out;
  }
}
