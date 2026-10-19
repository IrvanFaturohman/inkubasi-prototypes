import * as THREE from 'three';
import { CAMERA } from '../game/config';
import { clamp, damp } from '../game/util';

/**
 * Fixed-orientation orthographic follow camera (high three-quarter view).
 * Screen up = world -Z, screen right = world +X. The world never rotates with
 * steering; the camera eases after the truck with a small look-ahead.
 * Shake only offsets this camera, never the HTML HUD.
 */
export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3();
  private readonly dir: THREE.Vector3;
  private aspect = 0.5;
  private viewWidth: number = CAMERA.viewWidth;
  private targetViewWidth: number = CAMERA.viewWidth;
  private look = new THREE.Vector2();
  private shake = 0;
  private shakeT = 0;
  private focusY: number = CAMERA.vehicleScreenY;
  private focusTarget: number = CAMERA.vehicleScreenY;
  reducedMotion = false;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
    this.dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    this.updateProjection();
  }

  get sinPitch(): number {
    return this.dir.y;
  }

  get viewHeight(): number {
    return this.viewWidth / this.aspect;
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(0.2, width / Math.max(1, height));
    this.updateProjection();
  }

  /** Zoom out gently as the roller widens so the upgraded truck keeps its framing. */
  setRollerWidth(w: number): void {
    this.targetViewWidth = CAMERA.viewWidth + Math.max(0, w - 1.45) * 0.85;
  }

  /** Move the truck's framing (e.g. into the top third while the upgrade sheet is open). */
  setFocus(screenY: number | null): void {
    this.focusTarget = screenY ?? CAMERA.vehicleScreenY;
  }

  private updateProjection(): void {
    const hw = this.viewWidth / 2;
    const hh = hw / this.aspect;
    this.camera.left = -hw;
    this.camera.right = hw;
    this.camera.top = hh;
    this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();
  }

  private desired(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const dz = ((this.focusY - 0.5) * this.viewHeight) / this.sinPitch;
    return out.set(x + this.look.x, 0, z - dz + this.look.y);
  }

  snapTo(x: number, z: number): void {
    this.look.set(0, 0);
    this.focusY = this.focusTarget;
    this.viewWidth = this.targetViewWidth;
    this.updateProjection();
    this.desired(x, z, this.target);
    this.apply(0);
  }

  addShake(amount: number): void {
    if (this.reducedMotion) return;
    this.shake = Math.min(1, Math.max(this.shake, amount));
  }

  private readonly _d = new THREE.Vector3();

  update(dt: number, x: number, z: number, vx: number, vz: number): void {
    if (Math.abs(this.viewWidth - this.targetViewWidth) > 0.001) {
      this.viewWidth += (this.targetViewWidth - this.viewWidth) * damp(3, dt);
      this.updateProjection();
    }
    this.focusY += (this.focusTarget - this.focusY) * damp(6, dt);
    // Look-ahead in the direction of travel, bounded.
    const lx = clamp(vx * CAMERA.lookAhead, -CAMERA.maxLookAhead, CAMERA.maxLookAhead);
    const lz = clamp(vz * CAMERA.lookAhead, -CAMERA.maxLookAhead, CAMERA.maxLookAhead);
    this.look.x += (lx - this.look.x) * damp(2.5, dt);
    this.look.y += (lz - this.look.y) * damp(2.5, dt);
    const d = this.desired(x, z, this._d);
    this.target.lerp(d, damp(CAMERA.followSharpness, dt));
    // Bounded lag: never let the truck drift too far from the framing.
    const ex = this.target.x - d.x;
    const ez = this.target.z - d.z;
    const e = Math.hypot(ex, ez);
    if (e > CAMERA.maxLag) {
      this.target.x = d.x + (ex / e) * CAMERA.maxLag;
      this.target.z = d.z + (ez / e) * CAMERA.maxLag;
    }
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.shakeT += dt;
    this.apply(this.reducedMotion ? 0 : this.shake);
  }

  private apply(shake: number): void {
    const s = shake * shake * 0.09;
    const ox = s ? Math.sin(this.shakeT * 53) * s + Math.sin(this.shakeT * 31) * s * 0.5 : 0;
    const oz = s ? Math.cos(this.shakeT * 47) * s : 0;
    this.camera.position.copy(this.target).addScaledVector(this.dir, CAMERA.distance);
    this.camera.position.x += ox;
    this.camera.position.z += oz;
    this.camera.lookAt(this.target.x + ox, 0, this.target.z + oz);
  }
}
