import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { CITIES } from '../config/cities';
import { stageMapping } from '../game/actions';
import { completedModuleCount } from '../game/building';
import { isPlotComplete, isPlotUnlocked, pickupDistance, plotProject, plotsOf, productionRate, storageCapacity, trackFor } from '../game/economy';
import type { GameEvent } from '../game/events';
import { pickupPoints, stageBounds, stageCount, streetBounds, type ResolvedPlot } from '../game/layout';
import { depotInTransit } from '../game/sim';
import type { CityDefinition, GameState, MaterialKind, Runtime } from '../game/types';
import { fmt } from '../ui/format';
import { CameraRig, type SafeArea } from './cameraRig';
import { DepotView } from './depotView';
import { Effects } from './effects';
import { buildEnvironment, type EnvironmentBuild, type Rect } from './environment';
import { LabelLayer, type WorldLabel } from './labels';
import { THEMES } from './palette';
import { PlotView } from './plotView';
import { dropTexture, TrackView } from './trackView';
import { VehicleView } from './vehicleView';

export type PickResult = { type: 'vehicle'; id: number } | { type: 'depot' } | null;

export interface WorldHooks {
  onModulePop(index: number): void;
  onItemLand(kind: MaterialKind, big: boolean): void;
}

interface Absorb {
  view: VehicleView;
  label: WorldLabel;
  keepId: number;
  level: number;
  t: number;
  from: THREE.Vector3;
}

interface Float {
  label: WorldLabel;
  t: number;
  plot: number;
  amount: number;
  kind: string;
}

const EXPAND_MORPH = 1.15;
/** Bila membingkai seluruh kota butuh kamera lebih jauh dari ini, kamera fokus ke jalan aktif. */
const FOCUS_DIST = 46;
const MAX_FLOATS = 18;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _t = new THREE.Vector3();

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly labels: LabelLayer;
  readonly effects = new Effects();
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private levelRoot = new THREE.Group();
  private city!: CityDefinition;
  private plotsDef: ResolvedPlot[] = [];
  private material: MaterialKind = 'wood';
  private track!: TrackView;
  private depot!: DepotView;
  private depotLabel!: WorldLabel;
  private plots: PlotView[] = [];
  private plotLabels: WorldLabel[] = [];
  private vehicles = new Map<number, VehicleView>();
  private vehicleLabels = new Map<number, WorldLabel>();
  private env: EnvironmentBuild | null = null;
  private absorbs: Absorb[] = [];
  private spawnIds = new Set<number>();
  private floats: Float[] = [];
  private revealStreet = -1;
  private revealTimer = 0;
  private boostPuffTimer = 0;
  private width = 1;
  private height = 1;
  private safe: SafeArea = { xL: -0.92, xR: 0.92, yB: -0.6, yT: 0.7 };
  private raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** true setelah pemain menggeser/zoom — kamera tidak lagi otomatis membingkai ulang. */
  manualCamera = false;
  private lastActive = -2;
  selectedVehicle: number | null = null;
  depotSelected = false;

  constructor(
    canvas: HTMLCanvasElement,
    labelRoot: HTMLElement,
    private readonly hooks: WorldHooks,
  ) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.rig = new CameraRig(1);
    this.labels = new LabelLayer(labelRoot);

    this.hemi = new THREE.HemisphereLight('#dff2ff', '#8a9a6a', 1.35);
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.levelRoot, this.effects.group);
  }

  // ---------------------------------------------------------------------------
  // Kota
  // ---------------------------------------------------------------------------

  loadLevel(state: GameState): void {
    this.disposeLevel();
    this.city = CITIES[state.levelIndex];
    this.plotsDef = plotsOf(state.levelIndex);
    this.material = this.city.material;
    const palette = THEMES[this.city.theme];
    this.scene.background = new THREE.Color(palette.sky);
    this.scene.fog = new THREE.Fog(palette.fog, 55, 130);
    this.hemi.groundColor.set(this.city.theme === 'city' ? '#b8b0a2' : '#7f9a5a');

    // Jalan (tanpa gerbang: sekarang ada banyak titik pengiriman)
    const exclusions = [...this.plotsDef.map((p) => p.pos), ...pickupPoints(this.city), { x: 0, z: 0 }];
    this.track = new TrackView(palette, trackFor(state.levelIndex, state.expandStage), exclusions, { gate: false });
    this.levelRoot.add(this.track.group);

    // Depot + teluk muat di keempat sisi
    const lastStage = stageCount(this.city) - 1;
    const tFull = trackFor(state.levelIndex, lastStage);
    const bays = [0, 1, 2, 3].map((i) => {
      const d = pickupDistance(state.levelIndex, lastStage, i);
      const q = tFull.pointAt(d);
      const tan = tFull.tangentAt(d);
      return { pos: q, heading: Math.atan2(-tan.z, tan.x) + Math.PI / 2 };
    });
    this.depot = new DepotView(this.material, this.city.hubHalf - 0.85, this.city.theme === 'city' ? '#e2ddd3' : '#e0d3b8', bays, dropTexture());
    this.levelRoot.add(this.depot.group);
    this.depotLabel = this.labels.create('station-label depot-label');

    // Kavling
    this.plotsDef.forEach((p, i) => {
      const proj = plotProject(state, i);
      const pv = new PlotView(p, proj, completedModuleCount(proj, state.plots[i]), palette.site, this.city.theme === 'city' ? '#9bd57a' : '#8fd16a');
      pv.building.onModulePop = (pos, index) => {
        this.effects.puff(pos, { count: 3, size: 0.16, spread: 1.1, color: '#f7efdf' });
        this.hooks.onModulePop(index);
      };
      pv.setVisible(isPlotUnlocked(state, i), false);
      this.plots.push(pv);
      this.levelRoot.add(pv.group);
      this.plotLabels.push(this.labels.create('plot-label'));
    });

    // Lingkungan (pohon dll. di luar area kota penuh, termasuk jalan yang belum dibuka)
    const full = stageBounds(this.city, lastStage);
    const keepOut: Rect[] = [{ minX: full.minX - 0.6, maxX: full.maxX + 0.6, minZ: full.minZ - 0.6, maxZ: full.maxZ + 0.6 }];
    const H = this.city.hubHalf;
    this.env = buildEnvironment(this.city.theme, palette, keepOut, { minX: -H + 0.8, maxX: H - 0.8, minZ: -H + 0.8, maxZ: H - 0.8 }, null);
    this.levelRoot.add(this.env.group);

    const cx = (full.minX + full.maxX) / 2;
    const cz = (full.minZ + full.maxZ) / 2;
    const ext = Math.max(full.maxX - full.minX, full.maxZ - full.minZ) / 2 + 3;
    this.sun.position.set(cx - 10, 24, cz + 13);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 80;
    sc.updateProjectionMatrix();

    for (const v of state.vehicles) this.ensureVehicle(v.id, v.level).setCargoNow(v.cargo);
    this.manualCamera = false;
    this.frameCamera(state, true);
  }

  private disposeLevel(): void {
    for (const v of this.vehicles.values()) v.dispose();
    this.vehicles.clear();
    this.absorbs = [];
    this.spawnIds.clear();
    this.labels.clear();
    this.vehicleLabels.clear();
    this.plotLabels = [];
    this.floats = [];
    this.track?.dispose();
    for (const p of this.plots) p.dispose();
    this.plots = [];
    this.env?.dispose();
    this.env = null;
    this.effects.clear();
    this.scene.remove(this.levelRoot);
    this.levelRoot = new THREE.Group();
    this.scene.add(this.levelRoot);
    this.selectedVehicle = null;
    this.revealStreet = -1;
    this.lastActive = -2;
  }

  // ---------------------------------------------------------------------------
  // Kamera
  // ---------------------------------------------------------------------------

  resize(width: number, height: number, safeTopPx: number, safeBottomPx: number, safeRightPx: number, state: GameState | null): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.rig.setAspect(this.width / this.height);
    const top = 1 - (2 * safeTopPx) / this.height;
    const bottom = -1 + (2 * safeBottomPx) / this.height;
    const right = 0.94 - (2 * safeRightPx) / this.width;
    this.safe = { xL: -0.92, xR: Math.max(-0.4, right - 0.02), yB: Math.min(bottom, top - 0.3), yT: top };
    if (state && !this.manualCamera) this.frameCamera(state, true);
  }

  /** Jalan yang sedang dibangun (kavling terbuka pertama yang belum jadi), atau -1. */
  private activeStreet(state: GameState): number {
    for (const p of this.plotsDef) if (isPlotUnlocked(state, p.index) && !isPlotComplete(state, p.index)) return p.street;
    return -1;
  }

  /**
   * Bingkai kamera: seluruh kota yang sudah terbuka bila masih cukup besar di layar;
   * kalau kota sudah terlalu lebar untuk layar portrait, fokus ke depot + jalan yang sedang
   * dibangun (tombol peta = lihat seluruh kota). Saat kota selesai: sorotan seluruh kota.
   */
  frameCamera(state: GameState, immediate: boolean, forceAll = false, focus?: number): void {
    const fitRect = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, done: boolean) => {
      const pts: THREE.Vector3[] = [];
      for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) for (const y of [0, 2.2]) pts.push(new THREE.Vector3(x, y, z));
      this.rig.fit(pts, this.safe, { yaw: done ? 0.4 : 0.22, pitch: done ? 0.78 : 0.95, immediate, ease: done ? 1.4 : 2.2, orbit: done ? 0.25 : 0 });
    };
    const done = state.completed;
    fitRect(stageBounds(this.city, state.expandStage), done);
    const active = focus ?? this.activeStreet(state);
    if (!done && !forceAll && active >= 0 && this.rig.goalDist > FOCUS_DIST) {
      const H = this.city.hubHalf + 0.9;
      const s = streetBounds(this.city, active);
      fitRect({ minX: Math.min(-H, s.minX), maxX: Math.max(H, s.maxX), minZ: Math.min(-H, s.minZ), maxZ: Math.max(H, s.maxZ) }, false);
    }
    const full = stageBounds(this.city, stageCount(this.city) - 1);
    this.rig.setBounds({ minX: full.minX, maxX: full.maxX, minZ: full.minZ, maxZ: full.maxZ }, 90);
  }

  /** Geser kamera sesuai seretan jari (piksel layar). */
  pan(dxPx: number, dyPx: number, rect: DOMRect): void {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const a = this.groundAt(cx, cy, rect);
    const b = this.groundAt(cx + dxPx, cy + dyPx, rect);
    if (!a || !b) return;
    this.manualCamera = true;
    this.rig.shift(a.x - b.x, a.z - b.z);
  }

  zoom(f: number): void {
    this.manualCamera = true;
    this.rig.zoom(f);
  }

  /** Tombol peta: lihat seluruh kota (setelah itu kamera bebas sampai ada jalan baru). */
  overview(state: GameState): void {
    this.frameCamera(state, false, true);
    this.manualCamera = true;
  }

  private groundAt(clientX: number, clientY: number, rect: DOMRect): THREE.Vector3 | null {
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.rig.camera);
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  // ---------------------------------------------------------------------------
  // Event → efek visual
  // ---------------------------------------------------------------------------

  handleEvents(events: GameEvent[], state: GameState): void {
    for (const e of events) {
      switch (e.type) {
        case 'produced': {
          const sv = this.depot.lines[e.line];
          sv?.onProduced();
          if (sv && Math.random() < 0.35) this.effects.puff(sv.chimneyWorld(_v), { count: 1, size: 0.16, spread: 0.2, up: 1.4, life: 0.9, color: '#f4f4f4' });
          break;
        }
        case 'stored':
          this.depot.onStored();
          break;
        case 'pickup': {
          const view = this.vehicles.get(e.vehicleId);
          if (!view) break;
          const from = this.depot.storageTop(new THREE.Vector3());
          const n = Math.min(e.amount, 6);
          for (let i = 0; i < n; i++) {
            this.effects.fly(this.material, from.clone().add(_v.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), view.bedWorld(new THREE.Vector3()), {
              delay: i * 0.035,
              dur: 0.34,
              height: 1.3,
              getTo: () => view.bedWorld(_t),
              scale: 0.85,
            });
          }
          view.queueCargo(e.cargo, 0.34 + n * 0.035);
          this.depot.pulseBay(e.bay);
          break;
        }
        case 'deliver': {
          const view = this.vehicles.get(e.vehicleId);
          const v = state.vehicles.find((x) => x.id === e.vehicleId);
          const pv = this.plots[e.plot];
          const from = view ? view.bedWorld(new THREE.Vector3()) : pv.topWorld(new THREE.Vector3());
          view?.setCargoNow(v?.cargo ?? 0);
          if (view && (v?.cargo ?? 0) === 0) view.dump();
          const targets = pv.building.scheduleModules(e.fromModule, e.toModule, 0.28);
          const n = Math.min(e.amount, 8);
          const big = e.amount >= 20;
          for (let i = 0; i < n; i++) {
            const to = targets[i % targets.length].clone();
            this.effects.fly(this.material, from.clone().add(_v.set(0, i * 0.03, 0)), to, {
              delay: i * 0.03,
              dur: 0.32 + Math.random() * 0.06,
              height: 1.4 + Math.random() * 0.5,
              scale: big ? 1.1 : 0.95,
              onLand:
                i === 0
                  ? () => {
                      this.effects.puff(to, { count: big ? 6 : 3, size: big ? 0.26 : 0.2, spread: 1.3 });
                      this.hooks.onItemLand(this.material, big);
                    }
                  : undefined,
            });
          }
          if (big) this.rig.bump(0.12 + Math.min(0.4, Math.log10(1 + e.amount) * 0.15));
          this.float(e.plot, e.money, 'float-money', pv.topWorld(new THREE.Vector3()));
          break;
        }
        case 'plotComplete': {
          const pv = this.plots[e.plot];
          pv.markComplete();
          pv.building.stageBounce(1.4);
          const top = pv.topWorld(new THREE.Vector3());
          this.effects.sparkle(top, 14);
          this.effects.confettiBurst(top, 24);
          break;
        }
        case 'rent': {
          const pv = this.plots[e.plot];
          const top = pv.topWorld(new THREE.Vector3());
          this.float(e.plot, e.amount, 'float-rent', top);
          if (Math.random() < 0.6) this.effects.sparkle(top, 3, ['#ffd34a', '#fff6c2']);
          break;
        }
        case 'streetComplete': {
          const plots = this.plotsDef.filter((p) => p.street === e.street);
          const end = plots.find((p) => p.def.lane === 'end') ?? plots[0];
          const top = this.plots[end.index].topWorld(new THREE.Vector3()).add(_v.set(0, 0.6, 0));
          this.effects.confettiBurst(top, 60);
          this.floatText(`${this.city.streets[e.street].name} lengkap! +${fmt(e.bonus)}`, top, 'float-stage');
          break;
        }
        case 'projectComplete': {
          const b = stageBounds(this.city, state.expandStage);
          for (let i = 0; i < 4; i++) {
            const p = new THREE.Vector3(THREE.MathUtils.lerp(b.minX, b.maxX, Math.random()), 3, THREE.MathUtils.lerp(b.minZ, b.maxZ, Math.random()));
            setTimeout(() => this.effects.confettiBurst(p, 70), i * 250);
          }
          this.effects.sparkle(new THREE.Vector3(0, 2, 0), 24);
          this.manualCamera = false;
          this.frameCamera(state, false);
          break;
        }
        case 'add':
          this.spawnIds.add(e.vehicleId);
          break;
        case 'merge': {
          const removed = this.vehicles.get(e.removedId);
          const label = this.vehicleLabels.get(e.removedId);
          if (removed && label) {
            this.vehicles.delete(e.removedId);
            this.vehicleLabels.delete(e.removedId);
            this.absorbs.push({ view: removed, label, keepId: e.keepId, level: e.level, t: 0, from: removed.group.position.clone() });
          }
          break;
        }
        case 'expand': {
          const from = trackFor(state.levelIndex, e.from);
          const to = trackFor(state.levelIndex, e.to);
          const inv = stageMapping(state.levelIndex, e.from, e.to).inverse();
          this.track.startMorph(from, to, inv, EXPAND_MORPH);
          this.revealStreet = this.city.streets.findIndex((s) => s.unlockStage === e.to);
          this.revealTimer = EXPAND_MORPH + 0.05;
          this.manualCamera = false;
          this.frameCamera(state, false, false, this.revealStreet);
          break;
        }
        case 'machine': {
          const sv = this.depot.lines[e.line];
          sv.onBuilt();
          const c = sv.padCenter(new THREE.Vector3());
          this.effects.puff(c.clone().setY(0.2), { count: 8, size: 0.28, spread: 1.6 });
          this.effects.sparkle(c, 12);
          break;
        }
        case 'upgrade': {
          for (let i = 0; i < state.depot.machines; i++) this.depot.lines[i].onUpgrade();
          this.effects.sparkle(new THREE.Vector3(0, 1.4, 0), 16, ['#7cf0b8', '#ffffff', '#ffd34a']);
          break;
        }
        default:
          break;
      }
    }
  }

  /** Angka mengambang di atas kavling; angka beruntun di kavling yang sama digabung. */
  private float(plot: number, amount: number, kind: string, pos: THREE.Vector3): void {
    const same = this.floats.find((f) => f.plot === plot && f.kind === kind && f.t < 0.3);
    if (same) {
      same.amount += amount;
      same.label.set(`+${fmt(same.amount)}`);
      return;
    }
    if (this.floats.length >= MAX_FLOATS) return; // batas keras: uang tetap masuk, hanya visualnya dilewati
    const label = this.labels.create(kind, `+${fmt(amount)}`);
    label.pos.copy(pos);
    this.floats.push({ label, t: 0, plot, amount, kind });
  }

  private floatText(text: string, pos: THREE.Vector3, cls: string): void {
    const label = this.labels.create(cls, text);
    label.pos.copy(pos);
    this.floats.push({ label, t: -0.8, plot: -1, amount: 0, kind: cls });
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  private ensureVehicle(id: number, level: number): VehicleView {
    let v = this.vehicles.get(id);
    if (!v) {
      v = new VehicleView(id, level, this.material);
      this.vehicles.set(id, v);
      this.levelRoot.add(v.group);
      this.vehicleLabels.set(id, this.labels.create('vehicle-label'));
      if (this.spawnIds.has(id)) {
        v.spawn();
        this.spawnIds.delete(id);
      }
    }
    return v;
  }

  update(dt: number, state: GameState, rt: Runtime): void {
    this.track.update(dt);
    const frozen = rt.freeze > 0 || state.completed;
    const speed = frozen ? 0 : BALANCE.vehicleSpeed * rt.boost.mult * 0.3;

    // Kendaraan
    const seen = new Set<number>();
    const selLevel = this.selectedVehicle !== null ? state.vehicles.find((v) => v.id === this.selectedVehicle)?.level : undefined;
    for (const v of state.vehicles) {
      seen.add(v.id);
      const absorbing = this.absorbs.some((a) => a.keepId === v.id);
      const view = this.ensureVehicle(v.id, absorbing ? v.level - 1 : v.level);
      if (!absorbing && view.displayLevel !== v.level) view.setDisplayLevel(v.level);
      this.track.pointAt(v.distance, _v);
      this.track.tangentAt(v.distance, _v2);
      view.selected = this.selectedVehicle === v.id;
      view.mergeable = selLevel !== undefined && !view.selected && v.level === selLevel && v.level < BALANCE.vehicleCapacity.length;
      view.update(dt, _v, Math.atan2(-_v2.z, _v2.x), speed, rt.boost.mult);
      const lbl = this.vehicleLabels.get(v.id)!;
      lbl.pos.copy(view.group.position).setY(1.2 + 0.1 * view.displayLevel);
      const cargo = Math.round(view.visualCargo);
      lbl.set(`<b>${view.displayLevel}</b>${cargo > 0 ? `<span>${cargo}</span>` : ''}`);
      for (let l = 1; l <= 6; l++) lbl.setClass(`lv${l}`, l === view.displayLevel);
      lbl.setClass('selected', view.selected);
      lbl.setClass('mergeable', view.mergeable);
    }
    for (const [id, view] of this.vehicles) {
      if (!seen.has(id)) {
        this.levelRoot.remove(view.group);
        view.dispose();
        this.vehicles.delete(id);
        const l = this.vehicleLabels.get(id);
        if (l) this.labels.remove(l);
        this.vehicleLabels.delete(id);
      }
    }

    // Animasi merge: kendaraan yang digabung terbang ke pasangannya lalu "pop"
    for (const a of this.absorbs) {
      a.t += dt;
      const target = this.vehicles.get(a.keepId);
      const k = Math.min(1, a.t / 0.38);
      if (target) {
        _v.lerpVectors(a.from, target.group.position, k * k);
        _v.y = Math.sin(k * Math.PI) * 1.4;
        a.view.group.position.copy(_v);
        a.view.group.scale.setScalar(Math.max(0.05, 1 - k * 0.8));
        a.label.pos.copy(_v).setY(_v.y + 1.3);
      }
      if (k >= 1) {
        this.levelRoot.remove(a.view.group);
        a.view.dispose();
        this.labels.remove(a.label);
        if (target) {
          target.setDisplayLevel(a.level);
          target.pop();
          this.effects.sparkle(target.group.position.clone().setY(0.8), 16);
          this.effects.puff(target.group.position.clone().setY(0.2), { count: 6, size: 0.3 });
        }
      }
    }
    this.absorbs = this.absorbs.filter((a) => a.t < 0.38);

    // Debu boost
    if (!frozen && rt.boost.mult > 1.2) {
      this.boostPuffTimer -= dt;
      if (this.boostPuffTimer <= 0) {
        this.boostPuffTimer = 0.08;
        for (const view of this.vehicles.values()) {
          if (Math.random() < 0.5) {
            view.group.localToWorld(_v.set(-0.55, 0.1, (Math.random() - 0.5) * 0.4));
            this.effects.puff(_v, { count: 1, size: 0.15, spread: 0.3, up: 0.5, life: 0.4, color: '#f3ead8' });
          }
        }
      }
    }

    // Depot
    const cap = storageCapacity(state);
    const full = state.depot.storage + depotInTransit(state) >= cap;
    this.depot.update(dt, { machines: state.depot.machines, storage: state.depot.storage, capacity: cap, lines: state.depot.lines, full, rate: productionRate(state) });
    this.depot.lines.forEach((l) => l.setSelected(this.depotSelected && !state.completed));
    this.depotLabel.visible = !state.completed;
    if (this.depotLabel.visible) {
      this.depot.labelAnchor(this.depotLabel.pos);
      const isFull = state.depot.storage >= cap;
      this.depotLabel.set(`<i>${isFull ? 'PENUH' : `Lv${state.depot.level}`}</i>${state.depot.storage}/${cap}`);
      this.depotLabel.setClass('full', isFull);
      this.depotLabel.setClass('empty', state.depot.storage === 0);
    }

    // Kavling: tampil saat jalannya terbuka (jalan baru muncul setelah animasi tumbuh)
    if (this.revealTimer > 0) {
      this.revealTimer -= dt;
      if (this.revealTimer <= 0 && this.revealStreet >= 0) {
        for (const p of this.plotsDef.filter((q) => q.street === this.revealStreet)) {
          this.plots[p.index].setVisible(true, true);
          this.effects.sparkle(new THREE.Vector3(p.pos.x, 0.8, p.pos.z), 8, ['#fff6c2', '#ffffff', '#9be8ff']);
        }
        this.revealStreet = -1;
      }
    }
    const nextOfStreet = new Map<number, number>();
    for (const p of this.plotsDef) {
      if (!nextOfStreet.has(p.street) && isPlotUnlocked(state, p.index) && !isPlotComplete(state, p.index)) nextOfStreet.set(p.street, p.index);
    }
    this.plots.forEach((pv, i) => {
      const unlocked = isPlotUnlocked(state, i) && !(this.revealStreet >= 0 && this.plotsDef[i].street === this.revealStreet);
      pv.setVisible(unlocked, false);
      pv.update(dt);
      const lbl = this.plotLabels[i];
      const have = state.plots[i];
      const complete = isPlotComplete(state, i);
      const target = plotProject(state, i).target;
      lbl.visible = unlocked && !complete && !state.completed && (have > 0 || nextOfStreet.get(this.plotsDef[i].street) === i);
      if (lbl.visible) {
        pv.topWorld(lbl.pos);
        lbl.set(`${have}/${target}<i style="width:${Math.round((have / target) * 100)}%"></i>`);
      }
    });

    // Label mengambang
    for (const f of this.floats) {
      f.t += dt;
      if (f.t > 1.1) this.labels.remove(f.label);
    }
    this.floats = this.floats.filter((f) => f.t <= 1.1);

    // Kamera otomatis pindah ke jalan berikutnya saat jalan aktif berganti.
    const act = this.activeStreet(state);
    if (act !== this.lastActive) {
      const first = this.lastActive === -2;
      this.lastActive = act;
      if (!first && !this.manualCamera && !state.completed && act >= 0) this.frameCamera(state, false);
    }

    this.effects.update(dt);
    this.rig.update(dt);
    // Kabut mengikuti jarak kamera supaya tampilan jauh tidak pudar.
    if (this.scene.fog instanceof THREE.Fog) {
      const d = this.rig.currentDist;
      this.scene.fog.near = d * 1.25;
      this.scene.fog.far = d * 3.2;
    }
    this.labels.update(this.rig.camera, this.width, this.height);
  }

  render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }

  // ---------------------------------------------------------------------------
  // Picking
  // ---------------------------------------------------------------------------

  pick(clientX: number, clientY: number, rect: DOMRect): PickResult {
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.rig.camera);
    const targets: THREE.Object3D[] = [this.depot.hit];
    for (const v of this.vehicles.values()) targets.push(v.hit);
    const hits = this.raycaster.intersectObjects(targets, false);
    const vh = hits.find((h) => h.object.userData.type === 'vehicle');
    if (vh) return { type: 'vehicle', id: vh.object.userData.id };
    let best: { id: number; d: number } | null = null;
    for (const v of this.vehicles.values()) {
      _v.copy(v.group.position).setY(0.4).project(this.rig.camera);
      const sx = (_v.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-_v.y * 0.5 + 0.5) * rect.height + rect.top;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < 30 && (!best || d < best.d)) best = { id: v.id, d };
    }
    if (best) return { type: 'vehicle', id: best.id };
    if (hits.some((h) => h.object.userData.type === 'depot')) return { type: 'depot' };
    return null;
  }

  /** Titik layar (px relatif kontainer) di atas depot — untuk tutorial. */
  depotScreen(): { x: number; y: number } {
    _v.set(0, 1.6, 0).project(this.rig.camera);
    return { x: (_v.x * 0.5 + 0.5) * this.width, y: (-_v.y * 0.5 + 0.5) * this.height };
  }
}
