import * as THREE from 'three';
import type { MaterialKind, Vec2 } from '../game/types';
import { cbox, ccyl, mergeFlat } from './geom';
import { ITEM_SIZE, itemGeometry } from './items';
import { SHARED } from './palette';
import { StationView } from './stationView';

/** Posisi mesin di keempat sudut dalam plaza (urutan pembelian: belakang dulu agar tidak menutupi). */
export const MACHINE_SPOTS: [number, number][] = [
  [1.3, -1.3],
  [-1.3, -1.3],
  [1.3, 1.3],
  [-1.3, 1.3],
];
const MAX_STACK = 24;

export interface DepotVisualState {
  machines: number;
  storage: number;
  capacity: number;
  lines: readonly (readonly number[])[];
  full: boolean;
  rate: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * Pabrik pusat: plaza, penyimpanan bersama di tengah (tumpukan material), hingga 4 jalur
 * mesin + conveyor yang mengalir ke tengah, dan penanda teluk muat di keempat sisi jalan.
 */
export class DepotView {
  readonly group = new THREE.Group();
  readonly lines: StationView[] = [];
  readonly hit: THREE.Mesh;
  private readonly stack: THREE.InstancedMesh;
  private readonly bays: THREE.Group[] = [];
  private stackBump = 0;
  private bayPulse = [0, 0, 0, 0];
  private time = 0;

  constructor(
    readonly material: MaterialKind,
    plazaHalf: number,
    plazaColor: string,
    bays: { pos: Vec2; heading: number }[],
    bayTexture: THREE.Texture,
  ) {
    const plaza = new THREE.Mesh(cbox(plazaHalf * 2, 0.05, plazaHalf * 2, plazaColor, 0, 0.025, 0, 0.3), SHARED.vertexStd);
    plaza.receiveShadow = true;
    this.group.add(plaza);

    // Penyimpanan pusat: palet besar + tiang sudut + papan nama
    const pallet: THREE.BufferGeometry[] = [cbox(1.5, 0.1, 1.5, '#c9955b', 0, 0.1, 0, 0.03)];
    for (const z of [-0.55, 0, 0.55]) pallet.push(cbox(1.46, 0.08, 0.22, '#b98246', 0, 0.2, z, 0.02));
    for (const [px, pz] of [
      [-0.7, -0.7],
      [0.7, -0.7],
      [-0.7, 0.7],
      [0.7, 0.7],
    ]) {
      pallet.push(cbox(0.1, 0.7, 0.1, '#a8703c', px, 0.5, pz, 0.02));
    }
    pallet.push(ccyl(0.04, 1.3, '#6b7280', 8, 0.72, 0.65, -0.72), cbox(0.7, 0.3, 0.06, '#ffd23f', 0.5, 1.25, -0.72, 0.04));
    const pm = new THREE.Mesh(mergeFlat(pallet), SHARED.vertexStd);
    pm.castShadow = true;
    pm.receiveShadow = true;
    this.group.add(pm);
    this.stack = new THREE.InstancedMesh(itemGeometry(material), SHARED.vertexStd, MAX_STACK);
    this.stack.count = 0;
    this.stack.castShadow = true;
    this.stack.frustumCulled = false;
    this.group.add(this.stack);

    MACHINE_SPOTS.forEach((spot, i) => {
      const sv = new StationView(i, { machine: spot, storage: [0, 0] }, material, { sharedStorage: true, scale: 0.72 });
      this.lines.push(sv);
      this.group.add(sv.group);
    });

    // Teluk muat: cat kuning bergaris + tiang lampu kecil di tepi jalan.
    const bayMat = new THREE.MeshBasicMaterial({ map: bayTexture, transparent: true });
    for (const b of bays) {
      const g = new THREE.Group();
      g.position.set(b.pos.x, 0.021, b.pos.z);
      g.rotation.y = b.heading;
      const paint = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.2), bayMat);
      paint.rotation.x = -Math.PI / 2;
      g.add(paint);
      this.bays.push(g);
      this.group.add(g);
    }

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(plazaHalf * 2, 1.8, plazaHalf * 2), SHARED.invisible);
    this.hit.position.y = 0.9;
    this.hit.userData = { type: 'depot' };
    this.group.add(this.hit);
  }

  storageTop(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0.7, 0);
  }

  labelAnchor(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1.55, 0);
  }

  onStored(): void {
    this.stackBump = 1;
  }

  pulseBay(i: number): void {
    this.bayPulse[i] = 1;
  }

  update(dt: number, s: DepotVisualState): void {
    this.time += dt;
    this.lines.forEach((sv, i) => {
      // Mesin terpasang; slot berikutnya tampil sebagai tempat kosong (ajakan membeli).
      const built = i < s.machines;
      const visible = built || i === s.machines;
      sv.update(dt, { unlocked: visible, built, level: 1, storage: 0, capacity: s.capacity, conveyor: s.lines[i] ?? [], full: s.full, rate: s.rate / Math.max(1, s.machines) });
    });

    const size = ITEM_SIZE[this.material];
    const vis = s.storage <= 0 ? 0 : s.capacity <= MAX_STACK ? s.storage : Math.max(1, Math.round((s.storage / s.capacity) * MAX_STACK));
    this.stackBump = Math.max(0, this.stackBump - dt * 6);
    for (let i = 0; i < vis; i++) {
      const layer = Math.floor(i / 12);
      const inLayer = i % 12;
      const col = inLayer % 4;
      const row = Math.floor(inLayer / 4);
      _p.set((col - 1.5) * (size.w + 0.1), 0.35 + layer * (size.h + 0.01), (row - 1) * (size.l + 0.04));
      _e.set(0, Math.PI / 2 + (layer % 2) * 0.04, 0);
      _q.setFromEuler(_e);
      _s.setScalar(i === vis - 1 ? 1 + this.stackBump * 0.35 : 1);
      _m.compose(_p, _q, _s);
      this.stack.setMatrixAt(i, _m);
    }
    this.stack.count = vis;
    this.stack.instanceMatrix.needsUpdate = true;

    this.bays.forEach((b, i) => {
      this.bayPulse[i] = Math.max(0, this.bayPulse[i] - dt * 3);
      const k = 1 + Math.sin(this.bayPulse[i] * Math.PI) * 0.12;
      b.scale.set(k, 1, k);
    });
  }
}
