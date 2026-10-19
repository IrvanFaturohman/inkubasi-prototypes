import * as THREE from 'three';
import type { MaterialKind } from '../game/types';
import { cbox, ccyl, mergeFlat, place } from './geom';
import { ITEM_SIZE, itemGeometry } from './items';
import { SHARED } from './palette';

const MAX_STACK = 18;
const MAX_BELT = 14;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

function beltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3b4250';
  g.fillRect(0, 0, 64, 32);
  g.strokeStyle = '#5d6678';
  g.lineWidth = 5;
  for (const x of [10, 42]) {
    g.beginPath();
    g.moveTo(x, 4);
    g.lineTo(x + 12, 16);
    g.lineTo(x, 28);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

let sharedBelt: THREE.CanvasTexture | null = null;

function easeOutBack(t: number): number {
  const c1 = 1.7;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Posisi satu jalur mesin: mesin → conveyor → penyimpanan (dunia, x/z). */
export interface MachineLineDef {
  machine: [number, number];
  storage: [number, number];
}

export interface StationViewOptions {
  /** Penyimpanan dipakai bersama (digambar terpisah oleh depot): lewati palet & tumpukan. */
  sharedStorage?: boolean;
  /** Skala keseluruhan jalur mesin. */
  scale?: number;
}

export interface StationVisualState {
  unlocked: boolean;
  built: boolean;
  level: number;
  storage: number;
  capacity: number;
  conveyor: readonly number[];
  full: boolean;
  rate: number;
}

export class StationView {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh;
  private readonly D: number;
  private readonly pad: THREE.Mesh;
  private readonly placeholder = new THREE.Group();
  private readonly machine = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly spinner: THREE.Mesh;
  private readonly press: THREE.Mesh | null = null;
  private readonly lampMat = new THREE.MeshBasicMaterial({ color: '#3ee07a' });
  private readonly conveyorG = new THREE.Group();
  private readonly beltMat: THREE.MeshStandardMaterial;
  private readonly beltItems: THREE.InstancedMesh;
  private readonly storageG = new THREE.Group();
  private readonly stack: THREE.InstancedMesh;
  private readonly chimneyTop = new THREE.Vector3();
  private builtShown = false;
  private buildAnim = -1;
  private squash = 0;
  private stackBump = 0;
  private upgradeAnim = 0;
  private spin = 0;
  private spinSpeed = 0;
  private pressT = 0;
  private time = 0;
  private selected = false;
  private readonly selRing: THREE.Mesh;

  constructor(
    readonly slot: number,
    readonly def: MachineLineDef,
    readonly material: MaterialKind,
    readonly opts: StationViewOptions = {},
  ) {
    const [mx, mz] = def.machine;
    const [sx, sz] = def.storage;
    const scale = opts.scale ?? 1;
    this.D = Math.hypot(sx - mx, sz - mz) / scale;
    this.group.position.set(mx, 0, mz);
    this.group.rotation.y = Math.atan2(-(sz - mz), sx - mx);
    this.group.scale.setScalar(scale);
    const D = this.D;

    // Alas slot (selalu terlihat saat slot terbuka)
    this.pad = new THREE.Mesh(opts.sharedStorage ? cbox(1.6, 0.06, 1.6, '#e3dccd', 0, 0.03, 0, 0.05) : cbox(D + 1.7, 0.06, 1.75, '#ece5d6', D / 2, 0.03, 0, 0.03), SHARED.vertexStd);
    this.pad.receiveShadow = true;
    this.group.add(this.pad);

    // Placeholder slot kosong: garis putus-putus + papan "+"
    const dashes: THREE.BufferGeometry[] = [];
    const W = opts.sharedStorage ? 1.4 : D + 1.5;
    const H = opts.sharedStorage ? 1.4 : 1.55;
    const cx0 = opts.sharedStorage ? 0 : D / 2;
    for (let x = -W / 2; x < W / 2; x += 0.34) dashes.push(cbox(0.2, 0.03, 0.06, '#ffffff', cx0 + x + 0.1, 0.075, H / 2, 0.01), cbox(0.2, 0.03, 0.06, '#ffffff', cx0 + x + 0.1, 0.075, -H / 2, 0.01));
    for (let z = -H / 2; z < H / 2; z += 0.34) dashes.push(cbox(0.06, 0.03, 0.2, '#ffffff', cx0 - W / 2, 0.075, z + 0.1, 0.01), cbox(0.06, 0.03, 0.2, '#ffffff', cx0 + W / 2, 0.075, z + 0.1, 0.01));
    dashes.push(ccyl(0.05, 0.9, '#9a6a3c', 8, cx0, 0.45, 0), cbox(0.62, 0.5, 0.08, '#ffffff', cx0, 0.95, 0, 0.06), cbox(0.34, 0.08, 0.1, '#29b36a', cx0, 0.95, 0, 0.02), cbox(0.08, 0.34, 0.1, '#29b36a', cx0, 0.95, 0, 0.02));
    const ph = new THREE.Mesh(mergeFlat(dashes), SHARED.vertexStd);
    ph.castShadow = true;
    this.placeholder.add(ph);
    this.group.add(this.placeholder);

    // ---- Mesin ----
    const isWood = material === 'wood';
    const bodyColor = isWood ? '#2cb39a' : '#4b7be0';
    const trim = '#ffd23f';
    const parts: THREE.BufferGeometry[] = [
      cbox(1.3, 0.22, 1.25, '#5b6474', 0, 0.11, 0, 0.05),
      cbox(1.15, 0.95, 1.1, bodyColor, 0, 0.7, 0, 0.1),
      cbox(1.2, 0.12, 1.15, trim, 0, 1.2, 0, 0.04),
      cbox(0.5, 0.32, 0.06, '#e8f6ff', 0.2, 0.75, 0.56, 0.03),
      cbox(0.5, 0.32, 0.06, '#e8f6ff', 0.2, 0.75, -0.56, 0.03),
      ccyl(0.12, 0.55, '#6b7280', 10, -0.38, 1.5, -0.3),
      ccyl(0.15, 0.08, '#4b5563', 10, -0.38, 1.8, -0.3),
    ];
    if (isWood) {
      // corong kayu di atas dengan dua batang
      parts.push(cbox(0.6, 0.18, 0.8, '#1f8f7b', -0.1, 1.35, 0.1, 0.04));
      parts.push(place(ccyl(0.11, 0.75, '#b8743f', 9, 0, 0, 0, 0, 0, 0, '#f3d39c'), -0.1, 1.53, 0.1, Math.PI / 2, 0, 0));
      parts.push(place(ccyl(0.11, 0.75, '#a8652f', 9, 0, 0, 0, 0, 0, 0, '#f3d39c'), -0.1, 1.53, -0.14, Math.PI / 2, 0, 0.2));
    } else {
      parts.push(cbox(0.55, 0.2, 0.55, '#e0643f', -0.15, 1.36, 0.15, 0.08));
    }
    const bodyGeo = mergeFlat(parts);
    const bodyMesh = new THREE.Mesh(bodyGeo, SHARED.vertexStd);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.body.add(bodyMesh);
    if (!isWood) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e0643f', roughness: 0.7 }));
      dome.position.set(-0.15, 1.46, 0.15);
      dome.castShadow = true;
      this.body.add(dome);
    }
    // lampu status
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.lampMat);
    lamp.position.set(-0.45, 1.34, 0.42);
    this.body.add(lamp);
    this.chimneyTop.set(-0.38, 1.9, -0.3);

    // Pemutar: gergaji (kayu) atau roda pres (bata)
    if (isWood) {
      const blade: THREE.BufferGeometry[] = [ccyl(0.36, 0.04, '#dfe6ee', 20, 0, 0, 0, Math.PI / 2, 0, 0), ccyl(0.1, 0.07, '#f25a4a', 10, 0, 0, 0, Math.PI / 2, 0, 0)];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        blade.push(place(cbox(0.1, 0.08, 0.04, '#c8d0da', 0, 0, 0, 0.005), Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0, 0, 0, a + 0.5));
      }
      this.spinner = new THREE.Mesh(mergeFlat(blade), SHARED.vertexStd);
      this.spinner.position.set(0.5, 1.12, 0);
      this.spinner.castShadow = true;
    } else {
      const wheel: THREE.BufferGeometry[] = [ccyl(0.3, 0.08, '#ffd23f', 12, 0, 0, 0, Math.PI / 2, 0, 0)];
      for (let i = 0; i < 4; i++) wheel.push(place(cbox(0.56, 0.06, 0.1, '#4b5563', 0, 0, 0, 0.01), 0, 0, 0, 0, 0, (i * Math.PI) / 4));
      this.spinner = new THREE.Mesh(mergeFlat(wheel), SHARED.vertexStd);
      this.spinner.position.set(-0.2, 1.1, 0.62);
      const press = new THREE.Mesh(mergeFlat([cbox(0.34, 0.3, 0.4, '#9ca3af', 0, 0, 0, 0.04), ccyl(0.05, 0.4, '#6b7280', 8, 0, 0.3, 0)]), SHARED.vertexStd);
      press.position.set(0.52, 0.95, 0);
      press.castShadow = true;
      this.press = press;
      this.body.add(press);
    }
    this.body.add(this.spinner);
    this.machine.add(this.body);
    this.group.add(this.machine);

    // ---- Conveyor ----
    const c0 = 0.62;
    const c1 = D - 0.58;
    const cl = c1 - c0;
    const cm = (c0 + c1) / 2;
    const frame = new THREE.Mesh(
      mergeFlat([
        cbox(cl, 0.2, 0.62, '#6b7280', cm, 0.34, 0, 0.04),
        cbox(cl, 0.08, 0.06, '#ffd23f', cm, 0.5, 0.31, 0.02),
        cbox(cl, 0.08, 0.06, '#ffd23f', cm, 0.5, -0.31, 0.02),
        ccyl(0.12, 0.6, '#9ca3af', 12, c0 + 0.05, 0.42, 0, Math.PI / 2, 0, 0),
        ccyl(0.12, 0.6, '#9ca3af', 12, c1 - 0.05, 0.42, 0, Math.PI / 2, 0, 0),
        cbox(0.1, 0.26, 0.5, '#4b5563', c0 + 0.2, 0.13, 0, 0.02),
        cbox(0.1, 0.26, 0.5, '#4b5563', c1 - 0.2, 0.13, 0, 0.02),
      ]),
      SHARED.vertexStd,
    );
    frame.castShadow = true;
    frame.receiveShadow = true;
    if (!sharedBelt) sharedBelt = beltTexture();
    const tex = sharedBelt.clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(cl / 0.5)), 1);
    this.beltMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    const belt = new THREE.Mesh(new THREE.PlaneGeometry(cl, 0.5), this.beltMat);
    belt.rotation.x = -Math.PI / 2;
    belt.position.set(cm, 0.451, 0);
    belt.receiveShadow = true;
    this.beltItems = new THREE.InstancedMesh(itemGeometry(material), SHARED.vertexStd, MAX_BELT);
    this.beltItems.castShadow = true;
    this.beltItems.count = 0;
    this.beltItems.frustumCulled = false;
    this.conveyorG.add(frame, belt, this.beltItems);
    this.conveyorG.userData = { c0, c1 };
    this.group.add(this.conveyorG);

    // ---- Penyimpanan ----
    const pallet: THREE.BufferGeometry[] = [cbox(1.12, 0.08, 1.12, '#c9955b', D, 0.1, 0, 0.02)];
    for (const z of [-0.45, 0, 0.45]) pallet.push(cbox(1.1, 0.08, 0.18, '#b98246', D, 0.2, z, 0.02));
    for (const [px, pz] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ]) {
      pallet.push(cbox(0.1, 0.62, 0.1, '#a8703c', D + px, 0.52, pz, 0.02));
    }
    pallet.push(cbox(0.1, 0.1, 1.1, '#c9955b', D + 0.5, 0.8, 0, 0.02));
    const palletMesh = new THREE.Mesh(mergeFlat(pallet), SHARED.vertexStd);
    palletMesh.castShadow = true;
    palletMesh.receiveShadow = true;
    this.stack = new THREE.InstancedMesh(itemGeometry(material), SHARED.vertexStd, MAX_STACK);
    this.stack.castShadow = true;
    this.stack.count = 0;
    this.stack.frustumCulled = false;
    this.storageG.add(palletMesh, this.stack);
    if (!opts.sharedStorage) this.group.add(this.storageG);

    // Cincin seleksi
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.22, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }));
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.position.set(opts.sharedStorage ? 0 : D / 2, 0.08, 0);
    this.selRing.scale.set(opts.sharedStorage ? 0.75 : (D + 1.6) / 2, 0.75, 1);
    this.selRing.visible = false;
    this.group.add(this.selRing);

    // Area sentuh (tak terlihat) — dibuat besar agar mudah diketuk di ponsel.
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(opts.sharedStorage ? 1.6 : D + 1.9, 2.0, opts.sharedStorage ? 1.6 : 1.9), SHARED.invisible);
    this.hit.position.set(opts.sharedStorage ? 0 : D / 2, 1, 0);
    this.hit.userData = { type: 'station', slot };
    this.group.add(this.hit);

    this.machine.visible = false;
    this.conveyorG.visible = false;
    this.storageG.visible = false;
  }

  // ---- Titik dunia untuk efek & label ----
  storageTop(out: THREE.Vector3, level = 0.6): THREE.Vector3 {
    return this.group.localToWorld(out.set(this.D, level, 0));
  }
  labelAnchor(out: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(out.set(this.D, 1.25, 0));
  }
  padCenter(out: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(out.set(this.opts.sharedStorage ? 0 : this.D / 2, 1.3, 0));
  }
  chimneyWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(out.copy(this.chimneyTop));
  }
  outputWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.group.localToWorld(out.set(0.7, 0.6, 0));
  }

  setSelected(on: boolean): void {
    this.selected = on;
  }

  onProduced(): void {
    this.squash = 1;
    this.pressT = 1;
  }

  onStored(): void {
    this.stackBump = 1;
  }

  onBuilt(): void {
    this.buildAnim = 0;
  }

  onUpgrade(): void {
    this.upgradeAnim = 1;
  }

  update(dt: number, s: StationVisualState): void {
    this.time += dt;
    this.group.visible = s.unlocked;
    if (!s.unlocked) return;
    const built = s.built;
    if (built !== this.builtShown) {
      this.builtShown = built;
      this.machine.visible = this.conveyorG.visible = this.storageG.visible = built;
      this.placeholder.visible = !built;
    }
    this.selRing.visible = this.selected;
    if (this.selected) (this.selRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(this.time * 6);
    if (!built) {
      this.placeholder.position.y = Math.sin(this.time * 3) * 0.03;
      return;
    }

    // Animasi bangun: potongan muncul berurutan
    if (this.buildAnim >= 0) {
      this.buildAnim += dt;
      const parts = [this.storageG, this.conveyorG, this.machine];
      parts.forEach((p, i) => {
        const k = Math.max(0, Math.min(1, (this.buildAnim - i * 0.12) / 0.45));
        p.scale.setScalar(Math.max(0.001, easeOutBack(k)));
      });
      if (this.buildAnim > 0.9) {
        this.buildAnim = -1;
        parts.forEach((p) => p.scale.setScalar(1));
      }
    }

    // Mesin: ritme produksi, berhenti saat penuh
    const running = !s.full;
    this.lampMat.color.set(s.full ? '#ff4d4d' : '#3ee07a');
    const targetSpin = running ? 5 + s.rate * 3 : 0;
    this.spinSpeed += (targetSpin - this.spinSpeed) * (1 - Math.exp(-dt * (running ? 6 : 2.5)));
    this.spin += this.spinSpeed * dt;
    this.spinner.rotation.z = -this.spin;
    this.squash = Math.max(0, this.squash - dt * 5);
    this.upgradeAnim = Math.max(0, this.upgradeAnim - dt * 2);
    const sq = Math.sin(this.squash * Math.PI) * 0.08 + Math.sin(this.upgradeAnim * Math.PI * 2) * this.upgradeAnim * 0.12;
    const idle = running ? Math.sin(this.time * 14) * 0.006 : 0;
    this.body.scale.set(1 + sq * 0.5, 1 - sq + idle, 1 + sq * 0.5);
    if (this.press) {
      this.pressT = Math.max(0, this.pressT - dt * 4);
      this.press.position.y = 0.95 + (1 - Math.sin(this.pressT * Math.PI)) * 0.25 - 0.1;
    }

    // Conveyor: tekstur bergerak selama ada item/produksi, item di posisi progres sebenarnya
    const moving = s.conveyor.length > 0 || running;
    if (moving && this.beltMat.map) this.beltMat.map.offset.x -= dt * 1.1;
    const { c0, c1 } = this.conveyorG.userData as { c0: number; c1: number };
    const n = Math.min(MAX_BELT, s.conveyor.length);
    for (let i = 0; i < n; i++) {
      const prog = s.conveyor[i];
      const x = c0 + 0.1 + (c1 - c0 - 0.2) * prog;
      const pop = prog < 0.08 ? 0.5 + (prog / 0.08) * 0.5 : 1;
      _p.set(x, 0.56, 0);
      _e.set(0, Math.PI / 2, 0);
      _q.setFromEuler(_e);
      _s.set(pop, pop * (prog < 0.08 ? 1.3 - prog * 3 : 1), pop);
      _m.compose(_p, _q, _s);
      this.beltItems.setMatrixAt(i, _m);
    }
    this.beltItems.count = n;
    this.beltItems.instanceMatrix.needsUpdate = true;

    // Tumpukan stok (jumlah model dibatasi, angka tetap akurat di label)
    const visCap = Math.min(MAX_STACK, s.capacity);
    const vis = s.storage <= 0 ? 0 : s.capacity <= MAX_STACK ? s.storage : Math.max(1, Math.round((s.storage / s.capacity) * visCap));
    const size = ITEM_SIZE[this.material];
    const colSp = size.w + 0.08;
    const rowSp = size.l + 0.05;
    const laySp = size.h + 0.01;
    this.stackBump = Math.max(0, this.stackBump - dt * 6);
    for (let i = 0; i < vis; i++) {
      const layer = Math.floor(i / 6);
      const inLayer = i % 6;
      const col = inLayer % 3;
      const row = Math.floor(inLayer / 3);
      _p.set(this.D + (col - 1) * colSp, 0.34 + layer * laySp, (row - 0.5) * rowSp);
      _e.set(0, Math.PI / 2 + (layer % 2) * 0.05, 0);
      _q.setFromEuler(_e);
      const bump = i === vis - 1 ? 1 + this.stackBump * 0.35 : 1;
      _s.setScalar(bump);
      _m.compose(_p, _q, _s);
      this.stack.setMatrixAt(i, _m);
    }
    this.stack.count = vis;
    this.stack.instanceMatrix.needsUpdate = true;
  }
}
