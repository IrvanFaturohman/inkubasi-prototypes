// ---------------------------------------------------------------------------
// Kiosk decor. Both kiosks share the same machine; only the set dressing,
// colours, sign and customers change. Both decor groups are built once and
// toggled, so switching kiosks is instant.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import type { KioskId } from '../config';
import type { CustomerStyle } from './customer';
import { C, blobShadow, canvasTexture, lambert, mesh, signTexture, FONT } from './kit';

export interface Theme {
  id: KioskId;
  bg: number;
  potColor: number;
  burnerColor: number;
  trayColor: number;
  cupStripe: 'red' | 'teal';
  customers: CustomerStyle;
  group: THREE.Group;
  update(dt: number, t: number): void;
}

const FLOOR = { x0: -4.2, x1: 5.4, z0: -3.1, z1: 3.6 };
const WALL_Z = -2.75;
const WALL_X = -3.35;

function floor(tex: THREE.Texture, side: number): THREE.Group {
  const g = new THREE.Group();
  const w = FLOOR.x1 - FLOOR.x0;
  const d = FLOOR.z1 - FLOOR.z0;
  const cx = (FLOOR.x0 + FLOOR.x1) / 2;
  const cz = (FLOOR.z0 + FLOOR.z1) / 2;
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
  top.position.set(cx, 0, cz);
  g.add(top);
  g.add(mesh(new THREE.BoxGeometry(w, 0.5, d), lambert(side), cx, -0.255, cz));
  return g;
}

function tileTexture(a: string, b: string, n: number, grout: string): THREE.CanvasTexture {
  const tex = canvasTexture(512, 512, (ctx) => {
    const s = 512 / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? a : b;
        ctx.fillRect(i * s, j * s, s, s);
      }
    ctx.strokeStyle = grout;
    ctx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s, 0);
      ctx.lineTo(i * s, 512);
      ctx.moveTo(0, i * s);
      ctx.lineTo(512, i * s);
      ctx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1.4);
  return tex;
}

function plankTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(512, 512, (ctx) => {
    const cols = ['#f3d69c', '#efcd8c', '#f6dca8', '#ecc884'];
    const h = 512 / 8;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = cols[i % cols.length];
      ctx.fillRect(0, i * h, 512, h);
      ctx.fillStyle = 'rgba(160,110,60,0.35)';
      ctx.fillRect(0, i * h, 512, 3);
      const off = (i * 173) % 512;
      ctx.fillRect(off, i * h, 3, h);
      ctx.fillRect((off + 256) % 512, i * h, 3, h);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.4);
  return tex;
}

/** Board with the kiosk sign on its front face. */
function signBoard(tex: THREE.Texture, w: number, h: number, frame: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.18), lambert(frame)));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.z = 0.1;
  g.add(face);
  return g;
}

// ---------------------------------------------------------------------------
// Cinema
// ---------------------------------------------------------------------------

function posterTexture(title: string, bg: string, fg: string, accent: string): THREE.CanvasTexture {
  return canvasTexture(256, 384, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 384);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(128, 150, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fg;
    // star
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 48 : 20;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(128 + Math.cos(a) * r, 150 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.font = `900 40px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(title, 128, 290);
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText('NOW SHOWING', 128, 330);
  });
}

function buildCinema(): Theme {
  const g = new THREE.Group();
  g.add(floor(tileTexture('#fff1d6', '#ffd98f', 8, 'rgba(200,140,80,0.25)'), 0xd9824a));

  const wallMat = lambert(0xf6cf9f);
  const trimMat = lambert(0xc9553d);
  const wallW = FLOOR.x1 - WALL_X;
  // back wall
  g.add(mesh(new THREE.BoxGeometry(wallW, 4.6, 0.25), wallMat, (WALL_X + FLOOR.x1) / 2, 2.3, WALL_Z - 0.12));
  g.add(mesh(new THREE.BoxGeometry(wallW, 0.9, 0.32), trimMat, (WALL_X + FLOOR.x1) / 2, 0.45, WALL_Z - 0.1));
  // left wall
  const lwD = FLOOR.z1 - WALL_Z;
  g.add(mesh(new THREE.BoxGeometry(0.25, 4.6, lwD), wallMat, WALL_X - 0.12, 2.3, WALL_Z + lwD / 2));
  g.add(mesh(new THREE.BoxGeometry(0.32, 0.9, lwD), trimMat, WALL_X - 0.1, 0.45, WALL_Z + lwD / 2));

  // curtains on the back wall (right side)
  const curtainMat = lambert(0xd9573b);
  const curtainGeo = new THREE.CylinderGeometry(0.17, 0.2, 3.9, 8);
  for (let i = 0; i < 7; i++) {
    g.add(mesh(curtainGeo, curtainMat, 3.1 + i * 0.3, 2.05, WALL_Z + 0.05));
  }
  g.add(mesh(new THREE.BoxGeometry(2.4, 0.3, 0.5), lambert(C.butterDeep), 4.0, 4.1, WALL_Z + 0.1));
  g.add(mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 12), lambert(C.butterDeep), 3.2, 1.6, WALL_Z + 0.3));

  // marquee sign
  const sign = signBoard(signTexture('CINEMA POPCORN', '#fff3dc', '#c9432f', '#ffcf4a', '#c9432f'), 4.2, 1.05, 0xc9432f);
  sign.position.set(0.35, 3.55, WALL_Z + 0.1);
  g.add(sign);

  // posters on the left wall
  const posters: [string, string, string, string, number][] = [
    ['POP!', '#2ec4b6', '#fff3dc', '#1d9e92', -1.75],
    ['KERNEL', '#f28a3c', '#fff3dc', '#e0662c', 0.35],
  ];
  for (const [t, bg, fg, ac, z] of posters) {
    const p = new THREE.Group();
    p.add(mesh(new THREE.BoxGeometry(0.08, 1.7, 1.2), lambert(C.butterDeep)));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.55), new THREE.MeshLambertMaterial({ map: posterTexture(t, bg, fg, ac) }));
    face.rotation.y = Math.PI / 2;
    face.position.x = 0.05;
    p.add(face);
    p.position.set(WALL_X + 0.05, 2.45, z);
    g.add(p);
  }

  // film reel prop (spins slowly)
  const reel = new THREE.Group();
  const reelDisc = new THREE.Group();
  reelDisc.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 20).rotateX(Math.PI / 2), lambert(C.charcoal)));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    reelDisc.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 10).rotateX(Math.PI / 2), lambert(0xf6cf9f), Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0));
  }
  reelDisc.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8).rotateX(Math.PI / 2), lambert(C.butterDeep)));
  reelDisc.position.y = 0.95;
  reel.add(reelDisc);
  reel.add(mesh(new THREE.BoxGeometry(0.12, 0.95, 0.12), lambert(C.butterDeep), 0, 0.47, -0.12));
  reel.add(mesh(new THREE.BoxGeometry(0.6, 0.08, 0.4), lambert(C.butterDeep), 0, 0.04, -0.12));
  reel.position.set(2.15, 0, -2.25);
  reel.rotation.y = 0.56;
  reel.add(blobShadow(1.1, 0.25));
  g.add(reel);

  // rope barrier near the queue
  const postMat = lambert(C.butterDeep);
  const ropePts: THREE.Vector3[] = [];
  const posts = [new THREE.Vector3(3.2, 0, 2.55), new THREE.Vector3(4.5, 0, 2.55)];
  for (const p of posts) {
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.85, 8), postMat, p.x, 0.43, p.z));
    g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 10), postMat, p.x, 0.03, p.z));
    g.add(mesh(new THREE.IcosahedronGeometry(0.08, 1), postMat, p.x, 0.9, p.z));
  }
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    ropePts.push(new THREE.Vector3(THREE.MathUtils.lerp(posts[0].x, posts[1].x, u), 0.8 - Math.sin(u * Math.PI) * 0.25, posts[0].z));
  }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePts), 16, 0.035, 5), lambert(0xc9432f)));

  return {
    id: 'cinema',
    bg: 0xf3d8b4,
    potColor: C.red,
    burnerColor: C.turquoiseDeep,
    trayColor: C.turquoise,
    cupStripe: 'red',
    customers: {
      shirts: [0xe25b45, 0x2ec4b6, 0xf6b93b, 0x7c6fd6, 0x4f9dde, 0xf28a3c],
      hair: [0x3b2a22, 0x5b3a29, 0x8a5a3c, 0x1f1a24, 0xc9773c],
      hatChance: 0,
      balloonChance: 0,
      glassesChance: 0.45,
      hatColors: [C.red],
      balloonColors: [C.red],
    },
    group: g,
    update(dt) {
      reelDisc.rotation.z -= dt * 0.35;
    },
  };
}

// ---------------------------------------------------------------------------
// Fairground
// ---------------------------------------------------------------------------

function flagString(from: THREE.Vector3, to: THREE.Vector3, n: number, colors: number[]): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    pts.push(new THREE.Vector3().lerpVectors(from, to, u).setY(THREE.MathUtils.lerp(from.y, to.y, u) - Math.sin(u * Math.PI) * 0.35));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.015, 4), lambert(0xfff6e6)));
  const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.13, 0, 0), new THREE.Vector3(0.13, 0, 0), new THREE.Vector3(0, -0.32, 0)]);
  tri.computeVertexNormals();
  const dir = to.clone().sub(from).setY(0).normalize();
  const angle = Math.atan2(-dir.z, dir.x);
  for (let i = 0; i < n; i++) {
    const p = curve.getPoint((i + 0.5) / n);
    const f = new THREE.Mesh(tri, new THREE.MeshLambertMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }));
    f.position.copy(p);
    f.rotation.y = angle;
    g.add(f);
  }
  return g;
}

function buildFairground(): Theme {
  const g = new THREE.Group();
  g.add(floor(plankTexture(), 0x2aa198));

  // striped booth wall behind the machine
  const stripeA = lambert(C.turquoise);
  const stripeB = lambert(C.cream);
  const panelW = 0.7;
  const x0 = WALL_X;
  const n = Math.ceil((FLOOR.x1 - x0) / panelW);
  for (let i = 0; i < n; i++) {
    g.add(mesh(new THREE.BoxGeometry(panelW, 3.3, 0.2), i % 2 === 0 ? stripeA : stripeB, x0 + panelW * (i + 0.5), 1.65, WALL_Z - 0.1));
  }
  // scalloped valance
  const scallopGeo = new THREE.CircleGeometry(0.35, 12, Math.PI, Math.PI);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(scallopGeo, new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? C.orange : C.butter, side: THREE.DoubleSide }));
    s.position.set(x0 + panelW * (i + 0.5), 3.3, WALL_Z + 0.02);
    g.add(s);
  }
  g.add(mesh(new THREE.BoxGeometry(n * panelW, 0.2, 0.34), lambert(C.orangeDeep), x0 + (n * panelW) / 2, 3.38, WALL_Z - 0.05));

  // sign
  const sign = signBoard(signTexture('FAIRGROUND POPCORN', '#2ec4b6', '#fff8e8', '#ffd66b', '#e0662c'), 4.4, 1.0, 0xe0662c);
  sign.position.set(0.35, 3.85, WALL_Z + 0.08);
  g.add(sign);

  // low picket fence on the left
  const fenceMat = lambert(C.cream);
  for (let z = WALL_Z + 0.2; z < FLOOR.z1 - 0.2; z += 0.42) {
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), fenceMat, WALL_X + 0.2, 0.375, z));
    g.add(mesh(new THREE.ConeGeometry(0.09, 0.14, 4), fenceMat, WALL_X + 0.2, 0.82, z));
  }
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.08, FLOOR.z1 - WALL_Z - 0.3), lambert(C.butterDeep), WALL_X + 0.2, 0.55, (WALL_Z + FLOOR.z1) / 2));
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.08, FLOOR.z1 - WALL_Z - 0.3), lambert(C.butterDeep), WALL_X + 0.2, 0.25, (WALL_Z + FLOOR.z1) / 2));

  // ferris wheel peeking over the booth
  const wheel = new THREE.Group();
  const spin = new THREE.Group();
  const rimMat = lambert(C.orange);
  spin.add(mesh(new THREE.TorusGeometry(1.7, 0.06, 6, 36), rimMat));
  spin.add(mesh(new THREE.TorusGeometry(1.2, 0.03, 4, 30), lambert(C.cream)));
  const cabins: THREE.Mesh[] = [];
  const cabinCols = [C.red, C.butter, C.turquoise, C.orange];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spoke = mesh(new THREE.BoxGeometry(0.04, 3.4, 0.04), lambert(C.cream));
    spoke.rotation.z = a;
    spin.add(spoke);
    const cab = mesh(new THREE.BoxGeometry(0.32, 0.26, 0.26), lambert(cabinCols[i % 4]), Math.cos(a) * 1.7, Math.sin(a) * 1.7, 0);
    spin.add(cab);
    cabins.push(cab);
  }
  spin.add(mesh(new THREE.IcosahedronGeometry(0.16, 1), lambert(C.butter)));
  wheel.add(spin);
  for (const s of [-1, 1]) {
    const leg = mesh(new THREE.BoxGeometry(0.1, 3.4, 0.1), lambert(C.cream), s * 0.8, -1.55, -0.15);
    leg.rotation.z = s * 0.45;
    wheel.add(leg);
  }
  wheel.scale.setScalar(0.5);
  wheel.position.set(2.2, 1.63, -2.3);
  wheel.rotation.y = 0.56;
  wheel.add(blobShadow(3.2, 0.2).translateY(-3.24));
  g.add(wheel);

  // bunting across the booth top
  g.add(flagString(new THREE.Vector3(WALL_X, 3.6, WALL_Z + 0.25), new THREE.Vector3(FLOOR.x1, 3.6, WALL_Z + 0.25), 16, [C.red, C.butter, C.turquoise, C.orange, C.cream]));

  // balloons tied to the fence
  const balloons = new THREE.Group();
  const bCols = [C.red, C.turquoise, C.butter, C.orange];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group();
    const top = new THREE.Vector3((i - 1.5) * 0.28, 1.6 + (i % 2) * 0.28, (i % 2) * 0.15);
    b.add(mesh(new THREE.SphereGeometry(0.22, 12, 10).scale(1, 1.2, 1), new THREE.MeshLambertMaterial({ color: bCols[i] }), top.x, top.y, top.z));
    const len = top.length();
    const str = mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 4), lambert(0xfff6e6));
    str.position.copy(top).multiplyScalar(0.5);
    str.lookAt(top);
    str.rotateX(Math.PI / 2);
    b.add(str);
    balloons.add(b);
  }
  const BX = 4.85;
  const BZ = 1.95;
  balloons.position.set(BX, 0.6, BZ);
  g.add(balloons);
  const stake = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 6), lambert(C.cream), BX, 0.3, BZ);
  g.add(stake, blobShadow(0.8, 0.22).translateX(BX).translateZ(BZ));

  // a crate of corn as set dressing
  const crate = new THREE.Group();
  crate.add(mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6), lambert(0xd99a5b), 0, 0.25, 0));
  crate.add(mesh(new THREE.BoxGeometry(0.84, 0.08, 0.64), lambert(0xb97a45), 0, 0.42, 0));
  for (let i = 0; i < 3; i++) {
    const cob = mesh(new THREE.CapsuleGeometry(0.09, 0.4, 3, 8), lambert(C.butterDeep), -0.22 + i * 0.22, 0.56, 0);
    cob.rotation.z = Math.PI / 2 + (i - 1) * 0.2;
    crate.add(cob);
  }
  crate.add(blobShadow(1.2, 0.22));
  crate.position.set(-2.7, 0, -2.1);
  crate.rotation.y = 0.3;
  g.add(crate);

  return {
    id: 'fairground',
    bg: 0xbfe6de,
    potColor: C.turquoise,
    burnerColor: C.orangeDeep,
    trayColor: C.orange,
    cupStripe: 'teal',
    customers: {
      shirts: [0xff8fa3, 0x2ec4b6, 0xffd66b, 0x7bd389, 0xf28a3c, 0x6ec1e4],
      hair: [0x3b2a22, 0x5b3a29, 0xd98b3a, 0x1f1a24, 0xf2c14e],
      hatChance: 0.5,
      balloonChance: 0.35,
      glassesChance: 0,
      hatColors: [C.red, C.turquoise, C.butter, 0x7c6fd6],
      balloonColors: [C.red, C.turquoise, C.butter, 0xff8fa3],
    },
    group: g,
    update(dt, t) {
      spin.rotation.z += dt * 0.25;
      for (const c of cabins) c.rotation.z = -spin.rotation.z;
      balloons.rotation.z = Math.sin(t * 1.3) * 0.05;
      balloons.position.y = 0.6 + Math.sin(t * 1.7) * 0.03; // gentle bob
    },
  };
}

export function buildThemes(): Record<KioskId, Theme> {
  return { cinema: buildCinema(), fairground: buildFairground() };
}
