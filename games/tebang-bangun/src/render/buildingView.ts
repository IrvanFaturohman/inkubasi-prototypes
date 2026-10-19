import * as THREE from 'three';
import type { FinalProject } from '../game/types';
import { mergeFlat, primGeometry } from './geom';
import { SHARED } from './palette';

/**
 * Tampilan bangunan: setiap modul punya versi GHOST (siluet target) dan SOLID.
 *
 * Teknik ghost tanpa z-fighting & tanpa siluet dobel:
 *  1. Prepass kedalaman (colorWrite=false) untuk seluruh ghost tersisa, didorong sedikit ke belakang
 *     dengan polygonOffset → hanya permukaan ghost terdepan yang lolos uji kedalaman.
 *  2. Warna ghost transparan (depthWrite=false, LessEqual) → satu lapis tipis yang bersih,
 *     tidak menumpuk walau modul ghost saling bertumpuk.
 *  3. Garis tepi (edges) tipis untuk membaca bentuk atap/dinding.
 * Solid memakai geometri yang sama persis posisinya; ghost modul disembunyikan tepat saat
 * solidnya mulai muncul, sehingga tidak pernah tampil bersamaan.
 */

const ghostDepthMat = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: true,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 2,
});
const ghostColorMat = new THREE.MeshLambertMaterial({
  color: '#e6f0ff',
  emissive: '#86aee0',
  emissiveIntensity: 0.3,
  transparent: true,
  opacity: 0.36,
  depthWrite: false,
  depthFunc: THREE.LessEqualDepth,
});
const ghostEdgeMat = new THREE.LineBasicMaterial({ color: '#4f78ad', transparent: true, opacity: 0.6, depthWrite: false });
const nextMat = new THREE.MeshBasicMaterial({ color: '#ffcf4a', transparent: true, opacity: 0.35, depthWrite: false, depthFunc: THREE.LessEqualDepth });

type ModState = 'ghost' | 'queued' | 'popping' | 'solid';

interface ModGeo {
  solid: THREE.BufferGeometry;
  ghost: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  center: THREE.Vector3;
  size: number;
}

interface Pop {
  index: number;
  start: number;
  holder: THREE.Group;
  started: boolean;
}

const POP_DURATION = 0.42;

export class BuildingView {
  readonly group = new THREE.Group();
  private readonly mods: ModGeo[] = [];
  private readonly states: ModState[] = [];
  private readonly solidStatic: THREE.Mesh;
  private readonly ghostDepth: THREE.Mesh;
  private readonly ghostColor: THREE.Mesh;
  private readonly ghostEdges: THREE.LineSegments;
  private readonly next: THREE.Mesh;
  private pops: Pop[] = [];
  private ghostDirty = true;
  private solidDirty = true;
  private time = 0;
  private lastScheduled = 0;
  private bounce = 0;
  private bounceAmp = 0;
  /** Dipanggil saat sebuah modul mulai muncul (untuk debu & SFX). */
  onModulePop: ((worldPos: THREE.Vector3, index: number) => void) | null = null;

  constructor(
    readonly project: FinalProject,
    completedCount: number,
  ) {
    for (const m of project.modules) {
      const solids = m.prims.map((p) => primGeometry(p, false));
      const ghosts = m.prims.filter((p) => !p.noGhost).map((p) => primGeometry(p, true));
      const solid = mergeFlat(solids);
      const ghost = mergeFlat(ghosts, ['position', 'normal']);
      ghost.computeBoundingBox();
      const bb = ghost.boundingBox!;
      const center = bb.getCenter(new THREE.Vector3());
      const size = bb.getSize(new THREE.Vector3()).length();
      // Ghost diperkecil 1% di sekitar pusat modul: menghindari bidang berimpit dengan modul solid tetangga.
      ghost.translate(-center.x, -center.y, -center.z);
      ghost.scale(0.99, 0.99, 0.99);
      ghost.translate(center.x, center.y, center.z);
      const edges = new THREE.EdgesGeometry(ghost, 28);
      this.mods.push({ solid, ghost, edges, center, size });
      solids.forEach((g) => g.dispose());
      ghosts.forEach((g) => g.dispose());
    }
    for (let i = 0; i < this.mods.length; i++) this.states.push(i < completedCount ? 'solid' : 'ghost');

    this.solidStatic = new THREE.Mesh(new THREE.BufferGeometry(), SHARED.vertexStd);
    this.solidStatic.castShadow = true;
    this.solidStatic.receiveShadow = true;
    this.ghostDepth = new THREE.Mesh(new THREE.BufferGeometry(), ghostDepthMat);
    this.ghostDepth.renderOrder = 2;
    this.ghostColor = new THREE.Mesh(new THREE.BufferGeometry(), ghostColorMat);
    this.ghostColor.renderOrder = 3;
    this.ghostEdges = new THREE.LineSegments(new THREE.BufferGeometry(), ghostEdgeMat);
    this.ghostEdges.renderOrder = 4;
    this.next = new THREE.Mesh(new THREE.BufferGeometry(), nextMat);
    this.next.renderOrder = 5;
    this.next.visible = false;
    for (const o of [this.solidStatic, this.ghostDepth, this.ghostColor, this.ghostEdges, this.next]) {
      o.frustumCulled = false;
      this.group.add(o);
    }
    this.rebuild();
  }

  get moduleCount(): number {
    return this.mods.length;
  }

  /** Jumlah modul yang secara visual masih ghost (termasuk yang antre muncul). */
  get ghostCount(): number {
    return this.states.filter((s) => s === 'ghost' || s === 'queued').length;
  }

  worldCenter(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const m = this.mods[Math.max(0, Math.min(this.mods.length - 1, i))];
    return this.group.localToWorld(out.copy(m.center));
  }

  /** Bounding box bangunan penuh di ruang lokal grup bangunan (tanpa animasi/skala). */
  localBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const m of this.mods) {
      m.ghost.computeBoundingBox();
      box.union(m.ghost.boundingBox!);
    }
    return box;
  }

  /** Bounding box bangunan penuh (koordinat dunia) untuk framing kamera. */
  worldBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const m of this.mods) {
      m.ghost.computeBoundingBox();
      box.union(m.ghost.boundingBox!);
    }
    this.group.updateMatrixWorld(true);
    return box.applyMatrix4(this.group.matrixWorld);
  }

  /**
   * Pengiriman menyelesaikan modul [from, to). Logika sudah final; di sini hanya menjadwalkan
   * animasi pop berurutan (tidak menahan progres). Mengembalikan titik tujuan material terbang.
   */
  scheduleModules(from: number, to: number, delay = 0.2): THREE.Vector3[] {
    const targets: THREE.Vector3[] = [];
    const count = to - from;
    const stagger = count > 0 ? Math.min(0.08, 0.6 / count) : 0;
    let t = Math.max(this.time + delay, this.lastScheduled + stagger);
    for (let i = from; i < to; i++) {
      if (this.states[i] !== 'ghost') continue;
      this.states[i] = 'queued';
      const holder = new THREE.Group();
      this.pops.push({ index: i, start: t, holder, started: false });
      targets.push(this.worldCenter(i));
      this.lastScheduled = t;
      t += stagger;
    }
    if (targets.length === 0) {
      const nextIdx = this.states.indexOf('ghost');
      targets.push(nextIdx >= 0 ? this.worldCenter(nextIdx) : this.worldCenter(this.mods.length - 1));
    }
    return targets;
  }

  /** Langsung selesaikan semua modul sampai `count` (dipakai saat load / sinkron paksa). */
  syncCompleted(count: number): void {
    let changed = false;
    for (let i = 0; i < this.mods.length; i++) {
      const want: ModState = i < count ? 'solid' : 'ghost';
      if (this.states[i] === 'queued' || this.states[i] === 'popping') continue;
      if (this.states[i] !== want) {
        this.states[i] = want;
        changed = true;
      }
    }
    if (changed) {
      this.ghostDirty = true;
      this.solidDirty = true;
    }
  }

  stageBounce(strength = 1): void {
    this.bounce = 0;
    this.bounceAmp = 0.035 * strength;
  }

  update(dt: number): void {
    this.time += dt;
    // Pop berurutan
    for (const p of this.pops) {
      if (!p.started && this.time >= p.start) {
        p.started = true;
        this.states[p.index] = 'popping';
        this.ghostDirty = true;
        const m = this.mods[p.index];
        const mesh = new THREE.Mesh(m.solid, SHARED.vertexStd);
        mesh.castShadow = true;
        mesh.position.copy(m.center).multiplyScalar(-1);
        p.holder.position.copy(m.center);
        p.holder.add(mesh);
        this.group.add(p.holder);
        this.onModulePop?.(this.worldCenter(p.index), p.index);
      }
      if (p.started) {
        const k = Math.min(1, (this.time - p.start) / POP_DURATION);
        const s = easeOutBack(k);
        p.holder.scale.setScalar(Math.max(0.001, 0.35 + 0.65 * s));
        p.holder.position.y = this.mods[p.index].center.y + (1 - k) * (1 - k) * 0.35;
      }
    }
    // Selesai: pindahkan ke mesh statis sekaligus bila tidak ada pop yang masih berjalan.
    const running = this.pops.some((p) => !p.started || this.time - p.start < POP_DURATION);
    if (!running && this.pops.length) {
      for (const p of this.pops) {
        this.states[p.index] = 'solid';
        this.group.remove(p.holder);
      }
      this.pops = [];
      this.solidDirty = true;
    }
    if (this.ghostDirty || this.solidDirty) this.rebuild();

    // Sorotan modul berikutnya (tempat material selanjutnya dipasang)
    const nextIdx = this.states.indexOf('ghost');
    if (nextIdx >= 0) {
      if (this.next.userData.idx !== nextIdx) {
        this.next.geometry = this.mods[nextIdx].ghost;
        this.next.userData.idx = nextIdx;
      }
      this.next.visible = true;
      nextMat.opacity = 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(this.time * 5));
    } else {
      this.next.visible = false;
    }

    // Bounce seluruh bangunan saat tahap selesai
    if (this.bounceAmp > 0) {
      this.bounce += dt;
      const s = Math.sin(this.bounce * 18) * Math.exp(-this.bounce * 6) * this.bounceAmp;
      this.group.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);
      if (this.bounce > 1) {
        this.bounceAmp = 0;
        this.group.scale.set(1, 1, 1);
      }
    }
  }

  private rebuild(): void {
    if (this.ghostDirty) {
      const ghosts: THREE.BufferGeometry[] = [];
      const edges: THREE.BufferGeometry[] = [];
      for (let i = 0; i < this.mods.length; i++) {
        if (this.states[i] === 'ghost' || this.states[i] === 'queued') {
          ghosts.push(this.mods[i].ghost);
          edges.push(this.mods[i].edges);
        }
      }
      const g = mergeFlat(ghosts, ['position', 'normal']);
      this.ghostDepth.geometry.dispose();
      this.ghostDepth.geometry = g;
      this.ghostColor.geometry = g;
      this.ghostEdges.geometry.dispose();
      this.ghostEdges.geometry = mergeFlat(edges, ['position']);
      this.ghostDepth.visible = this.ghostColor.visible = this.ghostEdges.visible = ghosts.length > 0;
      this.ghostDirty = false;
    }
    if (this.solidDirty) {
      const solids: THREE.BufferGeometry[] = [];
      for (let i = 0; i < this.mods.length; i++) if (this.states[i] === 'solid') solids.push(this.mods[i].solid);
      this.solidStatic.geometry.dispose();
      this.solidStatic.geometry = mergeFlat(solids);
      this.solidStatic.visible = solids.length > 0;
      this.solidDirty = false;
    }
  }

  dispose(): void {
    for (const m of this.mods) {
      m.solid.dispose();
      m.ghost.dispose();
      m.edges.dispose();
    }
    this.solidStatic.geometry.dispose();
    this.ghostDepth.geometry.dispose();
    this.ghostEdges.geometry.dispose();
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
