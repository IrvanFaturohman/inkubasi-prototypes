/**
 * Visual-only effects. Nothing here touches the simulation.
 *  - Particles: two InstancedMesh pools (64 small boxes + 32 small spheres = 96 meshes max).
 *  - Overlay: HTML floating numbers and per-harvester crate pills bound to scene positions.
 */
import * as THREE from 'three';

type Kind = 'chaff' | 'grain' | 'confetti' | 'puff' | 'drop';

interface Particle {
  kind: Kind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
  delay: number;
  // grain stream (follows the moving crate into the hopper)
  from?: () => THREE.Vector3;
  to?: THREE.Vector3;
  arc?: number;
}

const BOX_CAP = 64;
const SPHERE_CAP = 32;

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const sc = new THREE.Vector3();

export class Particles {
  readonly group = new THREE.Group();
  private boxes: THREE.InstancedMesh;
  private spheres: THREE.InstancedMesh;
  private boxList: Particle[] = [];
  private sphereList: Particle[] = [];

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, BOX_CAP);
    this.spheres = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, SPHERE_CAP);
    for (const m of [this.boxes, this.spheres]) {
      m.count = 0;
      m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color('#ffffff'));
      this.group.add(m);
    }
  }

  get active(): number {
    return this.boxList.length + this.sphereList.length;
  }

  private push(p: Particle): void {
    const list = p.kind === 'puff' || p.kind === 'drop' ? this.sphereList : this.boxList;
    const cap = list === this.sphereList ? SPHERE_CAP : BOX_CAP;
    if (list.length >= cap) list.shift(); // recycle the oldest
    list.push(p);
  }

  private base(kind: Kind, pos: THREE.Vector3, color: string | THREE.Color, size: number, life: number): Particle {
    return {
      kind,
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
      spin: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
      life: 0,
      max: life,
      size,
      color: new THREE.Color(color),
      gravity: 0,
      drag: 0,
      delay: 0,
    };
  }

  /** 2–4 bits of stalk/husk flicked off the cutter, varied direction. */
  chaff(pos: THREE.Vector3, dir: number, colors: string[], n = 3): void {
    for (let i = 0; i < n; i++) {
      const p = this.base('chaff', pos, colors[i % colors.length], 0.08 + Math.random() * 0.05, 0.55 + Math.random() * 0.35);
      p.pos.x += (Math.random() - 0.5) * 0.3;
      p.pos.z += (Math.random() - 0.5) * 0.3;
      p.vel.set(-dir * (0.3 + Math.random() * 0.9), 1.4 + Math.random() * 1.3, (Math.random() - 0.5) * 1.4);
      p.gravity = 6;
      p.drag = 1.4;
      this.push(p);
    }
  }

  /** Crop pieces flying from the moving crate into the hopper. */
  grainStream(from: () => THREE.Vector3, to: THREE.Vector3, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const p = this.base('grain', from(), color, 0.13 + Math.random() * 0.05, 0.5 + Math.random() * 0.12);
      p.from = from;
      p.to = to.clone();
      p.arc = 0.7 + Math.random() * 0.5;
      p.delay = i * 0.05;
      this.push(p);
    }
  }

  confetti(pos: THREE.Vector3, colors: string[], n = 8): void {
    for (let i = 0; i < n; i++) {
      const p = this.base('confetti', pos, colors[i % colors.length], 0.11 + Math.random() * 0.05, 0.9 + Math.random() * 0.5);
      const a = Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 1.4;
      p.vel.set(Math.cos(a) * s, 2.2 + Math.random() * 1.6, Math.sin(a) * s);
      p.gravity = 4.5;
      p.drag = 1.8;
      p.delay = Math.random() * 0.08;
      this.push(p);
    }
  }

  puff(pos: THREE.Vector3, n = 7, color = '#fff6e6', spread = 0.5): void {
    for (let i = 0; i < n; i++) {
      const p = this.base('puff', pos, color, 0.12 + Math.random() * 0.12, 0.45 + Math.random() * 0.3);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      p.vel.set(Math.cos(a) * spread * 2.2, 0.6 + Math.random() * 0.8, Math.sin(a) * spread * 2.2);
      p.drag = 3.5;
      this.push(p);
    }
  }

  drop(pos: THREE.Vector3, vel: THREE.Vector3): void {
    const p = this.base('drop', pos, '#8fd0f0', 0.045 + Math.random() * 0.02, 0.7);
    p.vel.copy(vel);
    p.gravity = 5;
    this.push(p);
  }

  update(dt: number): void {
    this.updateList(this.boxList, this.boxes, dt);
    this.updateList(this.sphereList, this.spheres, dt);
  }

  private updateList(list: Particle[], mesh: THREE.InstancedMesh, dt: number): void {
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.delay > 0) {
        p.delay -= dt;
        list[w++] = p;
        continue;
      }
      p.life += dt;
      if (p.life >= p.max) continue;
      list[w++] = p;
      const t = p.life / p.max;
      if (p.kind === 'grain' && p.from && p.to) {
        const a = p.from();
        const e = t * t * (3 - 2 * t);
        p.pos.lerpVectors(a, p.to, e);
        p.pos.y += Math.sin(Math.PI * e) * (p.arc ?? 0.8);
      } else {
        p.vel.y -= p.gravity * dt;
        const k = Math.exp(-p.drag * dt);
        p.vel.multiplyScalar(k);
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < 0.03 && p.kind !== 'puff') {
          p.pos.y = 0.03;
          p.vel.set(p.vel.x * 0.3, 0, p.vel.z * 0.3);
        }
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
    }
    list.length = w;
    let n = 0;
    for (const p of list) {
      if (p.delay > 0) continue;
      const t = p.life / p.max;
      let s = p.size;
      if (p.kind === 'puff') s *= 0.6 + t * 1.2;
      if (t > 0.7) s *= 1 - (t - 0.7) / 0.3;
      q.setFromEuler(p.rot);
      sc.set(s, p.kind === 'confetti' ? s * 0.3 : p.kind === 'chaff' ? s * 0.45 : p.kind === 'grain' ? s * 0.8 : s, p.kind === 'chaff' ? s * 0.6 : s);
      m4.compose(p.pos, q, sc);
      mesh.setMatrixAt(n, m4);
      mesh.setColorAt(n, p.color);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.boxList.length = 0;
    this.sphereList.length = 0;
    this.boxes.count = 0;
    this.spheres.count = 0;
  }
}

// ─── HTML overlay bound to scene positions ──────────────────────────────────

export interface PillState {
  x: number;
  y: number;
  cargo: number;
  cap: number;
  tier: number;
  visible: boolean;
}

export class Overlay {
  private pills = new Map<number, { el: HTMLDivElement; fill: HTMLDivElement; text: HTMLSpanElement; key: string }>();

  constructor(private root: HTMLElement) {}

  private clampX(x: number, margin: number): number {
    const w = this.root.clientWidth || 390;
    return Math.min(w - margin, Math.max(margin, x));
  }

  floatText(x: number, y: number, text: string, cls = 'float-money'): void {
    x = this.clampX(x, 44);
    const el = document.createElement('div');
    el.className = `float-text ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--drift', `${(Math.random() - 0.5) * 24}px`);
    el.style.animationDuration = `${1.05 + Math.random() * 0.25}s`;
    this.root.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  label(x: number, y: number, text: string, cls: string, ms = 1800): void {
    x = this.clampX(x, 64);
    const el = document.createElement('div');
    el.className = `scene-label ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.root.appendChild(el);
    window.setTimeout(() => el.remove(), ms);
  }

  syncPills(states: Map<number, PillState>): void {
    for (const [id, p] of this.pills) {
      if (!states.has(id)) {
        p.el.remove();
        this.pills.delete(id);
      }
    }
    for (const [id, s] of states) {
      let p = this.pills.get(id);
      if (!p) {
        const el = document.createElement('div');
        el.className = 'cargo-pill';
        const fill = document.createElement('div');
        fill.className = 'cargo-fill';
        const text = document.createElement('span');
        el.append(fill, text);
        this.root.appendChild(el);
        p = { el, fill, text, key: '' };
        this.pills.set(id, p);
      }
      p.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      p.el.style.opacity = s.visible ? '1' : '0';
      const full = s.cargo >= s.cap;
      const key = `${s.cargo}/${s.cap}/${s.tier}`;
      if (key !== p.key) {
        p.key = key;
        p.text.textContent = full ? `FULL ${s.cargo}/${s.cap}` : `${s.cargo}/${s.cap}`;
        const f = Math.min(1, s.cargo / s.cap);
        p.fill.style.transform = `scaleX(${f})`;
        p.el.classList.toggle('full', full);
        p.el.classList.toggle('near', !full && f >= 0.75);
        p.el.dataset.tier = String(s.tier);
      }
    }
  }

  clear(): void {
    for (const p of this.pills.values()) p.el.remove();
    this.pills.clear();
    this.root.querySelectorAll('.float-text, .scene-label').forEach((e) => e.remove());
  }
}

