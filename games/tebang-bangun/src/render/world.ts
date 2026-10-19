import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { LEVELS } from '../config/levels';
import { stageMapping } from '../game/actions';
import { completedModuleCount } from '../game/building';
import { capacity, cargoTotal, isPlotComplete, isPlotReady, isPlotUnlocked, plotClearedRatio, plotProject, plotsOf, trackFor, trainSpeed } from '../game/economy';
import type { GameEvent } from '../game/events';
import { stageBounds, type ResolvedPlot } from '../game/layout';
import type { GameState, LevelDefinition, Runtime } from '../game/types';
import { fieldFor, KINDS } from '../game/worldgen';
import { fmt } from '../ui/format';
import { CameraRig, type SafeArea } from './cameraRig';
import { Effects } from './effects';
import { buildEnvironment, type EnvironmentBuild } from './environment';
import { ForestView } from './forestView';
import { cbox, ccyl, mergeFlat } from './geom';
import type { ItemKind } from './items';
import { LabelLayer, type WorldLabel } from './labels';
import { SHARED, THEMES } from './palette';
import { PlotView } from './plotView';
import { TrackView } from './trackView';
import { TrainView } from './trainView';

export interface WorldHooks {
  onModulePop(index: number): void;
  onCut(kind: string): void;
}

interface Float {
  label: WorldLabel;
  t: number;
  key: string;
  amount: number;
}

const EXPAND_MORPH = 1.15;
const MAX_FLOATS = 16;
/** Leaf/serpihan per jenis blok saat tumbang. */
const CHIP_COLORS: Record<string, string> = { tree: '#6ccf58', treeGold: '#ffd24a', treeRed: '#f06a55', rock: '#b7bdc6', crystal: '#ff7a8f', coins: '#ffd24a' };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function checkerTexture(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = b;
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Gedung stasiun (lokal, alas di y=0): blok abu-abu dengan corong kuning di atas. */
function stationGeometry(): THREE.BufferGeometry {
  return mergeFlat([
    cbox(1.9, 0.14, 1.9, '#d9d4c8', 0, 0.07, 0, 0.05),
    cbox(1.5, 0.95, 1.5, '#7f8ea3', 0, 0.6, 0, 0.1),
    cbox(1.62, 0.12, 1.62, '#6b7a8f', 0, 1.12, 0, 0.04),
    cbox(1.2, 0.34, 1.2, '#ffc93c', 0, 1.33, 0, 0.08),
    cbox(0.8, 0.1, 0.8, '#3a3f4b', 0, 1.5, 0, 0.03),
    cbox(0.5, 0.5, 0.06, '#5b6a80', 0, 0.45, 0.76, 0.04),
    cbox(0.06, 0.5, 0.5, '#5b6a80', 0.76, 0.45, 0, 0.04),
    ccyl(0.05, 0.9, '#6b7280', 8, -0.85, 0.6, 0.85),
    cbox(0.5, 0.26, 0.05, '#2fbf71', -0.85, 1.15, 0.85, 0.03),
  ]);
}

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
  private plotsDef: ResolvedPlot[] = [];
  private track!: TrackView;
  private forest!: ForestView;
  private train!: TrainView;
  private station!: THREE.Group;
  private stationBounce = 0;
  private plots: PlotView[] = [];
  private plotLabels: WorldLabel[] = [];
  private cargoLabel!: WorldLabel;
  private wagonLabels: WorldLabel[] = [];
  private env: EnvironmentBuild | null = null;
  private floats: Float[] = [];
  private revealStreet = -1;
  private revealTimer = 0;
  private smokeTimer = 0;
  private width = 1;
  private height = 1;
  private safe: SafeArea = { xL: -0.92, xR: 0.92, yB: -0.6, yT: 0.7 };
  private raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private followDist = 18;
  /** Detik sejak pemain terakhir menggeser/zoom; kamera kembali mengikuti kereta setelah jeda. */
  private manualIdle = 99;
  overviewMode = false;
  private itemKind: ItemKind = 'wood';

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
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
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
    this.plotsDef = plotsOf(state.levelIndex);
    this.itemKind = this.level.buildResource === 'stone' ? 'stone' : 'wood';
    const palette = THEMES[this.level.theme];
    this.scene.background = new THREE.Color(palette.sky);
    this.scene.fog = new THREE.Fog(palette.fog, 40, 110);

    // Rel
    this.track = new TrackView(palette, trackFor(state.levelIndex, state.expandStage), [], { gate: false, style: 'rail' });
    this.levelRoot.add(this.track.group);

    // Hutan
    this.forest = new ForestView(state.levelIndex, this.level.theme === 'meadow' ? '#caa672' : '#c79a62');
    this.levelRoot.add(this.forest.group);

    // Lapangan & stasiun di tengah
    const H = this.level.hubHalf - 0.55;
    const tex = checkerTexture('#8fd16a', '#7fc45c');
    tex.repeat.set(H, H);
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.y = 0.01;
    lawn.receiveShadow = true;
    this.levelRoot.add(lawn);
    this.station = new THREE.Group();
    const sm = new THREE.Mesh(stationGeometry(), SHARED.vertexStd);
    sm.castShadow = true;
    sm.receiveShadow = true;
    this.station.add(sm);
    this.levelRoot.add(this.station);

    // Kavling (muncul setelah lahannya bersih)
    this.plotsDef.forEach((p, i) => {
      const proj = plotProject(state, i);
      const pv = new PlotView(p, proj, completedModuleCount(proj, state.plots[i]), palette.site, '#8fd16a');
      pv.building.onModulePop = (pos, index) => {
        this.effects.puff(pos, { count: 3, size: 0.16, spread: 1.1, color: '#f7efdf' });
        this.hooks.onModulePop(index);
      };
      pv.setVisible(isPlotReady(state, i), false);
      this.plots.push(pv);
      this.levelRoot.add(pv.group);
      this.plotLabels.push(this.labels.create('plot-label'));
    });

    // Kereta
    this.train = new TrainView(this.itemKind);
    this.levelRoot.add(this.train.group);
    this.cargoLabel = this.labels.create('cargo-label');

    // Lingkungan di luar hutan
    const half = fieldFor(state.levelIndex).half + 0.5;
    this.env = buildEnvironment(this.level.theme, palette, [{ minX: -half, maxX: half, minZ: -half, maxZ: half }], { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 }, null);
    this.levelRoot.add(this.env.group);

    const ext = half + 2;
    this.sun.position.set(-10, 24, 13);
    this.sun.target.position.set(0, 0, 0);
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 80;
    sc.updateProjectionMatrix();

    // Jarak ikut kamera: cukup untuk melihat stasiun + sebagian cabang di layar portrait.
    this.rig.fit(this.regionPoints(-4.6, 4.6, -4.6, 4.6), this.safe, { immediate: true });
    this.followDist = this.rig.goalDist;
    this.overviewMode = false;
    this.manualIdle = 99;
    this.syncTrain(state, 0, 0, 1);
    this.train.locoPosition(_v);
    this.rig.follow(_v.x, _v.z, this.followDist);
    this.rig.update(10);
  }

  private disposeLevel(): void {
    this.labels.clear();
    this.plotLabels = [];
    this.wagonLabels = [];
    this.floats = [];
    this.track?.dispose();
    this.forest?.dispose();
    for (const p of this.plots) p.dispose();
    this.plots = [];
    this.env?.dispose();
    this.env = null;
    this.effects.clear();
    this.scene.remove(this.levelRoot);
    this.levelRoot = new THREE.Group();
    this.scene.add(this.levelRoot);
    this.revealStreet = -1;
  }

  // ---------------------------------------------------------------------------
  // Kamera
  // ---------------------------------------------------------------------------

  private regionPoints(minX: number, maxX: number, minZ: number, maxZ: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (const x of [minX, maxX]) for (const z of [minZ, maxZ]) for (const y of [0, 1.5]) pts.push(new THREE.Vector3(x, y, z));
    return pts;
  }

  resize(width: number, height: number, safeTopPx: number, safeBottomPx: number, safeRightPx: number, state: GameState | null): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.rig.setAspect(this.width / this.height);
    const top = 1 - (2 * safeTopPx) / this.height;
    const bottom = -1 + (2 * safeBottomPx) / this.height;
    const right = 0.94 - (2 * safeRightPx) / this.width;
    this.safe = { xL: -0.92, xR: Math.max(-0.4, right - 0.02), yB: Math.min(bottom, top - 0.3), yT: top };
    if (state && this.level) {
      this.rig.fit(this.regionPoints(-4.6, 4.6, -4.6, 4.6), this.safe, { immediate: false });
      this.followDist = this.rig.goalDist;
      if (this.overviewMode) this.frameOverview(state);
    }
  }

  private frameOverview(state: GameState): void {
    const b = stageBounds(this.level, state.expandStage);
    this.rig.fit(this.regionPoints(b.minX - 1.5, b.maxX + 1.5, b.minZ - 1.5, b.maxZ + 1.5), this.safe, { ease: 2 });
  }

  /** Tombol peta: lihat seluruh jalur ↔ kembali mengikuti kereta. */
  toggleOverview(state: GameState): boolean {
    this.overviewMode = !this.overviewMode;
    if (this.overviewMode) this.frameOverview(state);
    else this.manualIdle = 99;
    return this.overviewMode;
  }

  pan(dxPx: number, dyPx: number, rect: DOMRect): void {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const a = this.groundAt(cx, cy, rect);
    const b = this.groundAt(cx + dxPx, cy + dyPx, rect);
    if (!a || !b) return;
    this.manualIdle = 0;
    this.rig.shift(a.x - b.x, a.z - b.z);
  }

  zoom(f: number): void {
    this.manualIdle = 0;
    this.rig.zoom(f);
    if (!this.overviewMode) this.followDist = THREE.MathUtils.clamp(this.followDist * f, 7, 60);
  }

  private groundAt(clientX: number, clientY: number, rect: DOMRect): THREE.Vector3 | null {
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.rig.camera);
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  // ---------------------------------------------------------------------------
  // Event → efek
  // ---------------------------------------------------------------------------

  handleEvents(events: GameEvent[], state: GameState): void {
    let chips = 0;
    for (const e of events) {
      switch (e.type) {
        case 'cut': {
          if (chips++ > 10) break; // batas keras partikel per frame
          const kind = KINDS[fieldFor(state.levelIndex).kind[e.cell]];
          const pos = this.forest.cellPos(e.cell, new THREE.Vector3());
          this.effects.puff(pos, { count: 3, size: 0.2, spread: 1.4, up: 1.2, color: CHIP_COLORS[kind] ?? '#6ccf58', life: 0.5 });
          if (e.res) {
            const item: ItemKind = e.res === 'wood' ? 'wood' : e.res === 'stone' ? 'stone' : 'gem';
            const wi = e.wagon;
            this.effects.fly(item, pos, this.train.wagonPosition(wi, new THREE.Vector3()), { dur: 0.28, height: 0.9, scale: 0.8, getTo: () => this.train.wagonPosition(wi, _v2), onLand: () => this.train.bumpWagon(wi) });
          } else if (e.money > 0) {
            this.effects.sparkle(pos, 8, ['#ffd34a', '#fff6c2']);
            this.float(`c${e.cell}`, e.money, 'float-rent', pos.clone().setY(1.2));
          }
          this.hooks.onCut(kind);
          break;
        }
        case 'plotReady': {
          const pv = this.plots[e.plot];
          pv.setVisible(true, true);
          const p = this.plotsDef[e.plot];
          this.effects.sparkle(new THREE.Vector3(p.pos.x, 0.8, p.pos.z), 14, ['#fff6c2', '#ffffff', '#9be8ff']);
          this.effects.puff(new THREE.Vector3(p.pos.x, 0.2, p.pos.z), { count: 8, size: 0.3, spread: 1.4 });
          break;
        }
        case 'deliver': {
          const pv = this.plots[e.plot];
          const targets = pv.building.scheduleModules(e.fromModule, e.toModule, 0.26);
          const n = Math.min(e.amount, 8);
          for (let i = 0; i < n; i++) {
            const to = targets[i % targets.length].clone();
            this.effects.fly(this.itemKind, this.train.wagonPosition(i % Math.max(1, this.train.wagonCount), new THREE.Vector3()), to, {
              delay: i * 0.03,
              dur: 0.34,
              height: 1.5,
              onLand: i === 0 ? () => this.effects.puff(to, { count: 3, size: 0.2, spread: 1.2 }) : undefined,
            });
          }
          break;
        }
        case 'plotComplete': {
          const pv = this.plots[e.plot];
          pv.markComplete();
          pv.building.stageBounce(1.4);
          const top = pv.topWorld(new THREE.Vector3());
          this.effects.sparkle(top, 14);
          this.effects.confettiBurst(top, 26);
          break;
        }
        case 'rent': {
          const top = this.plots[e.plot].topWorld(new THREE.Vector3());
          this.float(`r${e.plot}`, e.amount, 'float-rent', top);
          if (Math.random() < 0.6) this.effects.sparkle(top, 3, ['#ffd34a', '#fff6c2']);
          break;
        }
        case 'sell': {
          const st = new THREE.Vector3(0, 1.4, 0);
          const n = Math.min(14, 4 + Math.floor(e.money / 10));
          for (let i = 0; i < n; i++) {
            const from = this.train.wagonPosition(i % Math.max(1, this.train.wagonCount), new THREE.Vector3());
            this.effects.fly('coin', from, st.clone().add(_v.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), {
              delay: i * 0.04,
              dur: 0.42,
              height: 1.8,
              scale: 1.2,
              onLand: i === n - 1 ? () => (this.stationBounce = 1) : undefined,
            });
          }
          this.float('sell', e.money, 'float-sell', new THREE.Vector3(0, 2.3, 0));
          this.rig.bump(0.1 + Math.min(0.35, Math.log10(1 + e.money) * 0.12));
          break;
        }
        case 'streetComplete': {
          const plots = this.plotsDef.filter((p) => p.street === e.street);
          const end = plots.find((p) => p.def.lane === 'end') ?? plots[0];
          const top = this.plots[end.index].topWorld(new THREE.Vector3()).add(_v.set(0, 0.6, 0));
          this.effects.confettiBurst(top, 60);
          this.floatText(`${this.level.streets[e.street].name} lengkap! +${fmt(e.bonus)}`, top, 'float-stage');
          break;
        }
        case 'projectComplete': {
          const b = stageBounds(this.level, state.expandStage);
          for (let i = 0; i < 4; i++) {
            const p = new THREE.Vector3(THREE.MathUtils.lerp(b.minX, b.maxX, Math.random()), 3, THREE.MathUtils.lerp(b.minZ, b.maxZ, Math.random()));
            setTimeout(() => this.effects.confettiBurst(p, 70), i * 250);
          }
          this.overviewMode = true;
          this.frameOverview(state);
          break;
        }
        case 'add':
          this.train.pop(e.index);
          break;
        case 'merge':
          this.train.pop(0);
          this.effects.sparkle(this.train.wagonPosition(0, new THREE.Vector3()), 16);
          break;
        case 'speed':
        case 'capacity':
          this.effects.sparkle(this.train.locoPosition(new THREE.Vector3()).setY(1), 14, ['#7cf0b8', '#ffffff', '#ffd34a']);
          break;
        case 'expand': {
          const from = trackFor(state.levelIndex, e.from);
          const to = trackFor(state.levelIndex, e.to);
          this.track.startMorph(from, to, stageMapping(state.levelIndex, e.from, e.to).inverse(), EXPAND_MORPH);
          this.revealStreet = this.level.streets.findIndex((s) => s.unlockStage === e.to);
          this.revealTimer = EXPAND_MORPH + 0.05;
          // Pohon di jalur rel baru terlempar keluar.
          const f = fieldFor(state.levelIndex);
          e.cleared.forEach((c, i) => {
            if (i % 2) return;
            setTimeout(() => this.effects.puff(new THREE.Vector3(f.x[c], 0.5, f.z[c]), { count: 3, size: 0.25, spread: 1.6, up: 1.6, color: '#6ccf58' }), Math.min(1000, i * 12));
          });
          this.overviewMode = false;
          this.manualIdle = 99;
          break;
        }
        default:
          break;
      }
    }
  }

  private float(key: string, amount: number, cls: string, pos: THREE.Vector3): void {
    const same = this.floats.find((f) => f.key === key && f.t < 0.3);
    if (same) {
      same.amount += amount;
      same.label.set(`+${fmt(same.amount)}`);
      return;
    }
    if (this.floats.length >= MAX_FLOATS) return;
    const label = this.labels.create(cls, `+${fmt(amount)}`);
    label.pos.copy(pos);
    this.floats.push({ label, t: 0, key, amount });
  }

  private floatText(text: string, pos: THREE.Vector3, cls: string): void {
    const label = this.labels.create(cls, text);
    label.pos.copy(pos);
    this.floats.push({ label, t: -0.8, key: text, amount: 0 });
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  private syncTrain(state: GameState, dt: number, speed: number, boost: number, cutting = 0): void {
    this.train.setWagons(state.train.wagons);
    const fill = cargoTotal(state.train.cargo) / Math.max(1, capacity(state));
    this.train.update(
      dt,
      state.train.distance,
      BALANCE.wagonSpacing,
      (d, out) => this.track.pointAt(d, out),
      (d, out) => this.track.tangentAt(d, out),
      speed,
      fill,
      cutting,
      boost,
    );
  }

  update(dt: number, state: GameState, rt: Runtime): void {
    this.track.update(dt);
    const frozen = rt.freeze > 0 || state.completed;
    const speed = frozen ? 0 : trainSpeed(state) * rt.boost.mult * 0.3;
    this.syncTrain(state, dt, speed, rt.boost.mult, rt.cutHeat);
    this.forest.update(dt, state);

    // Asap lokomotif
    this.smokeTimer -= dt;
    if (!frozen && this.smokeTimer <= 0) {
      this.smokeTimer = rt.boost.mult > 1.2 ? 0.12 : 0.3;
      this.effects.puff(this.train.chimney(_v), { count: 1, size: 0.2, spread: 0.2, up: 1.3, life: 0.9, color: '#f4f4f4' });
    }

    // Label muatan di atas kereta (seperti angka muatan di game kereta tambang)
    const total = cargoTotal(state.train.cargo);
    const cap = capacity(state);
    this.train.locoPosition(this.cargoLabel.pos).setY(0.7);
    this.cargoLabel.away ??= new THREE.Vector3();
    this.train.wagonPosition(0, this.cargoLabel.away).setY(0.7);
    this.cargoLabel.awayPx = 62;
    this.cargoLabel.visible = !state.completed;
    this.cargoLabel.set(`<i class="res-${this.itemKind}"></i>${total}${total >= cap ? '<b>PENUH</b>' : ''}`);
    this.cargoLabel.setClass('full', total >= cap);
    // Lencana tingkat tiap gerbong
    while (this.wagonLabels.length < state.train.wagons.length) this.wagonLabels.push(this.labels.create('wagon-label'));
    while (this.wagonLabels.length > state.train.wagons.length) this.labels.remove(this.wagonLabels.pop()!);
    state.train.wagons.forEach((lv, i) => {
      const l = this.wagonLabels[i];
      this.train.wagonPosition(i, l.pos).setY(1.05);
      l.set(String(lv));
      for (let k = 1; k <= 8; k++) l.setClass(`lv${k}`, k === lv);
    });

    // Stasiun bergoyang saat menerima koin
    this.stationBounce = Math.max(0, this.stationBounce - dt * 3);
    const sb = Math.sin(this.stationBounce * Math.PI) * 0.08;
    this.station.scale.set(1 + sb * 0.5, 1 - sb + sb * 1.4, 1 + sb * 0.5);

    // Kavling
    if (this.revealTimer > 0) {
      this.revealTimer -= dt;
      if (this.revealTimer <= 0) this.revealStreet = -1;
    }
    this.plots.forEach((pv, i) => {
      const unlocked = isPlotUnlocked(state, i) && !(this.revealStreet >= 0 && this.plotsDef[i].street === this.revealStreet);
      const ready = unlocked && isPlotReady(state, i);
      pv.setVisible(ready, false);
      pv.update(dt);
      const lbl = this.plotLabels[i];
      lbl.visible = unlocked && !state.completed && !isPlotComplete(state, i);
      if (lbl.visible) {
        if (!ready) {
          const p = this.plotsDef[i];
          lbl.pos.set(p.pos.x, 1.9, p.pos.z);
          lbl.set(`<i class="axe"></i>${Math.round(plotClearedRatio(state, i) * 100)}%`);
          lbl.setClass('clearing', true);
        } else {
          pv.topWorld(lbl.pos);
          const target = plotProject(state, i).target;
          lbl.set(`${state.plots[i]}/${target}<i style="width:${Math.round((state.plots[i] / target) * 100)}%"></i>`);
          lbl.setClass('clearing', false);
        }
      }
    });

    for (const f of this.floats) {
      f.t += dt;
      if (f.t > 1.1) this.labels.remove(f.label);
    }
    this.floats = this.floats.filter((f) => f.t <= 1.1);

    // Kamera: ikuti kereta kecuali pemain sedang melihat-lihat / mode peta.
    this.manualIdle += dt;
    if (!this.overviewMode && this.manualIdle > 3.5) {
      this.train.locoPosition(_v);
      this.rig.follow(_v.x, _v.z, this.followDist);
    }

    this.effects.update(dt);
    this.rig.update(dt);
    if (this.scene.fog instanceof THREE.Fog) {
      const d = this.rig.currentDist;
      this.scene.fog.near = d * 1.3;
      this.scene.fog.far = d * 3.2;
    }
    this.labels.update(this.rig.camera, this.width, this.height);
  }

  render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }
}
