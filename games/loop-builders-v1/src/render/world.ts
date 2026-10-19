import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { LEVELS } from '../config/levels';
import { stageMapping } from '../game/actions';
import { completedModuleCount } from '../game/building';
import { buildCost, isSlotUnlocked, productionRate, projectOf, storageCapacity, trackFor } from '../game/economy';
import type { GameEvent } from '../game/events';
import type { GameState, LevelDefinition, MaterialKind, Runtime } from '../game/types';
import { BuildingView } from './buildingView';
import { CameraRig, type SafeArea } from './cameraRig';
import { Effects } from './effects';
import { buildEnvironment, type EnvironmentBuild, type Rect } from './environment';
import { LabelLayer, type WorldLabel } from './labels';
import { fmt } from '../ui/format';
import { THEMES } from './palette';
import { StationView } from './stationView';
import { TrackView } from './trackView';
import { VehicleView } from './vehicleView';

export type PickResult = { type: 'vehicle'; id: number } | { type: 'station'; slot: number } | null;

export interface WorldHooks {
  onBuildClick(slot: number): void;
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

const EXPAND_MORPH = 1.15;
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
  private level!: LevelDefinition;
  private material: MaterialKind = 'wood';
  private track!: TrackView;
  private stations: StationView[] = [];
  private stationLabels: WorldLabel[] = [];
  private buildButtons: WorldLabel[] = [];
  private vehicles = new Map<number, VehicleView>();
  private vehicleLabels = new Map<number, WorldLabel>();
  private building!: BuildingView;
  private env: EnvironmentBuild | null = null;
  private absorbs: Absorb[] = [];
  private spawnIds = new Set<number>();
  private revealSlot = -1;
  private revealTimer = 0;
  private boostPuffTimer = 0;
  private width = 1;
  private height = 1;
  private safe: SafeArea = { xL: -0.92, xR: 0.92, yB: -0.6, yT: 0.7 };
  private moneyFloat: { label: WorldLabel; amount: number; t: number } | null = null;
  private floats: { label: WorldLabel; t: number }[] = [];
  private raycaster = new THREE.Raycaster();
  private time = 0;
  selectedVehicle: number | null = null;
  selectedSlot: number | null = null;

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
  // Level
  // ---------------------------------------------------------------------------

  loadLevel(state: GameState): void {
    this.disposeLevel();
    this.level = LEVELS[state.levelIndex];
    this.material = this.level.material;
    const palette = THEMES[this.level.theme];
    this.scene.background = new THREE.Color(palette.sky);
    this.scene.fog = new THREE.Fog(palette.fog, 45, 110);
    this.hemi.groundColor.set(this.level.theme === 'city' ? '#b8b0a2' : '#7f9a5a');

    const exclusions = this.level.slots.flatMap((s) => [
      { x: s.storage[0], z: s.storage[1] },
      { x: s.machine[0], z: s.machine[1] },
      { x: (s.machine[0] + s.storage[0]) / 2, z: (s.machine[1] + s.storage[1]) / 2 },
    ]);
    this.track = new TrackView(palette, trackFor(state.levelIndex, state.expandStage), exclusions);
    this.levelRoot.add(this.track.group);

    // Bangunan
    const project = projectOf(state);
    this.building = new BuildingView(project, completedModuleCount(project, state.delivered));
    this.building.group.position.set(this.level.housePos[0], 0, this.level.housePos[1]);
    this.building.group.rotation.y = this.level.houseRotation;
    this.building.onModulePop = (pos, index) => {
      this.effects.puff(pos, { count: 4, size: 0.22, spread: 1.4, color: '#f7efdf' });
      this.hooks.onModulePop(index);
    };
    this.levelRoot.add(this.building.group);

    // Stasiun
    this.level.slots.forEach((def, i) => {
      const sv = new StationView(i, def, this.material);
      this.stations.push(sv);
      this.levelRoot.add(sv.group);
      const lbl = this.labels.create('station-label');
      this.stationLabels.push(lbl);
      const btn = this.labels.create('build-btn', '', true);
      btn.el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hooks.onBuildClick(i);
      });
      btn.el.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.buildButtons.push(btn);
    });

    // Lingkungan
    const keepOut: Rect[] = [];
    for (let s = 0; s < this.level.trackStages.length; s++) {
      const b = trackFor(state.levelIndex, s).bounds();
      keepOut.push({ minX: b.minX - 1.2, maxX: b.maxX + 1.2, minZ: b.minZ - 1.2, maxZ: b.maxZ + 1.2 });
    }
    for (const s of this.level.slots) {
      keepOut.push({
        minX: Math.min(s.machine[0], s.storage[0]) - 1.2,
        maxX: Math.max(s.machine[0], s.storage[0]) + 1.2,
        minZ: Math.min(s.machine[1], s.storage[1]) - 1.2,
        maxZ: Math.max(s.machine[1], s.storage[1]) + 1.2,
      });
    }
    const hb = this.building.worldBounds();
    const site: Rect = { minX: hb.min.x - 0.9, maxX: hb.max.x + 0.9, minZ: hb.min.z - 0.9, maxZ: hb.max.z + 0.6 };
    const b0 = trackFor(state.levelIndex, 0).bounds();
    const inner: Rect = { minX: b0.minX + 1.35, maxX: b0.maxX - 1.35, minZ: b0.minZ + 1.35, maxZ: b0.maxZ - 1.35 };
    this.env = buildEnvironment(this.level.theme, palette, keepOut, site, inner.maxX > inner.minX + 0.5 && inner.maxZ > inner.minZ + 0.5 ? inner : null);
    this.levelRoot.add(this.env.group);

    // Bayangan mencakup seluruh area main
    const all = keepOut.reduce((a, r) => ({ minX: Math.min(a.minX, r.minX), maxX: Math.max(a.maxX, r.maxX), minZ: Math.min(a.minZ, r.minZ), maxZ: Math.max(a.maxZ, r.maxZ) }), { ...site });
    const cx = (all.minX + all.maxX) / 2;
    const cz = (all.minZ + all.maxZ) / 2;
    const ext = Math.max(all.maxX - all.minX, all.maxZ - all.minZ) / 2 + 3;
    this.sun.position.set(cx - 9, 22, cz + 12);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 70;
    sc.updateProjectionMatrix();

    // Kendaraan
    for (const v of state.vehicles) this.ensureVehicle(v.id, v.level).setCargoNow(v.cargo);
    this.frameCamera(state, true);
  }

  private disposeLevel(): void {
    for (const v of this.vehicles.values()) v.dispose();
    this.vehicles.clear();
    this.absorbs = [];
    this.spawnIds.clear();
    this.labels.clear();
    this.vehicleLabels.clear();
    this.stationLabels = [];
    this.buildButtons = [];
    this.stations = [];
    this.floats = [];
    this.moneyFloat = null;
    this.track?.dispose();
    this.building?.dispose();
    this.env?.dispose();
    this.env = null;
    this.effects.clear();
    this.scene.remove(this.levelRoot);
    this.levelRoot = new THREE.Group();
    this.scene.add(this.levelRoot);
    this.selectedSlot = null;
    this.selectedVehicle = null;
    this.revealSlot = -1;
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
    this.safe = { xL: -0.9, xR: Math.max(-0.4, right - 0.04), yB: Math.min(bottom, top - 0.3), yT: top };
    if (state) this.frameCamera(state, true);
  }

  /** Framing gameplay (lintasan + stasiun + bangunan) atau sorotan bangunan saat selesai. */
  frameCamera(state: GameState, immediate: boolean): void {
    const pts: THREE.Vector3[] = [];
    const hb = this.building.worldBounds();
    if (state.completed) {
      for (const x of [hb.min.x, hb.max.x]) for (const y of [0, hb.max.y]) for (const z of [hb.min.z, hb.max.z]) pts.push(new THREE.Vector3(x, y, z));
      pts.push(new THREE.Vector3((hb.min.x + hb.max.x) / 2, 0, hb.max.z + 2.5));
      this.rig.fit(pts, this.safe, { yaw: 0.45, pitch: 0.62, immediate, ease: 1.6, orbit: 0.3 });
      return;
    }
    const b = trackFor(state.levelIndex, state.expandStage).bounds();
    for (const x of [b.minX - 0.9, b.maxX + 0.9]) for (const z of [b.minZ - 0.9, b.maxZ + 0.9]) pts.push(new THREE.Vector3(x, 0, z));
    this.level.slots.forEach((s, i) => {
      if (!isSlotUnlocked(state, i)) return;
      for (const [x, z] of [s.machine, s.storage]) {
        pts.push(new THREE.Vector3(x - 0.7, 0, z - 0.7), new THREE.Vector3(x + 0.7, 1.6, z + 0.7));
      }
    });
    for (const x of [hb.min.x, hb.max.x]) for (const y of [0, hb.max.y]) for (const z of [hb.min.z, hb.max.z]) pts.push(new THREE.Vector3(x, y, z));
    this.rig.fit(pts, this.safe, { yaw: 0.24, pitch: 0.95, immediate, ease: 2.2 });
  }

  // ---------------------------------------------------------------------------
  // Event → efek visual
  // ---------------------------------------------------------------------------

  handleEvents(events: GameEvent[], state: GameState): void {
    for (const e of events) {
      switch (e.type) {
        case 'produced': {
          const sv = this.stations[e.slot];
          sv.onProduced();
          if (Math.random() < 0.5) this.effects.puff(sv.chimneyWorld(_v), { count: 1, size: 0.2, spread: 0.2, up: 1.4, life: 0.9, color: '#f4f4f4' });
          break;
        }
        case 'stored':
          this.stations[e.slot].onStored();
          break;
        case 'pickup': {
          const view = this.vehicles.get(e.vehicleId);
          if (!view) break;
          const from = this.stations[e.slot].storageTop(new THREE.Vector3());
          const n = Math.min(e.amount, 6);
          for (let i = 0; i < n; i++) {
            this.effects.fly(this.material, from.clone().add(_v.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)), view.bedWorld(new THREE.Vector3()), {
              delay: i * 0.035,
              dur: 0.26,
              height: 0.9,
              getTo: () => view.bedWorld(_t),
              scale: 0.9,
            });
          }
          view.queueCargo(e.cargo, 0.26 + n * 0.035);
          break;
        }
        case 'unload': {
          const view = this.vehicles.get(e.vehicleId);
          const from = view ? view.bedWorld(new THREE.Vector3()) : this.track.pointAt(0, new THREE.Vector3()).setY(0.8);
          view?.setCargoNow(0);
          view?.dump();
          const targets = this.building.scheduleModules(e.fromModule, e.toModule, 0.3);
          const n = Math.min(e.amount, 10);
          const big = e.amount >= 20;
          for (let i = 0; i < n; i++) {
            const to = targets[i % targets.length].clone();
            const first = i === 0;
            this.effects.fly(this.material, from.clone().add(_v.set(0, i * 0.03, 0)), to, {
              delay: i * 0.03,
              dur: 0.34 + Math.random() * 0.08,
              height: 2.2 + Math.random() * 0.8,
              scale: big ? 1.15 : 1,
              onLand: first
                ? () => {
                    this.effects.puff(to, { count: big ? 8 : 5, size: big ? 0.34 : 0.26, spread: 1.6 });
                    this.hooks.onItemLand(this.material, big);
                  }
                : undefined,
            });
          }
          this.effects.puff(from.clone().setY(0.2), { count: 3 + Math.min(6, Math.floor(e.amount / 6)), size: 0.24, spread: 1.2 });
          this.track.pulseGate(Math.min(1, e.amount / 30));
          this.rig.bump(0.12 + Math.min(0.5, Math.log10(1 + e.amount) * 0.22));
          this.floatMoney(e.money);
          break;
        }
        case 'stageComplete': {
          this.building.stageBounce(1);
          const hb = this.building.worldBounds();
          const c = hb.getCenter(new THREE.Vector3());
          c.y = hb.max.y * 0.7;
          this.effects.sparkle(c, 16);
          this.floatText(`Tahap selesai! +${e.bonus}`, c.clone().setY(hb.max.y + 0.4), 'float-stage');
          break;
        }
        case 'projectComplete': {
          this.building.stageBounce(1.8);
          const hb = this.building.worldBounds();
          const c = hb.getCenter(new THREE.Vector3());
          c.y = hb.max.y;
          this.effects.confettiBurst(c, 150);
          this.effects.sparkle(c, 24);
          setTimeout(() => this.effects.confettiBurst(c.clone().add(_v2.set(1.5, 0, 0)), 90), 450);
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
          const newSlot = this.level.slots.findIndex((s) => s.unlockStage === e.to);
          this.revealSlot = newSlot;
          this.revealTimer = EXPAND_MORPH + 0.1;
          this.frameCamera(state, false);
          // debu sepanjang tepi yang bergerak
          const L = to.length;
          for (let k = 0; k < 10; k++) {
            const p = to.pointAt((k / 10) * L);
            this.effects.puff(_v.set(p.x, 0.1, p.z), { count: 2, size: 0.3, spread: 0.8, color: '#efe6d2' });
          }
          break;
        }
        case 'build': {
          const sv = this.stations[e.slot];
          sv.onBuilt();
          const c = sv.padCenter(new THREE.Vector3());
          this.effects.puff(c.clone().setY(0.2), { count: 10, size: 0.35, spread: 2 });
          this.effects.sparkle(c, 14);
          break;
        }
        case 'upgrade': {
          const sv = this.stations[e.slot];
          sv.onUpgrade();
          this.effects.sparkle(sv.chimneyWorld(new THREE.Vector3()).setY(1.4), 12, ['#7cf0b8', '#ffffff', '#ffd34a']);
          break;
        }
        default:
          break;
      }
    }
  }

  private floatMoney(amount: number): void {
    if (this.moneyFloat && this.moneyFloat.t < 0.25) {
      this.moneyFloat.amount += amount;
      this.moneyFloat.label.set(`+${this.moneyFloat.amount}`);
      return;
    }
    const pos = this.track.pointAt(0, new THREE.Vector3());
    pos.y = 1.6;
    const label = this.labels.create('float-money', `+${amount}`);
    label.pos.copy(pos);
    this.moneyFloat = { label, amount, t: 0 };
    this.floats.push({ label, t: 0 });
  }

  private floatText(text: string, pos: THREE.Vector3, cls: string): void {
    const label = this.labels.create(cls, text);
    label.pos.copy(pos);
    this.floats.push({ label, t: -0.6 });
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
    this.time += dt;
    this.track.update(dt);
    this.building.update(dt);
    const frozen = rt.freeze > 0 || state.completed;
    const speed = frozen ? 0 : BALANCE.vehicleSpeed * rt.boost.mult * 0.3;

    // Kendaraan dari state
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
      lbl.pos.copy(view.group.position).setY(1.25 + 0.1 * view.displayLevel);
      const cargo = Math.round(view.visualCargo);
      lbl.set(`<b>${view.displayLevel}</b>${cargo > 0 ? `<span>${cargo}</span>` : ''}`);
      lbl.setClass(`lv${Math.min(6, view.displayLevel)}`, true);
      for (let l = 1; l <= 6; l++) if (l !== view.displayLevel) lbl.setClass(`lv${l}`, false);
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
    for (const a of this.absorbs) {
      if (!a.view.group.parent) this.levelRoot.add(a.view.group);
    }

    // Debu boost di belakang roda
    if (!frozen && rt.boost.mult > 1.2) {
      this.boostPuffTimer -= dt;
      if (this.boostPuffTimer <= 0) {
        this.boostPuffTimer = 0.07;
        for (const view of this.vehicles.values()) {
          if (Math.random() < 0.6) {
            view.group.localToWorld(_v.set(-0.55, 0.1, (Math.random() - 0.5) * 0.4));
            this.effects.puff(_v, { count: 1, size: 0.16, spread: 0.3, up: 0.5, life: 0.4, color: '#f3ead8' });
          }
        }
      }
    }

    // Stasiun
    if (this.revealTimer > 0) {
      this.revealTimer -= dt;
      if (this.revealTimer <= 0 && this.revealSlot >= 0) {
        const sv = this.stations[this.revealSlot];
        const c = sv.padCenter(new THREE.Vector3());
        this.effects.sparkle(c, 22, ['#fff6c2', '#ffffff', '#9be8ff']);
        this.effects.puff(c.clone().setY(0.2), { count: 8, size: 0.3, spread: 1.6 });
        this.revealSlot = -1;
      }
    }
    state.stations.forEach((st, i) => {
      const sv = this.stations[i];
      const unlocked = isSlotUnlocked(state, i) && !(i === this.revealSlot && this.revealTimer > 0);
      const cap = storageCapacity(st);
      const full = st.storage + st.conveyor.length >= cap;
      sv.setSelected(this.selectedSlot === i && !state.completed);
      sv.update(dt, { unlocked, built: st.built, level: st.level, storage: st.storage, capacity: cap, conveyor: st.conveyor, full, rate: st.built ? productionRate(state, st) : 0 });
      const lbl = this.stationLabels[i];
      const btn = this.buildButtons[i];
      lbl.visible = unlocked && st.built && !state.completed;
      if (lbl.visible) {
        sv.labelAnchor(lbl.pos);
        const isFull = st.storage >= cap;
        lbl.set(`<i>${isFull ? 'PENUH' : `Lv${st.level}`}</i>${st.storage}/${cap}`);
        lbl.setClass('full', isFull);
        lbl.setClass('empty', st.storage === 0);
      }
      btn.visible = unlocked && !st.built && !state.completed;
      if (btn.visible) {
        // Tombol duduk di atas alas slot (bukan melayang tinggi) agar tidak menutupi stasiun tetangga.
        sv.padCenter(btn.pos).setY(0.1);
        btn.dy = 22;
        const cost = buildCost(state, i);
        btn.set(`<span>Bangun Mesin</span><b>${fmt(cost)}</b>`);
        btn.setClass('locked', state.money < cost);
      }
    });

    // Label mengambang
    for (const f of this.floats) {
      f.t += dt;
      if (f.t > 1.1) this.labels.remove(f.label);
    }
    this.floats = this.floats.filter((f) => f.t <= 1.1);
    if (this.moneyFloat) {
      this.moneyFloat.t += dt;
      if (this.moneyFloat.t > 1.1) this.moneyFloat = null;
    }

    this.effects.update(dt);
    this.rig.update(dt);
    this.labels.update(this.rig.camera, this.width, this.height);
  }

  render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }

  // ---------------------------------------------------------------------------
  // Picking (tap kendaraan / stasiun)
  // ---------------------------------------------------------------------------

  pick(clientX: number, clientY: number, rect: DOMRect): PickResult {
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.rig.camera);
    const targets: THREE.Object3D[] = [];
    for (const v of this.vehicles.values()) targets.push(v.hit);
    for (let i = 0; i < this.stations.length; i++) if (this.stations[i].group.visible) targets.push(this.stations[i].hit);
    const hits = this.raycaster.intersectObjects(targets, false);
    // Prioritaskan kendaraan (kecil & bergerak) di atas stasiun.
    const vh = hits.find((h) => h.object.userData.type === 'vehicle');
    if (vh) return { type: 'vehicle', id: vh.object.userData.id };
    // Toleransi layar untuk kendaraan yang bergerak cepat.
    let best: { id: number; d: number } | null = null;
    for (const v of this.vehicles.values()) {
      _v.copy(v.group.position).setY(0.4).project(this.rig.camera);
      const sx = (_v.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-_v.y * 0.5 + 0.5) * rect.height + rect.top;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < 34 && (!best || d < best.d)) best = { id: v.id, d };
    }
    if (best) return { type: 'vehicle', id: best.id };
    const sh = hits.find((h) => h.object.userData.type === 'station');
    if (sh) return { type: 'station', slot: sh.object.userData.slot };
    return null;
  }

  /** Titik atas-tengah tombol "Bangun Mesin" di dunia (px relatif kontainer), bila terlihat. */
  buildButtonAnchor(slot: number): { x: number; y: number } | null {
    const b = this.buildButtons[slot];
    if (!b || !b.visible || b.el.style.display === 'none') return null;
    const r = b.el.getBoundingClientRect();
    const root = this.labels.root.getBoundingClientRect();
    return { x: r.left - root.left + r.width / 2, y: r.top - root.top - 8 };
  }

  get buildingGhostCount(): number {
    return this.building.ghostCount;
  }
}
