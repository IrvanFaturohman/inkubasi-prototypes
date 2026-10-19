import Phaser from 'phaser';
import { COLOURS, TICK_MS, T_BEAM, T_MORPH, T_PLUNGE, T_ROLL, T_MOVE_BASE, T_MOVE_PER, CLEAR_AT } from '../core/config';
import { GRID } from '../core/board';
import { Game, type GameEvent, type Transit } from '../core/game';
import { LEVELS } from '../core/levels';
import { BAND_Y, BALL_R, LANE_CX, LANE_X, TH, TW, TARGET_R, BUMPER_R, buildWalls } from '../core/table';
import { Sfx, buzz } from './audio';

export const W = 720;
export const H = 1280;
const TX = 30; // table offset on screen
const TY = 84;
const BX = 338; // board centre
const BY = 870;
const R = 50; // hex layout radius
const SQ = 0.8; // vertical squash for the 3/4 view
const STEP = 8; // pixels per stacked tile
const THICK = 10;
const TRAY_Y = 1190;
const TRAY_X = [160, 338, 516];
const TRAY_SCALE = 0.86;
const PIPE_X = TX + LANE_CX;
const PIPE_IN_Y = 985;
const LANE_BALL_Y = TY + TH - BALL_R - 2;
const POP = Math.round(T_MORPH * 0.62);
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BG = 0x0d1222;

const attempts = new Map<number, number>();

interface TransitView {
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  from: { x: number; y: number };
  popped: boolean;
  rolled: boolean;
  piped: boolean;
  pulled: boolean;
}

interface TrayView {
  c: Phaser.GameObjects.Container;
  sig: string;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function hexPts(cx: number, cy: number, r: number, sq: number): Phaser.Types.Math.Vector2Like[] {
  const pts: Phaser.Types.Math.Vector2Like[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) * sq });
  }
  return pts;
}

export function cellPos(i: number): { x: number; y: number } {
  const c = GRID[i];
  return { x: BX + R * Math.sqrt(3) * (c.q + c.r / 2), y: BY + R * 1.5 * c.r * SQ };
}

export class GameScene extends Phaser.Scene {
  static bootLevel = 0;
  model!: Game;
  levelIndex = 0;
  sfx = new Sfx();
  manual = false;
  private acc = 0;
  private hitstopUntil = 0;
  private stackVis: Phaser.GameObjects.Image[][] = [];
  private cellImgs: Phaser.GameObjects.Image[] = [];
  private targetImgs: Phaser.GameObjects.Image[] = [];
  private ribbons: Phaser.GameObjects.Rectangle[] = [];
  private bandLabels: Phaser.GameObjects.Text[] = [];
  private bumperImgs: Phaser.GameObjects.Image[] = [];
  private ballImgs = new Map<number, Phaser.GameObjects.Image>();
  private transitViews = new Map<number, TransitView>();
  private lumpAt = new Map<number, { x: number; y: number }>();
  private trayViews: (TrayView | null)[] = [null, null, null];
  private fx!: Phaser.GameObjects.Graphics;
  private trailG!: Phaser.GameObjects.Graphics;
  private trails = new Map<number, { x: number; y: number }[]>();
  private plungerG!: Phaser.GameObjects.Graphics;
  private plungerKick = { v: 0 };
  private emitters: { small: Phaser.GameObjects.Particles.ParticleEmitter; big: Phaser.GameObjects.Particles.ParticleEmitter }[] = [];
  private hud!: {
    bar: Phaser.GameObjects.Graphics;
    hpText: Phaser.GameObjects.Text;
    free: Phaser.GameObjects.Text;
    freeIcon: Phaser.GameObjects.Image;
    chips: Phaser.GameObjects.Container[];
    msg: Phaser.GameObjects.Text;
    mute: Phaser.GameObjects.Text;
  };
  private shownProgress = 0;
  private lastFree = -1;
  private comboStep = 0;
  private placeMoves = 0;
  private drag: { slot: number; sx: number; sy: number; t: number; moved: boolean } | null = null;
  private selected = -1;
  private hover = -1;
  private pending: { slot: number; cell: number } | null = null;
  private overlay: Phaser.GameObjects.Container | null = null;
  private soundThrottle = new Map<string, number>();
  private hintTimer = 0;

  constructor() {
    super('game');
  }

  init(data: { level?: number }): void {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, data.level ?? GameScene.bootLevel));
  }

  create(): void {
    const n = attempts.get(this.levelIndex) ?? 0;
    attempts.set(this.levelIndex, n + 1);
    const lv = LEVELS[this.levelIndex];
    this.model = new Game(this.levelIndex, { seed: lv.seed + n * 101 });
    this.acc = 0;
    this.hitstopUntil = 0;
    this.stackVis = GRID.map(() => []);
    this.ballImgs = new Map();
    this.transitViews = new Map();
    this.trayViews = [null, null, null];
    this.overlay = null;
    this.pending = null;
    this.drag = null;
    this.selected = -1;
    this.hover = -1;
    this.lastFree = -1;
    this.shownProgress = 0;
    this.tweens.timeScale = 1;
    this.cameras.main.setBackgroundColor(BG);
    this.makeTextures();
    this.drawTable();
    this.drawBoard();
    this.drawPipe();
    this.makeHud();
    this.makeEmitters();
    this.fx = this.add.graphics().setDepth(700);
    this.trailG = this.add.graphics().setDepth(19);
    this.trails = new Map();
    this.setupInput();
    for (const p of lv.preset ?? []) this.spawnStack(p.cell, p.stack, false);
    this.processEvents();
    this.banner(`Level ${lv.id}`, lv.name);
    this.hud.msg.setText(lv.hint).setAlpha(1);
    this.hintTimer = 6000;
  }

  // ---------------------------------------------------------------- textures
  private makeTextures(): void {
    if (this.textures.exists('tile0')) return;
    const g = this.add.graphics();
    const tr = R * 0.92;
    const tw = Math.ceil(Math.sqrt(3) * tr) + 4;
    const th = Math.ceil(2 * tr * SQ) + THICK + 4;
    const cx = tw / 2;
    const cy = tr * SQ + 2;
    COLOURS.forEach((c, i) => {
      g.clear();
      g.fillStyle(c.dark, 1);
      g.fillPoints(hexPts(cx, cy + THICK, tr, SQ), true);
      g.fillPoints(hexPts(cx, cy + THICK / 2, tr, SQ), true);
      g.fillStyle(c.hex, 1);
      g.fillPoints(hexPts(cx, cy, tr, SQ), true);
      const inner = hexPts(cx, cy, tr * 0.8, SQ);
      g.lineStyle(3, c.light, 0.7);
      g.strokePoints([inner[4], inner[5], inner[0], inner[1]], false);
      g.lineStyle(2, c.dark, 1);
      g.strokePoints(hexPts(cx, cy, tr, SQ), true);
      g.generateTexture(`tile${i}`, tw, th);
    });
    // board cells
    const cr = R * 0.97;
    const cw = Math.ceil(Math.sqrt(3) * cr) + 4;
    const ch = Math.ceil(2 * cr * SQ) + 10;
    g.clear();
    g.fillStyle(0x080b16, 1);
    g.fillPoints(hexPts(cw / 2, ch / 2 + 4, cr, SQ), true);
    g.fillStyle(0x1c2540, 1);
    g.fillPoints(hexPts(cw / 2, ch / 2, cr, SQ), true);
    g.lineStyle(2, 0x34426a, 1);
    g.strokePoints(hexPts(cw / 2, ch / 2, cr * 0.9, SQ), true);
    g.generateTexture('cell', cw, ch);
    g.clear();
    g.fillStyle(0x05070d, 1);
    g.fillPoints(hexPts(cw / 2, ch / 2 + 4, cr, SQ), true);
    g.fillStyle(0x10152a, 1);
    g.fillPoints(hexPts(cw / 2, ch / 2, cr, SQ), true);
    g.lineStyle(2, 0x222b45, 1);
    for (let k = -3; k <= 3; k++) g.lineBetween(cw / 2 - 30 + k * 12, ch / 2 + 22, cw / 2 - 10 + k * 12, ch / 2 - 22);
    g.fillStyle(0x10152a, 1);
    g.fillRoundedRect(cw / 2 - 17, ch / 2 - 12, 34, 30, 6);
    g.lineStyle(5, 0x6a7598, 1);
    g.beginPath();
    g.arc(cw / 2, ch / 2 - 10, 10, Math.PI, 0, false);
    g.strokePath();
    g.fillStyle(0x6a7598, 1);
    g.fillRoundedRect(cw / 2 - 15, ch / 2 - 10, 30, 24, 5);
    g.fillStyle(0x10152a, 1);
    g.fillCircle(cw / 2, ch / 2 + 0, 4);
    g.fillRect(cw / 2 - 1.5, ch / 2, 3, 8);
    g.generateTexture('cellLocked', cw, ch);
    // balls, targets
    const bs = BALL_R * 2 + 4;
    COLOURS.forEach((c, i) => {
      g.clear();
      g.fillStyle(c.dark, 1);
      g.fillCircle(bs / 2, bs / 2, BALL_R);
      g.fillStyle(c.hex, 1);
      g.fillCircle(bs / 2 - 1, bs / 2 - 1, BALL_R - 2);
      g.fillStyle(0xffffff, 0.85);
      g.fillCircle(bs / 2 - 4, bs / 2 - 5, 3.5);
      g.generateTexture(`ball${i}`, bs, bs);
      const ts = TARGET_R * 2 + 6;
      g.clear();
      g.fillStyle(0x000000, 0.35);
      g.fillCircle(ts / 2 + 1, ts / 2 + 3, TARGET_R);
      g.fillStyle(c.dark, 1);
      g.fillCircle(ts / 2, ts / 2, TARGET_R);
      g.fillStyle(c.hex, 1);
      g.fillCircle(ts / 2, ts / 2, TARGET_R - 4);
      g.lineStyle(2, c.light, 0.9);
      g.strokeCircle(ts / 2, ts / 2, TARGET_R - 8);
      g.fillStyle(0xffffff, 0.7);
      g.fillCircle(ts / 2 - 5, ts / 2 - 6, 3);
      g.generateTexture(`tgt${i}`, ts, ts);
    });
    const ts = TARGET_R * 2 + 6;
    g.clear();
    g.fillStyle(0x2a3350, 1);
    g.fillCircle(ts / 2, ts / 2, TARGET_R);
    g.fillStyle(0x3a4466, 1);
    g.fillCircle(ts / 2, ts / 2, TARGET_R - 5);
    g.generateTexture('peg', ts, ts);
    const bp = BUMPER_R * 2 + 8;
    g.clear();
    g.fillStyle(0xe8f4ff, 1);
    g.fillCircle(bp / 2, bp / 2, BUMPER_R);
    g.fillStyle(0x2b3a66, 1);
    g.fillCircle(bp / 2, bp / 2, BUMPER_R - 5);
    g.fillStyle(0x8ad8ff, 1);
    g.fillCircle(bp / 2, bp / 2, 7);
    g.generateTexture('bumper', bp, bp);
    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(6, 6, 6);
    g.generateTexture('dot', 12, 12);
    g.clear();
    for (let k = 10; k >= 1; k--) {
      g.fillStyle(0xffffff, 0.06 + (10 - k) * 0.012);
      g.fillCircle(32, 32, k * 3.2);
    }
    g.generateTexture('glow', 64, 64);
    g.clear();
    g.lineStyle(5, 0xffffff, 1);
    g.strokeCircle(40, 40, 36);
    g.generateTexture('ring', 80, 80);
    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillPoints(hexPts(16, 16, 15, 1), true);
    g.generateTexture('hexIcon', 32, 32);
    g.destroy();
  }

  private makeEmitters(): void {
    this.emitters = [];
    const tints = [...COLOURS.map((c) => c.hex), 0xffffff];
    for (const tint of tints) {
      const small = this.add.particles(0, 0, 'dot', {
        speed: { min: 80, max: 280 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.8, end: 0 },
        lifespan: { min: 250, max: 480 },
        gravityY: 500,
        tint,
        emitting: false,
      });
      const big = this.add.particles(0, 0, 'dot', {
        speed: { min: 220, max: 720 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.4, end: 0 },
        lifespan: { min: 450, max: 850 },
        gravityY: 900,
        tint,
        emitting: false,
      });
      small.setDepth(800);
      big.setDepth(800);
      this.emitters.push({ small, big });
    }
  }

  private burst(colour: number, x: number, y: number, n: number, big = false): void {
    const e = this.emitters[colour < 0 ? COLOURS.length : colour];
    (big ? e.big : e.small).explode(n, x, y);
  }

  // ---------------------------------------------------------------- static drawing
  private drawTable(): void {
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(0x151c33, 1);
    g.fillRoundedRect(TX - 10, TY - 10, TW + 20, TH + 20, 26);
    g.fillStyle(0x0f1528, 1);
    g.fillRoundedRect(TX, TY, TW, TH, 18);
    // faint grid
    g.lineStyle(1, 0x1a2340, 1);
    for (let x = 30; x < LANE_X; x += 30) g.lineBetween(TX + x, TY + 20, TX + x, TY + TH - 60);
    // bands (ribbons)
    this.ribbons = [];
    this.bandLabels = [];
    this.model.level.bands.forEach((b, i) => {
      const r = this.add
        .rectangle(TX + LANE_X / 2, TY + BAND_Y[i], LANE_X - 8, 40, COLOURS[b.colour].hex, 0.13)
        .setDepth(2)
        .setStrokeStyle(1, COLOURS[b.colour].hex, 0.25);
      this.ribbons.push(r);
      const t = this.add
        .text(TX + LANE_X - 18, TY + BAND_Y[i], `${b.hp}`, { fontFamily: FONT, fontSize: '20px', fontStyle: 'bold', color: '#ffffff' })
        .setOrigin(0.5)
        .setDepth(6)
        .setStroke('#0b0f1c', 5);
      this.bandLabels.push(t);
    });
    // walls
    const wg = this.add.graphics().setDepth(4);
    for (const s of buildWalls()) {
      const col = s.kind === 'sling' ? 0xff8fb1 : s.kind === 'gate' ? 0x8ad8ff : 0x8c9bd0;
      wg.lineStyle(s.kind === 'gate' ? 3 : 6, col, s.kind === 'gate' ? 0.8 : 1);
      wg.lineBetween(TX + s.ax, TY + s.ay, TX + s.bx, TY + s.by);
    }
    // targets, bumpers
    this.targetImgs = this.model.table.targets.map((t) =>
      this.add.image(TX + t.x, TY + t.y, `tgt${t.colour}`).setDepth(5),
    );
    this.bumperImgs = this.model.table.bumpers.map((b) => this.add.image(TX + b.x, TY + b.y, 'bumper').setDepth(5));
    // drain mouth
    g.fillStyle(0x05070d, 1);
    g.fillRect(TX + 255, TY + TH - 6, 96, 16);
    this.plungerG = this.add.graphics().setDepth(6);
  }

  private drawBoard(): void {
    const g = this.add.graphics().setDepth(40);
    g.fillStyle(0x121a30, 1);
    g.fillPoints(hexPts(BX, BY + 8, R * 5.4, SQ), true);
    g.lineStyle(3, 0x222d4d, 1);
    g.strokePoints(hexPts(BX, BY + 8, R * 5.4, SQ), true);
    this.cellImgs = GRID.map((_, i) => {
      const p = cellPos(i);
      return this.add.image(p.x, p.y + 4, this.model.board.locked[i] ? 'cellLocked' : 'cell').setDepth(50);
    });
  }

  private drawPipe(): void {
    const g = this.add.graphics().setDepth(45);
    const top = TY + TH - 2;
    g.lineStyle(34, 0x0a0e1a, 1);
    g.lineBetween(PIPE_X, PIPE_IN_Y, PIPE_X, top);
    g.lineStyle(26, 0x26314f, 1);
    g.lineBetween(PIPE_X, PIPE_IN_Y, PIPE_X, top);
    g.lineStyle(4, 0x6f80b8, 0.5);
    g.lineBetween(PIPE_X - 7, PIPE_IN_Y - 6, PIPE_X - 7, top + 4);
    // funnel mouth
    g.fillStyle(0x0a0e1a, 1);
    g.fillPoints(
      [
        { x: PIPE_X - 34, y: PIPE_IN_Y - 22 },
        { x: PIPE_X + 34, y: PIPE_IN_Y - 22 },
        { x: PIPE_X + 17, y: PIPE_IN_Y + 14 },
        { x: PIPE_X - 17, y: PIPE_IN_Y + 14 },
      ],
      true,
    );
    g.fillStyle(0x34426a, 1);
    g.fillPoints(
      [
        { x: PIPE_X - 29, y: PIPE_IN_Y - 18 },
        { x: PIPE_X + 29, y: PIPE_IN_Y - 18 },
        { x: PIPE_X + 14, y: PIPE_IN_Y + 10 },
        { x: PIPE_X - 14, y: PIPE_IN_Y + 10 },
      ],
      true,
    );
    g.fillStyle(0x05070d, 1);
    g.fillEllipse(PIPE_X, PIPE_IN_Y - 18, 54, 12);
  }

  private makeHud(): void {
    const lv = this.model.level;
    this.add
      .text(24, 22, `LEVEL ${lv.id}`, { fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: '#ffffff' })
      .setDepth(900);
    this.add.text(24, 52, lv.name, { fontFamily: FONT, fontSize: '16px', color: '#8f9cc8' }).setDepth(900);
    const bar = this.add.graphics().setDepth(900);
    const hpText = this.add
      .text(345, 50, '', { fontFamily: FONT, fontSize: '14px', color: '#8f9cc8' })
      .setOrigin(0.5, 0)
      .setDepth(900);
    const freeIcon = this.add.image(538, 38, 'hexIcon').setTint(0x34d17c).setScale(1.5).setDepth(900);
    const free = this.add
      .text(538, 38, '14', { fontFamily: FONT, fontSize: '20px', fontStyle: 'bold', color: '#0b1a12' })
      .setOrigin(0.5)
      .setDepth(901);
    this.add
      .text(538, 64, 'FREE', { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: '#8f9cc8' })
      .setOrigin(0.5, 0)
      .setDepth(900);
    const restart = this.add
      .text(620, 38, '↻', { fontFamily: FONT, fontSize: '34px', color: '#c8d2f0' })
      .setOrigin(0.5)
      .setDepth(900)
      .setInteractive({ useHandCursor: true });
    restart.on('pointerdown', () => {
      this.sfx.ui();
      this.scene.restart({ level: this.levelIndex });
    });
    const mute = this.add
      .text(682, 38, '♪', { fontFamily: FONT, fontSize: '30px', color: '#c8d2f0' })
      .setOrigin(0.5)
      .setDepth(900)
      .setInteractive({ useHandCursor: true });
    mute.on('pointerdown', () => {
      this.sfx.muted = !this.sfx.muted;
      mute.setAlpha(this.sfx.muted ? 0.35 : 1);
    });
    mute.setAlpha(this.sfx.muted ? 0.35 : 1);
    // colour chips: which colours the table still wants
    const cols = lv.tileColours;
    const chips = cols.map((c, i) => {
      const x = 345 + (i - (cols.length - 1) / 2) * 30;
      const ct = this.add.container(x, 80).setDepth(900);
      ct.add(this.add.image(0, 0, 'hexIcon').setTint(COLOURS[c].hex).setScale(0.7));
      const cross = this.add.text(0, 0, '×', { fontFamily: FONT, fontSize: '22px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5, 0.55);
      cross.setVisible(false);
      ct.add(cross);
      ct.setData('colour', c);
      return ct;
    });
    const msg = this.add
      .text(W / 2, 1082, '', {
        fontFamily: FONT,
        fontSize: '19px',
        fontStyle: 'bold',
        color: '#dfe6ff',
        align: 'center',
        wordWrap: { width: 560 },
      })
      .setOrigin(0.5)
      .setDepth(900)
      .setStroke('#0b0f1c', 5);
    this.hud = { bar, hpText, free, freeIcon, chips, msg, mute };
  }

  private banner(title: string, sub: string): void {
    const c = this.add.container(W / 2, 420).setDepth(950);
    const t = this.add
      .text(0, 0, title.toUpperCase(), { fontFamily: FONT, fontSize: '60px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setStroke('#0b0f1c', 10);
    const s = this.add
      .text(0, 52, sub, { fontFamily: FONT, fontSize: '26px', color: '#ffd76a' })
      .setOrigin(0.5)
      .setStroke('#0b0f1c', 6);
    c.add([t, s]);
    c.setScale(0.4).setAlpha(0);
    this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 520, ease: 'Back.Out' });
    this.tweens.add({ targets: c, alpha: 0, y: 380, delay: 1500, duration: 400, onComplete: () => c.destroy() });
  }

  // ---------------------------------------------------------------- input
  private setupInput(): void {
    for (let i = 0; i < 3; i++) {
      const z = this.add.zone(TRAY_X[i], TRAY_Y - 30, 170, 170).setInteractive().setDepth(10);
      z.on('pointerdown', (p: Phaser.Input.Pointer) => this.startDrag(i, p));
    }
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveDrag(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.endDrag(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.sfx.unlock();
      if (this.selected >= 0 && !this.drag) {
        const cell = this.cellAt(p.x, p.y);
        if (cell >= 0) this.commitPlace(this.selected, cell);
      }
    });
    this.input.keyboard?.on('keydown-R', () => this.scene.restart({ level: this.levelIndex }));
  }

  private cellAt(x: number, y: number): number {
    let best = -1;
    let bd = 52 * 52;
    for (const i of this.model.free()) {
      if (this.pending && this.pending.cell === i) continue;
      const p = cellPos(i);
      const d = (p.x - x) ** 2 + ((p.y - y) / SQ) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private startDrag(slot: number, p: Phaser.Input.Pointer): void {
    this.sfx.unlock();
    if (this.model.status !== 'playing' || this.pending) return;
    const tv = this.trayViews[slot];
    if (!tv || !this.model.tray[slot]) return;
    if (this.selected >= 0 && this.selected !== slot) this.unselect();
    this.drag = { slot, sx: p.x, sy: p.y, t: this.time.now, moved: false };
    this.tweens.killTweensOf(tv.c);
    tv.c.setDepth(600);
    this.tweens.add({ targets: tv.c, scale: 1, duration: 140, ease: 'Back.Out' });
    this.sfx.pick();
    buzz(6);
  }

  private moveDrag(p: Phaser.Input.Pointer): void {
    if (!this.drag) return;
    const tv = this.trayViews[this.drag.slot];
    if (!tv) return;
    if (Math.abs(p.x - this.drag.sx) + Math.abs(p.y - this.drag.sy) > 14) this.drag.moved = true;
    if (!this.drag.moved) return;
    tv.c.x = p.x;
    tv.c.y = p.y - 90;
    this.setHover(this.cellAt(tv.c.x, tv.c.y));
  }

  private endDrag(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const tv = this.trayViews[d.slot];
    if (!tv) return;
    if (!d.moved) {
      // tap: select the stack, then tap a cell
      if (this.selected === d.slot) this.unselect();
      else {
        this.selected = d.slot;
        this.tweens.add({ targets: tv.c, x: TRAY_X[d.slot], y: TRAY_Y - 26, scale: 0.8, duration: 160, ease: 'Back.Out' });
      }
      return;
    }
    const cell = this.cellAt(p.x, p.y - 90);
    this.setHover(-1);
    if (cell >= 0) this.commitPlace(d.slot, cell);
    else {
      this.sfx.drop();
      this.returnToSlot(d.slot);
    }
  }

  private returnToSlot(slot: number): void {
    const tv = this.trayViews[slot];
    if (!tv) return;
    tv.c.setDepth(560);
    this.tweens.add({ targets: tv.c, x: TRAY_X[slot], y: TRAY_Y, scale: TRAY_SCALE, duration: 380, ease: 'Elastic.Out', easeParams: [1, 0.6] });
  }

  /** Harness: place without input. Returns the board events or null when illegal / busy. */
  harnessPlace(slot: number, cell: number) {
    const evs = this.model.place(slot, cell);
    this.processEvents();
    return evs;
  }

  /** Harness: advance the model by fixed ticks, playing events as they come due. */
  manualStep(n: number): void {
    for (let i = 0; i < n; i++) {
      this.model.step(1);
      this.processEvents();
    }
  }

  private unselect(): void {
    const s = this.selected;
    this.selected = -1;
    const tv = s >= 0 ? this.trayViews[s] : null;
    if (tv) this.tweens.add({ targets: tv.c, x: TRAY_X[s], y: TRAY_Y, scale: TRAY_SCALE, duration: 200, ease: 'Back.Out' });
  }

  private setHover(cell: number): void {
    if (cell === this.hover) return;
    if (this.hover >= 0) this.cellImgs[this.hover].clearTint().setScale(1);
    this.hover = cell;
    if (cell >= 0) {
      this.cellImgs[cell].setTint(0x9fd8ff).setScale(1.06);
      this.sfx.tileLand(-6);
    }
  }

  private commitPlace(slot: number, cell: number): void {
    const tv = this.trayViews[slot];
    this.selected = -1;
    if (!tv) return;
    const p = cellPos(cell);
    if (this.model.canPlace()) {
      this.placeNow(slot, cell);
      return;
    }
    // board still animating: park the stack on the cell and place as soon as it settles
    this.pending = { slot, cell };
    this.tweens.add({ targets: tv.c, x: p.x, y: p.y, scale: 1, duration: 120 });
  }

  private placeNow(slot: number, cell: number): boolean {
    const evs = this.model.place(slot, cell);
    if (!evs) return false;
    this.processEvents();
    return true;
  }

  // ---------------------------------------------------------------- stacks
  private tileY(cell: number, i: number): number {
    return cellPos(cell).y - i * STEP;
  }

  private tileDepth(cell: number, i: number): number {
    return 100 + cellPos(cell).y / 10 + i / 100;
  }

  private spawnStack(cell: number, stack: number[], animate: boolean): void {
    const p = cellPos(cell);
    stack.forEach((c, i) => {
      const img = this.add.image(p.x, this.tileY(cell, i), `tile${c}`).setDepth(this.tileDepth(cell, i));
      this.stackVis[cell].push(img);
      if (animate) {
        img.y -= 26;
        img.setScale(1.08, 0.9);
        this.tweens.add({
          targets: img,
          y: this.tileY(cell, i),
          duration: 120 + i * 18,
          ease: 'Quad.In',
          onComplete: () => this.squash(img, 0.12),
        });
      }
    });
  }

  private squash(img: Phaser.GameObjects.Image, amt: number): void {
    img.setScale(1 + amt, 1 - amt * 1.6);
    this.tweens.add({ targets: img, scaleX: 1, scaleY: 1, duration: 320, ease: 'Elastic.Out', easeParams: [1, 0.5] });
  }

  private syncTray(): void {
    for (let i = 0; i < 3; i++) {
      const st = this.model.tray[i];
      const sig = st ? st.join('') : '';
      const tv = this.trayViews[i];
      if (tv && tv.sig === sig) continue;
      if (tv) tv.c.destroy();
      this.trayViews[i] = null;
      if (!st) continue;
      const c = this.add.container(TRAY_X[i], TRAY_Y).setDepth(560);
      const sh = this.add.ellipse(0, 20, 90, 32, 0x000000, 0.35);
      c.add(sh);
      st.forEach((col, k) => c.add(this.add.image(0, -k * STEP, `tile${col}`)));
      c.setScale(0);
      this.tweens.add({ targets: c, scale: TRAY_SCALE, duration: 520, delay: i * 70, ease: 'Elastic.Out', easeParams: [1, 0.55] });
      this.trayViews[i] = { c, sig };
    }
  }

  // ---------------------------------------------------------------- events
  processEvents(): void {
    for (const e of this.model.drainEvents()) this.play(e);
  }

  private throttle(key: string, ms: number): boolean {
    const now = this.time.now;
    if ((this.soundThrottle.get(key) ?? 0) > now) return false;
    this.soundThrottle.set(key, now + ms);
    return true;
  }

  private hitstop(ms = 90): void {
    this.hitstopUntil = Math.max(this.hitstopUntil, this.time.now + ms);
  }

  private shake(k: number): void {
    this.cameras.main.shake(90 + k * 40, Math.min(0.012, 0.002 + k * 0.0016));
  }

  private floatText(x: number, y: number, s: string, colour: string, size = 28): void {
    const t = this.add
      .text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color: colour })
      .setOrigin(0.5)
      .setDepth(920)
      .setStroke('#0b0f1c', 6)
      .setScale(0.3);
    this.tweens.add({ targets: t, scale: 1, duration: 300, ease: 'Back.Out' });
    this.tweens.add({ targets: t, y: y - 60, alpha: 0, delay: 450, duration: 520, onComplete: () => t.destroy() });
  }

  private play(e: GameEvent): void {
    switch (e.kind) {
      case 'tray':
        this.syncTray();
        break;
      case 'place': {
        this.comboStep = 0;
        this.placeMoves = 0;
        if (e.slot !== undefined) {
          this.trayViews[e.slot]?.c.destroy();
          this.trayViews[e.slot] = null;
        }
        for (let i = 0; i < 3; i++) {
          const v = this.trayViews[i];
          if (v && !this.model.tray[i]) {
            v.c.destroy();
            this.trayViews[i] = null;
          }
        }
        this.pending = null;
        this.spawnStack(e.cell, e.stack, true);
        this.sfx.place();
        buzz(12);
        const p = cellPos(e.cell);
        this.burst(-1, p.x, p.y, 6);
        this.syncTray();
        break;
      }
      case 'move':
        this.playMove(e.from, e.to, e.count);
        break;
      case 'clear':
        this.playCompress(e.cell, e.colour, e.count);
        break;
      case 'transit': {
        const from = this.lumpAt.get(e.cell) ?? { x: PIPE_X, y: PIPE_IN_Y - 40 };
        const img = this.add.image(from.x, from.y, `ball${e.colour}`).setDepth(610).setVisible(false);
        const glow = this.add
          .image(from.x, from.y, 'glow')
          .setTint(COLOURS[e.colour].hex)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(605)
          .setVisible(false);
        this.transitViews.set(e.id, { img, glow, from, popped: false, rolled: false, piped: false, pulled: false });
        break;
      }
      case 'launch': {
        this.plungerKick.v = 1;
        this.tweens.add({ targets: this.plungerKick, v: 0, duration: 420, ease: 'Elastic.Out' });
        this.sfx.plunge();
        this.shake(1);
        buzz(18);
        this.burst(e.colour, PIPE_X, LANE_BALL_Y + 6, 10);
        if (!this.model.neededColours().has(e.colour)) {
          this.floatText(TX + LANE_X - 100, TY + 460, `No ${COLOURS[e.colour].name.toLowerCase()} targets`, '#9aa3bf', 22);
          this.sfx.wasted();
        }
        break;
      }
      case 'hit': {
        const t = this.model.table.targets[e.target];
        const img = this.targetImgs[e.target];
        if (e.same) {
          this.tweens.killTweensOf(img);
          img.setScale(1.45).setTintFill(0xffffff);
          this.time.delayedCall(60, () => img.clearTint());
          this.tweens.add({ targets: img, scale: 1, duration: 360, ease: 'Elastic.Out', easeParams: [1, 0.45] });
          this.burst(t.colour, TX + t.x, TY + t.y, 6 + e.dmg * 3);
          this.sfx.hitSame(e.streak);
          if (e.dmg > 1) {
            this.floatText(TX + t.x, TY + t.y - 26, `-${e.dmg}`, '#ffffff', 20 + e.dmg * 4);
            this.shake(e.dmg - 1);
          }
          buzz(8);
          const lbl = this.bandLabels[e.band];
          lbl.setText(`${e.hp}`);
          lbl.setScale(1.6);
          this.tweens.add({ targets: lbl, scale: 1, duration: 300, ease: 'Back.Out' });
        } else if (this.throttle('wrong', 60)) {
          this.tweens.add({ targets: img, angle: { from: -10, to: 0 }, duration: 200, ease: 'Back.Out' });
          this.sfx.hitWrong();
        }
        break;
      }
      case 'group':
        this.playBandClear(e.band, e.colour);
        break;
      case 'beam':
        this.sfx.whoosh(0.5);
        break;
      case 'unlock':
        this.playUnlock(e.cell);
        break;
      case 'bump': {
        const img = this.bumperImgs[e.bumper];
        this.tweens.killTweensOf(img);
        img.setScale(1.3);
        this.tweens.add({ targets: img, scale: 1, duration: 280, ease: 'Elastic.Out' });
        if (this.throttle('bump', 50)) this.sfx.bumper();
        break;
      }
      case 'sling':
        if (this.throttle('sling', 80)) this.sfx.sling();
        break;
      case 'status':
        this.time.delayedCall(e.status === 'won' ? 1300 : 700, () => this.showEnd(e.status === 'won'));
        if (e.status === 'won') {
          this.sfx.win();
          buzz([40, 60, 40, 60, 120]);
        } else {
          this.sfx.lose();
          buzz([120, 80, 200]);
          this.shake(4);
        }
        break;
      default:
        break;
    }
  }

  private playMove(from: number, to: number, count: number): void {
    const src = this.stackVis[from];
    const moving = src.splice(src.length - count, count).reverse(); // top tile flies first
    const dst = this.stackVis[to];
    const p0 = cellPos(from);
    const p1 = cellPos(to);
    this.placeMoves++;
    if (this.placeMoves >= 2) {
      const n = this.placeMoves;
      this.floatText(p1.x, p1.y - dst.length * STEP - 70, `Combo x${n}`, '#ffd76a', 24 + Math.min(n, 6) * 3);
      this.sfx.combo(n);
      if (n >= 3) this.shake(n - 2);
    }
    const flight = T_MOVE_BASE * TICK_MS;
    moving.forEach((img, k) => {
      const idx = dst.length;
      dst.push(img);
      const tx = p1.x;
      const ty = this.tileY(to, idx);
      const sx = img.x;
      const sy = img.y;
      const lift = 54 + Math.abs(p1.y - p0.y) * 0.3;
      img.setDepth(500 + k);
      const prog = { t: 0 };
      this.tweens.add({
        targets: prog,
        t: 1,
        delay: k * T_MOVE_PER * TICK_MS,
        duration: flight,
        ease: 'Linear',
        onUpdate: () => {
          const t = prog.t;
          img.x = sx + (tx - sx) * t;
          img.y = sy + (ty - sy) * t - lift * 4 * t * (1 - t); // gravity arc
          img.scaleY = 1 - 0.85 * Math.sin(Math.PI * t); // flip over
        },
        onComplete: () => {
          img.setDepth(this.tileDepth(to, idx));
          img.scaleY = 1;
          this.squash(img, 0.1);
          this.sfx.tileLand(Math.min(this.comboStep++, 16));
          if (k === moving.length - 1) {
            buzz(6);
            this.burst(-1, tx, ty, 3);
          }
        },
      });
    });
  }

  private playCompress(cell: number, colour: number, count: number): void {
    const vis = this.stackVis[cell];
    const tiles = vis.splice(vis.length - count, count);
    const p = cellPos(cell);
    const topY = tiles.length ? tiles[tiles.length - 1].y : p.y;
    const lump = { x: p.x, y: topY - 46 };
    this.lumpAt.set(cell, lump);
    const dur = POP * TICK_MS;
    tiles.forEach((img, k) => {
      img.setDepth(590 + k * 0.01);
      // a quick wave up the stack, then everything is sucked into one lump
      this.tweens.add({
        targets: img,
        y: img.y - 10,
        duration: dur * 0.3,
        delay: k * ((dur * 0.25) / count),
        ease: 'Quad.Out',
        onStart: () => {
          if (k % 2 === 0) this.sfx.compress(k / 2);
        },
      });
      this.tweens.add({
        targets: img,
        x: lump.x,
        y: lump.y,
        scaleX: 0.25,
        scaleY: 0.25,
        delay: dur * 0.55,
        duration: dur * 0.45,
        ease: 'Back.In',
        onStart: () => img.setTintFill(COLOURS[colour].light),
        onComplete: () => img.destroy(),
      });
    });
    if (count > CLEAR_AT) this.floatText(p.x, topY - 90, `${count} tiles`, '#ffffff', 22);
  }

  private playBandClear(band: number, colour: number): void {
    const ts = this.model.table.targets.filter((t) => t.band === band);
    for (const t of ts) {
      const img = this.targetImgs[t.id];
      this.burst(colour, TX + t.x, TY + t.y, 22, true);
      this.tweens.killTweensOf(img);
      img.setTintFill(0xffffff).setScale(1.8);
      this.tweens.add({
        targets: img,
        scale: 1,
        duration: 420,
        ease: 'Back.Out',
        onStart: () => {
          img.setTexture('peg');
          img.clearTint();
        },
      });
    }
    const rb = this.ribbons[band];
    rb.setFillStyle(0xffffff, 0.8);
    this.tweens.add({
      targets: rb,
      fillAlpha: 0.03,
      duration: 700,
      onComplete: () => rb.setFillStyle(COLOURS[colour].hex, 0.03).setStrokeStyle(1, 0x2a3350, 0.4),
    });
    this.bandLabels[band].setText('✓').setColor('#7dffb3');
    const ring = this.add.image(TX + LANE_X / 2, TY + BAND_Y[band], 'ring').setTint(COLOURS[colour].hex).setDepth(790).setScale(0.5);
    this.tweens.add({ targets: ring, scaleX: 9, scaleY: 2.2, alpha: 0, duration: 520, onComplete: () => ring.destroy() });
    this.floatText(W / 2, TY + BAND_Y[band] - 6, 'BAND CLEAR!', '#ffffff', 40);
    this.sfx.groupClear();
    this.hitstop(90);
    this.shake(5);
    buzz([30, 40, 60]);
  }

  private playUnlock(cell: number): void {
    const img = this.cellImgs[cell];
    const p = cellPos(cell);
    img.setTexture('cell').setScale(0.4).setTintFill(0xffffff);
    this.tweens.add({ targets: img, scale: 1, duration: 600, ease: 'Elastic.Out', easeParams: [1, 0.45], onComplete: () => img.clearTint() });
    this.time.delayedCall(90, () => img.clearTint());
    this.burst(-1, p.x, p.y, 24, true);
    this.burst(3, p.x, p.y, 12);
    const ring = this.add.image(p.x, p.y, 'ring').setTint(0x9cf0c2).setDepth(790).setScale(0.3);
    this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
    this.floatText(p.x, p.y - 40, '+1 cell', '#7dffb3', 26);
    this.sfx.beamLand();
    this.shake(2);
    buzz(25);
  }

  // ---------------------------------------------------------------- end screens
  private showEnd(won: boolean): void {
    if (this.overlay) return;
    const last = this.levelIndex >= LEVELS.length - 1;
    const st = this.model.stats;
    const c = this.add.container(0, 0).setDepth(1000);
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05070d, 0.72).setInteractive();
    const panel = this.add.graphics();
    panel.fillStyle(0x182042, 1);
    panel.fillRoundedRect(W / 2 - 280, 400, 560, 420, 30);
    panel.lineStyle(4, won ? 0x7dffb3 : 0xff7a85, 1);
    panel.strokeRoundedRect(W / 2 - 280, 400, 560, 420, 30);
    const title = this.add
      .text(W / 2, 470, won ? (last ? 'ALL CLEAR!' : 'LEVEL CLEAR') : 'BOARD FULL', {
        fontFamily: FONT,
        fontSize: '54px',
        fontStyle: 'bold',
        color: won ? '#7dffb3' : '#ff7a85',
      })
      .setOrigin(0.5);
    const body = won
      ? `${st.placements} placements   ${st.balls} balls\n${st.wasted} ball${st.wasted === 1 ? '' : 's'} with no target`
      : 'No free cell left, and nothing on\nthe table could open one.';
    const sub = this.add
      .text(W / 2, 580, body, { fontFamily: FONT, fontSize: '24px', color: '#c8d2f0', align: 'center', lineSpacing: 8 })
      .setOrigin(0.5);
    const label = won ? (last ? 'PLAY AGAIN' : 'NEXT LEVEL') : 'RETRY';
    const btn = this.add.container(W / 2, 730);
    const bg = this.add.graphics();
    bg.fillStyle(won ? 0x34d17c : 0xff5a5f, 1);
    bg.fillRoundedRect(-160, -42, 320, 84, 24);
    const bt = this.add.text(0, 0, label, { fontFamily: FONT, fontSize: '32px', fontStyle: 'bold', color: '#0b0f1c' }).setOrigin(0.5);
    btn.add([bg, bt]);
    btn.setSize(320, 84).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => {
      this.sfx.ui();
      const next = won ? (last ? 0 : this.levelIndex + 1) : this.levelIndex;
      this.scene.restart({ level: next });
    });
    c.add([dim, panel, title, sub, btn]);
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 250 });
    btn.setScale(0.5);
    this.tweens.add({ targets: btn, scale: 1, duration: 600, delay: 200, ease: 'Elastic.Out' });
    this.tweens.add({ targets: btn, scale: 1.05, duration: 600, delay: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.overlay = c;
  }

  // ---------------------------------------------------------------- loop
  update(time: number, delta: number): void {
    if (!this.manual) {
      if (time < this.hitstopUntil) {
        this.tweens.timeScale = 0.02;
      } else {
        this.tweens.timeScale = 1;
        this.acc += Math.min(delta, 100);
        while (this.acc >= TICK_MS) {
          this.model.step(1);
          this.acc -= TICK_MS;
          this.processEvents();
          if (this.time.now < this.hitstopUntil) {
            this.acc = 0;
            break;
          }
        }
      }
    }
    if (this.pending && this.model.canPlace()) {
      const { slot, cell } = this.pending;
      if (!this.placeNow(slot, cell)) {
        this.pending = null;
        this.returnToSlot(slot);
      }
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= delta;
      if (this.hintTimer <= 0) this.tweens.add({ targets: this.hud.msg, alpha: 0, duration: 400 });
    }
    this.render(Math.min(1, this.acc / TICK_MS));
  }

  private render(alpha: number): void {
    const m = this.model;
    this.sfx.progress = m.progress();
    // balls on the table
    const live = new Set<number>();
    for (const b of m.table.balls) {
      live.add(b.id);
      let img = this.ballImgs.get(b.id);
      if (!img) {
        img = this.add.image(0, 0, `ball${b.colour}`).setDepth(20);
        this.ballImgs.set(b.id, img);
      }
      img.x = TX + b.px + (b.x - b.px) * alpha;
      img.y = TY + b.py + (b.y - b.py) * alpha;
      const sp = Math.hypot(b.vx, b.vy);
      const st = 1 + Math.min(sp / 2400, 0.35);
      img.setScale(st, 1 / st);
      img.rotation = Math.atan2(b.vy, b.vx);
    }
    for (const [id, img] of this.ballImgs) {
      if (!live.has(id)) {
        img.destroy();
        this.ballImgs.delete(id);
        this.trails.delete(id);
      }
    }
    // short fading trail in the ball's colour
    this.trailG.clear();
    for (const b of m.table.balls) {
      const img = this.ballImgs.get(b.id)!;
      let tr = this.trails.get(b.id);
      if (!tr) this.trails.set(b.id, (tr = []));
      tr.push({ x: img.x, y: img.y });
      if (tr.length > 9) tr.shift();
      const col = COLOURS[b.colour].hex;
      for (let k = 0; k < tr.length - 1; k++) {
        const f = (k + 1) / tr.length;
        this.trailG.fillStyle(col, 0.35 * f);
        this.trailG.fillCircle(tr[k].x, tr[k].y, BALL_R * (0.35 + 0.6 * f));
      }
    }
    // transits: morph -> roll -> pipe -> plunger
    const tick = m.tick;
    const liveT = new Set<number>();
    let pull = 0;
    for (const tr of m.transits) {
      liveT.add(tr.id);
      const v = this.transitViews.get(tr.id);
      if (!v) continue;
      const el = tick - tr.start + alpha;
      if (el < 0) continue;
      pull = Math.max(pull, this.renderTransit(tr, v, el));
    }
    for (const [id, v] of this.transitViews) {
      if (!liveT.has(id)) {
        v.img.destroy();
        v.glow.destroy();
        this.transitViews.delete(id);
      }
    }
    // plunger
    const pg = this.plungerG;
    pg.clear();
    const py = TY + TH - 2 + pull * 10 - this.plungerKick.v * 18;
    pg.fillStyle(0xc8d2f0, 1);
    pg.fillRoundedRect(TX + LANE_X + 8, py - 6, TW - LANE_X - 16, 8, 3);
    // beams
    this.fx.clear();
    for (const bm of m.beams) {
      const p = Math.min(1, (tick - bm.start + alpha) / T_BEAM);
      const sx = TX + LANE_X / 2;
      const sy = TY + BAND_Y[bm.band];
      const end = bm.cell >= 0 ? cellPos(bm.cell) : { x: BX, y: BY };
      const e = p * p;
      const hx = sx + (end.x - sx) * e;
      const hy = sy + (end.y - sy) * e;
      const col = COLOURS[bm.colour].hex;
      this.fx.lineStyle(26, col, 0.25);
      this.fx.lineBetween(sx, sy, hx, hy);
      this.fx.lineStyle(10, col, 0.7);
      this.fx.lineBetween(sx, sy, hx, hy);
      this.fx.lineStyle(4, 0xffffff, 1);
      this.fx.lineBetween(sx, sy, hx, hy);
      this.fx.fillStyle(0xffffff, 1);
      this.fx.fillCircle(hx, hy, 10 + Math.sin(tick * 0.6) * 3);
      if (Math.floor(tick) % 3 === 0) this.burst(bm.colour, hx, hy, 1);
    }
    // HUD
    const prog = m.progress();
    this.shownProgress += (prog - this.shownProgress) * 0.12;
    const bar = this.hud.bar;
    bar.clear();
    bar.fillStyle(0x0a0e1a, 1);
    bar.fillRoundedRect(210, 26, 270, 20, 10);
    bar.fillStyle(0xffd76a, 1);
    if (this.shownProgress > 0.01) bar.fillRoundedRect(212, 28, 266 * this.shownProgress, 16, 8);
    this.hud.hpText.setText(`${m.table.hpLeft()} target HP left`);
    const free = m.free().length;
    if (free !== this.lastFree) {
      this.hud.free.setText(`${free}`);
      this.hud.freeIcon.setTint(free <= 2 ? 0xff5a5f : free <= 5 ? 0xffc53d : 0x34d17c);
      if (this.lastFree >= 0) {
        this.hud.freeIcon.setScale(2);
        this.tweens.add({ targets: this.hud.freeIcon, scale: 1.5, duration: 300, ease: 'Back.Out' });
      }
      this.lastFree = free;
    }
    const needed = m.neededColours();
    for (const ch of this.hud.chips) {
      const dead = !needed.has(ch.getData('colour') as number);
      ch.setAlpha(dead ? 0.35 : 1);
      (ch.list[1] as Phaser.GameObjects.Text).setVisible(dead);
    }
    if (m.waitingOnTable()) {
      this.hud.msg.setText('Board full! Waiting on the table...').setAlpha(0.6 + 0.4 * Math.sin(this.time.now / 160));
      this.hintTimer = 0;
    } else if (this.hintTimer <= 0 && this.hud.msg.text.startsWith('Board full')) {
      this.hud.msg.setAlpha(0);
    }
  }

  /** Returns plunger pull 0..1 while this ball sits on the plunger. */
  private renderTransit(tr: Transit, v: TransitView, el: number): number {
    const { img, glow } = v;
    const inlet = { x: PIPE_X, y: PIPE_IN_Y - 18 };
    const lane = { x: PIPE_X, y: LANE_BALL_Y };
    const rollEnd = T_MORPH + T_ROLL;
    const pipeEnd = tr.launchAt - tr.start - T_PLUNGE;
    if (el < POP) return 0;
    if (!v.popped) {
      v.popped = true;
      img.setVisible(true).setPosition(v.from.x, v.from.y).setScale(0);
      glow.setVisible(true).setPosition(v.from.x, v.from.y).setScale(0.5);
      this.tweens.add({ targets: img, scale: 1.6, duration: 380, ease: 'Elastic.Out', easeParams: [1.2, 0.4] });
      const ring = this.add.image(v.from.x, v.from.y, 'ring').setTint(COLOURS[tr.colour].hex).setDepth(790).setScale(0.2);
      this.tweens.add({ targets: ring, scale: 1.8, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
      this.burst(tr.colour, v.from.x, v.from.y, 26, true);
      this.burst(-1, v.from.x, v.from.y, 10);
      this.sfx.morphPop();
      this.hitstop(90);
      this.shake(2 + Math.floor(tr.count / 10));
      buzz(30);
      return 0;
    }
    let x: number;
    let y: number;
    let sx = 1.6;
    let sy = 1.6;
    if (el < T_MORPH) {
      x = v.from.x;
      y = v.from.y + Math.sin(el * 0.5) * 2;
      return this.holdAt(img, glow, x, y);
    } else if (el < rollEnd) {
      if (!v.rolled) {
        v.rolled = true;
        this.tweens.killTweensOf(img);
      }
      const t = (el - T_MORPH) / T_ROLL;
      const cx = (v.from.x + inlet.x) / 2;
      const cy = Math.min(v.from.y, inlet.y) - 130;
      const u = 1 - t;
      x = u * u * v.from.x + 2 * u * t * cx + t * t * inlet.x;
      y = u * u * v.from.y + 2 * u * t * cy + t * t * inlet.y;
      const s = 1.6 - 0.6 * t;
      sx = s * (1 - 0.15 * Math.sin(Math.PI * t));
      sy = s * (1 + 0.2 * Math.sin(Math.PI * t));
      img.rotation = 0;
    } else if (el < pipeEnd) {
      if (!v.piped) {
        v.piped = true;
        this.sfx.whoosh(Math.max(0.3, ((pipeEnd - rollEnd) * TICK_MS) / 1000));
        this.burst(tr.colour, inlet.x, inlet.y, 8);
        buzz(10);
      }
      const t = easeInOut((el - rollEnd) / Math.max(1, pipeEnd - rollEnd));
      x = inlet.x;
      y = inlet.y + (lane.y - inlet.y) * t;
      const st = 1 + 0.45 * Math.sin(Math.PI * t);
      sx = 1 / st;
      sy = st;
      if (Math.floor(el) % 2 === 0) this.burst(tr.colour, x, y + 12, 1);
    } else {
      if (!v.pulled) {
        v.pulled = true;
        this.sfx.plungePull();
      }
      const t = Math.min(1, (el - pipeEnd) / T_PLUNGE);
      x = lane.x;
      y = lane.y + t * 8;
      sx = 1 + 0.25 * t;
      sy = 1 - 0.25 * t;
      img.setPosition(x, y).setScale(sx, sy);
      glow.setPosition(x, y).setScale(0.8);
      return t;
    }
    img.setPosition(x, y).setScale(sx, sy);
    glow.setPosition(x, y).setScale(0.9 + 0.1 * Math.sin(el * 0.4));
    return 0;
  }

  private holdAt(img: Phaser.GameObjects.Image, glow: Phaser.GameObjects.Image, x: number, y: number): number {
    img.setPosition(x, y);
    glow.setPosition(x, y).setScale(1.1 + 0.15 * Math.sin(this.time.now / 60));
    return 0;
  }
}
