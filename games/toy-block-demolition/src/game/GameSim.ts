import { BlockField } from './BlockField';
import { CargoLedger, type PendingPickup } from './CargoLedger';
import { AREAS, CARGO, CRUSHER, freePlayDef, type AreaDef, type UpgradeKey } from './config';
import { CrusherSystem, type BreakEvent, type CrushResult } from './CrusherSystem';
import { DepotSystem, buildDepotLayout, type DepotEvent } from './DepotSystem';
import { generateArea } from './LevelGen';
import { addCoins, defaultProgress, purchaseUpgrade, upgradeValue, type Progress, type PurchaseResult } from './state';
import { createRng } from './util';
import { VehicleSim, type CollisionWorld, type DriveInput } from './VehicleSim';
import { SAVE_VERSION, decodeBytes, encodeBytes, type SaveData } from '../persistence/SaveManager';

export type SimEvent =
  | { type: 'break'; e: BreakEvent }
  | { type: 'land'; p: PendingPickup }
  | { type: 'nearFull' }
  | { type: 'full' }
  | { type: 'areaComplete'; bonus: number }
  | { type: 'gateReached' }
  | { type: 'runComplete' }
  | DepotEvent;

export const FINAL_AREA_INDEX = AREAS.length - 1;

export function areaDefFor(index: number, seed: number): AreaDef {
  if (index < AREAS.length) return { ...AREAS[index], seed };
  return freePlayDef(index - AREAS.length + 1, seed);
}

/**
 * Deterministic game state + systems, independent of rendering, audio and DOM.
 * The Game class drives it with fixed steps and consumes its events.
 */
export class GameSim {
  progress: Progress;
  areaDef!: AreaDef;
  field!: BlockField;
  ledger: CargoLedger;
  vehicle = new VehicleSim();
  crusher!: CrusherSystem;
  depot!: DepotSystem;
  world!: CollisionWorld;
  stepIndex = 0;
  readonly events: SimEvent[] = [];
  /** Aggregated crusher info since the last `consumeFrame()`. */
  frameContacts = 0;
  frameFirstHits = 0;
  frameReinforcedHit = false;
  frameBlockedFull = false;
  powered = false;
  private nearFullArmed = true;
  private fullArmed = true;
  private rand = createRng(12345);
  private readonly landed: PendingPickup[] = [];
  gateTriggered = false;

  constructor(progress?: Progress) {
    this.progress = progress ?? defaultProgress();
    this.ledger = new CargoLedger(upgradeValue(this.progress, 'cargo'));
    this.loadArea(this.progress.areaIndex, this.progress.areaSeed);
  }

  get maxSpeed(): number {
    return upgradeValue(this.progress, 'speed');
  }
  get power(): number {
    return upgradeValue(this.progress, 'power');
  }
  get rollerWidth(): number {
    return upgradeValue(this.progress, 'roller');
  }
  get isFinalArea(): boolean {
    return this.progress.areaIndex === FINAL_AREA_INDEX;
  }
  get areaCleared(): boolean {
    return this.field.remainingLayers === 0;
  }

  /** Build (or rebuild) the current area. Optional saved remaining-layer data restores clearing progress. */
  loadArea(index: number, seed: number, remaining?: Uint8Array): boolean {
    this.progress.areaIndex = index;
    this.progress.areaSeed = seed;
    this.areaDef = areaDefFor(index, seed);
    this.field = generateArea(this.areaDef);
    let ok = true;
    if (remaining) ok = this.field.importRemaining(remaining);
    this.crusher = new CrusherSystem(this.field.n);
    const layout = buildDepotLayout(this.field);
    if (this.depot) this.depot.reset(layout);
    else this.depot = new DepotSystem(layout);
    this.world = { field: this.field, statics: layout.statics, bounds: layout.bounds };
    this.vehicle.setPose(layout.spawn.x, layout.spawn.z, layout.spawn.h);
    this.applyUpgrades();
    this.gateTriggered = false;
    this.nearFullArmed = this.ledger.ratio < CARGO.nearFullRatio;
    this.fullArmed = !this.ledger.isFull;
    this.updateGate();
    return ok;
  }

  applyUpgrades(): void {
    this.vehicle.setRollerWidth(this.rollerWidth);
    this.ledger.setCapacity(upgradeValue(this.progress, 'cargo'));
  }

  buy(key: UpgradeKey): PurchaseResult {
    const r = purchaseUpgrade(this.progress, key);
    if (r === 'ok') this.applyUpgrades();
    return r;
  }

  /** Gate opens once the area is cleared, its reward claimed and all cargo sold. */
  get gateOpen(): boolean {
    return this.progress.areaRewardClaimed && this.ledger.total === 0 && !this.depot.unloading && !this.isFinalArea;
  }

  private updateGate(): void {
    this.world.bounds.gateOpen = this.gateOpen;
  }

  update(dt: number, input: DriveInput): void {
    this.stepIndex++;
    const step = this.stepIndex;
    const v = this.vehicle;
    const ledger = this.ledger;
    this.powered = input.mag > CRUSHER.minThrottle && !ledger.isFull;

    let crush: CrushResult | null = null;
    v.step(dt, input, this.maxSpeed, this.world, (from, to) => {
      const c = this.crusher.apply(
        this.field,
        ledger,
        from,
        to,
        this.rollerWidth,
        this.power,
        dt,
        step,
        input.mag > CRUSHER.minThrottle,
        this.rand,
        (e) => {
          this.progress.stats.layersCleared++;
          this.events.push({ type: 'break', e });
        },
      );
      crush = c;
      return c.contacts;
    });
    if (crush) {
      const c = crush as CrushResult;
      this.frameContacts += c.contacts;
      this.frameFirstHits += c.firstHits;
      this.frameReinforcedHit ||= c.hitReinforced;
      this.frameBlockedFull ||= c.blockedByFull;
    }

    // Pickup flights (simulation-timed, cosmetic drawing).
    this.landed.length = 0;
    ledger.update(dt, this.landed);
    for (const p of this.landed) this.events.push({ type: 'land', p });

    // Fill notifications, once per fill cycle.
    if (ledger.ratio >= CARGO.nearFullRatio && this.nearFullArmed && !ledger.isFull) {
      this.nearFullArmed = false;
      this.events.push({ type: 'nearFull' });
    }
    if (ledger.isFull && this.fullArmed) {
      this.fullArmed = false;
      this.nearFullArmed = false;
      this.events.push({ type: 'full' });
    }
    if (!ledger.isFull) this.fullArmed = true;
    if (ledger.ratio < 0.5) this.nearFullArmed = true;

    // Depot unloading.
    const depotEvents: DepotEvent[] = [];
    this.depot.update(dt, v.x, v.z, v.actualSpeed, ledger, this.progress, depotEvents);
    for (const e of depotEvents) this.events.push(e);

    // Area completion reward: exactly once.
    if (this.field.remainingLayers === 0 && !this.progress.areaRewardClaimed) {
      this.progress.areaRewardClaimed = true;
      this.progress.stats.areasCleared++;
      addCoins(this.progress, this.areaDef.completionBonus);
      this.events.push({ type: 'areaComplete', bonus: this.areaDef.completionBonus });
    }

    if (this.isFinalArea && this.progress.areaRewardClaimed && !this.progress.runComplete && ledger.total === 0 && !this.depot.unloading) {
      this.progress.runComplete = true;
      this.events.push({ type: 'runComplete' });
    }

    this.updateGate();
    if (this.world.bounds.gateOpen && !this.gateTriggered && v.z > this.world.bounds.maxZ + 0.35) {
      this.gateTriggered = true;
      this.events.push({ type: 'gateReached' });
    }
  }

  consumeFrame(): void {
    this.frameContacts = 0;
    this.frameFirstHits = 0;
    this.frameReinforcedHit = false;
    this.frameBlockedFull = false;
  }

  /** Move on to the next area (authored or free play). Cargo must already be empty. */
  advanceArea(seedOverride?: number): void {
    this.ledger.resolveAll();
    const next = this.progress.areaIndex + 1;
    const seed = seedOverride ?? (next < AREAS.length ? AREAS[next].seed : freshSeed());
    this.progress.areaRewardClaimed = false;
    this.loadArea(next, seed);
  }

  /** Start free play after the final area, preserving upgrades and coins. */
  startFreePlay(): void {
    this.ledger.resolveAll();
    const next = Math.max(AREAS.length, this.progress.areaIndex + 1);
    this.progress.areaRewardClaimed = false;
    this.loadArea(next, freshSeed());
  }

  /** Full reset to a fresh run. Tutorial flags are kept unless `resetTutorial`. */
  newRun(resetTutorial: boolean): void {
    const tutorial = this.progress.tutorial;
    const fresh = defaultProgress();
    if (!resetTutorial) fresh.tutorial = { ...tutorial };
    this.progress = fresh;
    this.ledger.clear();
    this.ledger.capacity = upgradeValue(fresh, 'cargo');
    this.depot.reset();
    this.loadArea(0, fresh.areaSeed);
  }

  snapshot(): SaveData {
    return {
      v: SAVE_VERSION,
      savedAt: Date.now(),
      progress: structuredCloneProgress(this.progress),
      field: encodeBytes(this.field.exportRemaining()),
      fieldCells: this.field.n,
      cargo: this.ledger.snapshot(),
    };
  }

  /** Restore from validated save data. Returns false if the field data doesn't match. */
  restore(data: SaveData): boolean {
    this.progress = structuredCloneProgress(data.progress);
    this.ledger.clear();
    this.ledger.capacity = upgradeValue(this.progress, 'cargo');
    this.ledger.restore(data.cargo);
    const bytes = decodeBytes(data.field);
    if (!bytes) return false;
    return this.loadArea(this.progress.areaIndex, this.progress.areaSeed, bytes);
  }
}

function structuredCloneProgress(p: Progress): Progress {
  return JSON.parse(JSON.stringify(p)) as Progress;
}

function freshSeed(): number {
  return (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0;
}
