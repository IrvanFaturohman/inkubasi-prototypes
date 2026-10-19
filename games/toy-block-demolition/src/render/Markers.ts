import * as THREE from 'three';
import { PALETTE, REMAINING_MARKER_THRESHOLD } from '../game/config';
import { damp } from '../game/util';
import type { ArtFactory } from './ArtFactory';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * World-space guidance: a floating arrow orbiting the truck that points to the
 * depot / gate / last targets, and bobbing markers above the final few cells.
 */
export class Markers {
  readonly group = new THREE.Group();
  private arrow = new THREE.Group();
  private arrowMat: THREE.MeshBasicMaterial;
  private arrowShadowMat: THREE.MeshBasicMaterial;
  private arrowVisible = 0;
  private arrowWant = false;
  private arrowAngle = 0;
  private time = 0;
  private cones: THREE.InstancedMesh;
  private conePositions: THREE.Vector3[] = [];

  constructor(art: ArtFactory) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.52);
    shape.lineTo(0.42, 0.02);
    shape.lineTo(0.16, 0.02);
    shape.lineTo(0.16, -0.36);
    shape.lineTo(-0.16, -0.36);
    shape.lineTo(-0.16, 0.02);
    shape.lineTo(-0.42, 0.02);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.02, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    this.arrowMat = new THREE.MeshBasicMaterial({ color: PALETTE.highlight, transparent: true, opacity: 1 });
    this.arrowShadowMat = new THREE.MeshBasicMaterial({ color: '#1E2D34', transparent: true, opacity: 0.18, depthWrite: false });
    const body = new THREE.Mesh(geo, this.arrowMat);
    body.position.y = 1.15;
    body.renderOrder = 3;
    const shadow = new THREE.Mesh(geo, this.arrowShadowMat);
    shadow.position.y = 0.03;
    shadow.scale.set(1, 0.2, 1);
    shadow.renderOrder = 1;
    this.arrow.add(shadow, body);
    this.arrow.visible = false;
    this.group.add(this.arrow);

    this.cones = new THREE.InstancedMesh(art.geo.marker, new THREE.MeshBasicMaterial({ color: PALETTE.coral }), REMAINING_MARKER_THRESHOLD);
    this.cones.count = 0;
    this.cones.frustumCulled = false;
    this.group.add(this.cones);
  }

  /** Point the orbiting arrow from the truck toward a world target. */
  setArrow(want: boolean, fromX: number, fromZ: number, toX: number, toZ: number, color: string): void {
    const d = Math.hypot(toX - fromX, toZ - fromZ);
    this.arrowWant = want && d > 2.4;
    if (!want) return;
    this.arrowMat.color.set(color);
    const angle = Math.atan2(toX - fromX, toZ - fromZ);
    let diff = angle - this.arrowAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.arrowAngle += diff * 0.25;
    this.arrow.position.set(fromX, 0, fromZ);
  }

  setRemaining(points: THREE.Vector3[]): void {
    this.conePositions = points.slice(0, REMAINING_MARKER_THRESHOLD);
    this.cones.count = this.conePositions.length;
  }

  update(dt: number): void {
    this.time += dt;
    this.arrowVisible += ((this.arrowWant ? 1 : 0) - this.arrowVisible) * damp(8, dt);
    this.arrow.visible = this.arrowVisible > 0.02;
    if (this.arrow.visible) {
      const bob = Math.sin(this.time * 5) * 0.12;
      const r = 1.95 + bob;
      const body = this.arrow.children[1];
      const shadow = this.arrow.children[0];
      for (const c of [body, shadow]) {
        c.position.x = Math.sin(this.arrowAngle) * r;
        c.position.z = Math.cos(this.arrowAngle) * r;
        // Shape tip points +Z after the geometry rotation? The arrow tip is at shape +Y → world -Z.
        c.rotation.y = this.arrowAngle + Math.PI;
        c.scale.x = this.arrowVisible;
        c.scale.z = this.arrowVisible;
      }
      this.arrowMat.opacity = this.arrowVisible;
    }
    for (let i = 0; i < this.cones.count; i++) {
      const p = this.conePositions[i];
      _p.set(p.x, p.y + 0.55 + Math.abs(Math.sin(this.time * 4 + i)) * 0.25, p.z);
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.time * 2);
      _s.set(1, 1, 1);
      this.cones.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    if (this.cones.count > 0) this.cones.instanceMatrix.needsUpdate = true;
  }
}
