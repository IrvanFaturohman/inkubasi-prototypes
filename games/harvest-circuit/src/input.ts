/**
 * One-finger drive input. Any pointer held on the field (or Space) = holding; each press
 * also gives a short tap boost. Many fingers never add speed — the drive factor is capped
 * in the simulation. UI buttons live outside the field element, so they never drive.
 */
import type { Game } from './economy';

export class Input {
  private pointers = new Set<number>();
  private key = false;
  /** Fired on every new press (pointer or Space). */
  onPress: () => void = () => {};

  constructor(
    private el: HTMLElement,
    private game: Game,
  ) {
    el.addEventListener('pointerdown', this.down, { passive: false });
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('lostpointercapture', this.up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointerup', this.up);
    window.addEventListener('blur', this.clear);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
  }

  private down = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    this.pointers.add(e.pointerId);
    this.game.tap();
    this.sync();
    this.onPress();
  };

  private up = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.sync();
  };

  private keyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Space') return;
    const t = e.target as HTMLElement | null;
    // Let Space activate a focused button / input as usual.
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    if (document.querySelector('.sheet-backdrop.open')) return;
    e.preventDefault();
    if (e.repeat) return;
    this.key = true;
    this.game.tap();
    this.sync();
    this.onPress();
  };

  private keyUp = (e: KeyboardEvent): void => {
    if (e.code !== 'Space') return;
    this.key = false;
    this.sync();
  };

  clear = (): void => {
    this.pointers.clear();
    this.key = false;
    this.sync();
  };

  private sync(): void {
    this.game.holding = this.pointers.size > 0 || this.key;
  }
}
