// ---------------------------------------------------------------------------
// Renderer, orthographic diorama camera, lights, frustum fitting and picking.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import type { KioskId } from '../config';
import type { KioskState } from '../economy';
import { Machine, type MachineHooks } from './machine';
import { Particles } from './particles';
import { buildThemes, type Theme } from './theme';

/** Camera orientation: azimuth from +z toward +x, elevation above horizon. */
const AZIMUTH = 0.56;
const ELEVATION = 0.72;
/** Top of the kiosk sign, kept in view when the screen is tall enough. */
const SIGN_TOP = new THREE.Vector3(0.35, 4.5, -2.7);

export interface ScreenPoint {
  x: number;
  y: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly machine: Machine;
  readonly particles = new Particles(140);
  private readonly themes: Record<KioskId, Theme>;
  private theme: Theme;
  private readonly focus: THREE.Vector3[];
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private width = 1;
  private height = 1;
  private time = 0;
  /** Extra padding (CSS px) kept free around the content. */
  padding = { top: 10, right: 8, bottom: 14, left: 8 };

  constructor(
    private readonly container: HTMLElement,
    canvas: HTMLCanvasElement,
    hooks: MachineHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    const dist = 30;
    this.camera.position.set(
      Math.sin(AZIMUTH) * Math.cos(ELEVATION) * dist,
      Math.sin(ELEVATION) * dist,
      Math.cos(AZIMUTH) * Math.cos(ELEVATION) * dist,
    );
    this.camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xfff4e0, 0xd8a47a, 1.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
    sun.position.set(-4, 10, 7);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xcff5f0, 0.5);
    rim.position.set(6, 4, -6);
    this.scene.add(rim);

    this.themes = buildThemes();
    for (const t of Object.values(this.themes)) {
      t.group.visible = false;
      this.scene.add(t.group);
    }
    this.theme = this.themes.cinema;

    this.machine = new Machine(this.particles, hooks);
    this.scene.add(this.machine.root);
    this.scene.add(this.particles.mesh);
    this.focus = this.machine.focusPoints();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  setKiosk(k: KioskState): void {
    this.theme.group.visible = false;
    this.theme = this.themes[k.id];
    this.theme.group.visible = true;
    this.scene.background = new THREE.Color(this.theme.bg);
    const t = this.theme;
    this.machine.applyTheme(t.potColor, t.burnerColor, t.trayColor, t.cupStripe, t.customers);
    this.machine.reset(k);
    this.particles.clear();
  }

  get themeBg(): number {
    return this.theme.bg;
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.fit();
  }

  /** Fits the orthographic frustum so the whole machine is always visible. */
  private fit(): void {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.focus) {
      this.tmp.copy(p).applyMatrix4(inv);
      minX = Math.min(minX, this.tmp.x);
      maxX = Math.max(maxX, this.tmp.x);
      minY = Math.min(minY, this.tmp.y);
      maxY = Math.max(maxY, this.tmp.y);
    }
    // the kiosk sign is "nice to have": show it when there is spare height
    this.tmp.copy(SIGN_TOP).applyMatrix4(inv);
    const softMaxY = Math.max(maxY, this.tmp.y);
    const P = this.padding;
    const availW = Math.max(40, this.width - P.left - P.right);
    const availH = Math.max(40, this.height - P.top - P.bottom);
    const s = Math.max((maxX - minX) / availW, (maxY - minY) / availH); // world units per px
    const viewH = availH * s;
    const midY = softMaxY - minY <= viewH ? (minY + softMaxY) / 2 : minY + viewH / 2;
    const cx = (minX + maxX) / 2 - ((P.left - P.right) / 2) * s;
    const cy = midY - ((P.bottom - P.top) / 2) * s;
    cam.left = cx - (this.width * s) / 2;
    cam.right = cx + (this.width * s) / 2;
    cam.top = cy + (this.height * s) / 2;
    cam.bottom = cy - (this.height * s) / 2;
    cam.updateProjectionMatrix();
  }

  /** World -> CSS px inside the stage container. */
  project(v: THREE.Vector3, out: ScreenPoint = { x: 0, y: 0 }): ScreenPoint {
    this.tmp.copy(v).project(this.camera);
    out.x = (this.tmp.x * 0.5 + 0.5) * this.width;
    out.y = (-this.tmp.y * 0.5 + 0.5) * this.height;
    return out;
  }

  /** True when a tap at client coordinates hits the pot. */
  hitPot(clientX: number, clientY: number): boolean {
    const r = this.container.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.intersectObject(this.machine.potHit, false).length > 0;
  }

  update(dt: number, k: KioskState): void {
    this.time += dt;
    this.machine.update(dt, k);
    this.particles.update(dt);
    this.theme.update(dt, this.time);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
