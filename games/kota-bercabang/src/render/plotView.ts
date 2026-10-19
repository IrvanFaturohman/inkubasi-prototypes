import * as THREE from 'three';
import type { ResolvedPlot } from '../game/layout';
import type { FinalProject } from '../game/types';
import { BuildingView } from './buildingView';
import { cbox } from './geom';
import { SHARED } from './palette';

/**
 * Satu kavling: lahan (tanah proyek → taman saat jadi) + bangunan ghost/solid.
 * Tampil hanya bila jalannya sudah dibuka; muncul dengan pop saat jalan baru selesai tumbuh.
 */
export class PlotView {
  readonly group = new THREE.Group();
  readonly building: BuildingView;
  private readonly lot: THREE.Mesh;
  private readonly lotMat: THREE.MeshStandardMaterial;
  private readonly siteColor: THREE.Color;
  private readonly lawnColor = new THREE.Color('#8fd16a');
  private doneT = 0;
  private done: boolean;
  private appear = -1;
  private shown = false;

  constructor(
    readonly plot: ResolvedPlot,
    project: FinalProject,
    completedModules: number,
    siteColor: string,
    lawnColor: string,
  ) {
    this.group.position.set(plot.pos.x, 0, plot.pos.z);
    this.group.rotation.y = plot.rotY;
    this.siteColor = new THREE.Color(siteColor);
    this.lawnColor.set(lawnColor);
    this.done = completedModules >= project.modules.length;
    this.doneT = this.done ? 1 : 0;
    this.lotMat = new THREE.MeshStandardMaterial({ color: this.done ? this.lawnColor : this.siteColor, roughness: 1 });
    this.lot = new THREE.Mesh(cbox(1.95, 0.05, 1.75, '#ffffff', 0, 0.02, 0, 0.12), this.lotMat);
    this.lot.receiveShadow = true;
    // Jalan setapak dari trotoar ke pintu.
    const path = new THREE.Mesh(cbox(0.36, 0.055, 0.6, '#e9e2d2', 0, 0.025, 0.72, 0.03), SHARED.vertexStd);
    path.receiveShadow = true;
    this.building = new BuildingView(project, completedModules);
    this.building.group.position.set(0, 0.04, -0.1);
    this.group.add(this.lot, path, this.building.group);
    this.group.visible = false;
  }

  get complete(): boolean {
    return this.done;
  }

  private top: THREE.Vector3 | null = null;

  /** Posisi dunia puncak bangunan (untuk label/pop sewa). Dihitung sekali lalu di-cache. */
  topWorld(out: THREE.Vector3): THREE.Vector3 {
    if (!this.top) {
      this.group.updateMatrixWorld(true);
      const b = this.building.worldBounds();
      this.top = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.15, (b.min.z + b.max.z) / 2);
    }
    return out.copy(this.top);
  }

  setVisible(on: boolean, animate: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.group.visible = on;
    if (on && animate) this.appear = 0;
  }

  markComplete(): void {
    this.done = true;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.building.update(dt);
    if (this.done && this.doneT < 1) {
      this.doneT = Math.min(1, this.doneT + dt * 1.5);
      this.lotMat.color.copy(this.siteColor).lerp(this.lawnColor, this.doneT);
    }
    if (this.appear >= 0) {
      this.appear += dt;
      const k = Math.min(1, this.appear / 0.5);
      const s = 1 + Math.sin(k * Math.PI) * 0.12;
      this.group.scale.set(Math.max(0.01, k) * s, Math.max(0.01, k), Math.max(0.01, k) * s);
      if (k >= 1) {
        this.appear = -1;
        this.group.scale.set(1, 1, 1);
      }
    }
  }

  dispose(): void {
    this.building.dispose();
    this.lotMat.dispose();
  }
}
