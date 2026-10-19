import * as THREE from 'three';
import { itemGeometry, type ItemKind } from './items';

/**
 * Efek ringan dengan batas keras jumlah instance (object pooling via InstancedMesh):
 *  - puff: debu/asap bulat lembut,
 *  - confetti: kertas warna-warni berputar,
 *  - flying items: kayu/bata yang melambung dari penyimpanan → kendaraan → bangunan.
 */

const MAX_PUFF = 180;
const MAX_CONFETTI = 160;
const MAX_FLY = 72;

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
  gravity: number;
  drag: number;
  rot: THREE.Euler;
  spin: THREE.Vector3;
}

const FLY_KINDS: ItemKind[] = ['wood', 'stone', 'gem', 'coin', 'brick'];

interface Flyer {
  alive: boolean;
  kind: ItemKind;
  from: THREE.Vector3;
  to: THREE.Vector3;
  getTo: (() => THREE.Vector3) | null;
  t: number;
  delay: number;
  dur: number;
  height: number;
  spin: number;
  scale: number;
  onLand: (() => void) | null;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();

function makePool(n: number): Particle[] {
  return Array.from({ length: n }, () => ({
    alive: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    life: 0,
    maxLife: 1,
    size: 1,
    grow: 1,
    gravity: 0,
    drag: 0,
    rot: new THREE.Euler(),
    spin: new THREE.Vector3(),
  }));
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly puffMesh: THREE.InstancedMesh;
  private readonly confMesh: THREE.InstancedMesh;
  private readonly flyMeshes = new Map<ItemKind, THREE.InstancedMesh>();
  private readonly puffs = makePool(MAX_PUFF);
  private readonly confetti = makePool(MAX_CONFETTI);
  private readonly flyers: Flyer[] = Array.from({ length: MAX_FLY }, () => ({
    alive: false,
    kind: 'wood' as ItemKind,
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    getTo: null,
    t: 0,
    delay: 0,
    dur: 0.3,
    height: 1,
    spin: 0,
    scale: 1,
    onLand: null,
  }));
  private puffCursor = 0;
  private confCursor = 0;

  constructor() {
    const puffGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const puffMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
    this.puffMesh = new THREE.InstancedMesh(puffGeo, puffMat, MAX_PUFF);
    this.puffMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFF * 3), 3);
    const confGeo = new THREE.PlaneGeometry(0.16, 0.1);
    const confMat = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    this.confMesh = new THREE.InstancedMesh(confGeo, confMat, MAX_CONFETTI);
    this.confMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CONFETTI * 3), 3);
    const itemMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    for (const k of FLY_KINDS) this.flyMeshes.set(k, new THREE.InstancedMesh(itemGeometry(k), itemMat, MAX_FLY));
    for (const m of [this.puffMesh, this.confMesh, ...this.flyMeshes.values()]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
  }

  puff(pos: THREE.Vector3, opts: { count?: number; color?: string; size?: number; spread?: number; up?: number; life?: number } = {}): void {
    const n = opts.count ?? 6;
    const color = opts.color ?? '#f3ead8';
    for (let i = 0; i < n; i++) {
      const idx = this.puffCursor;
      const p = this.puffs[idx];
      this.puffCursor = (this.puffCursor + 1) % MAX_PUFF;
      p.alive = true;
      const a = Math.random() * Math.PI * 2;
      const spread = opts.spread ?? 1.2;
      p.pos.copy(pos).add(_p.set(Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15));
      p.vel.set(Math.cos(a) * spread * (0.4 + Math.random() * 0.6), (opts.up ?? 0.9) * (0.6 + Math.random() * 0.6), Math.sin(a) * spread * (0.4 + Math.random() * 0.6));
      p.maxLife = (opts.life ?? 0.55) * (0.7 + Math.random() * 0.6);
      p.life = p.maxLife;
      p.size = (opts.size ?? 0.28) * (0.7 + Math.random() * 0.6);
      p.grow = 1.6;
      p.gravity = -0.5;
      p.drag = 3;
      p.rot.set(Math.random() * 3, Math.random() * 3, 0);
      p.spin.set(Math.random() * 2, Math.random() * 2, 0);
      _c.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
      this.puffMesh.setColorAt(idx, _c);
    }
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;
  }

  sparkle(pos: THREE.Vector3, count = 10, colors = ['#fff6c2', '#ffd34a', '#ffffff']): void {
    for (let i = 0; i < count; i++) {
      const p = this.puffs[this.puffCursor];
      const idx = this.puffCursor;
      this.puffCursor = (this.puffCursor + 1) % MAX_PUFF;
      p.alive = true;
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * 0.8 + 0.3;
      p.pos.copy(pos);
      const sp = 2.2 + Math.random() * 1.5;
      p.vel.set(Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp);
      p.maxLife = 0.45 + Math.random() * 0.25;
      p.life = p.maxLife;
      p.size = 0.11 + Math.random() * 0.06;
      p.grow = 0.2;
      p.gravity = -3;
      p.drag = 2.5;
      p.rot.set(0, 0, 0);
      p.spin.set(6, 6, 0);
      _c.set(colors[i % colors.length]);
      this.puffMesh.setColorAt(idx, _c);
    }
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;
  }

  confettiBurst(pos: THREE.Vector3, count = 120): void {
    const colors = ['#ff5a5f', '#ffd34a', '#3d9bff', '#18c79a', '#9b6bff', '#ff8fd1', '#ffffff'];
    for (let i = 0; i < count; i++) {
      const p = this.confetti[this.confCursor];
      const idx = this.confCursor;
      this.confCursor = (this.confCursor + 1) % MAX_CONFETTI;
      p.alive = true;
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 3.5;
      p.pos.copy(pos).add(_p.set((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2));
      p.vel.set(Math.cos(a) * sp * 0.6, 5 + Math.random() * 4, Math.sin(a) * sp * 0.6);
      p.maxLife = 2.4 + Math.random() * 1.2;
      p.life = p.maxLife;
      p.size = 1;
      p.gravity = -7.5;
      p.drag = 1.6;
      p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      _c.set(colors[i % colors.length]);
      this.confMesh.setColorAt(idx, _c);
    }
    if (this.confMesh.instanceColor) this.confMesh.instanceColor.needsUpdate = true;
  }

  /**
   * Material terbang dengan lintasan busur. `getTo` (opsional) dievaluasi tiap frame
   * sehingga item mengejar kendaraan yang bergerak.
   */
  fly(
    kind: ItemKind,
    from: THREE.Vector3,
    to: THREE.Vector3,
    opts: { delay?: number; dur?: number; height?: number; getTo?: () => THREE.Vector3; onLand?: () => void; scale?: number } = {},
  ): void {
    const f = this.flyers.find((x) => !x.alive);
    if (!f) {
      opts.onLand?.();
      return;
    }
    f.alive = true;
    f.kind = kind;
    f.from.copy(from);
    f.to.copy(to);
    f.getTo = opts.getTo ?? null;
    f.t = 0;
    f.delay = opts.delay ?? 0;
    f.dur = opts.dur ?? 0.32;
    f.height = opts.height ?? 1.2;
    f.spin = (Math.random() - 0.5) * 12;
    f.scale = opts.scale ?? 1;
    f.onLand = opts.onLand ?? null;
  }

  clear(): void {
    for (const p of this.puffs) p.alive = false;
    for (const p of this.confetti) p.alive = false;
    for (const f of this.flyers) f.alive = false;
  }

  update(dt: number): void {
    // Puff
    let n = 0;
    for (let i = 0; i < MAX_PUFF; i++) {
      const p = this.puffs[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.vel.y += p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      const k = 1 - p.life / p.maxLife;
      const s = p.size * (1 + (p.grow - 1) * k) * Math.min(1, (1 - k) * 3) * Math.min(1, k * 8 + 0.3);
      _q.setFromEuler(p.rot);
      _s.setScalar(Math.max(0.001, s));
      _m.compose(p.pos, _q, _s);
      this.puffMesh.setMatrixAt(i, _m);
      n = i + 1;
    }
    this.hideDead(this.puffMesh, this.puffs, n);

    // Confetti
    n = 0;
    for (let i = 0; i < MAX_CONFETTI; i++) {
      const p = this.confetti[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0 || p.pos.y < -0.2) {
        p.alive = false;
        continue;
      }
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.vel.y += p.gravity * dt;
      p.vel.y = Math.max(p.vel.y, -1.6);
      p.pos.addScaledVector(p.vel, dt);
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      _q.setFromEuler(p.rot);
      _s.setScalar(Math.min(1, p.life * 2));
      _m.compose(p.pos, _q, _s);
      this.confMesh.setMatrixAt(i, _m);
      n = i + 1;
    }
    this.hideDead(this.confMesh, this.confetti, n);

    // Flying items
    const counts = new Map<ItemKind, number>(FLY_KINDS.map((k) => [k, 0]));
    for (const f of this.flyers) {
      if (!f.alive) continue;
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.t += dt / f.dur;
      if (f.getTo) f.to.copy(f.getTo());
      if (f.t >= 1) {
        f.alive = false;
        f.onLand?.();
        continue;
      }
      const t = f.t;
      _p.lerpVectors(f.from, f.to, t);
      _p.y += Math.sin(t * Math.PI) * f.height;
      _e.set(t * f.spin, t * f.spin * 0.7, 0);
      _q.setFromEuler(_e);
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.4 : 1;
      _s.setScalar(f.scale * pop);
      _m.compose(_p, _q, _s);
      const mesh = this.flyMeshes.get(f.kind)!;
      const n = counts.get(f.kind)!;
      mesh.setMatrixAt(n, _m);
      counts.set(f.kind, n + 1);
    }
    for (const [kind, mesh] of this.flyMeshes) {
      mesh.count = counts.get(kind)!;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private hideDead(mesh: THREE.InstancedMesh, pool: Particle[], n: number): void {
    // Instance mati di bawah n diskalakan nol (supaya indeks warna tetap stabil).
    for (let i = 0; i < n; i++) {
      if (!pool[i].alive) {
        _m.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, _m);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }
}
