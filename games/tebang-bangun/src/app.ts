import { Sfx } from './audio/sfx';
import { BALANCE } from './config/balance';
import { addWagon, expandTrack, mergeWagons, nextProject, upgradeCapacity, upgradeSpeed, type ActionResult } from './game/actions';
import { levelDef } from './game/economy';
import type { GameEvent } from './game/events';
import { clearSave, loadGame, loadSettings, saveGame, saveSettings, type Settings } from './game/save';
import { boostHold, boostTap, step } from './game/sim';
import { createNewGame, createRuntime } from './game/state';
import type { GameState, Runtime } from './game/types';
import { World } from './render/world';
import { Hud } from './ui/hud';
import { currentTutorial, updateTutorialFlags } from './ui/tutorial';

interface Touch {
  x: number;
  y: number;
  sx: number;
  sy: number;
  boost: boolean;
  panning: boolean;
  consumed: boolean;
}

/**
 * Kontroler utama: simulasi (state murni) ↔ render Three.js ↔ HUD DOM ↔ audio.
 * Input: ketuk/tahan = ngebut, seret = geser kamera, cubit/scroll = zoom.
 */
export class App {
  private state: GameState;
  private rt: Runtime = createRuntime();
  private readonly world: World;
  private readonly hud: Hud;
  private readonly sfx = new Sfx();
  private settings: Settings;
  private readonly events: GameEvent[] = [];
  private last = 0;
  private resetClock = true;
  private autosaveTimer = 0;
  private saveDebounce = -1;
  private completeTimer = -1;
  private transitioning = false;
  private readyToastShown = false;
  private readonly touches = new Map<number, Touch>();
  private pinchDist = 0;
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
      onModulePop: (i) => this.sfx.modulePop(i),
      onCut: (kind) => this.sfx.chop(kind),
    });
    this.hud = new Hud({
      add: () => this.act(addWagon(this.state, this.events)),
      merge: () => this.act(mergeWagons(this.state, this.events)),
      speed: () => this.act(upgradeSpeed(this.state, this.events)),
      capacity: () => this.act(upgradeCapacity(this.state, this.events)),
      expand: () => this.doExpand(),
      overview: () => {
        this.sfx.click();
        this.world.toggleOverview(this.state);
      },
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

    if (loaded.corrupted) this.hud.toast('Save lama/rusak — memulai permainan baru', 2.5);
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
    // dt dibatasi: tab yang ditinggal tidak membuat kereta "melompat".
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

    this.world.update(dt, this.state, this.rt);
    this.hud.update(this.state, this.rt, { muted: this.settings.muted, overview: this.world.overviewMode }, dt);
    this.updateTutorial();
    const running = !this.state.completed && this.rt.freeze <= 0 && !document.hidden;
    this.sfx.setEngine(this.rt.boost.mult, running);
    this.sfx.setSaw(running ? this.rt.cutHeat : 0);
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
    const res = levelDef(this.state).buildResource;
    for (const e of this.events) {
      switch (e.type) {
        case 'cut':
          if (e.money > 0) this.hud.moneyGain(e.money);
          break;
        case 'plotReady':
          this.sfx.ready();
          if (!this.readyToastShown) {
            this.readyToastShown = true;
            this.hud.toast(`Lahan bersih! Kereta akan membawa ${res === 'wood' ? 'kayu' : 'batu'} untuk membangun`, 2.8);
          }
          this.requestSave(0.5);
          break;
        case 'deliver':
          this.sfx.unload(e.amount, res === 'wood' ? 'wood' : 'brick');
          this.requestSave(1.5);
          break;
        case 'sell':
          this.sfx.sell(e.money);
          this.hud.moneyGain(e.money);
          this.requestSave(1);
          break;
        case 'rent':
          this.sfx.rent();
          this.hud.moneyGain(e.amount);
          break;
        case 'plotComplete':
          this.sfx.stageComplete();
          this.requestSave(0.3);
          break;
        case 'streetComplete':
          this.sfx.merge(4);
          this.hud.moneyGain(e.bonus);
          break;
        case 'projectComplete':
          this.sfx.projectComplete();
          this.hud.moneyGain(e.bonus + e.leftover);
          this.releaseBoost();
          this.completeTimer = 2.2;
          this.saveNow();
          break;
        case 'add':
          this.sfx.purchase();
          this.hud.bought('add');
          break;
        case 'merge':
          this.sfx.merge(e.level);
          this.hud.bought('merge');
          break;
        case 'speed':
          this.sfx.upgrade();
          this.hud.bought('speed');
          break;
        case 'capacity':
          this.sfx.upgrade();
          this.hud.bought('capacity');
          break;
        case 'expand':
          this.sfx.expand();
          this.hud.bought('expand');
          break;
        default:
          break;
      }
    }
    this.events.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Aksi
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

  private doExpand(): void {
    if (this.rt.freeze > 0) return;
    this.act(expandTrack(this.state, this.rt, this.events));
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
    this.hud.showTitle(`Level ${this.state.levelIndex + 1 + this.state.cycle * 2}`, levelDef(this.state).name);
  }

  private applyAmbience(): void {
    this.sfx.ambience = 'birds';
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
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    c.addEventListener('pointerdown', (e) => {
      if (this.transitioning || this.hud.settingsOpen) return;
      e.preventDefault();
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* abaikan */
      }
      const t: Touch = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, boost: false, panning: false, consumed: false };
      this.touches.set(e.pointerId, t);
      if (this.touches.size >= 2) {
        this.releaseBoost();
        for (const o of this.touches.values()) o.consumed = true;
        this.pinchDist = this.pinchDistance();
        return;
      }
      if (this.state.completed) return;
      // Ketuk → boost; tahan → dipertahankan; seret → berubah jadi geser kamera.
      t.boost = true;
      boostHold(this.rt, true);
      if (!this.rt.boost.exhausted) this.sfx.boostStart();
    });

    c.addEventListener('pointermove', (e) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      if (this.touches.size >= 2) {
        t.x = e.clientX;
        t.y = e.clientY;
        const d = this.pinchDistance();
        if (this.pinchDist > 0 && d > 0) this.world.zoom(this.pinchDist / d);
        this.pinchDist = d;
        return;
      }
      if (t.consumed) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      if (!t.panning && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) > 12) {
        t.panning = true;
        if (t.boost) {
          t.boost = false;
          this.rt.boost.tapTimer = 0;
          if (![...this.touches.values()].some((o) => o.boost)) boostHold(this.rt, false);
        }
      }
      if (t.panning) this.world.pan(dx, dy, c.getBoundingClientRect());
      t.x = e.clientX;
      t.y = e.clientY;
    });

    const release = (e: PointerEvent) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      this.touches.delete(e.pointerId);
      if (t.boost && ![...this.touches.values()].some((o) => o.boost)) boostHold(this.rt, false);
      if (this.touches.size < 2) this.pinchDist = 0;
    };
    c.addEventListener('pointerup', release);
    c.addEventListener('pointercancel', release);
    c.addEventListener('lostpointercapture', release);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.world.zoom(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.004));
      },
      { passive: false },
    );
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
          this.act(addWagon(this.state, this.events));
          break;
        case 'm':
          this.act(mergeWagons(this.state, this.events));
          break;
        case 's':
          this.act(upgradeSpeed(this.state, this.events));
          break;
        case 'c':
          this.act(upgradeCapacity(this.state, this.events));
          break;
        case 'e':
          this.doExpand();
          break;
        case 'o':
          this.world.toggleOverview(this.state);
          break;
        case 'enter':
          if (this.state.completed && this.hud.completeVisible) this.next();
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

  private pinchDistance(): number {
    const pts = [...this.touches.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private releaseBoost(): void {
    for (const t of this.touches.values()) t.boost = false;
    boostHold(this.rt, false);
  }

  private bindLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.releaseBoost();
        this.touches.clear();
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
