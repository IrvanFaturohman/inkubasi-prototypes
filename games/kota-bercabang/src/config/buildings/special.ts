import type { ModuleDef, Prim } from '../../game/types';
import { box, cone, cyl, log, ProjectBuilder, sphere } from './builder';

/** Menara air kayu (landmark desa): kaki, penguat silang, tangki, atap kerucut. */
export function waterTower(tank: string, roof: string): ModuleDef[] {
  const b = new ProjectBuilder();
  const leg = '#8a5a36';
  const s = 0.55;
  const legH = 1.7;
  for (const [x, z] of [
    [-s, -s],
    [s, -s],
    [-s, s],
    [s, s],
  ]) {
    b.mod(0, 0.25, box([x, 0.05, z], [0.24, 0.1, 0.24], '#bdb6aa', 0.02));
  }
  // kaki dibangun dua bagian
  for (const half of [0, 1]) {
    const prims: Prim[] = [];
    for (const [x, z] of [
      [-s, -s],
      [s, -s],
      [-s, s],
      [s, s],
    ]) {
      prims.push(log([x, 0.1 + legH * (half + 0.5) / 2, z], legH / 2, 'y', 0.06, leg));
    }
    b.mod(1, 1, prims);
  }
  // penguat
  for (const y of [0.6, 1.3]) {
    b.mod(2, 0.8, [
      box([0, y, s], [s * 2, 0.06, 0.05], '#a8703c', 0.01),
      box([0, y, -s], [s * 2, 0.06, 0.05], '#a8703c', 0.01),
      box([s, y, 0], [0.05, 0.06, s * 2], '#a8703c', 0.01),
      box([-s, y, 0], [0.05, 0.06, s * 2], '#a8703c', 0.01),
    ]);
  }
  const ty = legH + 0.1;
  b.mod(2, 0.8, box([0, ty + 0.04, 0], [1.4, 0.08, 1.4], '#b98246', 0.02));
  // tangki: tiga cincin papan
  for (let i = 0; i < 3; i++) {
    b.mod(3, 1, cyl([0, ty + 0.13 + i * 0.26 + 0.13, 0], 0.26, 'y', 0.6 - i * 0.01, i % 2 ? tank : shade(tank), 16));
  }
  b.mod(3, 1, cone([0, ty + 0.92, 0], 0.72, 0.5, roof, 14));
  // detail: tangga + bendera + ember
  const ladder: Prim[] = [box([0.18, (ty + 0.1) / 2, s + 0.1], [0.03, ty + 0.1, 0.03], '#6b4a2b', 0), box([-0.18, (ty + 0.1) / 2, s + 0.1], [0.03, ty + 0.1, 0.03], '#6b4a2b', 0)];
  for (let i = 0; i < 7; i++) ladder.push(box([0, 0.2 + i * 0.26, s + 0.1], [0.36, 0.03, 0.03], '#6b4a2b', 0));
  b.mod(4, 0.8, ladder);
  b.mod(4, 0.8, [cyl([0, ty + 1.5, 0], 0.4, 'y', 0.02, '#e5e7eb', 6), box([0.14, ty + 1.62, 0], [0.24, 0.14, 0.02], '#ff5a5f', 0.01), sphere([0.5, 0.15, 0.7], 0.16, '#5fb34f')]);
  return b.done();
}

/** Menara jam bata (landmark kota). */
export function clockTower(brick: string, roof: string): ModuleDef[] {
  const b = new ProjectBuilder();
  const w = 1.1;
  const trim = '#f4efe6';
  b.mod(0, 0.25, box([0, 0.07, 0], [w + 0.3, 0.14, w + 0.3], '#cfd3d6', 0.03));
  b.mod(0, 0.25, box([0, 0.18, 0], [w + 0.15, 0.08, w + 0.15], '#bfc4c8', 0.02));
  // badan menara: pita-pita bata
  const bands = 8;
  const bh = 0.36;
  for (let i = 0; i < bands; i++) {
    const y = 0.22 + bh * (i + 0.5);
    const c = i % 2 ? brick : shade(brick);
    const prims: Prim[] = [box([0, y, 0], [w, bh + 0.005, w], c, 0)];
    // garis adukan sebagai detail (bukan siluet)
    prims.push({ ...box([0, y + bh / 2 - 0.01, w / 2 + 0.005], [w, 0.02, 0.01], '#e8ddd0', 0), noGhost: true });
    prims.push({ ...box([w / 2 + 0.005, y + bh / 2 - 0.01, 0], [0.01, 0.02, w], '#e8ddd0', 0), noGhost: true });
    b.mod(1, 1, prims);
  }
  const top = 0.22 + bh * bands;
  // pintu, jendela, list
  b.mod(2, 0.9, [box([0, 0.5, w / 2 + 0.01], [0.34, 0.56, 0.04], '#2f7d5b', 0.02), box([0, 0.82, w / 2 + 0.03], [0.44, 0.06, 0.05], trim, 0.01)]);
  b.mod(2, 0.9, [
    box([0, 1.5, w / 2 + 0.01], [0.24, 0.4, 0.03], '#8fc9ea', 0.01),
    box([w / 2 + 0.01, 1.5, 0], [0.03, 0.4, 0.24], '#8fc9ea', 0.01),
    box([0, 1.1, w / 2 + 0.02], [w + 0.06, 0.06, 0.04], trim, 0),
    box([w / 2 + 0.02, 1.1, 0], [0.04, 0.06, w + 0.06], trim, 0),
  ]);
  // jam di dua sisi terlihat
  b.mod(2, 1, [
    cyl([0, top - 0.45, w / 2 + 0.02], 0.04, 'z', 0.3, '#ffffff', 20),
    cyl([0, top - 0.45, w / 2 + 0.04], 0.02, 'z', 0.34, '#2d3748', 20),
    box([0, top - 0.38, w / 2 + 0.06], [0.03, 0.18, 0.01], '#2d3748', 0),
    box([0.06, top - 0.45, w / 2 + 0.06], [0.14, 0.03, 0.01], '#2d3748', 0),
    cyl([w / 2 + 0.02, top - 0.45, 0], 0.04, 'x', 0.3, '#ffffff', 20),
  ]);
  // atap limas
  b.mod(3, 1, box([0, top + 0.05, 0], [w + 0.24, 0.1, w + 0.24], trim, 0.02));
  b.mod(3, 1.2, cone([0, top + 0.1, 0], 0.98, 0.9, roof, 4, [0, Math.PI / 4, 0]));
  b.mod(4, 0.8, [cyl([0, top + 1.1, 0], 0.3, 'y', 0.025, '#d4af37', 6), sphere([0, top + 1.28, 0], 0.06, '#ffd35a')]);
  b.mod(4, 0.8, [box([-0.75, 0.25, 0.55], [0.3, 0.34, 0.3], '#9aa3ad', 0.05), sphere([-0.75, 0.55, 0.55], 0.2, '#4fa244'), box([0.75, 0.25, 0.55], [0.3, 0.34, 0.3], '#9aa3ad', 0.05), sphere([0.75, 0.55, 0.55], 0.2, '#4fa244')]);
  return b.done();
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * 0.9)));
  return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
