import * as THREE from 'three';
import type { StageMapping, TrackPath } from '../game/track';
import type { Vec2 } from '../game/types';
import { cbox, ccyl, mergeFlat } from './geom';
import { SHARED, type ThemePalette } from './palette';

const HALF_W = 0.66;
const CURB_W = 0.15;
const CURB_H = 0.07;
const SAMPLE = 0.12;
const MAX_CHEVRONS = 48;
const MAX_BUSHES = 90;

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Pastikan tiap segitiga menghadap searah normal yang diinginkan (hindari sisi belakang
 * yang dirender gelap karena normalnya dibalik oleh DoubleSide).
 */
function fixWinding(pos: THREE.BufferAttribute, nor: THREE.BufferAttribute, col: THREE.BufferAttribute): void {
  const p = pos.array as Float32Array;
  const n = nor.array as Float32Array;
  const c = col.array as Float32Array;
  for (let t = 0; t < pos.count; t += 3) {
    const o = t * 3;
    const ax = p[o + 3] - p[o];
    const ay = p[o + 4] - p[o + 1];
    const az = p[o + 5] - p[o + 2];
    const bx = p[o + 6] - p[o];
    const by = p[o + 7] - p[o + 1];
    const bz = p[o + 8] - p[o + 2];
    const gx = ay * bz - az * by;
    const gy = az * bx - ax * bz;
    const gz = ax * by - ay * bx;
    if (gx * n[o] + gy * n[o + 1] + gz * n[o + 2] < 0) {
      for (const arr of [p, n, c]) {
        for (let k = 0; k < 3; k++) {
          const tmp = arr[o + 3 + k];
          arr[o + 3 + k] = arr[o + 6 + k];
          arr[o + 6 + k] = tmp;
        }
      }
    }
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function roadTexture(p: ThemePalette): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = p.road;
  g.fillRect(0, 0, 64, 256);
  // bintik halus supaya tidak terlalu datar
  for (let i = 0; i < 260; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2);
  }
  g.fillStyle = p.roadEdge;
  g.fillRect(3, 0, 3, 256);
  g.fillRect(58, 0, 3, 256);
  g.fillStyle = p.roadDash;
  g.fillRect(29, 20, 6, 100);
  g.fillRect(29, 148, 6, 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function dropTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffcf3a';
  g.beginPath();
  g.roundRect(4, 4, 120, 120, 22);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 12;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const y of [48, 88]) {
    g.beginPath();
    g.moveTo(34, y + 16);
    g.lineTo(64, y - 14);
    g.lineTo(94, y + 16);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TrackView {
  readonly group = new THREE.Group();
  private track: TrackPath;
  private morph: { from: TrackPath; inv: StageMapping; t: number; dur: number } | null = null;
  private N = 0;
  private xs = new Float32Array(0);
  private zs = new Float32Array(0);
  private readonly road: THREE.Mesh;
  private readonly curbs: THREE.Mesh;
  private readonly chevrons: THREE.InstancedMesh;
  private readonly bushes: THREE.InstancedMesh;
  private bushDs: number[] = [];
  private bushScale: number[] = [];
  private readonly gate = new THREE.Group();
  private readonly dropZone: THREE.Mesh;
  private gatePulse = 0;
  private time = 0;
  private readonly roadTex: THREE.CanvasTexture;

  constructor(
    readonly palette: ThemePalette,
    track: TrackPath,
    private exclusions: Vec2[],
    opts: { gate?: boolean } = {},
  ) {
    this.track = track;
    this.roadTex = roadTexture(palette);
    this.road = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.92 }));
    this.road.receiveShadow = true;
    this.curbs = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    this.curbs.receiveShadow = true;
    this.curbs.castShadow = false;

    const chevShape = new THREE.Shape();
    chevShape.moveTo(-0.16, -0.2);
    chevShape.lineTo(0.12, 0);
    chevShape.lineTo(-0.16, 0.2);
    chevShape.lineTo(-0.06, 0);
    chevShape.closePath();
    const chevGeo = new THREE.ShapeGeometry(chevShape);
    chevGeo.rotateX(-Math.PI / 2);
    _c.set(palette.roadDash).lerp(new THREE.Color(palette.road), 0.45);
    this.chevrons = new THREE.InstancedMesh(chevGeo, new THREE.MeshBasicMaterial({ color: _c.clone(), transparent: true, opacity: 0.85 }), MAX_CHEVRONS);
    this.chevrons.frustumCulled = false;

    const bushGeo = new THREE.IcosahedronGeometry(0.34, 1);
    this.bushes = new THREE.InstancedMesh(bushGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), MAX_BUSHES);
    this.bushes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BUSHES * 3), 3);
    for (let i = 0; i < MAX_BUSHES; i++) {
      _c.set(palette.bush[i % palette.bush.length]);
      this.bushes.setColorAt(i, _c);
    }
    this.bushes.castShadow = true;
    this.bushes.frustumCulled = false;

    this.dropZone = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 * 0.9, 0.9), new THREE.MeshBasicMaterial({ map: dropTexture(), transparent: true }));
    this.dropZone.rotation.x = -Math.PI / 2;

    this.group.add(this.road, this.curbs, this.chevrons, this.bushes);
    if (opts.gate ?? true) {
      this.group.add(this.gate);
      this.buildGate();
    }
    this.rebuildBushList();
    this.resample();
    this.writeGeometry();
  }

  get length(): number {
    return this.track.length;
  }

  get isMorphing(): boolean {
    return this.morph !== null;
  }

  setExclusions(ex: Vec2[]): void {
    this.exclusions = ex;
  }

  /** Mulai animasi lintasan membesar: bentuk lama → baru dengan pemetaan jarak. */
  startMorph(from: TrackPath, to: TrackPath, inv: StageMapping, duration: number): void {
    this.track = to;
    this.morph = { from, inv, t: 0, dur: duration };
    this.rebuildBushList();
    this.resample();
    this.writeGeometry();
  }

  setTrack(track: TrackPath): void {
    this.track = track;
    this.morph = null;
    this.rebuildBushList();
    this.resample();
    this.writeGeometry();
  }

  /** Posisi dunia di jarak d (memperhitungkan morph yang sedang berjalan). */
  pointAt(d: number, out: THREE.Vector3): THREE.Vector3 {
    if (!this.morph) {
      const p = this.track.pointAt(d);
      return out.set(p.x, 0, p.z);
    }
    const L = this.track.length;
    let u = ((((d % L) + L) % L) / L) * this.N;
    const i = Math.min(this.N - 1, Math.floor(u));
    u -= i;
    return out.set(this.xs[i] + (this.xs[i + 1] - this.xs[i]) * u, 0, this.zs[i] + (this.zs[i + 1] - this.zs[i]) * u);
  }

  tangentAt(d: number, out: THREE.Vector3): THREE.Vector3 {
    if (!this.morph) {
      const t = this.track.tangentAt(d);
      return out.set(t.x, 0, t.z);
    }
    const a = this.pointAt(d - 0.08, _p.clone());
    const b = this.pointAt(d + 0.08, out);
    return out.set(b.x - a.x, 0, b.z - a.z).normalize();
  }

  outwardAt(d: number, out: THREE.Vector3): THREE.Vector3 {
    const t = this.tangentAt(d, out);
    const s = this.track.clockwise ? 1 : -1;
    return out.set(t.z * s, 0, -t.x * s);
  }

  pulseGate(strength = 1): void {
    this.gatePulse = Math.min(1.5, Math.max(this.gatePulse, 0.6 + strength * 0.4));
  }

  update(dt: number): void {
    this.time += dt;
    if (this.morph) {
      this.morph.t += dt / this.morph.dur;
      if (this.morph.t >= 1) this.morph = null;
      this.resample();
      this.writeGeometry();
    }
    if (this.gatePulse > 0) {
      this.gatePulse = Math.max(0, this.gatePulse - dt * 2.5);
      const k = Math.sin(this.gatePulse * Math.PI * 2) * this.gatePulse * 0.12;
      this.gate.scale.set(1 + k, 1 - k, 1 + k);
      (this.dropZone.material as THREE.MeshBasicMaterial).color.setScalar(1 + this.gatePulse * 0.35);
    }
  }

  // -------------------------------------------------------------------------

  private resample(): void {
    const L = this.track.length;
    const N = Math.max(60, Math.ceil(L / SAMPLE));
    if (N !== this.N) {
      this.N = N;
      this.xs = new Float32Array(N + 1);
      this.zs = new Float32Array(N + 1);
    }
    const e = this.morph ? easeInOut(Math.min(1, this.morph.t)) : 1;
    for (let i = 0; i <= N; i++) {
      const d = (i / N) * L;
      const p = this.track.pointAt(d);
      if (this.morph && e < 1) {
        const o = this.morph.from.pointAt(this.morph.inv.map(d));
        this.xs[i] = o.x + (p.x - o.x) * e;
        this.zs[i] = o.z + (p.z - o.z) * e;
      } else {
        this.xs[i] = p.x;
        this.zs[i] = p.z;
      }
    }
  }

  private writeGeometry(): void {
    const N = this.N;
    const xs = this.xs;
    const zs = this.zs;
    const L = this.track.length;
    const sgn = this.track.clockwise ? 1 : -1;
    const nx = new Float32Array(N + 1);
    const nz = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const a = i === 0 ? N - 1 : i - 1;
      const b = i === N ? 1 : i + 1;
      let tx = xs[b] - xs[a];
      let tz = zs[b] - zs[a];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      nx[i] = tz * sgn;
      nz[i] = -tx * sgn;
    }

    // --- Jalan (ribbon) ---
    const repeats = Math.max(1, Math.round(L / 2.2));
    let geo = this.road.geometry;
    if (!geo.getAttribute('position') || geo.getAttribute('position').count !== (N + 1) * 2) {
      geo.dispose();
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 6), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((N + 1) * 4), 2));
      const nor = new Float32Array((N + 1) * 6);
      for (let i = 0; i < (N + 1) * 2; i++) nor[i * 3 + 1] = 1;
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      // Winding menghadap ke atas: vertex 0 = sisi luar. Untuk loop searah jarum jam (di layar)
      // urutan (luar_i, dalam_i, luar_i+1) menghasilkan normal +y; loop berlawanan dibalik.
      const idx: number[] = [];
      for (let i = 0; i < N; i++) {
        const a = i * 2;
        if (this.track.clockwise) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      geo.setIndex(idx);
      this.road.geometry = geo;
    }
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i <= N; i++) {
      // vertex 0 = sisi luar, 1 = sisi dalam
      pos.setXYZ(i * 2, xs[i] + nx[i] * HALF_W, 0.012, zs[i] + nz[i] * HALF_W);
      pos.setXYZ(i * 2 + 1, xs[i] - nx[i] * HALF_W, 0.012, zs[i] - nz[i] * HALF_W);
      const v = (i / N) * repeats;
      uv.setXY(i * 2, 0, v);
      uv.setXY(i * 2 + 1, 1, v);
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    geo.computeBoundingSphere();

    // --- Kerb bergaris (dua sisi) ---
    const stripe = 5;
    const cA = new THREE.Color(this.palette.curbA);
    const cB = new THREE.Color(this.palette.curbB);
    const vertsPerSeg = 18;
    const count = N * 2 * vertsPerSeg;
    let cg = this.curbs.geometry;
    if (!cg.getAttribute('position') || cg.getAttribute('position').count !== count) {
      cg.dispose();
      cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      cg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      cg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      this.curbs.geometry = cg;
    }
    const cp = cg.getAttribute('position') as THREE.BufferAttribute;
    const cn = cg.getAttribute('normal') as THREE.BufferAttribute;
    const cc = cg.getAttribute('color') as THREE.BufferAttribute;
    let w = 0;
    const put = (x: number, y: number, z: number, nxv: number, nyv: number, nzv: number, col: THREE.Color) => {
      cp.setXYZ(w, x, y, z);
      cn.setXYZ(w, nxv, nyv, nzv);
      cc.setXYZ(w, col.r, col.g, col.b);
      w++;
    };
    for (const side of [1, -1]) {
      const r0 = HALF_W;
      const r1 = HALF_W + CURB_W;
      for (let i = 0; i < N; i++) {
        const col = Math.floor(i / stripe) % 2 === 0 ? cA : cB;
        const j = i + 1;
        const ax0 = xs[i] + nx[i] * r0 * side;
        const az0 = zs[i] + nz[i] * r0 * side;
        const ax1 = xs[i] + nx[i] * r1 * side;
        const az1 = zs[i] + nz[i] * r1 * side;
        const bx0 = xs[j] + nx[j] * r0 * side;
        const bz0 = zs[j] + nz[j] * r0 * side;
        const bx1 = xs[j] + nx[j] * r1 * side;
        const bz1 = zs[j] + nz[j] * r1 * side;
        const h = CURB_H;
        // atas (urutan CCW dilihat dari atas bergantung sisi)
        const top = side * sgn > 0 ? [ax0, az0, bx0, bz0, ax1, az1, ax1, az1, bx0, bz0, bx1, bz1] : [ax0, az0, ax1, az1, bx0, bz0, ax1, az1, bx1, bz1, bx0, bz0];
        for (let k = 0; k < 12; k += 2) put(top[k], h, top[k + 1], 0, 1, 0, col);
        // dinding luar (menghadap menjauhi jalan)
        const ox = nx[i] * side;
        const oz = nz[i] * side;
        const outer = side * sgn > 0 ? [ax1, 0, az1, ax1, h, az1, bx1, 0, bz1, bx1, 0, bz1, ax1, h, az1, bx1, h, bz1] : [ax1, 0, az1, bx1, 0, bz1, ax1, h, az1, bx1, 0, bz1, bx1, h, bz1, ax1, h, az1];
        for (let k = 0; k < 18; k += 3) put(outer[k], outer[k + 1], outer[k + 2], ox, 0, oz, col);
        // dinding dalam (menghadap jalan)
        const inner = side * sgn > 0 ? [ax0, 0, az0, bx0, 0, bz0, ax0, h, az0, bx0, 0, bz0, bx0, h, bz0, ax0, h, az0] : [ax0, 0, az0, ax0, h, az0, bx0, 0, bz0, bx0, 0, bz0, ax0, h, az0, bx0, h, bz0];
        for (let k = 0; k < 18; k += 3) put(inner[k], inner[k + 1], inner[k + 2], -ox, 0, -oz, col);
      }
    }
    fixWinding(cp, cn, cc);
    cp.needsUpdate = true;
    cn.needsUpdate = true;
    cc.needsUpdate = true;
    cg.computeBoundingSphere();

    // --- Panah arah ---
    const nChev = Math.min(MAX_CHEVRONS, Math.floor(L / 3));
    const tmp = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let k = 0; k < nChev; k++) {
      const d = ((k + 0.5) / nChev) * L;
      this.pointAt(d, tmp);
      this.tangentAt(d, tan);
      _q.setFromAxisAngle(_up, Math.atan2(-tan.z, tan.x));
      _s.set(1, 1, 1);
      tmp.y = 0.02;
      _m.compose(tmp, _q, _s);
      this.chevrons.setMatrixAt(k, _m);
    }
    this.chevrons.count = nChev;
    this.chevrons.instanceMatrix.needsUpdate = true;

    // --- Semak pembatas di sisi luar ---
    const out = new THREE.Vector3();
    const e = this.morph ? Math.min(1, this.morph.t) : 1;
    const wobble = this.morph ? Math.sin(e * Math.PI) : 0;
    for (let k = 0; k < this.bushDs.length; k++) {
      const d = this.bushDs[k];
      this.pointAt(d, tmp);
      this.outwardAt(d, out);
      tmp.addScaledVector(out, HALF_W + CURB_W + 0.42 + (k % 3) * 0.08);
      const s = this.bushScale[k] * (1 - wobble * 0.25);
      tmp.y = 0.18 * s;
      _q.setFromAxisAngle(_up, k * 1.7);
      _s.set(s * 1.1, s * (0.85 + wobble * 0.3), s * 1.1);
      _m.compose(tmp, _q, _s);
      this.bushes.setMatrixAt(k, _m);
    }
    this.bushes.count = this.bushDs.length;
    this.bushes.instanceMatrix.needsUpdate = true;
  }

  private rebuildBushList(): void {
    const L = this.track.length;
    this.bushDs = [];
    this.bushScale = [];
    const step = 1.3;
    const n = Math.floor(L / step);
    const tmp = { x: 0, z: 0 };
    const o = { x: 0, z: 0 };
    for (let k = 0; k < n && this.bushDs.length < MAX_BUSHES; k++) {
      const d = (k + 0.5) * (L / n);
      if (d < 0.6 || d > L - 0.6) continue;
      this.track.pointAt(d, tmp);
      this.track.outwardAt(d, o);
      const bx = tmp.x + o.x * 1.3;
      const bz = tmp.z + o.z * 1.3;
      if (this.exclusions.some((ex) => Math.hypot(ex.x - bx, ex.z - bz) < 1.9)) continue;
      this.bushDs.push(d);
      this.bushScale.push(0.75 + ((k * 37) % 10) / 30);
    }
  }

  private buildGate(): void {
    const p = this.track.pointAt(0);
    const t = this.track.tangentAt(0);
    const s = this.track.clockwise ? 1 : -1;
    const n = { x: t.z * s, z: -t.x * s };
    this.gate.position.set(p.x, 0, p.z);
    this.gate.rotation.y = Math.atan2(-t.z, t.x);
    // Lokal: x = arah jalan, z = ke dalam loop (karena rotasi), jadi pakai offset dunia via normal.
    const post = (side: number) => {
      const g = mergeFlat([
        ccyl(0.07, 1.25, '#ffffff', 10, 0, 0.62, 0),
        ccyl(0.1, 0.06, '#e8e2d4', 10, 0, 0.03, 0),
        cbox(0.5, 0.3, 0.04, side > 0 ? '#ff5a5f' : '#ffcf3a', 0.26, 1.08, 0, 0.02),
        ccyl(0.09, 0.09, '#ffcf3a', 10, 0, 1.28, 0),
      ]);
      const m = new THREE.Mesh(g, SHARED.vertexStd);
      m.castShadow = true;
      // letakkan di sisi jalan memakai normal dunia, lalu konversi ke lokal gate
      const wx = n.x * (HALF_W + CURB_W + 0.18) * side;
      const wz = n.z * (HALF_W + CURB_W + 0.18) * side;
      const local = new THREE.Vector3(wx, 0, wz).applyAxisAngle(_up, -this.gate.rotation.y);
      m.position.copy(local);
      return m;
    };
    this.gate.add(post(1), post(-1));
    this.dropZone.position.set(0, 0.022, 0);
    // Panah di tekstur (arah "atas" tekstur) diarahkan ke luar loop, yaitu ke bangunan.
    // Euler XYZ: R = Rx(-90°)·Rz(φ) memetakan atas tekstur ke (-sin φ, 0, -cos φ).
    const localN = new THREE.Vector3(n.x, 0, n.z).applyAxisAngle(_up, -this.gate.rotation.y);
    this.dropZone.rotation.set(-Math.PI / 2, 0, Math.atan2(-localN.x, -localN.z));
    this.gate.add(this.dropZone);
  }

  dispose(): void {
    this.road.geometry.dispose();
    this.curbs.geometry.dispose();
    this.roadTex.dispose();
  }
}
