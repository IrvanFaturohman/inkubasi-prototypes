import * as THREE from 'three';
import type { PendingPickup } from '../game/CargoLedger';
import type { QualityProfile } from '../game/config';
import { clamp, easeOutCubic } from '../game/util';
import type { ArtFactory } from './ArtFactory';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Struct-of-arrays particle pool with swap-remove compaction. */
class ParticleSet {
  readonly mesh: THREE.InstancedMesh;
  readonly max: number;
  limit: number;
  count = 0;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  rx: Float32Array;
  ry: Float32Array;
  spin: Float32Array;
  age: Float32Array;
  life: Float32Array;
  size: Float32Array;
  col: Float32Array;
  bounced: Uint8Array;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, max: number, shadow: boolean) {
    this.max = max;
    this.limit = max;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    const f = () => new Float32Array(max);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.rx = f();
    this.ry = f();
    this.spin = f();
    this.age = f();
    this.life = f();
    this.size = f();
    this.col = new Float32Array(max * 3);
    this.bounced = new Uint8Array(max);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color): number {
    if (this.count >= this.limit) return -1;
    const i = this.count++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.rx[i] = Math.random() * 6.28;
    this.ry[i] = Math.random() * 6.28;
    this.spin[i] = (Math.random() - 0.5) * 18;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.bounced[i] = 0;
    return i;
  }

  kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    // Keep the moved particle's already-written matrix valid for this frame.
    const ma = this.mesh.instanceMatrix.array as Float32Array;
    ma.copyWithin(i * 16, last * 16, last * 16 + 16);
    this.px[i] = this.px[last];
    this.py[i] = this.py[last];
    this.pz[i] = this.pz[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.vz[i] = this.vz[last];
    this.rx[i] = this.rx[last];
    this.ry[i] = this.ry[last];
    this.spin[i] = this.spin[last];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.size[i] = this.size[last];
    this.col[i * 3] = this.col[last * 3];
    this.col[i * 3 + 1] = this.col[last * 3 + 1];
    this.col[i * 3 + 2] = this.col[last * 3 + 2];
    this.bounced[i] = this.bounced[last];
  }

  commit(): void {
    this.mesh.count = this.count;
    if (this.count > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      (this.mesh.instanceColor as THREE.InstancedBufferAttribute).array.set(this.col.subarray(0, this.count * 3));
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }
}

interface CascadeChunk {
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  age: number;
  life: number;
  color: THREE.Color;
  spin: number;
}

/**
 * Pooled cosmetic effects: break shards, pickup flights (drawn from the
 * ledger's pending list), unload cascade, sparkles, confetti and dust puffs.
 * None of these is ever the record of an economy value.
 */
export class EffectsPool {
  readonly group = new THREE.Group();
  private shards: ParticleSet;
  private sparkles: ParticleSet;
  private confetti: ParticleSet;
  private puffs: ParticleSet;
  private flights: THREE.InstancedMesh;
  private flightMax: number;
  private flightLimit: number;
  private cascade: CascadeChunk[] = [];
  private cascadeMesh: THREE.InstancedMesh;
  private art: ArtFactory;
  reducedMotion = false;

  constructor(art: ArtFactory, profile: QualityProfile) {
    this.art = art;
    this.shards = new ParticleSet(art.geo.shard, art.chunkMat, 200, false);
    this.sparkles = new ParticleSet(art.geo.sparkle, art.mats.sparkle, 60, false);
    this.confetti = new ParticleSet(art.geo.confetti, art.mats.confetti, 110, false);
    this.puffs = new ParticleSet(art.geo.puff, art.mats.puff, 40, false);
    this.flightMax = 48;
    this.flightLimit = profile.flights;
    this.flights = new THREE.InstancedMesh(art.geo.chunk, art.chunkMat, this.flightMax);
    this.flights.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.flightMax * 3).fill(1), 3);
    this.flights.count = 0;
    this.flights.frustumCulled = false;
    this.flights.castShadow = true;
    this.cascadeMesh = new THREE.InstancedMesh(art.geo.chunk, art.chunkMat, 28);
    this.cascadeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(28 * 3).fill(1), 3);
    this.cascadeMesh.count = 0;
    this.cascadeMesh.frustumCulled = false;
    this.group.add(this.shards.mesh, this.sparkles.mesh, this.confetti.mesh, this.puffs.mesh, this.flights, this.cascadeMesh);
    this.setProfile(profile);
  }

  setProfile(p: QualityProfile): void {
    this.shards.limit = Math.min(this.shards.max, p.shards);
    this.sparkles.limit = Math.min(this.sparkles.max, p.sparkles);
    this.confetti.limit = Math.min(this.confetti.max, p.confetti);
    this.flightLimit = Math.min(this.flightMax, p.flights);
    this.shards.mesh.castShadow = p.shadows;
  }

  /** Small shards on a break. `burst` scales with how busy the crusher is (coalesced when dense). */
  spawnBreak(x: number, y: number, z: number, colorIndex: number, dirX: number, dirZ: number, count: number): void {
    const base = this.art.blockColors[colorIndex] ?? this.art.blockColors[0];
    for (let k = 0; k < count; k++) {
      const sp = 1.2 + Math.random() * 1.6;
      const a = Math.random() * Math.PI * 2;
      const vx = dirX * 1.2 + Math.cos(a) * sp * 0.6;
      const vz = dirZ * 1.2 + Math.sin(a) * sp * 0.6;
      const vy = 1.6 + Math.random() * 2.0;
      _c.copy(base).multiplyScalar(0.9 + Math.random() * 0.2);
      this.shards.spawn(x, y + 0.1, z, vx, vy, vz, 0.18 + Math.random() * 0.17, 0.55 + Math.random() * 0.7, _c);
    }
  }

  spawnSparkles(x: number, y: number, z: number, count: number, color = '#FFF3B0'): void {
    const c = _c.set(color);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 1.4;
      this.sparkles.spawn(x, y, z, Math.cos(a) * sp, 1.2 + Math.random() * 1.6, Math.sin(a) * sp, 0.35 + Math.random() * 0.2, 0.7 + Math.random() * 0.8, c);
    }
  }

  spawnConfetti(x: number, y: number, z: number, count: number): void {
    const n = this.reducedMotion ? Math.min(count, 12) : count;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.2;
      _c.copy(this.art.blockColors[k % 5]);
      this.confetti.spawn(x, y, z, Math.cos(a) * sp, 3.2 + Math.random() * 2.5, Math.sin(a) * sp, 1.1 + Math.random() * 0.5, 0.8 + Math.random() * 0.6, _c);
    }
  }

  spawnPuff(x: number, y: number, z: number, size = 1): void {
    _c.set('#FFFFFF');
    this.puffs.spawn(x, y, z, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4, 0.45 + Math.random() * 0.2, size, _c);
  }

  spawnCascade(from: THREE.Vector3, to: THREE.Vector3, colorIndex: number): void {
    if (this.cascade.length >= 28) return;
    this.cascade.push({
      fx: from.x,
      fy: from.y,
      fz: from.z,
      tx: to.x + (Math.random() - 0.5) * 0.5,
      ty: to.y,
      tz: to.z + (Math.random() - 0.5) * 0.5,
      age: 0,
      life: 0.38 + Math.random() * 0.14,
      color: this.art.blockColors[colorIndex].clone(),
      spin: (Math.random() - 0.5) * 14,
    });
  }

  /**
   * Draw pickup flights straight from the ledger's pending list.
   * Beyond the visual limit, remaining flights are simply not drawn (they still land logically).
   */
  drawPickups(pending: readonly PendingPickup[], target: (out: THREE.Vector3, i: number) => THREE.Vector3): void {
    const n = Math.min(pending.length, this.flightLimit);
    for (let i = 0; i < n; i++) {
      const p = pending[i];
      const t = clamp(p.age / p.duration, 0, 1);
      target(_t, i);
      // Phase 1 (first 28%): quick outward/upward burst from the break.
      const burstT = 0.28;
      _a.set(p.sx, p.sy, p.sz);
      _b.set(p.sx + p.bx * 0.55, p.sy + 0.75, p.sz + p.bz * 0.55);
      if (t < burstT) {
        const u = easeOutCubic(t / burstT);
        _p.lerpVectors(_a, _b, u);
      } else {
        // Phase 2: curved arc into the moving bin.
        const u = (t - burstT) / (1 - burstT);
        const e = u * u * (3 - 2 * u);
        const cx = (_b.x + _t.x) / 2;
        const cy = Math.max(_b.y, _t.y) + 0.9;
        const cz = (_b.z + _t.z) / 2;
        const iu = 1 - e;
        _p.set(
          iu * iu * _b.x + 2 * iu * e * cx + e * e * _t.x,
          iu * iu * _b.y + 2 * iu * e * cy + e * e * _t.y,
          iu * iu * _b.z + 2 * iu * e * cz + e * e * _t.z,
        );
      }
      const spin = p.age * 9 + i;
      _e.set(spin, spin * 0.7, 0);
      _q.setFromEuler(_e);
      const sc = 1.45 - 0.45 * t;
      _s.set(sc, sc, sc);
      this.flights.setMatrixAt(i, _m.compose(_p, _q, _s));
      _c.copy(this.art.blockColors[p.color] ?? this.art.blockColors[0]);
      this.flights.setColorAt(i, _c);
    }
    this.flights.count = n;
    if (n > 0) {
      this.flights.instanceMatrix.needsUpdate = true;
      this.flights.instanceColor!.needsUpdate = true;
    }
  }

  update(dt: number): void {
    const g = 14;
    // Shards: ballistic with one cheap floor bounce, shrink out.
    const S = this.shards;
    for (let i = S.count - 1; i >= 0; i--) {
      S.age[i] += dt;
      if (S.age[i] >= S.life[i]) {
        S.kill(i);
        continue;
      }
      S.vy[i] -= g * dt;
      S.px[i] += S.vx[i] * dt;
      S.py[i] += S.vy[i] * dt;
      S.pz[i] += S.vz[i] * dt;
      if (S.py[i] < 0.05 && S.vy[i] < 0) {
        S.py[i] = 0.05;
        S.vy[i] *= S.bounced[i] ? 0 : -0.35;
        S.vx[i] *= 0.6;
        S.vz[i] *= 0.6;
        S.bounced[i] = 1;
      }
      S.rx[i] += S.spin[i] * dt;
      const life = S.age[i] / S.life[i];
      const sc = S.size[i] * (life > 0.6 ? 1 - (life - 0.6) / 0.4 : 1);
      _p.set(S.px[i], S.py[i], S.pz[i]);
      _e.set(S.rx[i], S.ry[i], S.rx[i] * 0.5);
      _q.setFromEuler(_e);
      _s.set(sc, sc, sc);
      S.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    S.commit();

    // Sparkles: pop up, twinkle, vanish.
    const K = this.sparkles;
    for (let i = K.count - 1; i >= 0; i--) {
      K.age[i] += dt;
      if (K.age[i] >= K.life[i]) {
        K.kill(i);
        continue;
      }
      K.vy[i] -= 5 * dt;
      K.vx[i] *= 1 - 3 * dt;
      K.vz[i] *= 1 - 3 * dt;
      K.px[i] += K.vx[i] * dt;
      K.py[i] += K.vy[i] * dt;
      K.pz[i] += K.vz[i] * dt;
      K.ry[i] += 8 * dt;
      const life = K.age[i] / K.life[i];
      const sc = K.size[i] * Math.sin(Math.min(1, life) * Math.PI);
      _p.set(K.px[i], K.py[i], K.pz[i]);
      _e.set(0, K.ry[i], 0);
      _q.setFromEuler(_e);
      _s.set(sc, sc * 1.4, sc);
      K.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    K.commit();

    // Confetti: flutter down with drag.
    const C = this.confetti;
    for (let i = C.count - 1; i >= 0; i--) {
      C.age[i] += dt;
      if (C.age[i] >= C.life[i] || C.py[i] < 0.02) {
        C.kill(i);
        continue;
      }
      C.vy[i] -= 6 * dt;
      const drag = 1 - 2.2 * dt;
      C.vx[i] *= drag;
      C.vz[i] *= drag;
      if (C.vy[i] < -1.4) C.vy[i] = -1.4;
      C.px[i] += C.vx[i] * dt + Math.sin(C.age[i] * 9 + i) * 0.4 * dt;
      C.py[i] += C.vy[i] * dt;
      C.pz[i] += C.vz[i] * dt;
      C.rx[i] += C.spin[i] * dt;
      C.ry[i] += C.spin[i] * 0.6 * dt;
      const life = C.age[i] / C.life[i];
      const sc = C.size[i] * (life > 0.8 ? (1 - life) / 0.2 : 1);
      _p.set(C.px[i], C.py[i], C.pz[i]);
      _e.set(C.rx[i], C.ry[i], 0);
      _q.setFromEuler(_e);
      _s.set(sc, sc, sc);
      C.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    C.commit();

    // Dust puffs.
    const P = this.puffs;
    for (let i = P.count - 1; i >= 0; i--) {
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) {
        P.kill(i);
        continue;
      }
      P.px[i] += P.vx[i] * dt;
      P.py[i] += P.vy[i] * dt;
      P.pz[i] += P.vz[i] * dt;
      const life = P.age[i] / P.life[i];
      const sc = P.size[i] * (0.5 + life * 0.9) * (1 - life * life);
      _p.set(P.px[i], P.py[i], P.pz[i]);
      _q.identity();
      _s.set(sc, sc, sc);
      P.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    P.commit();

    // Unload cascade: bin → hopper arcs.
    let n = 0;
    for (let i = this.cascade.length - 1; i >= 0; i--) {
      const c = this.cascade[i];
      c.age += dt;
      if (c.age >= c.life) {
        this.cascade[i] = this.cascade[this.cascade.length - 1];
        this.cascade.pop();
      }
    }
    for (const c of this.cascade) {
      const t = c.age / c.life;
      const x = c.fx + (c.tx - c.fx) * t;
      const z = c.fz + (c.tz - c.fz) * t;
      const y = c.fy + (c.ty - c.fy) * t + Math.sin(t * Math.PI) * 0.9;
      _p.set(x, y, z);
      _e.set(c.spin * c.age, c.spin * 0.6 * c.age, 0);
      _q.setFromEuler(_e);
      const sc = 1.2 * (t > 0.85 ? (1 - t) / 0.15 : 1);
      _s.set(sc, sc, sc);
      this.cascadeMesh.setMatrixAt(n, _m.compose(_p, _q, _s));
      this.cascadeMesh.setColorAt(n, c.color);
      n++;
    }
    this.cascadeMesh.count = n;
    if (n > 0) {
      this.cascadeMesh.instanceMatrix.needsUpdate = true;
      this.cascadeMesh.instanceColor!.needsUpdate = true;
    }
  }

  clearAll(): void {
    this.shards.clear();
    this.sparkles.clear();
    this.confetti.clear();
    this.puffs.clear();
    this.cascade.length = 0;
    this.cascadeMesh.count = 0;
    this.flights.count = 0;
  }
}
