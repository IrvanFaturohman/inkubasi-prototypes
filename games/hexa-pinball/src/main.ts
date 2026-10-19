import Phaser from 'phaser';
import { GameScene, W, H } from './view/GameScene';
import { COLOURS } from './core/config';
import { LEVELS } from './core/levels';

const params = new URLSearchParams(location.search);
GameScene.bootLevel = Math.max(0, Math.min(LEVELS.length - 1, (Number(params.get('level')) || 1) - 1));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#0d1222',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [GameScene],
});

const scene = () => game.scene.getScene('game') as GameScene;
const colourOf = (c: number | string): number =>
  typeof c === 'number' ? c : COLOURS.findIndex((x) => x.name.toLowerCase() === String(c).toLowerCase());

// Test harness. Drive the game with fixed ticks instead of real time:
//   __hxp.pause(); __hxp.place(0); __hxp.step(120); __hxp.state()
const hxp = {
  /** Place tray stack `slot` on the first free cell. */
  place: (slot = 0) => {
    const s = scene();
    const free = s.model.free();
    return free.length ? s.harnessPlace(slot, free[0]) : null;
  },
  /** Place tray stack `slot` on a given cell index (0..18). */
  placeAt: (cell: number, slot = 0) => scene().harnessPlace(slot, cell),
  /** Drop a ball of a colour (index or name) into the plunger lane, or send it through the pipe. */
  ball: (colour: number | string = 0, viaPipe = false) => {
    const s = scene();
    s.model.injectBall(colourOf(colour), viaPipe);
    s.processEvents();
    return s.model.snapshot().balls;
  },
  /** Unlock a locked cell (next in level order when omitted). */
  unlock: (cell?: number) => {
    const s = scene();
    const c = s.model.unlock(cell);
    s.processEvents();
    return c;
  },
  /** Advance n fixed ticks (1/60 s each) and return the state. */
  step: (n = 1) => {
    const s = scene();
    s.manualStep(n);
    return s.model.snapshot();
  },
  state: () => scene().model.snapshot(),
  level: (n: number) => scene().scene.restart({ level: n - 1 }),
  pause: () => {
    scene().manual = true;
  },
  resume: () => {
    scene().manual = false;
  },
};
(window as unknown as { __hxp: typeof hxp }).__hxp = hxp;
