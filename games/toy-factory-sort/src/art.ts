import Phaser from 'phaser';
import { COLORS, OUT, PART_H, PART_W } from './config';

// All art is procedural: flat fills with a thick dark outline, generated into
// textures once at boot.

type G = Phaser.GameObjects.Graphics;
const LW = 4;

export function shade(c: number, f: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f)));
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

function rr(g: G, x: number, y: number, w: number, h: number, r: number, fill: number) {
  g.fillStyle(fill, 1);
  g.fillRoundedRect(x, y, w, h, r);
  g.lineStyle(LW, OUT, 1);
  g.strokeRoundedRect(x, y, w, h, r);
}
function circ(g: G, x: number, y: number, r: number, fill: number) {
  g.fillStyle(fill, 1);
  g.fillCircle(x, y, r);
  g.lineStyle(LW, OUT, 1);
  g.strokeCircle(x, y, r);
}
function ell(g: G, x: number, y: number, w: number, h: number, fill: number) {
  g.fillStyle(fill, 1);
  g.fillEllipse(x, y, w, h);
  g.lineStyle(LW, OUT, 1);
  g.strokeEllipse(x, y, w, h);
}
function poly(g: G, pts: number[], fill: number) {
  const p: Phaser.Types.Math.Vector2Like[] = [];
  for (let i = 0; i < pts.length; i += 2) p.push({ x: pts[i], y: pts[i + 1] });
  g.fillStyle(fill, 1);
  g.fillPoints(p, true);
  g.lineStyle(LW, OUT, 1);
  g.strokePoints(p, true, true);
}
function dot(g: G, x: number, y: number, r: number, fill: number) {
  g.fillStyle(fill, 1);
  g.fillCircle(x, y, r);
}

const WHITE = 0xffffff;
const GLASS = 0xbfe9ff;
const TYRE = 0x3b3b4a;
const LAMP = 0xffe066;

type PieceFn = (g: G, c: number) => void;

// [toy][piece] where piece 0 = base, 1 = body, 2 = head. Canvas 64x48.
const PIECES: PieceFn[][] = [
  // ROBOT
  [
    (g, c) => {
      rr(g, 17, 10, 11, 22, 3, shade(c, 0.8));
      rr(g, 36, 10, 11, 22, 3, shade(c, 0.8));
      rr(g, 7, 30, 23, 14, 6, c);
      rr(g, 34, 30, 23, 14, 6, c);
      rr(g, 12, 4, 40, 11, 5, c);
    },
    (g, c) => {
      rr(g, 3, 8, 13, 26, 6, shade(c, 0.8));
      rr(g, 48, 8, 13, 26, 6, shade(c, 0.8));
      rr(g, 12, 3, 40, 42, 8, c);
      rr(g, 20, 10, 24, 16, 4, shade(c, 1.55));
      dot(g, 27, 18, 3.5, LAMP);
      dot(g, 37, 18, 3.5, 0x7ee0ff);
      g.lineStyle(3, OUT, 1);
      g.lineBetween(21, 35, 43, 35);
    },
    (g, c) => {
      rr(g, 29, 4, 6, 12, 2, OUT);
      circ(g, 32, 7, 4.5, LAMP);
      rr(g, 9, 13, 46, 32, 10, c);
      circ(g, 23, 27, 6.5, WHITE);
      circ(g, 41, 27, 6.5, WHITE);
      dot(g, 24, 28, 3, OUT);
      dot(g, 42, 28, 3, OUT);
      rr(g, 24, 37, 16, 4, 2, OUT);
    },
  ],
  // CAR
  [
    (g, c) => {
      rr(g, 4, 9, 56, 14, 6, shade(c, 0.78));
      circ(g, 17, 32, 11, TYRE);
      circ(g, 47, 32, 11, TYRE);
      dot(g, 17, 32, 4, 0xd9d9e3);
      dot(g, 47, 32, 4, 0xd9d9e3);
    },
    (g, c) => {
      rr(g, 3, 8, 58, 32, 12, c);
      g.fillStyle(WHITE, 1);
      g.fillRect(9, 22, 46, 5);
      circ(g, 54, 17, 4, LAMP);
      g.lineStyle(3, OUT, 1);
      g.lineBetween(31, 11, 31, 37);
      dot(g, 37, 31, 2.5, OUT);
    },
    (g, c) => {
      poly(g, [10, 45, 19, 7, 45, 7, 54, 45], c);
      poly(g, [19, 40, 24, 14, 30, 14, 30, 40], GLASS);
      poly(g, [34, 40, 34, 14, 40, 14, 45, 40], GLASS);
    },
  ],
  // DUCK (pull toy)
  [
    (g, c) => {
      rr(g, 5, 8, 54, 15, 6, c);
      circ(g, 16, 33, 10, TYRE);
      circ(g, 48, 33, 10, TYRE);
      dot(g, 16, 33, 3.5, 0xe5483f);
      dot(g, 48, 33, 3.5, 0xe5483f);
    },
    (g, c) => {
      poly(g, [4, 9, 22, 18, 12, 32], c);
      ell(g, 34, 26, 52, 36, c);
      ell(g, 32, 26, 26, 15, shade(c, 0.82));
    },
    (g, c) => {
      poly(g, [24, 13, 29, 4, 34, 13], c);
      circ(g, 28, 28, 17, c);
      ell(g, 49, 32, 20, 11, 0xf08a2c);
      dot(g, 32, 24, 3.6, OUT);
      dot(g, 33.2, 22.8, 1.3, WHITE);
    },
  ],
  // FROG
  [
    (g, c) => {
      ell(g, 17, 26, 28, 26, shade(c, 0.85));
      ell(g, 47, 26, 28, 26, shade(c, 0.85));
      ell(g, 13, 41, 22, 9, c);
      ell(g, 51, 41, 22, 9, c);
    },
    (g, c) => {
      ell(g, 32, 25, 52, 42, c);
      ell(g, 32, 29, 30, 26, shade(c, 1.5));
      dot(g, 15, 17, 3, shade(c, 0.7));
      dot(g, 49, 19, 3, shade(c, 0.7));
    },
    (g, c) => {
      circ(g, 17, 16, 11, c);
      circ(g, 47, 16, 11, c);
      ell(g, 32, 32, 58, 26, c);
      circ(g, 17, 15, 6, WHITE);
      circ(g, 47, 15, 6, WHITE);
      dot(g, 18, 15, 3, OUT);
      dot(g, 46, 15, 3, OUT);
      g.lineStyle(3, OUT, 1);
      g.beginPath();
      g.arc(32, 30, 11, 0.25 * Math.PI, 0.75 * Math.PI, false);
      g.strokePath();
    },
  ],
  // ROCKET
  [
    (g, c) => {
      poly(g, [5, 45, 18, 14, 23, 45], shade(c, 0.75));
      poly(g, [59, 45, 46, 14, 41, 45], shade(c, 0.75));
      rr(g, 24, 30, 16, 14, 3, 0x5a5a6e);
      rr(g, 17, 4, 30, 30, 7, c);
    },
    (g, c) => {
      rr(g, 15, 2, 34, 44, 9, c);
      circ(g, 32, 22, 10, GLASS);
      dot(g, 29, 19, 3, WHITE);
      dot(g, 21, 8, 2, OUT);
      dot(g, 43, 8, 2, OUT);
      dot(g, 21, 39, 2, OUT);
      dot(g, 43, 39, 2, OUT);
    },
    (g, c) => {
      poly(g, [13, 45, 32, 4, 51, 45], c);
      poly(g, [19, 35, 45, 35, 48, 42, 16, 42], WHITE);
      dot(g, 32, 22, 4, LAMP);
    },
  ],
  // BEAR
  [
    (g, c) => {
      rr(g, 10, 6, 20, 32, 9, c);
      rr(g, 34, 6, 20, 32, 9, c);
      ell(g, 20, 38, 22, 12, shade(c, 1.4));
      ell(g, 44, 38, 22, 12, shade(c, 1.4));
    },
    (g, c) => {
      ell(g, 10, 22, 16, 30, shade(c, 0.85));
      ell(g, 54, 22, 16, 30, shade(c, 0.85));
      ell(g, 32, 25, 44, 42, c);
      ell(g, 32, 28, 26, 24, shade(c, 1.45));
    },
    (g, c) => {
      circ(g, 15, 15, 9, c);
      circ(g, 49, 15, 9, c);
      dot(g, 15, 15, 4, shade(c, 1.45));
      dot(g, 49, 15, 4, shade(c, 1.45));
      circ(g, 32, 28, 18, c);
      ell(g, 32, 35, 17, 12, shade(c, 1.45));
      dot(g, 32, 32, 3.2, OUT);
      dot(g, 25, 25, 3, OUT);
      dot(g, 39, 25, 3, OUT);
    },
  ],
];

export const pieceKey = (color: number, piece: number) => `pc_${color}_${piece}`;

export function makeTextures(scene: Phaser.Scene) {
  const g = scene.add.graphics();
  for (let c = 0; c < COLORS.length; c++) {
    for (let p = 0; p < 3; p++) {
      g.clear();
      PIECES[c][p](g, COLORS[c]);
      g.generateTexture(pieceKey(c, p), PART_W, PART_H);
    }
  }
  // plastic flash chip (tinted per toy)
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillRect(0, 0, 12, 6);
  g.generateTexture('chip', 12, 6);
  // steam puff
  g.clear();
  for (let i = 6; i > 0; i--) {
    g.fillStyle(0xffffff, 0.12);
    g.fillCircle(16, 16, i * 2.6);
  }
  g.generateTexture('puff', 32, 32);
  // belt surface tile: rubber with chevrons pointing right
  g.clear();
  g.fillStyle(0x3a3546, 1);
  g.fillRect(0, 0, 40, 16);
  g.lineStyle(3, 0x56506a, 1);
  g.lineBetween(12, 3, 20, 8);
  g.lineBetween(20, 8, 12, 13);
  g.fillStyle(0x2c2836, 1);
  g.fillRect(38, 0, 2, 16);
  g.generateTexture('belt', 40, 16);
  // lift cleats
  g.clear();
  g.fillStyle(0x3a3546, 1);
  g.fillRect(0, 0, 40, 40);
  g.fillStyle(0x6b6480, 1);
  g.fillRect(0, 34, 40, 6);
  g.generateTexture('cleat', 40, 40);
  g.destroy();
}
