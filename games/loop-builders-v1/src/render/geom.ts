import * as THREE from 'three';
import type { Prim } from '../game/types';

/**
 * Helper geometri modular. Semua geometri yang dihasilkan NON-INDEXED dengan atribut
 * position + normal (+ color untuk versi solid), sehingga bisa digabung cepat dengan mergeFlat().
 */

const _c = new THREE.Color();

/** Kotak dengan tepi di-chamfer (look mainan) — 44 segitiga, normal datar. */
export function chamferBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const a = w / 2;
  const b = h / 2;
  const c = d / 2;
  r = Math.min(r, a * 0.45, b * 0.45, c * 0.45);
  if (r <= 0.0005) return new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const P = (sx: number, sy: number, sz: number, which: 'x' | 'y' | 'z'): THREE.Vector3 =>
    which === 'x'
      ? new THREE.Vector3(sx * a, sy * (b - r), sz * (c - r))
      : which === 'y'
        ? new THREE.Vector3(sx * (a - r), sy * b, sz * (c - r))
        : new THREE.Vector3(sx * (a - r), sy * (b - r), sz * c);
  const tris: THREE.Vector3[] = [];
  const quad = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) => {
    tris.push(p0, p1, p2, p0, p2, p3);
  };
  const S = [1, -1];
  // Sisi utama
  for (const s of S) {
    quad(P(s, 1, 1, 'x'), P(s, -1, 1, 'x'), P(s, -1, -1, 'x'), P(s, 1, -1, 'x'));
    quad(P(1, s, 1, 'y'), P(-1, s, 1, 'y'), P(-1, s, -1, 'y'), P(1, s, -1, 'y'));
    quad(P(1, 1, s, 'z'), P(-1, 1, s, 'z'), P(-1, -1, s, 'z'), P(1, -1, s, 'z'));
  }
  // Bevel tepi
  for (const s1 of S) {
    for (const s2 of S) {
      quad(P(s1, s2, 1, 'x'), P(s1, s2, 1, 'y'), P(s1, s2, -1, 'y'), P(s1, s2, -1, 'x')); // x-y, sepanjang z
      quad(P(s1, 1, s2, 'x'), P(s1, 1, s2, 'z'), P(s1, -1, s2, 'z'), P(s1, -1, s2, 'x')); // x-z, sepanjang y
      quad(P(1, s1, s2, 'y'), P(1, s1, s2, 'z'), P(-1, s1, s2, 'z'), P(-1, s1, s2, 'y')); // y-z, sepanjang x
    }
  }
  // Sudut
  for (const sx of S) for (const sy of S) for (const sz of S) tris.push(P(sx, sy, sz, 'x'), P(sx, sy, sz, 'y'), P(sx, sy, sz, 'z'));

  const pos = new Float32Array(tris.length * 3);
  const nor = new Float32Array(tris.length * 3);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const cen = new THREE.Vector3();
  for (let i = 0; i < tris.length; i += 3) {
    let p0 = tris[i];
    let p1 = tris[i + 1];
    const p2 = tris[i + 2];
    e1.subVectors(p1, p0);
    e2.subVectors(p2, p0);
    n.crossVectors(e1, e2);
    cen.copy(p0).add(p1).add(p2);
    if (n.dot(cen) < 0) {
      [p0, p1] = [p1, p0];
      n.negate();
    }
    n.normalize();
    const list = [p0, p1, p2];
    for (let k = 0; k < 3; k++) {
      const o = (i + k) * 3;
      pos[o] = list[k].x;
      pos[o + 1] = list[k].y;
      pos[o + 2] = list[k].z;
      nor[o] = n.x;
      nor[o + 1] = n.y;
      nor[o + 2] = n.z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** Prisma segitiga: alas w (x), tinggi h (y), tebal d (z), alas di y=0. */
export function prismGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g.index ? g.toNonIndexed() : g;
}

function stripToPN(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', ng.getAttribute('position'));
  out.setAttribute('normal', ng.getAttribute('normal'));
  return out;
}

/** Mewarnai geometri; untuk batang kayu, sisi tutup (normal searah sumbu) diberi warna serat. */
export function paint(g: THREE.BufferGeometry, color: string, capColor?: string, capAxis?: 'x' | 'y' | 'z'): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  _c.set(color);
  const base = [_c.r, _c.g, _c.b];
  let cap = base;
  if (capColor) {
    _c.set(capColor);
    cap = [_c.r, _c.g, _c.b];
  }
  const ai = capAxis === 'x' ? 0 : capAxis === 'z' ? 2 : 1;
  for (let i = 0; i < pos.count; i++) {
    const isCap = capColor && Math.abs((nor.array as Float32Array)[i * 3 + ai]) > 0.9;
    const c = isCap ? cap : base;
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Geometri satu primitive bangunan, sudah ditransformasi ke koordinat lokal bangunan. */
export function primGeometry(prim: Prim, ghost: boolean): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  let rot: [number, number, number] | undefined;
  switch (prim.kind) {
    case 'box': {
      const [w, h, d] = prim.s;
      g = ghost ? new THREE.BoxGeometry(w, h, d).toNonIndexed() : chamferBox(w, h, d, prim.round ?? 0.03);
      g = stripToPN(g);
      if (!ghost) paint(g, prim.c);
      rot = prim.r;
      break;
    }
    case 'cyl': {
      const seg = ghost ? 8 : (prim.seg ?? 10);
      g = stripToPN(new THREE.CylinderGeometry(prim.radius, prim.radius, prim.len, seg, 1));
      if (!ghost) paint(g, prim.c, prim.cap, 'y');
      if (prim.axis === 'x') rot = [0, 0, Math.PI / 2];
      else if (prim.axis === 'z') rot = [Math.PI / 2, 0, 0];
      break;
    }
    case 'prism': {
      g = stripToPN(prismGeometry(prim.w, prim.h, prim.d));
      if (!ghost) paint(g, prim.c);
      rot = prim.r;
      break;
    }
    case 'sphere': {
      g = stripToPN(new THREE.IcosahedronGeometry(prim.radius, ghost ? 0 : 1));
      if (!ghost) paint(g, prim.c);
      break;
    }
    case 'cone': {
      g = stripToPN(new THREE.ConeGeometry(prim.radius, prim.h, prim.seg ?? 8, 1));
      g.translate(0, prim.h / 2, 0);
      if (!ghost) paint(g, prim.c);
      break;
    }
  }
  _e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0);
  _q.setFromEuler(_e);
  _s.set(1, 1, 1);
  _p.set(prim.p[0], prim.p[1], prim.p[2]);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

/** Menggabungkan geometri non-indexed dengan atribut yang sama (cepat, tanpa validasi berat). */
export function mergeFlat(geoms: THREE.BufferGeometry[], attrs: string[] = ['position', 'normal', 'color']): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of attrs) {
    let total = 0;
    let itemSize = 3;
    for (const g of geoms) {
      const a = g.getAttribute(name);
      if (!a) continue;
      total += a.array.length;
      itemSize = a.itemSize;
    }
    const arr = new Float32Array(total);
    let off = 0;
    for (const g of geoms) {
      const a = g.getAttribute(name);
      if (!a) continue;
      arr.set(a.array as Float32Array, off);
      off += a.array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
  return out;
}

/** Geometri berwarna praktis untuk objek dunia (mesin, kendaraan, dekorasi). */
export function colored(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  return paint(stripToPN(g), color);
}

export function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _s.set(1, 1, 1);
  _p.set(x, y, z);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

/** Shortcut: kotak chamfer berwarna di posisi tertentu. */
export function cbox(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0, r = 0.04): THREE.BufferGeometry {
  return place(paint(stripToPN(chamferBox(w, h, d, r)), color), x, y, z);
}

export function ccyl(radius: number, len: number, color: string, seg = 12, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, cap?: string): THREE.BufferGeometry {
  return place(paint(stripToPN(new THREE.CylinderGeometry(radius, radius, len, seg, 1)), color, cap, 'y'), x, y, z, rx, ry, rz);
}
