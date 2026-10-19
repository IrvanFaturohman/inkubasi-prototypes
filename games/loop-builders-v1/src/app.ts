import { Sfx } from './audio/sfx';
import { BALANCE } from './config/balance';
import {
  addVehicle,
  buildStation,
  expandTrack,
  mergeAuto,
  mergeVehicles,
  nextProject,
  upgradeStation,
  type ActionResult,
} from './game/actions';
import { isSlotUnlocked, levelDef, projectOf, trackOf } from './game/economy';
import type { GameEvent } from './game/events';
import { clearSave, loadGame, loadSettings, saveGame, saveSettings, type Settings } from './game/save';
import { boostHold, boostTap, step } from './game/sim';
import { createNewGame, createRuntime } from './game/state';
import type { GameState, Runtime } from './game/types';
import { World } from './render/world';
import { Hud } from './ui/hud';
import { currentTutorial, updateTutorialFlags } from './ui/tutorial';

/**
 * Kontroler utama: menghubungkan simulasi (state murni) ↔ render Three.js ↔ HUD DOM ↔ audio.
 * Loop: dt dibatasi → sub-step simulasi → event → efek/audio/HUD → render.
 */
export class App {
  private state: GameState;
  private rt: Runtime = createRuntime();
  private readonly world: World;
  private readonly hud: Hud;
  private readonly sfx = new Sfx();
  private settings: Settings;
  private selectedSlot = 0;
  private selectedVehicle: number | null = null;
  private readonly events: GameEvent[] = [];
  private last = 0;
  private resetClock = true;
  private autosaveTimer = 0;
  private saveDebounce = -1;
  private completeTimer = -1;
  private transitioning = false;
  private readonly boostPointers = new Set<number>();
  private readonly canvas: HTMLCanvasElement;
  private readonly appEl: HTMLElement;
  private storage: Storage;
  private margins = { top: 0, bottom: 0, right: 0 };

  constructor() {
    this.canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.appEl = document.getElementById('app')!;
    this.storage = safeStorage();
    this.settings = loadSettings(this.storage);
    const loaded = loadGame(this.storage);
    this.state = loaded.state ?? createNewGame();

    this.world = new World(this.canvas, document.getElementById('labels')!, {
      onBuildClick: (slot) => {
        this.selectSlot(slot, false);
        this.stationAction(slot);
      },
      onModulePop: (i) => this.sfx.modulePop(i),
      onItemLand: (kind, big) => this.sfx.land(kind, big),
    });
    this.hud = new Hud({
      add: () => this.doAdd(),
      merge: () => this.doMerge(),
      expand: () => this.doExpand(),
      stationAction: (slot) => this.stationAction(slot),
      selectSlot: (slot) => this.selectSlot(slot, false),
      toggleSound: () => this.setSound(this.settings.muted),
      openSettings: () => {
        this.releaseBoost();
        this.hud.showSettings(true);
      },
      closeSettings: () => this.hud.showSettings(false),
      setSound: (on) => this.setSound(on),
      reset: () => this.resetProgress(),
      next: () => this.next(),
    });

    this.sfx.setMuted(this.settings.muted);
    this.world.loadLevel(this.state);
    this.applyAmbience();
    this.bindInput();
    this.bindLifecycle();
    this.onResize();
    new ResizeObserver(() => this.onResize()).observe(this.appEl);

    if (loaded.corrupted) this.hud.toast('Save rusak — memulai permainan baru', 2.5);
    if (this.state.completed) this.hud.showComplete(this.state);
    else this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  private frame(t: number): void {
    requestAnimationFrame((tt) => this.frame(tt));
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (this.resetClock || !Number.isFinite(dt)) {
      dt = 0;
      this.resetClock = false;
    }
    // dt dibatasi: tab yang ditinggal tidak membuat kendaraan "melompat" melewati stasiun.
    dt = Math.max(0, Math.min(BALANCE.maxFrameDt, dt));

    if (!document.hidden && !this.transitioning && !this.hud.settingsOpen) {
      let remain = dt;
      while (remain > 1e-6) {
        const h = Math.min(BALANCE.maxStepDt, remain);
        step(this.state, this.rt, h, this.events);
        remain -= h;
      }
    }
    this.processEvents();
    if (updateTutorialFlags(this.state, this.rt)) this.requestSave(0.5);

    const ctx = { selectedSlot: this.selectedSlot, selectedVehicle: this.selectedVehicle, muted: this.settings.muted };
    this.world.selectedSlot = this.selectedSlot;
    this.world.selectedVehicle = this.selectedVehicle;
    this.world.update(dt, this.state, this.rt);
    this.hud.update(this.state, this.rt, ctx, dt);
    this.updateTutorial();
    this.sfx.setEngine(this.rt.boost.mult, !this.state.completed && this.rt.freeze <= 0 && !document.hidden);
    this.sfx.tick(dt);
    this.world.render();

    if (this.completeTimer > 0) {
      this.completeTimer -= dt;
      if (this.completeTimer <= 0) this.hud.showComplete(this.state);
    }
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= BALANCE.autosaveSeconds) this.saveNow();
    if (this.saveDebounce > 0) {
      this.saveDebounce -= dt;
      if (this.saveDebounce <= 0) this.saveNow();
    }
  }

  private processEvents(): void {
    if (!this.events.length) return;
    this.world.handleEvents(this.events, this.state);
    const mat = levelDef(this.state).material;
    for (const e of this.events) {
      switch (e.type) {
        case 'produced':
          this.sfx.produce(mat);
          break;
        case 'stored':
          this.sfx.stored();
          break;
        case 'pickup':
          this.sfx.pickup(e.amount);
          break;
        case 'unload':
          this.sfx.unload(e.amount, mat);
          this.hud.moneyGain(e.money);
          this.requestSave(1.5);
          break;
        case 'stageComplete':
          this.sfx.stageComplete();
          this.hud.moneyGain(e.bonus);
          this.requestSave(0.2);
          break;
        case 'projectComplete':
          this.sfx.projectComplete();
          this.hud.moneyGain(e.bonus + e.leftover);
          this.selectedVehicle = null;
          this.releaseBoost();
          this.completeTimer = 1.9;
          this.saveNow();
          break;
        case 'add':
          this.sfx.purchase();
          this.hud.bought('add');
          break;
        case 'merge':
          this.sfx.merge(e.level);
          this.hud.bought('merge');
          if (e.overflowMoney > 0) this.hud.moneyGain(e.overflowMoney);
          break;
        case 'expand':
          this.sfx.expand();
          this.hud.bought('expand');
          this.selectSlot(levelDef(this.state).slots.findIndex((s) => s.unlockStage === e.to), false);
          break;
        case 'build':
          this.sfx.build();
          this.hud.bought('station');
          break;
        case 'upgrade':
          this.sfx.upgrade();
          this.sfx.purchase();
          this.hud.bought('station');
          break;
        default:
          break;
      }
    }
    this.events.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Aksi pemain
  // ---------------------------------------------------------------------------

  private act(r: ActionResult): boolean {
    if (!r.ok) {
      this.sfx.deny();
      this.hud.toast(r.reason);
      return false;
    }
    this.processEvents();
    this.saveNow();
    return true;
  }

  private doAdd(): void {
    this.act(addVehicle(this.state, this.events));
  }

  private doMerge(): void {
    if (this.selectedVehicle !== null) {
      const sel = this.state.vehicles.find((v) => v.id === this.selectedVehicle);
      if (sel) {
        const L = trackOf(this.state).length;
        const partner = this.state.vehicles
          .filter((v) => v.id !== sel.id && v.level === sel.level)
          .sort((a, b) => ((sel.distance - a.distance + L) % L) - ((sel.distance - b.distance + L) % L))[0];
        if (partner) {
          if (this.act(mergeVehicles(this.state, sel.id, partner.id, this.events))) this.selectedVehicle = null;
          return;
        }
      }
      this.selectedVehicle = null;
    }
    this.act(mergeAuto(this.state, this.events));
  }

  private doExpand(): void {
    // Satu animasi expand sekaligus: tunggu morph lintasan sebelumnya selesai.
    if (this.rt.freeze > 0) return;
    this.act(expandTrack(this.state, this.rt, this.events));
  }

  private stationAction(slot: number): void {
    const st = this.state.stations[slot];
    if (!st) return;
    if (!isSlotUnlocked(this.state, slot)) this.doExpand();
    else if (!st.built) this.act(buildStation(this.state, slot, this.events));
    else this.act(upgradeStation(this.state, slot, this.events));
  }

  private selectSlot(slot: number, fromWorld: boolean): void {
    if (slot < 0 || slot >= this.state.stations.length) return;
    this.selectedSlot = slot;
    this.sfx.click();
    if (fromWorld) this.hud.flashStationBar();
  }

  private onVehicleTap(id: number): void {
    const v = this.state.vehicles.find((x) => x.id === id);
    if (!v || this.state.completed) return;
    if (this.selectedVehicle === null || !this.state.vehicles.some((x) => x.id === this.selectedVehicle)) {
      this.selectedVehicle = id;
      this.sfx.select();
      const partners = this.state.vehicles.filter((x) => x.id !== id && x.level === v.level).length;
      this.hud.toast(partners > 0 ? `Lv${v.level} dipilih — ketuk kendaraan Lv${v.level} lain` : `Lv${v.level} dipilih — belum ada pasangan setingkat`, 1.8);
      return;
    }
    if (this.selectedVehicle === id) {
      this.selectedVehicle = null;
      this.sfx.click();
      return;
    }
    const sel = this.state.vehicles.find((x) => x.id === this.selectedVehicle)!;
    if (sel.level !== v.level) {
      this.selectedVehicle = id;
      this.sfx.select();
      this.hud.toast(`Tingkat berbeda — Lv${v.level} dipilih`, 1.6);
      return;
    }
    if (this.act(mergeVehicles(this.state, sel.id, id, this.events))) this.selectedVehicle = null;
  }

  private next(): void {
    if (this.transitioning || !this.state.completed) return;
    this.transitioning = true;
    this.sfx.click();
    this.hud.fade(true);
    window.setTimeout(() => {
      nextProject(this.state, this.events);
      this.events.length = 0;
      this.rt = createRuntime();
      this.selectedSlot = 0;
      this.selectedVehicle = null;
      this.completeTimer = -1;
      this.world.loadLevel(this.state);
      this.applyAmbience();
      this.hud.hideComplete();
      this.onResize();
      this.saveNow();
      this.resetClock = true;
      this.hud.fade(false);
      this.transitioning = false;
      this.showTitle();
    }, 380);
  }

  private resetProgress(): void {
    clearSave(this.storage);
    this.state = createNewGame();
    this.rt = createRuntime();
    this.selectedSlot = 0;
    this.selectedVehicle = null;
    this.completeTimer = -1;
    this.events.length = 0;
    this.world.loadLevel(this.state);
    this.applyAmbience();
    this.hud.hideComplete();
    this.hud.showSettings(false);
    this.onResize();
    this.saveNow();
    this.resetClock = true;
    this.hud.toast('Progres direset');
    this.showTitle();
  }

  private setSound(on: boolean): void {
    this.settings.muted = !on;
    this.sfx.unlock();
    this.sfx.setMuted(this.settings.muted);
    saveSettings(this.storage, this.settings);
    if (on) this.sfx.click();
  }

  private showTitle(): void {
    const level = levelDef(this.state);
    const project = projectOf(this.state);
    this.hud.showTitle(`Proyek ${this.state.levelIndex + 1 + this.state.cycle * 3} · ${level.areaName}`, project.name);
  }

  private applyAmbience(): void {
    this.sfx.ambience = levelDef(this.state).theme === 'city' ? 'none' : 'birds';
  }

  // ---------------------------------------------------------------------------
  // Tutorial
  // ---------------------------------------------------------------------------

  private updateTutorial(): void {
    if (this.hud.settingsOpen || this.hud.completeVisible || this.transitioning) {
      this.hud.showTutorial(null);
      this.hud.setPulse(null);
      return;
    }
    const s = currentTutorial(this.state, this.rt);
    if (!s) {
      this.hud.showTutorial(null);
      this.hud.setPulse(null);
      return;
    }
    if (s.target === 'world') {
      this.hud.setPulse(null);
      const m = this.margins;
      this.hud.showTutorial(s.text, (this.appEl.clientWidth - m.right) / 2, this.appEl.clientHeight - m.bottom - 8, false);
    } else if (s.target === 'slot') {
      this.hud.setPulse(null);
      const p = this.world.buildButtonAnchor(s.slot ?? 0);
      if (p) this.hud.showTutorial(s.text, p.x, p.y);
      else this.hud.showTutorial(null);
    } else {
      this.hud.setPulse(s.target);
      const a = this.hud.anchorOf(s.target);
      this.hud.showTutorial(s.text, a.x, a.y);
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private bindInput(): void {
    const c = this.canvas;
    // Audio hanya bisa dimulai setelah gesture pengguna.
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    c.addEventListener('pointerdown', (e) => {
      if (this.transitioning || this.hud.settingsOpen) return;
      e.preventDefault();
      const pick = this.world.pick(e.clientX, e.clientY, c.getBoundingClientRect());
      if (pick && !this.state.completed) {
        if (pick.type === 'vehicle') this.onVehicleTap(pick.id);
        else this.selectSlot(pick.slot, true);
        return;
      }
      // Tap di area dunia (bukan UI/objek) → boost; tahan → boost dipertahankan.
      if (this.selectedVehicle !== null) this.selectedVehicle = null;
      if (this.state.completed) return;
      this.boostPointers.add(e.pointerId);
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* abaikan */
      }
      boostHold(this.rt, true);
      if (!this.rt.boost.exhausted) this.sfx.boostStart();
    });
    const release = (e: PointerEvent) => {
      if (this.boostPointers.delete(e.pointerId) && this.boostPointers.size === 0) boostHold(this.rt, false);
    };
    c.addEventListener('pointerup', release);
    c.addEventListener('pointercancel', release);
    c.addEventListener('lostpointercapture', release);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // Cegah zoom/scroll tak sengaja (iOS gesture & double-tap).
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener(
      'touchmove',
      (e) => {
        if (!(e.target as HTMLElement).closest('.m-card')) e.preventDefault();
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      if (e.repeat && e.code === 'Space') return;
      if (this.hud.settingsOpen) {
        if (e.key === 'Escape') this.hud.showSettings(false);
        return;
      }
      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          boostHold(this.rt, true);
          break;
        case 'a':
          this.doAdd();
          break;
        case 'm':
          this.doMerge();
          break;
        case 'e':
          this.doExpand();
          break;
        case 'u':
          this.stationAction(this.selectedSlot);
          break;
        case '1':
        case '2':
        case '3':
          this.selectSlot(Number(e.key) - 1, false);
          break;
        case 'enter':
          if (this.state.completed && this.hud.completeVisible) this.next();
          break;
        case 'escape':
          this.selectedVehicle = null;
          break;
        default:
          break;
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        boostHold(this.rt, false);
        boostTap(this.rt);
      }
    });
  }

  private releaseBoost(): void {
    this.boostPointers.clear();
    boostHold(this.rt, false);
  }

  private bindLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.releaseBoost();
        this.saveNow();
        this.sfx.suspend();
      } else {
        this.sfx.resume();
      }
      this.resetClock = true;
    });
    window.addEventListener('blur', () => {
      this.releaseBoost();
      this.resetClock = true;
    });
    window.addEventListener('pagehide', () => this.saveNow());
    window.addEventListener('beforeunload', () => this.saveNow());
  }

  private onResize(): void {
    const w = this.appEl.clientWidth;
    const h = this.appEl.clientHeight;
    const m = this.hud.measure();
    this.margins = m;
    this.world.resize(w, h, m.top + 6, m.bottom + 6, m.right, this.state);
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  private requestSave(delay: number): void {
    if (this.saveDebounce <= 0 || this.saveDebounce > delay) this.saveDebounce = delay;
  }

  private saveNow(): void {
    this.autosaveTimer = 0;
    this.saveDebounce = -1;
    saveGame(this.storage, this.state);
  }
}

/** localStorage bisa melempar error (mode privat / diblokir) — pakai cadangan di memori. */
function safeStorage(): Storage {
  try {
    const k = '__lb_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      key: (i: number) => [...m.keys()][i] ?? null,
      removeItem: (k: string) => void m.delete(k),
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  }
}
