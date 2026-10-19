import * as THREE from 'three';
import { cbox, ccyl, colored, mergeFlat, place } from './geom';
import { itemGeometry, type ItemKind } from './items';
import { SHARED } from './palette';

/** Warna bak gerbong per tingkat (Lv1..Lv8). */
export const WAGON_COLORS = ['#7ccf4a', '#3db8f5', '#9b6bff', '#ff8a3d', '#ff5a8a', '#18c79a', '#ffc93c', '#e8eef5'];

let locoGeo: THREE.BufferGeometry | null = null;
const wagonGeo = new Map<number, THREE.BufferGeometry>();
let wheelGeo: THREE.BufferGeometry | null = null;
let sawGeo: THREE.BufferGeometry | null = null;

function locomotive(): THREE.BufferGeometry {
  if (!locoGeo) {
    const red = '#e0463a';
    const dark = '#3a3f4b';
    locoGeo = mergeFlat([
      cbox(1.0, 0.16, 0.6, dark, 0, 0.24, 0, 0.04),
      ccyl(0.24, 0.62, red, 14, 0.18, 0.52, 0, 0, 0, Math.PI / 2, '#b8322a'),
      ccyl(0.26, 0.06, '#ffd23f', 14, -0.05, 0.52, 0, 0, 0, Math.PI / 2),
      ccyl(0.26, 0.06, '#ffd23f', 14, 0.4, 0.52, 0, 0, 0, Math.PI / 2),
      cbox(0.36, 0.5, 0.6, red, -0.3, 0.58, 0, 0.06),
      cbox(0.44, 0.07, 0.68, dark, -0.3, 0.86, 0, 0.03),
      cbox(0.03, 0.18, 0.4, '#bfe6ff', -0.12, 0.64, 0, 0.01),
      ccyl(0.08, 0.28, dark, 10, 0.34, 0.86, 0),
      ccyl(0.13, 0.08, dark, 10, 0.34, 1.02, 0),
      ccyl(0.07, 0.04, '#fff3b0', 10, 0.5, 0.56, 0, 0, 0, Math.PI / 2),
      place(colored(new THREE.ConeGeometry(0.26, 0.22, 4), '#ffd23f'), 0.55, 0.22, 0, 0, Math.PI / 4, -Math.PI / 2),
    ]);
  }
  return locoGeo;
}

function wagon(level: number): THREE.BufferGeometry {
  let g = wagonGeo.get(level);
  if (!g) {
    const c = WAGON_COLORS[(level - 1) % WAGON_COLORS.length];
    const dark = '#3a3f4b';
    g = mergeFlat([
      cbox(0.86, 0.14, 0.56, dark, 0, 0.24, 0, 0.04),
      cbox(0.8, 0.06, 0.54, shade(c, -0.12), 0, 0.34, 0, 0.02),
      cbox(0.8, 0.26, 0.05, c, 0, 0.48, 0.26, 0.02),
      cbox(0.8, 0.26, 0.05, c, 0, 0.48, -0.26, 0.02),
      cbox(0.05, 0.26, 0.54, c, 0.39, 0.48, 0, 0.02),
      cbox(0.05, 0.26, 0.54, c, -0.39, 0.48, 0, 0.02),
      // dudukan gergaji di kedua sisi
      cbox(0.14, 0.12, 0.2, '#6b7280', 0, 0.36, 0.36, 0.02),
      cbox(0.14, 0.12, 0.2, '#6b7280', 0, 0.36, -0.36, 0.02),
    ]);
    wagonGeo.set(level, g);
  }
  return g;
}

function wheels(): THREE.BufferGeometry {
  if (!wheelGeo) {
    wheelGeo = mergeFlat([ccyl(0.12, 0.08, '#2b313c', 12, 0, 0, 0.27, Math.PI / 2, 0, 0, '#9aa1ab'), ccyl(0.12, 0.08, '#2b313c', 12, 0, 0, -0.27, Math.PI / 2, 0, 0, '#9aa1ab')]);
  }
  return wheelGeo;
}

/** Piringan gergaji bergerigi (sumbu z = menghadap ke samping). */
function saw(): THREE.BufferGeometry {
  if (!sawGeo) {
    const parts = [ccyl(0.3, 0.035, '#dfe6ee', 20, 0, 0, 0, Math.PI / 2, 0, 0), ccyl(0.08, 0.06, '#f25a4a', 10, 0, 0, 0, Math.PI / 2, 0, 0)];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      parts.push(place(cbox(0.1, 0.06, 0.03, '#c8d0da', 0, 0, 0, 0.004), Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0, 0, 0, a + 0.6));
    }
    sawGeo = mergeFlat(parts);
  }
  return sawGeo;
}

function shade(hex: string, l: number): string {
  return '#' + new THREE.Color(hex).offsetHSL(0, 0, l).getHexString();
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Satu gerbong (atau lokomotif) yang diposisikan di rel oleh TrainView. */
class Car {
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly axles: THREE.Mesh[] = [];
  readonly saws: THREE.Mesh[] = [];
  readonly cargo: THREE.InstancedMesh | null = null;
  heading = 0;
  headingInit = false;
  bump = 0;

  constructor(geo: THREE.BufferGeometry, isWagon: boolean, cargoKind: ItemKind) {
    this.body = new THREE.Mesh(geo, SHARED.vertexStd);
    this.body.castShadow = true;
    this.group.add(this.body);
    for (const x of isWagon ? [0.28, -0.28] : [0.3, 0, -0.3]) {
      const a = new THREE.Mesh(wheels(), SHARED.vertexStd);
      a.position.set(x, 0.13, 0);
      this.axles.push(a);
      this.group.add(a);
    }
    if (isWagon) {
      for (const z of [0.46, -0.46]) {
        const s = new THREE.Mesh(saw(), SHARED.vertexStd);
        s.position.set(0, 0.36, z);
        s.castShadow = true;
        this.saws.push(s);
        this.group.add(s);
      }
      const cargo = new THREE.InstancedMesh(itemGeometry(cargoKind), SHARED.vertexStd, 6);
      cargo.count = 0;
      cargo.frustumCulled = false;
      this.cargo = cargo;
      this.group.add(cargo);
    }
  }
}

/**
 * Kereta: lokomotif + gerbong gergaji. Posisi tiap mobil dihitung dari jarak lintasan
 * (dari simulasi) sehingga seluruh rangkaian mengikuti tikungan dengan benar.
 */
export class TrainView {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh;
  private readonly loco: Car;
  private wagons: Car[] = [];
  private levels: number[] = [];
  private wheelSpin = 0;
  private sawSpin = 0;
  private sawSpeed = 0;
  private time = 0;
  popIndex = -1;
  private popT = 0;

  constructor(private readonly cargoKind: ItemKind) {
    this.loco = new Car(locomotive(), false, cargoKind);
    this.group.add(this.loco.group);
    this.hit = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), SHARED.invisible);
    this.hit.userData = { type: 'train' };
    this.loco.group.add(this.hit);
  }

  /** Samakan jumlah & tingkat gerbong dengan state. */
  setWagons(levels: number[]): void {
    const same = levels.length === this.levels.length && levels.every((l, i) => l === this.levels[i]);
    if (same) return;
    while (this.wagons.length < levels.length) {
      const car = new Car(wagon(1), true, this.cargoKind);
      this.wagons.push(car);
      this.group.add(car.group);
    }
    while (this.wagons.length > levels.length) {
      const car = this.wagons.pop()!;
      this.group.remove(car.group);
    }
    levels.forEach((l, i) => {
      this.wagons[i].body.geometry = wagon(l);
      const s = 1 + 0.06 * (l - 1);
      this.wagons[i].group.scale.setScalar(s);
    });
    this.levels = [...levels];
  }

  /** Posisi dunia lokomotif (untuk kamera & label). */
  locoPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.loco.group.position);
  }

  wagonPosition(i: number, out: THREE.Vector3): THREE.Vector3 {
    const car = this.wagons[Math.max(0, Math.min(this.wagons.length - 1, i))] ?? this.loco;
    return out.copy(car.group.position).setY(0.6);
  }

  get wagonCount(): number {
    return this.wagons.length;
  }

  bumpWagon(i: number): void {
    const car = this.wagons[i];
    if (car) car.bump = 1;
  }

  pop(i: number): void {
    this.popIndex = i;
    this.popT = 0;
  }

  /**
   * pointAt(d) & tangentAt(d) disuplai World (sudah termasuk morph rel saat expand).
   * fill = 0..1 isi muatan; cutting = 0..1 aktivitas gergaji.
   */
  update(
    dt: number,
    locoD: number,
    spacing: number,
    pointAt: (d: number, out: THREE.Vector3) => THREE.Vector3,
    tangentAt: (d: number, out: THREE.Vector3) => THREE.Vector3,
    speed: number,
    fill: number,
    cutting: number,
    boost: number,
  ): void {
    this.time += dt;
    this.wheelSpin -= speed * dt * 8;
    this.sawSpeed += ((cutting > 0.05 ? 16 : 3) - this.sawSpeed) * (1 - Math.exp(-dt * 6));
    this.sawSpin += this.sawSpeed * dt;
    const tan = new THREE.Vector3();
    const place = (car: Car, d: number, idx: number) => {
      pointAt(d, car.group.position);
      tangentAt(d, tan);
      const h = Math.atan2(-tan.z, tan.x);
      if (!car.headingInit) {
        car.heading = h;
        car.headingInit = true;
      }
      let dh = h - car.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      car.heading += dh * (1 - Math.exp(-dt * 18));
      car.group.rotation.y = car.heading;
      for (const a of car.axles) a.rotation.z = this.wheelSpin;
      for (const s of car.saws) s.rotation.z = -this.sawSpin;
      car.bump = Math.max(0, car.bump - dt * 5);
      const b = Math.sin(car.bump * Math.PI) * 0.12;
      let pop = 0;
      if (idx === this.popIndex) {
        this.popT += dt;
        pop = Math.sin(Math.min(1, this.popT / 0.45) * Math.PI) * 0.4;
        if (this.popT > 0.45) this.popIndex = -1;
      }
      car.body.scale.set(1 + b * 0.5 + pop, 1 - b + pop, 1 + b * 0.5 + pop);
      car.group.position.y = Math.abs(Math.sin(this.time * 14 + idx)) * 0.02 * Math.min(1, speed) + pop * 0.6;
    };
    place(this.loco, locoD, -1);
    this.loco.body.rotation.z = (boost - 1) * 0.1;
    this.wagons.forEach((car, i) => {
      place(car, locoD - (i + 1) * spacing, i);
      // isi bak: muatan dibagi rata ke semua gerbong
      if (car.cargo) {
        const n = Math.round(Math.min(1, fill) * 6);
        for (let k = 0; k < n; k++) {
          _p.set(((k % 3) - 1) * 0.22, 0.45 + Math.floor(k / 3) * 0.17, k % 2 ? 0.1 : -0.1);
          _q.setFromAxisAngle(_s.set(0, 1, 0), Math.PI / 2 + (k % 2) * 0.1);
          _s.setScalar(0.9);
          _m.compose(_p, _q, _s);
          car.cargo.setMatrixAt(k, _m);
        }
        car.cargo.count = n;
        car.cargo.instanceMatrix.needsUpdate = true;
      }
    });
  }

  /** Titik cerobong (dunia) untuk asap. */
  chimney(out: THREE.Vector3): THREE.Vector3 {
    return this.loco.group.localToWorld(out.set(0.34, 1.1, 0));
  }
}
