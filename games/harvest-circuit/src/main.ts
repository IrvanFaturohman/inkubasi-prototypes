import './style.css';
import { AUTOSAVE_SEC, FIELDS, OFFLINE } from './config';
import { FixedClock } from './clock';
import { Game } from './economy';
import { Input } from './input';
import { Sfx } from './audio';
import { Scene3D, formatMoney } from './scene3d';
import { clearSave, getStorage, loadState, saveState } from './save';
import { UI } from './ui';
import type { GameEvent, OfflineFieldSummary } from './types';

const storage = getStorage();
const { state, fresh } = loadState(storage);
const game = new Game(state);
// Offline catch-up happens once here; the save's clock is advanced before simulating.
const offline = fresh ? null : game.catchUp(Date.now());

const sfx = new Sfx();
sfx.muted = state.muted;
sfx.volume = state.volume;

let resetting = false;
const save = () => {
  if (resetting) return;
  saveState(storage, game.state);
};

const root = document.getElementById('app')!;
const ui = new UI(root, game, sfx, {
  buy: (kind) => game.buy(kind),
  switchField: (id) => {
    if (id !== game.state.current) game.switchField(id);
  },
  unlockField: (id) => game.unlockField(id),
  setMuted: (m) => {
    game.state.muted = m;
    sfx.setMuted(m);
    save();
  },
  setVolume: (v) => {
    game.state.volume = v;
    sfx.setVolume(v);
  },
  reset: () => {
    resetting = true;
    clearSave(storage);
    window.location.reload();
  },
  storageOk: storage !== null,
});

let scene: Scene3D | null = null;
try {
  scene = new Scene3D(ui.stage, ui.overlayRoot);
  scene.showField(game, game.state.current, { snap: true });
} catch (err) {
  console.error(err);
  const msg = document.createElement('div');
  msg.className = 'webgl-error';
  msg.textContent = 'This game needs WebGL. Please enable hardware acceleration or try another browser.';
  ui.stage.appendChild(msg);
}

const input = new Input(ui.stage, game);
input.onPress = () => {
  sfx.unlock();
  sfx.tap();
};
// Audio can only start from a user gesture.
const unlockAudio = () => sfx.unlock();
window.addEventListener('pointerdown', unlockAudio, { capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });

const resize = () => {
  const r = ui.stage.getBoundingClientRect();
  scene?.resize(r.width, r.height);
};
new ResizeObserver(resize).observe(ui.stage);
window.addEventListener('orientationchange', resize);
resize();

let swapPending = false;
function handle(e: GameEvent): void {
  const cur = game.state.current;
  if (e.type === 'switch' || e.type === 'unlockField') {
    if (e.type === 'unlockField') {
      ui.toast(`${FIELDS[e.field].name} is open!`);
      sfx.expand();
    } else sfx.ui();
    if (scene && !swapPending && scene.fieldId !== game.state.current) {
      const s = scene;
      swapPending = true;
      ui.fadeSwap(() => {
        swapPending = false;
        s.showField(game, game.state.current, { snap: true });
      });
    }
    save();
    return;
  }
  if (e.type === 'mission') {
    ui.toast(`Goal done: ${e.text}  +$${formatMoney(e.reward)}`);
    sfx.mission();
    return;
  }
  scene?.handleEvent(e, game);
  if (e.field !== cur) return;
  switch (e.type) {
    case 'cut':
      sfx.cut();
      break;
    case 'full':
      sfx.full();
      break;
    case 'sell':
      window.setTimeout(() => sfx.sell(e.amount), 400);
      if (e.first) window.setTimeout(() => ui.toast('Spend your coins on upgrades below ↓'), 900);
      break;
    case 'spawn':
      sfx.spawn();
      break;
    case 'merge':
      sfx.merge();
      break;
    case 'upgrade':
      if (e.kind === 'expand') sfx.expand();
      else if (e.kind !== 'merge' && e.kind !== 'add') sfx.upgrade();
      if (e.kind === 'auto') ui.toast('Auto Drive on — tap/hold still speeds up');
      save();
      break;
    default:
      break;
  }
}
if (scene) scene.onMergePop = () => sfx.mergePop();

const clock = new FixedClock();
let last = performance.now();
let raf = 0;
let saveTimer = 0;
let running = false;

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  const raw = Math.max(0, (now - last) / 1000);
  last = now;
  update(raw);
}

function update(raw: number, render = true): void {
  const alpha = clock.advance(raw, (dt) => {
    scene?.recordPrev(game);
    game.step(dt);
  });
  game.state.simWallClock = Date.now();
  for (const e of game.drainEvents()) handle(e);
  const vdt = Math.min(raw, 0.1);
  scene?.frame(vdt, alpha, game, render);
  ui.update(vdt);
  const rt = game.rt[game.state.current];
  sfx.engine(game.isPressing() ? Math.min(1, rt.drive) : 0, rt.drive);
  saveTimer += raw;
  if (saveTimer >= AUTOSAVE_SEC) {
    saveTimer = 0;
    save();
  }
}

function start(): void {
  if (running) return;
  running = true;
  last = performance.now();
  clock.reset();
  raf = requestAnimationFrame(frame);
}

function stop(): void {
  running = false;
  cancelAnimationFrame(raf);
}

function showSummary(res: OfflineFieldSummary[] | null): void {
  if (!res || res.length === 0) return;
  const secs = res[0].seconds;
  if (secs < OFFLINE.summaryMinSec) return;
  if (!res.some((r) => r.auto)) return;
  ui.showOffline(res);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    save();
    stop();
    input.clear();
    sfx.suspend();
  } else {
    // Simulate the hidden gap once (the clock advances first, so this can't double-pay).
    const res = game.catchUp(Date.now());
    save();
    showSummary(res);
    sfx.resume();
    stop();
    start();
  }
});
window.addEventListener('pagehide', save);
window.addEventListener('beforeunload', save);

save();
showSummary(offline);
start();

// Handy for manual testing in the console. `tick(sec)` runs the normal frame update
// synchronously (useful when the tab is in the background and rAF is paused).
const tick = (sec: number, fps = 60): void => {
  const n = Math.max(1, Math.round(sec * fps));
  for (let i = 0; i < n; i++) update(1 / fps, i === n - 1);
};
(window as unknown as { __hc: unknown }).__hc = { game, scene, ui, save, tick, pause: stop, resume: start };
