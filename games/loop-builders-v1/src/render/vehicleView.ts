import * as THREE from 'three';
import { vehicleCapacity } from '../game/economy';
import type { MaterialKind } from '../game/types';
import { cbox, ccyl, mergeFlat } from './geom';
import { itemGeometry } from './items';
import { SHARED, VEHICLE_COLORS } from './palette';

/** Truk mainan: kabin + bak terbuka + roda. Warna & ukuran naik jelas per tingkat. */

const bodyCache = new Map<number, THREE.BufferGeometry>();
const bedCache = new Map<number, THREE.BufferGeometry>();
let axleGeo: THREE.BufferGeometry | null = null;

function shade(hex: string, l: number): string {
  return '#' + new THREE.Color(hex).offsetHSL(0, 0, l).getHexString();
}

function bodyGeometry(level: number): THREE.BufferGeometry {
  let g = bodyCache.get(level);
  if (g) return g;
  const c = VEHICLE_COLORS[(level - 1) % VEHICLE_COLORS.length];
  const parts = [
    cbox(1.0, 0.16, 0.56, '#39404d', 0, 0.26, 0, 0.05),
    cbox(0.38, 0.44, 0.58, c, 0.3, 0.56, 0, 0.1),
    cbox(0.3, 0.05, 0.5, shade(c, 0.12), 0.29, 0.8, 0, 0.02),
    cbox(0.04, 0.2, 0.46, '#c9ecff', 0.49, 0.62, 0, 0.02),
    cbox(0.2, 0.17, 0.02, '#c9ecff', 0.3, 0.63, 0.29, 0.01),
    cbox(0.2, 0.17, 0.02, '#c9ecff', 0.3, 0.63, -0.29, 0.01),
    cbox(0.05, 0.1, 0.6, '#e5e7eb', 0.52, 0.27, 0, 0.02),
    cbox(0.03, 0.08, 0.1, '#fff3b0', 0.5, 0.4, 0.19, 0.01),
    cbox(0.03, 0.08, 0.1, '#fff3b0', 0.5, 0.4, -0.19, 0.01),
  ];
  if (level >= 4) parts.push(cbox(0.1, 0.06, 0.34, '#ffd23f', 0.28, 0.86, 0, 0.02));
  g = mergeFlat(parts);
  bodyCache.set(level, g);
  return g;
}

/** Bak truk dengan pivot di engsel belakang (x=-0.5, y=0.34) supaya bisa "menjungkit" saat bongkar. */
function bedGeometry(level: number): THREE.BufferGeometry {
  let g = bedCache.get(level);
  if (g) return g;
  const c = VEHICLE_COLORS[(level - 1) % VEHICLE_COLORS.length];
  const dark = shade(c, -0.12);
  const parts = [
    cbox(0.62, 0.06, 0.58, dark, 0.3, 0.02, 0, 0.02),
    cbox(0.62, 0.2, 0.05, c, 0.3, 0.13, 0.265, 0.02),
    cbox(0.62, 0.2, 0.05, c, 0.3, 0.13, -0.265, 0.02),
    cbox(0.05, 0.2, 0.58, c, 0.02, 0.13, 0, 0.02),
    cbox(0.05, 0.26, 0.58, dark, 0.59, 0.16, 0, 0.02),
  ];
  if (level >= 3) {
    parts.push(cbox(0.5, 0.04, 0.02, '#ffffff', 0.3, 0.15, 0.292, 0.005));
    parts.push(cbox(0.5, 0.04, 0.02, '#ffffff', 0.3, 0.15, -0.292, 0.005));
  }
  g = mergeFlat(parts);
  bedCache.set(level, g);
  return g;
}

function axleGeometry(): THREE.BufferGeometry {
  if (!axleGeo) {
    axleGeo = mergeFlat([
      ccyl(0.14, 0.11, '#2b313c', 12, 0, 0, 0.28, Math.PI / 2, 0, 0, '#cfd5dd'),
      ccyl(0.14, 0.11, '#2b313c', 12, 0, 0, -0.28, Math.PI / 2, 0, 0, '#cfd5dd'),
    ]);
  }
  return axleGeo;
}

function easeOutBack(t: number): number {
  const c1 = 2.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function bedSlots(level: number): number {
  return level <= 1 ? 4 : level === 2 ? 6 : 8;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class VehicleView {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh;
  private readonly model = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly bedPivot = new THREE.Group();
  private readonly bed: THREE.Mesh;
  private readonly axles: THREE.Mesh[] = [];
  private readonly cargo: THREE.InstancedMesh;
  private readonly ring: THREE.Mesh;
  displayLevel: number;
  visualCargo = 0;
  private pendingCargo: { value: number; at: number }[] = [];
  private time = Math.random() * 10;
  private wheelSpin = 0;
  private spawnT = -1;
  private popT = -1;
  private dumpT = -1;
  private loadBump = 0;
  selected = false;
  mergeable = false;
  heading = 0;
  private headingInit = false;

  constructor(
    readonly id: number,
    level: number,
    readonly material: MaterialKind,
  ) {
    this.displayLevel = level;
    this.body = new THREE.Mesh(bodyGeometry(level), SHARED.vertexStd);
    this.body.castShadow = true;
    this.bed = new THREE.Mesh(bedGeometry(level), SHARED.vertexStd);
    this.bed.castShadow = true;
    this.bedPivot.position.set(-0.5, 0.34, 0);
    this.bedPivot.add(this.bed);
    for (const x of [0.3, -0.3]) {
      const a = new THREE.Mesh(axleGeometry(), SHARED.vertexStd);
      a.position.set(x, 0.14, 0);
      a.castShadow = true;
      this.axles.push(a);
      this.model.add(a);
    }
    this.cargo = new THREE.InstancedMesh(itemGeometry(material), SHARED.vertexStd, 8);
    this.cargo.count = 0;
    this.cargo.castShadow = true;
    this.cargo.frustumCulled = false;
    this.bedPivot.add(this.cargo);
    this.model.add(this.body, this.bedPivot);
    this.group.add(this.model);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.86, 36), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    this.ring.visible = false;
    this.group.add(this.ring);

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 1.3), SHARED.invisible);
    this.hit.position.y = 0.5;
    this.hit.userData = { type: 'vehicle', id };
    this.group.add(this.hit);
    this.applyScale();
  }

  private applyScale(): void {
    const s = 1 + 0.09 * (this.displayLevel - 1);
    this.model.scale.setScalar(s);
  }

  setDisplayLevel(level: number): void {
    if (level === this.displayLevel) return;
    this.displayLevel = level;
    this.body.geometry = bodyGeometry(level);
    this.bed.geometry = bedGeometry(level);
    this.applyScale();
  }

  spawn(): void {
    this.spawnT = 0;
  }

  pop(): void {
    this.popT = 0;
  }

  dump(): void {
    this.dumpT = 0;
  }

  /** Muatan visual mengikuti muatan logika setelah jeda (menunggu material terbang tiba). */
  queueCargo(value: number, delay: number): void {
    this.pendingCargo.push({ value, at: this.time + delay });
  }

  setCargoNow(value: number): void {
    this.pendingCargo = [];
    this.visualCargo = value;
  }

  /** Posisi bak (dunia) untuk tujuan material terbang. */
  bedWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(out.set(-0.2, 0.75, 0));
  }

  update(dt: number, pos: THREE.Vector3, heading: number, speed: number, boost: number): void {
    this.time += dt;
    this.group.position.copy(pos);
    if (!this.headingInit) {
      this.heading = heading;
      this.headingInit = true;
    }
    let dh = heading - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += dh * (1 - Math.exp(-dt * 14));
    this.group.rotation.y = this.heading;

    // roda & goyangan
    this.wheelSpin -= speed * dt * 7;
    for (const a of this.axles) a.rotation.z = this.wheelSpin;
    const bob = Math.abs(Math.sin(this.time * (10 + speed * 3))) * 0.025 * Math.min(1, speed);
    this.model.position.y = bob;
    this.model.rotation.z = (boost - 1) * 0.12; // hidung sedikit naik saat boost

    // muatan tertunda
    while (this.pendingCargo.length && this.pendingCargo[0].at <= this.time) {
      const v = this.pendingCargo.shift()!.value;
      if (v > this.visualCargo) this.loadBump = 1;
      this.visualCargo = v;
    }
    this.loadBump = Math.max(0, this.loadBump - dt * 5);

    // animasi spawn / pop merge
    let scale = 1;
    let lift = 0;
    if (this.spawnT >= 0) {
      this.spawnT += dt;
      const k = Math.min(1, this.spawnT / 0.55);
      scale = Math.max(0.01, easeOutBack(k));
      lift = (1 - k) * (1 - k) * 2.5;
      if (k >= 1) this.spawnT = -1;
    }
    if (this.popT >= 0) {
      this.popT += dt;
      const k = Math.min(1, this.popT / 0.5);
      scale *= 1 + Math.sin(k * Math.PI) * 0.35;
      lift += Math.sin(k * Math.PI) * 0.5;
      if (k >= 1) this.popT = -1;
    }
    const base = 1 + 0.09 * (this.displayLevel - 1);
    const lb = Math.sin(this.loadBump * Math.PI) * 0.08;
    this.model.scale.set(base * scale * (1 + lb * 0.5), base * scale * (1 - lb), base * scale * (1 + lb * 0.5));
    this.model.position.y += lift;

    // jungkit bak saat bongkar
    if (this.dumpT >= 0) {
      this.dumpT += dt;
      const k = Math.min(1, this.dumpT / 0.45);
      this.bedPivot.rotation.z = Math.sin(k * Math.PI) * 0.55;
      if (k >= 1) this.dumpT = -1;
    }

    // isi bak
    const cap = vehicleCapacity(this.displayLevel);
    const slots = bedSlots(this.displayLevel);
    const vis = this.visualCargo <= 0 ? 0 : Math.max(1, Math.min(slots, Math.round((this.visualCargo / cap) * slots)));
    for (let i = 0; i < vis; i++) {
      const layer = Math.floor(i / 2);
      const side = i % 2 === 0 ? 1 : -1;
      _p.set(0.3, 0.14 + layer * (this.material === 'wood' ? 0.19 : 0.165), side * 0.12);
      _q.identity();
      _s.setScalar(this.material === 'wood' ? 1 : 1.2);
      _m.compose(_p, _q, _s);
      this.cargo.setMatrixAt(i, _m);
    }
    this.cargo.count = vis;
    this.cargo.instanceMatrix.needsUpdate = true;

    this.ring.visible = this.selected || this.mergeable;
    if (this.ring.visible) {
      const mat = this.ring.material as THREE.MeshBasicMaterial;
      mat.color.set(this.selected ? '#ffffff' : '#ffe066');
      mat.opacity = 0.6 + Math.sin(this.time * 8) * 0.3;
      const rs = 1 + 0.09 * (this.displayLevel - 1);
      this.ring.scale.setScalar(rs * (this.selected ? 1 : 0.9 + Math.sin(this.time * 8) * 0.05));
    }
  }

  dispose(): void {
    this.cargo.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    this.hit.geometry.dispose();
  }
}
