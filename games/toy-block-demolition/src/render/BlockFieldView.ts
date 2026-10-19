import * as THREE from 'three';
import type { BlockField } from '../game/BlockField';
import { GRID, MAT_BONUS, MAT_REINFORCED } from '../game/config';
import { hash2 } from '../game/util';
import type { ArtFactory } from './ArtFactory';
import { InstancedPool } from './InstancedPool';

const KIND_NONE = 0;
const KIND_SINGLE = 1;
const KIND_PAIR = 2;
const KIND_REINFORCED = 3;
const KIND_BONUS = 4;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * Instanced rendering of the block field. Layer keys (cell*2+layer) map to
 * instances in one of several pools; the logical grid stays authoritative.
 */
export class BlockFieldView {
  readonly group = new THREE.Group();
  private field: BlockField;
  private art: ArtFactory;
  private single: InstancedPool;
  private pair: InstancedPool;
  private reinforced: InstancedPool;
  private bonus: InstancedPool;
  private stars: InstancedPool;
  private kind: Uint8Array;
  private squash: Float32Array;
  private readonly squashActive: number[] = [];
  private readonly touchedNow = new Set<number>();
  private floor: THREE.Mesh;
  private time = 0;

  constructor(art: ArtFactory, field: BlockField) {
    this.art = art;
    this.field = field;
    const keys = field.n * 2;
    let reinfCount = 0;
    let bonusCount = 0;
    let pairCount = 0;
    for (let k = 0; k < keys; k++) {
      if (field.mat[k] === MAT_REINFORCED) reinfCount++;
      else if (field.mat[k] === MAT_BONUS) bonusCount++;
      if (field.pairWith[k] > k) pairCount++;
    }
    this.single = new InstancedPool(art.geo.block, art.blockMat, keys, keys, true);
    this.pair = new InstancedPool(art.geo.pair, art.blockMat, pairCount + 1, keys, true);
    this.reinforced = new InstancedPool(art.geo.reinforced, art.blockMat, reinfCount + 1, keys, true);
    this.bonus = new InstancedPool(art.geo.bonus, art.blockMat, bonusCount + 1, keys, true);
    this.stars = new InstancedPool(art.geo.star, art.mats.star, bonusCount + 1, keys, false);
    for (const p of [this.single, this.pair, this.reinforced, this.bonus, this.stars]) {
      p.mesh.castShadow = true;
      p.mesh.receiveShadow = true;
      this.group.add(p.mesh);
    }
    this.stars.mesh.castShadow = false;
    this.kind = new Uint8Array(keys);
    this.squash = new Float32Array(keys);

    // Cleared floor under the field: clean, lighter and visibly different from the targets.
    const floorTex = art.textures.floor.clone();
    floorTex.needsUpdate = true;
    floorTex.repeat.set(field.cols, field.rows);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0 });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(field.width, field.depth), floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, 0.004, field.originZ + field.depth / 2);
    this.floor.receiveShadow = true;
    this.group.add(this.floor);

    this.build();
  }

  private build(): void {
    const f = this.field;
    for (let i = 0; i < f.n; i++) {
      for (let l = 0; l < f.remaining[i]; l++) {
        const k = i * 2 + l;
        const partner = f.pairWith[k];
        if (partner >= 0 && f.remaining[partner >> 1] > (partner & 1)) {
          if (k < partner) this.addPair(k, partner);
          continue;
        }
        this.addSingle(k);
      }
    }
    this.flush();
  }

  /**
   * Cosmetic height variation (three proportions on the same base cell) so a
   * single-layer field still reads as chunky blocks. A lower layer that carries
   * another layer keeps the full height. Gameplay never reads this.
   */
  private heightFactor(k: number): number {
    const i = k >> 1;
    if ((k & 1) === 0 && this.field.orig[i] === 2) return 1;
    const partner = this.field.pairWith[k];
    const key = partner >= 0 ? Math.min(k, partner) : k;
    const h = hash2(key >> 1, key & 1, 31);
    return h < 0.34 ? 0.84 : h < 0.72 ? 0.98 : 1.12;
  }

  private layerBase(k: number): number {
    return (k & 1) * GRID.layerHeight + 0.01;
  }

  private layerY(k: number): number {
    return this.layerBase(k) + (GRID.blockHeight * this.heightFactor(k)) / 2;
  }

  private composeSingle(k: number, squash: number, jiggle: number): THREE.Matrix4 {
    const f = this.field;
    const i = k >> 1;
    const hf = this.heightFactor(k) * (1 - 0.06 * squash);
    _p.set(f.centerX(i), this.layerBase(k) + (GRID.blockHeight * hf) / 2, f.centerZ(i));
    _q.setFromAxisAngle(_yAxis, jiggle);
    const xz = 1 + 0.025 * squash;
    _s.set(xz, hf, xz);
    return _m.compose(_p, _q, _s);
  }

  private addSingle(k: number): void {
    const f = this.field;
    const mat = f.mat[k];
    const col = this.tint(k);
    this.composeSingle(k, 0, 0);
    if (mat === MAT_REINFORCED) {
      this.reinforced.add(k, _m, col);
      this.kind[k] = KIND_REINFORCED;
    } else if (mat === MAT_BONUS) {
      this.bonus.add(k, _m, col);
      this.kind[k] = KIND_BONUS;
      this.placeStar(k, 0);
    } else {
      this.single.add(k, _m, col);
      this.kind[k] = KIND_SINGLE;
    }
  }

  private placeStar(k: number, squash: number): void {
    const f = this.field;
    const i = k >> 1;
    _p.set(f.centerX(i), this.layerBase(k) + GRID.blockHeight * this.heightFactor(k) * (1 - 0.06 * squash) - 0.004, f.centerZ(i));
    _q.setFromAxisAngle(_yAxis, hash2(i, k, 7) * 1.2);
    _s.set(1, 1, 1);
    this.stars.add(k, _m.compose(_p, _q, _s));
  }

  private addPair(a: number, b: number): void {
    const f = this.field;
    const ia = a >> 1;
    const ib = b >> 1;
    const horizontal = f.row(ia) === f.row(ib);
    _p.set((f.centerX(ia) + f.centerX(ib)) / 2, this.layerY(a), (f.centerZ(ia) + f.centerZ(ib)) / 2);
    _e.set(0, horizontal ? 0 : Math.PI / 2, 0);
    _q.setFromEuler(_e);
    _s.set(1, this.heightFactor(a), 1);
    this.pair.add(a, _m.compose(_p, _q, _s), this.tint(a));
    this.kind[a] = KIND_PAIR;
    this.kind[b] = KIND_PAIR;
  }

  /** Palette colour with a very small per-block value variation so large bands don't look flat. */
  private tint(k: number): THREE.Color {
    const base = this.art.blockColors[this.field.color[k]] ?? this.art.blockColors[0];
    const v = 0.97 + hash2(k, 3, 11) * 0.06;
    return _c.copy(base).multiplyScalar(v);
  }

  /** Split a long brick into two singles (on first contact or when one half breaks). */
  private unpair(k: number): void {
    const f = this.field;
    const partner = f.pairWith[k];
    if (partner < 0 || this.kind[k] !== KIND_PAIR) return;
    const primary = Math.min(k, partner);
    this.pair.remove(primary);
    this.kind[k] = KIND_NONE;
    this.kind[partner] = KIND_NONE;
    for (const kk of [k, partner]) {
      const i = kk >> 1;
      if (f.remaining[i] > (kk & 1)) this.addSingle(kk);
    }
  }

  /** Remove a destroyed layer's visual. */
  onBreak(k: number): void {
    const kind = this.kind[k];
    if (kind === KIND_PAIR) {
      this.unpair(k);
      // unpair re-adds only surviving halves; ensure this one is gone.
      this.removeSingle(k);
    } else {
      this.removeSingle(k);
    }
    this.squash[k] = 0;
  }

  private removeSingle(k: number): void {
    const kind = this.kind[k];
    if (kind === KIND_SINGLE) this.single.remove(k);
    else if (kind === KIND_REINFORCED) this.reinforced.remove(k);
    else if (kind === KIND_BONUS) {
      this.bonus.remove(k);
      this.stars.remove(k);
    }
    this.kind[k] = KIND_NONE;
  }

  /** Cells contacted this frame compress slightly; reinforced layers also resist with a jiggle. */
  setTouched(cells: readonly number[]): void {
    this.touchedNow.clear();
    const f = this.field;
    for (const i of cells) {
      const k = f.topKey(i);
      if (k < 0) continue;
      if (this.kind[k] === KIND_PAIR) this.unpair(k);
      this.touchedNow.add(k);
      if (this.squash[k] === 0) this.squashActive.push(k);
    }
  }

  update(dt: number, reducedMotion: boolean): void {
    this.time += dt;
    const f = this.field;
    for (let n = this.squashActive.length - 1; n >= 0; n--) {
      const k = this.squashActive[n];
      const i = k >> 1;
      const alive = f.remaining[i] > (k & 1);
      const touched = this.touchedNow.has(k);
      // Approach quickly when touched (≈50–80 ms), release a little slower.
      let s = this.squash[k];
      s += ((touched ? 1 : 0) - s) * Math.min(1, dt * (touched ? 22 : 14));
      if (!alive || (!touched && s < 0.02)) {
        s = 0;
        this.squashActive[n] = this.squashActive[this.squashActive.length - 1];
        this.squashActive.pop();
      }
      this.squash[k] = s;
      if (!alive) continue;
      const reinforced = f.mat[k] === MAT_REINFORCED;
      const amt = reducedMotion ? s * 0.5 : s;
      const jig = reinforced && touched && !reducedMotion ? Math.sin(this.time * 70 + k) * 0.05 * s : 0;
      this.composeSingle(k, amt, jig);
      const kind = this.kind[k];
      if (kind === KIND_SINGLE) this.single.setMatrix(k, _m);
      else if (kind === KIND_REINFORCED) this.reinforced.setMatrix(k, _m);
      else if (kind === KIND_BONUS) {
        this.bonus.setMatrix(k, _m);
        this.placeStar(k, amt);
      }
    }
    this.touchedNow.clear();
    this.flush();
  }

  private flush(): void {
    this.single.flush();
    this.pair.flush();
    this.reinforced.flush();
    this.bonus.flush();
    this.stars.flush();
  }

  /** World position of a layer's top centre (markers, effects). */
  layerTop(k: number, out: THREE.Vector3): THREE.Vector3 {
    const i = k >> 1;
    return out.set(this.field.centerX(i), this.layerBase(k) + GRID.blockHeight * this.heightFactor(k), this.field.centerZ(i));
  }

  dispose(): void {
    for (const p of [this.single, this.pair, this.reinforced, this.bonus, this.stars]) p.dispose();
    this.floor.geometry.dispose();
    const m = this.floor.material as THREE.MeshStandardMaterial;
    m.map?.dispose();
    m.dispose();
    this.group.removeFromParent();
  }
}
