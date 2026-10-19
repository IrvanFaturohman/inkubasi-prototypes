/**
 * Three.js scene: renders the field that is on screen by *reading* simulation state.
 * Background fields are simulated in economy.ts but never built here.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FIELDS, GEOMETRY, TIERS, type FieldConfig } from './config';
import { Game, headerOffset, stageOf } from './economy';
import type { FieldLayout } from './field';
import { Overlay, Particles, type PillState } from './effects';
import {
  CRATE_SLOTS,
  GeoBuilder,
  addBush,
  addCrateStack,
  addFence,
  addFlag,
  addHay,
  addPine,
  addPumpkin,
  addRock,
  addShed,
  addTree,
  buildHarvester,
  buildHopper,
  buildSilo,
  crateSlots,
  cropGeoms,
  isShared,
  sprinklerGeoms,
  vertexMat,
  type CropGeoms,
  type HarvesterModel,
} from './models';
import type { FieldId, GameEvent, Tier } from './types';

const DEG = Math.PI / 180;
export const CAMERA = { elevation: 56 * DEG, yaw: -4 * DEG, pad: 1.035 };

const m4 = new THREE.Matrix4();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const e1 = new THREE.Euler();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const s1 = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOutBack = (t: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ─── Crop material with a gentle wind sway (vertex shader, height-weighted) ─────

const wind = { uTime: { value: 0 }, uWind: { value: 0.05 } };
let cropMaterial: THREE.MeshLambertMaterial | null = null;
function getCropMaterial(): THREE.MeshLambertMaterial {
  if (cropMaterial) return cropMaterial;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uWind = wind.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float hgt = max(position.y, 0.0);
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float ph = ip.x * 1.3 + ip.z * 0.9;
        float sw = sin(uTime * 1.9 + ph) * 0.65 + sin(uTime * 3.3 + ph * 1.7) * 0.35;
        transformed.x += sw * uWind * hgt * hgt * 1.6;
        transformed.z += cos(uTime * 1.4 + ph) * uWind * hgt * hgt * 0.8;`,
      );
  };
  cropMaterial = m;
  return m;
}

// ─── Crops ──────────────────────────────────────────────────────────────────

class CropLayer {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[];
  private readonly K: number;
  private readonly n: number;
  private stalk: Float32Array; // dx, dz, yaw, scale
  private shown: Int8Array;
  private anim: Float32Array;
  private animKind: Uint8Array; // 0 none, 1 pop, 2 cut
  private key: Int16Array;
  private delay: Float32Array;
  private dirtyMin = [Infinity, Infinity, Infinity, Infinity];
  private dirtyMax = [-1, -1, -1, -1];
  // Instances are packed per stage: a patch visible in a stage owns one block of K stalks,
  // and mesh.count covers only used blocks, so hidden stalks cost the GPU nothing.
  private blockOf: Int32Array[];
  private patchAt: Int32Array[];
  private used = [0, 0, 0, 0];

  constructor(
    private layout: FieldLayout,
    private geo: CropGeoms,
    growth: number[],
    appearDelay: (i: number) => number,
  ) {
    const n = layout.patches.length;
    this.n = n;
    this.K = geo.stalks;
    const total = n * this.K;
    const mat = getCropMaterial();
    this.meshes = [geo.stubble, geo.sprout, geo.young, geo.mature].map((g, k) => {
      const m = new THREE.InstancedMesh(g, mat, total);
      m.castShadow = k >= 2;
      m.receiveShadow = false;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    });
    this.blockOf = this.meshes.map(() => new Int32Array(n).fill(-1));
    this.patchAt = this.meshes.map(() => new Int32Array(n).fill(-1));
    for (const m of this.meshes) m.count = 0;
    this.stalk = new Float32Array(total * 4);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < this.K; k++) {
        const j = i * this.K + k;
        const h1 = hash(j * 3 + 1);
        const h2 = hash(j * 3 + 2);
        const h3 = hash(j * 3 + 3);
        // Spread stalks evenly across the patch with jitter.
        const fx = this.K > 1 ? (k + 0.5) / this.K - 0.5 : 0;
        this.stalk[j * 4] = fx * 2 * geo.spreadX + (h1 - 0.5) * 0.12;
        this.stalk[j * 4 + 1] = (k % 2 === 0 ? -1 : 1) * geo.spreadZ * (0.35 + h2 * 0.65);
        this.stalk[j * 4 + 2] = h3 * Math.PI * 2;
        this.stalk[j * 4 + 3] = 0.86 + hash(j * 7 + 5) * 0.28;
        const tint = 0.9 + hash(j * 11 + 3) * 0.18;
        col.setRGB(tint, tint, tint * 0.98);
        for (const m of this.meshes) {
          m.setMatrixAt(j, ZERO);
          m.setColorAt(j, col);
        }
      }
    }
    this.shown = new Int8Array(n).fill(-1);
    this.anim = new Float32Array(n);
    this.animKind = new Uint8Array(n);
    this.key = new Int16Array(n).fill(-1);
    this.delay = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = appearDelay(i);
      if (d < 0 && !layout.patches[i].locked) {
        this.shown[i] = stageOf(growth[i]);
        this.writePatch(i, this.shown[i], growth[i]);
      } else {
        this.delay[i] = Math.max(0, d);
      }
    }
    this.flush();
  }

  private touch(stage: number, j0: number): void {
    if (j0 < this.dirtyMin[stage]) this.dirtyMin[stage] = j0;
    const j1 = j0 + this.K - 1;
    if (j1 > this.dirtyMax[stage]) this.dirtyMax[stage] = j1;
  }

  private alloc(stage: number, i: number): number {
    let b = this.blockOf[stage][i];
    if (b >= 0) return b;
    b = this.used[stage]++;
    this.blockOf[stage][i] = b;
    this.patchAt[stage][b] = i;
    this.meshes[stage].count = this.used[stage] * this.K;
    return b;
  }

  private hidePatch(i: number, stage: number): void {
    if (stage < 0) return;
    const b = this.blockOf[stage][i];
    if (b < 0) return;
    const m = this.meshes[stage];
    const last = --this.used[stage];
    if (b !== last) {
      // move the last block into the hole to keep instances packed
      const K16 = this.K * 16;
      (m.instanceMatrix.array as Float32Array).copyWithin(b * K16, last * K16, (last + 1) * K16);
      const moved = this.patchAt[stage][last];
      this.blockOf[stage][moved] = b;
      this.patchAt[stage][b] = moved;
      this.touch(stage, b * this.K);
    }
    this.blockOf[stage][i] = -1;
    this.patchAt[stage][last] = -1;
    m.count = this.used[stage] * this.K;
  }

  private stageScale(stage: number, g: number): number {
    if (stage === 0) return 1 - clamp01(g / 0.12) * 0.35;
    if (stage === 1) return 0.55 + 0.45 * clamp01((g - 0.12) / 0.38);
    if (stage === 2) return 0.68 + 0.32 * clamp01((g - 0.5) / 0.5);
    return 1;
  }

  private writePatch(i: number, stage: number, g: number): void {
    if (stage < 0) return;
    const p = this.layout.patches[i];
    const m = this.meshes[stage];
    const kind = this.animKind[i];
    const t = this.anim[i];
    let base = this.stageScale(stage, g);
    if (kind === 1) base *= 0.35 + 0.65 * easeOutBack(clamp01(t / 0.38));
    const dir = p.dir;
    const block = this.alloc(stage, i);
    for (let k = 0; k < this.K; k++) {
      const j = i * this.K + k;
      const slot = block * this.K + k;
      const dx = this.stalk[j * 4];
      const dz = this.stalk[j * 4 + 1];
      const yaw = this.stalk[j * 4 + 2];
      const sc = this.stalk[j * 4 + 3] * base;
      let tilt = 0;
      let sy = sc;
      let sxz = sc;
      if (kind === 2) {
        // Stalks fold toward the header in the order the cutter reaches them.
        const order = clamp01((dx * dir) / (2 * this.geo.spreadX) + 0.5);
        const tk = clamp01((t - order * 0.1) / 0.18);
        const e = tk * tk;
        tilt = e * 1.3 * dir;
        sy = sc * (1 - 0.85 * tk);
        sxz = sc * (1 - 0.35 * tk);
      }
      e1.set(0, yaw, 0);
      q1.setFromEuler(e1);
      if (tilt !== 0) {
        q2.setFromAxisAngle(Z_AXIS, tilt);
        q1.premultiply(q2);
      }
      v1.set(p.x + dx, 0.07, p.z + dz);
      s1.set(sxz, sy, sxz);
      m4.compose(v1, q1, s1);
      m.setMatrixAt(slot, m4);
    }
    this.touch(stage, block * this.K);
  }

  update(dt: number, growth: number[]): void {
    const patches = this.layout.patches;
    for (let i = 0; i < this.n; i++) {
      const p = patches[i];
      const g = growth[i];
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        if (this.delay[i] > 0) continue;
        this.delay[i] = 0;
      }
      const target = p.locked ? -1 : stageOf(g);
      const kind = this.animKind[i];
      if (kind === 2) {
        this.anim[i] += dt;
        if (this.anim[i] >= 0.3) {
          this.hidePatch(i, 3);
          this.shown[i] = 0;
          this.animKind[i] = 1;
          this.anim[i] = 0.1;
          this.writePatch(i, 0, g);
        } else {
          this.writePatch(i, 3, 1);
        }
        continue;
      }
      if (this.shown[i] !== target) {
        if (this.shown[i] === 3 && target === 0) {
          this.animKind[i] = 2;
          this.anim[i] = 0;
          this.writePatch(i, 3, 1);
          continue;
        }
        this.hidePatch(i, this.shown[i]);
        this.shown[i] = target;
        this.animKind[i] = target >= 0 ? 1 : 0;
        this.anim[i] = hash(i) * 0.08;
        this.key[i] = -1;
      }
      if (target < 0) continue;
      if (kind === 1) {
        this.anim[i] += dt;
        if (this.anim[i] >= 0.38) this.animKind[i] = 0;
        this.writePatch(i, target, g);
        continue;
      }
      const key = target * 100 + Math.round(this.stageScale(target, g) * 40);
      if (key !== this.key[i]) {
        this.key[i] = key;
        this.writePatch(i, target, g);
      }
    }
    this.flush();
  }

  private flush(): void {
    for (let s = 0; s < 4; s++) {
      if (this.dirtyMax[s] < 0) continue;
      const attr = this.meshes[s].instanceMatrix;
      attr.clearUpdateRanges();
      attr.addUpdateRange(this.dirtyMin[s] * 16, (this.dirtyMax[s] - this.dirtyMin[s] + 1) * 16);
      attr.needsUpdate = true;
      this.dirtyMin[s] = Infinity;
      this.dirtyMax[s] = -1;
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
  }
}

// ─── Harvester visuals ──────────────────────────────────────────────────────

interface HVis {
  id: number;
  model: HarvesterModel;
  tier: Tier;
  prevS: number;
  renderS: number;
  lastS: number;
  pop: number;
  popKind: 'none' | 'spawn' | 'grow';
  kick: number;
  flash: number;
  pendingTier: Tier | null;
  pendingT: number;
  cargoShown: number;
  full: boolean;
  phase: number;
  /** 1 = header open (cutting), 0 = folded for road travel. */
  fold: number;
}

interface Ghost {
  model: HarvesterModel;
  from: THREE.Vector3;
  targetId: number;
  t: number;
}

// ─── One field's scene graph ───────────────────────────────────────────────

class FieldView {
  readonly group = new THREE.Group();
  readonly layout: FieldLayout;
  readonly cfg: FieldConfig;
  readonly crops: CropLayer;
  readonly harvesters = new Map<number, HVis>();
  readonly ghosts: Ghost[] = [];
  private beds: THREE.InstancedMesh;
  private silo: THREE.Group;
  private hopperBowl: THREE.Object3D;
  readonly intake = new THREE.Vector3();
  readonly siloTop = new THREE.Vector3();
  private sprinklers: { root: THREE.Group; head: THREE.Object3D; pos: THREE.Vector3 }[] = [];
  private sprinklerSpots: { x: number; z: number }[] = [];
  private sprinklerGeo = sprinklerGeoms();
  private sprayT = 0;
  private waterShown = -1;
  private bedFlash = 0;
  private siloPunch = 0;
  private highlight: THREE.Mesh;
  private highlightT = 0;
  private owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  private slots = crateSlots();

  constructor(
    private host: Scene3D,
    game: Game,
    readonly fid: FieldId,
    appearDelay: (i: number) => number = () => -1,
  ) {
    const rt = game.rt[fid];
    const f = game.state.fields[fid];
    this.layout = rt.layout;
    this.cfg = FIELDS[fid];
    const pal = this.cfg.palette;
    const L = this.layout;

    // Ground & plot
    const ground = new THREE.Mesh(this.own(new THREE.PlaneGeometry(160, 160)), this.own(new THREE.MeshLambertMaterial({ color: pal.ground })));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    // Shape is drawn in (x, -z) so that rotating -90° about X lays it face-up on the ground.
    const plotShape = roundedRect(L.xA - 0.25, -(L.laneZ[L.laneZ.length - 1] + GEOMETRY.stripOffsets[2] + 0.4), L.xB + 0.25, GEOMETRY.stripOffsets[2] + 0.4, 0.5);
    const plot = new THREE.Mesh(this.own(new THREE.ShapeGeometry(plotShape, 4)), this.own(new THREE.MeshLambertMaterial({ color: pal.plot })));
    plot.rotation.x = -Math.PI / 2;
    plot.position.y = 0.004;
    plot.receiveShadow = true;
    this.group.add(plot);

    // Road ribbon (+ soft edge)
    this.group.add(this.ribbon(GEOMETRY.roadWidth + 0.16, 0.008, pal.roadEdge));
    this.group.add(this.ribbon(GEOMETRY.roadWidth, 0.016, pal.road));

    // Beds
    const bedGeo = this.own(new RoundedBoxGeometry(1, 0.08, 1, 1, 0.03));
    this.beds = new THREE.InstancedMesh(bedGeo, this.own(new THREE.MeshLambertMaterial({ color: '#ffffff' })), L.beds.length);
    this.beds.receiveShadow = true;
    L.beds.forEach((bed, i) => {
      m4.compose(v1.set((bed.x0 + bed.x1) / 2, 0.03, bed.z), q1.identity(), s1.set(bed.x1 - bed.x0, 1, GEOMETRY.bedDepth));
      this.beds.setMatrixAt(i, m4);
    });
    this.group.add(this.beds);
    this.updateBeds(f.water, true);

    // Crops
    this.crops = new CropLayer(L, cropGeoms(this.cfg.crop), f.growth, appearDelay);
    this.group.add(this.crops.group);

    // Silo + hopper
    this.silo = buildSilo();
    this.silo.position.set(L.silo.x, 0, L.silo.z);
    this.group.add(this.silo);
    const toSilo = new THREE.Vector3(L.silo.x - L.hopper.x, 0, L.silo.z - L.hopper.z);
    const hop = buildHopper(toSilo);
    hop.group.position.set(L.hopper.x, 0, L.hopper.z);
    hop.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !isShared(o.geometry)) this.owned.push(o.geometry);
    });
    this.hopperBowl = hop.bowl;
    this.group.add(hop.group);
    this.intake.set(L.hopper.x, 0.85, L.hopper.z);
    this.siloTop.set(L.silo.x, 3.3, L.silo.z);

    const ring = new THREE.Mesh(this.own(new THREE.TorusGeometry(1.25, 0.06, 6, 36)), this.own(new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0 })));
    ring.rotation.x = Math.PI / 2;
    ring.position.set((L.silo.x + L.hopper.x) / 2, 0.06, (L.silo.z + L.hopper.z) / 2);
    this.highlight = ring;
    this.group.add(ring);

    // Decor, fences, tier flags
    this.group.add(this.decor());

    // Sprinkler spots: row ends on the left, then between corridors.
    const bedHalf = (this.cfg.patchesPerRow * this.cfg.patchSpacing) / 2;
    for (const z of L.laneZ) {
      this.sprinklerSpots.push({ x: -bedHalf - 0.22, z: z - 1.55 }, { x: -bedHalf - 0.22, z: z + 1.55 });
    }
    for (let c = 0; c < L.laneZ.length - 1; c++) {
      const z = (L.laneZ[c] + L.laneZ[c + 1]) / 2;
      this.sprinklerSpots.push({ x: -1.2, z }, { x: 1.2, z });
    }
    this.owned.push(this.sprinklerGeo.post, this.sprinklerGeo.head);
    this.syncSprinklers(f.water);

    // Harvesters (no spawn animation for machines that already exist)
    for (const h of f.harvesters) this.addHarvester(h.id, h.tier, h.s, false);
  }

  private own<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    this.owned.push(x);
    return x;
  }

  private ribbon(width: number, y: number, color: string): THREE.Mesh {
    const pts = this.layout.path.sample(0.12);
    const pos: number[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % n];
      const ax = -Math.sin(a.heading) * width * 0.5;
      const az = Math.cos(a.heading) * width * 0.5;
      const cx = -Math.sin(c.heading) * width * 0.5;
      const cz = Math.cos(c.heading) * width * 0.5;
      pos.push(a.x - ax, y, a.z - az, c.x + cx, y, c.z + cz, a.x + ax, y, a.z + az);
      pos.push(a.x - ax, y, a.z - az, c.x - cx, y, c.z - cz, c.x + cx, y, c.z + cz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(this.own(g), this.own(new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
    mesh.receiveShadow = true;
    return mesh;
  }

  private decor(): THREE.Mesh {
    const L = this.layout;
    const pal = this.cfg.palette;
    const b = new GeoBuilder();
    const B = L.bounds;
    const fol = pal.foliage;
    const rnd = (i: number) => hash(i + (this.fid === 'wheat' ? 10 : 90));
    const bottom = L.laneZ[L.laneZ.length - 1] + GEOMETRY.stripOffsets[2];
    const top = -GEOMETRY.stripOffsets[2];
    // Back row (top of screen): trees can be tall here without hiding anything.
    for (let i = 0; i < 9; i++) {
      const x = B.minX + 1.4 + i * ((B.maxX - B.minX) / 8) + (rnd(i) - 0.5) * 0.6;
      const z = top - 1.6 - rnd(i + 20) * 1.4;
      if (Math.abs(x - L.silo.x) < 1.6) continue;
      if (this.fid === 'wheat') {
        if (i % 3 === 1) addPine(b, x, z, 0.9 + rnd(i + 3) * 0.4, fol[1]);
        else addTree(b, x, z, 0.85 + rnd(i + 5) * 0.45, fol[i % 2], fol[2]);
      } else {
        if (i % 2 === 0) addTree(b, x, z, 0.8 + rnd(i + 5) * 0.4, fol[i % 3], fol[1]);
        else addPumpkin(b, x, z + 0.8, 1 + rnd(i) * 0.5);
      }
    }
    // Fence along the top edge of the plot
    addFence(b, L.xA + 0.4, top - 0.75, L.xB + 0.9, top - 0.75, pal.fence);
    if (this.fid === 'wheat') {
      addShed(b, B.maxX - 0.4, top - 1.8, '#e2553b', '#fff1d6');
      addHay(b, L.silo.x + 1.2, L.silo.z - 0.95, 0.3);
      addHay(b, L.silo.x + 1.75, L.silo.z - 1.3, 1.2);
    } else {
      addShed(b, B.maxX - 0.4, top - 1.8, '#9b6a45', '#f5c84c');
      addCrateStack(b, L.silo.x + 1.25, L.silo.z - 0.95);
      addPumpkin(b, L.silo.x + 1.8, L.silo.z - 1.35, 1.2);
    }
    // Bottom row: only low objects so nothing covers the last corridor.
    for (let i = 0; i < 10; i++) {
      const x = B.minX + 0.6 + i * ((B.maxX - B.minX - 1) / 9) + (rnd(i + 40) - 0.5) * 0.5;
      const z = bottom + 0.95 + rnd(i + 50) * 1.6;
      const r = rnd(i + 60);
      if (this.fid === 'wheat') {
        if (r < 0.3) addHay(b, x, z, r * 6);
        else if (r < 0.7) addBush(b, x, z, 0.9 + r * 0.5, fol[i % 3]);
        else addRock(b, x, z, 1 + r);
      } else {
        if (r < 0.45) addPumpkin(b, x, z, 0.9 + r * 0.6);
        else if (r < 0.75) addBush(b, x, z, 0.9 + r * 0.4, fol[i % 3]);
        else addCrateStack(b, x, z);
      }
    }
    // Sides
    for (let i = 0; i < 6; i++) {
      const z = top + i * ((bottom - top) / 5);
      addBush(b, B.maxX + 0.6 + rnd(i + 70) * 0.5, z, 0.8 + rnd(i + 71) * 0.4, fol[i % 3]);
      if (z > L.silo.z + 1.5) addBush(b, B.minX - 0.3 - rnd(i + 72) * 0.4, z + 0.4, 0.7 + rnd(i + 73) * 0.4, fol[(i + 1) % 3]);
    }
    // Tier flags at the right end of rows the current machine may not reach yet.
    const bedHalf = (this.cfg.patchesPerRow * this.cfg.patchSpacing) / 2;
    for (const bed of L.beds) {
      if (bed.strip < 2 || bed.side !== -1) continue;
      const col = TIERS[bed.strip - 1].body;
      addFlag(b, bedHalf + 0.28, bed.z, col, bed.strip);
    }
    for (const bed of L.beds) {
      if (bed.strip < 2 || bed.side !== 1) continue;
      const col = TIERS[bed.strip - 1].body;
      addFlag(b, bedHalf + 0.28, bed.z, col, bed.strip);
    }
    // Stakes marking the locked deep rows
    if (!L.deepUnlocked) {
      for (const bed of L.beds) {
        if (bed.strip !== 3) continue;
        for (let x = -bedHalf + 0.4; x < bedHalf; x += 1.2) b.add(new THREE.BoxGeometry(0.05, 0.22, 0.05), '#b08a5e', [x, 0.11, bed.z]);
      }
    }
    const mesh = new THREE.Mesh(this.own(b.build()), vertexMat());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  updateBeds(water: number, force = false): void {
    if (!force && water === this.waterShown && this.bedFlash <= 0) return;
    this.waterShown = water;
    const pal = this.cfg.palette;
    const soil = new THREE.Color(pal.soil).lerp(new THREE.Color(pal.soilWet), Math.min(1, water / 6));
    if (this.bedFlash > 0) soil.lerp(new THREE.Color('#9fd6ee'), this.bedFlash * 0.5);
    const fallow = new THREE.Color(pal.fallow);
    this.layout.beds.forEach((bed, i) => this.beds.setColorAt(i, bed.locked ? fallow : soil));
    if (this.beds.instanceColor) this.beds.instanceColor.needsUpdate = true;
  }

  private syncSprinklers(level: number): void {
    const want = Math.min(this.sprinklerSpots.length, level * 2);
    if (want === this.sprinklers.length) return;
    while (this.sprinklers.length < want) {
      const spot = this.sprinklerSpots[this.sprinklers.length];
      const root = new THREE.Group();
      const post = new THREE.Mesh(this.sprinklerGeo.post, vertexMat());
      post.castShadow = true;
      const head = new THREE.Mesh(this.sprinklerGeo.head, vertexMat());
      head.position.y = 0.36;
      root.add(post, head);
      root.position.set(spot.x, 0, spot.z);
      root.scale.setScalar(0.01);
      root.userData.grow = 0;
      this.group.add(root);
      this.sprinklers.push({ root, head, pos: new THREE.Vector3(spot.x, 0.4, spot.z) });
    }
    while (this.sprinklers.length > want) this.group.remove(this.sprinklers.pop()!.root);
  }

  addHarvester(id: number, tier: Tier, s: number, animate: boolean): HVis {
    const model = buildHarvester(tier, this.cfg.crop);
    this.group.add(model.root);
    const vis: HVis = {
      id,
      model,
      tier,
      prevS: s,
      renderS: s,
      lastS: s,
      pop: animate ? 0 : 1,
      popKind: animate ? 'spawn' : 'none',
      kick: 0,
      flash: 0,
      pendingTier: null,
      pendingT: 0,
      cargoShown: -1,
      full: false,
      phase: hash(id) * 10,
      fold: this.headerOpen(s, tier) ? 1 : 0,
    };
    this.harvesters.set(id, vis);
    this.placeHarvester(vis, s);
    return vis;
  }

  private disposeModel(model: HarvesterModel): void {
    model.root.parent?.remove(model.root);
    model.material.dispose();
    model.pieces.dispose();
  }

  /** Header opens shortly before a lane and folds once the machine has left it. */
  private headerOpen(s: number, tier: Tier): boolean {
    const L = this.layout;
    const off = headerOffset(tier);
    const head = s + off;
    for (const lane of L.lanes) {
      // circular range test: header from just before the lane until the body has left it
      const start = lane.s0 - 0.2;
      if (L.path.wrap(head - start) <= lane.s1 + off + 0.15 - start) return true;
    }
    return false;
  }

  private applyFold(vis: HVis): void {
    const def = TIERS[vis.tier - 1];
    const folded = Math.min(1, 1.15 / def.headerWidth);
    const e = vis.fold * vis.fold * (3 - 2 * vis.fold);
    const k = folded + (1 - folded) * e;
    vis.model.header.scale.z = k;
    vis.model.reel.scale.z = k;
  }

  private placeHarvester(vis: HVis, s: number): void {
    const p = this.layout.path.pointAt(s);
    vis.model.root.position.set(p.x, 0, p.z);
    vis.model.root.rotation.y = -p.heading;
  }

  recordPrev(game: Game): void {
    for (const h of game.state.fields[this.fid].harvesters) {
      const v = this.harvesters.get(h.id);
      if (v) v.prevS = h.s;
    }
  }

  worldOf(vis: HVis, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    vis.model.body.updateWorldMatrix(true, false);
    return out.copy(local).applyMatrix4(vis.model.body.matrixWorld);
  }

  update(dt: number, alpha: number, game: Game, time: number, pills: Map<number, PillState>): void {
    const f = game.state.fields[this.fid];
    const rt = game.rt[this.fid];
    const L = this.layout;
    const Lp = L.path.length;
    const drive = rt.drive;

    this.crops.update(dt, f.growth);

    // Harvesters
    const alive = new Set<number>();
    for (const h of f.harvesters) {
      alive.add(h.id);
      let vis = this.harvesters.get(h.id);
      if (!vis) vis = this.addHarvester(h.id, h.tier, h.s, true);
      if (h.tier !== vis.tier && vis.pendingTier === null) {
        vis.pendingTier = h.tier;
        vis.pendingT = 0.5;
      }
      // interpolate between the last two logic steps
      let d = h.s - vis.prevS;
      if (d < -Lp / 2) d += Lp;
      if (d > Lp / 2) d -= Lp;
      const s = Math.abs(d) > 3 ? h.s : vis.prevS + d * alpha;
      let moved = s - vis.lastS;
      if (moved < -Lp / 2) moved += Lp;
      if (moved > Lp / 2) moved -= Lp;
      if (Math.abs(moved) > 3) moved = 0;
      vis.lastS = s;
      vis.renderS = s;
      this.placeHarvester(vis, s);
      const def = TIERS[vis.tier - 1];
      for (const w of vis.model.wheels) w.obj.rotation.z -= moved / (w.r * def.scale);
      const open = this.headerOpen(s, vis.tier);
      vis.fold = open ? Math.min(1, vis.fold + dt * 6) : Math.max(0, vis.fold - dt * 3.5);
      this.applyFold(vis);
      vis.model.reel.rotation.z += dt * (1.5 + drive * 7);
      // body bob + cut kick
      vis.kick = Math.max(0, vis.kick - dt * 5);
      const bob = Math.sin(time * 15 + vis.phase) * 0.012 * Math.min(1, drive);
      vis.model.body.position.y = bob + Math.sin(vis.kick * Math.PI) * 0.03;
      vis.model.body.rotation.z = -vis.kick * 0.05;
      // merge result: attention wiggle, then swap in the new tier
      if (vis.pendingTier !== null) {
        vis.pendingT -= dt;
        vis.model.body.rotation.y = Math.sin(time * 40) * 0.08;
        if (vis.pendingT <= 0) {
          this.disposeModel(vis.model);
          vis.model = buildHarvester(vis.pendingTier, this.cfg.crop);
          this.group.add(vis.model.root);
          vis.tier = vis.pendingTier;
          vis.pendingTier = null;
          vis.pop = 0;
          vis.popKind = 'grow';
          vis.flash = 1;
          vis.cargoShown = -1;
          this.placeHarvester(vis, s);
          this.applyFold(vis);
          this.host.particles.puff(v1.copy(vis.model.root.position).setY(0.5), 10, '#fff6e6', 0.7);
          this.host.onMergePop();
        }
      } else {
        vis.model.body.rotation.y = 0;
      }
      // pop animations
      const scale = TIERS[vis.tier - 1].scale;
      if (vis.popKind !== 'none') {
        vis.pop = Math.min(1, vis.pop + dt / (vis.popKind === 'spawn' ? 0.55 : 0.6));
        if (vis.popKind === 'spawn') {
          const t = vis.pop;
          const fall = 1 - t;
          vis.model.root.position.y = fall * fall * 2.4;
          vis.model.body.scale.setScalar(scale * (0.8 + 0.2 * easeOutBack(t)));
          if (t >= 1) this.host.particles.puff(v1.copy(vis.model.root.position).setY(0.2), 6);
        } else {
          vis.model.body.scale.setScalar(scale * (0.45 + 0.55 * easeOutBack(vis.pop)));
        }
        if (vis.pop >= 1) {
          vis.popKind = 'none';
          vis.model.body.scale.setScalar(scale);
          vis.model.root.position.y = 0;
        }
      }
      // flash
      if (vis.flash > 0) vis.flash = Math.max(0, vis.flash - dt * 2.2);
      vis.model.material.emissive.setRGB(vis.flash * 0.35, vis.flash * 0.3, vis.flash * 0.2);
      // crate contents
      const cap = game.capacity(f, h.tier);
      const want = h.cargo <= 0 ? 0 : Math.max(1, Math.round((Math.min(h.cargo, cap) / cap) * CRATE_SLOTS));
      if (want !== vis.cargoShown) {
        const pieces = vis.model.pieces;
        for (let k = 0; k < want; k++) {
          const sl = this.slots[k];
          e1.set(0, hash(k + vis.id * 31) * 0.8 - 0.4, 0);
          q1.setFromEuler(e1);
          m4.compose(sl, q1, s1.set(1, 1, 1));
          pieces.setMatrixAt(k, m4);
        }
        pieces.count = want;
        pieces.instanceMatrix.needsUpdate = true;
        vis.cargoShown = want;
      }
      const full = h.cargo >= cap;
      vis.full = full;
      vis.model.pieces.scale.setScalar(full ? 1 + Math.max(0, Math.sin(time * 6 + vis.phase)) * 0.06 : 1);
      // label anchor
      v2.copy(vis.model.root.position);
      v2.y += 1.55 * scale;
      const sp = this.host.worldToScreen(v2);
      pills.set(h.id, { x: sp.x, y: sp.y, cargo: h.cargo, cap, tier: h.tier, visible: vis.popKind !== 'spawn' || vis.pop > 0.6 });
    }
    for (const [id, vis] of this.harvesters) {
      if (!alive.has(id)) {
        this.disposeModel(vis.model);
        this.harvesters.delete(id);
      }
    }

    // merge ghosts hop onto their partner
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt / 0.5;
      const target = this.harvesters.get(g.targetId);
      const to = target ? target.model.root.position : g.from;
      const t = Math.min(1, g.t);
      const e = t * t * (3 - 2 * t);
      g.model.root.position.lerpVectors(g.from, to, e);
      g.model.root.position.y = Math.sin(Math.PI * t) * 1.3;
      g.model.root.rotation.y += dt * 6;
      g.model.body.scale.setScalar(TIERS[g.model.tier - 1].scale * (1 - 0.6 * e));
      if (g.t >= 1) {
        this.host.particles.puff(v1.copy(to).setY(0.4), 8);
        this.disposeModel(g.model);
        this.ghosts.splice(i, 1);
      }
    }

    // sprinklers
    this.syncSprinklers(f.water);
    for (const sp of this.sprinklers) {
      const g = sp.root.userData as { grow: number };
      if (g.grow < 1) {
        g.grow = Math.min(1, g.grow + dt * 2.5);
        sp.root.scale.setScalar(0.01 + 0.99 * easeOutBack(g.grow));
      }
      sp.head.rotation.y += dt * (2.2 + f.water * 0.35);
    }
    if (this.sprinklers.length > 0) {
      this.sprayT -= dt;
      if (this.sprayT <= 0) {
        this.sprayT = 0.16 / Math.min(4, this.sprinklers.length * 0.5);
        const sp = this.sprinklers[Math.floor(Math.random() * this.sprinklers.length)];
        const a = sp.head.rotation.y;
        const sd = 1.1 + Math.random() * 0.8;
        this.host.particles.drop(v1.copy(sp.pos).setY(0.42), v2.set(Math.cos(a) * sd, 1.5 + Math.random() * 0.6, -Math.sin(a) * sd));
      }
    }
    if (this.bedFlash > 0) {
      this.bedFlash = Math.max(0, this.bedFlash - dt * 1.5);
      this.updateBeds(f.water, true);
    } else this.updateBeds(f.water);

    // silo punch + highlight ring
    if (this.siloPunch > 0) {
      this.siloPunch = Math.max(0, this.siloPunch - dt * 3.2);
      const k = Math.sin(this.siloPunch * Math.PI) * 0.06;
      this.silo.scale.set(1 - k * 0.4, 1 + k, 1 - k * 0.4);
      this.hopperBowl.scale.set(1 + k, 1 - k, 1 + k);
    }
    const hm = this.highlight.material as THREE.MeshBasicMaterial;
    if (this.highlightT > 0) {
      this.highlightT = Math.max(0, this.highlightT - dt);
      hm.opacity = Math.min(1, this.highlightT) * (0.55 + 0.35 * Math.sin(time * 8));
      this.highlight.scale.setScalar(1 + 0.08 * Math.sin(time * 5));
    } else hm.opacity = 0;
  }

  // ── event hooks ──
  punchSilo(): void {
    this.siloPunch = 1;
  }
  highlightSilo(sec: number): void {
    this.highlightT = sec;
  }
  flashBeds(): void {
    this.bedFlash = 1;
  }
  flashAll(): void {
    for (const v of this.harvesters.values()) v.flash = 0.8 + Math.random() * 0.2;
  }
  kick(id: number): void {
    const v = this.harvesters.get(id);
    if (v) v.kick = 1;
  }
  flash(id: number, k = 1): void {
    const v = this.harvesters.get(id);
    if (v) v.flash = Math.max(v.flash, k);
  }
  startMerge(keptId: number, removedId: number): void {
    const r = this.harvesters.get(removedId);
    if (!r) return;
    this.harvesters.delete(removedId);
    this.ghosts.push({ model: r.model, from: r.model.root.position.clone(), targetId: keptId, t: 0 });
    const k = this.harvesters.get(keptId);
    if (k) k.flash = 0.6;
  }

  dispose(): void {
    for (const v of this.harvesters.values()) this.disposeModel(v.model);
    for (const g of this.ghosts) this.disposeModel(g.model);
    this.harvesters.clear();
    this.ghosts.length = 0;
    this.crops.dispose();
    this.beds.dispose();
    for (const o of this.owned) if (!isShared(o)) o.dispose();
    this.owned.length = 0;
    this.group.parent?.remove(this.group);
  }
}

function roundedRect(x0: number, z0: number, x1: number, z1: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, z0);
  s.lineTo(x1 - r, z0);
  s.quadraticCurveTo(x1, z0, x1, z0 + r);
  s.lineTo(x1, z1 - r);
  s.quadraticCurveTo(x1, z1, x1 - r, z1);
  s.lineTo(x0 + r, z1);
  s.quadraticCurveTo(x0, z1, x0, z1 - r);
  s.lineTo(x0, z0 + r);
  s.quadraticCurveTo(x0, z0, x0 + r, z0);
  return s;
}

// ─── Scene ──────────────────────────────────────────────────────────────────

interface Frustum {
  l: number;
  r: number;
  t: number;
  b: number;
}

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
  readonly particles = new Particles();
  readonly overlay: Overlay;
  private sun: THREE.DirectionalLight;
  private view: FieldView | null = null;
  private width = 1;
  private height = 1;
  private cur: Frustum = { l: -5, r: 5, t: 5, b: -5 };
  private target: Frustum = { l: -5, r: 5, t: 5, b: -5 };
  private time = 0;
  private punch = 0;
  private pills = new Map<number, PillState>();
  /** Visual beats scheduled on scene time (keeps effects in step with frames, not wall clock). */
  private timers: { at: number; fn: () => void }[] = [];
  /** Hooks so main.ts can add audio to visual beats. */
  onMergePop: () => void = () => {};

  constructor(container: HTMLElement, overlayRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'scene-canvas';
    container.prepend(this.renderer.domElement);
    this.overlay = new Overlay(overlayRoot);

    const hemi = new THREE.HemisphereLight('#fff8ec', '#cdb892', 1.35);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff3de', 1.55);
    this.sun.castShadow = true;
    const big = Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2) > 1400;
    this.sun.shadow.mapSize.set(big ? 2048 : 1024, big ? 2048 : 1024);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.particles.group);

    const el = CAMERA.elevation;
    const yaw = CAMERA.yaw;
    const look = new THREE.Vector3(0, 0, 3);
    this.camera.position.set(look.x + Math.sin(yaw) * Math.cos(el) * 60, Math.sin(el) * 60, look.z + Math.cos(yaw) * Math.cos(el) * 60);
    this.camera.lookAt(look);
    this.camera.updateMatrixWorld(true);
  }

  get fieldId(): FieldId | null {
    return this.view?.fid ?? null;
  }

  /** Build (or rebuild) the field on screen. Old field resources are disposed. */
  showField(game: Game, fid: FieldId, opts: { appearFrom?: number; appearDeep?: boolean; snap?: boolean } = {}): void {
    const old = this.view;
    const oldTarget = { ...this.target };
    old?.dispose();
    this.timers = [];
    this.particles.clear();
    this.overlay.clear();
    const layout = game.rt[fid].layout;
    const appearFrom = opts.appearFrom ?? Infinity;
    const bedLen = FIELDS[fid].patchesPerRow;
    const appear = (i: number): number => {
      const p = layout.patches[i];
      const isNew = i >= appearFrom || (opts.appearDeep === true && p.strip === 3);
      if (!isNew) return -1;
      return 0.35 + (p.corridor % 2) * 0.1 + (p.col / bedLen) * 0.5 + p.strip * 0.05;
    };
    this.view = new FieldView(this, game, fid, appear);
    this.scene.add(this.view.group);
    const pal = FIELDS[fid].palette;
    this.renderer.setClearColor(pal.ground);
    // sun & shadow frustum follow the field
    const b = layout.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - 7, 14, cz + 6);
    const ext = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.62 + 2.5;
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 45;
    sc.updateProjectionMatrix();
    this.target = this.fit(layout);
    if (opts.snap || !old) this.cur = { ...this.target };
    else this.cur = oldTarget;
    this.applyFrustum();
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = `${this.width}px`;
    this.renderer.domElement.style.height = `${this.height}px`;
    if (this.view) {
      this.target = this.fit(this.view.layout);
      this.cur = { ...this.target };
      this.applyFrustum();
    }
  }

  /** Fit the whole field + silo into the canvas, whatever its aspect ratio. */
  private fit(layout: FieldLayout): Frustum {
    const b = layout.bounds;
    const inv = this.camera.matrixWorldInverse;
    const pts: THREE.Vector3[] = [];
    const cropH = FIELDS[this.view?.fid ?? 'wheat'].crop === 'corn' ? 1.1 : 0.7;
    for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) for (const y of [0, cropH]) pts.push(new THREE.Vector3(x, y, z));
    pts.push(new THREE.Vector3(layout.silo.x, 3.4, layout.silo.z));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      p.applyMatrix4(inv);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    // a little headroom on top for crate labels / floating numbers
    maxY += 0.4;
    // Keep a strip at the top of the canvas free for the status chip.
    const topPx = Math.min(44, this.height * 0.08);
    const availH = Math.max(1, this.height - topPx);
    const W = (maxX - minX) * CAMERA.pad;
    const H = (maxY - minY) * CAMERA.pad;
    const upp = Math.max(W / this.width, H / availH); // world units per pixel
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const hw = (this.width * upp) / 2;
    const top = cy + (topPx + availH / 2) * upp;
    return { l: cx - hw, r: cx + hw, t: top, b: top - this.height * upp };
  }

  private applyFrustum(): void {
    const c = this.cur;
    const k = 1 - this.punch * 0.012;
    const cx = (c.l + c.r) / 2;
    const cy = (c.t + c.b) / 2;
    this.camera.left = cx + (c.l - cx) * k;
    this.camera.right = cx + (c.r - cx) * k;
    this.camera.top = cy + (c.t - cy) * k;
    this.camera.bottom = cy + (c.b - cy) * k;
    this.camera.updateProjectionMatrix();
  }

  recordPrev(game: Game): void {
    this.view?.recordPrev(game);
  }

  worldToScreen(v: THREE.Vector3): { x: number; y: number } {
    v1.copy(v).project(this.camera);
    return { x: ((v1.x + 1) / 2) * this.width, y: ((1 - v1.y) / 2) * this.height };
  }

  private later(sec: number, fn: () => void): void {
    this.timers.push({ at: this.time + sec, fn });
  }

  frame(dt: number, alpha: number, game: Game, render = true): void {
    this.time += dt;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time);
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const t of due) t.fn();
    }
    wind.uTime.value = this.time;
    const view = this.view;
    const drive = view ? game.rt[view.fid].drive : 0;
    const targetWind = 0.035 + Math.max(0, drive - 1) * 0.06 + (game.isPressing() ? 0.02 : 0);
    wind.uWind.value += (targetWind - wind.uWind.value) * Math.min(1, dt * 3);
    // smooth zoom (Expand) + tiny sale punch
    const k = 1 - Math.exp(-dt * 3.5);
    this.cur.l += (this.target.l - this.cur.l) * k;
    this.cur.r += (this.target.r - this.cur.r) * k;
    this.cur.t += (this.target.t - this.cur.t) * k;
    this.cur.b += (this.target.b - this.cur.b) * k;
    this.punch = Math.max(0, this.punch - dt * 5);
    this.applyFrustum();
    this.pills.clear();
    if (view) view.update(dt, alpha, game, this.time, this.pills);
    this.particles.update(dt);
    this.overlay.syncPills(this.pills);
    if (render) this.renderer.render(this.scene, this.camera);
  }

  handleEvent(e: GameEvent, game: Game): void {
    const view = this.view;
    if (!view || e.field !== view.fid) return;
    const cfg = FIELDS[view.fid];
    switch (e.type) {
      case 'cut': {
        const p = view.layout.patches[e.patch];
        if (!p) return;
        const colors = cfg.crop === 'wheat' ? ['#f2c14e', '#d6a13f', '#9ccc65'] : ['#7fae48', '#f5c84c', '#9cc15a'];
        if (Math.random() < 0.8) this.particles.chaff(v1.set(p.x, 0.45, p.z), e.dir, colors, 2 + Math.floor(Math.random() * 3));
        view.kick(e.harvester);
        break;
      }
      case 'full': {
        view.flash(e.harvester, 0.7);
        break;
      }
      case 'sell': {
        const vis = view.harvesters.get(e.harvester);
        const crateWorld = new THREE.Vector3();
        const from = vis ? () => view.worldOf(vis, vis.model.crateLocal, crateWorld) : () => view.intake;
        const color = cfg.crop === 'wheat' ? '#efc24d' : '#f5c84c';
        this.particles.grainStream(from, view.intake, Math.min(14, Math.max(4, Math.round(e.units / 1.5))), color);
        this.later(0.45, () => {
          if (this.view !== view) return;
          view.punchSilo();
          const sp = this.worldToScreen(view.siloTop);
          this.overlay.floatText(sp.x, sp.y, `+$${formatMoney(e.amount)}`);
          this.particles.confetti(v1.copy(view.siloTop).setY(3.1), [cfg.palette.accent, '#9ccc65', '#fff1d6', '#e2553b'], 7 + Math.min(6, Math.floor(e.units / 6)));
          if (e.units >= 20) this.punch = 1;
          if (e.first) {
            view.highlightSilo(2.6);
            const lp = this.worldToScreen(v2.copy(view.siloTop).setY(4.1));
            this.overlay.label(lp.x, lp.y, 'Crops sold!', 'label-sold', 2600);
          }
        });
        break;
      }
      case 'spawn':
        break; // FieldView creates it with a drop-in the next frame
      case 'merge':
        view.startMerge(e.kept, e.removed);
        break;
      case 'upgrade':
        if (e.kind === 'water') view.flashBeds();
        else if (e.kind === 'speed' || e.kind === 'storage' || e.kind === 'auto') view.flashAll();
        if (e.kind === 'auto') {
          for (const v of view.harvesters.values()) {
            const sp = this.worldToScreen(v2.copy(v.model.root.position).setY(1.9));
            this.overlay.floatText(sp.x, sp.y, 'AUTO', 'float-auto');
          }
        }
        break;
      case 'expand': {
        const prevCount = view.layout.patches.length;
        this.showField(game, view.fid, { appearFrom: prevCount, appearDeep: e.level >= FIELDS[view.fid].deepRowsAtExpand });
        break;
      }
      default:
        break;
    }
  }

  dispose(): void {
    this.view?.dispose();
    this.renderer.dispose();
  }
}

export function formatMoney(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return Math.floor(n).toLocaleString('en-US');
}
