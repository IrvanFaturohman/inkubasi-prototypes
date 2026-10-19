import * as THREE from 'three';
import type { ThemeKind } from '../game/types';
import { cbox, ccyl, colored, mergeFlat, place } from './geom';
import { SHARED, type ThemePalette } from './palette';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function inRects(x: number, z: number, rects: Rect[], margin: number): boolean {
  return rects.some((r) => x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin);
}

function groundTexture(p: ThemePalette, theme: ThemeKind): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = p.ground;
  g.fillRect(0, 0, 256, 256);
  const r = rng(99);
  if (theme === 'city') {
    // paving blok
    g.strokeStyle = 'rgba(120,110,95,0.22)';
    g.lineWidth = 2;
    for (let y = 0; y <= 256; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y);
      g.stroke();
      const off = (y / 32) % 2 === 0 ? 0 : 32;
      for (let x = off; x <= 256; x += 64) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 32);
        g.stroke();
      }
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.06})`;
      g.fillRect(Math.floor(r() * 4) * 64 + 4, Math.floor(r() * 8) * 32 + 4, 56, 24);
    }
  } else {
    for (let i = 0; i < 90; i++) {
      g.fillStyle = r() < 0.5 ? p.groundAlt : 'rgba(255,255,255,0.05)';
      g.globalAlpha = 0.35 + r() * 0.4;
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 8 + r() * 26, 6 + r() * 18, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    // helai rumput kecil
    for (let i = 0; i < 260; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(40,110,40,0.18)' : 'rgba(255,255,220,0.14)';
      g.fillRect(r() * 256, r() * 256, 2, 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(theme === 'city' ? 26 : 14, theme === 'city' ? 26 : 14);
  t.anisotropy = 4;
  return t;
}

function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#9cc7e6';
  g.fillRect(14, 16, 36, 30);
  g.fillStyle = '#e8eef5';
  g.fillRect(30, 16, 4, 30);
  g.fillStyle = '#d9d9d9';
  g.fillRect(10, 46, 44, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface EnvironmentBuild {
  group: THREE.Group;
  dispose(): void;
}

/**
 * Dekorasi dunia. `keepOut` = area gameplay (semua tahap lintasan, stasiun, bangunan)
 * yang tidak boleh ditutupi pohon/objek tinggi. `inner` = bagian dalam loop tahap 0.
 */
export function buildEnvironment(theme: ThemeKind, p: ThemePalette, keepOut: Rect[], site: Rect, inner: Rect | null): EnvironmentBuild {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const r = rng(theme === 'forest' ? 11 : theme === 'meadow' ? 23 : 37);

  // Tanah
  const gtex = groundTexture(p, theme);
  disposables.push(gtex);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.MeshStandardMaterial({ map: gtex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Lahan proyek (pasir/tanah padat) di bawah bangunan
  const siteShape = new THREE.Shape();
  const sw = site.maxX - site.minX;
  const sd = site.maxZ - site.minZ;
  const rr = 0.8;
  siteShape.moveTo(site.minX + rr, site.minZ);
  siteShape.lineTo(site.maxX - rr, site.minZ);
  siteShape.quadraticCurveTo(site.maxX, site.minZ, site.maxX, site.minZ + rr);
  siteShape.lineTo(site.maxX, site.maxZ - rr);
  siteShape.quadraticCurveTo(site.maxX, site.maxZ, site.maxX - rr, site.maxZ);
  siteShape.lineTo(site.minX + rr, site.maxZ);
  siteShape.quadraticCurveTo(site.minX, site.maxZ, site.minX, site.maxZ - rr);
  siteShape.lineTo(site.minX, site.minZ + rr);
  siteShape.quadraticCurveTo(site.minX, site.minZ, site.minX + rr, site.minZ);
  const siteGeo = new THREE.ShapeGeometry(siteShape);
  siteGeo.rotateX(Math.PI / 2);
  const siteMesh = new THREE.Mesh(siteGeo, new THREE.MeshStandardMaterial({ color: p.site, roughness: 1, side: THREE.DoubleSide }));
  siteMesh.position.y = 0.006;
  siteMesh.receiveShadow = true;
  group.add(siteMesh);
  void sw;
  void sd;

  // Area tepat di belakang bangunan juga dikosongkan supaya pohon tidak "menembus" siluet ghost.
  const behind: Rect = { minX: site.minX - 1, maxX: site.maxX + 1, minZ: site.minZ - 5, maxZ: site.minZ };
  const all = keepOut.concat([site, behind]);
  const bounds = keepOut.reduce(
    (a, b) => ({ minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) }),
    { ...site },
  );

  const scatter = (n: number, margin: number, area: Rect, avoidFront: boolean, maxTries = n * 30): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    for (let k = 0; k < maxTries && out.length < n; k++) {
      const x = area.minX + r() * (area.maxX - area.minX);
      const z = area.minZ + r() * (area.maxZ - area.minZ);
      if (inRects(x, z, all, margin)) continue;
      if (avoidFront && z > bounds.maxZ - 1) continue;
      if (out.some((q) => Math.hypot(q.x - x, q.z - z) < 1.6)) continue;
      out.push(new THREE.Vector3(x, 0, z));
    }
    return out;
  };
  const wide: Rect = { minX: bounds.minX - 16, maxX: bounds.maxX + 16, minZ: bounds.minZ - 18, maxZ: bounds.maxZ + 10 };

  if (theme !== 'city') {
    // --- Pohon (instanced) ---
    const trunkGeo = colored(new THREE.CylinderGeometry(0.16, 0.22, 1.1, 7), p.trunk);
    trunkGeo.translate(0, 0.55, 0);
    const pineGeo = mergeFlat([
      place(colored(new THREE.ConeGeometry(1.15, 1.5, 8), '#ffffff'), 0, 1.5, 0),
      place(colored(new THREE.ConeGeometry(0.9, 1.3, 8), '#ffffff'), 0, 2.3, 0),
      place(colored(new THREE.ConeGeometry(0.6, 1.1, 8), '#ffffff'), 0, 3.0, 0),
    ]);
    const roundGeo = mergeFlat([
      place(colored(new THREE.IcosahedronGeometry(1.05, 1), '#ffffff'), 0, 1.9, 0),
      place(colored(new THREE.IcosahedronGeometry(0.75, 1), '#ffffff'), 0.55, 1.55, 0.2),
      place(colored(new THREE.IcosahedronGeometry(0.7, 1), '#ffffff'), -0.5, 1.6, -0.2),
    ]);
    const spots = scatter(theme === 'forest' ? 70 : 46, 1.4, wide, true);
    const trunks = new THREE.InstancedMesh(trunkGeo, SHARED.vertexLambert, spots.length);
    const pineMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
    const pines = new THREE.InstancedMesh(pineGeo, pineMat, spots.length);
    const rounds = new THREE.InstancedMesh(roundGeo, pineMat, spots.length);
    let np = 0;
    let nr = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    spots.forEach((pt, i) => {
      // pohon dekat area main lebih kecil agar tidak menutupi
      const distOut = Math.min(Math.abs(pt.x - bounds.minX), Math.abs(pt.x - bounds.maxX), Math.abs(pt.z - bounds.minZ));
      const sc = (0.75 + r() * 0.5) * (distOut < 4 ? 0.8 : 1.05);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      s.setScalar(sc);
      m.compose(pt, q, s);
      trunks.setMatrixAt(i, m);
      const pine = theme === 'forest' ? r() < 0.55 : r() < 0.25;
      col.set(p.foliage[Math.floor(r() * p.foliage.length)]);
      if (pine) {
        pines.setMatrixAt(np, m);
        pines.setColorAt(np, col);
        np++;
      } else {
        rounds.setMatrixAt(nr, m);
        rounds.setColorAt(nr, col);
        nr++;
      }
    });
    pines.count = np;
    rounds.count = nr;
    for (const im of [trunks, pines, rounds]) {
      im.castShadow = true;
      group.add(im);
    }
    disposables.push(trunkGeo, pineGeo, roundGeo, pineMat);

    // --- Batu & bunga ---
    const rockGeo = colored(new THREE.DodecahedronGeometry(0.32, 0), p.rock);
    const rocks = scatter(18, 0.6, { minX: bounds.minX - 6, maxX: bounds.maxX + 6, minZ: bounds.minZ - 6, maxZ: bounds.maxZ + 3 }, false);
    const rockMesh = new THREE.InstancedMesh(rockGeo, SHARED.vertexLambert, Math.max(1, rocks.length));
    rocks.forEach((pt, i) => {
      q.setFromEuler(new THREE.Euler(r(), r() * 6, r()));
      s.set(0.7 + r(), 0.5 + r() * 0.6, 0.7 + r());
      m.compose(pt, q, s);
      rockMesh.setMatrixAt(i, m);
    });
    rockMesh.count = rocks.length;
    rockMesh.castShadow = true;
    group.add(rockMesh);
    disposables.push(rockGeo);

    const flowerGeo = mergeFlat([ccyl(0.02, 0.25, '#4f9a3e', 5, 0, 0.12, 0), place(colored(new THREE.IcosahedronGeometry(0.08, 0), '#ffffff'), 0, 0.27, 0)]);
    const flowerPts: THREE.Vector3[] = [];
    const clusters = scatter(22, 0.4, { minX: bounds.minX - 5, maxX: bounds.maxX + 5, minZ: bounds.minZ - 5, maxZ: bounds.maxZ + 4 }, false);
    if (inner) {
      for (let k = 0; k < 4; k++) clusters.push(new THREE.Vector3(inner.minX + r() * (inner.maxX - inner.minX), 0, inner.minZ + r() * (inner.maxZ - inner.minZ)));
    }
    for (const c of clusters) for (let k = 0; k < 5; k++) flowerPts.push(new THREE.Vector3(c.x + (r() - 0.5) * 0.9, 0, c.z + (r() - 0.5) * 0.9));
    const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true }), flowerPts.length);
    flowerPts.forEach((pt, i) => {
      q.identity();
      s.setScalar(0.8 + r() * 0.6);
      m.compose(pt, q, s);
      flowers.setMatrixAt(i, m);
      flowers.setColorAt(i, col.set(p.flower[Math.floor(r() * p.flower.length)]));
    });
    group.add(flowers);
    disposables.push(flowerGeo);

    if (theme === 'meadow') {
      // Kolam kecil + pagar kayu + bal jerami
      const pondSpot = scatter(1, 2.5, { minX: bounds.minX - 7, maxX: bounds.minX - 3, minZ: bounds.minZ + 4, maxZ: bounds.maxZ - 2 }, false)[0];
      if (pondSpot) {
        const pond = new THREE.Mesh(new THREE.CircleGeometry(1.8, 28), new THREE.MeshStandardMaterial({ color: '#6cc7f0', roughness: 0.25 }));
        pond.rotation.x = -Math.PI / 2;
        pond.scale.set(1.3, 0.9, 1);
        pond.position.set(pondSpot.x, 0.02, pondSpot.z);
        const rim = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.05, 28), new THREE.MeshLambertMaterial({ color: '#d9cfb8' }));
        rim.rotation.x = -Math.PI / 2;
        rim.scale.set(1.3, 0.9, 1);
        rim.position.set(pondSpot.x, 0.025, pondSpot.z);
        group.add(pond, rim);
      }
      const fence: THREE.BufferGeometry[] = [];
      const fz = bounds.minZ - 1.2;
      for (let x = bounds.minX - 6; x < bounds.maxX + 6; x += 1.2) {
        if (x > site.minX - 0.5 && x < site.maxX + 0.5) continue;
        fence.push(cbox(0.1, 0.7, 0.1, '#c79a64', x, 0.35, fz, 0.02), cbox(1.2, 0.08, 0.05, '#d8ad76', x + 0.6, 0.5, fz, 0.01), cbox(1.2, 0.08, 0.05, '#d8ad76', x + 0.6, 0.25, fz, 0.01));
      }
      if (fence.length) {
        const fm = new THREE.Mesh(mergeFlat(fence), SHARED.vertexStd);
        fm.castShadow = true;
        group.add(fm);
      }
      const hay = scatter(5, 1.2, { minX: bounds.minX - 6, maxX: bounds.maxX + 6, minZ: bounds.minZ - 6, maxZ: bounds.maxZ }, true);
      const hayGeo = mergeFlat(hay.map((h) => ccyl(0.45, 0.8, '#f2cf6b', 14, h.x, 0.45, h.z, 0, 0, Math.PI / 2, '#e8bf55')));
      if (hay.length) {
        const hm = new THREE.Mesh(hayGeo, SHARED.vertexStd);
        hm.castShadow = true;
        group.add(hm);
      }
    }
  } else {
    // --- Kota: gedung latar, lampu jalan, pohon di pot ---
    const wtex = windowTexture();
    disposables.push(wtex);
    const bmat = new THREE.MeshStandardMaterial({ map: wtex, vertexColors: true, roughness: 0.85 });
    const bGeos: THREE.BufferGeometry[] = [];
    const colors = ['#f6c89f', '#a9d4f5', '#f5e3a1', '#c5e3b5', '#f2b3b8', '#d6c4f0', '#f8f2e8'];
    const addBuilding = (x: number, z: number, w: number, d: number, h: number) => {
      const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const nor = g.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        const ny = Math.abs(nor.getY(i));
        const horiz = Math.abs(nor.getX(i)) > 0.5 ? d : w;
        if (ny > 0.5) uv.setXY(i, 0.02, 0.02);
        else uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(horiz / 1.1)), uv.getY(i) * Math.max(1, Math.round(h / 1.2)));
      }
      const c = colors[Math.floor(r() * colors.length)];
      const col = new THREE.Color(c);
      const arr = new Float32Array(uv.count * 3);
      for (let i = 0; i < uv.count; i++) {
        arr[i * 3] = col.r;
        arr[i * 3 + 1] = col.g;
        arr[i * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.translate(x, h / 2, z);
      bGeos.push(g);
      // atap datar + parapet
      bGeos.push(withUv(cbox(w + 0.2, 0.25, d + 0.2, '#e6e2da', x, h + 0.12, z, 0.03)));
    };
    // baris belakang
    for (let x = bounds.minX - 10; x < bounds.maxX + 10; ) {
      const w = 2.6 + r() * 2.4;
      if (!(x + w > site.minX - 1 && x < site.maxX + 1) || r() < 0.2) addBuilding(x + w / 2, site.minZ - 4.5 - r() * 2, w, 3 + r() * 2, 3.5 + r() * 5);
      x += w + 0.4;
    }
    for (let x = bounds.minX - 10; x < bounds.maxX + 10; ) {
      const w = 3 + r() * 3;
      addBuilding(x + w / 2, site.minZ - 10 - r() * 3, w, 4, 6 + r() * 7);
      x += w + 0.5;
    }
    // sisi kiri & kanan
    for (const side of [-1, 1]) {
      for (let z = bounds.minZ; z < bounds.maxZ + 6; ) {
        const d = 2.6 + r() * 2;
        const edge = side < 0 ? bounds.minX - 3.5 : bounds.maxX + 3.5;
        addBuilding(edge + side * (1.5 + r()), z + d / 2, 3 + r() * 1.5, d, 3 + r() * 4);
        z += d + 0.5;
      }
    }
    const bm = new THREE.Mesh(mergeFlat(bGeos, ['position', 'normal', 'color', 'uv']), bmat);
    bm.castShadow = true;
    bm.receiveShadow = true;
    group.add(bm);

    // jalan raya di tepi
    const roadMat = new THREE.MeshStandardMaterial({ color: '#8b93a1', roughness: 0.95 });
    for (const side of [-1, 1]) {
      const edge = side < 0 ? bounds.minX - 2 : bounds.maxX + 2;
      const road = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 80), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(edge + side * 0.2, 0.004, 0);
      road.receiveShadow = true;
      group.add(road);
    }

    // lampu jalan & pohon di pot
    const lampGeo = mergeFlat([ccyl(0.06, 2.2, '#3d4452', 8, 0, 1.1, 0), cbox(0.5, 0.08, 0.12, '#3d4452', 0.2, 2.2, 0, 0.02), cbox(0.2, 0.1, 0.2, '#fff1b8', 0.4, 2.12, 0, 0.03)]);
    const lampPts = scatter(12, 1.0, { minX: bounds.minX - 3, maxX: bounds.maxX + 3, minZ: bounds.minZ - 2, maxZ: bounds.maxZ + 2 }, true);
    const lamps = new THREE.InstancedMesh(lampGeo, SHARED.vertexStd, Math.max(1, lampPts.length));
    const potGeo = mergeFlat([cbox(0.7, 0.45, 0.7, '#c9ced6', 0, 0.22, 0, 0.06), ccyl(0.08, 0.7, '#7a5236', 7, 0, 0.8, 0), place(colored(new THREE.IcosahedronGeometry(0.62, 1), '#5fb34f'), 0, 1.45, 0)]);
    const potPts = scatter(14, 1.0, { minX: bounds.minX - 4, maxX: bounds.maxX + 4, minZ: bounds.minZ - 3, maxZ: bounds.maxZ + 3 }, true);
    const pots = new THREE.InstancedMesh(potGeo, SHARED.vertexStd, Math.max(1, potPts.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    lampPts.forEach((pt, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      m.compose(pt, q, s);
      lamps.setMatrixAt(i, m);
    });
    potPts.forEach((pt, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      m.compose(pt, q, s);
      pots.setMatrixAt(i, m);
    });
    lamps.count = lampPts.length;
    pots.count = potPts.length;
    lamps.castShadow = pots.castShadow = true;
    group.add(lamps, pots);
    disposables.push(lampGeo, potGeo, bmat, roadMat);

    // taman kecil di dalam loop tahap 0
    if (inner) {
      const lawn = new THREE.Mesh(
        cbox(inner.maxX - inner.minX, 0.08, inner.maxZ - inner.minZ, '#8fd16a', (inner.minX + inner.maxX) / 2, 0.04, (inner.minZ + inner.maxZ) / 2, 0.04),
        SHARED.vertexStd,
      );
      lawn.receiveShadow = true;
      group.add(lawn);
      const bushes: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 5; k++) {
        const x = inner.minX + 0.5 + r() * (inner.maxX - inner.minX - 1);
        const z = inner.minZ + 0.5 + r() * (inner.maxZ - inner.minZ - 1);
        bushes.push(place(colored(new THREE.IcosahedronGeometry(0.3 + r() * 0.15, 1), p.bush[k % p.bush.length]), x, 0.3, z));
      }
      const bmesh = new THREE.Mesh(mergeFlat(bushes), SHARED.vertexStd);
      bmesh.castShadow = true;
      group.add(bmesh);
    }
  }

  return {
    group,
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry) o.geometry.dispose();
      });
      disposables.forEach((d) => d.dispose());
    },
  };
}

/** Tambahkan UV kosong agar bisa digabung dengan geometri bertekstur. */
function withUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const uv = new Float32Array(n * 2).fill(0.02);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
