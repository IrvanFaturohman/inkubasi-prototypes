import * as THREE from 'three';

/**
 * Kamera 3/4 dengan sedikit perspektif. Framing dihitung dengan "fit" titik-titik penting
 * (lintasan, stasiun, bangunan) ke area aman layar di antara HUD atas dan panel bawah,
 * lalu posisi kamera di-ease menuju framing tersebut. Bump/shake sangat ringan & meluruh cepat.
 */

export interface SafeArea {
  /** Batas NDC: kiri, kanan, bawah, atas. */
  xL: number;
  xR: number;
  yB: number;
  yT: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0.26;
  pitch = 0.93;
  private target = new THREE.Vector3();
  private distance = 30;
  private goalTarget = new THREE.Vector3();
  private goalDistance = 30;
  private goalYaw = 0.26;
  private goalPitch = 0.93;
  private ease = 2.5;
  private bumpVel = 0;
  private bumpPos = 0;
  private orbit = 0;
  private orbitSpeed = 0;
  private readonly tmpCam = new THREE.PerspectiveCamera();
  private bounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
  private minDist = 7;
  private maxDist = 80;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(32, aspect, 0.5, 200);
  }

  private dir(yaw: number, pitch: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  }

  /** Hitung framing yang memuat semua titik di area aman. */
  fit(points: THREE.Vector3[], safe: SafeArea, opts: { yaw?: number; pitch?: number; immediate?: boolean; ease?: number; orbit?: number } = {}): void {
    const yaw = opts.yaw ?? 0.26;
    const pitch = opts.pitch ?? 0.93;
    const cam = this.tmpCam;
    cam.fov = this.camera.fov;
    cam.aspect = this.camera.aspect;
    cam.near = this.camera.near;
    cam.far = this.camera.far;
    cam.updateProjectionMatrix();
    const target = new THREE.Vector3();
    for (const p of points) target.add(p);
    target.multiplyScalar(1 / Math.max(1, points.length));
    let dist = 25;
    const d = this.dir(yaw, pitch);
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const v = new THREE.Vector3();
    const safeW = safe.xR - safe.xL;
    const safeH = safe.yT - safe.yB;
    for (let iter = 0; iter < 24; iter++) {
      cam.position.copy(target).addScaledVector(d, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        v.copy(p).project(cam);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
      const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * dist;
      const halfW = halfH * cam.aspect;
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      const dx = (minX + maxX) / 2 - (safe.xL + safe.xR) / 2;
      const dy = (minY + maxY) / 2 - (safe.yB + safe.yT) / 2;
      target.addScaledVector(right, dx * halfW * 0.9);
      target.addScaledVector(up, dy * halfH * 0.9);
      const scale = Math.max((maxX - minX) / safeW, (maxY - minY) / safeH);
      dist *= 1 + (scale - 1) * 0.85;
      dist = THREE.MathUtils.clamp(dist, 6, 120);
    }
    this.goalTarget.copy(target);
    this.goalDistance = dist;
    this.goalYaw = yaw;
    this.goalPitch = pitch;
    this.ease = opts.ease ?? 2.5;
    this.orbitSpeed = opts.orbit ?? 0;
    if (!opts.orbit) this.orbit = 0;
    if (opts.immediate) {
      this.target.copy(target);
      this.distance = dist;
      this.yaw = yaw;
      this.pitch = pitch;
    }
  }

  get goalDist(): number {
    return this.goalDistance;
  }

  get currentDist(): number {
    return this.distance;
  }

  /** Batas geser kamera (titik tatap dibatasi di dalam kotak ini). */
  setBounds(b: { minX: number; maxX: number; minZ: number; maxZ: number }, maxDist: number): void {
    this.bounds = b;
    this.maxDist = Math.max(this.minDist + 1, maxDist);
  }

  /** Geser titik tatap (satuan dunia) — langsung responsif mengikuti jari. */
  shift(dx: number, dz: number): void {
    const b = this.bounds;
    const nx = THREE.MathUtils.clamp(this.goalTarget.x + dx, b.minX, b.maxX);
    const nz = THREE.MathUtils.clamp(this.goalTarget.z + dz, b.minZ, b.maxZ);
    this.target.x += nx - this.goalTarget.x;
    this.target.z += nz - this.goalTarget.z;
    this.goalTarget.x = nx;
    this.goalTarget.z = nz;
    this.orbitSpeed = 0;
  }

  /** Zoom (f < 1 mendekat). */
  zoom(f: number): void {
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * f, this.minDist, this.maxDist);
    this.distance = THREE.MathUtils.clamp(this.distance * f, this.minDist, this.maxDist);
  }

  /** Sentakan kecil (misal saat bongkar muatan besar). */
  bump(strength: number): void {
    this.bumpVel -= Math.min(0.9, strength);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-this.ease * dt);
    this.target.lerp(this.goalTarget, k);
    this.distance += (this.goalDistance - this.distance) * k;
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.orbit += this.orbitSpeed * dt;
    // pegas teredam untuk bump
    this.bumpVel += (-this.bumpPos * 180 - this.bumpVel * 16) * dt;
    this.bumpPos += this.bumpVel * dt;
    const d = this.dir(this.yaw + Math.sin(this.orbit) * 0.35, this.pitch);
    this.camera.position.copy(this.target).addScaledVector(d, this.distance);
    this.camera.position.y += this.bumpPos * 0.35;
    this.camera.lookAt(this.target.x, this.target.y + this.bumpPos * 0.12, this.target.z);
  }
}
