// ---------------------------------------------------------------------------
// Simple low-poly customer: capsule body, round head, optional accessories.
// Each cup slot owns two customers that alternate (one leaves while the next
// arrives), so the queue stays smooth even when sales are frequent.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { C, blobShadow, lambert } from './kit';

export interface CustomerStyle {
  shirts: number[];
  hair: number[];
  hatChance: number;
  balloonChance: number;
  glassesChance: number;
  hatColors: number[];
  balloonColors: number[];
}

type CState = 'hidden' | 'arrive' | 'wait' | 'grab' | 'leave';

const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.4, 3, 10).translate(0, 0.46, 0);
const headGeo = new THREE.IcosahedronGeometry(0.24, 2);
const hairGeo = new THREE.SphereGeometry(0.255, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
const eyeGeo = new THREE.SphereGeometry(0.034, 6, 5);
const cheekGeo = new THREE.SphereGeometry(0.045, 6, 5);
const handGeo = new THREE.IcosahedronGeometry(0.075, 1);
const hatGeo = new THREE.ConeGeometry(0.15, 0.36, 10).translate(0, 0.18, 0);
const pomGeo = new THREE.IcosahedronGeometry(0.05, 1);
const glassFrameGeo = new THREE.BoxGeometry(0.4, 0.09, 0.03);
const lensGeo = new THREE.BoxGeometry(0.13, 0.07, 0.02);
const balloonGeo = new THREE.SphereGeometry(0.19, 10, 8).scale(1, 1.18, 1);
const stringGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 4).translate(0, 0.5, 0);

/** Facing angle while waiting: toward the cup (-x) and a bit toward the camera. */
export const FACE_ANGLE = -0.85;
const HAND = new THREE.Vector3(0, 0.62, 0.36);

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const easeIn = (u: number) => u * u;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Customer {
  readonly g = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly shirt: THREE.MeshLambertMaterial;
  private readonly skin: THREE.MeshLambertMaterial;
  private readonly hairMat: THREE.MeshLambertMaterial;
  private readonly hatMat: THREE.MeshLambertMaterial;
  private readonly balloonMat: THREE.MeshLambertMaterial;
  private readonly hat: THREE.Group;
  private readonly glasses: THREE.Group;
  private readonly balloon: THREE.Group;
  readonly carried: THREE.Group;

  state: CState = 'hidden';
  private t = 0;
  readonly home = new THREE.Vector3();
  readonly exit = new THREE.Vector3();
  private grabFrom = new THREE.Vector3();
  private phase = Math.random() * 10;
  private hop = 0;

  constructor(carriedCup: THREE.Group) {
    this.shirt = new THREE.MeshLambertMaterial({ color: C.turquoise, flatShading: true });
    this.skin = new THREE.MeshLambertMaterial({ color: C.skin[0], flatShading: true });
    this.hairMat = new THREE.MeshLambertMaterial({ color: 0x5b3a29, flatShading: true });
    this.hatMat = new THREE.MeshLambertMaterial({ color: C.orange, flatShading: true });
    this.balloonMat = new THREE.MeshLambertMaterial({ color: C.red, flatShading: false });

    const b = this.body;
    b.add(new THREE.Mesh(bodyGeo, this.shirt));
    const head = new THREE.Mesh(headGeo, this.skin);
    head.position.y = 1.14;
    b.add(head);
    const hair = new THREE.Mesh(hairGeo, this.hairMat);
    hair.position.set(0, 1.16, -0.02);
    hair.rotation.x = -0.35;
    b.add(hair);
    const eyeMat = lambert(0x2b2233);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.position.set(0.085 * s, 1.15, 0.215);
      b.add(e);
      const ch = new THREE.Mesh(cheekGeo, lambert(0xff9a8a));
      ch.position.set(0.15 * s, 1.07, 0.18);
      ch.scale.set(1, 0.7, 0.5);
      b.add(ch);
      const hand = new THREE.Mesh(handGeo, this.skin);
      hand.position.set(0.21 * s, 0.6, 0.2);
      b.add(hand);
    }

    this.hat = new THREE.Group();
    this.hat.add(new THREE.Mesh(hatGeo, this.hatMat));
    const pom = new THREE.Mesh(pomGeo, lambert(C.white));
    pom.position.y = 0.37;
    this.hat.add(pom);
    this.hat.position.set(0.02, 1.33, -0.02);
    this.hat.rotation.z = -0.15;
    b.add(this.hat);

    this.glasses = new THREE.Group();
    this.glasses.add(new THREE.Mesh(glassFrameGeo, lambert(0x2b2233)));
    const l1 = new THREE.Mesh(lensGeo, lambert(0xe2513f));
    l1.position.set(-0.09, 0, 0.018);
    const l2 = new THREE.Mesh(lensGeo, lambert(0x3cc4d8));
    l2.position.set(0.09, 0, 0.018);
    this.glasses.add(l1, l2);
    this.glasses.position.set(0, 1.16, 0.23);
    b.add(this.glasses);

    this.balloon = new THREE.Group();
    const str = new THREE.Mesh(stringGeo, lambert(0xfff6e6));
    str.scale.y = 0.95;
    str.rotation.z = -0.25;
    this.balloon.add(str);
    const ball = new THREE.Mesh(balloonGeo, this.balloonMat);
    ball.position.set(0.24, 1.05, 0);
    this.balloon.add(ball);
    this.balloon.position.set(-0.21, 0.6, 0.2);
    b.add(this.balloon);

    this.carried = carriedCup;
    this.carried.visible = false;
    this.carried.scale.setScalar(0.8);
    b.add(this.carried);

    this.g.add(b);
    this.g.add(blobShadow(0.9, 0.3));
    this.g.visible = false;
  }

  restyle(s: CustomerStyle): void {
    this.shirt.color.set(pick(s.shirts));
    this.skin.color.set(pick(C.skin));
    this.hairMat.color.set(pick(s.hair));
    const hat = Math.random() < s.hatChance;
    this.hat.visible = hat;
    this.hatMat.color.set(pick(s.hatColors));
    this.glasses.visible = !hat && Math.random() < s.glassesChance;
    this.balloon.visible = Math.random() < s.balloonChance;
    this.balloonMat.color.set(pick(s.balloonColors));
    this.phase = Math.random() * 10;
  }

  setSlot(home: THREE.Vector3): void {
    this.home.copy(home);
    this.exit.set(home.x + 1.5, 0, home.z + 0.9);
  }

  standNow(s: CustomerStyle): void {
    this.restyle(s);
    this.state = 'wait';
    this.t = 0;
    this.carried.visible = false;
    this.g.visible = true;
    this.g.position.copy(this.home);
    this.g.scale.setScalar(1);
    this.g.rotation.y = FACE_ANGLE;
  }

  arrive(s: CustomerStyle): void {
    this.restyle(s);
    this.state = 'arrive';
    this.t = 0;
    this.carried.visible = false;
    this.g.visible = true;
    this.g.position.copy(this.exit);
    this.g.scale.setScalar(0.01);
  }

  /** Take the cup that is currently at `cupWorld` and walk away with it. */
  grab(cupWorld: THREE.Vector3): void {
    if (this.state === 'hidden') {
      // nobody was standing there (should be rare) — snap someone in
      this.g.visible = true;
      this.g.position.copy(this.home);
      this.g.scale.setScalar(1);
      this.g.rotation.y = FACE_ANGLE;
    }
    this.state = 'grab';
    this.t = 0;
    this.g.updateMatrixWorld(true);
    this.body.updateMatrixWorld(true);
    this.grabFrom.copy(cupWorld);
    this.body.worldToLocal(this.grabFrom);
    this.carried.position.copy(this.grabFrom);
    this.carried.visible = true;
  }

  hide(): void {
    this.state = 'hidden';
    this.g.visible = false;
    this.carried.visible = false;
  }

  /** Little happy hop, e.g. when popcorn lands in their cup. */
  bounce(amount = 1): void {
    this.hop = Math.max(this.hop, 0.12 * amount);
  }

  get busy(): boolean {
    return this.state !== 'hidden' && this.state !== 'wait';
  }

  update(dt: number, time: number): void {
    if (this.state === 'hidden') return;
    this.t += dt;
    const g = this.g;
    const b = this.body;
    this.hop = Math.max(0, this.hop - dt * 0.6);
    let bob = 0;
    switch (this.state) {
      case 'arrive': {
        const u = Math.min(1, this.t / 0.6);
        g.position.lerpVectors(this.exit, this.home, easeOut(u));
        g.scale.setScalar(Math.min(1, u * 2.2 + 0.01));
        const walkAngle = Math.atan2(this.home.x - this.exit.x, this.home.z - this.exit.z);
        g.rotation.y = u < 0.75 ? walkAngle : lerpAngle(walkAngle, FACE_ANGLE, (u - 0.75) / 0.25);
        bob = Math.abs(Math.sin(this.t * 16)) * 0.1;
        if (u >= 1) {
          this.state = 'wait';
          this.t = 0;
          g.rotation.y = FACE_ANGLE;
        }
        break;
      }
      case 'wait': {
        const breathe = Math.sin(time * 2.2 + this.phase);
        b.scale.set(1 - breathe * 0.012, 1 + breathe * 0.02, 1 - breathe * 0.012);
        g.rotation.y = FACE_ANGLE + Math.sin(time * 0.7 + this.phase) * 0.12;
        bob = Math.abs(Math.sin(this.hop * 26)) * this.hop;
        break;
      }
      case 'grab': {
        const u = Math.min(1, this.t / 0.3);
        const e = easeOut(u);
        this.carried.position.lerpVectors(this.grabFrom, HAND, e);
        this.carried.position.y += Math.sin(u * Math.PI) * 0.25;
        bob = Math.sin(u * Math.PI) * 0.18;
        b.scale.set(1 + Math.sin(u * Math.PI) * 0.06, 1 - Math.sin(u * Math.PI) * 0.04, 1);
        if (u >= 1) {
          this.state = 'leave';
          this.t = 0;
          b.scale.set(1, 1, 1);
        }
        break;
      }
      case 'leave': {
        const u = Math.min(1, this.t / 0.75);
        const walkAngle = Math.atan2(this.exit.x - this.home.x, this.exit.z - this.home.z);
        g.rotation.y = lerpAngle(g.rotation.y, walkAngle, Math.min(1, dt * 12));
        g.position.lerpVectors(this.home, this.exit, easeIn(u));
        g.scale.setScalar(u < 0.55 ? 1 : Math.max(0.01, 1 - (u - 0.55) / 0.45));
        bob = Math.abs(Math.sin(this.t * 16)) * 0.1;
        if (u >= 1) this.hide();
        break;
      }
    }
    b.position.y = bob;
  }
}
