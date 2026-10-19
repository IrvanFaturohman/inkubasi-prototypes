import * as THREE from 'three';
import { VEHICLE } from '../game/config';
import { clamp, damp, easeOutBack, hash2, lerp } from '../game/util';
import type { VehicleSim } from '../game/VehicleSim';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox, type ArtFactory } from './ArtFactory';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

interface Slot {
  x: number;
  y: number;
  z: number;
  ry: number;
  rx: number;
  sx: number;
}

export interface VehicleFeel {
  contact: boolean;
  powered: boolean;
  full: boolean;
  unloading: boolean;
  powerLevel: number;
  speedLevel: number;
  reducedMotion: boolean;
}

/**
 * The orange demolition truck: cab, powered drum with ridges, support yoke,
 * intake + conveyor, and a rear open-top bin with thin translucent walls.
 * Purely visual; reads the simulation each frame.
 */
export class VehicleView {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private cab = new THREE.Group();
  private wheels: THREE.Group[] = [];
  private rollerGroup = new THREE.Group();
  private drum = new THREE.Group();
  private drumCore: THREE.Mesh;
  private drumCaps: THREE.Mesh[] = [];
  private ridgeMesh: THREE.Mesh | null = null;
  private yoke: THREE.Mesh;
  private dropArms: THREE.Mesh[] = [];
  private binPivot = new THREE.Group();
  private bin = new THREE.Group();
  private binParts: {
    base: THREE.Mesh;
    posts: THREE.Mesh[];
    rims: THREE.Mesh[];
    walls: THREE.Mesh[];
  };
  private cargoMesh: THREE.InstancedMesh;
  private slots: Slot[] = [];
  private slotColor: THREE.Color[] = [];
  private visibleSlots = 0;
  private slotPop: Float32Array = new Float32Array(0);
  private pendingColors: number[] = [];
  private beacon: THREE.Mesh;
  private beaconMat: THREE.MeshStandardMaterial;
  private slats: THREE.Mesh[] = [];
  private hubcaps: THREE.Mesh[] = [];
  private blob: THREE.Mesh;
  private art: ArtFactory;

  private rollerWidth = 1.45;
  private binDims = { w: 1.02, l: 1.0, h: 0.5 };
  private drumSpin = 0;
  private drumAngle = 0;
  private lean = 0;
  private pitch = 0;
  private sway = 0;
  private swayVel = 0;
  private tip = 0;
  private slatPhase = 0;
  private time = 0;
  private lastSpeed = 0;
  private pops: Record<'roller' | 'cargo' | 'power' | 'speed', number> = { roller: 9, cargo: 9, power: 9, speed: 9 };
  private ridgeCount = 0;
  private ridgeMat: THREE.MeshStandardMaterial;

  constructor(art: ArtFactory) {
    this.art = art;
    const M = art.mats;
    this.root.add(this.body);

    // Soft contact shadow under the truck (always on, cheap).
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 3.3),
      new THREE.MeshBasicMaterial({ map: art.textures.blob, transparent: true, depthWrite: false }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.set(0, 0.012, -0.05);
    this.blob.renderOrder = 1;
    this.root.add(this.blob);

    // Wheels: six chunky tyres with yellow hubcaps.
    const tyreGeo = new THREE.CylinderGeometry(VEHICLE.wheelRadius, VEHICLE.wheelRadius, 0.2, 18);
    tyreGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12);
    hubGeo.rotateZ(Math.PI / 2);
    const boltGeo = new THREE.BoxGeometry(0.03, 0.06, 0.06);
    const axleGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.0, 8);
    axleGeo.rotateZ(Math.PI / 2);
    for (const z of [0.52, -0.5, -1.0]) {
      const axle = new THREE.Mesh(axleGeo, M.dark);
      axle.position.set(0, VEHICLE.wheelRadius, z);
      this.body.add(axle);
      for (const side of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(side * 0.56, VEHICLE.wheelRadius, z);
        const tyre = new THREE.Mesh(tyreGeo, M.rubber);
        tyre.castShadow = true;
        w.add(tyre);
        const hub = new THREE.Mesh(hubGeo, M.yellow);
        hub.position.x = side * 0.1;
        w.add(hub);
        this.hubcaps.push(hub);
        const bolt = new THREE.Mesh(boltGeo, M.dark);
        bolt.position.set(side * 0.125, 0.045, 0);
        w.add(bolt);
        this.body.add(w);
        this.wheels.push(w);
      }
    }

    // Chassis and fenders.
    const chassis = new THREE.Mesh(roundedBox(0.94, 0.24, 2.36, 0.07, 2), M.orange);
    chassis.position.set(0, 0.44, -0.2);
    chassis.castShadow = true;
    this.body.add(chassis);
    const skirt = new THREE.Mesh(roundedBox(0.98, 0.08, 2.2, 0.03, 1), M.dark);
    skirt.position.set(0, 0.31, -0.22);
    this.body.add(skirt);
    for (const side of [-1, 1]) {
      const fender = new THREE.Mesh(roundedBox(0.28, 0.1, 0.62, 0.04, 2), M.yellow);
      fender.position.set(side * 0.56, 0.56, 0.52);
      fender.castShadow = true;
      this.body.add(fender);
    }

    // Cab with dark windshield, roof highlight and amber beacon.
    this.cab.position.set(0, 0.56, 0.16);
    this.body.add(this.cab);
    const cabBox = new THREE.Mesh(roundedBox(0.7, 0.5, 0.6, 0.1, 2), M.orange);
    cabBox.position.y = 0.26;
    cabBox.castShadow = true;
    this.cab.add(cabBox);
    const roof = new THREE.Mesh(roundedBox(0.74, 0.08, 0.56, 0.04, 2), M.yellow);
    roof.position.y = 0.55;
    roof.castShadow = true;
    this.cab.add(roof);
    const wind = new THREE.Mesh(roundedBox(0.58, 0.26, 0.05, 0.03, 1), M.windshield);
    wind.position.set(0, 0.32, 0.3);
    this.cab.add(wind);
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(roundedBox(0.05, 0.22, 0.38, 0.02, 1), M.windshield);
      sw.position.set(side * 0.355, 0.33, 0.02);
      this.cab.add(sw);
    }
    const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.04, 12), M.dark);
    beaconBase.position.set(0, 0.61, -0.08);
    this.cab.add(beaconBase);
    this.beaconMat = (M.beacon as THREE.MeshStandardMaterial).clone();
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.beaconMat);
    this.beacon.position.set(0, 0.625, -0.08);
    this.cab.add(this.beacon);

    // Front drum assembly.
    this.rollerGroup.position.set(0, VEHICLE.rollerRadius, VEHICLE.rollerZ);
    this.body.add(this.rollerGroup);
    this.rollerGroup.add(this.drum);
    const drumGeo = new THREE.CylinderGeometry(VEHICLE.rollerRadius, VEHICLE.rollerRadius, 1, 24, 1);
    drumGeo.rotateZ(Math.PI / 2);
    this.drumCore = new THREE.Mesh(drumGeo, M.dark);
    this.drumCore.castShadow = true;
    this.drum.add(this.drumCore);
    const capGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16);
    capGeo.rotateZ(Math.PI / 2);
    for (let k = 0; k < 2; k++) {
      const cap = new THREE.Mesh(capGeo, M.yellow);
      this.drumCaps.push(cap);
      this.rollerGroup.add(cap);
    }
    this.ridgeMat = (M.yellow as THREE.MeshStandardMaterial).clone();
    this.yoke = new THREE.Mesh(roundedBox(1, 0.12, 0.14, 0.04, 1), M.orange);
    this.yoke.position.set(0, 0.16, -0.4);
    this.yoke.castShadow = true;
    this.rollerGroup.add(this.yoke);
    for (let k = 0; k < 2; k++) {
      const arm = new THREE.Mesh(roundedBox(0.1, 0.12, 0.46, 0.04, 1), M.orange);
      arm.position.set(0, 0.08, -0.2);
      arm.rotation.x = 0.25;
      arm.castShadow = true;
      this.dropArms.push(arm);
      this.rollerGroup.add(arm);
    }
    // Centre link from yoke to chassis.
    const link = new THREE.Mesh(roundedBox(0.36, 0.12, 0.42, 0.04, 1), M.orange);
    link.position.set(0, 0.24, 0.72);
    this.body.add(link);
    // Intake scoop behind the drum.
    const intake = new THREE.Mesh(roundedBox(0.62, 0.22, 0.2, 0.05, 1), M.dark);
    intake.position.set(0, 0.36, 0.78);
    intake.rotation.x = 0.35;
    this.body.add(intake);
    const lip = new THREE.Mesh(roundedBox(0.66, 0.05, 0.06, 0.02, 1), M.yellow);
    lip.position.set(0, 0.47, 0.86);
    this.body.add(lip);

    // Conveyor channel along the right side from the intake up into the bin.
    const conveyor = new THREE.Group();
    conveyor.position.set(0.5, 0.78, 0.26);
    conveyor.rotation.x = -0.42;
    this.body.add(conveyor);
    const chan = new THREE.Mesh(roundedBox(0.2, 0.08, 1.2, 0.03, 1), M.yellow);
    chan.castShadow = true;
    conveyor.add(chan);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(roundedBox(0.03, 0.1, 1.2, 0.012, 1), M.orange);
      wall.position.set(side * 0.1, 0.06, 0);
      conveyor.add(wall);
    }
    const slatGeo = new THREE.BoxGeometry(0.15, 0.025, 0.06);
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Mesh(slatGeo, M.dark);
      s.position.set(0, 0.05, 0);
      conveyor.add(s);
      this.slats.push(s);
    }

    // Rear bin (tips around its rear-bottom edge when unloading).
    this.body.add(this.binPivot);
    this.binPivot.add(this.bin);
    const base = new THREE.Mesh(roundedBox(1, 0.1, 1, 0.04, 1), M.orange);
    base.castShadow = true;
    const posts: THREE.Mesh[] = [];
    const rims: THREE.Mesh[] = [];
    const walls: THREE.Mesh[] = [];
    for (let k = 0; k < 4; k++) {
      const p = new THREE.Mesh(roundedBox(0.08, 1, 0.08, 0.03, 1), M.yellow);
      p.castShadow = true;
      posts.push(p);
      this.bin.add(p);
      const r = new THREE.Mesh(roundedBox(1, 0.06, 0.06, 0.025, 1), M.yellow);
      rims.push(r);
      this.bin.add(r);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M.glass);
      w.renderOrder = 2;
      walls.push(w);
      this.bin.add(w);
    }
    this.bin.add(base);
    this.binParts = { base, posts, rims, walls };

    // Cargo fill: bounded pool of chunks representing the ledger ratio.
    this.cargoMesh = new THREE.InstancedMesh(art.geo.chunk, art.chunkMat, 160);
    this.cargoMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(160 * 3).fill(1), 3);
    this.cargoMesh.count = 0;
    this.cargoMesh.castShadow = true;
    this.cargoMesh.frustumCulled = false;
    this.bin.add(this.cargoMesh);

    this.setRollerWidth(1.45, false);
    this.setCargoLevel(0, false);
    this.setPowerLevel(0, false);
    this.setSpeedLevel(0, false);
  }

  setRollerWidth(w: number, animate = true): void {
    this.rollerWidth = w;
    this.drumCore.scale.set(w, 1, 1);
    this.drumCaps[0].position.x = -w / 2 - 0.02;
    this.drumCaps[1].position.x = w / 2 + 0.02;
    this.yoke.scale.x = w + 0.1;
    this.dropArms[0].position.x = -w / 2 - 0.08;
    this.dropArms[1].position.x = w / 2 + 0.08;
    this.rebuildRidges(this.ridgeCount || 4);
    if (animate) this.pops.roller = 0;
  }

  private rebuildRidges(count: number): void {
    if (this.ridgeMesh) {
      this.ridgeMesh.geometry.dispose();
      this.drum.remove(this.ridgeMesh);
    }
    this.ridgeCount = count;
    const len = this.rollerWidth * 0.94;
    // Shallow-V cutting ridges running the full drum width, merged into one mesh.
    const segs = 2;
    const segLen = len / segs;
    const base = roundedBox(segLen * 0.97, 0.08, 0.1, 0.03, 1);
    base.deleteAttribute('uv');
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      for (let s = 0; s < segs; s++) {
        const off = 0;
        _p.set(-len / 2 + segLen * (s + 0.5), Math.cos(a + off) * (VEHICLE.rollerRadius + 0.02), Math.sin(a + off) * (VEHICLE.rollerRadius + 0.02));
        _e.set(a + off, s % 2 === 0 ? 0.12 : -0.12, 0);
        _q.setFromEuler(_e);
        _s.set(1, 1, 1);
        parts.push(base.clone().applyMatrix4(_m.compose(_p, _q, _s)));
      }
    }
    const merged = mergeGeometries(parts, false)!;
    for (const g of parts) g.dispose();
    base.dispose();
    this.ridgeMesh = new THREE.Mesh(merged, this.ridgeMat);
    this.drum.add(this.ridgeMesh);
  }

  setPowerLevel(level: number, animate = true): void {
    // More and brighter ridges with power.
    const count = [4, 5, 6, 7, 8][level] ?? 4;
    const colors = ['#FFC94D', '#FFB938', '#FF9F2E', '#F9793A', '#F45B57'];
    this.ridgeMat.color.set(colors[level] ?? colors[0]);
    this.rebuildRidges(count);
    if (animate) this.pops.power = 0;
  }

  setSpeedLevel(level: number, animate = true): void {
    const hubColors = ['#FFC94D', '#FFD34D', '#55C992', '#3C8DFA', '#9975E8'];
    const mat = (this.hubcaps[0].material as THREE.MeshStandardMaterial).clone();
    mat.color.set(hubColors[level] ?? hubColors[0]);
    for (const h of this.hubcaps) {
      h.material = mat;
      h.scale.setScalar(1 + level * 0.06);
    }
    if (animate) this.pops.speed = 0;
  }

  setCargoLevel(level: number, animate = true): void {
    const w = 1.02 + 0.03 * level;
    const l = 1.0 + 0.07 * level;
    const h = 0.5 + 0.085 * level;
    this.binDims = { w, l, h };
    const front = -0.12;
    const baseY = 0.58;
    // Pivot at the rear-bottom edge so the bin tips backward.
    this.binPivot.position.set(0, baseY, front - l);
    this.bin.position.set(0, 0, l / 2);
    const P = this.binParts;
    P.base.scale.set(w + 0.08, 1, l + 0.08);
    P.base.position.set(0, 0.0, 0);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (let k = 0; k < 4; k++) {
      const [sx, sz] = corners[k];
      P.posts[k].scale.set(1, h, 1);
      P.posts[k].position.set((sx * w) / 2, h / 2 + 0.02, (sz * l) / 2);
    }
    // Rims: front, back, left, right
    P.rims[0].scale.set(w, 1, 1);
    P.rims[0].position.set(0, h + 0.02, l / 2);
    P.rims[1].scale.set(w, 1, 1);
    P.rims[1].position.set(0, h + 0.02, -l / 2);
    P.rims[2].scale.set(l / 1, 1, 1);
    P.rims[2].rotation.y = Math.PI / 2;
    P.rims[2].position.set(-w / 2, h + 0.02, 0);
    P.rims[3].scale.set(l, 1, 1);
    P.rims[3].rotation.y = Math.PI / 2;
    P.rims[3].position.set(w / 2, h + 0.02, 0);
    // Glass walls
    P.walls[0].scale.set(w, h, 1);
    P.walls[0].position.set(0, h / 2 + 0.03, l / 2);
    P.walls[1].scale.set(w, h, 1);
    P.walls[1].position.set(0, h / 2 + 0.03, -l / 2);
    P.walls[2].scale.set(l, h, 1);
    P.walls[2].rotation.y = Math.PI / 2;
    P.walls[2].position.set(-w / 2, h / 2 + 0.03, 0);
    P.walls[3].scale.set(l, h, 1);
    P.walls[3].rotation.y = Math.PI / 2;
    P.walls[3].position.set(w / 2, h / 2 + 0.03, 0);
    this.buildSlots();
    if (animate) this.pops.cargo = 0;
  }

  private buildSlots(): void {
    const { w, l, h } = this.binDims;
    const cols = Math.max(3, Math.floor((w - 0.06) / 0.225));
    const rows = Math.max(3, Math.floor((l - 0.06) / 0.225));
    const layers = Math.max(3, Math.floor((h + 0.12) / 0.175));
    const px = (w - 0.1) / cols;
    const pz = (l - 0.1) / rows;
    const out: Slot[] = [];
    for (let y = 0; y < layers; y++) {
      const layer: Slot[] = [];
      // Top layer is a heap: skip edges for a rounded mound.
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (y === layers - 1 && (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) && cols > 2 && rows > 2) continue;
          const j = hash2(c + y * 7, r, 91);
          layer.push({
            x: (c - (cols - 1) / 2) * px + (hash2(c, r + y, 3) - 0.5) * 0.05,
            y: 0.15 + y * 0.165 + (j - 0.5) * 0.03,
            z: (r - (rows - 1) / 2) * pz + (hash2(r, c + y, 5) - 0.5) * 0.05,
            ry: (hash2(c, r, y + 11) - 0.5) * 0.9,
            rx: (hash2(r, y, c + 13) - 0.5) * 0.5,
            sx: hash2(c, y, r + 17) < 0.3 ? 1.55 : 1,
          });
        }
      }
      // Deterministic shuffle inside a layer so filling looks natural.
      layer.sort((a, b) => hash2(Math.round(a.x * 100), Math.round(a.z * 100), 23) - hash2(Math.round(b.x * 100), Math.round(b.z * 100), 23));
      out.push(...layer);
    }
    this.slots = out.slice(0, 160);
    const oldColors = this.slotColor;
    this.slotColor = this.slots.map((_, i) => oldColors[i] ?? this.randomChunkColor(i));
    this.slotPop = new Float32Array(this.slots.length).fill(1);
    const vis = this.visibleSlots;
    this.visibleSlots = 0;
    this.setFill(vis / Math.max(1, this.slotPop.length), false);
  }

  private randomChunkColor(i: number): THREE.Color {
    const idx = Math.floor(hash2(i, 5, 77) * 4);
    return this.art.blockColors[idx].clone();
  }

  /** Queue colours of landed pieces so the bin shows what was actually collected. */
  pushLandedColor(colorIndex: number): void {
    this.pendingColors.push(colorIndex);
    if (this.pendingColors.length > 32) this.pendingColors.shift();
  }

  get slotCount(): number {
    return this.slots.length;
  }

  /** Set visible fill from the ledger ratio (0..1). New chunks pop in. */
  setFill(ratio: number, animate = true): void {
    const target = Math.round(clamp(ratio, 0, 1) * this.slots.length);
    if (target === this.visibleSlots) return;
    if (target > this.visibleSlots) {
      for (let i = this.visibleSlots; i < target; i++) {
        const ci = this.pendingColors.shift();
        if (ci !== undefined) this.slotColor[i] = this.art.blockColors[ci].clone();
        this.slotPop[i] = animate ? 0 : 1;
      }
    }
    this.visibleSlots = target;
    this.cargoMesh.count = target;
    for (let i = 0; i < target; i++) {
      this.writeSlot(i);
      this.cargoMesh.setColorAt(i, _c.copy(this.slotColor[i]).multiplyScalar(0.98));
    }
    this.cargoMesh.instanceMatrix.needsUpdate = true;
    if (this.cargoMesh.instanceColor) this.cargoMesh.instanceColor.needsUpdate = true;
  }

  private writeSlot(i: number): void {
    const s = this.slots[i];
    const t = this.slotPop[i];
    // Landing: drop in from above with a short bounce (≈120 ms).
    const drop = t < 1 ? (1 - easeOutBack(t, 2.2)) * 0.18 : 0;
    const sc = t < 1 ? 0.7 + 0.3 * easeOutBack(t, 2.5) : 1;
    _p.set(s.x, s.y + drop, s.z);
    _e.set(s.rx, s.ry, 0);
    _q.setFromEuler(_e);
    _s.set(sc * s.sx, sc, sc);
    this.cargoMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
  }

  /** World position of the next fill slot (pickup flight target). */
  nextSlotWorld(out: THREE.Vector3, offset = 0): THREE.Vector3 {
    const i = clamp(this.visibleSlots + offset, 0, Math.max(0, this.slots.length - 1));
    const s = this.slots[i];
    if (!s) return this.bin.localToWorld(out.set(0, 0.4, 0));
    return this.bin.localToWorld(out.set(s.x, s.y + 0.05, s.z));
  }

  /** Top-centre of the bin (unload cascade source). */
  binMouthWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.bin.localToWorld(out.set((Math.random() - 0.5) * this.binDims.w * 0.6, this.binDims.h * 0.7, -this.binDims.l * 0.35));
  }

  intakeWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.body.localToWorld(out.set(0.5, 0.6, 0.9));
  }

  update(dt: number, sim: VehicleSim, alpha: number, feel: VehicleFeel): void {
    this.time += dt;
    // Interpolated pose between fixed steps.
    const x = lerp(sim.prevX, sim.x, alpha);
    const z = lerp(sim.prevZ, sim.z, alpha);
    let dh = sim.h - sim.prevH;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    const h = sim.prevH + dh * alpha;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = h;

    const speed = sim.speed;
    const accel = (speed - this.lastSpeed) / Math.max(dt, 1e-4);
    this.lastSpeed = speed;
    const rm = feel.reducedMotion ? 0.4 : 1;

    // Wheels follow the actual travelled distance.
    const wheelAngle = sim.odometer / VEHICLE.wheelRadius;
    for (const w of this.wheels) w.rotation.x = wheelAngle;

    // Drum: fast when chewing, idle when parked, winds down when full.
    const targetSpin = feel.full ? 0.6 : feel.contact ? 20 + feel.powerLevel * 2.5 : feel.powered ? 8 : sim.throttle > 0 ? 4 : 1.2;
    this.drumSpin += (targetSpin - this.drumSpin) * damp(feel.contact ? 10 : 3, dt);
    this.drumAngle += this.drumSpin * dt;
    this.drum.rotation.x = this.drumAngle;
    const vib = feel.contact ? (Math.sin(this.time * 90) * 0.012 + Math.sin(this.time * 57) * 0.008) * rm : 0;
    this.rollerGroup.position.y = VEHICLE.rollerRadius + vib;

    // Cab lean + suspension bob.
    const targetLean = clamp(-sim.yawRate * Math.abs(speed) * 0.018, -0.07, 0.07) * rm;
    const targetPitch = clamp(-accel * 0.004, -0.045, 0.045) * rm;
    this.lean += (targetLean - this.lean) * damp(10, dt);
    this.pitch += (targetPitch - this.pitch) * damp(8, dt);
    this.body.rotation.z = this.lean * 0.5;
    this.body.rotation.x = this.pitch * 0.5;
    this.cab.rotation.z = this.lean;
    this.cab.rotation.x = this.pitch;
    this.body.position.y = Math.sin(sim.odometer * 9) * 0.008 * rm + (feel.contact ? vib * 0.3 : 0);

    // Bin sway lags behind turns (visual only).
    const swayTarget = clamp(-sim.yawRate * 0.03, -0.08, 0.08) * rm;
    this.swayVel += ((swayTarget - this.sway) * 90 - this.swayVel * 12) * dt;
    this.sway += this.swayVel * dt;
    this.bin.rotation.z = this.sway;

    // Tip while unloading.
    const tipTarget = feel.unloading ? -0.42 : 0;
    this.tip += (tipTarget - this.tip) * damp(feel.unloading ? 7 : 5, dt);
    this.binPivot.rotation.x = this.tip;

    // Conveyor slats move while the drum is powered.
    this.slatPhase += dt * (feel.contact ? 1.6 : feel.powered ? 0.8 : 0.1);
    for (let k = 0; k < this.slats.length; k++) {
      const t = (this.slatPhase + k / this.slats.length) % 1;
      this.slats[k].position.z = 0.55 - t * 1.1;
    }

    // Beacon pulse.
    this.beaconMat.emissiveIntensity = 0.45 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 6));

    // Landing bounce animation of cargo chunks.
    let slotDirty = false;
    for (let i = 0; i < this.visibleSlots; i++) {
      if (this.slotPop[i] < 1) {
        this.slotPop[i] = Math.min(1, this.slotPop[i] + dt / 0.13);
        this.writeSlot(i);
        slotDirty = true;
      }
    }
    if (slotDirty) this.cargoMesh.instanceMatrix.needsUpdate = true;

    // Upgrade pops: quick elastic settle on the changed part.
    const pop = (t: number) => (t >= 1 ? 1 : 1 + Math.sin(t * Math.PI * 3) * (1 - t) * 0.22 * (feel.reducedMotion ? 0.3 : 1));
    this.pops.roller = Math.min(9, this.pops.roller + dt / 0.4);
    this.pops.power = Math.min(9, this.pops.power + dt / 0.4);
    this.pops.cargo = Math.min(9, this.pops.cargo + dt / 0.4);
    this.pops.speed = Math.min(9, this.pops.speed + dt / 0.4);
    const pr = pop(Math.min(this.pops.roller, this.pops.power));
    this.rollerGroup.scale.set(1, pr, pr);
    const pc = pop(this.pops.cargo);
    this.bin.scale.set(pc, pc, pc);
    const ps = pop(this.pops.speed);
    for (const w of this.wheels) w.scale.setScalar(ps);
  }

  /** World-space point on the drum front, for effects. */
  drumFrontWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.body.localToWorld(out.set(0, VEHICLE.rollerRadius, VEHICLE.rollerZ + 0.2));
  }
}
