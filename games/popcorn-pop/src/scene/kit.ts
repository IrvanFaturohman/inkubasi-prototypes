// ---------------------------------------------------------------------------
// Shared palette, materials and geometries. Everything procedural.
// Materials/geometries are cached and reused across meshes.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const C = {
  cream: 0xfff3dc,
  creamDeep: 0xf7dfb5,
  butter: 0xffd66b,
  butterDeep: 0xf6b93b,
  orange: 0xf28a3c,
  orangeDeep: 0xe0662c,
  red: 0xe25b45,
  redDeep: 0xb9432f,
  turquoise: 0x2ec4b6,
  turquoiseDeep: 0x1d9e92,
  teal: 0x2a7f86,
  charcoal: 0x4a4453,
  steel: 0xd8d2c8,
  white: 0xfffaf0,
  kernel: 0xf5b21b,
  skin: [0xf6d2b0, 0xe8b48e, 0xc98c64, 0x9c6a48],
};

const matCache = new Map<string, THREE.Material>();

/** Cached flat-ish Lambert material. */
export function lambert(color: number, opts: { flat?: boolean; emissive?: number } = {}): THREE.MeshLambertMaterial {
  const key = `l:${color}:${opts.flat ?? true}:${opts.emissive ?? 0}`;
  let m = matCache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: opts.flat ?? true, emissive: opts.emissive ?? 0 });
    matCache.set(key, m);
  }
  return m;
}

export function phong(color: number, shininess = 40): THREE.MeshPhongMaterial {
  const key = `p:${color}:${shininess}`;
  let m = matCache.get(key) as THREE.MeshPhongMaterial | undefined;
  if (!m) {
    m = new THREE.MeshPhongMaterial({ color, shininess, specular: 0x6b5a4a });
    matCache.set(key, m);
  }
  return m;
}

export function basic(color: number): THREE.MeshBasicMaterial {
  const key = `b:${color}`;
  let m = matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    matCache.set(key, m);
  }
  return m;
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// --- geometries --------------------------------------------------------------

function withColor(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const col = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

/** A popcorn piece: 4 white puffs + a small golden hull, merged into one geometry (~0.36 wide). */
export const popcornGeo: THREE.BufferGeometry = (() => {
  const parts: THREE.BufferGeometry[] = [];
  const puffs: [number, number, number, number, number][] = [
    [0, 0, 0, 0.14, 0xfffbf1],
    [0.11, 0.06, 0.03, 0.115, 0xfff6e0],
    [-0.09, 0.08, -0.05, 0.12, 0xfffdf6],
    [0.02, 0.13, 0.08, 0.1, 0xfff3d6],
    [-0.03, -0.05, 0.1, 0.1, 0xfffaf0],
  ];
  for (const [x, y, z, r, col] of puffs) {
    const s = new THREE.IcosahedronGeometry(r, 1);
    s.translate(x, y, z);
    parts.push(withColor(s, col));
  }
  const hull = new THREE.IcosahedronGeometry(0.05, 0);
  hull.scale(1, 0.6, 1);
  hull.translate(0.02, -0.1, -0.06);
  parts.push(withColor(hull, 0xf0a818));
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  return merged;
})();

export const popcornMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** A raw kernel, teardrop-ish (~0.2 long). */
export const kernelGeo: THREE.BufferGeometry = (() => {
  const g = new THREE.IcosahedronGeometry(0.085, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // narrow the bottom to a point
    const k = y < 0 ? 1 + y * 3.2 : 1;
    p.setX(i, p.getX(i) * k * 1.05);
    p.setZ(i, p.getZ(i) * k * 0.8);
    p.setY(i, y * 1.25);
  }
  g.computeVertexNormals();
  return g;
})();

export const kernelMat = new THREE.MeshLambertMaterial({ color: C.kernel, flatShading: true });

// --- canvas textures ---------------------------------------------------------

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let blobTex: THREE.Texture | null = null;
const blobMats = new Map<number, THREE.MeshBasicMaterial>();
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** Soft round contact shadow (cheaper and cuter than shadow maps). */
export function blobShadow(size: number, opacity = 0.28): THREE.Mesh {
  if (!blobTex) {
    blobTex = canvasTexture(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
      g.addColorStop(0, 'rgba(90,50,30,1)');
      g.addColorStop(0.55, 'rgba(90,50,30,0.55)');
      g.addColorStop(1, 'rgba(90,50,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    });
  }
  let m = blobMats.get(opacity);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false });
    blobMats.set(opacity, m);
  }
  const s = new THREE.Mesh(blobGeo, m);
  s.scale.set(size, 1, size);
  s.position.y = 0.012;
  s.renderOrder = -1;
  return s;
}

/** Rounded-rect helper for canvas drawing. */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const FONT = '"SF Pro Rounded", ui-rounded, "Nunito", "Varela Round", "Arial Rounded MT Bold", system-ui, sans-serif';

/** Signboard texture with a title and little marquee bulbs. */
export function signTexture(title: string, bg: string, fg: string, bulb: string, border: string): THREE.CanvasTexture {
  return canvasTexture(1024, 256, (ctx) => {
    ctx.fillStyle = border;
    roundRect(ctx, 0, 0, 1024, 256, 48);
    ctx.fill();
    ctx.fillStyle = bg;
    roundRect(ctx, 22, 22, 980, 212, 34);
    ctx.fill();
    // bulbs
    ctx.fillStyle = bulb;
    for (let i = 0; i < 22; i++) {
      const x = 60 + i * 43.2;
      ctx.beginPath();
      ctx.arc(x, 11, 7, 0, Math.PI * 2);
      ctx.arc(x, 245, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 118;
    ctx.font = `900 ${size}px ${FONT}`;
    while (ctx.measureText(title).width > 900 && size > 40) {
      size -= 4;
      ctx.font = `900 ${size}px ${FONT}`;
    }
    ctx.fillText(title, 512, 136);
  });
}
