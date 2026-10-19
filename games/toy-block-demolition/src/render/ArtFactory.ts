import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BLOCK_COLORS, GRID, PALETTE } from '../game/config';

/**
 * Procedural art: every block, fragment, cargo chunk and icon shares one smooth
 * beveled-prism language (no studs, sockets or logos). Geometries and materials
 * are created once and shared.
 */

type Rgb = [number, number, number];

/** Fill (or overwrite) a vertex colour attribute using a per-vertex function. */
export function paint(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => Rgb): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const white = (): Rgb => [1, 1, 1];

export function roundedBox(w: number, h: number, d: number, r: number, seg = 1): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, seg, r);
  return g;
}

export function makeStarGeometry(outer: number, inner: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
    const r = k % 2 === 0 ? outer : inner;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (k === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.4,
    bevelSize: outer * 0.08,
    bevelSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Three chasing arrows around a centre point (original simple recycle mark). */
export function drawRecycle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = r * 0.26;
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    ctx.save();
    ctx.rotate((k * Math.PI * 2) / 3);
    const a0 = -Math.PI / 2 + 0.35;
    const a1 = a0 + (Math.PI * 2) / 3 - 0.75;
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a1);
    ctx.stroke();
    // Arrow head
    const hx = Math.cos(a1) * r;
    const hy = Math.sin(a1) * r;
    const tx = -Math.sin(a1);
    const ty = Math.cos(a1);
    const s = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(hx + tx * s * 0.9, hy + ty * s * 0.9);
    ctx.lineTo(hx - Math.cos(a1) * s * 0.6 - tx * s * 0.2, hy - Math.sin(a1) * s * 0.6 - ty * s * 0.2);
    ctx.lineTo(hx + Math.cos(a1) * s * 0.6 - tx * s * 0.2, hy + Math.sin(a1) * s * 0.6 - ty * s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export class ArtFactory {
  readonly blockColors: THREE.Color[];
  readonly blockMat: THREE.MeshStandardMaterial;
  readonly chunkMat: THREE.MeshStandardMaterial;
  readonly geo: {
    block: THREE.BufferGeometry;
    pair: THREE.BufferGeometry;
    reinforced: THREE.BufferGeometry;
    bonus: THREE.BufferGeometry;
    star: THREE.BufferGeometry;
    chunk: THREE.BufferGeometry;
    shard: THREE.BufferGeometry;
    sparkle: THREE.BufferGeometry;
    confetti: THREE.BufferGeometry;
    puff: THREE.BufferGeometry;
    marker: THREE.BufferGeometry;
  };
  readonly mats: Record<
    'orange' | 'yellow' | 'dark' | 'rubber' | 'windshield' | 'glass' | 'beacon' | 'cream' | 'blue' | 'green' | 'coral' | 'violet' | 'steel' | 'star' | 'sparkle' | 'confetti' | 'puff' | 'marker' | 'arrow',
    THREE.Material
  >;
  readonly textures: {
    floor: THREE.CanvasTexture;
    pad: THREE.CanvasTexture;
    blob: THREE.CanvasTexture;
    upgradeSign: THREE.CanvasTexture;
    gateSign: THREE.CanvasTexture;
    lane: THREE.CanvasTexture;
  };

  constructor() {
    this.blockColors = BLOCK_COLORS.map((c) => new THREE.Color(c));

    this.blockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0 });
    this.chunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });

    const S = GRID.blockSize;
    const H = GRID.blockHeight;
    const B = GRID.bevel;
    // Soft top light: slightly brighter top face, gently darker toward the base.
    const shade = (_x: number, y: number): Rgb => {
      const t = y / H + 0.5;
      const v = 0.74 + 0.26 * Math.pow(t, 0.8);
      return [v, v, v];
    };
    const block = paint(roundedBox(S, H, S, B, 1), shade);
    const pair = paint(roundedBox(S * 2 + (GRID.pitch - S), H, S, B, 1), shade);

    // Reinforced: deeper-toned body with a thick, lighter top bevel — a raised
    // "armoured rim" that reads as tougher without outlines or extra meshes.
    const RB = B * 1.9;
    const reinforced = paint(roundedBox(S, H, S, RB, 1), (x, y, z) => {
      const s = shade(x, y);
      const onTopRim = y > H / 2 - RB * 0.6 && (Math.abs(x) > S / 2 - RB * 0.6 || Math.abs(z) > S / 2 - RB * 0.6);
      const k = onTopRim ? 1.3 : 0.86;
      return [s[0] * k, s[1] * k, s[2] * k];
    });

    const bonus = paint(roundedBox(S, H, S, B, 1), (x, y) => {
      const s = shade(x, y);
      return y > H * 0.3 ? [s[0] * 1.14, s[1] * 1.08, s[2] * 0.92] : s;
    });

    const star = makeStarGeometry(0.17, 0.075, 0.03);
    const chunk = paint(roundedBox(0.2, 0.2, 0.2, 0.04, 1), white);
    const shard = paint(new THREE.BoxGeometry(0.1, 0.1, 0.1), white);
    const sparkle = new THREE.OctahedronGeometry(0.07, 0);
    const confetti = new THREE.PlaneGeometry(0.14, 0.08);
    const puff = new THREE.IcosahedronGeometry(0.16, 1);
    const marker = new THREE.ConeGeometry(0.16, 0.3, 4);
    marker.rotateX(Math.PI);

    this.geo = { block, pair, reinforced, bonus, star, chunk, shard, sparkle, confetti, puff, marker };

    const std = (color: string, roughness = 0.45, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
    this.mats = {
      orange: std(PALETTE.orange, 0.42),
      yellow: std(PALETTE.highlight, 0.4),
      dark: std(PALETTE.dark, 0.55),
      rubber: std('#2E3942', 0.78),
      windshield: std('#23313C', 0.18, { metalness: 0.1 }),
      glass: new THREE.MeshStandardMaterial({
        color: '#EAF6FF',
        roughness: 0.12,
        metalness: 0,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      beacon: std('#FFB43A', 0.3, { emissive: new THREE.Color('#FF9A1F'), emissiveIntensity: 0.6 }),
      cream: std(PALETTE.uiPanel, 0.5),
      blue: std(PALETTE.blue, 0.42),
      green: std(PALETTE.green, 0.42),
      coral: std(PALETTE.coral, 0.42),
      violet: std(PALETTE.violet, 0.42),
      steel: std('#B9C6CF', 0.35, { metalness: 0.2 }),
      star: std('#FFF4C4', 0.3, { emissive: new THREE.Color('#FFD34D'), emissiveIntensity: 0.35 }),
      sparkle: new THREE.MeshBasicMaterial({ color: '#FFFFFF', toneMapped: false }),
      confetti: new THREE.MeshBasicMaterial({ color: '#FFFFFF', side: THREE.DoubleSide }),
      puff: std('#F4F1E8', 0.9),
      marker: new THREE.MeshBasicMaterial({ color: '#FFF9ED' }),
      arrow: new THREE.MeshBasicMaterial({ color: '#FFF9ED', transparent: true, opacity: 0.95, depthWrite: false }),
    };

    this.textures = {
      floor: this.makeFloorTexture(),
      pad: this.makePadTexture(),
      blob: this.makeBlobTexture(),
      upgradeSign: this.makeSignTexture('UPGRADE', PALETTE.orange, 'wrench'),
      gateSign: this.makeSignTexture('NEXT AREA', PALETTE.green, 'arrow'),
      lane: this.makeLaneTexture(),
    };
  }

  private makeFloorTexture(): THREE.CanvasTexture {
    const t = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = PALETTE.floor;
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(52,64,74,0.07)';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, 125, 125);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      roundRect(ctx, 12, 12, 104, 104, 14);
      ctx.fill();
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  private makeLaneTexture(): THREE.CanvasTexture {
    const t = canvasTexture(128, 256, (ctx) => {
      ctx.fillStyle = '#E7F1E8';
      ctx.fillRect(0, 0, 128, 256);
      ctx.fillStyle = 'rgba(255,201,77,0.85)';
      for (let y = 10; y < 256; y += 64) {
        roundRect(ctx, 56, y, 16, 36, 8);
        ctx.fill();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  private makePadTexture(): THREE.CanvasTexture {
    return canvasTexture(512, 512, (ctx) => {
      ctx.fillStyle = PALETTE.uiPanel;
      roundRect(ctx, 8, 8, 496, 496, 64);
      ctx.fill();
      ctx.lineWidth = 26;
      ctx.strokeStyle = PALETTE.blue;
      roundRect(ctx, 30, 30, 452, 452, 50);
      ctx.stroke();
      // Chevron stripes on the border corners
      ctx.fillStyle = PALETTE.highlight;
      for (const [x, y] of [
        [70, 70],
        [442, 70],
        [70, 442],
        [442, 442],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.fill();
      }
      drawRecycle(ctx, 256, 205, 92, PALETTE.green);
      ctx.fillStyle = PALETTE.uiText;
      ctx.font = '900 112px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SELL', 256, 390);
    });
  }

  private makeBlobTexture(): THREE.CanvasTexture {
    return canvasTexture(128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
      g.addColorStop(0, 'rgba(30,45,52,0.55)');
      g.addColorStop(0.55, 'rgba(30,45,52,0.28)');
      g.addColorStop(1, 'rgba(30,45,52,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });
  }

  private makeSignTexture(text: string, color: string, icon: 'wrench' | 'arrow'): THREE.CanvasTexture {
    return canvasTexture(512, 192, (ctx) => {
      ctx.fillStyle = color;
      roundRect(ctx, 6, 6, 500, 180, 40);
      ctx.fill();
      ctx.fillStyle = PALETTE.uiPanel;
      roundRect(ctx, 22, 22, 468, 148, 30);
      ctx.fill();
      ctx.fillStyle = PALETTE.uiText;
      ctx.font = '900 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(text, 140, 98);
      ctx.save();
      ctx.translate(82, 96);
      ctx.fillStyle = color;
      if (icon === 'wrench') {
        ctx.rotate(-Math.PI / 4);
        roundRect(ctx, -10, -8, 20, 60, 8);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -22, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.uiPanel;
        ctx.fillRect(-8, -52, 16, 30);
      } else {
        ctx.beginPath();
        ctx.moveTo(-34, -14);
        ctx.lineTo(4, -14);
        ctx.lineTo(4, -38);
        ctx.lineTo(40, 0);
        ctx.lineTo(4, 38);
        ctx.lineTo(4, 14);
        ctx.lineTo(-34, 14);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });
  }
}
