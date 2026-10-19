// ---------------------------------------------------------------------------
// Tiny pooled particle system: one InstancedMesh, fixed capacity.
// When the pool is exhausted the oldest particle is recycled.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

interface P {
  life: number;
  max: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  size: number;
  grav: number;
  drag: number;
  spin: number;
  rot: number;
  flat: boolean;
}

export interface BurstOpts {
  count: number;
  color: number | number[];
  speed?: [number, number];
  up?: [number, number];
  size?: [number, number];
  life?: [number, number];
  grav?: number;
  drag?: number;
  spread?: number;
  flat?: boolean;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private next = 0;
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(capacity = 120) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) {
      this.ps.push({
        life: 0,
        max: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        size: 0,
        grav: 0,
        drag: 0,
        spin: 0,
        rot: 0,
        flat: false,
      });
      this.mesh.setColorAt(i, this.col.set(0xffffff));
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
  }

  burst(at: THREE.Vector3, o: BurstOpts): void {
    const colors = Array.isArray(o.color) ? o.color : [o.color];
    const [s0, s1] = o.speed ?? [1, 3];
    const [u0, u1] = o.up ?? [1, 3];
    const [z0, z1] = o.size ?? [0.04, 0.08];
    const [l0, l1] = o.life ?? [0.4, 0.8];
    const spread = o.spread ?? 0.1;
    for (let n = 0; n < o.count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.ps.length;
      const p = this.ps[i];
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(s0, s1);
      p.pos.set(at.x + rnd(-spread, spread), at.y + rnd(-spread, spread), at.z + rnd(-spread, spread));
      p.vel.set(Math.cos(a) * sp, rnd(u0, u1), Math.sin(a) * sp);
      p.size = rnd(z0, z1);
      p.max = p.life = rnd(l0, l1);
      p.grav = o.grav ?? 9;
      p.drag = o.drag ?? 1.5;
      p.spin = rnd(-10, 10);
      p.rot = Math.random() * 6;
      p.flat = o.flat ?? false;
      this.mesh.setColorAt(i, this.col.set(colors[n % colors.length]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    const d = this.dummy;
    let any = false;
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.rot += p.spin * dt;
      const k = Math.max(0, p.life / p.max);
      const s = p.size * Math.min(1, k * 2.5);
      d.position.copy(p.pos);
      d.rotation.set(p.rot, p.rot * 0.7, 0);
      if (p.flat) d.scale.set(s, s * 0.35, s);
      else d.scale.setScalar(s);
      if (p.life <= 0) d.scale.setScalar(0);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    const d = this.dummy;
    d.scale.setScalar(0);
    d.updateMatrix();
    for (let i = 0; i < this.ps.length; i++) {
      this.ps[i].life = 0;
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
