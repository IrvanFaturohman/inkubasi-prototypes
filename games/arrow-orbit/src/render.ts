// Three.js view of the sim. Side-on 2.5D: physics lives on z = 0, camera looks down -Z.
// Every visual comes from a flight-archery range: distance boards, a bow on a stand,
// wooden crates that splinter, a dotted flight line like a trajectory chart.
import * as THREE from 'three';
import { Course } from './course';
import { Sim } from './sim';
import {
  LAUNCH_ANGLE_DEG, LAUNCH_TAIL, SEG_LEN, CRATE_SIZE, BARREL_RADIUS, BARREL_HALF_H, COURSE_LENGTH, RAMP_H, PAD_H,
} from './config';

const DIR = { x: Math.cos((LAUNCH_ANGLE_DEG * Math.PI) / 180), y: Math.sin((LAUNCH_ANGLE_DEG * Math.PI) / 180) };
const NRM = { x: -DIR.y, y: DIR.x };
const RISER = { x: LAUNCH_TAIL.x + DIR.x * 1.35, y: LAUNCH_TAIL.y + DIR.y * 1.35 };

const easeOutElastic = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const crateTex = () =>
  canvasTex(128, 128, (g) => {
    g.fillStyle = '#f4e6cc';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#a07a50';
    g.lineWidth = 3;
    for (let y = 32; y < 128; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(128, y);
      g.stroke();
    }
    g.strokeStyle = '#6b4a2b';
    g.lineWidth = 14;
    g.strokeRect(7, 7, 114, 114);
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(12, 116);
    g.lineTo(116, 12);
    g.stroke();
    g.fillStyle = '#3d2a18';
    for (const [x, y] of [[14, 14], [114, 14], [14, 114], [114, 114]]) {
      g.beginPath();
      g.arc(x, y, 3.5, 0, 6.3);
      g.fill();
    }
  });

const barrelTex = () =>
  canvasTex(128, 128, (g) => {
    g.fillStyle = '#f1e2c6';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#9b7550';
    g.lineWidth = 2;
    for (let x = 0; x < 128; x += 16) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 128);
      g.stroke();
    }
    g.fillStyle = '#4a4a52';
    g.fillRect(0, 18, 128, 10);
    g.fillRect(0, 100, 128, 10);
  });

const boardTex = (label: string) =>
  canvasTex(256, 160, (g) => {
    g.fillStyle = '#fbf8ef';
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = '#22242c';
    g.lineWidth = 10;
    g.strokeRect(5, 5, 246, 150);
    g.fillStyle = '#22242c';
    g.font = 'bold 92px "Arial Narrow", "Roboto Condensed", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 128, 76);
  });

interface Particle {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  r: number; vr: number; sx: number; sy: number; sz: number; life: number; max: number; grav: number; shrink: boolean;
}

export interface ViewState {
  phase: 'aim' | 'windup' | 'flight' | 'result';
  pull: number; // how far the arrow is drawn back, metres
  release: number; // seconds since release, for the string snap
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 9 / 16, 0.5, 900);
  private course: Course;
  private sim: Sim | null = null;
  private crateMesh!: THREE.InstancedMesh;
  private barrelMesh!: THREE.InstancedMesh;
  private instOf: { mesh: THREE.InstancedMesh; i: number }[] = [];
  private segs: THREE.Group[] = [];
  private arrowRoot = new THREE.Group();
  private headScale = { t: 1, a: 0 };
  private pads = new Map<number, { mat: THREE.Mesh; t: number }>();
  private bowGroup = new THREE.Group();
  private limbs: THREE.Mesh[] = [];
  private stringLine!: THREE.Line;
  private limbMat = new THREE.MeshLambertMaterial({ color: 0x3a2a22 });
  private parts: Particle[] = [];
  private partMesh!: THREE.InstancedMesh;
  private trail!: THREE.Points;
  private trailN = 0;
  private trailLast = { x: -1e9, y: 0 };
  private bestFlag = new THREE.Group();
  private cam = { x: 6, y: 6.5, z: 27 };
  private trauma = 0;
  private shakeT = 0;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(canvas: HTMLCanvasElement, course: Course) {
    this.course = course;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.Fog(0xe9e3cf, 140, 520);
    this.scene.add(new THREE.HemisphereLight(0xfff6e0, 0x6d7f4a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-20, 40, 30);
    this.scene.add(sun);
    this.buildWorld();
    this.buildBow();
    this.buildParticles();
    this.scene.add(this.arrowRoot);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- static world ----------
  private buildWorld(): void {
    const pts = this.course.pts;
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const push = (x: number, y: number, z: number, hex: number) => {
      pos.push(x, y, z);
      c.setHex(hex);
      c.convertSRGBToLinear();
      col.push(c.r, c.g, c.b);
    };
    // a, b = lower edge (colour lo), cc, d = upper edge (colour hi): vertical gradients only
    const quad = (a: number[], b: number[], cc: number[], d: number[], lo: number, hi: number) => {
      push(a[0], a[1], a[2], lo); push(b[0], b[1], b[2], lo); push(cc[0], cc[1], cc[2], hi);
      push(a[0], a[1], a[2], lo); push(cc[0], cc[1], cc[2], hi); push(d[0], d[1], d[2], hi);
    };
    const ZF = 3;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const stripe = Math.floor(p.x / 10) % 2 === 0;
      // top (grass, mown stripes like a range)
      const g1 = stripe ? 0x86b84e : 0x7aad45;
      quad([p.x, p.y, ZF], [q.x, q.y, ZF], [q.x, q.y, -ZF], [p.x, p.y, -ZF], g1, g1);
      // front face: grass lip, then soil getting darker
      quad([p.x, p.y - 0.45, ZF], [q.x, q.y - 0.45, ZF], [q.x, q.y, ZF], [p.x, p.y, ZF], 0x5f8f37, 0x5f8f37);
      quad([p.x, p.y - 4, ZF], [q.x, q.y - 4, ZF], [q.x, q.y - 0.45, ZF], [p.x, p.y - 0.45, ZF], 0xa8794a, 0xb98a56);
      quad([p.x, p.y - 60, ZF], [q.x, q.y - 60, ZF], [q.x, q.y - 4, ZF], [p.x, p.y - 4, ZF], 0x6e4c33, 0xa8794a);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));

    // far hills, three layers that follow the course trend
    const layers: [number, number, number, number][] = [
      [-45, 0xa4c98c, 9, 0.6],
      [-100, 0xbfd8b2, 18, 0.4],
      [-180, 0xd6e3cd, 30, 0.25],
    ];
    for (const [z, hex, amp, follow] of layers) {
      const hp: number[] = [];
      const step = 12;
      for (let x = -200; x < COURSE_LENGTH + 600; x += step) {
        const y0 = this.course.groundY(x) * follow + amp * (0.6 + 0.4 * Math.sin(x / (40 + amp * 3)) + 0.25 * Math.sin(x / 13 + z));
        const y1 = this.course.groundY(x + step) * follow + amp * (0.6 + 0.4 * Math.sin((x + step) / (40 + amp * 3)) + 0.25 * Math.sin((x + step) / 13 + z));
        hp.push(x, y0, z, x, -400, z, x + step, -400, z, x, y0, z, x + step, -400, z, x + step, y1, z);
      }
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
      hg.computeVertexNormals();
      this.scene.add(new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: hex, fog: true })));
    }

    // clouds
    const cloudGeo = new THREE.IcosahedronGeometry(1, 0);
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x666666, flatShading: true });
    for (let x = -60; x < COURSE_LENGTH + 300; x += 38 + ((x * 7919) % 23)) {
      const g = new THREE.Group();
      const n = 3 + (Math.abs(Math.floor(x)) % 3);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(cloudGeo, cloudMat);
        const s = 3 + ((k * 37 + x) % 3);
        m.scale.set(s * 1.4, s * 0.8, s);
        m.position.set(k * 3.2 - n * 1.6, (k % 2) * 1.2, 0);
        g.add(m);
      }
      g.position.set(x, this.course.groundY(x) * 0.5 + 28 + ((x * 13) % 30), -110);
      this.scene.add(g);
    }

    // distance boards every 50 m
    const post = new THREE.BoxGeometry(0.18, 2.6, 0.18);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x5b4632 });
    const boardGeo = new THREE.PlaneGeometry(2.1, 1.3);
    for (let d = 50; d <= COURSE_LENGTH; d += 50) {
      const gy = this.course.groundY(d);
      const p = new THREE.Mesh(post, postMat);
      p.position.set(d, gy + 1.3, -1.6);
      const b = new THREE.Mesh(boardGeo, new THREE.MeshLambertMaterial({ map: boardTex(String(d)) }));
      b.position.set(d, gy + 2.6, -1.5);
      this.scene.add(p, b);
    }

    // stacks
    const crates = this.course.features.filter((f) => f.type === 'crates').reduce((a, f) => a + f.cells.length, 0);
    const barrels = this.course.features.filter((f) => f.type === 'barrels').reduce((a, f) => a + f.cells.length, 0);
    this.crateMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE),
      new THREE.MeshLambertMaterial({ map: crateTex() }),
      Math.max(1, crates),
    );
    this.barrelMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(BARREL_RADIUS, BARREL_RADIUS, BARREL_HALF_H * 2, 14),
      new THREE.MeshLambertMaterial({ map: barrelTex() }),
      Math.max(1, barrels),
    );
    for (const m of [this.crateMesh, this.barrelMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.scene.add(m);
    }

    // pads (trampolines) and ramps (plank kickers)
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x2f3440 });
    const matMat = new THREE.MeshLambertMaterial({ color: 0xe0487a });
    const rampMat = new THREE.MeshLambertMaterial({ map: crateTex(), color: 0xf2b632 });
    for (const f of this.course.features) {
      if (f.type === 'pad') {
        const g = new THREE.Group();
        const sh = new THREE.Shape();
        sh.moveTo(-2.6, -0.2);
        sh.lineTo(2.6, -0.2);
        sh.lineTo(1.6, PAD_H);
        sh.lineTo(-1.6, PAD_H);
        sh.closePath();
        const fg = new THREE.ExtrudeGeometry(sh, { depth: 2.6, bevelEnabled: false });
        fg.translate(0, 0, -1.3);
        const frame = new THREE.Mesh(fg, frameMat);
        const mat = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 2.2), matMat);
        mat.position.y = PAD_H + 0.04;
        g.add(frame, mat);
        g.position.set(f.x, f.y, 0);
        this.scene.add(g);
        this.pads.set(f.id, { mat, t: 1 });
      } else if (f.type === 'ramp') {
        const s = new THREE.Shape();
        s.moveTo(-0.5, -0.6);
        s.lineTo(7.2, -0.6);
        s.lineTo(7.2, RAMP_H);
        s.lineTo(-0.5, 0);
        s.closePath();
        const geo = new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: false });
        geo.translate(0, 0, -2);
        const uv = geo.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
        const m = new THREE.Mesh(geo, rampMat);
        m.position.set(f.x, f.y, 0);
        this.scene.add(m);
      }
    }

    // best-distance flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6), postMat);
    pole.position.y = 2.1;
    const pen = new THREE.Shape();
    pen.moveTo(0, 0);
    pen.lineTo(1.6, -0.45);
    pen.lineTo(0, -0.9);
    pen.closePath();
    const flag = new THREE.Mesh(new THREE.ShapeGeometry(pen), new THREE.MeshLambertMaterial({ color: 0xc8432b, side: THREE.DoubleSide }));
    flag.position.set(0.05, 4.1, 0);
    this.bestFlag.add(pole, flag);
    this.bestFlag.visible = false;
    this.scene.add(this.bestFlag);

    // dotted flight line
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 3000), 3));
    tg.setDrawRange(0, 0);
    this.trail = new THREE.Points(tg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.32, sizeAttenuation: true, fog: false }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
  }

  private buildBow(): void {
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.22, RISER.y, 0.22), wood);
    stand.position.set(RISER.x, RISER.y / 2 - 0.2, -0.4);
    const legA = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), wood);
    legA.position.set(RISER.x - 0.6, 0.9, -0.4);
    legA.rotation.z = -0.5;
    const legB = legA.clone();
    legB.position.x = RISER.x + 0.6;
    legB.rotation.z = 0.5;
    const riser = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.1, 0.3), new THREE.MeshLambertMaterial({ color: 0x2b2f3a }));
    riser.position.set(RISER.x, RISER.y, 0);
    riser.rotation.z = Math.atan2(NRM.y, NRM.x) - Math.PI / 2;
    this.bowGroup.add(stand, legA, legB, riser);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    this.stringLine = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xf6f1e4 }));
    this.stringLine.frustumCulled = false;
    this.bowGroup.add(this.stringLine);
    this.scene.add(this.bowGroup);
    this.updateBow(0.4);
  }

  /** Limbs bend with the draw: the timing gauge and the bow move together. */
  private lastPull = NaN;
  private updateBow(pull: number): void {
    if (Math.abs(pull - this.lastPull) < 0.002) return;
    this.lastPull = pull;
    for (const l of this.limbs) {
      this.bowGroup.remove(l);
      l.geometry.dispose();
    }
    this.limbs = [];
    const tips: THREE.Vector3[] = [];
    for (const sgn of [1, -1]) {
      const base = new THREE.Vector3(RISER.x + NRM.x * 0.5 * sgn, RISER.y + NRM.y * 0.5 * sgn, 0);
      const span = 2.1 - 0.22 * pull;
      const back = 0.5 + 0.38 * pull;
      const tip = new THREE.Vector3(RISER.x + NRM.x * span * sgn - DIR.x * back, RISER.y + NRM.y * span * sgn - DIR.y * back, 0);
      const ctrl = new THREE.Vector3(RISER.x + NRM.x * 1.45 * sgn + DIR.x * 0.35, RISER.y + NRM.y * 1.45 * sgn + DIR.y * 0.35, 0);
      const curve = new THREE.QuadraticBezierCurve3(base, ctrl, tip);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.075, 5, false), this.limbMat);
      this.limbs.push(m);
      this.bowGroup.add(m);
      tips.push(tip);
    }
    const nock = { x: LAUNCH_TAIL.x - DIR.x * pull, y: LAUNCH_TAIL.y - DIR.y * pull };
    const a = this.stringLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    a.setXYZ(0, tips[0].x, tips[0].y, 0);
    a.setXYZ(1, nock.x, nock.y, 0.02);
    a.setXYZ(2, tips[1].x, tips[1].y, 0);
    a.needsUpdate = true;
  }

  // ---------- per-run binding ----------
  attach(sim: Sim): void {
    this.sim = sim;
    // instance mapping, stable across runs because the course is the same
    this.instOf = [];
    let ci = 0;
    let bi = 0;
    const col = new THREE.Color();
    for (const o of sim.objs) {
      const mesh = o.kind === 'crate' ? this.crateMesh : this.barrelMesh;
      const i = o.kind === 'crate' ? ci++ : bi++;
      col.setHex(o.color);
      mesh.setColorAt(i, col);
      this.instOf.push({ mesh, i });
    }
    for (const m of [this.crateMesh, this.barrelMesh]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.syncStacks(true);
    this.buildArrow(sim.nSeg);
    this.trailN = 0;
    this.trailLast = { x: -1e9, y: 0 };
    this.trail.geometry.setDrawRange(0, 0);
    for (const p of this.pads.values()) p.t = 1;
  }

  private buildArrow(n: number): void {
    for (const s of this.segs) this.arrowRoot.remove(s);
    this.segs = [];
    const shaftMat = new THREE.MeshLambertMaterial({ color: 0xc89a5c });
    const brass = new THREE.MeshLambertMaterial({ color: 0xd8a93a });
    const steel = new THREE.MeshLambertMaterial({ color: 0xc9d1d9, flatShading: true });
    const vaneMat = new THREE.MeshLambertMaterial({ color: 0xc8432b, side: THREE.DoubleSide });
    const vaneMat2 = new THREE.MeshLambertMaterial({ color: 0xf6f1e4, side: THREE.DoubleSide });
    const shaft = new THREE.CylinderGeometry(0.085, 0.085, SEG_LEN * 0.98, 8).rotateZ(-Math.PI / 2);
    const ferrule = new THREE.CylinderGeometry(0.12, 0.12, 0.16, 8).rotateZ(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(shaft, shaftMat));
      if (i < n - 1) {
        const f = new THREE.Mesh(ferrule, brass);
        f.position.x = -SEG_LEN / 2;
        g.add(f);
      }
      if (i === 0) {
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4), steel);
        head.position.x = SEG_LEN / 2 + 0.15;
        head.name = 'head';
        g.add(head);
      }
      if (i === n - 1) {
        const vs = new THREE.Shape();
        vs.moveTo(0, 0);
        vs.lineTo(-0.75, 0);
        vs.lineTo(-0.62, 0.38);
        vs.lineTo(-0.18, 0.1);
        vs.closePath();
        const vg = new THREE.ShapeGeometry(vs);
        const top = new THREE.Mesh(vg, vaneMat);
        top.position.set(-SEG_LEN / 2 + 0.75, 0.06, 0);
        const bot = new THREE.Mesh(vg, vaneMat2);
        bot.scale.y = -1;
        bot.position.set(-SEG_LEN / 2 + 0.75, -0.06, 0);
        const nock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.16), vaneMat);
        nock.position.x = -SEG_LEN / 2 - 0.02;
        g.add(top, bot, nock);
      }
      this.segs.push(g);
      this.arrowRoot.add(g);
    }
  }

  private syncStacks(all: boolean): void {
    const sim = this.sim;
    if (!sim) return;
    let dirty = false;
    for (let k = 0; k < sim.objs.length; k++) {
      const o = sim.objs[k];
      const { mesh, i } = this.instOf[k];
      if (!o.alive) {
        this.tmpM.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, this.tmpM);
        dirty = true;
        continue;
      }
      if (!all && o.body.isSleeping()) continue;
      const p = o.body.translation();
      const r = o.body.rotation();
      this.tmpV.set(p.x, p.y, 0);
      this.tmpQ.set(r.x, r.y, r.z, r.w);
      this.tmpS.set(1, 1, 1);
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
      mesh.setMatrixAt(i, this.tmpM);
      dirty = true;
    }
    if (dirty) {
      this.crateMesh.instanceMatrix.needsUpdate = true;
      this.barrelMesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- juice ----------
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  squashHead(): void {
    this.headScale = { t: 0, a: 1 };
  }

  padHit(id: number): void {
    const p = this.pads.get(id);
    if (p) p.t = 0;
  }

  setBest(x: number): void {
    this.bestFlag.visible = x > 0;
    this.bestFlag.position.set(x, this.course.groundY(x), -0.8);
  }

  private buildParticles(): void {
    this.partMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), 420);
    this.partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.partMesh.frustumCulled = false;
    this.partMesh.count = 0;
    this.scene.add(this.partMesh);
  }

  /** Splinters in the material's own colour (long thin slivers, not round blobs). */
  splinters(x: number, y: number, color: number, n: number, power: number): void {
    const c = new THREE.Color(color);
    for (let k = 0; k < n && this.parts.length < 420; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (3 + Math.random() * 7) * power;
      const len = 0.25 + Math.random() * 0.45;
      this.parts.push({
        x, y, z: (Math.random() - 0.5) * 0.8, vx: Math.cos(a) * sp + power * 2, vy: Math.abs(Math.sin(a)) * sp + 2, vz: (Math.random() - 0.5) * 6,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 24, sx: len, sy: 0.07, sz: 0.07, life: 0, max: 0.7 + Math.random() * 0.5, grav: 30, shrink: false,
      });
      this.partMesh.setColorAt(this.parts.length - 1, c.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15));
    }
    if (this.partMesh.instanceColor) this.partMesh.instanceColor.needsUpdate = true;
  }

  /** Clods of turf kicked up where the arrow hits the ground. */
  turf(x: number, y: number, power: number): void {
    const n = Math.min(18, 4 + Math.floor(power * 6));
    const c = new THREE.Color();
    for (let k = 0; k < n && this.parts.length < 420; k++) {
      const s = 0.12 + Math.random() * 0.22;
      this.parts.push({
        x: x + (Math.random() - 0.5), y, z: (Math.random() - 0.5) * 1.5, vx: (Math.random() - 0.3) * 5 * power, vy: 3 + Math.random() * 6 * power, vz: (Math.random() - 0.5) * 4,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 10, sx: s, sy: s, sz: s, life: 0, max: 0.5 + Math.random() * 0.4, grav: 30, shrink: true,
      });
      c.setHex(Math.random() < 0.55 ? 0x7aad45 : 0x8a5f3a);
      this.partMesh.setColorAt(this.parts.length - 1, c);
    }
    if (this.partMesh.instanceColor) this.partMesh.instanceColor.needsUpdate = true;
  }

  private updateParticles(dt: number): void {
    const keep: Particle[] = [];
    const cols: THREE.Color[] = [];
    const c = new THREE.Color();
    for (let k = 0; k < this.parts.length; k++) {
      const p = this.parts[k];
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.r += p.vr * dt;
      const g = this.course.groundY(p.x) + 0.04;
      if (p.y < g) {
        p.y = g;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vr *= 0.5;
      }
      keep.push(p);
      if (this.partMesh.instanceColor) {
        this.partMesh.getColorAt(k, c);
        cols.push(c.clone());
      }
    }
    this.parts = keep;
    for (let k = 0; k < keep.length; k++) {
      const p = keep[k];
      const f = p.shrink ? 1 - p.life / p.max : Math.min(1, (p.max - p.life) * 4);
      this.tmpV.set(p.x, p.y, p.z);
      this.tmpQ.setFromAxisAngle(this.zAxis, p.r);
      this.tmpS.set(p.sx * f, p.sy * f, p.sz * f);
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
      this.partMesh.setMatrixAt(k, this.tmpM);
      if (cols[k]) this.partMesh.setColorAt(k, cols[k]);
    }
    this.partMesh.count = keep.length;
    this.partMesh.instanceMatrix.needsUpdate = true;
    if (this.partMesh.instanceColor) this.partMesh.instanceColor.needsUpdate = true;
  }

  // ---------- frame ----------
  update(realDt: number, simDt: number, view: ViewState): void {
    const sim = this.sim;
    if (!sim) return;
    this.syncStacks(false);

    // bow + arrow pose
    let pull = 0;
    if (view.phase === 'aim' || view.phase === 'windup') pull = view.pull;
    else {
      // string snaps forward past brace and settles (elastic)
      const t = Math.min(1, view.release / 0.45);
      pull = -0.35 * (1 - easeOutElastic(t));
    }
    this.updateBow(pull);

    let hx = this.cam.x;
    let hy = this.cam.y;
    let speed = 0;
    if (!sim.arrowAlive && sim.phase === 'ready') {
      const pose = sim.restPose(view.pull);
      for (let i = 0; i < this.segs.length; i++) {
        this.segs[i].visible = true;
        this.segs[i].position.set(pose[i].x, pose[i].y, 0);
        this.segs[i].rotation.set(0, 0, pose[i].a);
        this.segs[i].scale.set(1, 1, 1);
      }
      hx = pose[0].x;
      hy = pose[0].y;
    } else if (sim.arrowAlive) {
      for (let i = 0; i < this.segs.length; i++) {
        const b = sim.arrow[i];
        const p = b.translation();
        const r = b.rotation();
        this.segs[i].visible = true;
        this.segs[i].position.set(p.x, p.y, 0);
        this.segs[i].quaternion.set(r.x, r.y, r.z, r.w);
      }
      const v = sim.arrow[0].linvel();
      speed = Math.hypot(v.x, v.y);
      hx = sim.arrow[0].translation().x;
      hy = sim.arrow[0].translation().y;
      // trail dots every 1.4 m
      if (Math.hypot(hx - this.trailLast.x, hy - this.trailLast.y) > 1.4 && this.trailN < 3000) {
        const a = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
        a.setXYZ(this.trailN++, hx, hy, 0.3);
        a.needsUpdate = true;
        this.trail.geometry.setDrawRange(0, this.trailN);
        this.trailLast = { x: hx, y: hy };
      }
    } else {
      for (const s of this.segs) s.visible = false;
    }
    // head squash on impact, elastic settle
    if (this.segs[0]) {
      const head = this.segs[0].getObjectByName('head');
      this.headScale.t = Math.min(1, this.headScale.t + simDt / 0.35);
      const e = easeOutElastic(this.headScale.t);
      const k = 1 - e;
      if (head) head.scale.set(1 - 0.4 * k * this.headScale.a, 1 + 0.5 * k * this.headScale.a, 1 + 0.5 * k * this.headScale.a);
    }
    // pad mats dip and spring back
    for (const p of this.pads.values()) {
      if (p.t >= 1) continue;
      p.t = Math.min(1, p.t + simDt / 0.6);
      const k = 1 - easeOutElastic(p.t);
      p.mat.position.y = PAD_H + 0.04 - 0.3 * k;
      p.mat.scale.set(1 + 0.12 * k, 1, 1);
    }
    this.updateParticles(simDt);

    // camera
    let tx: number;
    let ty: number;
    let tz: number;
    if (view.phase === 'aim' || view.phase === 'windup') {
      tx = 3.6;
      ty = 3.2;
      tz = 19;
    } else {
      const above = Math.max(0, hy - this.course.groundY(hx));
      const v = sim.arrowAlive ? sim.arrow[0].linvel() : { x: 0, y: 0 };
      tx = hx + Math.max(-3, Math.min(6, v.x * 0.1));
      // keep the ground in shot: bias down and pull back as the arrow climbs
      ty = hy + 4.5 - Math.min(above, 40) * 0.5;
      tz = 22 + Math.min(above * 0.6, 50) + Math.min(speed * 0.15, 12);
      if (view.phase === 'result') tz = Math.max(20, tz - 3);
    }
    const k1 = 1 - Math.exp(-realDt * 6);
    const k2 = 1 - Math.exp(-realDt * 2.2);
    this.cam.x += (tx - this.cam.x) * k1;
    this.cam.y += (ty - this.cam.y) * k1;
    this.cam.z += (tz - this.cam.z) * k2;
    this.trauma = Math.max(0, this.trauma - realDt * 1.7);
    this.shakeT += realDt;
    const s = this.trauma * this.trauma;
    const ox = s * 0.9 * Math.sin(this.shakeT * 53.1);
    const oy = s * 0.9 * Math.sin(this.shakeT * 61.7 + 1.3);
    this.camera.position.set(this.cam.x + ox, this.cam.y + oy, this.cam.z);
    this.camera.lookAt(this.cam.x + ox * 0.5, this.cam.y - 1.5 + oy * 0.5, 0);
    this.camera.rotation.z += s * 0.04 * Math.sin(this.shakeT * 47.3);
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen position of a world point, in CSS pixels relative to the canvas. */
  project(x: number, y: number): { x: number; y: number } {
    this.tmpV.set(x, y, 0).project(this.camera);
    const el = this.renderer.domElement;
    return { x: ((this.tmpV.x + 1) / 2) * el.clientWidth, y: ((1 - this.tmpV.y) / 2) * el.clientHeight };
  }
}
