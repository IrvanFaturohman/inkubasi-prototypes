import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { InputManager } from '../input/InputManager';
import { SaveManager } from '../persistence/SaveManager';
import { ArtFactory } from '../render/ArtFactory';
import { BlockFieldView } from '../render/BlockFieldView';
import { CameraRig } from '../render/CameraRig';
import { DepotView } from '../render/DepotView';
import { EffectsPool } from '../render/EffectsPool';
import { Markers } from '../render/Markers';
import { Stage } from '../render/Stage';
import { VehicleView } from '../render/VehicleView';
import { HUD } from '../ui/HUD';
import { Panels, showFatal } from '../ui/Panels';
import {
  AREAS,
  MAT_BONUS,
  MAT_REINFORCED,
  MAX_UPGRADE_LEVEL,
  PALETTE,
  QUALITY,
  REMAINING_MARKER_THRESHOLD,
  SIM,
  UPGRADES,
  UPGRADE_KEYS,
  type QualityProfile,
  type UpgradeKey,
} from './config';
import { GameSim, type SimEvent } from './GameSim';
import { upgradeCount, upgradePrice, type Settings } from './state';
import { clamp } from './util';
import type { DriveInput } from './VehicleSim';

/**
 * High-level states. Unloading and area-complete are sub-states of PLAYING
 * (the player keeps control); every modal pauses the simulation.
 *   BOOT → READY → PLAYING ⇄ (UPGRADE | SETTINGS) ; PLAYING → TRANSITION → PLAYING
 *   final area → COMPLETION → FREE PLAY / NEW RUN
 */
type Mode = 'boot' | 'ready' | 'playing' | 'upgrade' | 'settings' | 'transition' | 'completion' | 'notice';

interface Transition {
  t: number;
  phase: 'out' | 'in';
  action: () => void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Game {
  private readonly stageEl: HTMLElement;
  private stage!: Stage;
  private camera = new CameraRig();
  private art!: ArtFactory;
  private sim!: GameSim;
  private fieldView!: BlockFieldView;
  private vehicleView!: VehicleView;
  private depotView!: DepotView;
  private effects!: EffectsPool;
  private markers!: Markers;
  private input!: InputManager;
  private audio = new AudioManager();
  private save = new SaveManager();
  private hud!: HUD;
  private panels!: Panels;
  private fadeEl!: HTMLElement;
  private debugEl: HTMLElement | null = null;

  private settings: Settings;
  private mode: Mode = 'boot';
  private modeBeforeModal: Mode = 'playing';
  private profile: QualityProfile = QUALITY.medium;
  private acc = 0;
  private lastTime = 0;
  private hidden = false;
  private readonly driveInput: DriveInput = { x: 0, y: 0, mag: 0 };
  private transition: Transition | null = null;

  // Per-frame cosmetic aggregation (logic already happened in the sim).
  private frameBreaks = 0;
  private frameBonus = 0;
  private framePickups = 0;
  private frameReinforcedBreaks = 0;
  private contactLevel = 0;
  private breakPuffClock = 0;
  private lastRemaining = -1;
  private cargoHintTimer = 0;
  private buyCooldown: Record<UpgradeKey, number> = { roller: 0, cargo: 0, power: 0, speed: 0 };
  private completionTimer = -1;
  private fpsWindow = { time: 0, frames: 0, slowWindows: 0 };
  private saveDirtyClock = 0;
  private readonly hapticsSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  private readonly debug = new URLSearchParams(location.search).has('debug');

  constructor(root: HTMLElement) {
    this.settings = this.save.loadSettings();
    root.innerHTML = '';
    this.stageEl = document.createElement('div');
    this.stageEl.className = 'stage';
    root.appendChild(this.stageEl);
  }

  /** Build everything; returns false (after showing a message) if WebGL can't start. */
  boot(): boolean {
    const el = this.stageEl;
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    const touch = document.createElement('div');
    touch.className = 'touch-surface';
    const joy = document.createElement('div');
    joy.className = 'joy-layer';
    const hudRoot = document.createElement('div');
    const panelRoot = document.createElement('div');
    panelRoot.className = 'panels';
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'fade';
    el.append(canvas, touch, joy, hudRoot, panelRoot, this.fadeEl);

    this.profile = this.profileFor(this.settings.quality);
    try {
      this.stage = new Stage(canvas, this.profile);
    } catch (e) {
      console.warn('WebGL init failed', e);
      showFatal(el, 'Graphics unavailable', 'This browser could not start WebGL 3D graphics. Try another browser or enable hardware acceleration, then reload.');
      return false;
    }
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.hud?.banner('Graphics paused', 'Waiting for the GPU to recover…', 4000);
    });

    this.art = new ArtFactory();
    this.hud = new HUD(hudRoot);
    this.panels = new Panels(panelRoot, {
      onBuy: (k) => this.buy(k),
      onCloseUpgrade: () => this.closeUpgrade(),
      onSettingsChange: (s) => this.applySettings(s),
      onCloseSettings: () => this.closeSettings(),
      onResetProgress: () => this.resetProgress(),
      onFreePlay: () => this.startFreePlay(),
      onNewRun: () => this.newRun(),
      onUiTap: () => this.audio.play('ui'),
    });
    this.panels.hapticsSupported = this.hapticsSupported;
    this.input = new InputManager(touch, joy);
    this.input.onGesture = () => this.audio.unlock();
    this.input.onDriveStart = () => {
      if (this.mode === 'ready') this.setMode('playing');
    };
    // Any UI interaction also counts as a gesture for audio.
    el.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.audio.unlock(), { capture: true });

    // Load progress.
    const loaded = this.save.load();
    this.sim = new GameSim();
    let corrupt = loaded.status === 'corrupt';
    if (loaded.status === 'ok' && loaded.data) {
      if (!this.sim.restore(loaded.data)) {
        corrupt = true;
        this.sim = new GameSim();
      }
    }
    this.save.setCollector(() => this.sim.snapshot());

    this.effects = new EffectsPool(this.art, this.profile);
    this.markers = new Markers(this.art);
    this.vehicleView = new VehicleView(this.art);
    this.depotView = new DepotView(this.art, this.sim.depot.layout);
    this.stage.scene.add(this.effects.group, this.markers.group, this.vehicleView.root, this.depotView.group);
    this.buildAreaView();
    this.syncVehicleVisuals(false);

    this.applySettings(this.settings, true);
    this.observeResize();
    this.bindLifecycle();

    this.hud.setCoins(this.sim.progress.coins, true);
    this.setMode('ready');
    this.announceArea(true);

    if (corrupt) {
      this.openNotice('Saved game unreadable', 'Your saved progress could not be loaded. Start a clean new run?', 'START NEW RUN', () => {
        this.save.clear();
        this.save.flush();
      });
    } else if (loaded.status === 'unavailable') {
      this.hud.toast('Saving is unavailable in this browser mode', 3200);
    }
    if (this.sim.isFinalArea && this.sim.progress.runComplete && this.sim.ledger.total === 0) {
      this.completionTimer = 0.6;
    }

    if (this.debug) {
      this.debugEl = document.createElement('div');
      this.debugEl.className = 'debug';
      el.appendChild(this.debugEl);
      (window as unknown as Record<string, unknown>).__tbd = { game: this, sim: () => this.sim };
    }

    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
    return true;
  }

  // ------------------------------------------------------------------ setup helpers

  private profileFor(q: Settings['quality']): QualityProfile {
    if (q === 'low') return QUALITY.low;
    if (q === 'high') return QUALITY.high;
    return QUALITY.medium;
  }

  private observeResize(): void {
    const apply = () => {
      const r = this.stageEl.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      this.stage.resize(w, h);
      this.camera.resize(w, h);
      this.input.updateRadius();
    };
    apply();
    new ResizeObserver(apply).observe(this.stageEl);
    window.addEventListener('orientationchange', () => window.setTimeout(apply, 120));
  }

  private bindLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      if (this.hidden) {
        this.input.release();
        this.save.flush();
      } else {
        this.lastTime = performance.now();
        this.acc = 0;
      }
      this.audio.setHidden(this.hidden);
    });
    window.addEventListener('pagehide', () => this.save.flush());
  }

  private buildAreaView(): void {
    if (this.fieldView) this.fieldView.dispose();
    this.fieldView = new BlockFieldView(this.art, this.sim.field);
    this.stage.scene.add(this.fieldView.group);
    this.depotView.setBounds(this.sim.world.bounds);
    this.effects.clearAll();
    this.lastRemaining = -1;
    this.markers.setRemaining([]);
    const v = this.sim.vehicle;
    this.camera.snapTo(v.x, v.z);
    this.hud.setProgress(this.sim.field.progress);
    this.hud.setArea(this.areaLabel());
  }

  private syncVehicleVisuals(animate: boolean): void {
    const p = this.sim.progress;
    this.vehicleView.setRollerWidth(this.sim.rollerWidth, animate);
    this.vehicleView.setCargoLevel(p.upgrades.cargo, animate);
    this.vehicleView.setPowerLevel(p.upgrades.power, animate);
    this.vehicleView.setSpeedLevel(p.upgrades.speed, animate);
    this.vehicleView.setFill(this.sim.ledger.storedTotal / this.sim.ledger.capacity, false);
    this.camera.setRollerWidth(this.sim.rollerWidth);
  }

  private areaLabel(): string {
    const i = this.sim.progress.areaIndex;
    const name = this.sim.areaDef.name;
    return i < AREAS.length ? `AREA ${i + 1} · ${name}` : name.toUpperCase();
  }

  private announceArea(first: boolean): void {
    this.hud.setArea(this.areaLabel());
    const i = this.sim.progress.areaIndex;
    const kicker = i < AREAS.length ? `Area ${i + 1} · ` : '';
    const sub =
      i === 0 && !this.sim.progress.tutorial.sold
        ? 'Crush blocks, fill the bin, sell at the depot'
        : i === 1
          ? 'Stacked layers and tougher blocks'
          : i === 2
            ? 'Bonus stars and bold patterns'
            : 'A fresh yard — upgrades carried over';
    if (first || i > 0) this.hud.banner(this.sim.areaDef.name.toUpperCase(), kicker + sub, 2600, 'intro');
  }

  // ------------------------------------------------------------------ modes

  private setMode(m: Mode): void {
    this.mode = m;
    const controllable = m === 'ready' || m === 'playing';
    this.input.setEnabled(controllable);
    this.camera.setFocus(m === 'upgrade' ? 0.3 : null);
    this.stageEl.classList.toggle('modal-open', !controllable);
  }

  private get simRunning(): boolean {
    return (this.mode === 'ready' || this.mode === 'playing') && !this.hidden;
  }

  private openUpgrade(onboarding = false): void {
    if (this.mode !== 'playing' && this.mode !== 'ready') return;
    this.modeBeforeModal = this.mode;
    this.setMode('upgrade');
    const tut = this.sim.progress.tutorial;
    const firstTime = onboarding || (tut.sold && !tut.upgrade);
    this.panels.openUpgrade(this.sim.progress, firstTime ? 'roller' : null, firstTime ? 'Cut a wider path — the ROLLER upgrade clears more blocks per pass.' : '');
  }

  private closeUpgrade(): void {
    if (this.mode !== 'upgrade') return;
    this.panels.closeUpgrade();
    const tut = this.sim.progress.tutorial;
    if (tut.sold && !tut.upgrade) {
      tut.upgrade = true;
      this.save.markDirty();
    }
    this.setMode('playing');
  }

  private openSettings(): void {
    if (this.mode !== 'playing' && this.mode !== 'ready') return;
    this.modeBeforeModal = this.mode;
    this.setMode('settings');
    this.panels.openSettings(this.settings);
  }

  private closeSettings(): void {
    if (this.mode !== 'settings') return;
    this.panels.closeSettings();
    this.setMode(this.modeBeforeModal === 'ready' ? 'ready' : 'playing');
  }

  private openNotice(title: string, body: string, button: string, onClick: () => void): void {
    const prev = this.mode === 'boot' ? 'ready' : this.mode;
    this.setMode('notice');
    this.panels.notice(title, body, button, () => {
      onClick();
      this.setMode(prev === 'notice' ? 'playing' : prev);
    });
  }

  // ------------------------------------------------------------------ actions

  private buy(key: UpgradeKey): void {
    if (this.mode !== 'upgrade') return;
    const now = performance.now();
    // Guard against an accidental double tap buying two levels.
    if (now - this.buyCooldown[key] < 350) return;
    this.buyCooldown[key] = now;
    const r = this.sim.buy(key);
    if (r !== 'ok') {
      this.audio.play('deny');
      this.panels.flashCard(key, 'deny');
      this.panels.refreshUpgrade(this.sim.progress);
      return;
    }
    const p = this.sim.progress;
    const lvl = p.upgrades[key];
    const def = UPGRADES[key];
    this.syncVehicleVisuals(false);
    if (key === 'roller') this.vehicleView.setRollerWidth(this.sim.rollerWidth, true);
    if (key === 'cargo') this.vehicleView.setCargoLevel(lvl, true);
    if (key === 'power') this.vehicleView.setPowerLevel(lvl, true);
    if (key === 'speed') this.vehicleView.setSpeedLevel(lvl, true);
    this.vehicleView.root.updateMatrixWorld(true);
    const at = key === 'cargo' ? this.vehicleView.binMouthWorld(_v) : key === 'speed' ? _v.copy(this.vehicleView.root.position).setY(0.4) : this.vehicleView.drumFrontWorld(_v);
    this.effects.spawnSparkles(at.x, at.y + 0.2, at.z, 14, PALETTE.highlight);
    this.audio.play('upgrade');
    this.haptic(18);
    this.hud.setCoins(p.coins);
    this.hud.toast(`${def.label} Lv ${lvl + 1} — ${def.effect}!`);
    p.tutorial.upgrade = true;
    this.panels.clearGuidance(p);
    this.panels.flashCard(key, 'ok');
    this.save.flush();
  }

  private applySettings(s: Settings, initial = false): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = { ...s };
    this.audio.applySettings(this.settings);
    this.camera.reducedMotion = s.reducedMotion;
    this.effects.reducedMotion = s.reducedMotion;
    this.stageEl.classList.toggle('reduced-motion', s.reducedMotion);
    if (qualityChanged || initial) {
      this.profile = this.profileFor(s.quality);
      this.stage.applyProfile(this.profile);
      this.effects.setProfile(this.profile);
      this.fpsWindow.slowWindows = 0;
      // Resize to apply the new pixel ratio.
      const r = this.stageEl.getBoundingClientRect();
      this.stage.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    }
    if (!initial) this.save.saveSettings(this.settings);
  }

  private resetProgress(): void {
    this.sim.newRun(true);
    this.save.clear();
    this.afterRunChange();
    this.panels.closeAll();
    this.setMode('ready');
    this.hud.toast('Progress reset');
  }

  private newRun(): void {
    this.sim.newRun(false);
    this.save.clear();
    this.afterRunChange();
    this.setMode('playing');
  }

  private startFreePlay(): void {
    this.sim.startFreePlay();
    this.afterRunChange();
    this.setMode('playing');
  }

  private afterRunChange(): void {
    this.buildAreaView();
    this.syncVehicleVisuals(false);
    this.hud.setCoins(this.sim.progress.coins, true);
    this.announceArea(true);
    this.save.flush();
  }

  private startGateTransition(): void {
    this.setMode('transition');
    this.audio.play('gate');
    this.fadeEl.classList.add('on');
    this.transition = {
      t: 0,
      phase: 'out',
      action: () => {
        this.sim.advanceArea();
        this.buildAreaView();
        this.syncVehicleVisuals(false);
        this.save.flush();
      },
    };
  }

  private haptic(ms: number | number[]): void {
    if (!this.settings.haptics || !this.hapticsSupported) return;
    try {
      navigator.vibrate(ms);
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ frame loop

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const raw = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (this.hidden) return;
    const dt = Math.min(raw, 0.1);

    if (this.simRunning) {
      this.acc += Math.min(raw, 0.25);
      let steps = 0;
      while (this.acc >= SIM.step && steps < SIM.maxStepsPerFrame) {
        this.input.read(this.driveInput);
        this.sim.update(SIM.step, this.driveInput);
        this.consumeEvents();
        this.acc -= SIM.step;
        steps++;
      }
      // Drop time we couldn't simulate rather than teleporting.
      if (steps === SIM.maxStepsPerFrame) this.acc = 0;
    }
    const alpha = this.simRunning ? this.acc / SIM.step : 1;

    this.updateTransition(dt);
    this.updateVisuals(dt, alpha);
    this.updateHud(dt);
    this.audio.update(dt, {
      speed: this.sim.vehicle.actualSpeed,
      maxSpeed: this.sim.maxSpeed,
      throttle: this.simRunning ? this.sim.vehicle.throttle : 0,
      contact: this.contactLevel,
      power: this.sim.power,
      full: this.sim.ledger.isFull,
      active: this.simRunning,
    });
    this.save.tick(dt);
    this.monitorPerformance(raw);
    this.stage.render(this.camera.camera);
    if (this.debugEl) this.renderDebug(raw);
    this.sim.consumeFrame();
  };

  private consumeEvents(): void {
    const events = this.sim.events;
    for (let i = 0; i < events.length; i++) this.onSimEvent(events[i]);
    events.length = 0;
  }

  private onSimEvent(e: SimEvent): void {
    switch (e.type) {
      case 'break': {
        const b = e.e;
        this.fieldView.onBreak(b.key);
        this.frameBreaks++;
        const dense = this.frameBreaks > 4;
        const dx = b.x - this.sim.vehicle.x;
        const dz = b.z - this.sim.vehicle.z;
        const l = Math.hypot(dx, dz) || 1;
        this.effects.spawnBreak(b.x, b.y, b.z, b.color, dx / l, dz / l, dense ? 2 : 2 + Math.floor(Math.random() * 4));
        if (b.mat === MAT_BONUS) {
          this.frameBonus++;
          this.effects.spawnSparkles(b.x, b.y + 0.3, b.z, 10);
        }
        if (b.mat === MAT_REINFORCED) this.frameReinforcedBreaks++;
        this.breakPuffClock += 0.35;
        if (this.breakPuffClock >= 1) {
          this.breakPuffClock = 0;
          this.effects.spawnPuff(b.x, b.y + 0.1, b.z, 0.8);
        }
        this.saveDirtyClock += 1;
        break;
      }
      case 'land':
        this.vehicleView.pushLandedColor(e.p.color);
        this.framePickups++;
        if (!this.sim.progress.tutorial.pickup && this.cargoHintTimer <= 0) {
          this.cargoHintTimer = 3.2;
          this.hud.highlightCargo(true);
        }
        break;
      case 'nearFull':
        this.hud.pulseCargo();
        this.audio.play('nearFull');
        break;
      case 'full':
        this.hud.pulseCargo();
        this.audio.play('full');
        this.haptic(20);
        break;
      case 'unloadStart':
        this.audio.play('unloadStart');
        if (!this.sim.progress.tutorial.full) this.sim.progress.tutorial.full = true;
        break;
      case 'sold': {
        this.depotView.onSold(e.index);
        this.vehicleView.root.updateMatrixWorld(true);
        const from = this.vehicleView.binMouthWorld(_v);
        const to = this.depotView.hopperWorld;
        this.effects.spawnCascade(from, to, Math.floor(Math.random() * 4));
        const idx = Math.min(10, Math.floor((e.index / Math.max(1, e.total)) * 10));
        this.audio.play('coin', { index: idx });
        if (e.index % 3 === 0) this.audio.play('rattle');
        if (e.index % 14 === 1) {
          const s = this.worldToStage(to);
          this.hud.coinBurst(s.x, s.y, 2);
        }
        this.hud.setCoins(this.sim.progress.coins);
        break;
      }
      case 'unloadStop':
        this.hud.toast('Unloading stopped — leftover cargo kept');
        this.save.flush();
        break;
      case 'unloadDone': {
        this.hud.toast(`Sold ${e.sold} blocks · +${e.coins} coins`, 2000);
        this.hud.bumpCoins();
        this.hud.setCoins(this.sim.progress.coins);
        const tut = this.sim.progress.tutorial;
        const first = !tut.sold;
        tut.sold = true;
        tut.full = true;
        this.save.flush();
        if (first && upgradePrice(this.sim.progress, 'roller') !== null) {
          window.setTimeout(() => this.openUpgrade(true), 450);
        }
        break;
      }
      case 'areaComplete': {
        this.audio.play('areaClear');
        this.haptic([30, 40, 30]);
        const v = this.sim.vehicle;
        this.effects.spawnConfetti(v.x, 1.4, v.z, 70);
        this.camera.addShake(0.55);
        this.hud.banner('AREA CLEAR!', `+${e.bonus} coins bonus`, 2400, 'clear');
        this.hud.setCoins(this.sim.progress.coins);
        this.save.flush();
        break;
      }
      case 'runComplete':
        this.completionTimer = 1.3;
        this.save.flush();
        break;
      case 'gateReached':
        this.startGateTransition();
        break;
    }
  }

  private updateTransition(dt: number): void {
    const tr = this.transition;
    if (!tr) {
      if (this.completionTimer > 0 && (this.mode === 'playing' || this.mode === 'ready')) {
        this.completionTimer -= dt;
        if (this.completionTimer <= 0) this.openCompletion();
      }
      return;
    }
    tr.t += dt;
    if (tr.phase === 'out' && tr.t >= 0.4) {
      tr.action();
      tr.phase = 'in';
      tr.t = 0;
      this.fadeEl.classList.remove('on');
      this.announceArea(false);
    } else if (tr.phase === 'in' && tr.t >= 0.35) {
      this.transition = null;
      this.setMode('playing');
    }
  }

  private openCompletion(): void {
    this.completionTimer = -1;
    this.setMode('completion');
    const p = this.sim.progress;
    this.panels.openCompletion({
      layers: p.stats.layersCleared,
      earned: p.totalEarned,
      upgrades: upgradeCount(p),
      maxUpgrades: UPGRADE_KEYS.length * MAX_UPGRADE_LEVEL,
      areas: p.stats.areasCleared,
    });
    this.audio.play('areaClear');
  }

  private updateVisuals(dt: number, alpha: number): void {
    const sim = this.sim;
    const v = sim.vehicle;
    const ledger = sim.ledger;

    // Crusher contact level (smoothed) drives drum, vibration, audio texture.
    const contactTarget = sim.frameContacts > 0 ? clamp(0.45 + sim.frameContacts * 0.08, 0, 1) : 0;
    this.contactLevel += (contactTarget - this.contactLevel) * Math.min(1, dt * (contactTarget > this.contactLevel ? 18 : 6));
    if (this.simRunning) this.fieldView.setTouched(sim.crusher.touched);
    if (sim.frameFirstHits > 0) this.audio.play(sim.frameReinforcedHit ? 'reinforced' : 'contact');

    // Coalesced audio/feedback for this frame's logical events.
    if (this.frameBreaks > 0) {
      this.audio.play('break', { count: this.frameBreaks, pitch: 1 + Math.min(0.2, this.frameBreaks * 0.02) });
      this.camera.addShake(this.frameReinforcedBreaks > 0 ? 0.28 : 0.14);
    }
    if (this.frameBonus > 0) this.audio.play('bonus');
    if (this.framePickups > 0) this.audio.play('pickup', { count: this.framePickups, pitch: 0.9 + ledger.ratio * 0.35 });
    this.frameBreaks = this.frameBonus = this.framePickups = this.frameReinforcedBreaks = 0;

    this.fieldView.update(dt, this.settings.reducedMotion);
    this.vehicleView.update(dt, v, alpha, {
      contact: this.contactLevel > 0.2,
      powered: sim.powered,
      full: ledger.isFull,
      unloading: sim.depot.unloading,
      powerLevel: sim.progress.upgrades.power,
      speedLevel: sim.progress.upgrades.speed,
      reducedMotion: this.settings.reducedMotion,
    });
    this.vehicleView.setFill(ledger.storedTotal / ledger.capacity);
    this.vehicleView.root.updateMatrixWorld(true);
    this.effects.drawPickups(ledger.pending, (out, i) => this.vehicleView.nextSlotWorld(out, i % 3));
    this.effects.update(dt);

    const near = sim.depot.nearDepot(v.x, v.z);
    const cleared = sim.areaCleared;
    this.depotView.update(dt, {
      processing: sim.depot.unloading,
      attention: ledger.isFull || (cleared && ledger.total > 0),
      gateOpen: sim.world.bounds.gateOpen,
      nearUpgrade: near,
      reducedMotion: this.settings.reducedMotion,
    });

    // Guidance arrow + last-target markers.
    const remaining = sim.field.remainingLayers;
    if (remaining !== this.lastRemaining) {
      this.lastRemaining = remaining;
      if (remaining > 0 && remaining <= REMAINING_MARKER_THRESHOLD) {
        const pts = sim.field.listRemainingCells(REMAINING_MARKER_THRESHOLD).map((i) => this.fieldView.layerTop(sim.field.topKey(i), new THREE.Vector3()));
        this.markers.setRemaining(pts);
      } else {
        this.markers.setRemaining([]);
      }
    }
    const pad = sim.depot.layout.pad;
    const gate = sim.depot.layout.gate;
    const px = v.prevX + (v.x - v.prevX) * alpha;
    const pz = v.prevZ + (v.z - v.prevZ) * alpha;
    if (ledger.isFull || (cleared && ledger.total > 0)) {
      this.markers.setArrow(!sim.depot.unloading, px, pz, pad.x, pad.z, PALETTE.highlight);
    } else if (sim.world.bounds.gateOpen) {
      this.markers.setArrow(true, px, pz, gate.x, gate.z + 1, PALETTE.green);
    } else if (remaining > 0 && remaining <= REMAINING_MARKER_THRESHOLD) {
      const t = this.nearestRemaining(px, pz);
      this.markers.setArrow(!!t, px, pz, t?.x ?? 0, t?.z ?? 0, PALETTE.coral);
    } else {
      this.markers.setArrow(false, 0, 0, 0, 0, PALETTE.highlight);
    }
    this.markers.update(dt);

    this.camera.update(dt, px, pz, v.vx, v.vz);
    this.stage.followLight(this.camera.target);

    if (this.saveDirtyClock > 0) {
      this.save.markDirty();
      this.saveDirtyClock = 0;
    }
  }

  private nearestRemaining(x: number, z: number): { x: number; z: number } | null {
    const f = this.sim.field;
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (const i of f.listRemainingCells(REMAINING_MARKER_THRESHOLD)) {
      const cx = f.centerX(i);
      const cz = f.centerZ(i);
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bd) {
        bd = d;
        best = { x: cx, z: cz };
      }
    }
    return best;
  }

  private updateHud(dt: number): void {
    const sim = this.sim;
    const v = sim.vehicle;
    const ledger = sim.ledger;
    const tut = sim.progress.tutorial;
    this.hud.setProgress(sim.field.progress);
    this.hud.setCoins(sim.progress.coins);
    this.hud.setCargo(ledger.total, ledger.capacity, ledger.isFull, ledger.ratio >= 0.85);

    const near = sim.depot.nearDepot(v.x, v.z);
    let affordable = 0;
    for (const k of UPGRADE_KEYS) {
      const pr = upgradePrice(sim.progress, k);
      if (pr !== null && sim.progress.coins >= pr) affordable++;
    }
    const playing = this.mode === 'playing' || this.mode === 'ready';
    this.hud.setUpgradeButton(playing && near && !sim.depot.unloading, affordable);

    // Onboarding + contextual hints (highest priority first).
    if (!tut.drive && Math.abs(v.odometer) > 0.6) {
      tut.drive = true;
      this.save.markDirty();
    }
    if (this.cargoHintTimer > 0) {
      this.cargoHintTimer -= dt;
      if (this.cargoHintTimer <= 0) {
        tut.pickup = true;
        this.hud.highlightCargo(false);
        this.save.markDirty();
      }
    }
    if (!playing) {
      this.hud.hint('none');
    } else if (!tut.drive) {
      this.hud.hint('drive', 'Drag anywhere to drive');
    } else if (ledger.isFull && !sim.depot.unloading && !sim.depot.onPad(v.x, v.z)) {
      this.hud.hint('full', tut.full ? 'Bin full — drive to SELL' : 'Bin full! Drive back to the SELL pad');
    } else if (sim.depot.onPad(v.x, v.z) && !sim.depot.unloading && ledger.total > 0) {
      this.hud.hint('sell', 'Hold still to unload');
    } else if (sim.areaCleared && ledger.total > 0 && !sim.depot.unloading) {
      this.hud.hint('sell', 'Area clear! Sell the rest of your cargo');
    } else if (sim.world.bounds.gateOpen) {
      this.hud.hint('gate', 'Gate open — drive through to the next area');
    } else if (this.cargoHintTimer > 0) {
      this.hud.hint('cargo', 'Blocks fill your bin');
    } else if (sim.field.remainingLayers > 0 && sim.field.remainingLayers <= REMAINING_MARKER_THRESHOLD) {
      this.hud.hint('lastBlocks', `${sim.field.remainingLayers} left — follow the markers`);
    } else {
      this.hud.hint('none');
    }
    this.hud.update(dt);
  }

  private worldToStage(p: THREE.Vector3): { x: number; y: number } {
    _v2.copy(p).project(this.camera.camera);
    const r = this.stageEl.getBoundingClientRect();
    return { x: ((_v2.x + 1) / 2) * r.width, y: ((1 - _v2.y) / 2) * r.height };
  }

  /** Auto quality: step down once if frames stay slow; never oscillate back up. */
  private monitorPerformance(raw: number): void {
    if (this.settings.quality !== 'auto' || !this.simRunning) return;
    const w = this.fpsWindow;
    w.time += raw;
    w.frames++;
    if (w.time >= 2) {
      const fps = w.frames / w.time;
      w.time = 0;
      w.frames = 0;
      if (fps < 40 && this.profile !== QUALITY.low) {
        w.slowWindows++;
        if (w.slowWindows >= 2) {
          this.profile = QUALITY.low;
          this.stage.applyProfile(this.profile);
          this.effects.setProfile(this.profile);
          const r = this.stageEl.getBoundingClientRect();
          this.stage.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
        }
      } else {
        w.slowWindows = 0;
      }
    }
  }

  private debugClock = 0;
  private debugFrames = 0;
  private renderDebug(raw: number): void {
    this.debugClock += raw;
    this.debugFrames++;
    if (this.debugClock < 0.5) return;
    const info = this.stage.renderer.info;
    const l = this.sim.ledger;
    this.debugEl!.textContent = `${Math.round(this.debugFrames / this.debugClock)} fps · ${info.render.calls} calls · ${Math.round(info.render.triangles / 1000)}k tris · cargo ${l.storedTotal}+${l.reservedTotal}/${l.capacity} · left ${this.sim.field.remainingLayers} · ${this.mode}`;
    this.debugClock = 0;
    this.debugFrames = 0;
  }

  /** Called by the HUD settings / upgrade buttons. */
  bindHudButtons(): void {
    this.hud.settingsBtn.addEventListener('click', () => {
      this.audio.play('ui');
      this.openSettings();
    });
    this.hud.upgradeBtn.addEventListener('click', () => {
      this.audio.play('ui');
      this.openUpgrade();
    });
  }
}
