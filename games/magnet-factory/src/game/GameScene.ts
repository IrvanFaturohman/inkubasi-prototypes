import Phaser from 'phaser';
import { GameConfig as C, COLOURS } from '../config/GameConfig';
import { Sim, SimEvent, Ball, Machine, DT } from './Sim';
import { Sfx, vibrate } from './Sfx';
import { TuningPanel } from '../debug/TuningPanel';

const TEX = C.view.renderScale; // textures are drawn at 2x and shown at 0.5
const INV = 1 / TEX;
const W = C.view.width;
const H = C.view.height;
const FONT = '"Arial Black", "Arial Bold", Arial, sans-serif';
const INK = 0x161a24;
const STEEL = 0x5d6578;

interface BallView {
  img: Phaser.GameObjects.Image;
  shine: Phaser.GameObjects.Image;
  sq: number; sqv: number; axis: number; flash: number;
}

interface MachineView {
  m: Machine;
  c: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Graphics;
  lamp: Phaser.GameObjects.Arc;
  count: Phaser.GameObjects.Text;
  sq: number; sqv: number; shown: number;
}

interface Spring { x: number; v: number }
function spring(s: Spring, target: number, k: number, c: number, dt: number) {
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
}

export class GameScene extends Phaser.Scene {
  sim!: Sim;
  private sfx = new Sfx();
  private acc = 0;
  manual = false;

  private gStatic!: Phaser.GameObjects.Graphics;
  private gBelt!: Phaser.GameObjects.Graphics;
  private gFx!: Phaser.GameObjects.Graphics;
  private gTop!: Phaser.GameObjects.Graphics;
  private views = new Map<number, BallView>();
  private machineViews: MachineView[] = [];
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private white!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puck!: Phaser.GameObjects.Image;
  private puckSq: Spring = { x: 0, v: 0 };
  private queueImgs: Phaser.GameObjects.Image[] = [];
  private hopperSq: Spring = { x: 0, v: 0 };
  private needle: Spring = { x: 0, v: 0 };
  private quotaBar: Spring = { x: 0, v: 0 };
  private rejectSq: Spring = { x: 0, v: 0 };
  private shownScore = 0;
  private scoreBump: Spring = { x: 0, v: 0 };
  private roundText!: Phaser.GameObjects.Text;
  private roundName!: Phaser.GameObjects.Text;
  private quotaText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private hintStage = 0;
  private banner: Phaser.GameObjects.Container | null = null;
  private flashRect!: Phaser.GameObjects.Rectangle;
  private fullText!: Phaser.GameObjects.Text;
  private rejectLabel!: Phaser.GameObjects.Text;
  private time0 = 0;

  constructor() { super('game'); }

  create() {
    const cam = this.cameras.main;
    cam.setZoom(TEX);
    cam.centerOn(W / 2, H / 2);
    cam.setBackgroundColor('#171b26');

    this.makeTextures();
    this.gStatic = this.add.graphics().setDepth(0);
    this.gBelt = this.add.graphics().setDepth(6);
    this.gFx = this.add.graphics().setDepth(26);
    this.gTop = this.add.graphics().setDepth(45);

    this.emitters = COLOURS.map((c) => this.makeEmitter(c.hex));
    this.white = this.makeEmitter(0xffffff);

    this.puck = this.add.image(0, 0, 'puck').setScale(INV).setDepth(30);
    for (let i = 0; i < C.hopper.capacity + 2; i++) {
      this.queueImgs.push(this.add.image(0, 0, 'ball0').setScale(INV).setDepth(13).setVisible(false));
    }
    this.buildHud();
    this.flashRect = this.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 1).setAlpha(0).setDepth(65);
    this.fullText = this.txt(0, 0, 'FULL', 13, '#ff6b5f').setDepth(46).setAlpha(0);
    this.hint = this.txt(W / 2, 535, '', 15, '#d7deee').setDepth(55).setAlpha(0);
    this.hint.setWordWrapWidth(440).setAlign('center');
    this.rejectLabel = this.txt(C.reject.x, C.reject.y + 66, 'throws odd colours back on the belt', 10, '#8a93a8').setDepth(8);

    this.sim = new Sim(this.matter);
    this.sim.on((e) => this.onEvent(e));
    this.sim.startRound(0);
    const hx = this.sim.inletX;
    this.txt(hx - 28, 140, 'HOPPER', 9, '#8a93a8').setOrigin(1, 0.5).setDepth(15);
    this.txt(hx + 24, 99, 'MAX', 8, '#ff5b4f').setOrigin(0, 0.5).setDepth(15);
    this.txt(C.reject.x, C.reject.y, 'REJECT', 15, '#f2c230').setDepth(8).setStroke('#0d0f15', 4);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.sfx.unlock();
      if (this.sim.phase === 'failed' || this.sim.phase === 'won') {
        if (this.sim.phaseT > 0.7) this.sim.tap();
        return;
      }
      this.moveTarget(p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) this.moveTarget(p); });
    this.input.keyboard?.on('keydown', () => this.sfx.unlock());

    this.installHook();
    new TuningPanel({
      restart: (i) => { this.sim.score = 0; this.sim.startRound(i); },
      round: () => this.sim.roundIndex,
      stats: () => {
        const s = this.sim;
        return `${s.phase}  belt ${s.occupied()}/${s.slots.length}  hopper ${s.hopper.length}/${C.hopper.capacity}  magnet ${s.attachedCount}/${s.round.capacity}  fps ${Math.round(this.game.loop.actualFps)}`;
      },
    });
  }

  private moveTarget(p: Phaser.Input.Pointer) {
    const off = p.wasTouch ? C.magnet.touchOffsetY : 0;
    this.sim.setTarget(p.worldX, p.worldY + off);
  }

  update(_time: number, delta: number) {
    if (!this.manual) {
      this.acc += Math.min(delta, 100) / 1000;
      let n = 0;
      while (this.acc >= DT && n < 6) { this.sim.step(); this.acc -= DT; n++; }
      if (n >= 6) this.acc = 0;
    }
    this.renderFrame(Math.min(delta, 50) / 1000);
  }

  // ---------------------------------------------------------------- test hook
  private installHook() {
    const w = window as unknown as Record<string, unknown>;
    w.__mf = {
      /** run n fixed 1/60 s steps synchronously (switches to manual stepping) */
      step: (n = 1) => {
        this.manual = true;
        for (let i = 0; i < n; i++) this.sim.step();
        this.renderFrame(0);
        return this.sim.snapshot();
      },
      setTarget: (x: number, y: number) => this.sim.setTarget(x, y),
      state: () => this.sim.snapshot(),
      tap: () => this.sim.tap(),
      restart: (round = 0) => { this.sim.score = 0; this.sim.startRound(round); return this.sim.snapshot(); },
      manual: (on = true) => { this.manual = on; this.acc = 0; },
      config: C,
    };
  }

  // ---------------------------------------------------------------- textures
  private makeTextures() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const r = C.ball.radius * TEX;
    const size = Math.ceil((C.ball.radius + 3) * 2 * TEX);
    const h = size / 2;
    COLOURS.forEach((c, i) => {
      g.clear();
      g.fillStyle(INK, 1); g.fillCircle(h, h, r + 2.5 * TEX);
      g.fillStyle(c.dark, 1); g.fillCircle(h, h, r);
      g.fillStyle(c.hex, 1); g.fillCircle(h, h, r * 0.8);
      g.generateTexture('ball' + i, size, size);
    });
    g.clear(); g.fillStyle(0xffffff, 0.85); g.fillEllipse(16, 11, 22, 13); g.generateTexture('shine', 32, 22);
    g.clear(); g.fillStyle(0xffffff, 1); g.fillCircle(12, 12, 12); g.generateTexture('dot', 24, 24);

    const pr = C.magnet.radius * TEX;
    const ps = Math.ceil((C.magnet.radius + 4) * 2 * TEX);
    const ph = ps / 2;
    g.clear();
    g.fillStyle(INK, 1); g.fillCircle(ph, ph, pr + 3 * TEX);
    g.fillStyle(0xaab2c3, 1); g.fillCircle(ph, ph, pr);
    g.fillStyle(0xc8702a, 1); g.fillCircle(ph, ph, pr * 0.78);
    g.lineStyle(1.5 * TEX, 0x7f3f14, 1);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.lineBetween(ph + Math.cos(a) * pr * 0.5, ph + Math.sin(a) * pr * 0.5, ph + Math.cos(a) * pr * 0.78, ph + Math.sin(a) * pr * 0.78);
    }
    g.fillStyle(0x2a2f3d, 1); g.fillCircle(ph, ph, pr * 0.48);
    g.fillStyle(0xff5b6e, 1); g.fillCircle(ph, ph, pr * 0.2);
    g.fillStyle(0xffffff, 0.5); g.fillEllipse(ph - pr * 0.45, ph - pr * 0.5, pr * 0.5, pr * 0.28);
    g.generateTexture('puck', ps, ps);
    g.destroy();
  }

  private makeEmitter(tint: number) {
    return this.add.particles(0, 0, 'dot', {
      lifespan: { min: 280, max: 650 },
      speed: { min: 90, max: 380 },
      scale: { start: 0.42, end: 0 },
      gravityY: 900,
      emitting: false,
      tint,
    }).setDepth(40);
  }

  private txt(x: number, y: number, s: string, size: number, color: string) {
    return this.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color })
      .setOrigin(0.5).setResolution(TEX);
  }

  // ---------------------------------------------------------------- static art
  private buildHud() {
    this.roundText = this.txt(18, 24, '', 17, '#f2f4f8').setOrigin(0, 0.5).setDepth(61);
    this.roundName = this.txt(18, 50, '', 12, '#8a93a8').setOrigin(0, 0.5).setDepth(61);
    this.txt(270, 17, 'SHIFT QUOTA', 10, '#8a93a8').setDepth(61);
    this.quotaText = this.txt(270, 44, '', 15, '#ffffff').setDepth(62);
    this.txt(W - 18, 17, 'SCORE', 10, '#8a93a8').setOrigin(1, 0.5).setDepth(61);
    this.scoreText = this.txt(W - 18, 45, '0', 26, '#ffc93a').setOrigin(1, 0.5).setDepth(61);
    this.txt(this.gaugeX, this.gaugeY - 20, 'BELT LOAD', 9, '#3a4152').setDepth(15);
  }

  private get gaugeX() { return 432; }
  private get gaugeY() { return 166; }

  private tracePath(g: Phaser.GameObjects.Graphics) {
    const { cx, cy, a, r } = this.sim.path;
    g.beginPath();
    g.moveTo(cx - a, cy - r);
    g.lineTo(cx + a, cy - r);
    g.arc(cx + a, cy, r, -Math.PI / 2, Math.PI / 2, false);
    g.lineTo(cx - a, cy + r);
    g.arc(cx - a, cy, r, Math.PI / 2, Math.PI * 1.5, false);
    g.closePath();
  }

  private drawStatic() {
    const g = this.gStatic;
    g.clear();
    // floor
    g.fillStyle(0x171b26, 1); g.fillRect(-80, -80, W + 160, H + 160);
    g.lineStyle(1, 0x1f2433, 1);
    for (let x = 0; x <= W; x += 54) g.lineBetween(x, 80, x, H);
    for (let y = 80; y <= H; y += 54) g.lineBetween(0, y, W, y);
    // machine floor strip
    g.fillStyle(0x12151d, 1); g.fillRect(0, C.machine.y + 4, W, H - C.machine.y);
    for (let x = -20; x < W; x += 28) {
      g.fillStyle(0xf2c230, 0.5); g.fillTriangle(x, C.machine.y + 4, x + 14, C.machine.y + 4, x + 4, C.machine.y + 12);
    }
    // belt: shadow, rails, rubber
    const bw = C.belt.width;
    g.lineStyle(bw + 14, 0x0d0f15, 1); this.tracePath(g); g.strokePath();
    g.lineStyle(bw + 7, STEEL, 1); this.tracePath(g); g.strokePath();
    g.lineStyle(bw, 0x252a36, 1); this.tracePath(g); g.strokePath();
    // end rollers
    const { cx, cy, a } = this.sim.path;
    for (const x of [cx - a, cx + a]) {
      g.fillStyle(0x2b3142, 1); g.fillCircle(x, cy, 16);
      g.lineStyle(3, INK, 1); g.strokeCircle(x, cy, 16);
      g.fillStyle(STEEL, 1); g.fillCircle(x, cy, 5);
    }
    // reject pad
    const rx = C.reject.x, ry = C.reject.y, rs = 48;
    g.fillStyle(0x0d0f15, 1); g.fillRoundedRect(rx - rs - 4, ry - rs - 4, rs * 2 + 8, rs * 2 + 8, 10);
    const seg = 12;
    for (let i = 0; i < (rs * 2) / seg; i++) {
      g.fillStyle(i % 2 ? 0x1b1d22 : 0xf2c230, 1);
      g.fillRect(rx - rs + i * seg, ry - rs, seg, 9);
      g.fillRect(rx + rs - (i + 1) * seg, ry + rs - 9, seg, 9);
      g.fillRect(rx - rs, ry + rs - (i + 1) * seg, 9, seg);
      g.fillRect(rx + rs - 9, ry - rs + i * seg, 9, seg);
    }
    g.fillStyle(0x101218, 1); g.fillRect(rx - rs + 9, ry - rs + 9, rs * 2 - 18, rs * 2 - 18);
    g.lineStyle(2, 0x262a35, 1);
    for (let y = ry - rs + 16; y < ry + rs - 10; y += 8) g.lineBetween(rx - rs + 12, y, rx + rs - 12, y);
    // hopper chute
    const hx = this.sim.inletX;
    g.fillStyle(0x0d0f15, 1); g.fillRect(hx - 22, 86, 44, 108);
    g.fillStyle(0x232838, 1); g.fillRect(hx - 19, 88, 38, 104);
    g.fillStyle(0x11141c, 1); g.fillRect(hx - 15, 90, 30, 98);
    g.fillStyle(STEEL, 1); g.fillTriangle(hx - 22, 192, hx + 22, 192, hx, 206);
    g.lineStyle(2, 0xff5b4f, 0.9); g.lineBetween(hx - 18, 99, hx + 18, 99);
    // gauge face (a real pressure gauge)
    const gx = this.gaugeX, gy = this.gaugeY, gr = 54;
    const P = Math.PI;
    g.fillStyle(0x0d0f15, 1); g.slice(gx, gy, gr + 6, P, 2 * P, false); g.fillPath();
    g.fillStyle(STEEL, 1); g.slice(gx, gy, gr + 3, P, 2 * P, false); g.fillPath();
    g.fillStyle(0xe9e4d6, 1); g.slice(gx, gy, gr, P, 2 * P, false); g.fillPath();
    g.lineStyle(9, 0xe0473d, 1);
    g.beginPath(); g.arc(gx, gy, gr - 9, Math.PI * (1 + 0.75), Math.PI * 2, false); g.strokePath();
    g.lineStyle(9, 0xf2c230, 1);
    g.beginPath(); g.arc(gx, gy, gr - 9, Math.PI * (1 + 0.6), Math.PI * (1 + 0.75), false); g.strokePath();
    g.lineStyle(2, 0x3a4152, 1);
    for (let i = 0; i <= 10; i++) {
      const ang = Math.PI * (1 + i / 10);
      const r0 = i % 5 === 0 ? gr - 16 : gr - 11;
      g.lineBetween(gx + Math.cos(ang) * r0, gy + Math.sin(ang) * r0, gx + Math.cos(ang) * (gr - 3), gy + Math.sin(ang) * (gr - 3));
    }
    g.fillStyle(0x0d0f15, 1); g.fillRect(gx - gr - 8, gy - 1, gr * 2 + 16, 12);
    g.fillStyle(0x2b3142, 1); g.fillRect(gx - gr - 6, gy + 1, gr * 2 + 12, 8);
    // HUD plate
    g.fillStyle(0x2b3142, 1); g.fillRect(0, 0, W, 76);
    g.fillStyle(0x0d0f15, 1); g.fillRect(0, 76, W, 4);
    g.fillStyle(0x3a4256, 1);
    for (const [x, y] of [[8, 8], [W - 8, 8], [8, 68], [W - 8, 68]]) g.fillCircle(x, y, 3);
    g.fillStyle(0x0d0f15, 1); g.fillRoundedRect(160, 32, 220, 24, 6);
  }

  private buildMachines() {
    for (const mv of this.machineViews) mv.c.destroy();
    this.machineViews = [];
    const h = C.machine.height;
    for (const m of this.sim.machines) {
      const col = COLOURS[m.colour];
      const w = m.width;
      const c = this.add.container(m.x, C.machine.y).setDepth(8);
      const glow = this.add.graphics();
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.35); g.fillEllipse(0, 6, w * 1.05, 14);
      g.fillStyle(INK, 1); g.fillRoundedRect(-w / 2 - 3, -h + 31, w + 6, h - 28, 13);
      g.fillStyle(0x2b3142, 1); g.fillRoundedRect(-w / 2, -h + 34, w, h - 34, 11);
      g.fillStyle(col.hex, 1); g.fillRect(-w / 2, -h + 44, w, 14);
      g.fillStyle(col.dark, 1); g.fillRoundedRect(-w / 2 + 10, -h + 70, w - 20, h - 84, 8);
      g.fillStyle(0x000000, 0.25);
      for (let y = -h + 80; y < -22; y += 10) g.fillRect(-w / 2 + 16, y, w - 32, 3);
      // funnel mouth
      g.fillStyle(INK, 1);
      g.fillPoints([
        new Phaser.Math.Vector2(-w / 2 + 2, -h - 3), new Phaser.Math.Vector2(w / 2 - 2, -h - 3),
        new Phaser.Math.Vector2(w * 0.3 + 3, -h + 37), new Phaser.Math.Vector2(-w * 0.3 - 3, -h + 37),
      ], true);
      g.fillStyle(0x4a5368, 1);
      g.fillPoints([
        new Phaser.Math.Vector2(-w / 2 + 6, -h), new Phaser.Math.Vector2(w / 2 - 6, -h),
        new Phaser.Math.Vector2(w * 0.3, -h + 34), new Phaser.Math.Vector2(-w * 0.3, -h + 34),
      ], true);
      g.fillStyle(0x07080c, 1); g.fillEllipse(0, -h + 3, w * 0.78, 14);
      const lamp = this.add.circle(w / 2 - 18, -h + 51, 5, 0xffffff, 1);
      const label = this.txt(0, -h + 51, col.name, 11, '#10131a');
      const count = this.txt(0, -h + 108, '0', 30, '#ffffff');
      count.setAlpha(0.92);
      c.add([glow, g, lamp, label, count]);
      this.machineViews.push({ m, c, glow, lamp, count, sq: 0, sqv: 0, shown: 0 });
    }
  }

  // ---------------------------------------------------------------- events -> juice
  private onEvent(e: SimEvent) {
    const sim = this.sim;
    const J = C.juice;
    switch (e.type) {
      case 'roundStart': {
        for (const v of this.views.values()) { v.img.destroy(); v.shine.destroy(); }
        this.views.clear();
        this.drawStatic();
        this.buildMachines();
        this.quotaBar.x = 0; this.quotaBar.v = 0;
        const r = sim.round;
        this.showBanner(`ROUND ${e.round + 1}`, `${r.name}, deliver ${r.quota}, ${r.colours} colours`, 0xffc93a, C.phases.introTime * 1000);
        if (e.round === 0 && this.hintStage === 0) this.setHint('Drag to move the magnet.\nHover the belt to grab balls.');
        break;
      }
      case 'roundGo':
        this.sfx.roundGo();
        break;
      case 'unseat':
        this.sfx.unseat();
        this.kick(e.ball, 0.18, Math.atan2(sim.magnet.y - e.ball.y, sim.magnet.x - e.ball.x));
        break;
      case 'attach': {
        this.kick(e.ball, J.squashAttach, Math.atan2(e.ny, e.nx) + Math.PI / 2);
        this.puckSq.v += 2.2;
        this.sfx.attach(e.count);
        vibrate(8);
        this.emitters[e.ball.colour].explode(3, e.ball.x, e.ball.y);
        if (this.hintStage === 1) this.setHint('Carry them to the machine\nwith the same colour.');
        break;
      }
      case 'full':
        this.sfx.full();
        vibrate(20);
        this.cameras.main.shake(90, 0.003, true);
        this.fullText.setAlpha(1).setScale(0.4);
        this.tweens.add({ targets: this.fullText, scale: 1, duration: 420, ease: 'Elastic.easeOut' });
        this.tweens.add({ targets: this.fullText, alpha: 0, delay: 650, duration: 300 });
        break;
      case 'suck':
        this.sfx.suck();
        this.kick(e.ball, 0.25, Math.atan2(e.machine.mouthY - e.ball.y, e.machine.mouthX - e.ball.x));
        break;
      case 'deliver': {
        const note = e.combo - 1 + Math.floor(e.progress * J.pitchProgressSteps);
        const mv = this.machineViews.find((v) => v.m === e.machine);
        if (e.purge) {
          this.sfx.purge(note);
          this.emitters[e.ball.colour].explode(5, e.machine.mouthX, e.machine.mouthY);
          this.cameras.main.shake(60, J.shakeBase, true);
          if (mv) mv.sqv += 2.5;
        } else {
          this.sfx.deliver(note, e.combo);
          this.emitters[e.ball.colour].explode(J.particles + e.combo * J.particlesPerCombo, e.machine.mouthX, e.machine.mouthY);
          this.white.explode(2 + e.combo, e.machine.mouthX, e.machine.mouthY);
          this.cameras.main.shake(J.shakeMs, J.shakeBase + J.shakePerCombo * e.combo, true);
          vibrate(10 + e.combo * 3);
          if (mv) mv.sqv += 3.5 + e.combo * 0.4;
        }
        const size = Math.min(34, 15 + e.combo * 2.2);
        this.popup(e.machine.mouthX, e.machine.mouthY - 30, `+${e.points}`, '#' + COLOURS[e.ball.colour].hex.toString(16).padStart(6, '0'), size);
        if (e.combo >= 2 && !e.purge) this.popup(e.machine.mouthX + 34, e.machine.mouthY - 58, `x${e.combo}`, '#ffffff', size * 0.8, 40);
        this.scoreBump.v += 6;
        if (this.hintStage === 2) this.setHint('');
        break;
      }
      case 'overdrive': {
        const col = COLOURS[e.machine.colour];
        const note = Math.floor((sim.delivered / sim.round.quota) * J.pitchProgressSteps) + 6;
        this.sfx.overdrive(note);
        this.cameras.main.shake(320, J.shakeOverdrive, true);
        this.flash(col.hex, 0.28, 260);
        vibrate([30, 40, 60]);
        this.emitters[e.machine.colour].explode(40, e.machine.mouthX, e.machine.mouthY);
        this.white.explode(20, e.machine.mouthX, e.machine.mouthY);
        this.showBanner('OVERDRIVE!', `${col.name} line purges the belt, score x${C.overdrive.scoreMult}`, col.hex, 1100, 470);
        break;
      }
      case 'mismatch':
        this.sfx.mismatch();
        vibrate([15, 30, 15]);
        for (const b of e.balls) { this.kick(b, 0.3, Math.random() * Math.PI); const v = this.views.get(b.id); if (v) v.flash = 1; }
        this.popup(sim.magnet.x, sim.magnet.y - 80, 'WRONG COLOUR', '#ff8a7f', 14, 30, 900);
        if (this.hintStage < 9) { this.hintStage = 9; this.setHint('Wrong colours stay stuck and eat space.\nREJECT (middle of the loop) throws them back on the belt.', true); }
        break;
      case 'reject':
        this.sfx.reject();
        this.rejectSq.v += 3;
        this.popup(e.ball.x, e.ball.y - 18, `-${C.reject.penalty}`, '#ff8a7f', 14, 30, 600);
        if (this.hintStage === 9) { this.hintStage = 10; this.setHint(''); }
        break;
      case 'returned':
        this.sfx.returned();
        this.hopperSq.v += 3;
        this.emitters[e.ball.colour].explode(6, sim.inletX, 104);
        break;
      case 'queue':
        this.hopperSq.v += 1.5;
        break;
      case 'drop':
        this.sfx.drop();
        break;
      case 'land':
        this.kick(e.ball, J.squashLand, 0);
        this.sfx.land();
        break;
      case 'warn':
        this.sfx.warn(e.level);
        if (e.level >= 2) { vibrate(15); this.hopperSq.v += 2; }
        break;
      case 'fail':
        this.sfx.fail();
        this.cameras.main.shake(520, J.shakeFail, true);
        this.flash(0xff2d2d, 0.35, 500);
        vibrate([80, 60, 160]);
        for (const c of sim.hopper) this.emitters[c].explode(10, sim.inletX, 120);
        this.white.explode(20, sim.inletX, 120);
        this.showBanner('BELT OVERFLOW', `Hopper jammed. Tap to retry round ${sim.roundIndex + 1}`, 0xff5b4f, null);
        break;
      case 'clear':
        this.sfx.clear();
        this.cameras.main.shake(250, 0.006, true);
        vibrate([20, 30, 20, 30, 40]);
        for (let i = 0; i < sim.round.colours; i++) this.emitters[i].explode(18, 80 + Math.random() * 380, 560 + Math.random() * 60);
        this.showBanner('ROUND CLEAR', `Score ${sim.score}`, 0x4fd47a, C.phases.clearTime * 1000 - 300);
        this.setHint('');
        break;
      case 'celebrate': {
        this.sfx.celebrate(e.index);
        this.emitters[e.ball.colour].explode(4, e.machine.mouthX, e.machine.mouthY);
        const mv = this.machineViews.find((v) => v.m === e.machine);
        if (mv) mv.sqv += 2;
        break;
      }
      case 'won':
        this.sfx.won();
        this.cameras.main.shake(400, 0.008, true);
        vibrate([30, 40, 30, 40, 80]);
        for (let i = 0; i < 4; i++) this.emitters[i].explode(30, W / 2, 560);
        this.showBanner('FACTORY CLEARED', `All 5 rounds, score ${sim.score}. Tap to play again`, 0xffc93a, null);
        break;
    }
  }

  private kick(b: Ball, amount: number, axis: number) {
    const v = this.views.get(b.id);
    if (!v) return;
    v.axis = axis;
    v.sqv += amount * 14;
  }

  private setHint(s: string, force = false) {
    if (!s) { this.tweens.add({ targets: this.hint, alpha: 0, duration: 300 }); if (this.hintStage < 3) this.hintStage = 3; return; }
    if (!force) this.hintStage++;
    this.hint.setText(s).setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: this.hint, alpha: 1, scale: 1, duration: 380, ease: 'Back.easeOut' });
  }

  private popup(x: number, y: number, s: string, color: string, size: number, rise = 56, life = 720) {
    const t = this.txt(x, y, s, size, color).setDepth(50).setScale(0.3);
    t.setStroke('#10131a', 4);
    this.tweens.add({ targets: t, scale: 1, duration: 280, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - rise, duration: life, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: life * 0.55, duration: life * 0.45, onComplete: () => t.destroy() });
  }

  private flash(colour: number, alpha: number, ms: number) {
    this.tweens.killTweensOf(this.flashRect);
    this.flashRect.setFillStyle(colour, 1).setAlpha(alpha);
    this.tweens.add({ targets: this.flashRect, alpha: 0, duration: ms, ease: 'Quad.easeOut' });
  }

  private showBanner(title: string, sub: string, colour: number, holdMs: number | null, y = 585) {
    if (this.banner) { this.tweens.killTweensOf(this.banner); this.banner.destroy(); }
    const c = this.add.container(W / 2, y).setDepth(70);
    const g = this.add.graphics();
    g.fillStyle(0x0d0f15, 0.9); g.fillRoundedRect(-215, -56, 430, 112, 16);
    g.lineStyle(4, colour, 1); g.strokeRoundedRect(-215, -56, 430, 112, 16);
    const t = this.txt(0, -14, title, 40, '#' + colour.toString(16).padStart(6, '0'));
    t.setStroke('#0d0f15', 6);
    const s = this.txt(0, 30, sub, 14, '#d7deee');
    s.setWordWrapWidth(400).setAlign('center');
    c.add([g, t, s]);
    c.setScale(0.25);
    this.tweens.add({ targets: c, scale: 1, duration: 750, ease: 'Elastic.easeOut', easeParams: [1.1, 0.45] });
    if (holdMs !== null) {
      this.tweens.add({ targets: c, alpha: 0, scale: 0.85, delay: holdMs, duration: 260, ease: 'Quad.easeIn', onComplete: () => { if (this.banner === c) this.banner = null; c.destroy(); } });
    }
    this.banner = c;
  }

  // ---------------------------------------------------------------- per-frame render
  private renderFrame(dt: number) {
    const sim = this.sim;
    const m = sim.magnet;
    const J = C.juice;
    this.time0 += dt;
    const now = this.time0;

    // moving belt: cleats + cups
    const g = this.gBelt;
    g.clear();
    const path = sim.path;
    const L = path.length;
    const half = C.belt.width / 2 - 4;
    g.lineStyle(2, 0x343a49, 1);
    const pt = { x: 0, y: 0, tx: 1, ty: 0 };
    for (let s = sim.beltOffset % 18; s < L; s += 18) {
      path.at(s, pt);
      g.lineBetween(pt.x - pt.ty * half, pt.y + pt.tx * half, pt.x + pt.ty * half, pt.y - pt.tx * half);
    }
    for (let i = 0; i < sim.slotPts.length; i++) {
      const p = sim.slotPts[i];
      g.fillStyle(0x1a1e28, 1); g.fillCircle(p.x, p.y, C.ball.radius + 3);
      g.lineStyle(2, sim.slots[i] ? 0x4a5368 : 0x6b758c, 1); g.strokeCircle(p.x, p.y, C.ball.radius + 3);
    }

    // balls
    const seen = new Set<number>();
    for (const b of sim.balls) {
      if (b.dead) continue;
      seen.add(b.id);
      let v = this.views.get(b.id);
      if (!v) {
        v = {
          img: this.add.image(b.x, b.y, 'ball' + b.colour).setScale(INV),
          shine: this.add.image(b.x, b.y, 'shine').setScale(INV),
          sq: 0, sqv: 0, axis: 0, flash: 0,
        };
        if (b.mode === 'drop') v.img.setScale(INV * 0.6);
        this.views.set(b.id, v);
      }
      v.sqv += (-J.squashStiffness * v.sq - J.squashDamping * v.sqv) * dt;
      v.sq += v.sqv * dt;
      let s = v.sq, axis = v.axis;
      const flying = b.mode === 'flying' || b.mode === 'return' || b.mode === 'celebrate' || b.mode === 'drop';
      if (flying) {
        const sp = Math.hypot(b.vx, b.vy);
        const st = Math.min(J.stretchMax, sp * J.stretchPerSpeed);
        if (st > Math.abs(s)) { s = -st; axis = Math.atan2(b.vy, b.vx) + Math.PI / 2; }
      }
      // s > 0 squashes along axis, s < 0 stretches
      const k = Phaser.Math.Clamp(1 - s, 0.55, 1.6);
      v.img.setPosition(b.x, b.y).setRotation(axis).setScale(INV / k, INV * k);
      if (b.mode === 'flying' || b.mode === 'celebrate') {
        // shrink into the mouth during the last part of the flight
        const f = Phaser.Math.Clamp((b.fT - b.ft) / 0.12, 0.35, 1);
        v.img.setScale((INV / k) * f, INV * k * f);
      }
      const depth = b.mode === 'seated' ? 10 : b.mode === 'drop' ? 14 : b.mode === 'free' ? 20 : b.mode === 'attached' ? 28 : 36;
      v.img.setDepth(depth);
      if (v.flash > 0) { v.flash = Math.max(0, v.flash - dt * 2.2); const c = Math.round(255 - 120 * v.flash); v.img.setTint(Phaser.Display.Color.GetColor(255, c, c)); }
      else v.img.clearTint();
      const r = C.ball.radius;
      v.shine.setPosition(b.x - r * 0.36, b.y - r * 0.42).setDepth(depth + 0.5).setScale(INV * 0.8);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { v.img.destroy(); v.shine.destroy(); this.views.delete(id); }
    }

    // puck: stretch along velocity + attach squash
    spring(this.puckSq, 0, 300, 12, dt);
    const msp = Math.hypot(m.vx, m.vy);
    const st = Math.min(0.22, msp * 0.00009);
    const pk = 1 + st - this.puckSq.x * 0.05;
    this.puck.setPosition(m.x, m.y).setRotation(Math.atan2(m.vy, m.vx)).setScale(INV * pk, INV / pk);

    // fx layer: field ring, suction cones, reject glow, gauge needle
    const f = this.gFx;
    f.clear();
    const cap = sim.round.capacity;
    const full = sim.attachedCount >= cap;
    if (sim.live && !full) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 6);
      f.fillStyle(0xff5b6e, 0.035 + pulse * 0.02); f.fillCircle(m.x, m.y, C.magnet.pullRadius);
      f.lineStyle(1.5, 0xff5b6e, 0.18); f.strokeCircle(m.x, m.y, C.magnet.pullRadius);
    }
    const carried = new Set<number>();
    for (const b of sim.balls) if (!b.dead && b.mode === 'attached') carried.add(b.colour);
    for (const mv of this.machineViews) {
      const mc = mv.m;
      if (mc.inside) {
        const w = mc.width * 0.34;
        f.fillStyle(COLOURS[mc.colour].hex, 0.13 + 0.05 * Math.sin(now * 30));
        f.fillTriangle(mc.mouthX - w, mc.mouthY, mc.mouthX + w, mc.mouthY, m.x, m.y);
      } else if (carried.has(mc.colour) && sim.live) {
        f.lineStyle(2, COLOURS[mc.colour].hex, 0.25 + 0.15 * Math.sin(now * 5));
        f.strokeCircle(mc.mouthX, mc.mouthY, C.machine.intakeRadius);
      }
    }
    // reject pad glow
    spring(this.rejectSq, 0, 260, 10, dt);
    const keep = sim.keepColour();
    let odd = 0;
    for (const b of sim.balls) if (!b.dead && b.mode === 'attached' && b.colour !== keep) odd++;
    if (sim.reject.inside || odd > 0) {
      const a = sim.reject.inside ? 0.5 : 0.18 + 0.12 * Math.sin(now * 5);
      f.lineStyle(3, 0xf2c230, a);
      const rs = 52 + this.rejectSq.x * 4;
      f.strokeRoundedRect(C.reject.x - rs, C.reject.y - rs, rs * 2, rs * 2, 12);
    }
    this.rejectLabel.setAlpha(odd > 0 ? 1 : 0.6);

    // top layer (over balls): capacity pips + gauge needle + REJECT word
    const t = this.gTop;
    t.clear();
    const py = m.y - 72 < 92 ? m.y + 72 : m.y - 72;
    const stuck = sim.balls.filter((b) => !b.dead && b.mode === 'attached').sort((a, b) => a.attachOrder - b.attachOrder);
    const pw = 11;
    const x0 = m.x - ((cap - 1) * pw) / 2;
    t.fillStyle(0x0d0f15, 0.75); t.fillRoundedRect(x0 - 9, py - 8, (cap - 1) * pw + 18, 16, 8);
    for (let i = 0; i < cap; i++) {
      if (i < stuck.length) {
        t.fillStyle(COLOURS[stuck[i].colour].hex, 1); t.fillCircle(x0 + i * pw, py, 4.2);
      } else {
        t.lineStyle(1.5, 0x5d6578, 1); t.strokeCircle(x0 + i * pw, py, 3.5);
      }
    }
    if (full) {
      t.lineStyle(2, 0xff5b4f, 0.6 + 0.4 * Math.sin(now * 14));
      t.strokeRoundedRect(x0 - 9, py - 8, (cap - 1) * pw + 18, 16, 8);
    }
    this.fullText.setPosition(m.x, py - 17);

    // gauge needle: belt cups fill the white zone, the hopper queue the red zone
    const occ = sim.occupied() / Math.max(1, sim.slots.length);
    const load = Math.min(1.04, 0.75 * occ + 0.25 * (sim.hopper.length / C.hopper.capacity));
    spring(this.needle, load, 180, 9, dt);
    const ang = Math.PI * (1 + Phaser.Math.Clamp(this.needle.x, -0.02, 1.04)) + (sim.warnLevel === 2 ? Math.sin(now * 60) * 0.03 : 0);
    const gx = this.gaugeX, gy = this.gaugeY;
    t.lineStyle(4, 0xc0281f, 1); t.lineBetween(gx, gy, gx + Math.cos(ang) * 44, gy + Math.sin(ang) * 44);
    t.fillStyle(INK, 1); t.fillCircle(gx, gy, 7);
    t.fillStyle(STEEL, 1); t.fillCircle(gx, gy, 3);

    // hopper queue balls
    spring(this.hopperSq, 0, 280, 10, dt);
    const danger = sim.warnLevel === 2;
    for (let i = 0; i < this.queueImgs.length; i++) {
      const img = this.queueImgs[i];
      if (i < sim.hopper.length) {
        const wob = danger ? Math.sin(now * 40 + i) * 1.5 : 0;
        const k = 1 + this.hopperSq.x * 0.04;
        img.setTexture('ball' + sim.hopper[i]).setVisible(true)
          .setPosition(sim.inletX + wob, 176 - i * 22).setScale(INV * k, INV / k);
      } else img.setVisible(false);
    }
    if (danger) {
      t.lineStyle(3, 0xff5b4f, 0.5 + 0.5 * Math.sin(now * 16));
      t.strokeRect(sim.inletX - 21, 87, 42, 106);
    }

    // machines: squash spring anchored at the floor, overdrive glow
    for (const mv of this.machineViews) {
      mv.sqv += (-320 * mv.sq - 11 * mv.sqv) * dt;
      mv.sq += mv.sqv * dt;
      const s = Phaser.Math.Clamp(mv.sq * 0.035, -0.25, 0.25);
      mv.c.setScale(1 + s, 1 - s);
      const mc = mv.m;
      const col = COLOURS[mc.colour];
      mv.glow.clear();
      if (mc.overdriveT > 0) {
        const p = 0.5 + 0.5 * Math.sin(now * 22);
        mv.glow.fillStyle(col.hex, 0.25 + 0.3 * p);
        mv.glow.fillRoundedRect(-mc.width / 2 - 10, -C.machine.height - 6, mc.width + 20, C.machine.height + 10, 16);
        mv.c.x = mc.x + Math.sin(now * 70) * 1.5;
        mv.lamp.setFillStyle(p > 0.5 ? 0xffffff : col.hex);
      } else {
        mv.c.x = mc.x;
        mv.lamp.setFillStyle(mc.inside ? 0xffffff : col.hex, mc.inside ? 1 : 0.7);
      }
      if (mv.shown !== mc.delivered) {
        mv.shown = mc.delivered;
        mv.count.setText(String(mc.delivered));
      }
    }

    // HUD
    spring(this.quotaBar, sim.delivered / sim.round.quota, 160, 13, dt);
    const qb = Phaser.Math.Clamp(this.quotaBar.x, 0, 1.03);
    t.fillStyle(0x4fd47a, 1); t.fillRoundedRect(163, 35, Math.max(8, 214 * Math.min(1, qb)), 18, 5);
    this.quotaText.setText(`${sim.delivered} / ${sim.round.quota}`);
    this.roundText.setText(`ROUND ${sim.roundIndex + 1}/${C.rounds.length}`);
    this.roundName.setText(sim.round.name.toUpperCase());
    if (this.shownScore !== sim.score) {
      const d = sim.score - this.shownScore;
      this.shownScore += Math.abs(d) < 2 ? d : Math.ceil(Math.abs(d) * Math.min(1, dt * 12)) * Math.sign(d);
      this.scoreText.setText(String(this.shownScore));
    }
    spring(this.scoreBump, 0, 300, 12, dt);
    this.scoreText.setScale(1 + Phaser.Math.Clamp(this.scoreBump.x * 0.03, -0.2, 0.35));
  }
}
