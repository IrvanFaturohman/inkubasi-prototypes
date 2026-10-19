/**
 * Procedural low-poly models. Parts are merged into vertex-coloured geometries so each
 * harvester is a handful of draw calls, and crops are InstancedMeshes (see scene3d.ts).
 * Shared geometries/materials are cached here and never disposed with a field view.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TIERS } from './config';
import type { Tier } from './types';

type V3 = [number, number, number];

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();

/** Collects coloured parts and merges them into one geometry. Consumes the geometries passed in. */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];

  add(geom: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 | number = 1): this {
    tmpE.set(rot[0], rot[1], rot[2]);
    tmpQ.setFromEuler(tmpE);
    if (typeof scale === 'number') tmpS.set(scale, scale, scale);
    else tmpS.set(scale[0], scale[1], scale[2]);
    tmpP.set(pos[0], pos[1], pos[2]);
    tmpM.compose(tmpP, tmpQ, tmpS);
    return this.addMatrix(geom, color, tmpM);
  }

  addMatrix(geom: THREE.BufferGeometry, color: THREE.ColorRepresentation, m: THREE.Matrix4): this {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    geom.dispose();
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
    g.applyMatrix4(m);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    tmpC.set(color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpC.r;
      col[i * 3 + 1] = tmpC.g;
      col[i * 3 + 2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) throw new Error('merge failed');
    merged.computeBoundingSphere();
    return merged;
  }
}

const shared = new Set<THREE.BufferGeometry | THREE.Material>();
const markShared = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
  shared.add(x);
  return x;
};
export const isShared = (x: THREE.BufferGeometry | THREE.Material): boolean => shared.has(x);

// ─── Materials ──────────────────────────────────────────────────────────────

let vcolMat: THREE.MeshLambertMaterial | null = null;
/** Shared matte vertex-colour material (flat shaded for the low-poly look). */
export function vertexMat(): THREE.MeshLambertMaterial {
  if (!vcolMat) vcolMat = markShared(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  return vcolMat;
}

const colorMats = new Map<string, THREE.MeshLambertMaterial>();
export function colorMat(hex: string): THREE.MeshLambertMaterial {
  let m = colorMats.get(hex);
  if (!m) {
    m = markShared(new THREE.MeshLambertMaterial({ color: hex, flatShading: true }));
    colorMats.set(hex, m);
  }
  return m;
}

// ─── Colours ────────────────────────────────────────────────────────────────

export const COL = {
  dark: '#4a4e57',
  metal: '#7d838e',
  glass: '#bfe6ee',
  tire: '#3a3d44',
  hub: '#f3ead8',
  wood: '#a8683c',
  woodDark: '#8a522c',
  light: '#fff8e0',
  beacon: '#ffcf3f',
  siloBody: '#3db3aa',
  siloRing: '#86dbd2',
  siloRoof: '#2a8e9a',
  siloBase: '#e7dcc6',
  cream: '#f3ead8',
  water: '#7cc7ea',
};

// ─── Harvester ──────────────────────────────────────────────────────────────

interface HarvesterGeoms {
  body: THREE.BufferGeometry;
  header: THREE.BufferGeometry;
  frontWheel: THREE.BufferGeometry;
  rearWheel: THREE.BufferGeometry;
  reel: THREE.BufferGeometry;
}
const harvesterCache = new Map<Tier, HarvesterGeoms>();

export const HARVESTER_DIMS = {
  frontWheel: { r: 0.27, x: 0.22, z: 0.4, w: 0.16 },
  rearWheel: { r: 0.19, x: -0.38, z: 0.36, w: 0.14 },
  crate: { x: -0.3, y: 0.67 },
  headerX: 0.72,
  reelY: 0.33,
};

function wheelGeom(r: number, w: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CylinderGeometry(r, r, w, 12), COL.tire, [0, 0, 0], [Math.PI / 2, 0, 0]);
  b.add(new THREE.CylinderGeometry(r * 0.52, r * 0.52, w + 0.02, 5), COL.hub, [0, 0, 0], [Math.PI / 2, 0, 0]);
  b.add(new THREE.BoxGeometry(r * 0.35, r * 1.5, w * 0.4), COL.hub, [0, 0, 0]);
  return markShared(b.build());
}

function harvesterGeoms(tier: Tier): HarvesterGeoms {
  const cached = harvesterCache.get(tier);
  if (cached) return cached;
  const def = TIERS[tier - 1];
  const s = def.scale;
  const W = def.headerWidth / s; // header width in local (pre-scale) units
  const body = def.body;
  const trim = def.trim;
  const D = HARVESTER_DIMS;
  const b = new GeoBuilder();
  // Chassis & body
  b.add(new THREE.BoxGeometry(0.9, 0.1, 0.5), COL.dark, [-0.06, 0.27, 0]);
  b.add(new RoundedBoxGeometry(1.0, 0.38, 0.64, 2, 0.08), body, [-0.06, 0.49, 0]);
  b.add(new RoundedBoxGeometry(0.34, 0.14, 0.56, 2, 0.05), body, [0.26, 0.7, 0]);
  // stripes
  b.add(new THREE.BoxGeometry(0.92, 0.05, 0.012), trim, [-0.06, 0.52, 0.322]);
  b.add(new THREE.BoxGeometry(0.92, 0.05, 0.012), trim, [-0.06, 0.52, -0.322]);
  if (tier >= 3) {
    b.add(new THREE.BoxGeometry(0.92, 0.03, 0.012), trim, [-0.06, 0.42, 0.322]);
    b.add(new THREE.BoxGeometry(0.92, 0.03, 0.012), trim, [-0.06, 0.42, -0.322]);
  }
  // Cabin
  b.add(new RoundedBoxGeometry(0.38, 0.32, 0.5, 2, 0.05), COL.glass, [0.22, 0.9, 0]);
  b.add(new THREE.BoxGeometry(0.04, 0.32, 0.52), body, [0.05, 0.9, 0]);
  b.add(new RoundedBoxGeometry(0.46, 0.07, 0.58, 2, 0.03), trim, [0.22, 1.09, 0]);
  // Headlights
  b.add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 8), COL.light, [0.45, 0.6, 0.2], [0, 0, Math.PI / 2]);
  b.add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 8), COL.light, [0.45, 0.6, -0.2], [0, 0, Math.PI / 2]);
  // Exhaust(s)
  const ex = (z: number) => {
    b.add(new THREE.CylinderGeometry(0.03, 0.035, 0.34, 6), COL.dark, [-0.05, 0.84, z]);
    b.add(new THREE.CylinderGeometry(0.045, 0.04, 0.05, 6), COL.dark, [-0.05, 1.02, z]);
  };
  ex(-0.2);
  if (tier >= 3) ex(0.2);
  // Beacons
  if (tier >= 2) b.add(new THREE.SphereGeometry(0.055, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), COL.beacon, [0.14, 1.12, 0.17]);
  if (tier >= 3) b.add(new THREE.SphereGeometry(0.055, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), COL.beacon, [0.14, 1.12, -0.17]);
  // Crate (open top, wooden)
  const cx = D.crate.x;
  const cy = D.crate.y;
  const wallH = tier >= 3 ? 0.24 : 0.2;
  b.add(new THREE.BoxGeometry(0.46, 0.04, 0.56), COL.woodDark, [cx, cy, 0]);
  b.add(new THREE.BoxGeometry(0.04, wallH, 0.56), COL.wood, [cx + 0.21, cy + wallH / 2, 0]);
  b.add(new THREE.BoxGeometry(0.04, wallH, 0.56), COL.wood, [cx - 0.21, cy + wallH / 2, 0]);
  b.add(new THREE.BoxGeometry(0.46, wallH, 0.04), COL.wood, [cx, cy + wallH / 2, 0.26]);
  b.add(new THREE.BoxGeometry(0.46, wallH, 0.04), COL.wood, [cx, cy + wallH / 2, -0.26]);
  b.add(new THREE.BoxGeometry(0.5, 0.03, 0.04), trim, [cx, cy + wallH, 0.27]);
  b.add(new THREE.BoxGeometry(0.5, 0.03, 0.04), trim, [cx, cy + wallH, -0.27]);
  // Feeder house connecting header and body
  b.add(new THREE.BoxGeometry(0.24, 0.16, 0.34), COL.metal, [0.52, 0.33, 0]);
  const bodyGeom = markShared(b.build());

  // Header (cutting platform) — width equals real reach. Separate mesh so it can fold
  // for road travel (U-turns / return road) like a real combine.
  const hb = new GeoBuilder();
  const hx = D.headerX;
  hb.add(new THREE.BoxGeometry(0.36, 0.06, W), COL.metal, [hx + 0.08, 0.12, 0]);
  hb.add(new THREE.BoxGeometry(0.05, 0.24, W), body, [hx - 0.08, 0.25, 0]);
  hb.add(new THREE.BoxGeometry(0.09, 0.04, W), trim, [hx - 0.06, 0.38, 0]);
  hb.add(new THREE.BoxGeometry(0.36, 0.22, 0.03), body, [hx + 0.08, 0.21, W / 2]);
  hb.add(new THREE.BoxGeometry(0.36, 0.22, 0.03), body, [hx + 0.08, 0.21, -W / 2]);
  hb.add(new THREE.ConeGeometry(0.05, 0.22, 4), trim, [hx + 0.3, 0.13, W / 2], [0, 0, -Math.PI / 2]);
  hb.add(new THREE.ConeGeometry(0.05, 0.22, 4), trim, [hx + 0.3, 0.13, -W / 2], [0, 0, -Math.PI / 2]);
  hb.add(new THREE.BoxGeometry(0.035, 0.035, W), COL.dark, [hx + 0.26, 0.1, 0]);
  // teeth along the cutter bar
  const teeth = Math.max(4, Math.round(W / 0.14));
  for (let i = 0; i < teeth; i++) {
    const z = -W / 2 + (i + 0.5) * (W / teeth);
    hb.add(new THREE.ConeGeometry(0.02, 0.07, 3), COL.metal, [hx + 0.3, 0.1, z], [0, 0, -Math.PI / 2]);
  }
  // Reel supports
  hb.add(new THREE.BoxGeometry(0.3, 0.03, 0.03), COL.metal, [hx - 0.02, D.reelY + 0.02, W / 2 - 0.04], [0, 0, 0.35]);
  hb.add(new THREE.BoxGeometry(0.3, 0.03, 0.03), COL.metal, [hx - 0.02, D.reelY + 0.02, -W / 2 + 0.04], [0, 0, 0.35]);
  const headerGeom = markShared(hb.build());

  // Reel (spins about its local Z axis)
  const r = new GeoBuilder();
  r.add(new THREE.CylinderGeometry(0.02, 0.02, W * 0.96, 6), COL.metal, [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    r.add(new THREE.BoxGeometry(0.028, 0.028, W * 0.9), '#ffe08a', [Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0]);
    r.add(new THREE.BoxGeometry(0.13, 0.018, 0.018), COL.metal, [Math.cos(a) * 0.065, Math.sin(a) * 0.065, W * 0.44], [0, 0, a]);
    r.add(new THREE.BoxGeometry(0.13, 0.018, 0.018), COL.metal, [Math.cos(a) * 0.065, Math.sin(a) * 0.065, -W * 0.44], [0, 0, a]);
  }
  const reel = markShared(r.build());

  const g: HarvesterGeoms = {
    body: bodyGeom,
    header: headerGeom,
    frontWheel: wheelGeom(D.frontWheel.r, D.frontWheel.w),
    rearWheel: wheelGeom(D.rearWheel.r, D.rearWheel.w),
    reel,
  };
  harvesterCache.set(tier, g);
  return g;
}

/** Crate piece (one harvested bundle / cob). */
const pieceCache = new Map<string, THREE.BufferGeometry>();
export function pieceGeom(crop: 'wheat' | 'corn'): THREE.BufferGeometry {
  let g = pieceCache.get(crop);
  if (g) return g;
  const b = new GeoBuilder();
  if (crop === 'wheat') {
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.15, 6), '#efc24d', [0, 0, 0], [Math.PI / 2, 0, 0]);
    b.add(new THREE.CylinderGeometry(0.054, 0.054, 0.03, 6), '#c98f35', [0, 0, 0], [Math.PI / 2, 0, 0]);
    b.add(new THREE.ConeGeometry(0.05, 0.06, 6), '#f6d37a', [0, 0, 0.1], [Math.PI / 2, 0, 0]);
  } else {
    b.add(new THREE.CylinderGeometry(0.045, 0.05, 0.15, 6), '#f5c84c', [0, 0, 0], [Math.PI / 2, 0, 0]);
    b.add(new THREE.ConeGeometry(0.052, 0.09, 5), '#9cc15a', [0, 0, -0.1], [-Math.PI / 2, 0, 0]);
  }
  g = markShared(b.build());
  pieceCache.set(crop, g);
  return g;
}

export const CRATE_SLOTS = 20;
/** Crate slot positions (local to the crate floor centre). Bottom layer first, then a heap. */
export function crateSlots(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let iz = 0; iz < 4; iz++) for (let ix = 0; ix < 3; ix++) out.push(new THREE.Vector3(-0.13 + ix * 0.13, 0.06, -0.18 + iz * 0.12));
  for (let iz = 0; iz < 3; iz++) for (let ix = 0; ix < 2; ix++) out.push(new THREE.Vector3(-0.065 + ix * 0.13, 0.15, -0.12 + iz * 0.12));
  out.push(new THREE.Vector3(0, 0.23, -0.06), new THREE.Vector3(0, 0.23, 0.06));
  return out;
}

export interface HarvesterModel {
  root: THREE.Group;
  /** Tier-scaled part; bob / pitch / pop animations go here. */
  body: THREE.Group;
  wheels: { obj: THREE.Object3D; r: number }[];
  reel: THREE.Object3D;
  /** Cutting header (fold by scaling z). */
  header: THREE.Object3D;
  pieces: THREE.InstancedMesh;
  material: THREE.MeshLambertMaterial;
  shadow: THREE.Mesh;
  tier: Tier;
  /** Local positions (inside `body`) used by effects. */
  crateLocal: THREE.Vector3;
  headerLocal: THREE.Vector3;
}

let blobGeom: THREE.BufferGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;
/** Soft contact shadow disc: vertex alpha fades from centre to rim. */
export function blobShadow(): THREE.Mesh {
  if (!blobGeom) {
    const seg = 20;
    const pos: number[] = [];
    const col: number[] = [];
    const rings = [0, 0.55, 1];
    const alphas = [0.3, 0.18, 0];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      for (let r = 0; r < rings.length - 1; r++) {
        const r0 = rings[r];
        const r1 = rings[r + 1];
        const quad = [
          [Math.cos(a0) * r0, Math.sin(a0) * r0, alphas[r]],
          [Math.cos(a0) * r1, Math.sin(a0) * r1, alphas[r + 1]],
          [Math.cos(a1) * r1, Math.sin(a1) * r1, alphas[r + 1]],
          [Math.cos(a1) * r0, Math.sin(a1) * r0, alphas[r]],
        ];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
          const q = quad[idx];
          pos.push(q[0], 0, q[1]);
          col.push(0.25, 0.18, 0.1, q[2]);
        }
      }
    }
    blobGeom = new THREE.BufferGeometry();
    blobGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    blobGeom.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    markShared(blobGeom);
    blobMat = markShared(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  }
  const m = new THREE.Mesh(blobGeom, blobMat!);
  m.renderOrder = 1;
  return m;
}

export function buildHarvester(tier: Tier, crop: 'wheat' | 'corn'): HarvesterModel {
  const g = harvesterGeoms(tier);
  const def = TIERS[tier - 1];
  const D = HARVESTER_DIMS;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(def.scale);
  root.add(body);
  // Per-harvester material so upgrade flashes only touch this machine.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const main = new THREE.Mesh(g.body, material);
  main.castShadow = true;
  body.add(main);
  const wheels: { obj: THREE.Object3D; r: number }[] = [];
  for (const side of [1, -1]) {
    const fw = new THREE.Mesh(g.frontWheel, material);
    fw.position.set(D.frontWheel.x, D.frontWheel.r, side * D.frontWheel.z);
    fw.castShadow = true;
    body.add(fw);
    wheels.push({ obj: fw, r: D.frontWheel.r });
    const rw = new THREE.Mesh(g.rearWheel, material);
    rw.position.set(D.rearWheel.x, D.rearWheel.r, side * D.rearWheel.z);
    rw.castShadow = true;
    body.add(rw);
    wheels.push({ obj: rw, r: D.rearWheel.r });
  }
  const header = new THREE.Mesh(g.header, material);
  header.castShadow = true;
  body.add(header);
  const reel = new THREE.Mesh(g.reel, material);
  reel.position.set(D.headerX + 0.1, D.reelY, 0);
  reel.castShadow = true;
  body.add(reel);
  const pieces = new THREE.InstancedMesh(pieceGeom(crop), vertexMat(), CRATE_SLOTS);
  pieces.position.set(D.crate.x, D.crate.y + 0.02, 0);
  pieces.count = 0;
  pieces.frustumCulled = false;
  body.add(pieces);
  const shadow = blobShadow();
  shadow.scale.set(0.95 * def.scale, 1, (def.headerWidth / 2) * 0.55 + 0.35);
  shadow.position.y = 0.015;
  root.add(shadow);
  return {
    root,
    body,
    wheels,
    reel,
    header,
    pieces,
    material,
    shadow,
    tier,
    crateLocal: new THREE.Vector3(D.crate.x, D.crate.y + 0.2, 0),
    headerLocal: new THREE.Vector3(D.headerX + 0.25, 0.25, 0),
  };
}

// ─── Silo & hopper ──────────────────────────────────────────────────────────

let siloGeom: THREE.BufferGeometry | null = null;
export function buildSilo(): THREE.Group {
  if (!siloGeom) siloGeom = markShared(siloGeometry());
  const mesh = new THREE.Mesh(siloGeom, vertexMat());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

function siloGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CylinderGeometry(0.9, 0.95, 0.16, 16), COL.siloBase, [0, 0.08, 0]);
  b.add(new THREE.CylinderGeometry(0.72, 0.72, 2.3, 16), COL.siloBody, [0, 1.31, 0]);
  for (const y of [0.62, 1.2, 1.78]) b.add(new THREE.TorusGeometry(0.725, 0.03, 5, 24), COL.siloRing, [0, y, 0], [Math.PI / 2, 0, 0]);
  b.add(new THREE.ConeGeometry(0.84, 0.55, 16), COL.siloRoof, [0, 2.74, 0]);
  b.add(new THREE.CylinderGeometry(0.13, 0.17, 0.14, 8), COL.cream, [0, 3.06, 0]);
  // ladder facing the camera
  b.add(new THREE.BoxGeometry(0.03, 2.1, 0.03), COL.cream, [0.12, 1.3, 0.74]);
  b.add(new THREE.BoxGeometry(0.03, 2.1, 0.03), COL.cream, [-0.12, 1.3, 0.74]);
  for (let i = 0; i < 9; i++) b.add(new THREE.BoxGeometry(0.24, 0.022, 0.022), COL.cream, [0, 0.35 + i * 0.23, 0.74]);
  // hatch
  b.add(new THREE.BoxGeometry(0.3, 0.36, 0.05), COL.siloRoof, [0.38, 0.4, 0.6], [0, 0.55, 0]);
  return b.build();
}

/** Ground hopper next to the road + a slanted conveyor chute up to the silo roof. */
export function buildHopper(toSilo: THREE.Vector3): { group: THREE.Group; bowl: THREE.Object3D; intake: THREE.Vector3 } {
  const group = new THREE.Group();
  const b = new GeoBuilder();
  for (const [x, z] of [[0.24, 0.24], [-0.24, 0.24], [0.24, -0.24], [-0.24, -0.24]]) {
    b.add(new THREE.BoxGeometry(0.05, 0.42, 0.05), COL.metal, [x, 0.21, z]);
  }
  const legs = new THREE.Mesh(b.build(), vertexMat());
  legs.castShadow = true;
  group.add(legs);
  const bb = new GeoBuilder();
  bb.add(new THREE.CylinderGeometry(0.44, 0.14, 0.44, 8), COL.siloRoof, [0, 0, 0]);
  bb.add(new THREE.TorusGeometry(0.44, 0.035, 4, 16), COL.cream, [0, 0.22, 0], [Math.PI / 2, 0, 0]);
  bb.add(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 8), '#6b4a2b', [0, 0.2, 0]);
  const bowl = new THREE.Mesh(bb.build(), vertexMat());
  bowl.position.y = 0.6;
  bowl.castShadow = true;
  group.add(bowl);
  // Chute: from the hopper base up to just above the silo roof.
  const start = new THREE.Vector3(0, 0.45, 0);
  const end = new THREE.Vector3(toSilo.x * 0.93, 3.02, toSilo.z * 0.93);
  const dir = end.clone().sub(start);
  const len = dir.length();
  const cb = new GeoBuilder();
  cb.add(new THREE.CylinderGeometry(0.075, 0.075, len, 8), COL.cream, [0, 0, 0]);
  cb.add(new THREE.BoxGeometry(0.2, 0.2, 0.2), COL.siloRoof, [0, len / 2, 0]);
  for (let i = 1; i < 5; i++) cb.add(new THREE.TorusGeometry(0.08, 0.02, 4, 10), COL.siloRoof, [0, -len / 2 + (i * len) / 5, 0], [Math.PI / 2, 0, 0]);
  const chute = new THREE.Mesh(cb.build(), vertexMat());
  chute.position.copy(start).add(end).multiplyScalar(0.5);
  chute.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  chute.castShadow = true;
  group.add(chute);
  // support post for the chute
  const pb = new GeoBuilder();
  pb.add(new THREE.BoxGeometry(0.06, 1.7, 0.06), COL.metal, [0, 0.85, 0]);
  const post = new THREE.Mesh(pb.build(), vertexMat());
  post.position.set(toSilo.x * 0.5, 0, toSilo.z * 0.5);
  post.castShadow = true;
  group.add(post);
  return { group, bowl, intake: new THREE.Vector3(0, 0.85, 0) };
}

// ─── Crops ──────────────────────────────────────────────────────────────────

export interface CropGeoms {
  stubble: THREE.BufferGeometry;
  sprout: THREE.BufferGeometry;
  young: THREE.BufferGeometry;
  mature: THREE.BufferGeometry;
  /** Stalks per patch and their jitter area. */
  stalks: number;
  spreadX: number;
  spreadZ: number;
  height: number;
}
const cropCache = new Map<string, CropGeoms>();

function leaf(b: GeoBuilder, color: string, r: number, h: number, y: number, yaw: number, tilt: number, flat = 0.35): void {
  // Cone with its base at the stem, leaning outwards.
  const g = new THREE.ConeGeometry(r, h, 3);
  g.translate(0, h / 2, 0);
  g.scale(1, 1, flat);
  tmpE.set(0, yaw, 0);
  const qYaw = new THREE.Quaternion().setFromEuler(tmpE);
  tmpE.set(0, 0, -tilt);
  const qTilt = new THREE.Quaternion().setFromEuler(tmpE);
  const q = qYaw.multiply(qTilt);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0), q, new THREE.Vector3(1, 1, 1));
  b.addMatrix(g, color, m);
}

export function cropGeoms(crop: 'wheat' | 'corn'): CropGeoms {
  const cached = cropCache.get(crop);
  if (cached) return cached;
  let out: CropGeoms;
  if (crop === 'wheat') {
    const st = new GeoBuilder();
    st.add(new THREE.CylinderGeometry(0.013, 0.015, 0.06, 4), '#d8b36a', [0, 0.03, 0]);
    st.add(new THREE.CylinderGeometry(0.013, 0.015, 0.045, 4), '#cfa65d', [0.035, 0.022, 0.02]);
    const sp = new GeoBuilder();
    for (let k = 0; k < 3; k++) leaf(sp, k === 1 ? '#8fd866' : '#74c75a', 0.032, 0.17, 0, (k / 3) * Math.PI * 2, 0.4, 0.5);
    const yg = new GeoBuilder();
    yg.add(new THREE.CylinderGeometry(0.014, 0.019, 0.3, 5), '#7fbf55', [0, 0.15, 0]);
    yg.add(new THREE.OctahedronGeometry(1, 0), '#a9d86c', [0, 0.34, 0], [0, 0, 0], [0.04, 0.095, 0.04]);
    leaf(yg, '#6db34c', 0.03, 0.2, 0.05, 0, 0.7);
    leaf(yg, '#79bd52', 0.03, 0.18, 0.12, Math.PI, 0.6);
    const mt = new GeoBuilder();
    mt.add(new THREE.CylinderGeometry(0.016, 0.022, 0.46, 5), '#d9a441', [0, 0.23, 0]);
    mt.add(new THREE.OctahedronGeometry(1, 0), '#f4c64f', [0, 0.53, 0], [0, 0.4, 0], [0.055, 0.14, 0.055]);
    mt.add(new THREE.OctahedronGeometry(1, 0), '#eab843', [0.012, 0.47, 0.01], [0, 1.1, 0], [0.05, 0.1, 0.05]);
    mt.add(new THREE.ConeGeometry(0.008, 0.12, 3), '#f7d98a', [0, 0.69, 0]);
    leaf(mt, '#c9a444', 0.03, 0.24, 0.08, 0.3, 0.85);
    leaf(mt, '#d4ae4c', 0.03, 0.22, 0.18, Math.PI + 0.4, 0.8);
    out = { stubble: st.build(), sprout: sp.build(), young: yg.build(), mature: mt.build(), stalks: 9, spreadX: 0.38, spreadZ: 0.16, height: 0.62 };
  } else {
    const st = new GeoBuilder();
    st.add(new THREE.CylinderGeometry(0.035, 0.042, 0.09, 5), '#b89455', [0, 0.045, 0]);
    st.add(new THREE.CylinderGeometry(0.03, 0.036, 0.06, 5), '#a9854a', [0.07, 0.03, 0.03]);
    const sp = new GeoBuilder();
    for (let k = 0; k < 3; k++) leaf(sp, k === 0 ? '#86cf5e' : '#6fbf52', 0.045, 0.2, 0, (k / 3) * Math.PI * 2 + 0.3, 0.55, 0.3);
    const yg = new GeoBuilder();
    yg.add(new THREE.CylinderGeometry(0.022, 0.034, 0.55, 5), '#86c25a', [0, 0.275, 0]);
    leaf(yg, '#6fb04e', 0.055, 0.34, 0.12, 0.2, 1.0, 0.25);
    leaf(yg, '#7cbc55', 0.055, 0.32, 0.26, Math.PI + 0.1, 0.95, 0.25);
    leaf(yg, '#6aa843', 0.05, 0.28, 0.4, Math.PI / 2, 0.8, 0.25);
    const mt = new GeoBuilder();
    mt.add(new THREE.CylinderGeometry(0.026, 0.042, 1.0, 5), '#7fae48', [0, 0.5, 0]);
    leaf(mt, '#6aa843', 0.065, 0.46, 0.22, 0.3, 1.1, 0.25);
    leaf(mt, '#78b44c', 0.065, 0.44, 0.42, Math.PI + 0.2, 1.05, 0.25);
    leaf(mt, '#62a03e', 0.06, 0.4, 0.62, Math.PI / 2 + 0.3, 0.95, 0.25);
    leaf(mt, '#80b852', 0.05, 0.32, 0.8, -Math.PI / 2, 0.8, 0.25);
    mt.add(new THREE.CylinderGeometry(0.045, 0.052, 0.22, 6), '#f5c84c', [0.075, 0.6, 0], [0, 0, -0.45]);
    mt.add(new THREE.ConeGeometry(0.058, 0.16, 5), '#9cc15a', [0.03, 0.5, 0], [0, 0, Math.PI - 0.45]);
    mt.add(new THREE.ConeGeometry(0.05, 0.16, 5), '#d9b25e', [0, 1.08, 0]);
    out = { stubble: st.build(), sprout: sp.build(), young: yg.build(), mature: mt.build(), stalks: 3, spreadX: 0.42, spreadZ: 0.12, height: 1.1 };
  }
  for (const k of ['stubble', 'sprout', 'young', 'mature'] as const) markShared(out[k]);
  cropCache.set(crop, out);
  return out;
}

// ─── Decor ──────────────────────────────────────────────────────────────────

export function addTree(b: GeoBuilder, x: number, z: number, s: number, foliage: string, foliage2: string): void {
  b.add(new THREE.CylinderGeometry(0.07 * s, 0.1 * s, 0.5 * s, 6), '#8a5a35', [x, 0.25 * s, z]);
  b.add(new THREE.IcosahedronGeometry(0.45 * s, 0), foliage, [x, 0.8 * s, z]);
  b.add(new THREE.IcosahedronGeometry(0.3 * s, 0), foliage2, [x + 0.18 * s, 1.08 * s, z + 0.05 * s]);
}

export function addPine(b: GeoBuilder, x: number, z: number, s: number, foliage: string): void {
  b.add(new THREE.CylinderGeometry(0.06 * s, 0.08 * s, 0.3 * s, 6), '#8a5a35', [x, 0.15 * s, z]);
  b.add(new THREE.ConeGeometry(0.42 * s, 0.7 * s, 7), foliage, [x, 0.6 * s, z]);
  b.add(new THREE.ConeGeometry(0.32 * s, 0.55 * s, 7), foliage, [x, 0.95 * s, z]);
}

export function addBush(b: GeoBuilder, x: number, z: number, s: number, color: string): void {
  b.add(new THREE.IcosahedronGeometry(0.22 * s, 0), color, [x, 0.14 * s, z]);
  b.add(new THREE.IcosahedronGeometry(0.16 * s, 0), color, [x + 0.2 * s, 0.1 * s, z + 0.06 * s]);
}

export function addHay(b: GeoBuilder, x: number, z: number, yaw: number): void {
  b.add(new THREE.CylinderGeometry(0.24, 0.24, 0.4, 10), '#e8c56a', [x, 0.24, z], [Math.PI / 2, yaw, 0]);
  b.add(new THREE.CylinderGeometry(0.245, 0.245, 0.05, 10), '#c99a45', [x, 0.24, z], [Math.PI / 2, yaw, 0]);
}

export function addPumpkin(b: GeoBuilder, x: number, z: number, s: number): void {
  b.add(new THREE.SphereGeometry(0.16 * s, 8, 6), '#ec8a2e', [x, 0.12 * s, z], [0, 0, 0], [1, 0.72, 1]);
  b.add(new THREE.CylinderGeometry(0.02 * s, 0.03 * s, 0.08 * s, 5), '#6a8f3a', [x, 0.26 * s, z]);
}

export function addRock(b: GeoBuilder, x: number, z: number, s: number): void {
  b.add(new THREE.DodecahedronGeometry(0.14 * s, 0), '#cbbfa8', [x, 0.07 * s, z], [0.3, x, 0.2], [1, 0.6, 1]);
}

export function addFence(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, color: string): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 0.7));
  const yaw = -Math.atan2(z1 - z0, x1 - x0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    b.add(new THREE.BoxGeometry(0.07, 0.36, 0.07), color, [x0 + (x1 - x0) * t, 0.18, z0 + (z1 - z0) * t]);
  }
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  b.add(new THREE.BoxGeometry(len, 0.05, 0.03), color, [mx, 0.26, mz], [0, yaw, 0]);
  b.add(new THREE.BoxGeometry(len, 0.05, 0.03), color, [mx, 0.14, mz], [0, yaw, 0]);
}

export function addCrateStack(b: GeoBuilder, x: number, z: number): void {
  b.add(new THREE.BoxGeometry(0.34, 0.26, 0.34), COL.wood, [x, 0.13, z], [0, 0.2, 0]);
  b.add(new THREE.BoxGeometry(0.3, 0.24, 0.3), COL.woodDark, [x + 0.05, 0.38, z - 0.02], [0, -0.3, 0]);
}

export function addShed(b: GeoBuilder, x: number, z: number, wall: string, roof: string): void {
  b.add(new THREE.BoxGeometry(1.0, 0.6, 0.8), wall, [x, 0.3, z]);
  const r = new THREE.CylinderGeometry(0.01, 0.62, 0.42, 4, 1);
  b.add(r, roof, [x, 0.8, z], [0, Math.PI / 4, 0], [1.15, 1, 0.92]);
  b.add(new THREE.BoxGeometry(0.3, 0.4, 0.02), '#fff3dc', [x, 0.2, z + 0.41]);
}

export function addFlag(b: GeoBuilder, x: number, z: number, color: string, label: number): void {
  b.add(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 5), '#fff3dc', [x, 0.25, z]);
  const tri = new THREE.ConeGeometry(0.1, 0.2, 3);
  b.add(tri, color, [x + 0.1, 0.43, z], [0, 0, -Math.PI / 2], [1, 1, 0.25]);
  // pips below the flag show which tier reaches this row
  for (let i = 0; i < label; i++) b.add(new THREE.SphereGeometry(0.025, 5, 4), color, [x, 0.08 + i * 0.07, z + 0.03]);
}

export function sprinklerGeoms(): { post: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const p = new GeoBuilder();
  p.add(new THREE.CylinderGeometry(0.025, 0.03, 0.34, 6), COL.metal, [0, 0.17, 0]);
  p.add(new THREE.CylinderGeometry(0.07, 0.08, 0.04, 8), '#5f9bd0', [0, 0.02, 0]);
  const h = new GeoBuilder();
  h.add(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 6), '#5f9bd0', [0, 0, 0]);
  h.add(new THREE.BoxGeometry(0.2, 0.025, 0.025), '#5f9bd0', [0.06, 0.02, 0]);
  h.add(new THREE.SphereGeometry(0.025, 6, 4), COL.water, [0.16, 0.02, 0]);
  return { post: p.build(), head: h.build() };
}
