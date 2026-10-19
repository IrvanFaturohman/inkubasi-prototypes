import Phaser from 'phaser';
import * as C from './config';
import { buildLevel, LEVELS, type LevelData, type PartDef } from './levels';
import { makeTextures, pieceKey, shade } from './art';
import { buzz, Sfx } from './audio';

type Seg = 'main' | 'return';
type PartState = 'falling' | 'riding' | 'lift' | 'intake' | 'done' | 'spill';
type Body = Phaser.Physics.Arcade.Body;

interface Part {
  id: number;
  color: number;
  piece: number;
  state: PartState;
  seg: Seg;
  target: Seg | 'none';
  img: Phaser.Physics.Arcade.Image;
  laps: number;
  landings: number;
  pendingLand: Seg | null;
  m: Machine | null;
  slot: number;
  t: number;
  sx: number;
  sy: number;
}

interface Machine {
  idx: number;
  x: number;
  queue: number[];
  order: number;
  state: 'open' | 'locked' | 'switch' | 'done';
  slots: boolean[];
  reserved: boolean[];
  incoming: number;
  timer: number;
  root: Phaser.GameObjects.Container;
  stripe: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  lamp: Phaser.GameObjects.Arc;
  ghosts: Phaser.GameObjects.Image[];
  fills: Phaser.GameObjects.Image[];
  clamps: Phaser.GameObjects.Rectangle[];
  ticket: Phaser.GameObjects.Container;
  hatch: Phaser.GameObjects.Graphics;
}

interface Tray {
  idx: number;
  x: number;
  parts: PartDef[];
  cooldown: number;
  imgs: Phaser.GameObjects.Image[];
  bin: Phaser.GameObjects.Container;
  flap: Phaser.GameObjects.Rectangle;
  more: Phaser.GameObjects.Text;
}

interface Toy {
  color: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  t: number;
  T: number;
  spin: number;
  state: 'fly' | 'shelf';
  obj: Phaser.GameObjects.Container;
}

export interface TfsState {
  level: number;
  levels: number;
  name: string;
  status: 'playing' | 'won' | 'failed';
  reason: string;
  cap: number;
  belt: number;
  peakBelt: number;
  shipped: number;
  total: number;
  combo: number;
  ticks: number;
  time: number;
  mainRide: number;
  trays: { x: number; parts: number[]; cooldown: number }[];
  machines: { x: number; color: number; next: number; state: string; filled: number; incoming: number; ordersLeft: number }[];
  parts: { id: number; color: number; piece: number; state: string; seg: string; x: number; y: number; laps: number; landings: number }[];
  toys: { state: string; t: number; T: number }[];
  intakes: { id: number; y: number; landings: number; laps: number; machine: number }[];
}

const TXT = (size: number, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: C.FONT,
  fontSize: `${size}px`,
  color,
});

export class GameScene extends Phaser.Scene {
  sfx = new Sfx();
  manual = false;
  private acc = 0;

  levelIndex = 0;
  private lv!: LevelData;
  status: 'playing' | 'won' | 'failed' = 'playing';
  private reason = '';
  private cap = 10;

  private parts: Part[] = [];
  private trays: Tray[] = [];
  private machines: Machine[] = [];
  private toys: Toy[] = [];
  private nextId = 1;

  private simTime = 0;
  private ticks = 0;
  private hitstop = 0;
  private shipped = 0;
  private launched = 0;
  private total = 0;
  private combo = 0;
  private lastBurst = -99;
  private peakBelt = 0;
  private stuck = 0;
  private wasFull = false;
  private intakeLog: TfsState['intakes'] = [];

  private partGroup!: Phaser.Physics.Arcade.Group;
  private mainBelt!: Phaser.GameObjects.TileSprite;
  private retBelt!: Phaser.GameObjects.TileSprite;
  private lift!: Phaser.GameObjects.TileSprite;
  private gaugeFace!: Phaser.GameObjects.Graphics;
  private needle!: Phaser.GameObjects.Graphics;
  private gaugeText!: Phaser.GameObjects.Text;
  private needleV = 0;
  private hudShift!: Phaser.GameObjects.Text;
  private hudToys!: Phaser.GameObjects.Text;
  private chipFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puffFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private overlay: Phaser.GameObjects.Container | null = null;
  private hint: Phaser.GameObjects.Container | null = null;
  private flash!: Phaser.GameObjects.Rectangle;
  private restartBtn!: Phaser.GameObjects.Container;
  /** short-lived stamps/banners; destroyed on level load since killAll() skips their onComplete */
  private transient: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('game');
  }

  create() {
    makeTextures(this);
    this.drawScenery();

    // Arcade world is stepped by hand inside tick(), so it stays in lockstep
    // with the rest of the sim and with __tfs.step().
    this.physics.world.isPaused = true;
    this.partGroup = this.physics.add.group();
    const mainZone = this.add.zone((C.MAIN_X0 + C.MAIN_X1) / 2, C.MAIN_Y + 20, C.MAIN_X1 - C.MAIN_X0, 40);
    const retZone = this.add.zone((C.RET_X0 + C.RET_X1) / 2, C.RET_Y + 20, C.RET_X1 - C.RET_X0, 40);
    this.physics.add.existing(mainZone, true);
    this.physics.add.existing(retZone, true);
    const landOn = (seg: Seg) => (a: unknown, b: unknown) => {
      const p = this.partOf(a, b);
      if (p) p.pendingLand = seg;
    };
    const canLand = (seg: Seg) => (a: unknown, b: unknown) => {
      const p = this.partOf(a, b);
      return !!p && p.state === 'falling' && p.target === seg && (p.img.body as Body).velocity.y >= 0;
    };
    this.physics.add.collider(this.partGroup, mainZone, landOn('main'), canLand('main'));
    this.physics.add.collider(this.partGroup, retZone, landOn('return'), canLand('return'));

    this.chipFx = this.add.particles(0, 0, 'chip', {
      lifespan: { min: 500, max: 950 },
      speed: { min: 160, max: 520 },
      angle: { min: 200, max: 340 },
      gravityY: 1500,
      rotate: { start: 0, end: 540 },
      scale: { start: 1.1, end: 0.5 },
      alpha: { start: 1, end: 0 },
      emitting: false,
    });
    this.chipFx.setDepth(75);
    this.puffFx = this.add.particles(0, 0, 'puff', {
      lifespan: 700,
      speedY: { min: -150, max: -60 },
      speedX: { min: -60, max: 60 },
      scale: { start: 0.6, end: 1.9 },
      alpha: { start: 0.85, end: 0 },
      emitting: false,
    });
    this.puffFx.setDepth(74);

    this.flash = this.add.rectangle(C.W / 2, C.H / 2, C.W, C.H, 0xff2a2a, 0).setDepth(95);

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.sfx.unlock();
      if (over.length > 0 || this.status !== 'playing') return;
      if (ptr.y < C.TRAY_TOP - 30 || ptr.y > C.MAIN_Y + 10) return;
      let best = -1;
      let bd = 1e9;
      C.TRAY_X.forEach((x, i) => {
        const d = Math.abs(ptr.x - x);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (bd <= C.TRAY_W / 2 + 8) this.tapTray(best);
    });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      this.sfx.unlock();
      const n = Number(e.key);
      if (n >= 1 && n <= 4) this.tapTray(n - 1);
      if (e.key === 'r' || e.key === 'R') this.loadLevel(this.levelIndex);
    });

    const q = Number(new URLSearchParams(location.search).get('level'));
    this.loadLevel(q >= 1 && q <= LEVELS.length ? q - 1 : 0);
  }

  // ------------------------------------------------------------------ scenery
  private drawScenery() {
    const g = this.add.graphics().setDepth(0);
    // factory wall + floor
    g.fillStyle(0x9cc3bf, 1);
    g.fillRect(0, 0, C.W, 920);
    g.fillStyle(0x8fb7b3, 1);
    for (let x = 0; x < C.W; x += 120) g.fillRect(x, 96, 4, 824);
    g.fillStyle(0x86aca8, 1);
    g.fillRect(0, 500, C.W, 6);
    g.fillStyle(0xb8a48d, 1);
    g.fillRect(0, 920, C.W, C.H - 920);
    g.fillStyle(0xa8937c, 1);
    for (let y = 960; y < C.H; y += 48) g.fillRect(0, y, C.W, 3);

    // HUD header beam with hazard stripe
    g.fillStyle(0x45405a, 1);
    g.fillRect(0, 0, C.W, 88);
    g.fillStyle(0xf4c531, 1);
    g.fillRect(0, 86, C.W, 12);
    g.fillStyle(OUTC, 1);
    for (let x = -20; x < C.W + 20; x += 32) g.fillTriangle(x, 98, x + 14, 86, x + 26, 86);
    for (let x = -20; x < C.W + 20; x += 32) g.fillTriangle(x, 98, x + 26, 86, x + 12, 98);
    g.fillStyle(0x5d5874, 1);
    [14, 706].forEach((x) => [16, 70].forEach((y) => g.fillCircle(x, y, 4)));

    // dispatch rack
    g.fillStyle(0x4a4560, 1);
    g.fillRect(34, 944, 16, 300);
    g.fillRect(670, 944, 16, 300);
    g.lineStyle(4, OUTC, 1);
    g.strokeRect(34, 944, 16, 300);
    g.strokeRect(670, 944, 16, 300);
    g.fillStyle(0x5d5874, 1);
    g.fillRoundedRect(26, 930, 668, 24, 6);
    g.strokeRoundedRect(26, 930, 668, 24, 6);
    for (const y of C.SHELF_Y) {
      g.fillStyle(0xc08a55, 1);
      g.fillRoundedRect(30, y, 660, 14, 4);
      g.strokeRoundedRect(30, y, 660, 14, 4);
      g.fillStyle(0xa8743f, 1);
      g.fillRect(36, y + 8, 648, 3);
    }
    const plate = this.add.text(C.W / 2, 942, 'DISPATCH', TXT(14, '#f6f0e1')).setOrigin(0.5).setDepth(1);
    plate.setLetterSpacing(4);

    // main line frame + belt
    g.fillStyle(0x2f2a3d, 1);
    g.fillRoundedRect(C.MAIN_X0 - 10, C.MAIN_Y - 3, C.MAIN_X1 - C.MAIN_X0 + 20, 22, 10);
    g.fillRoundedRect(C.RET_X0 - 10, C.RET_Y - 3, C.RET_X1 - C.RET_X0 + 14, 22, 10);
    this.mainBelt = this.add.tileSprite(C.MAIN_X0, C.MAIN_Y, C.MAIN_X1 - C.MAIN_X0, 16, 'belt').setOrigin(0, 0).setDepth(30);
    this.retBelt = this.add.tileSprite(C.RET_X0, C.RET_Y, C.RET_X1 - C.RET_X0, 16, 'belt').setOrigin(0, 0).setDepth(30);
    this.retBelt.setFlipX(true);
    const fr = this.add.graphics().setDepth(31);
    fr.lineStyle(4, OUTC, 1);
    fr.strokeRoundedRect(C.MAIN_X0 - 10, C.MAIN_Y - 3, C.MAIN_X1 - C.MAIN_X0 + 20, 22, 10);
    fr.strokeRoundedRect(C.RET_X0 - 10, C.RET_Y - 3, C.RET_X1 - C.RET_X0 + 14, 22, 10);
    for (const [x, y] of [
      [C.MAIN_X0, C.MAIN_Y + 8],
      [C.MAIN_X1, C.MAIN_Y + 8],
      [C.RET_X1 - 6, C.RET_Y + 8],
    ]) {
      fr.fillStyle(0x6b6480, 1);
      fr.fillCircle(x, y, 9);
      fr.strokeCircle(x, y, 9);
      fr.fillStyle(0xd9d9e3, 1);
      fr.fillCircle(x, y, 3);
    }
    const lbl = this.add.text(C.W / 2 + 40, C.RET_Y + 32, 'RETURN LINE  ◀  ◀  ◀', TXT(13, '#2f2a3d')).setOrigin(0.5).setDepth(31);
    lbl.setLetterSpacing(3);

    // drop chute on the right end
    fr.fillStyle(0x8f98ab, 1);
    fr.fillRoundedRect(684, C.MAIN_Y - 48, 30, C.RET_Y - C.MAIN_Y + 40, 12);
    fr.strokeRoundedRect(684, C.MAIN_Y - 48, 30, C.RET_Y - C.MAIN_Y + 40, 12);

    // return lift on the left
    const lt = C.LIFT_TOP - 30;
    g.fillStyle(0x2f2a3d, 1);
    g.fillRoundedRect(C.LIFT_X - 26, lt, 52, C.RET_Y + 18 - lt, 10);
    this.lift = this.add.tileSprite(C.LIFT_X - 20, lt + 6, 40, C.RET_Y + 6 - lt, 'cleat').setOrigin(0, 0).setDepth(30);
    fr.strokeRoundedRect(C.LIFT_X - 26, lt, 52, C.RET_Y + 18 - lt, 10);

    // belt load gauge (between the lines, left of the machines)
    this.gaugeFace = this.add.graphics().setDepth(20);
    this.needle = this.add.graphics().setDepth(21);
    this.gaugeText = this.add.text(GX, GY + 82, '', TXT(24, '#2f2a3d')).setOrigin(0.5).setDepth(21);
    this.add.text(GX, GY - 84, 'BELT LOAD', TXT(13, '#2f2a3d')).setOrigin(0.5).setDepth(21).setLetterSpacing(2);

    // HUD text + restart
    this.hudShift = this.add.text(24, 44, '', TXT(30)).setOrigin(0, 0.5).setDepth(90);
    this.hudToys = this.add.text(612, 44, '', TXT(22, '#f6f0e1')).setOrigin(1, 0.5).setDepth(90);
    const rb = this.add.container(668, 44).setDepth(90);
    const rg = this.add.graphics();
    rg.fillStyle(0xf4c531, 1);
    rg.fillCircle(0, 0, 25);
    rg.lineStyle(4, OUTC, 1);
    rg.strokeCircle(0, 0, 25);
    rg.lineStyle(5, OUTC, 1);
    rg.beginPath();
    rg.arc(0, 0, 11, Phaser.Math.DegToRad(-60), Phaser.Math.DegToRad(230), false);
    rg.strokePath();
    rg.fillStyle(OUTC, 1);
    rg.fillTriangle(4, -16, 13, -5, 1, -3);
    rb.add(rg);
    rb.setSize(56, 56).setInteractive({ useHandCursor: true });
    rb.on('pointerdown', () => {
      this.sfx.unlock();
      this.sfx.gate();
      this.loadLevel(this.levelIndex);
      this.tweens.add({ targets: rb, angle: { from: 0, to: -360 }, duration: 380, ease: 'Cubic.Out' });
    });
    this.restartBtn = rb;
  }

  private drawGauge() {
    const g = this.gaugeFace;
    g.clear();
    g.fillStyle(0x5d5874, 1);
    g.fillCircle(GX, GY, GR + 10);
    g.lineStyle(4, OUTC, 1);
    g.strokeCircle(GX, GY, GR + 10);
    g.fillStyle(0xf6f0e1, 1);
    g.fillCircle(GX, GY, GR);
    const ang = (v: number) => Phaser.Math.DegToRad(150 + (240 * v) / this.cap);
    const band = (v0: number, v1: number, col: number) => {
      g.lineStyle(9, col, 1);
      g.beginPath();
      g.arc(GX, GY, GR - 9, ang(v0), ang(v1), false);
      g.strokePath();
    };
    band(0, this.cap - 2, 0x4cb85a);
    band(this.cap - 2, this.cap - 1, 0xf4c531);
    band(this.cap - 1, this.cap, 0xe5483f);
    g.lineStyle(3, OUTC, 1);
    for (let v = 0; v <= this.cap; v++) {
      const a = ang(v);
      g.lineBetween(GX + Math.cos(a) * (GR - 18), GY + Math.sin(a) * (GR - 18), GX + Math.cos(a) * (GR - 4), GY + Math.sin(a) * (GR - 4));
    }
  }

  private drawNeedle(v: number, hot: boolean) {
    const n = this.needle;
    n.clear();
    const a = Phaser.Math.DegToRad(150 + (240 * Math.min(v, this.cap + 0.3)) / this.cap);
    n.lineStyle(5, hot ? 0xe5483f : OUTC, 1);
    n.lineBetween(GX, GY, GX + Math.cos(a) * (GR - 14), GY + Math.sin(a) * (GR - 14));
    n.fillStyle(OUTC, 1);
    n.fillCircle(GX, GY, 7);
  }

  // ------------------------------------------------------------------ level
  loadLevel(i: number) {
    this.tweens.killAll();
    this.parts.forEach((p) => p.img.destroy());
    this.toys.forEach((t) => t.obj.destroy());
    this.trays.forEach((t) => {
      t.bin.destroy();
      t.flap.destroy();
      t.more.destroy();
      t.imgs.forEach((im) => im.destroy());
    });
    this.machines.forEach((m) => {
      m.root.destroy();
      m.hatch.destroy();
    });
    this.overlay?.destroy();
    this.overlay = null;
    this.hint?.destroy();
    this.hint = null;
    this.transient.forEach((o) => o.destroy());
    this.transient = [];
    this.flash.setAlpha(0);
    this.hudToys.setScale(1);
    this.restartBtn.setAngle(0);
    this.cameras.main.resetFX();

    this.levelIndex = i;
    this.lv = buildLevel(i);
    const spec = this.lv.spec;
    this.cap = spec.cap;
    this.status = 'playing';
    this.reason = '';
    this.parts = [];
    this.toys = [];
    this.simTime = 0;
    this.ticks = 0;
    this.hitstop = 0;
    this.shipped = 0;
    this.launched = 0;
    this.total = spec.toys.reduce((a, b) => a + b, 0);
    this.combo = 0;
    this.lastBurst = -99;
    this.peakBelt = 0;
    this.stuck = 0;
    this.wasFull = false;
    this.intakeLog = [];
    this.acc = 0;
    this.needleV = 0;

    this.trays = this.lv.trays.map((defs, k) => this.buildTray(k, defs));
    this.machines = this.lv.queues.map((q, k) => this.buildMachine(k, C.MACHINE_X[k], q));
    this.drawGauge();
    this.hudShift.setText(`${spec.name}/${LEVELS.length}`);
    this.updateHud();
    this.banner(spec.name, `BELT HOLDS ${spec.cap}`);
    if (i === 0) this.showHint();
  }

  private buildTray(k: number, defs: PartDef[]): Tray {
    const x = C.TRAY_X[k];
    const bin = this.add.container(x, 0).setDepth(10);
    const g = this.add.graphics();
    const h = C.TRAY_MOUTH - C.TRAY_TOP;
    g.fillStyle(0x4f6185, 1);
    g.fillRoundedRect(-C.TRAY_W / 2, C.TRAY_TOP, C.TRAY_W, h, 14);
    g.fillStyle(0x3b4a6b, 1);
    g.fillRoundedRect(-C.TRAY_W / 2 + 10, C.TRAY_TOP + 36, C.TRAY_W - 20, h - 44, 8);
    g.fillStyle(0x667aa3, 1);
    g.fillRect(-C.TRAY_W / 2 + 4, C.TRAY_TOP + 30, 8, h - 40);
    g.lineStyle(4, OUTC, 1);
    g.strokeRoundedRect(-C.TRAY_W / 2, C.TRAY_TOP, C.TRAY_W, h, 14);
    g.fillStyle(0xf6f0e1, 1);
    g.fillRoundedRect(-50, C.TRAY_TOP + 8, 70, 22, 4);
    g.lineStyle(3, OUTC, 1);
    g.strokeRoundedRect(-50, C.TRAY_TOP + 8, 70, 22, 4);
    bin.add(g);
    bin.add(this.add.text(-15, C.TRAY_TOP + 19, `BIN ${k + 1}`, TXT(13, '#2f2a3d')).setOrigin(0.5));
    const flap = this.add.rectangle(x, C.TRAY_MOUTH - 2, 100, 9, 0xf4c531).setStrokeStyle(3, OUTC).setDepth(13);
    const more = this.add.text(x + 43, C.TRAY_TOP + 19, '', TXT(14, '#f6f0e1')).setOrigin(0.5).setDepth(13);
    const t: Tray = { idx: k, x, parts: defs.map((d) => ({ ...d })), cooldown: 0, imgs: [], bin, flap, more };
    this.layoutTray(t, true);
    return t;
  }

  private layoutTray(t: Tray, instant = false) {
    const vis = Math.min(C.TRAY_VISIBLE, t.parts.length);
    while (t.imgs.length < vis) {
      const k = t.imgs.length;
      const d = t.parts[k];
      const y = C.FRONT_Y - k * C.TRAY_PITCH;
      const img = this.add.image(t.x, instant ? y : y - 36, pieceKey(d.color, d.piece)).setDepth(12);
      img.setAlpha(instant ? 1 : 0);
      t.imgs.push(img);
    }
    const hidden = t.parts.length - vis;
    t.more.setText(hidden > 0 ? `+${hidden}` : '');
  }

  private buildMachine(idx: number, x: number, queue: number[]): Machine {
    const root = this.add.container(x, C.MACHINE_TOP).setDepth(25);
    const g = this.add.graphics();
    const hw = C.MACHINE_W / 2;
    g.fillStyle(0x5d6478, 1);
    g.fillRect(-hw + 14, -16, 12, 20);
    g.fillRect(hw - 26, -16, 12, 20);
    g.fillStyle(0x8f98ab, 1);
    g.fillRoundedRect(-hw, 0, C.MACHINE_W, C.MACHINE_H, 12);
    g.fillStyle(0x7d869a, 1);
    g.fillRect(-hw + 6, C.MACHINE_H - 58, C.MACHINE_W - 12, 6);
    g.lineStyle(4, OUTC, 1);
    g.strokeRoundedRect(-hw, 0, C.MACHINE_W, C.MACHINE_H, 12);
    g.fillStyle(0x2c2836, 1);
    g.fillRoundedRect(-52, 24, 104, 146, 8);
    g.lineStyle(4, OUTC, 1);
    g.strokeRoundedRect(-52, 24, 104, 146, 8);
    g.fillStyle(0x5d6478, 1);
    for (const [rx, ry] of [
      [-60, 32],
      [60, 32],
      [-60, 164],
      [60, 164],
    ])
      g.fillCircle(rx, ry, 3.5);
    root.add(g);
    const stripe = this.add.graphics();
    root.add(stripe);
    const name = this.add.text(-8, 13, '', TXT(12, '#ffffff')).setOrigin(0.5);
    root.add(name);
    const lamp = this.add.circle(52, 13, 7, 0xffffff).setStrokeStyle(3, OUTC);
    root.add(lamp);
    const ghosts: Phaser.GameObjects.Image[] = [];
    const fills: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < 3; i++) {
      const gh = this.add.image(0, C.SLOT_Y[i], pieceKey(0, i)).setScale(C.SLOT_SCALE).setTintFill(0xffffff).setAlpha(0.14);
      ghosts.push(gh);
      root.add(gh);
    }
    for (let i = 0; i < 3; i++) {
      const f = this.add.image(0, C.SLOT_Y[i], pieceKey(0, i)).setScale(C.SLOT_SCALE).setVisible(false);
      fills.push(f);
      root.add(f);
    }
    const clamps = [-1, 1].map((s) => {
      const r = this.add.rectangle(s * 47, 97, 8, 138, 0x6b7388).setStrokeStyle(2, OUTC);
      root.add(r);
      return r;
    });
    const ticket = this.add.container(0, 202);
    root.add(ticket);
    const hatch = this.add.graphics().setDepth(32);
    const m: Machine = {
      idx,
      x,
      queue,
      order: 0,
      state: 'open',
      slots: [false, false, false],
      reserved: [false, false, false],
      incoming: 0,
      timer: 0,
      root,
      stripe,
      name,
      lamp,
      ghosts,
      fills,
      clamps,
      ticket,
      hatch,
    };
    this.paintMachine(m);
    return m;
  }

  private paintMachine(m: Machine) {
    const done = m.state === 'done';
    const c = done ? -1 : m.queue[m.order];
    const col = done ? 0x6b7388 : C.COLORS[c];
    m.stripe.clear();
    m.stripe.fillStyle(col, 1);
    m.stripe.fillRoundedRect(-62, 5, 104, 17, 5);
    m.stripe.lineStyle(3, OUTC, 1);
    m.stripe.strokeRoundedRect(-62, 5, 104, 17, 5);
    m.name.setText(done ? 'DONE' : C.TOY_NAMES[c]);
    m.lamp.setFillStyle(done ? 0x3b3b4a : shade(col, 1.25));
    m.ghosts.forEach((gh, i) => {
      gh.setVisible(!done);
      if (!done) gh.setTexture(pieceKey(c, i));
    });
    m.fills.forEach((f, i) => {
      if (!done) f.setTexture(pieceKey(c, i));
    });
    m.hatch.clear();
    m.hatch.fillStyle(0x1b1824, 1);
    m.hatch.fillRect(m.x - 20, C.MAIN_Y + 2, 40, 12);
    m.hatch.lineStyle(3, done ? 0x6b7388 : col, 1);
    m.hatch.strokeRect(m.x - 22, C.MAIN_Y + 1, 44, 14);
    m.hatch.fillStyle(0x4a4560, 1);
    for (let k = -14; k <= 14; k += 7) m.hatch.fillRect(m.x + k - 1, C.MAIN_Y + 3, 2, 10);
    // order ticket
    m.ticket.removeAll(true);
    const paper = this.add.rectangle(0, 0, 116, 40, 0xf6f0e1).setStrokeStyle(3, OUTC);
    m.ticket.add(paper);
    const next = m.queue.slice(m.order + 1, m.order + 4);
    if (done) {
      m.ticket.add(this.add.text(0, 0, 'ALL DONE', TXT(13, '#2f2a3d')).setOrigin(0.5));
    } else if (next.length === 0) {
      m.ticket.add(this.add.text(0, 0, 'LAST ORDER', TXT(13, '#2f2a3d')).setOrigin(0.5));
    } else {
      m.ticket.add(this.add.text(-50, 0, 'NEXT', TXT(12, '#2f2a3d')).setOrigin(0, 0.5));
      next.forEach((nc, k) => m.ticket.add(this.add.image(4 + k * 23, 0, pieceKey(nc, 1)).setScale(0.36)));
    }
  }

  // ------------------------------------------------------------------ input
  tapTray(i: number): boolean {
    if (this.status !== 'playing') return false;
    const t = this.trays[i];
    if (!t || t.parts.length === 0 || t.cooldown > 0) return false;
    const overflow = this.beltCount() >= this.cap;
    const def = t.parts.shift()!;
    t.imgs.shift()?.destroy();
    t.cooldown = C.TRAY_COOLDOWN;
    const p = this.spawnPart(def, t.x, C.FRONT_Y);
    this.startFall(p, 0, 80, 'main');
    this.layoutTray(t);
    // juice: gate flap + bin bounce
    this.tweens.add({ targets: t.flap, scaleX: { from: 0.15, to: 1 }, duration: 220, ease: 'Back.Out' });
    this.tweens.add({ targets: t.bin, scaleY: { from: 0.97, to: 1 }, duration: 260, ease: 'Elastic.Out', easeParams: [1.1, 0.4] });
    this.sfx.gate();
    buzz(8);
    if (this.hint && this.levelIndex === 0 && this.launched >= 1) this.dropHint();
    if (overflow) this.fail('overflow');
    return true;
  }

  // ------------------------------------------------------------------ parts
  private partOf(a: unknown, b: unknown): Part | undefined {
    for (const o of [a, b]) {
      const go = o as Phaser.GameObjects.GameObject;
      if (go && typeof go.getData === 'function') {
        const p = go.getData('part') as Part | undefined;
        if (p) return p;
      }
    }
    return undefined;
  }

  private spawnPart(def: PartDef, x: number, y: number): Part {
    const img = this.physics.add.image(x, y, pieceKey(def.color, def.piece));
    this.partGroup.add(img);
    (img.body as Body).setSize(C.PART_W - 8, C.PART_H, true);
    img.setDepth(41);
    const p: Part = {
      id: this.nextId++,
      color: def.color,
      piece: def.piece,
      state: 'falling',
      seg: 'main',
      target: 'main',
      img,
      laps: 0,
      landings: 0,
      pendingLand: null,
      m: null,
      slot: -1,
      t: 0,
      sx: 0,
      sy: 0,
    };
    img.setData('part', p);
    this.parts.push(p);
    return p;
  }

  private startFall(p: Part, vx: number, vy: number, target: Seg | 'none') {
    const body = p.img.body as Body;
    p.state = target === 'none' ? 'spill' : 'falling';
    p.target = target;
    p.pendingLand = null;
    body.enable = true;
    body.reset(p.img.x, p.img.y);
    body.setAllowGravity(true);
    body.setVelocity(vx, vy);
    p.img.setDepth(41);
  }

  /** Called on EVERY landing. Deliberately has no "already landed" guard:
   * a recirculated part lands again after the lift and must go back to
   * 'riding', or it can never be taken by a machine (soft-lock). */
  markLanded(p: Part, seg: Seg) {
    const body = p.img.body as Body;
    body.setVelocity(0, 0);
    body.setAllowGravity(false);
    body.enable = false;
    p.state = 'riding';
    p.seg = seg;
    p.landings++;
    p.img.y = seg === 'main' ? C.MAIN_RIDE : C.RET_RIDE;
    p.img.setRotation(0).setDepth(40);
    this.tweens.killTweensOf(p.img);
    this.tweens.add({
      targets: p.img,
      scaleX: { from: 1.28, to: 1 },
      scaleY: { from: 0.7, to: 1 },
      duration: 320,
      ease: 'Elastic.Out',
      easeParams: [1.2, 0.45],
    });
    if (seg === 'main') this.sfx.land(p.landings > 1);
    else this.sfx.thud();
  }

  private beltCount(): number {
    let n = 0;
    for (const p of this.parts) if (p.state === 'falling' || p.state === 'riding' || p.state === 'lift') n++;
    return n;
  }

  private used(m: Machine): number {
    return m.slots.filter(Boolean).length + m.incoming;
  }

  private tryIntake(p: Part) {
    // Gate to belt height: only a part actually riding the main line can be
    // pulled in. A distance-only check grabs parts still in the air above the
    // hatch (or riding the return line underneath).
    if (p.state !== 'riding' || p.seg !== 'main' || Math.abs(p.img.y - C.MAIN_RIDE) > 0.5) return;
    for (const m of this.machines) {
      if (m.state !== 'open' || m.queue[m.order] !== p.color) continue;
      if (Math.abs(p.img.x - m.x) > C.INTAKE_HALF) continue;
      if (this.used(m) >= 3) continue;
      let slot = !m.slots[p.piece] && !m.reserved[p.piece] ? p.piece : -1;
      if (slot < 0) slot = [0, 1, 2].find((s) => !m.slots[s] && !m.reserved[s]) ?? 0;
      m.reserved[slot] = true;
      m.incoming++;
      p.state = 'intake';
      p.m = m;
      p.slot = slot;
      p.t = 0;
      p.sx = p.img.x;
      p.sy = p.img.y;
      this.tweens.killTweensOf(p.img);
      p.img.setScale(1).setDepth(27);
      this.intakeLog.push({ id: p.id, y: p.img.y, landings: p.landings, laps: p.laps, machine: m.idx });
      this.sfx.suck();
      buzz(6);
      return;
    }
  }

  private arrive(p: Part) {
    const m = p.m!;
    p.state = 'done';
    p.img.destroy();
    m.incoming--;
    m.reserved[p.slot] = false;
    m.slots[p.slot] = true;
    const f = m.fills[p.slot];
    f.setVisible(true).setY(C.SLOT_Y[p.slot]);
    this.tweens.add({
      targets: f,
      scale: { from: C.SLOT_SCALE * 1.3, to: C.SLOT_SCALE },
      duration: 300,
      ease: 'Elastic.Out',
      easeParams: [1.1, 0.5],
    });
    this.tweens.add({ targets: m.root, scaleX: { from: 1.04, to: 1 }, scaleY: { from: 0.96, to: 1 }, duration: 200, ease: 'Back.Out' });
    const filled = m.slots.filter(Boolean).length;
    this.sfx.slot(this.root(), filled);
    this.chips(m.x, C.MACHINE_TOP + C.SLOT_Y[p.slot], p.color, 5);
    buzz(12);
    if (filled === 3) this.lock(m);
  }

  private root(): number {
    return Math.floor((this.shipped / Math.max(1, this.total)) * 5);
  }

  // ------------------------------------------------------------------ machines
  private lock(m: Machine) {
    m.state = 'locked';
    m.timer = C.LOCK_T;
    this.sfx.press();
    this.cameras.main.shake(90, 0.0022);
    m.clamps.forEach((c, i) => this.tweens.add({ targets: c, x: (i === 0 ? -1 : 1) * 38, duration: 160, ease: 'Back.Out' }));
    this.puffs(m.x, C.MACHINE_TOP + 8, 3);
  }

  private updateMachine(m: Machine) {
    if (m.state === 'locked') {
      m.timer -= C.TICK;
      const k = 1 - m.timer / C.LOCK_T;
      const sq = Math.min(1, k / 0.3);
      const back = 1 + 2.70158 * Math.pow(sq - 1, 3) + 1.70158 * Math.pow(sq - 1, 2);
      const pitch = 46 + (C.ASSEMBLED_PITCH - 46) * back;
      m.fills[0].y = C.SLOT_Y[1] + pitch;
      m.fills[2].y = C.SLOT_Y[1] - pitch;
      m.root.x = m.x + Math.sin(this.simTime * 95) * (k < 0.85 ? 2.6 : 0.8);
      m.lamp.setAlpha(Math.sin(this.simTime * 30) > 0 ? 1 : 0.35);
      if (this.ticks % 14 === 0) this.puffs(m.x + (this.ticks % 28 === 0 ? -40 : 40), C.MACHINE_TOP + 4, 1);
      if (m.timer <= 0) this.burst(m);
    } else if (m.state === 'switch') {
      m.timer -= C.TICK;
      if (m.timer <= 0) {
        m.state = 'open';
        this.paintMachine(m);
        m.ghosts.forEach((gh) => this.tweens.add({ targets: gh, scale: { from: 0.2, to: C.SLOT_SCALE }, duration: 380, ease: 'Elastic.Out', easeParams: [1.1, 0.5] }));
        this.tweens.add({ targets: m.stripe, scaleX: { from: 0.2, to: 1 }, duration: 320, ease: 'Back.Out' });
        this.sfx.flip();
      }
    }
  }

  private burst(m: Machine) {
    const c = m.queue[m.order];
    m.root.x = m.x;
    m.lamp.setAlpha(1);
    m.fills.forEach((f, i) => f.setVisible(false).setY(C.SLOT_Y[i]));
    m.slots = [false, false, false];
    m.clamps.forEach((cl, i) => this.tweens.add({ targets: cl, x: (i === 0 ? -1 : 1) * 47, duration: 200 }));
    m.ghosts.forEach((gh) => gh.setVisible(false));

    // finished toy bursts out of the window in a gravity arc to the rack
    const x0 = m.x;
    const y0 = C.MACHINE_TOP + C.SLOT_Y[1];
    const k = this.launched++;
    const tx = C.SHELF_X0 + (k % C.SHELF_COLS) * C.SHELF_DX;
    const ty = C.SHELF_Y[Math.min(1, Math.floor(k / C.SHELF_COLS))] - 64 * C.SHELF_SCALE;
    const T = C.TOY_FLIGHT;
    const obj = this.makeToy(c, x0, y0, C.SLOT_SCALE);
    this.toys.push({
      color: c,
      x0,
      y0,
      vx: (tx - x0) / T,
      vy: (ty - y0 - 0.5 * C.GRAVITY * T * T) / T,
      tx,
      ty,
      t: 0,
      T,
      spin: tx < x0 ? -1 : 1,
      state: 'fly',
      obj,
    });

    m.order++;
    if (m.order >= m.queue.length) {
      m.state = 'done';
      this.paintMachine(m);
    } else {
      m.state = 'switch';
      m.timer = C.SWITCH_T;
    }

    this.combo = this.simTime - this.lastBurst <= C.COMBO_WINDOW ? this.combo + 1 : 1;
    this.lastBurst = this.simTime;
    const cb = Math.min(this.combo, 6);
    this.hitstop = C.HITSTOP_TICKS;
    this.cameras.main.shake(150 + 25 * cb, 0.004 + 0.0018 * cb);
    this.chips(x0, y0, c, 16 + 6 * cb);
    this.puffs(m.x, C.MACHINE_TOP + 6, 4);
    this.tweens.add({ targets: m.root, scaleX: { from: 1.1, to: 1 }, scaleY: { from: 0.9, to: 1 }, duration: 420, ease: 'Elastic.Out', easeParams: [1.2, 0.4] });
    this.sfx.burst(this.root(), this.combo);
    buzz([25, 30, 45]);
    if (this.combo >= 2) this.stamp(`RUSH x${this.combo}`, m.x, C.MACHINE_TOP - 70, 0xe5483f, 22);
  }

  private makeToy(c: number, x: number, y: number, s: number): Phaser.GameObjects.Container {
    const obj = this.add.container(x, y).setDepth(70);
    obj.add(this.add.image(0, 40, pieceKey(c, 0)));
    obj.add(this.add.image(0, 0, pieceKey(c, 1)));
    obj.add(this.add.image(0, -40, pieceKey(c, 2)));
    obj.setScale(s);
    return obj;
  }

  private updateToys() {
    for (const t of this.toys) {
      if (t.state !== 'fly') continue;
      t.t += C.TICK;
      const k = Math.min(t.t, t.T);
      const u = k / t.T;
      t.obj.x = t.x0 + t.vx * k;
      t.obj.y = t.y0 + t.vy * k + 0.5 * C.GRAVITY * k * k;
      t.obj.rotation = t.spin * Math.PI * 2 * (1 - (1 - u) * (1 - u));
      t.obj.setScale(C.SLOT_SCALE + (C.SHELF_SCALE - C.SLOT_SCALE) * u);
      if (t.t >= t.T) {
        // land on the rack: plain position snap, no tween chain involved
        t.state = 'shelf';
        t.obj.setPosition(t.tx, t.ty).setRotation(0).setDepth(60);
        const S = C.SHELF_SCALE;
        this.tweens.add({
          targets: t.obj,
          scaleX: { from: S * 1.35, to: S },
          scaleY: { from: S * 0.68, to: S },
          duration: 480,
          ease: 'Elastic.Out',
          easeParams: [1.3, 0.4],
        });
        this.shipped++;
        this.updateHud();
        this.sfx.shelf();
        this.cameras.main.shake(70, 0.0018);
        this.chips(t.tx, t.ty + 40, t.color, 6);
        buzz(15);
        if (this.hint && this.levelIndex === 0) this.dropHint();
        if (this.shipped >= this.total && this.status === 'playing') this.win();
      }
    }
  }

  // ------------------------------------------------------------------ sim
  tick() {
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    this.ticks++;
    this.simTime += C.TICK;

    const w = this.physics.world;
    w.isPaused = false;
    w.update(this.simTime * 1000, C.TICK_MS);
    w.postUpdate();
    w.isPaused = true;

    for (const p of this.parts) {
      if (p.pendingLand) {
        const seg = p.pendingLand;
        p.pendingLand = null;
        if (p.state === 'falling') this.markLanded(p, seg);
      }
    }

    const playing = this.status === 'playing';
    if (playing) {
      this.mainBelt.tilePositionX -= C.MAIN_SPEED * C.TICK;
      this.retBelt.tilePositionX -= C.RET_SPEED * C.TICK;
      this.lift.tilePositionY += C.LIFT_SPEED * C.TICK;
      for (const t of this.trays) t.cooldown = Math.max(0, t.cooldown - C.TICK);
      for (const p of this.parts) this.updatePart(p);
      for (const m of this.machines) this.updateMachine(m);
    }
    this.updateToys();

    for (const p of this.parts) {
      if ((p.state === 'spill' || p.state === 'falling') && p.img.y > C.H + 80) {
        p.state = 'done';
        p.img.destroy();
      }
    }
    if (this.parts.some((p) => p.state === 'done')) this.parts = this.parts.filter((p) => p.state !== 'done');

    if (this.status === 'playing') this.checkCapacity();
  }

  private updatePart(p: Part) {
    if (p.state === 'riding') {
      if (p.seg === 'main') {
        p.img.x += C.MAIN_SPEED * C.TICK;
        this.tryIntake(p);
        if (p.state === 'riding' && p.img.x >= C.MAIN_X1) this.startFall(p, 30, 0, 'return');
      } else {
        p.img.x -= C.RET_SPEED * C.TICK;
        if (p.img.x <= C.LIFT_ENTER_X) {
          p.state = 'lift';
          p.img.x = C.LIFT_X;
          p.laps++;
        }
      }
    } else if (p.state === 'lift') {
      p.img.y -= C.LIFT_SPEED * C.TICK;
      if (p.img.y <= C.LIFT_TOP) {
        p.img.y = C.LIFT_TOP;
        this.startFall(p, 170, -90, 'main');
      }
    } else if (p.state === 'intake') {
      const m = p.m!;
      p.t = Math.min(1, p.t + C.TICK / C.INTAKE_T);
      const e = p.t * p.t;
      p.img.x = p.sx + (m.x - p.sx) * p.t;
      p.img.y = p.sy + (C.MACHINE_TOP + C.SLOT_Y[p.slot] - p.sy) * e;
      const s = 1 + (C.SLOT_SCALE - 1) * p.t;
      const w = Math.sin(p.t * Math.PI);
      p.img.setScale(s * (1 - 0.32 * w), s * (1 + 0.28 * w));
      if (p.t >= 1) this.arrive(p);
    }
  }

  private checkCapacity() {
    const n = this.beltCount();
    this.peakBelt = Math.max(this.peakBelt, n);
    const full = n >= this.cap;
    if (full && !this.wasFull) {
      this.sfx.alarm();
      buzz([20, 40, 20]);
    }
    this.wasFull = full;
    if (!full) {
      this.stuck = 0;
      return;
    }
    // Belt is full. If nothing on it can ever be taken and no machine is
    // mid-cycle, the only possible move is another drop, which overflows.
    const pending = this.machines.some((m) => m.state === 'locked' || m.state === 'switch') || this.parts.some((p) => p.state === 'intake');
    const canEat = this.parts.some(
      (p) =>
        (p.state === 'falling' || p.state === 'riding' || p.state === 'lift') &&
        this.machines.some((m) => m.state === 'open' && m.queue[m.order] === p.color && this.used(m) < 3),
    );
    if (pending || canEat) {
      this.stuck = 0;
      return;
    }
    this.stuck += C.TICK;
    if (this.stuck >= 0.5) this.fail('jam');
  }

  update(_time: number, delta: number) {
    if (!this.manual) {
      this.acc += Math.min(delta, 100);
      while (this.acc >= C.TICK_MS) {
        this.acc -= C.TICK_MS;
        this.tick();
      }
    }
    // cosmetic only, per rendered frame
    const dt = Math.min(delta, 50) / 1000;
    const k = Math.min(1, dt * 16);
    for (const t of this.trays) {
      t.imgs.forEach((img, i) => {
        const ty = C.FRONT_Y - i * C.TRAY_PITCH;
        img.y += (ty - img.y) * k;
        img.alpha = Math.min(1, img.alpha + dt * 5);
      });
      t.flap.setFillStyle(t.cooldown > 0 ? 0xb39a3a : 0xf4c531);
    }
    const n = this.beltCount();
    this.needleV += (n - this.needleV) * Math.min(1, dt * 10);
    const hot = n >= this.cap - 1 && Math.floor(this.time.now / 180) % 2 === 0;
    this.drawNeedle(this.needleV, hot);
    this.gaugeText.setText(`${n}/${this.cap}`);
    this.gaugeText.setColor(n >= this.cap ? '#e5483f' : n >= this.cap - 1 ? '#b8860b' : '#2f2a3d');
  }

  // ------------------------------------------------------------------ outcome
  private fail(reason: 'overflow' | 'jam') {
    if (this.status !== 'playing') return;
    this.status = 'failed';
    this.reason = reason;
    this.sfx.jam();
    buzz([80, 60, 160]);
    this.cameras.main.shake(420, 0.016);
    this.tweens.add({ targets: this.flash, alpha: { from: 0.32, to: 0 }, duration: 260, repeat: 2 });
    for (const p of this.parts) {
      if (p.state === 'riding' || p.state === 'lift' || p.state === 'falling') {
        this.startFall(p, (Math.random() - 0.5) * 420, -320 - Math.random() * 380, 'none');
        p.img.setAngularVelocity((Math.random() - 0.5) * 600);
      }
    }
    this.time.delayedCall(850, () => this.showOverlay());
  }

  private win() {
    this.status = 'won';
    this.sfx.win();
    buzz([30, 40, 30, 40, 90]);
    this.toys.forEach((t, i) =>
      this.tweens.add({ targets: t.obj, y: t.ty - 22, duration: 160, delay: i * 55, yoyo: true, ease: 'Quad.Out' }),
    );
    this.chips(C.W / 2, 980, 2, 40);
    this.time.delayedCall(1000, () => this.showOverlay());
  }

  private showOverlay() {
    if (this.overlay || this.status === 'playing') return;
    const won = this.status === 'won';
    const last = this.levelIndex >= LEVELS.length - 1;
    const o = this.add.container(C.W / 2, C.H / 2).setDepth(100);
    const shade_ = this.add.rectangle(0, 0, C.W, C.H, 0x1b1824, 0.55).setInteractive();
    o.add(shade_);
    const slip = this.add.container(0, 0);
    o.add(slip);
    const paper = this.add.rectangle(0, 0, 540, 430, 0xf6f0e1).setStrokeStyle(5, OUTC);
    slip.add(paper);
    slip.add(this.add.rectangle(0, -170, 540, 56, won ? 0x4cb85a : 0xe5483f).setStrokeStyle(5, OUTC));
    slip.add(this.add.text(0, -170, won ? 'DISPATCH SLIP' : 'LINE REPORT', TXT(22)).setOrigin(0.5).setLetterSpacing(3));
    const title = won ? (last ? 'ALL SHIFTS DONE' : `${this.lv.spec.name} COMPLETE`) : 'LINE JAMMED';
    const stampT = this.add.text(0, -78, title, TXT(34, won ? '#2f8a3c' : '#c8322a')).setOrigin(0.5).setAngle(-4);
    slip.add(stampT);
    const lines = won
      ? [`${this.shipped} toys dispatched`, `Peak belt load ${this.peakBelt}/${this.cap}`]
      : this.reason === 'overflow'
        ? ['A part dropped onto a full belt.', `The belt holds ${this.cap}. Wait for a machine`, 'to take something first.']
        : ['The belt is full and no machine', 'can use anything on it.', 'Dump fewer parts ahead of time.'];
    lines.forEach((l, i) => slip.add(this.add.text(0, 0 + i * 34, l, TXT(21, '#2f2a3d')).setOrigin(0.5)));
    const label = won ? (last ? 'PLAY AGAIN' : 'NEXT SHIFT') : 'RETRY SHIFT';
    const btn = this.add.container(0, 150);
    btn.add(this.add.rectangle(0, 0, 300, 76, 0xf4c531).setStrokeStyle(5, OUTC));
    btn.add(this.add.text(0, 0, label, TXT(28, '#2f2a3d')).setOrigin(0.5));
    btn.setSize(300, 76).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => {
      this.sfx.unlock();
      this.sfx.gate();
      const nextIdx = won ? (last ? 0 : this.levelIndex + 1) : this.levelIndex;
      this.loadLevel(nextIdx);
    });
    slip.add(btn);
    slip.setScale(0.6).setAngle(won ? 6 : -6);
    this.tweens.add({ targets: slip, scale: 1, angle: 0, duration: 520, ease: 'Elastic.Out', easeParams: [1.1, 0.55] });
    this.tweens.add({ targets: stampT, scale: { from: 2.4, to: 1 }, alpha: { from: 0, to: 1 }, duration: 260, delay: 260, ease: 'Quad.In' });
    this.overlay = o;
  }

  // ------------------------------------------------------------------ juice helpers
  private chips(x: number, y: number, color: number, n: number) {
    this.chipFx.setParticleTint(C.COLORS[color]);
    this.chipFx.explode(n, x, y);
  }

  private puffs(x: number, y: number, n: number) {
    this.puffFx.explode(n, x, y);
  }

  /** Paper work-ticket stamp. Uses nested tweens.add (not tweens.chain). */
  private stamp(text: string, x: number, y: number, color: number, size: number) {
    const c = this.add.container(x, y).setDepth(88);
    const t = this.add.text(0, 0, text, TXT(size, '#' + color.toString(16).padStart(6, '0'))).setOrigin(0.5);
    const bg = this.add.rectangle(0, 0, t.width + 26, t.height + 12, 0xf6f0e1).setStrokeStyle(4, color);
    c.add([bg, t]);
    this.transient.push(c);
    c.setAngle(-7).setScale(2);
    this.tweens.add({
      targets: c,
      scale: 1,
      duration: 200,
      ease: 'Back.Out',
      onComplete: () => {
        this.tweens.add({
          targets: c,
          alpha: 0,
          y: y - 30,
          delay: 520,
          duration: 300,
          onComplete: () => c.destroy(),
        });
      },
    });
  }

  private banner(title: string, sub: string) {
    const c = this.add.container(C.W / 2, 760).setDepth(89);
    const bg = this.add.rectangle(0, 0, 360, 110, 0xf6f0e1).setStrokeStyle(5, OUTC);
    const t = this.add.text(0, -18, title, TXT(36, '#2f2a3d')).setOrigin(0.5);
    const s = this.add.text(0, 28, sub, TXT(20, '#c8322a')).setOrigin(0.5);
    c.add([bg, t, s]);
    this.transient.push(c);
    c.setScale(0.4).setAngle(-5).setAlpha(0);
    this.tweens.add({
      targets: c,
      scale: 1,
      alpha: 1,
      angle: -2,
      duration: 380,
      ease: 'Back.Out',
      onComplete: () => {
        this.tweens.add({ targets: c, alpha: 0, scale: 0.8, delay: 900, duration: 260, onComplete: () => c.destroy() });
      },
    });
  }

  private showHint() {
    const c = this.add.container(C.W / 2, 1100).setDepth(87);
    const bg = this.add.rectangle(0, 0, 560, 150, 0xf6f0e1).setStrokeStyle(4, OUTC);
    const t = this.add
      .text(0, 0, 'Tap a bin to drop its bottom part.\nMachines grab parts of their colour.\n3 parts make 1 toy. Watch the belt load!', TXT(20, '#2f2a3d'))
      .setOrigin(0.5)
      .setAlign('center')
      .setLineSpacing(6);
    c.add([bg, t]);
    c.setAngle(1.5);
    this.hint = c;
  }

  private dropHint() {
    const h = this.hint;
    if (!h) return;
    this.hint = null;
    this.transient.push(h);
    this.tweens.add({ targets: h, y: h.y + 260, angle: 12, alpha: 0, duration: 500, ease: 'Quad.In', onComplete: () => h.destroy() });
  }

  private updateHud() {
    this.hudToys.setText(`TOYS ${this.shipped}/${this.total}`);
    if (this.shipped > 0) this.tweens.add({ targets: this.hudToys, scale: { from: 1.25, to: 1 }, duration: 260, ease: 'Back.Out' });
  }

  // ------------------------------------------------------------------ harness
  snapshot(): TfsState {
    return {
      level: this.levelIndex,
      levels: LEVELS.length,
      name: this.lv.spec.name,
      status: this.status,
      reason: this.reason,
      cap: this.cap,
      belt: this.beltCount(),
      peakBelt: this.peakBelt,
      shipped: this.shipped,
      total: this.total,
      combo: this.combo,
      ticks: this.ticks,
      time: +this.simTime.toFixed(3),
      mainRide: C.MAIN_RIDE,
      trays: this.trays.map((t) => ({ x: t.x, parts: t.parts.map((p) => p.color), cooldown: t.cooldown })),
      machines: this.machines.map((m) => ({
        x: m.x,
        color: m.state === 'done' ? -1 : m.queue[m.order],
        next: m.queue[m.order + 1] ?? -1,
        state: m.state,
        filled: m.slots.filter(Boolean).length,
        incoming: m.incoming,
        ordersLeft: m.queue.length - m.order,
      })),
      parts: this.parts.map((p) => ({
        id: p.id,
        color: p.color,
        piece: p.piece,
        state: p.state,
        seg: p.seg,
        x: +p.img.x.toFixed(1),
        y: +p.img.y.toFixed(1),
        laps: p.laps,
        landings: p.landings,
      })),
      toys: this.toys.map((t) => ({ state: t.state, t: t.t, T: t.T })),
      intakes: this.intakeLog.slice(),
    };
  }
}

const OUTC = C.OUT;
const GX = 140;
const GY = 716;
const GR = 54;
