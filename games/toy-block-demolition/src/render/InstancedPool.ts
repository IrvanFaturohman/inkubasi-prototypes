import * as THREE from 'three';

/**
 * Compact InstancedMesh with stable external keys.
 * Removal swaps the last instance into the freed slot and fixes both index maps,
 * so compaction never corrupts the key ↔ instance mapping.
 */
export class InstancedPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly indexOf: Int32Array;
  private readonly keyAt: Int32Array;
  private dirtyMatrix = false;
  private dirtyColor = false;
  count = 0;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number, keySpace: number, withColor: boolean) {
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, capacity));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (withColor) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3).fill(1), 3);
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    this.indexOf = new Int32Array(keySpace).fill(-1);
    this.keyAt = new Int32Array(Math.max(1, capacity)).fill(-1);
  }

  get capacity(): number {
    return this.keyAt.length;
  }

  has(key: number): boolean {
    return this.indexOf[key] >= 0;
  }

  add(key: number, m: THREE.Matrix4, color?: THREE.Color): boolean {
    if (this.indexOf[key] >= 0) {
      this.setMatrix(key, m);
      if (color) this.setColor(key, color);
      return true;
    }
    if (this.count >= this.keyAt.length) return false;
    const idx = this.count++;
    this.indexOf[key] = idx;
    this.keyAt[idx] = key;
    this.mesh.setMatrixAt(idx, m);
    if (color && this.mesh.instanceColor) {
      this.mesh.setColorAt(idx, color);
      this.dirtyColor = true;
    }
    this.mesh.count = this.count;
    this.dirtyMatrix = true;
    return true;
  }

  remove(key: number): void {
    const idx = this.indexOf[key];
    if (idx < 0) return;
    const last = this.count - 1;
    if (idx !== last) {
      const ma = this.mesh.instanceMatrix.array as Float32Array;
      ma.copyWithin(idx * 16, last * 16, last * 16 + 16);
      if (this.mesh.instanceColor) {
        const ca = this.mesh.instanceColor.array as Float32Array;
        ca.copyWithin(idx * 3, last * 3, last * 3 + 3);
        this.dirtyColor = true;
      }
      const movedKey = this.keyAt[last];
      this.keyAt[idx] = movedKey;
      this.indexOf[movedKey] = idx;
    }
    this.keyAt[last] = -1;
    this.indexOf[key] = -1;
    this.count--;
    this.mesh.count = this.count;
    this.dirtyMatrix = true;
  }

  setMatrix(key: number, m: THREE.Matrix4): void {
    const idx = this.indexOf[key];
    if (idx < 0) return;
    this.mesh.setMatrixAt(idx, m);
    this.dirtyMatrix = true;
  }

  getMatrix(key: number, out: THREE.Matrix4): boolean {
    const idx = this.indexOf[key];
    if (idx < 0) return false;
    this.mesh.getMatrixAt(idx, out);
    return true;
  }

  setColor(key: number, c: THREE.Color): void {
    const idx = this.indexOf[key];
    if (idx < 0 || !this.mesh.instanceColor) return;
    this.mesh.setColorAt(idx, c);
    this.dirtyColor = true;
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) this.indexOf[this.keyAt[i]] = -1;
    this.keyAt.fill(-1);
    this.count = 0;
    this.mesh.count = 0;
    this.dirtyMatrix = true;
  }

  flush(): void {
    if (this.dirtyMatrix) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirtyMatrix = false;
    }
    if (this.dirtyColor && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
      this.dirtyColor = false;
    }
  }

  /** Releases the per-instance buffers (geometry/material are shared and kept). */
  dispose(): void {
    this.mesh.dispose();
  }
}
