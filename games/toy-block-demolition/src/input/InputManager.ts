import type { DriveInput } from '../game/VehicleSim';

/**
 * Floating virtual joystick (touch + mouse drag via pointer events with
 * capture) and WASD / arrow keys. Produces a screen-space direction; the fixed
 * camera maps screen up to world -Z, so no rotation is needed.
 */
export class InputManager {
  private surface: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private stickX = 0;
  private stickY = 0;
  private stickMag = 0;
  private keys = new Set<string>();
  private enabled = true;
  private radius = 56;
  private readonly deadZone = 7;
  /** Fired on the first trusted gesture (audio unlock) and on any drive start. */
  onGesture: (() => void) | null = null;
  onDriveStart: (() => void) | null = null;

  constructor(surface: HTMLElement, joystickLayer: HTMLElement) {
    this.surface = surface;
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    joystickLayer.appendChild(this.base);
    this.updateRadius();

    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onUp);
    surface.addEventListener('lostpointercapture', this.onUp);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.release();
    });
  }

  /** Joystick radius scales with the viewport (≈48–64 CSS px). */
  updateRadius(): void {
    const w = this.surface.clientWidth || window.innerWidth;
    const h = this.surface.clientHeight || window.innerHeight;
    this.radius = Math.round(Math.min(64, Math.max(48, Math.min(w, h) * 0.14)));
    this.base.style.width = this.base.style.height = `${this.radius * 2}px`;
    this.knob.style.width = this.knob.style.height = `${Math.round(this.radius * 0.8)}px`;
    if (this.pointerId !== null) this.renderStick();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.release();
  }

  /** Drop all held input (modal opened, focus lost, state change). */
  release(): void {
    if (this.pointerId !== null) {
      try {
        if (this.surface.hasPointerCapture(this.pointerId)) this.surface.releasePointerCapture(this.pointerId);
      } catch {
        /* ignore */
      }
    }
    this.pointerId = null;
    this.stickX = this.stickY = this.stickMag = 0;
    this.keys.clear();
    this.base.classList.remove('active');
  }

  get dragging(): boolean {
    return this.pointerId !== null;
  }

  private onDown = (e: PointerEvent): void => {
    this.onGesture?.();
    if (!this.enabled || this.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const r = this.surface.getBoundingClientRect();
    this.originX = e.clientX - r.left;
    this.originY = e.clientY - r.top;
    this.stickX = this.stickY = this.stickMag = 0;
    this.base.classList.add('active');
    this.renderStick();
    this.onDriveStart?.();
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const r = this.surface.getBoundingClientRect();
    const dx = e.clientX - r.left - this.originX;
    const dy = e.clientY - r.top - this.originY;
    const len = Math.hypot(dx, dy);
    if (len <= this.deadZone) {
      this.stickX = this.stickY = this.stickMag = 0;
    } else {
      const clamped = Math.min(len, this.radius);
      this.stickX = dx / len;
      this.stickY = dy / len;
      this.stickMag = Math.min(1, (clamped - this.deadZone) / (this.radius - this.deadZone));
    }
    this.renderStick(dx, dy, len);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.stickX = this.stickY = this.stickMag = 0;
    this.base.classList.remove('active');
  };

  private renderStick(dx = 0, dy = 0, len = 0): void {
    this.base.style.transform = `translate(${this.originX - this.radius}px, ${this.originY - this.radius}px)`;
    const k = len > this.radius ? this.radius / len : 1;
    this.knob.style.transform = `translate(-50%, -50%) translate(${dx * k}px, ${dy * k}px)`;
  }

  private static readonly KEYMAP: Record<string, string> = {
    KeyW: 'up',
    ArrowUp: 'up',
    KeyS: 'down',
    ArrowDown: 'down',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const dir = InputManager.KEYMAP[e.code];
    if (!dir) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!this.enabled) return;
    e.preventDefault();
    this.onGesture?.();
    if (!this.keys.has(dir)) {
      this.keys.add(dir);
      this.onDriveStart?.();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const dir = InputManager.KEYMAP[e.code];
    if (dir) this.keys.delete(dir);
  };

  /** Current drive intent; keyboard wins when both are active. Opposite keys cancel. */
  read(out: DriveInput): DriveInput {
    if (!this.enabled) {
      out.x = out.y = out.mag = 0;
      return out;
    }
    const kx = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    const ky = (this.keys.has('down') ? 1 : 0) - (this.keys.has('up') ? 1 : 0);
    if (kx !== 0 || ky !== 0) {
      const l = Math.hypot(kx, ky);
      out.x = kx / l;
      out.y = ky / l;
      out.mag = 1;
      return out;
    }
    out.x = this.stickX;
    out.y = this.stickY;
    out.mag = this.stickMag;
    return out;
  }
}
