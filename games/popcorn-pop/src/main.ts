// ---------------------------------------------------------------------------
// Popcorn Pop! — bootstrap and main loop.
// Economy runs in fixed steps (economy.ts); the 3D scene and UI only
// visualise it. Rendering pauses when the tab is hidden.
// ---------------------------------------------------------------------------
import './style.css';
import * as THREE from 'three';
import { sfx } from './audio';
import { BALANCE, KIOSKS, cupSlotsFor, type KioskId, type UpgradeKind } from './config';
import {
  SIM_STEP,
  applyAway,
  newGame,
  stepGame,
  tryOpenFairground,
  tryShake,
  tryUpgrade,
  type GameState,
  type SimListener,
} from './economy';
import { checkMission } from './missions';
import { clearSave, loadGame, saveGame } from './save';
import { Stage } from './scene/stage';
import { UI, type TagSpec } from './ui/ui';

const saved = loadGame();
const g: GameState = saved ?? newGame();
sfx.setMuted(g.muted);

// Preview a phone size on desktop: ?frame=390x844
const previewSize = /^(\d{3,4})x(\d{3,4})$/.exec(new URLSearchParams(location.search).get('frame') ?? '');
if (previewSize) {
  const app = document.getElementById('app')!;
  app.style.maxWidth = `${previewSize[1]}px`;
  app.style.height = `${Math.min(+previewSize[2], window.innerHeight)}px`;
  app.style.bottom = 'auto';
}

const stageEl = document.getElementById('stage')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

let stage: Stage;
try {
  stage = new Stage(stageEl, canvas, { kernelLand: () => sfx.kernel() });
} catch (err) {
  stageEl.innerHTML =
    '<p style="padding:24px;text-align:center;font-weight:800">WebGL is not available on this device/browser, so the 3D machine cannot be shown.</p>';
  throw err;
}

let resetting = false;
function save(): void {
  if (!resetting) saveGame(g);
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function switchKiosk(id: KioskId): void {
  if (id === g.active || !g.kiosks[id].unlocked) return;
  ui.fade(() => {
    g.active = id;
    stage.setKiosk(g.kiosks[id]);
    ui.setKiosk(id, stage.themeBg);
    save();
  });
}

const ui = new UI(
  {
    upgrade(kind: UpgradeKind) {
      const k = g.kiosks[g.active];
      const slotsBefore = cupSlotsFor(k.levels.pack);
      if (tryUpgrade(g, g.active, kind)) {
        sfx.upgrade();
        stage.machine.upgradeFx(kind);
        ui.upgradeFx(kind);
        if (kind === 'pack' && cupSlotsFor(k.levels.pack) > slotsBefore) ui.toast('New cup unlocked! Parallel sales ✨');
        save();
      } else {
        sfx.deny();
        ui.denyFx(kind);
      }
    },
    shake() {
      const k = g.kiosks[g.active];
      if (tryShake(k)) {
        stage.machine.shake();
        sfx.shake();
      } else {
        sfx.deny();
        ui.denyFx('shake');
      }
    },
    switchKiosk,
    openFairground() {
      if (tryOpenFairground(g)) {
        sfx.fanfare();
        save();
        ui.fade(() => {
          g.active = 'fairground';
          stage.setKiosk(g.kiosks.fairground);
          ui.setKiosk('fairground', stage.themeBg);
          ui.toast('Fairground is open! Cinema keeps earning 🍿');
        });
      } else sfx.deny();
    },
    toggleMute() {
      g.muted = !g.muted;
      sfx.setMuted(g.muted);
      sfx.click();
      save();
    },
    reset() {
      resetting = true;
      clearSave();
      location.reload();
    },
    tapStage(x: number, y: number) {
      if (stage.hitPot(x, y)) this.shake();
    },
  },
  () => g,
);

// ---------------------------------------------------------------------------
// Simulation -> visuals (visible kiosk only)
// ---------------------------------------------------------------------------

const tmpV = new THREE.Vector3();
const listener: SimListener = {
  feed: (k) => stage.machine.onFeed(k),
  pop: (k) => {
    stage.machine.onPop(k);
    sfx.pop(k.shakeBoost > 0 ? 1.15 : 1);
  },
  pack: (k, cup) => stage.machine.onPack(k, cup),
  sale: (k, cup, price) => {
    stage.machine.onSale(k, cup);
    const p = stage.project(stage.machine.cupTop(cup, tmpV));
    ui.saleFx(p.x, p.y - 10, price);
    sfx.sale();
  },
  cupReady: (k, cup) => stage.machine.onCupReady(k, cup),
};

// ---------------------------------------------------------------------------
// Status tags anchored to the 3D scene
// ---------------------------------------------------------------------------

const tags: TagSpec[] = [
  { id: 'feed', text: 'POT FULL', sub: 'upgrade HEAT', tone: 'warn', x: 0, y: 0, visible: false },
  { id: 'pop', text: 'TRAY FULL', sub: 'upgrade PACK', tone: 'warn', x: 0, y: 0, visible: false },
  { id: 'pack', text: 'WAITING FOR CUP', tone: 'info', x: 0, y: 0, visible: false },
  { id: 'boost', text: 'HEAT ×1.8!', tone: 'boost', x: 0, y: 0, visible: false },
  { id: 'lock1', text: `PACK Lv${BALANCE.cupSlotUnlockPackLevel[1]}`, tone: 'lock', x: 0, y: 0, visible: false },
  { id: 'lock2', text: `PACK Lv${BALANCE.cupSlotUnlockPackLevel[2]}`, tone: 'lock', x: 0, y: 0, visible: false },
];

function updateTags(): void {
  const k = g.kiosks[g.active];
  const m = stage.machine;
  const st = m.getStatus();
  const place = (t: TagSpec, v: THREE.Vector3, visible: boolean) => {
    t.visible = visible;
    if (visible) {
      const p = stage.project(v);
      t.x = p.x;
      t.y = p.y;
    }
  };
  place(tags[0], m.anchor('hopper', tmpV), st.feedBlocked);
  place(tags[1], m.anchor('tray', tmpV), st.popBlocked);
  place(tags[2], m.anchor('fan', tmpV), st.packWaiting && !st.popBlocked);
  place(tags[3], m.anchor('pot', tmpV), k.shakeBoost > 0 && !st.feedBlocked);
  place(tags[4], m.lockAnchor(1, tmpV), !m.isSlotUnlocked(1));
  place(tags[5], m.lockAnchor(2, tmpV), !m.isSlotUnlocked(2));
  ui.setTags(tags);
}

// ---------------------------------------------------------------------------
// Time: offline earnings, hidden-tab catch-up, main loop
// ---------------------------------------------------------------------------

function catchUp(seconds: number): void {
  const gain = applyAway(g, seconds);
  if (gain > 0 && seconds >= BALANCE.awayPanelMinSec) ui.showAway(gain, seconds);
  save();
}

stage.setKiosk(g.kiosks[g.active]);
ui.setKiosk(g.active, stage.themeBg);
if (saved) {
  const away = (Date.now() - saved.savedAt) / 1000;
  if (away > BALANCE.catchUpSimulateMaxSec) catchUp(away);
}

let last = performance.now();
let acc = 0;
let raf = 0;
let saveTimer = 0;
let hiddenAt = 0;

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0;
  // A long stall (throttled tab, sleeping device) is credited as "away"
  // income instead of being simulated piece by piece.
  if (dt > BALANCE.catchUpSimulateMaxSec) {
    catchUp(dt);
    dt = 0;
  }

  acc += dt;
  let steps = 0;
  while (acc >= SIM_STEP && steps < 400) {
    stepGame(g, SIM_STEP, listener);
    acc -= SIM_STEP;
    steps++;
  }
  if (steps >= 400) acc = 0;

  // one celebration at a time: the next mission completes after this one
  const done = ui.missionBusy ? null : checkMission(g);
  if (done) {
    ui.missionDone(done);
    sfx.mission();
    save();
  }

  const vdt = Math.min(dt, 0.1);
  stage.update(vdt, g.kiosks[g.active]);
  ui.update(g, vdt);
  updateTags();
  stage.render();

  saveTimer += dt;
  if (saveTimer >= BALANCE.saveEverySec) {
    saveTimer = 0;
    save();
  }
}

// First paint right away so HUD and scene are correct even before rAF ticks.
ui.update(g, 1);
updateTags();
stage.render();

function start(): void {
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    cancelAnimationFrame(raf);
    save();
  } else {
    const gap = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0;
    hiddenAt = 0;
    if (gap > BALANCE.catchUpSimulateMaxSec) catchUp(gap);
    else acc += gap; // short gaps are simulated normally
    start();
  }
});
window.addEventListener('pagehide', save);
window.addEventListener('beforeunload', save);

// Audio may only start after a user gesture.
const unlockAudio = () => sfx.unlock();
window.addEventListener('pointerdown', unlockAudio, { capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });

// Prevent page scroll / pull-to-refresh while touching the game.
document.addEventListener(
  'touchmove',
  (e) => {
    if (!(e.target as HTMLElement).closest('.modal')) e.preventDefault();
  },
  { passive: false },
);

// Debug helpers for local testing (e.g. `popcorn.give(1000)` in the console).
(window as unknown as { popcorn: unknown }).popcorn = {
  state: g,
  stage,
  give(n: number) {
    g.money += n;
    g.lifetime += n;
  },
  kiosk: (id: KioskId) => switchKiosk(id),
  names: KIOSKS,
  /** Advance simulation + visuals by `sec` seconds and render (works in hidden tabs). */
  advance(sec: number) {
    const n = Math.round(sec / SIM_STEP);
    for (let i = 0; i < n; i++) {
      stepGame(g, SIM_STEP, listener);
      const done = checkMission(g);
      if (done) ui.missionDone(done);
      stage.update(SIM_STEP, g.kiosks[g.active]);
    }
    ui.update(g, 1);
    updateTags();
    stage.render();
  },
};

start();
