// ---------------------------------------------------------------------------
// The popcorn machine. It never changes the economy: it reads KioskState and
// reacts to simulation events, reconciling visible piles with the real stock
// (visible = stock - pieces still in the air).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { BALANCE, MAX_CUP_SLOTS, cupSlotsFor, type UpgradeKind } from '../config';
import type { KioskState } from '../economy';
import { Customer, type CustomerStyle } from './customer';
import {
  C,
  blobShadow,
  canvasTexture,
  kernelGeo,
  kernelMat,
  lambert,
  mesh,
  phong,
  popcornGeo,
  popcornMat,
} from './kit';
import type { Particles } from './particles';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const speedFactor = (level: number) => Math.pow(BALANCE.speedPerLevel, level - 1);

/** World layout of the machine (units ≈ 10 cm). */
export const LAYOUT = {
  pot: V(-0.75, 0, -0.45),
  burnerH: 0.52,
  potY: 0.95,
  hopperPole: V(-2.25, 0, -1.55),
  funnel: V(-1.7, 2.62, -0.9), // bottom centre of the funnel
  chuteEnd: V(-1.28, 2.36, -0.72),
  tray: { x0: 0.5, x1: 2.1, z0: -1.1, z1: 0.5, y: 0.5, wall: 0.3 },
  fan: V(0.38, 1.12, -0.35),
  cups: [V(2.52, 0, -0.85), V(2.52, 0, 0.3), V(2.52, 0, 1.45)],
  customerDX: 0.9,
};

const RAW_CAP = BALANCE.rawCap;
/** Radius of the burner flame ring (outside the pot bottom so flames are visible). */
const FLAME_R = 0.8;
const POP_CAP = BALANCE.poppedCap;
const CUP_SIZE = BALANCE.cupSize;

/** Horizontal camera direction; used to order pile slots so visible ones fill first. */
const CAM_DIR = new THREE.Vector2(Math.sin(0.56), Math.cos(0.56));

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// --- pile slot layouts ---------------------------------------------------------

interface Slot {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  s: number;
  phase: number;
}

function makeSlot(p: THREE.Vector3, r: () => number, sMin = 0.95, sMax = 1.1): Slot {
  const e = new THREE.Euler(r() * 6.28, r() * 6.28, r() * 6.28);
  return { p, q: new THREE.Quaternion().setFromEuler(e), s: sMin + r() * (sMax - sMin), phase: r() * 10 };
}

/** Kernel positions inside the pot (pot-local). Far side first so they stay visible. */
function potSlots(): Slot[] {
  const r = seeded(7);
  const base: THREE.Vector3[] = [V(0, 0.3, 0)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    base.push(V(Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3));
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    base.push(V(Math.cos(a) * 0.6, 0.3, Math.sin(a) * 0.6));
  }
  base.sort((a, b) => a.x * CAM_DIR.x + a.z * CAM_DIR.y - (b.x * CAM_DIR.x + b.z * CAM_DIR.y));
  const top: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    top.push(V(Math.cos(a) * 0.17, 0.43, Math.sin(a) * 0.17));
  }
  return [...base, ...top].slice(0, RAW_CAP).map((p) => {
    p.x += (r() - 0.5) * 0.06;
    p.z += (r() - 0.5) * 0.06;
    return makeSlot(p, r, 1.1, 1.3);
  });
}

/** Popcorn positions on the tray (world). */
function traySlots(): Slot[] {
  const T = LAYOUT.tray;
  const r = seeded(11);
  const floor = T.y + 0.05;
  const l0: THREE.Vector3[] = [];
  const l1: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) l0.push(V(T.x0 + 0.28 + i * 0.36, floor + 0.14, T.z0 + 0.25 + j * 0.37));
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) l1.push(V(T.x0 + 0.46 + i * 0.36, floor + 0.36, T.z0 + 0.44 + j * 0.37));
  const shuffle = (a: THREE.Vector3[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  return [...shuffle(l0), ...shuffle(l1)].slice(0, POP_CAP).map((p) => {
    p.x += (r() - 0.5) * 0.08;
    p.z += (r() - 0.5) * 0.08;
    p.y += (r() - 0.5) * 0.04;
    return makeSlot(p, r);
  });
}

/** Popcorn positions inside a cup (cup-local). */
const CUP_CONTENT: THREE.Vector3[] = [V(0, 0.17, 0), V(-0.1, 0.38, 0.07), V(0.1, 0.42, -0.06), V(0.01, 0.64, 0.03), V(0.02, 0.88, 0)];

/** Kernel positions inside the hopper funnel (funnel-local). */
function hopperSlots(): Slot[] {
  const r = seeded(3);
  const out: THREE.Vector3[] = [V(0, 0.52, 0)];
  const ring = (n: number, rad: number, y: number, off = 0) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + off;
      out.push(V(Math.cos(a) * rad, y, Math.sin(a) * rad));
    }
  };
  ring(6, 0.2, 0.55);
  ring(6, 0.3, 0.66, 0.4);
  ring(9, 0.44, 0.7);
  ring(8, 0.22, 0.76, 0.2);
  return out.slice(0, 30).map((p) => makeSlot(p, r, 1.05, 1.25));
}

// --- flying pieces ---------------------------------------------------------------

type FlyKind = 'kernel' | 'pop' | 'pack';

interface Flyer {
  active: boolean;
  kind: FlyKind;
  a: THREE.Vector3;
  b: THREE.Vector3;
  arc: number;
  t: number;
  dur: number;
  q: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  scale: number;
  cup: number;
  slot: number;
  pos: THREE.Vector3;
}

function newFlyer(): Flyer {
  return {
    active: false,
    kind: 'pop',
    a: V(0, 0, 0),
    b: V(0, 0, 0),
    arc: 0,
    t: 0,
    dur: 1,
    q: new THREE.Quaternion(),
    axis: V(0, 1, 0),
    spin: 0,
    scale: 1,
    cup: 0,
    slot: 0,
    pos: V(0, 0, 0),
  };
}

// --- cups -----------------------------------------------------------------------

function stripeTexture(stripe: string, band: string) {
  return canvasTexture(256, 128, (ctx) => {
    ctx.clearRect(0, 0, 256, 128);
    const n = 8;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 === 0 ? stripe : 'rgba(255,250,240,0.28)';
      ctx.fillRect((i * 256) / n, 0, 256 / n, 128);
    }
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, 256, 16);
  });
}

const cupBodyGeo = new THREE.CylinderGeometry(0.36, 0.27, 0.85, 16, 1, true).translate(0, 0.425, 0);
const cupBottomGeo = new THREE.CircleGeometry(0.27, 16).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
const cupRimGeo = new THREE.TorusGeometry(0.36, 0.03, 6, 20).rotateX(Math.PI / 2).translate(0, 0.85, 0);

interface CupView {
  g: THREE.Group;
  contents: THREE.InstancedMesh;
}

// --- machine ----------------------------------------------------------------------

export interface MachineHooks {
  kernelLand(): void;
}

interface CupSlot {
  view: CupView;
  pos: THREE.Vector3;
  shadow: THREE.Mesh;
  lock: THREE.Mesh;
  custs: [Customer, Customer];
  cur: 0 | 1;
  unlocked: boolean;
  shown: boolean;
  popIn: number;
  punch: number;
  pendingSale: number;
}

export interface MachineStatus {
  feedBlocked: boolean;
  popBlocked: boolean;
  packWaiting: boolean;
  noKernels: boolean;
}

export class Machine {
  readonly root = new THREE.Group();
  /** Invisible hit target for "tap the pot". */
  readonly potHit: THREE.Mesh;

  private readonly potGroup = new THREE.Group();
  private readonly potOuterMat: THREE.MeshPhongMaterial;
  private readonly burnerMat: THREE.MeshLambertMaterial;
  private readonly glowMat: THREE.MeshLambertMaterial;
  private readonly flames: THREE.Mesh[] = [];
  private readonly flamesInner: THREE.Mesh[] = [];
  private readonly knob: THREE.Group;
  private readonly hopper = new THREE.Group();
  private readonly funnel = new THREE.Group();
  private readonly agitator: THREE.Group;
  private readonly fanBlades = new THREE.Group();
  private readonly fanGroup = new THREE.Group();
  private readonly trayFront: THREE.MeshLambertMaterial;

  private readonly potKernels: THREE.InstancedMesh;
  private readonly hopperKernels: THREE.InstancedMesh;
  private readonly trayPile: THREE.InstancedMesh;
  private readonly flyKernels: THREE.InstancedMesh;
  private readonly flyCorn: THREE.InstancedMesh;

  private readonly potSlots = potSlots();
  private readonly traySlots = traySlots();
  private readonly hopperSlots = hopperSlots();
  private readonly trayPunch = new Float32Array(POP_CAP);
  private readonly potPunch = new Float32Array(RAW_CAP);

  private readonly kernelFlyers: Flyer[] = [];
  private readonly cornFlyers: Flyer[] = [];
  private inflightKernels = 0;
  private inflightPops = 0;
  private readonly inflightPack = [0, 0, 0];

  private readonly slots: CupSlot[] = [];
  private readonly cupTextures: Record<string, THREE.Texture> = {};
  private readonly cupMat: THREE.MeshLambertMaterial;

  private style: CustomerStyle | null = null;
  private time = 0;
  private shakeT = 10;
  private hopperPunch = 0;
  private fanSpeed = 0;
  private fanAngle = 0;
  private agitatorSpeed = 0;
  private flameLevel = 0.4;
  private flareT = 0;
  private potPunchAll = 0;
  private packWaitT = 0;
  private feedFullHold = 0;
  private trayFullHold = 0;
  private status: MachineStatus = { feedBlocked: false, popBlocked: false, packWaiting: false, noKernels: true };

  private readonly dummy = new THREE.Object3D();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(
    private readonly particles: Particles,
    private readonly hooks: MachineHooks,
  ) {
    const L = LAYOUT;

    // ---- burner ----
    const burner = new THREE.Group();
    burner.position.copy(L.pot);
    this.burnerMat = new THREE.MeshLambertMaterial({ color: C.turquoiseDeep, flatShading: true });
    const base = mesh(new THREE.CylinderGeometry(0.86, 0.98, L.burnerH, 20), this.burnerMat, 0, L.burnerH / 2, 0);
    burner.add(base);
    burner.add(mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.08, 20), lambert(C.cream), 0, 0.04, 0));
    burner.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 20), lambert(C.charcoal), 0, L.burnerH, 0));
    this.glowMat = new THREE.MeshLambertMaterial({ color: 0x5a3a2a, emissive: 0xff6a1a, emissiveIntensity: 0.3 });
    const ring = mesh(new THREE.TorusGeometry(FLAME_R, 0.05, 6, 28).rotateX(Math.PI / 2), this.glowMat, 0, L.burnerH + 0.04, 0);
    burner.add(ring);
    const flameGeo = new THREE.ConeGeometry(0.13, 0.5, 6).translate(0, 0.25, 0);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
    const flameInnerMat = new THREE.MeshBasicMaterial({ color: 0xffd545 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const f = mesh(flameGeo, flameMat, Math.cos(a) * FLAME_R, L.burnerH + 0.03, Math.sin(a) * FLAME_R);
      const fi = mesh(flameGeo, flameInnerMat, Math.cos(a) * FLAME_R, L.burnerH + 0.03, Math.sin(a) * FLAME_R);
      fi.scale.setScalar(0.55);
      burner.add(f, fi);
      this.flames.push(f);
      this.flamesInner.push(fi);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      burner.add(
        mesh(new THREE.CylinderGeometry(0.035, 0.035, L.potY - L.burnerH, 5), lambert(C.charcoal), Math.cos(a) * 0.72, (L.burnerH + L.potY) / 2, Math.sin(a) * 0.72),
      );
    }
    // heat knob facing the camera — it turns with HEAT level
    const knobMount = new THREE.Group();
    const knobDir = new THREE.Vector3(CAM_DIR.x, 0, CAM_DIR.y).normalize();
    knobMount.position.set(knobDir.x * 0.93, 0.27, knobDir.z * 0.93);
    burner.add(knobMount);
    knobMount.lookAt(knobMount.position.clone().add(knobDir).add(L.pot));
    this.knob = new THREE.Group();
    this.knob.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12).rotateX(Math.PI / 2), lambert(C.cream)));
    this.knob.add(mesh(new THREE.BoxGeometry(0.04, 0.17, 0.06), lambert(C.orangeDeep), 0, 0.03, 0.04));
    knobMount.add(this.knob);
    burner.add(blobShadow(2.4, 0.3));
    this.root.add(burner);

    // ---- pot ----
    const pg = this.potGroup;
    pg.position.set(L.pot.x, L.potY, L.pot.z);
    this.potOuterMat = new THREE.MeshPhongMaterial({ color: C.red, shininess: 60, specular: 0x886655, side: THREE.DoubleSide });
    const outer = new THREE.LatheGeometry(
      [V(0, 0, 0), V(0.7, 0, 0), V(0.85, 0.06, 0), V(0.94, 0.25, 0), V(1.0, 0.5, 0), V(1.03, 0.72, 0)].map((v) => new THREE.Vector2(v.x, v.y)),
      24,
    );
    pg.add(new THREE.Mesh(outer, this.potOuterMat));
    const inner = new THREE.LatheGeometry(
      [V(0, 0.22, 0), V(0.8, 0.22, 0), V(0.9, 0.36, 0), V(0.96, 0.58, 0), V(0.99, 0.74, 0)].map((v) => new THREE.Vector2(v.x, v.y)),
      24,
    );
    pg.add(new THREE.Mesh(inner, new THREE.MeshPhongMaterial({ color: 0xcfc6ba, shininess: 30, side: THREE.DoubleSide })));
    pg.add(mesh(new THREE.TorusGeometry(1.03, 0.065, 6, 28).rotateX(Math.PI / 2), phong(C.cream, 30), 0, 0.74, 0));
    // band
    pg.add(mesh(new THREE.CylinderGeometry(1.005, 0.985, 0.1, 24, 1, true), lambert(C.cream), 0, 0.46, 0));
    const handleGeo = new THREE.TorusGeometry(0.15, 0.045, 6, 10, Math.PI).rotateZ(-Math.PI / 2).rotateX(Math.PI / 2);
    for (const s of [-1, 1]) {
      const h = mesh(handleGeo, lambert(C.charcoal), 0.97 * s, 0.55, 0);
      if (s < 0) h.rotation.y = Math.PI;
      pg.add(h);
    }
    this.potKernels = new THREE.InstancedMesh(kernelGeo, kernelMat, RAW_CAP);
    this.potKernels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.potKernels.count = 0;
    this.potKernels.frustumCulled = false;
    pg.add(this.potKernels);
    this.root.add(pg);

    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    this.potHit = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.1, 2.3, 10), hitMat);
    this.potHit.position.set(L.pot.x, 1.1, L.pot.z);
    this.root.add(this.potHit);

    // ---- hopper ----
    const hp = this.hopper;
    const poleH = L.funnel.y + 0.9;
    hp.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, poleH, 8), lambert(C.charcoal), L.hopperPole.x, poleH / 2, L.hopperPole.z));
    hp.add(mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.1, 12), lambert(C.charcoal), L.hopperPole.x, 0.05, L.hopperPole.z));
    const armFrom = V(L.hopperPole.x, poleH - 0.15, L.hopperPole.z);
    const armTo = V(L.funnel.x, L.funnel.y + 0.55, L.funnel.z);
    const armLen = armFrom.distanceTo(armTo);
    const arm = mesh(new THREE.BoxGeometry(0.08, 0.08, armLen), lambert(C.charcoal));
    arm.position.copy(armFrom).lerp(armTo, 0.5);
    arm.lookAt(armTo);
    hp.add(arm);
    hp.add(blobShadow(0.8, 0.25).translateX(L.hopperPole.x).translateZ(L.hopperPole.z));

    const fn = this.funnel;
    fn.position.copy(L.funnel);
    const funnelMat = new THREE.MeshLambertMaterial({ color: C.butter, side: THREE.DoubleSide, flatShading: true });
    fn.add(mesh(new THREE.CylinderGeometry(0.62, 0.13, 0.85, 14, 1, true), funnelMat, 0, 0.425, 0));
    fn.add(mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 24).rotateX(Math.PI / 2), lambert(C.orange), 0, 0.85, 0));
    fn.add(mesh(new THREE.CylinderGeometry(0.585, 0.54, 0.1, 14, 1, true), new THREE.MeshLambertMaterial({ color: C.orange, side: THREE.DoubleSide }), 0, 0.72, 0));
    // chute toward the pot
    const chuteFrom = V(0, 0, 0);
    const chuteTo = L.chuteEnd.clone().sub(L.funnel);
    const chute = mesh(new THREE.CylinderGeometry(0.09, 0.09, chuteFrom.distanceTo(chuteTo) + 0.1, 8, 1, true).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: C.orange, side: THREE.DoubleSide }));
    chute.position.copy(chuteFrom).lerp(chuteTo, 0.5);
    chute.lookAt(chuteTo.clone().add(L.funnel));
    fn.add(chute);
    this.hopperKernels = new THREE.InstancedMesh(kernelGeo, kernelMat, 30);
    this.hopperKernels.count = 0;
    // counts change at runtime; a bounding sphere computed while count is 0
    // would cull the mesh forever, so skip culling for these small meshes
    this.hopperKernels.frustumCulled = false;
    fn.add(this.hopperKernels);
    this.agitator = new THREE.Group();
    this.agitator.position.y = 0.95;
    this.agitator.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), lambert(C.charcoal), 0, -0.15, 0));
    this.agitator.add(mesh(new THREE.BoxGeometry(0.95, 0.06, 0.1), lambert(C.turquoise)));
    this.agitator.add(mesh(new THREE.IcosahedronGeometry(0.09, 1), lambert(C.orange), 0, 0.06, 0));
    fn.add(this.agitator);
    hp.add(fn);
    this.root.add(hp);

    // ---- tray ----
    const T = L.tray;
    const tw = T.x1 - T.x0;
    const td = T.z1 - T.z0;
    const tcx = (T.x0 + T.x1) / 2;
    const tcz = (T.z0 + T.z1) / 2;
    this.trayFront = new THREE.MeshLambertMaterial({ color: C.turquoise, flatShading: true });
    this.root.add(mesh(new THREE.BoxGeometry(tw, T.y, td), lambert(C.cream), tcx, T.y / 2, tcz));
    this.root.add(mesh(new THREE.BoxGeometry(tw + 0.02, 0.14, td + 0.02), this.trayFront, tcx, T.y * 0.55, tcz));
    this.root.add(mesh(new THREE.BoxGeometry(tw, 0.05, td), phong(C.steel, 50), tcx, T.y + 0.025, tcz));
    const wallMat = phong(0xe9e2d6, 40);
    const wt = 0.06;
    this.root.add(mesh(new THREE.BoxGeometry(tw, T.wall, wt), wallMat, tcx, T.y + T.wall / 2, T.z0 + wt / 2));
    this.root.add(mesh(new THREE.BoxGeometry(tw, T.wall * 0.7, wt), wallMat, tcx, T.y + (T.wall * 0.7) / 2, T.z1 - wt / 2));
    this.root.add(mesh(new THREE.BoxGeometry(wt, T.wall, td), wallMat, T.x0 + wt / 2, T.y + T.wall / 2, tcz));
    this.root.add(mesh(new THREE.BoxGeometry(wt, T.wall * 0.5, td), wallMat, T.x1 - wt / 2, T.y + (T.wall * 0.5) / 2, tcz));
    this.root.add(blobShadow(2.4, 0.22).translateX(tcx).translateZ(tcz));
    this.trayPile = new THREE.InstancedMesh(popcornGeo, popcornMat, POP_CAP);
    this.trayPile.count = 0;
    this.trayPile.frustumCulled = false;
    this.trayPile.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.trayPile);

    // ---- fan ----
    const fg = this.fanGroup;
    fg.position.copy(L.fan);
    const target = L.cups[1].clone().setY(L.fan.y);
    fg.rotation.y = Math.atan2(target.x - L.fan.x, target.z - L.fan.z);
    fg.add(mesh(new THREE.CylinderGeometry(0.045, 0.06, L.fan.y, 8), lambert(C.charcoal), 0, -L.fan.y / 2, -0.16));
    fg.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.06, 12), lambert(C.charcoal), 0, -L.fan.y + 0.03, -0.16));
    fg.add(mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.24, 12).rotateX(Math.PI / 2), lambert(C.turquoiseDeep), 0, 0, -0.14));
    fg.add(mesh(new THREE.TorusGeometry(0.36, 0.028, 6, 24), lambert(C.cream), 0, 0, 0.02));
    fg.add(mesh(new THREE.TorusGeometry(0.2, 0.012, 4, 20), lambert(C.cream), 0, 0, 0.04));
    for (let i = 0; i < 4; i++) {
      const spoke = mesh(new THREE.BoxGeometry(0.02, 0.72, 0.02), lambert(C.cream), 0, 0, 0.04);
      spoke.rotation.z = (i / 4) * Math.PI;
      fg.add(spoke);
    }
    const bladeGeo = new THREE.BoxGeometry(0.16, 0.3, 0.025).translate(0, 0.17, 0);
    for (let i = 0; i < 3; i++) {
      const bl = mesh(bladeGeo, lambert(C.orange));
      bl.rotation.y = 0.35; // blade pitch
      const holder = new THREE.Group();
      holder.rotation.z = (i / 3) * Math.PI * 2;
      holder.add(bl);
      this.fanBlades.add(holder);
    }
    this.fanBlades.add(mesh(new THREE.IcosahedronGeometry(0.07, 1), lambert(C.butter), 0, 0, 0.02));
    fg.add(this.fanBlades);
    this.root.add(fg);

    // ---- flyers ----
    this.flyKernels = new THREE.InstancedMesh(kernelGeo, kernelMat, 16);
    this.flyKernels.count = 0;
    this.flyKernels.frustumCulled = false;
    this.flyKernels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flyCorn = new THREE.InstancedMesh(popcornGeo, popcornMat, 32);
    this.flyCorn.count = 0;
    this.flyCorn.frustumCulled = false;
    this.flyCorn.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 16; i++) this.kernelFlyers.push(newFlyer());
    for (let i = 0; i < 32; i++) this.cornFlyers.push(newFlyer());
    this.root.add(this.flyKernels, this.flyCorn);

    // ---- cups + customers ----
    this.cupTextures.red = stripeTexture('rgba(226,86,62,0.92)', 'rgba(255,214,107,0.95)');
    this.cupTextures.teal = stripeTexture('rgba(34,178,165,0.92)', 'rgba(242,138,60,0.95)');
    this.cupMat = new THREE.MeshLambertMaterial({
      map: this.cupTextures.red,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const lockMat = new THREE.MeshBasicMaterial({ color: 0x9a6b4f, transparent: true, opacity: 0.35, depthWrite: false });
    const lockGeo = new THREE.RingGeometry(0.28, 0.36, 24).rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_CUP_SLOTS; i++) {
      const pos = L.cups[i];
      const view = this.makeCup(0);
      view.g.position.copy(pos);
      const shadow = blobShadow(0.9, 0.28);
      shadow.position.set(pos.x, 0.012, pos.z);
      const lock = new THREE.Mesh(lockGeo, lockMat);
      lock.position.set(pos.x, 0.02, pos.z);
      const custs: [Customer, Customer] = [new Customer(this.makeCup(CUP_SIZE).g), new Customer(this.makeCup(CUP_SIZE).g)];
      const home = V(pos.x + L.customerDX, 0, pos.z);
      for (const c of custs) {
        c.setSlot(home);
        this.root.add(c.g);
      }
      this.root.add(view.g, shadow, lock);
      this.slots.push({ view, pos, shadow, lock, custs, cur: 0, unlocked: false, shown: true, popIn: -1, punch: 0, pendingSale: -1 });
    }
  }

  private makeCup(fill: number): CupView {
    const g = new THREE.Group();
    const contents = new THREE.InstancedMesh(popcornGeo, popcornMat, CUP_SIZE);
    contents.frustumCulled = false;
    const r = seeded(19);
    for (let i = 0; i < CUP_SIZE; i++) {
      const s = makeSlot(CUP_CONTENT[i], r, 0.85, 0.95);
      this.dummy.position.copy(s.p);
      this.dummy.quaternion.copy(s.q);
      this.dummy.scale.setScalar(s.s);
      this.dummy.updateMatrix();
      contents.setMatrixAt(i, this.dummy.matrix);
    }
    contents.count = fill;
    g.add(contents);
    g.add(new THREE.Mesh(cupBottomGeo, lambert(C.cream)));
    const body = new THREE.Mesh(cupBodyGeo, this.cupMat);
    body.renderOrder = 2;
    g.add(body);
    g.add(new THREE.Mesh(cupRimGeo, lambert(C.white)));
    return { g, contents };
  }

  // ---------------------------------------------------------------------------
  // Theme / reset
  // ---------------------------------------------------------------------------

  applyTheme(potColor: number, burnerColor: number, trayColor: number, cupStripe: 'red' | 'teal', style: CustomerStyle): void {
    this.potOuterMat.color.set(potColor);
    this.burnerMat.color.set(burnerColor);
    this.trayFront.color.set(trayColor);
    this.cupMat.map = this.cupTextures[cupStripe];
    this.cupMat.needsUpdate = true;
    this.style = style;
  }

  /** Snap every visual to the given kiosk state (used on load and kiosk switch). */
  reset(k: KioskState): void {
    for (const f of this.kernelFlyers) f.active = false;
    for (const f of this.cornFlyers) f.active = false;
    this.inflightKernels = 0;
    this.inflightPops = 0;
    this.inflightPack.fill(0);
    this.trayPunch.fill(0);
    this.potPunch.fill(0);
    this.shakeT = 10;
    this.flareT = 0;
    this.packWaitT = 0;
    this.feedFullHold = 0;
    this.trayFullHold = 0;
    const slots = cupSlotsFor(k.levels.pack);
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      s.unlocked = i < slots;
      s.shown = k.cups[i].selling < 0;
      s.popIn = -1;
      s.punch = 0;
      s.pendingSale = -1;
      s.cur = 0;
      s.custs[1].hide();
      if (s.unlocked && this.style) s.custs[0].standNow(this.style);
      else s.custs[0].hide();
    }
  }

  // ---------------------------------------------------------------------------
  // Simulation events (visible kiosk only)
  // ---------------------------------------------------------------------------

  private acquire(pool: Flyer[]): Flyer {
    let oldest: Flyer | null = null;
    for (const f of pool) {
      if (!f.active) return f;
      if (!oldest || f.t / f.dur > oldest.t / oldest.dur) oldest = f;
    }
    this.land(oldest!);
    return oldest!;
  }

  private potWorld(slot: number, out: THREE.Vector3): THREE.Vector3 {
    const s = this.potSlots[clamp(slot, 0, RAW_CAP - 1)];
    this.potGroup.updateMatrixWorld();
    return out.copy(s.p).applyMatrix4(this.potGroup.matrixWorld);
  }

  onFeed(k: KioskState): void {
    const f = this.acquire(this.kernelFlyers);
    f.active = true;
    f.kind = 'kernel';
    f.slot = clamp(k.raw - 1, 0, RAW_CAP - 1);
    f.a.copy(LAYOUT.chuteEnd).add(this.tmpV.set(rnd(-0.03, 0.03), 0, rnd(-0.03, 0.03)));
    this.potWorld(f.slot, f.b);
    f.t = 0;
    f.dur = rnd(0.4, 0.48);
    f.arc = 0;
    f.q.setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)));
    f.axis.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
    f.spin = rnd(8, 14);
    f.scale = 1.2;
    this.inflightKernels++;
    this.hopperPunch = 1;
  }

  onPop(k: KioskState): void {
    const origin = this.tmpV;
    const visible = k.raw - this.inflightKernels;
    if (visible >= 0) {
      this.potWorld(visible, origin);
    } else {
      // the popped kernel was still falling: pop it mid-air
      const f = this.oldestActive(this.kernelFlyers, 'kernel');
      if (f) {
        origin.copy(f.pos);
        f.active = false;
        this.inflightKernels--;
      } else this.potWorld(0, origin);
    }
    const f = this.acquire(this.cornFlyers);
    f.active = true;
    f.kind = 'pop';
    f.slot = clamp(k.popped - 1, 0, POP_CAP - 1);
    f.a.copy(origin);
    f.b.copy(this.traySlots[f.slot].p);
    const h = rnd(1.0, 2.3) * (k.shakeBoost > 0 ? 1.25 : 1);
    f.arc = h + Math.abs(f.a.y - f.b.y) * 0.5;
    f.t = 0;
    f.dur = 0.62 + h * 0.13 + rnd(0, 0.08);
    f.q.setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)));
    f.axis.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
    f.spin = rnd(6, 16) * (Math.random() < 0.5 ? -1 : 1);
    f.scale = rnd(0.92, 1.1);
    this.inflightPops++;

    const boosted = k.shakeBoost > 0;
    this.particles.burst(origin, {
      count: boosted ? 7 : 4,
      color: boosted ? [0xfffaf0, C.butter, C.orange, C.turquoise] : [0xfffaf0, 0xfff1d0, 0xf6b93b],
      speed: [0.6, 1.6],
      up: [1.2, 2.8],
      size: [0.035, 0.065],
      life: [0.3, 0.55],
      grav: 7,
    });
    this.potPunchAll = Math.min(1, this.potPunchAll + 0.35);
  }

  onPack(k: KioskState, cup: number): void {
    const origin = this.tmpV;
    const visible = k.popped - this.inflightPops;
    let fromAir: Flyer | null = null;
    if (visible >= 0) origin.copy(this.traySlots[clamp(visible, 0, POP_CAP - 1)].p);
    else {
      fromAir = this.oldestActive(this.cornFlyers, 'pop');
      if (fromAir) origin.copy(fromAir.pos);
      else origin.copy(this.traySlots[0].p);
    }
    let f: Flyer;
    if (fromAir) {
      // retarget the piece that is still flying from the pot
      f = fromAir;
      this.inflightPops--;
    } else f = this.acquire(this.cornFlyers);
    const fill = k.cups[cup].selling >= 0 ? CUP_SIZE : k.cups[cup].fill;
    f.active = true;
    f.kind = 'pack';
    f.cup = cup;
    f.a.copy(origin);
    f.b.copy(CUP_CONTENT[clamp(fill - 1, 0, CUP_SIZE - 1)]).add(this.slots[cup].pos);
    f.t = 0;
    f.dur = clamp(0.5 / Math.sqrt(speedFactor(k.levels.pack)), 0.2, 0.38);
    f.arc = 0.55;
    f.axis.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
    f.spin = rnd(5, 10);
    this.inflightPack[cup]++;
    if (!fromAir)
      this.particles.burst(origin, { count: 2, color: 0xfffaf0, speed: [0.3, 0.8], up: [0.5, 1.2], size: [0.03, 0.05], life: [0.25, 0.4] });
  }

  onSale(_k: KioskState, cup: number): void {
    const s = this.slots[cup];
    if (s.pendingSale >= 0) this.startGrab(cup);
    s.pendingSale = 0;
    this.particles.burst(this.cupTop(cup, this.tmpV), {
      count: 10,
      color: [C.butter, C.butterDeep, 0xfff1b0],
      speed: [1, 2.4],
      up: [2.5, 4.2],
      size: [0.05, 0.09],
      life: [0.5, 0.9],
      grav: 10,
      flat: true,
    });
  }

  onCupReady(_k: KioskState, cup: number): void {
    const s = this.slots[cup];
    if (s.pendingSale >= 0) this.startGrab(cup);
    s.shown = true;
    s.popIn = 0;
  }

  private startGrab(cup: number): void {
    const s = this.slots[cup];
    s.pendingSale = -1;
    s.shown = false;
    const a = s.custs[s.cur];
    const b = s.custs[1 - s.cur];
    a.grab(s.pos);
    if (this.style) b.arrive(this.style);
    s.cur = s.cur === 0 ? 1 : 0;
  }

  shake(): void {
    this.shakeT = 0;
    this.flareT = 1;
    for (let i = 0; i < RAW_CAP; i++) this.potPunch[i] = rnd(0.6, 1);
    const top = V(LAYOUT.pot.x, LAYOUT.potY + 0.8, LAYOUT.pot.z);
    this.particles.burst(top, { count: 12, color: [C.butter, C.orange, 0xfffaf0, C.turquoise], speed: [1.5, 3], up: [2, 4], size: [0.04, 0.08], life: [0.4, 0.8] });
  }

  upgradeFx(kind: UpgradeKind): void {
    const colors = [C.turquoise, C.butter, 0xffffff, C.orange];
    let at: THREE.Vector3;
    if (kind === 'feed') {
      at = LAYOUT.funnel.clone().setY(LAYOUT.funnel.y + 0.9);
      this.hopperPunch = 2.2;
    } else if (kind === 'heat') {
      at = V(LAYOUT.pot.x, LAYOUT.burnerH + 0.2, LAYOUT.pot.z);
      this.flareT = 1.2;
    } else {
      at = LAYOUT.fan.clone();
      for (const s of this.slots) if (s.unlocked) s.punch = 1;
    }
    this.particles.burst(at, { count: 18, color: colors, speed: [1.5, 3.2], up: [1.5, 3.5], size: [0.05, 0.09], life: [0.5, 0.9], grav: 6 });
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  cupTop(cup: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.slots[cup].pos).setY(1.1);
  }

  anchor(name: 'hopper' | 'pot' | 'tray' | 'fan', out: THREE.Vector3): THREE.Vector3 {
    const L = LAYOUT;
    switch (name) {
      case 'hopper':
        return out.copy(L.funnel).setY(L.funnel.y + 1.25);
      case 'pot':
        return out.set(L.pot.x, L.potY + 1.3, L.pot.z);
      case 'tray':
        return out.set((L.tray.x0 + L.tray.x1) / 2, L.tray.y + 1.05, (L.tray.z0 + L.tray.z1) / 2);
      case 'fan':
        // "waiting for cup" sits at the tray outlet, next to the cups
        return out.set(L.tray.x1 - 0.25, L.tray.y + 0.75, L.tray.z1 - 0.1);
    }
  }

  lockAnchor(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.slots[i].pos).setY(0.35);
  }

  isSlotUnlocked(i: number): boolean {
    return this.slots[i].unlocked;
  }

  getStatus(): MachineStatus {
    return this.status;
  }

  /** Points that must stay inside the camera frustum. */
  focusPoints(): THREE.Vector3[] {
    const L = LAYOUT;
    const pts: THREE.Vector3[] = [
      V(L.funnel.x - 0.7, L.funnel.y + 1.05, L.funnel.z),
      V(L.funnel.x + 0.7, L.funnel.y + 1.05, L.funnel.z),
      V(L.hopperPole.x, 0, L.hopperPole.z),
      V(L.pot.x - 1.1, 0, L.pot.z),
      V(L.pot.x, 0, L.pot.z + 1.05),
      V(L.pot.x - 1.1, L.potY + 0.8, L.pot.z),
      V(L.pot.x, L.potY + 2.4, L.pot.z), // pop apex
    ];
    // customers: include their full body width as seen by the camera
    const right = V(Math.cos(0.56), 0, -Math.sin(0.56)).multiplyScalar(0.42);
    for (const c of L.cups) {
      const home = V(c.x + L.customerDX, 0, c.z);
      pts.push(V(c.x, 0, c.z + 0.5), home.clone().add(right), home.clone().add(right).setY(1.5), home.clone().setY(1.7));
    }
    return pts;
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  private oldestActive(pool: Flyer[], kind: FlyKind): Flyer | null {
    let best: Flyer | null = null;
    for (const f of pool) if (f.active && f.kind === kind && (!best || f.t / f.dur > best.t / best.dur)) best = f;
    return best;
  }

  private land(f: Flyer): void {
    if (!f.active) return;
    f.active = false;
    if (f.kind === 'kernel') {
      this.inflightKernels = Math.max(0, this.inflightKernels - 1);
      this.potPunch[f.slot] = 0.5;
      this.hooks.kernelLand();
    } else if (f.kind === 'pop') {
      this.inflightPops = Math.max(0, this.inflightPops - 1);
      this.trayPunch[f.slot] = 1;
    } else {
      this.inflightPack[f.cup] = Math.max(0, this.inflightPack[f.cup] - 1);
      const s = this.slots[f.cup];
      s.punch = Math.max(s.punch, 0.6);
      s.custs[s.cur].bounce(0.6);
    }
  }

  private updateFlyers(pool: Flyer[], im: THREE.InstancedMesh, dt: number): void {
    const d = this.dummy;
    let n = 0;
    for (const f of pool) {
      if (!f.active) continue;
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      if (f.kind === 'kernel') {
        f.pos.set(THREE.MathUtils.lerp(f.a.x, f.b.x, u), THREE.MathUtils.lerp(f.a.y, f.b.y, u * u), THREE.MathUtils.lerp(f.a.z, f.b.z, u));
      } else {
        f.pos.lerpVectors(f.a, f.b, u);
        f.pos.y += f.arc * 4 * u * (1 - u);
      }
      this.tmpQ.setFromAxisAngle(f.axis, f.spin * dt);
      f.q.premultiply(this.tmpQ);
      let s = f.scale;
      if (f.kind === 'pop') {
        const age = f.t;
        // kernel-size -> overshoot -> settle: the actual "pop"
        s *= age < 0.07 ? THREE.MathUtils.lerp(0.3, 1.4, age / 0.07) : age < 0.26 ? THREE.MathUtils.lerp(1.4, 1, (age - 0.07) / 0.19) : 1;
      } else if (f.kind === 'pack') s *= THREE.MathUtils.lerp(1, 0.9, u);
      d.position.copy(f.pos);
      d.quaternion.copy(f.q);
      d.scale.setScalar(s);
      d.updateMatrix();
      im.setMatrixAt(n++, d.matrix);
      if (u >= 1) this.land(f);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, k: KioskState): void {
    this.time += dt;
    const t = this.time;
    const L = LAYOUT;
    const d = this.dummy;
    const heatLv = k.levels.heat;
    const boosted = k.shakeBoost > 0;

    this.updateFlyers(this.kernelFlyers, this.flyKernels, dt);
    this.updateFlyers(this.cornFlyers, this.flyCorn, dt);

    // ---- status (what is blocked right now) ----
    const slotsOpen = cupSlotsFor(k.levels.pack);
    let anyFilling = false;
    for (let i = 0; i < slotsOpen; i++) if (k.cups[i].selling < 0) anyFilling = true;
    const packWaitingNow = k.popped > 0 && !anyFilling;
    this.packWaitT = packWaitingNow ? this.packWaitT + dt : 0;
    // A stage that keeps hitting its cap only sits exactly at the cap for a
    // moment each cycle; keep the warning up for a short while so it reads.
    this.feedFullHold = k.raw >= RAW_CAP ? 1.5 : Math.max(0, this.feedFullHold - dt);
    this.trayFullHold = k.popped >= POP_CAP && k.raw > 0 ? 1.8 : Math.max(0, this.trayFullHold - dt);
    this.status = {
      feedBlocked: this.feedFullHold > 0,
      popBlocked: this.trayFullHold > 0,
      packWaiting: this.packWaitT > 0.35,
      noKernels: k.raw === 0,
    };

    // ---- pot wobble (shake) ----
    this.shakeT += dt;
    const sk = Math.max(0, 1 - this.shakeT / 0.7);
    this.potPunchAll = Math.max(0, this.potPunchAll - dt * 4);
    const pg = this.potGroup;
    pg.rotation.z = Math.sin(this.shakeT * 42) * 0.13 * sk * sk;
    pg.rotation.x = Math.cos(this.shakeT * 35) * 0.09 * sk * sk;
    pg.position.x = L.pot.x + Math.sin(this.shakeT * 50) * 0.08 * sk;
    const pp = 1 + this.potPunchAll * 0.035;
    pg.scale.set(pp, 1 - this.potPunchAll * 0.02, pp);

    // ---- pot kernels ----
    const visRaw = clamp(k.raw - this.inflightKernels, 0, RAW_CAP);
    const cooking = k.raw > 0 && k.popped < POP_CAP;
    const jitterAmp = cooking ? 0.02 + Math.min(heatLv, 15) * 0.004 : 0.004;
    const freq = 16 + Math.min(heatLv, 20) * 1.5;
    for (let i = 0; i < visRaw; i++) {
      const s = this.potSlots[i];
      this.potPunch[i] = Math.max(0, this.potPunch[i] - dt * 2.2);
      const hop = Math.max(0, Math.sin(t * freq + s.phase * 3)) * jitterAmp + this.potPunch[i] * this.potPunch[i] * 0.45;
      d.position.set(s.p.x, s.p.y + hop, s.p.z);
      d.quaternion.copy(s.q);
      if (cooking) {
        this.tmpQ.setFromAxisAngle(this.tmpV.set(0, 1, 0), Math.sin(t * 7 + s.phase) * 0.3);
        d.quaternion.multiply(this.tmpQ);
      }
      d.scale.setScalar(s.s);
      d.updateMatrix();
      this.potKernels.setMatrixAt(i, d.matrix);
    }
    this.potKernels.count = visRaw;
    this.potKernels.instanceMatrix.needsUpdate = true;

    // ---- flames / heat ----
    this.flareT = Math.max(0, this.flareT - dt * 1.5);
    const targetFlame = cooking ? 0.55 + Math.min(heatLv, 14) * 0.065 : 0.28;
    this.flameLevel += (targetFlame - this.flameLevel) * Math.min(1, dt * 4);
    const flameCount = Math.min(12, 4 + heatLv);
    const flick = 12 + Math.min(heatLv, 20) * 1.2;
    const flare = 1 + this.flareT * 0.6 + (boosted ? 0.35 : 0);
    for (let i = 0; i < 12; i++) {
      const on = i < flameCount;
      const f = this.flames[i];
      const fi = this.flamesInner[i];
      const a = (i / flameCount) * Math.PI * 2; // spread visible flames evenly
      f.visible = fi.visible = on;
      if (!on) continue;
      f.position.x = fi.position.x = Math.cos(a) * FLAME_R;
      f.position.z = fi.position.z = Math.sin(a) * FLAME_R;
      // lean outward so the tips lick up the sides of the pot
      f.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
      fi.rotation.copy(f.rotation);
      const n = Math.sin(t * flick + i * 1.7) * 0.5 + Math.sin(t * flick * 1.9 + i * 3.1) * 0.3;
      const h = this.flameLevel * flare * (1 + n * 0.22);
      f.scale.set(1, h, 1);
      fi.scale.set(0.55, h * 0.6, 0.55);
    }
    this.glowMat.emissiveIntensity = 0.25 + this.flameLevel * 0.5 + this.flareT * 0.4;
    this.knob.rotation.z = -Math.min(heatLv - 1, 12) * 0.2;

    // ---- hopper ----
    const feedSpeed = speedFactor(k.levels.feed);
    const feeding = k.raw < RAW_CAP;
    const targetAg = feeding ? 2.2 * feedSpeed : 0;
    this.agitatorSpeed += (targetAg - this.agitatorSpeed) * Math.min(1, dt * 3);
    this.agitator.rotation.y += this.agitatorSpeed * dt;
    this.hopperPunch = Math.max(0, this.hopperPunch - dt * 5);
    const hpk = this.hopperPunch;
    this.funnel.scale.set(1 + hpk * 0.05, 1 - hpk * 0.06, 1 + hpk * 0.05);
    this.funnel.rotation.z = Math.sin(t * 30) * hpk * 0.03 + (feeding ? Math.sin(t * 5 * feedSpeed) * 0.012 : 0);
    const hk = Math.min(30, 8 + (k.levels.feed - 1) * 3);
    for (let i = 0; i < hk; i++) {
      const s = this.hopperSlots[i];
      const jig = feeding ? Math.max(0, Math.sin(t * 9 * feedSpeed + s.phase * 4)) * 0.015 : 0;
      d.position.set(s.p.x, s.p.y + jig + hpk * 0.02, s.p.z);
      d.quaternion.copy(s.q);
      d.scale.setScalar(s.s);
      d.updateMatrix();
      this.hopperKernels.setMatrixAt(i, d.matrix);
    }
    this.hopperKernels.count = hk;
    this.hopperKernels.instanceMatrix.needsUpdate = true;

    // ---- tray pile ----
    const visPop = clamp(k.popped - this.inflightPops, 0, POP_CAP);
    for (let i = 0; i < visPop; i++) {
      const s = this.traySlots[i];
      this.trayPunch[i] = Math.max(0, this.trayPunch[i] - dt * 4);
      const p = this.trayPunch[i];
      d.position.copy(s.p);
      d.position.y += p * 0.06;
      d.quaternion.copy(s.q);
      d.scale.set(s.s * (1 + p * 0.25), s.s * (1 - p * 0.2), s.s * (1 + p * 0.25));
      d.updateMatrix();
      this.trayPile.setMatrixAt(i, d.matrix);
    }
    this.trayPile.count = visPop;
    this.trayPile.instanceMatrix.needsUpdate = true;

    // ---- fan ----
    const packing = k.popped > 0 && anyFilling;
    const targetFan = packing ? 7 + 9 * speedFactor(k.levels.pack) : 0;
    this.fanSpeed += (targetFan - this.fanSpeed) * Math.min(1, dt * (packing ? 4 : 2));
    this.fanAngle += Math.min(this.fanSpeed, 42) * dt;
    this.fanBlades.rotation.z = this.fanAngle;

    // ---- cups & customers ----
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const unlocked = i < slotsOpen;
      if (unlocked && !s.unlocked) {
        // newly unlocked by a PACK upgrade
        s.unlocked = true;
        s.shown = true;
        s.popIn = 0;
        s.pendingSale = -1;
        if (this.style) s.custs[s.cur].arrive(this.style);
        this.particles.burst(this.cupTop(i, this.tmpV), { count: 24, color: [C.turquoise, C.butter, 0xffffff, C.orange], speed: [1.5, 3], up: [2, 4], size: [0.05, 0.1], life: [0.6, 1.1] });
      } else if (!unlocked && s.unlocked) {
        s.unlocked = false;
        s.custs[0].hide();
        s.custs[1].hide();
      }
      s.lock.visible = !s.unlocked;
      s.shadow.visible = s.unlocked;

      if (s.pendingSale >= 0) {
        s.pendingSale += dt;
        if (this.inflightPack[i] === 0 || s.pendingSale > 0.45) this.startGrab(i);
      }

      const v = s.view;
      v.g.visible = s.unlocked && s.shown;
      if (v.g.visible) {
        let sc = 1;
        if (s.popIn >= 0) {
          s.popIn += dt;
          const u = Math.min(1, s.popIn / 0.35);
          sc = u < 1 ? 1 - Math.cos(u * Math.PI * 2.5) * (1 - u) * 0.6 : 1;
          sc *= Math.min(1, u * 3 + 0.1);
          if (u >= 1) s.popIn = -1;
        }
        s.punch = Math.max(0, s.punch - dt * 4);
        const p = s.punch;
        v.g.scale.set(sc * (1 + p * 0.1), sc * (1 - p * 0.08), sc * (1 + p * 0.1));
        const cup = k.cups[i];
        const fill = cup.selling >= 0 ? CUP_SIZE : cup.fill;
        v.contents.count = clamp(fill - this.inflightPack[i], 0, CUP_SIZE);
      }
      for (const c of s.custs) c.update(dt, t);
    }
  }
}
