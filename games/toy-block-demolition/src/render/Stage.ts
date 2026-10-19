import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PALETTE, type QualityProfile } from '../game/config';

/**
 * Renderer, scene, lighting and ground. One renderer for the app lifetime;
 * areas only swap level-specific groups.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly sunOffset = new THREE.Vector3(-6.5, 11, -3);
  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();
  private shadowTexel = 0.02;
  private profile: QualityProfile;

  constructor(canvas: HTMLCanvasElement, profile: QualityProfile) {
    this.profile = profile;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(PALETTE.ground);

    // Soft fill from sky + a warm key light with restrained shadows.
    this.hemi = new THREE.HemisphereLight('#FFFFFF', '#A9C3B0', 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#FFF4E2', 2.5);
    this.sun.castShadow = profile.shadows;
    this.sun.shadow.mapSize.set(profile.shadowMap, profile.shadowMap);
    const sc = this.sun.shadow.camera;
    sc.left = -13;
    sc.right = 13;
    sc.top = 15;
    sc.bottom = -15;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);
    this.computeLightBasis();

    // Procedural environment for soft plastic reflections (no downloads).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    // Ground outside the playable area.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.applyProfile(profile);
  }

  private computeLightBasis(): void {
    const dir = this.sunOffset.clone().normalize();
    this.lightRight.crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    this.lightUp.crossVectors(dir, this.lightRight).normalize();
  }

  applyProfile(p: QualityProfile): void {
    const shadowSizeChanged = p.shadowMap !== this.profile.shadowMap;
    this.profile = p;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.dpr));
    this.sun.castShadow = p.shadows;
    if (shadowSizeChanged) {
      this.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.shadowTexel = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / p.shadowMap;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
  }

  /** Keep the shadow frustum over the visible area, snapped to texels to avoid shimmering. */
  followLight(target: THREE.Vector3): void {
    // Centre the shadow box a little ahead (north) of the camera target where most of the view is.
    const c = this._centre.copy(target);
    c.z -= 3;
    const r = c.dot(this.lightRight);
    const u = c.dot(this.lightUp);
    const sr = Math.round(r / this.shadowTexel) * this.shadowTexel - r;
    const su = Math.round(u / this.shadowTexel) * this.shadowTexel - u;
    const t = this.sun.target.position;
    t.copy(c).addScaledVector(this.lightRight, sr).addScaledVector(this.lightUp, su);
    this.sun.position.copy(t).add(this.sunOffset);
    this.sun.target.updateMatrixWorld();
  }
  private readonly _centre = new THREE.Vector3();

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }
}
