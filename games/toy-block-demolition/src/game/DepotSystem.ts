import type { BlockField } from './BlockField';
import type { CargoLedger } from './CargoLedger';
import { DEPOT, MATERIALS, type MaterialId } from './config';
import { addCoins, type Progress } from './state';
import { clamp } from './util';
import type { StaticBox, WorldBounds } from './VehicleSim';

/** World layout of the depot yard beside the southern edge of a field. */
export interface DepotLayout {
  spawn: { x: number; z: number; h: number };
  pad: { x: number; z: number; hw: number; hd: number };
  machine: { x: number; z: number; hw: number; hd: number };
  shed: { x: number; z: number; hw: number; hd: number };
  gate: { x: number; z: number; hw: number };
  hopper: { x: number; y: number; z: number };
  statics: StaticBox[];
  bounds: WorldBounds;
}

export function buildDepotLayout(field: BlockField): DepotLayout {
  const margin = 2.1;
  const southZ = DEPOT.yardDepth;
  const gateX = DEPOT.gate.x;
  const bounds: WorldBounds = {
    minX: -field.width / 2 - margin,
    maxX: field.width / 2 + margin,
    minZ: field.originZ - margin,
    maxZ: southZ,
    gateOpen: false,
    gateMinX: gateX - DEPOT.gate.hw,
    gateMaxX: gateX + DEPOT.gate.hw,
  };
  const m = DEPOT.machine;
  const s = DEPOT.shed;
  const postHalf = 0.16;
  return {
    spawn: { x: DEPOT.spawn.x, z: DEPOT.spawn.z, h: DEPOT.spawn.heading },
    pad: { ...DEPOT.pad },
    machine: { ...m },
    shed: { ...s },
    gate: { x: gateX, z: southZ, hw: DEPOT.gate.hw },
    hopper: { x: m.x - 0.1, y: 1.55, z: m.z },
    statics: [
      { x: m.x, z: m.z, hw: m.hw, hd: m.hd },
      { x: s.x, z: s.z, hw: s.hw, hd: s.hd },
      // Gate posts sit just outside the opening.
      { x: gateX - DEPOT.gate.hw - postHalf, z: southZ, hw: postHalf, hd: postHalf },
      { x: gateX + DEPOT.gate.hw + postHalf, z: southZ, hw: postHalf, hd: postHalf },
    ],
    bounds,
  };
}

export type DepotEvent =
  | { type: 'unloadStart'; units: number }
  | { type: 'sold'; mat: MaterialId; coins: number; index: number; total: number }
  | { type: 'unloadStop'; sold: number }
  | { type: 'unloadDone'; sold: number; coins: number };

/**
 * Unloading at the SELL pad. Coins are credited per ledger unit as it is
 * removed; leaving the pad stops at a unit boundary so cargo can never be
 * sold twice or lost.
 */
export class DepotSystem {
  layout: DepotLayout;
  unloading = false;
  dwell = 0;
  private budget = 0;
  private rate = 0;
  private soldThisVisit = 0;
  private coinsThisVisit = 0;
  private unitsAtStart = 0;

  constructor(layout: DepotLayout) {
    this.layout = layout;
  }

  onPad(x: number, z: number): boolean {
    const p = this.layout.pad;
    return Math.abs(x - p.x) <= p.hw && Math.abs(z - p.z) <= p.hd;
  }

  nearDepot(x: number, z: number): boolean {
    const p = this.layout.pad;
    return Math.hypot(x - p.x, z - p.z) <= DEPOT.upgradeRadius;
  }

  update(dt: number, x: number, z: number, speed: number, ledger: CargoLedger, progress: Progress, out: DepotEvent[]): void {
    const on = this.onPad(x, z);
    if (!on) {
      if (this.unloading) this.stop(out);
      this.dwell = 0;
      return;
    }
    if (!this.unloading) {
      if (ledger.total > 0 && speed < DEPOT.dwellMaxSpeed) {
        this.dwell += dt;
        if (this.dwell >= DEPOT.dwell) this.start(ledger, out);
      } else {
        this.dwell = 0;
      }
      return;
    }
    this.budget += this.rate * dt;
    while (this.budget >= 1 && ledger.storedTotal > 0) {
      const mat = ledger.removeOne();
      if (!mat) break;
      const coins = MATERIALS[mat].coins;
      addCoins(progress, coins);
      progress.stats.unitsSold++;
      this.budget -= 1;
      this.soldThisVisit++;
      this.coinsThisVisit += coins;
      out.push({ type: 'sold', mat, coins, index: this.soldThisVisit, total: this.unitsAtStart });
    }
    if (ledger.storedTotal === 0 && ledger.reservedTotal === 0) {
      this.unloading = false;
      this.dwell = 0;
      out.push({ type: 'unloadDone', sold: this.soldThisVisit, coins: this.coinsThisVisit });
    }
  }

  private start(ledger: CargoLedger, out: DepotEvent[]): void {
    // Any awarded incoming pickups resolve logically before selling.
    ledger.resolveAll();
    const units = ledger.storedTotal;
    if (units <= 0) return;
    const duration = clamp(DEPOT.unloadBase + units * DEPOT.unloadPerUnit, DEPOT.unloadMin, DEPOT.unloadMax);
    this.rate = units / duration;
    this.budget = 0;
    this.unloading = true;
    this.soldThisVisit = 0;
    this.coinsThisVisit = 0;
    this.unitsAtStart = units;
    out.push({ type: 'unloadStart', units });
  }

  private stop(out: DepotEvent[]): void {
    this.unloading = false;
    this.budget = 0;
    out.push({ type: 'unloadStop', sold: this.soldThisVisit });
  }

  /** Cancel without an event (area change, reset). */
  reset(layout?: DepotLayout): void {
    if (layout) this.layout = layout;
    this.unloading = false;
    this.dwell = 0;
    this.budget = 0;
  }
}
