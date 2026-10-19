import { CARGO, MATERIALS, type MaterialId } from './config';

/** One reserved cargo unit travelling toward the bin. Timing is simulation state; drawing is cosmetic. */
export interface PendingPickup {
  mat: MaterialId;
  color: number;
  age: number;
  duration: number;
  sx: number;
  sy: number;
  sz: number;
  /** Outward burst direction for the first part of the flight. */
  bx: number;
  bz: number;
}

/**
 * Authoritative cargo ledger.
 *
 * Invariant: storedTotal + reservedTotal <= capacity.
 * A slot is reserved atomically when a layer breaks, before its pickup flight
 * starts. Every destroyed layer yields exactly one unit.
 */
export class CargoLedger {
  capacity: number;
  /** Stored counts per material id (index 0 unused). */
  readonly stored = [0, 0, 0, 0];
  readonly reserved = [0, 0, 0, 0];
  readonly pending: PendingPickup[] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get storedTotal(): number {
    return this.stored[1] + this.stored[2] + this.stored[3];
  }
  get reservedTotal(): number {
    return this.reserved[1] + this.reserved[2] + this.reserved[3];
  }
  get total(): number {
    return this.storedTotal + this.reservedTotal;
  }
  get ratio(): number {
    return this.capacity > 0 ? this.total / this.capacity : 1;
  }
  get isFull(): boolean {
    return this.total >= this.capacity;
  }
  hasSpace(): boolean {
    return this.total < this.capacity;
  }

  /** Coins the stored + reserved cargo is worth. */
  get value(): number {
    let v = 0;
    for (let m = 1 as MaterialId; m <= 3; m++) v += (this.stored[m] + this.reserved[m]) * MATERIALS[m].coins;
    return v;
  }

  /**
   * Reserve one slot for a freshly broken layer. Returns false (and changes
   * nothing) when the bin has no free slot.
   */
  reserve(mat: MaterialId, color: number, x: number, y: number, z: number, bx: number, bz: number, rand: number): boolean {
    if (!this.hasSpace()) return false;
    this.reserved[mat]++;
    this.pending.push({
      mat,
      color,
      age: 0,
      duration: CARGO.flightMin + (CARGO.flightMax - CARGO.flightMin) * rand,
      sx: x,
      sy: y,
      sz: z,
      bx,
      bz,
    });
    return true;
  }

  /** Advance pickup flights; landed units move from reserved to stored. Returns landed pickups. */
  update(dt: number, landed?: PendingPickup[]): number {
    let count = 0;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.age += dt;
      if (p.age >= p.duration) {
        this.land(p.mat);
        landed?.push(p);
        const last = this.pending.pop()!;
        if (i < this.pending.length) this.pending[i] = last;
        count++;
      }
    }
    return count;
  }

  private land(mat: MaterialId): void {
    if (this.reserved[mat] <= 0) return;
    this.reserved[mat]--;
    this.stored[mat]++;
  }

  /** Resolve every in-flight unit logically (unload start, save, area transition). */
  resolveAll(): number {
    const n = this.pending.length;
    for (const p of this.pending) this.land(p.mat);
    this.pending.length = 0;
    // Defensive: any reserved count without a pending entry is also stored.
    for (let m = 1; m <= 3; m++) {
      this.stored[m] += this.reserved[m];
      this.reserved[m] = 0;
    }
    return n;
  }

  /**
   * Remove exactly one stored unit for sale. Cheapest units go first so the
   * coin ticks climb during an unload. Returns the material removed or 0.
   */
  removeOne(): MaterialId | 0 {
    for (let m = 1 as MaterialId; m <= 3; m++) {
      if (this.stored[m] > 0) {
        this.stored[m]--;
        return m;
      }
    }
    return 0;
  }

  setCapacity(capacity: number): void {
    // Capacity only grows through upgrades; held cargo is never discarded.
    this.capacity = Math.max(capacity, this.capacity);
  }

  /** Serializable counts: pending flights are saved as stored cargo. */
  snapshot(): [number, number, number] {
    return [
      this.stored[1] + this.reserved[1],
      this.stored[2] + this.reserved[2],
      this.stored[3] + this.reserved[3],
    ];
  }

  restore(counts: [number, number, number]): void {
    this.pending.length = 0;
    for (let m = 1; m <= 3; m++) {
      this.stored[m] = counts[m - 1];
      this.reserved[m] = 0;
    }
  }

  clear(): void {
    this.pending.length = 0;
    for (let m = 0; m <= 3; m++) {
      this.stored[m] = 0;
      this.reserved[m] = 0;
    }
  }
}
