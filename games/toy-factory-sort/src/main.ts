import Phaser from 'phaser';
import './style.css';
import { GameScene, type TfsState } from './GameScene';
import { GRAVITY, H, W } from './config';

export interface TfsHarness {
  /** Advance the simulation n fixed 1/60 s ticks, synchronously. Switches the
   * game to manual stepping (real time no longer advances the sim). */
  step(n?: number): number;
  /** Tap bin i (0-3). Returns false if the tap was ignored. */
  tap(i: number): boolean;
  state(): TfsState;
  /** Load level i (0-4). */
  level(i: number): TfsState;
  /** Hand control back to real time. */
  realtime(): void;
}

declare global {
  interface Window {
    __tfs?: TfsHarness;
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: W,
  height: H,
  backgroundColor: '#9cc3bf',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: GRAVITY }, debug: false } },
  input: { activePointers: 2 },
  scene: [GameScene],
});

game.events.once(Phaser.Core.Events.READY, () => {
  const scene = () => game.scene.getScene('game') as GameScene;
  window.__tfs = {
    step(n = 1) {
      const s = scene();
      s.manual = true;
      for (let i = 0; i < n; i++) s.tick();
      return n;
    },
    tap: (i) => scene().tapTray(i),
    state: () => scene().snapshot(),
    level(i) {
      scene().loadLevel(i);
      return scene().snapshot();
    },
    realtime() {
      scene().manual = false;
    },
  };
});
