import Phaser from 'phaser';
import { GameConfig as C } from './config/GameConfig';
import { GameScene } from './game/GameScene';

const S = C.view.renderScale;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#171b26',
  width: C.view.width * S,
  height: C.view.height * S,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: 0 },
      autoUpdate: false, // stepped manually at a fixed 60 Hz by the Sim
      enableSleeping: false,
      debug: false,
    },
  },
  input: { activePointers: 2 },
  render: { antialias: true },
  banner: false,
  scene: [GameScene],
});
