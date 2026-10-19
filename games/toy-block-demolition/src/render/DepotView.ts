import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCK_COLORS, PALETTE } from '../game/config';
import type { DepotLayout } from '../game/DepotSystem';
import { createRng, damp, easeOutCubic } from '../game/util';
import type { WorldBounds } from '../game/VehicleSim';
import { canvasTexture, paint, roundedBox, type ArtFactory } from './ArtFactory';

interface Bale {
  mesh: THREE.Mesh;
  t: number;
  active: boolean;
  spin: number;
}

export interface DepotFeel {
  processing: boolean;
  attention: boolean;
  gateOpen: boolean;
  nearUpgrade: boolean;
  reducedMotion: boolean;
}

/**
 * Depot yard: SELL pad, recycler (hopper, gear, stamping piston, output chute),
 * upgrade stand, next-area gate, approach lane, boundary curbs and a few
 * decorative trees outside the playable area.
 */
export class DepotView {
  readonly group = new THREE.Group();
  private art: ArtFactory;
  private layout: DepotLayout;
  private gear: THREE.Mesh;
  private piston: THREE.Group;
  private lamp: THREE.Mesh;
  private lampMat: THREE.MeshStandardMaterial;
  private gateArm: THREE.Group;
  private gateLampMat: THREE.MeshStandardMaterial;
  private padGlow: THREE.Mesh;
  private padGlowMat: THREE.MeshBasicMaterial;
  private shedGlowMat: THREE.MeshBasicMaterial;
  private bales: Bale[] = [];
  private boundsGroup = new THREE.Group();
  private time = 0;
  private gearSpeed = 0;
  private pistonT = 0;
  private armAngle = 0;
  private machineGroup = new THREE.Group();
  private machinePulse = 0;
  private chuteTop = new THREE.Vector3();
  private chuteBottom = new THREE.Vector3();

  constructor(art: ArtFactory, layout: DepotLayout) {
    this.art = art;
    this.layout = layout;
    const M = art.mats;
    this.group.add(this.boundsGroup);

    // --- Approach lane from the field edge to the pad.
    const laneTex = art.textures.lane.clone();
    laneTex.needsUpdate = true;
    laneTex.repeat.set(1, 1.2);
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.3), new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.9 }));
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(layout.pad.x, 0.006, 1.0);
    lane.receiveShadow = true;
    this.group.add(lane);

    // --- SELL pad.
    const pad = layout.pad;
    const plinth = new THREE.Mesh(roundedBox(pad.hw * 2 + 0.16, 0.06, pad.hd * 2 + 0.16, 0.03, 1), M.blue);
    plinth.position.set(pad.x, 0.02, pad.z);
    plinth.receiveShadow = true;
    this.group.add(plinth);
    const padTop = new THREE.Mesh(
      new THREE.PlaneGeometry(pad.hw * 2, pad.hd * 2),
      new THREE.MeshStandardMaterial({ map: art.textures.pad, roughness: 0.7, transparent: true }),
    );
    padTop.rotation.x = -Math.PI / 2;
    padTop.position.set(pad.x, 0.056, pad.z);
    padTop.receiveShadow = true;
    this.group.add(padTop);
    const glowTex = canvasTexture(256, 256, (ctx) => {
      const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,211,77,0)');
      g.addColorStop(0.7, 'rgba(255,211,77,0.75)');
      g.addColorStop(1, 'rgba(255,211,77,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    });
    this.padGlowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false });
    this.padGlow = new THREE.Mesh(new THREE.PlaneGeometry(pad.hw * 2 + 1.6, pad.hd * 2 + 1.6), this.padGlowMat);
    this.padGlow.rotation.x = -Math.PI / 2;
    this.padGlow.position.set(pad.x, 0.03, pad.z);
    this.padGlow.renderOrder = 1;
    this.group.add(this.padGlow);

    // --- Recycler machine.
    const m = layout.machine;
    this.machineGroup.position.set(m.x, 0, m.z);
    this.group.add(this.machineGroup);
    const mg = this.machineGroup;
    const cast = (o: THREE.Mesh) => {
      o.castShadow = true;
      o.receiveShadow = true;
      return o;
    };
    const base = cast(new THREE.Mesh(roundedBox(m.hw * 2, 0.14, m.hd * 2, 0.05, 1), M.dark));
    base.position.y = 0.07;
    mg.add(base);
    const body = cast(new THREE.Mesh(roundedBox(m.hw * 2 - 0.16, 0.95, m.hd * 2 - 0.2, 0.12, 2), M.blue));
    body.position.y = 0.62;
    mg.add(body);
    const band = cast(new THREE.Mesh(roundedBox(m.hw * 2 - 0.1, 0.12, m.hd * 2 - 0.14, 0.05, 1), M.yellow));
    band.position.y = 1.06;
    mg.add(band);
    // Hopper: square funnel open at the top.
    const hopperGeo = new THREE.CylinderGeometry(0.86, 0.42, 0.5, 4, 1, true);
    hopperGeo.rotateY(Math.PI / 4);
    const hopperMat = (M.yellow as THREE.MeshStandardMaterial).clone();
    hopperMat.side = THREE.DoubleSide;
    const hopper = cast(new THREE.Mesh(hopperGeo, hopperMat));
    hopper.position.set(-0.1, 1.36, 0);
    mg.add(hopper);
    const rimHole = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.08), new THREE.MeshStandardMaterial({ color: PALETTE.dark, roughness: 0.8 }));
    rimHole.rotation.x = -Math.PI / 2;
    rimHole.position.set(-0.1, 1.2, 0);
    mg.add(rimHole);
    // Rim as four bars so the funnel stays open.
    for (const [dx, dz, w, d] of [
      [0, 0.6, 1.3, 0.1],
      [0, -0.6, 1.3, 0.1],
      [0.6, 0, 0.1, 1.3],
      [-0.6, 0, 0.1, 1.3],
    ]) {
      const bar = cast(new THREE.Mesh(roundedBox(w, 0.08, d, 0.035, 1), M.orange));
      bar.position.set(-0.1 + dx, 1.62, dz);
      mg.add(bar);
    }
    // Moving part 1: big gear on the camera-facing side.
    const gearParts: THREE.BufferGeometry[] = [];
    const disc = new THREE.CylinderGeometry(0.26, 0.26, 0.08, 20);
    disc.rotateX(Math.PI / 2);
    disc.deleteAttribute('uv');
    gearParts.push(disc);
    for (let k = 0; k < 10; k++) {
      const tooth = new THREE.BoxGeometry(0.09, 0.1, 0.08);
      tooth.deleteAttribute('uv');
      const a = (k / 10) * Math.PI * 2;
      tooth.rotateZ(a);
      tooth.translate(Math.cos(a + Math.PI / 2) * 0.3, Math.sin(a + Math.PI / 2) * 0.3, 0);
      gearParts.push(tooth);
    }
    const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12);
    hubGeo.rotateX(Math.PI / 2);
    hubGeo.deleteAttribute('uv');
    gearParts.push(hubGeo);
    this.gear = cast(new THREE.Mesh(mergeGeometries(gearParts, false)!, M.yellow));
    this.gear.position.set(-0.28, 0.6, m.hd - 0.02);
    mg.add(this.gear);
    const gear2 = this.gear.clone();
    gear2.scale.setScalar(0.62);
    gear2.position.set(0.18, 0.78, m.hd - 0.02);
    gear2.userData.ratio = -1.55;
    mg.add(gear2);
    this.gear.userData.twin = gear2;
    // Moving part 2: stamping piston on top.
    this.piston = new THREE.Group();
    this.piston.position.set(0.55, 1.12, -0.35);
    mg.add(this.piston);
    const housing = cast(new THREE.Mesh(roundedBox(0.34, 0.5, 0.34, 0.06, 1), M.coral));
    housing.position.y = 0.45;
    this.piston.add(housing);
    const rod = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 10), M.steel));
    rod.position.y = 0.15;
    this.piston.add(rod);
    // Output chute toward the east.
    const chute = cast(new THREE.Mesh(roundedBox(0.95, 0.08, 0.5, 0.03, 1), M.green));
    chute.position.set(m.hw + 0.35, 0.45, 0.15);
    chute.rotation.z = -0.55;
    mg.add(chute);
    for (const side of [-1, 1]) {
      const lip = cast(new THREE.Mesh(roundedBox(0.95, 0.12, 0.04, 0.015, 1), M.green));
      lip.position.set(m.hw + 0.35, 0.51, 0.15 + side * 0.25);
      lip.rotation.z = -0.55;
      mg.add(lip);
    }
    this.chuteTop.set(m.x + m.hw - 0.05, 0.78, m.z + 0.15);
    this.chuteBottom.set(m.x + m.hw + 0.78, 0.24, m.z + 0.15);
    // Status lamp.
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#8CE0B4', emissive: new THREE.Color(PALETTE.green), emissiveIntensity: 0.2, roughness: 0.3 });
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), this.lampMat);
    this.lamp.position.set(-0.55, 1.2, m.hd - 0.2);
    mg.add(this.lamp);
    // Recycle badge on the front.
    const badgeTex = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = PALETTE.uiPanel;
      ctx.beginPath();
      ctx.arc(64, 64, 60, 0, Math.PI * 2);
      ctx.fill();
    });
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshStandardMaterial({ map: badgeTex, roughness: 0.6 }));
    badge.position.set(0.42, 0.42, m.hd - 0.09);
    mg.add(badge);

    // Compressed bales (pooled).
    const baleGeos = [0, 1, 2].map((v) => {
      const g = roundedBox(0.3, 0.3, 0.3, 0.05, 1);
      const cols = BLOCK_COLORS.slice(0, 4).map((c) => new THREE.Color(c));
      return paint(g, (_x, y, z) => {
        const band = Math.floor((y + 0.15) / 0.1 + (z > 0.05 ? 1 : 0) + v) % 4;
        const c = cols[(band + 4) % 4];
        return [c.r, c.g, c.b];
      });
    });
    for (let k = 0; k < 6; k++) {
      const mesh = new THREE.Mesh(baleGeos[k % 3], art.chunkMat);
      mesh.castShadow = true;
      mesh.visible = false;
      this.group.add(mesh);
      this.bales.push({ mesh, t: 0, active: false, spin: 0 });
    }

    // --- Upgrade stand.
    const s = layout.shed;
    const standGroup = new THREE.Group();
    standGroup.position.set(s.x, 0, s.z);
    this.group.add(standGroup);
    const plat = cast(new THREE.Mesh(roundedBox(s.hw * 2, 0.12, s.hd * 2, 0.04, 1), M.cream));
    plat.position.y = 0.06;
    standGroup.add(plat);
    for (const side of [-1, 1]) {
      const post = cast(new THREE.Mesh(roundedBox(0.08, 1.05, 0.08, 0.03, 1), M.dark));
      post.position.set(side * (s.hw - 0.14), 0.62, -0.12);
      standGroup.add(post);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.525), new THREE.MeshStandardMaterial({ map: art.textures.upgradeSign, roughness: 0.6 }));
    sign.position.set(0, 1.05, -0.06);
    sign.rotation.x = -0.35;
    standGroup.add(sign);
    // Props: spare wheel and spare drum.
    const spareTyre = cast(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.08, 8, 16), M.rubber));
    spareTyre.rotation.x = -Math.PI / 2;
    spareTyre.position.set(-0.3, 0.2, 0.2);
    standGroup.add(spareTyre);
    const spareDrum = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 14), M.dark));
    spareDrum.rotation.z = Math.PI / 2;
    spareDrum.position.set(0.25, 0.25, 0.22);
    standGroup.add(spareDrum);
    this.shedGlowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, color: '#FFFFFF' });
    const shedGlow = new THREE.Mesh(new THREE.PlaneGeometry(s.hw * 2 + 1.2, s.hd * 2 + 1.2), this.shedGlowMat);
    shedGlow.rotation.x = -Math.PI / 2;
    shedGlow.position.y = 0.02;
    shedGlow.renderOrder = 1;
    standGroup.add(shedGlow);

    // --- Next-area gate on the southern boundary.
    const g = layout.gate;
    const gateGroup = new THREE.Group();
    gateGroup.position.set(g.x, 0, g.z);
    this.group.add(gateGroup);
    const stripeTex = canvasTexture(64, 256, (ctx) => {
      for (let y = 0; y < 256; y += 64) {
        ctx.fillStyle = PALETTE.highlight;
        ctx.fillRect(0, y, 64, 32);
        ctx.fillStyle = PALETTE.dark;
        ctx.fillRect(0, y + 32, 64, 32);
      }
    });
    const postMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5 });
    for (const side of [-1, 1]) {
      const post = cast(new THREE.Mesh(roundedBox(0.3, 1.0, 0.3, 0.06, 1), postMat));
      post.position.set(side * (g.hw + 0.16), 0.5, 0);
      gateGroup.add(post);
    }
    this.gateArm = new THREE.Group();
    this.gateArm.position.set(-(g.hw + 0.16), 0.82, 0);
    gateGroup.add(this.gateArm);
    const armTex = canvasTexture(256, 32, (ctx) => {
      for (let x = 0; x < 256; x += 64) {
        ctx.fillStyle = PALETTE.coral;
        ctx.fillRect(x, 0, 32, 32);
        ctx.fillStyle = PALETTE.uiPanel;
        ctx.fillRect(x + 32, 0, 32, 32);
      }
    });
    const arm = cast(new THREE.Mesh(roundedBox(g.hw * 2 + 0.2, 0.13, 0.13, 0.05, 1), new THREE.MeshStandardMaterial({ map: armTex, roughness: 0.5 })));
    arm.position.x = g.hw + 0.1;
    this.gateArm.add(arm);
    this.gateLampMat = new THREE.MeshStandardMaterial({ color: PALETTE.coral, emissive: new THREE.Color(PALETTE.coral), emissiveIntensity: 0.4, roughness: 0.3 });
    const gateLamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), this.gateLampMat);
    gateLamp.position.set(g.hw + 0.16, 1.1, 0);
    gateGroup.add(gateLamp);
    const gateSign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), new THREE.MeshStandardMaterial({ map: art.textures.gateSign, roughness: 0.6 }));
    gateSign.position.set(0, 1.45, -0.05);
    gateSign.rotation.x = -0.4;
    gateGroup.add(gateSign);
    for (const side of [-1, 1]) {
      const sp = cast(new THREE.Mesh(roundedBox(0.06, 0.6, 0.06, 0.02, 1), M.dark));
      sp.position.set(side * 0.6, 1.15, -0.08);
      gateGroup.add(sp);
    }
    // Road beyond the gate.
    const roadTex = art.textures.lane.clone();
    roadTex.needsUpdate = true;
    roadTex.repeat.set(1, 3);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(g.hw * 2, 8), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(g.x, 0.006, g.z + 4);
    road.receiveShadow = true;
    this.group.add(road);

    // Yard floor between field and bounds (cleared-floor colour).
    this.setBounds(layout.bounds);
  }

  /** Rebuild boundary curbs, yard floor and outside decoration for the current area size. */
  setBounds(b: WorldBounds): void {
    for (const c of [...this.boundsGroup.children]) {
      this.boundsGroup.remove(c);
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh || (c as THREE.InstancedMesh).isInstancedMesh) {
        mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material;
        if (mat !== this.art.mats.cream && mat !== this.art.mats.yellow && mat !== this.art.mats.green) mat.dispose();
      }
    }
    const M = this.art.mats;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 0.95 }));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set((b.minX + b.maxX) / 2, 0.002, (b.minZ + b.maxZ) / 2);
    yard.receiveShadow = true;
    this.boundsGroup.add(yard);

    // Low curbs along the edges (gap for the gate).
    const curbH = 0.16;
    const curbT = 0.22;
    const addCurb = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.1) return;
      const c = new THREE.Mesh(roundedBox(len, curbH, curbT, 0.07, 1), M.cream);
      c.position.set((x0 + x1) / 2, curbH / 2, (z0 + z1) / 2);
      c.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      c.castShadow = true;
      c.receiveShadow = true;
      this.boundsGroup.add(c);
    };
    const o = curbT / 2;
    addCurb(b.minX - o, b.minZ - o, b.maxX + o, b.minZ - o);
    addCurb(b.minX - o, b.minZ - o, b.minX - o, b.maxZ + o);
    addCurb(b.maxX + o, b.minZ - o, b.maxX + o, b.maxZ + o);
    addCurb(b.minX - o, b.maxZ + o, b.gateMinX - 0.35, b.maxZ + o);
    addCurb(b.gateMaxX + 0.35, b.maxZ + o, b.maxX + o, b.maxZ + o);
    // Yellow bollards at the corners.
    for (const [x, z] of [
      [b.minX - o, b.minZ - o],
      [b.maxX + o, b.minZ - o],
      [b.minX - o, b.maxZ + o],
      [b.maxX + o, b.maxZ + o],
    ]) {
      const p = new THREE.Mesh(roundedBox(0.34, 0.34, 0.34, 0.1, 1), M.yellow);
      p.position.set(x, 0.17, z);
      p.castShadow = true;
      this.boundsGroup.add(p);
    }

    // Toy trees outside the bounds (instanced).
    const rng = createRng(4242);
    const trunks: THREE.Matrix4[] = [];
    const crowns: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < 90 && crowns.length < 46; k++) {
      const side = Math.floor(rng() * 3);
      let x: number;
      let z: number;
      if (side === 0) {
        x = b.minX - 1.2 - rng() * 5;
        z = b.minZ + rng() * (d + 6);
      } else if (side === 1) {
        x = b.maxX + 1.2 + rng() * 5;
        z = b.minZ + rng() * (d + 6);
      } else {
        x = b.minX + rng() * w;
        z = b.minZ - 1.2 - rng() * 4;
      }
      const s = 0.75 + rng() * 0.6;
      trunks.push(m4.clone().compose(new THREE.Vector3(x, 0.2 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
      crowns.push(m4.clone().compose(new THREE.Vector3(x, 0.62 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.9, s)));
    }
    const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 0.4, 8), new THREE.MeshStandardMaterial({ color: '#B98A5E', roughness: 0.8 }), trunks.length);
    const crownMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.42, 1), M.green, crowns.length);
    trunks.forEach((m, i) => trunkMesh.setMatrixAt(i, m));
    crowns.forEach((m, i) => crownMesh.setMatrixAt(i, m));
    trunkMesh.castShadow = crownMesh.castShadow = true;
    this.boundsGroup.add(trunkMesh, crownMesh);
  }

  get hopperWorld(): THREE.Vector3 {
    return new THREE.Vector3(this.layout.hopper.x, this.layout.hopper.y, this.layout.hopper.z);
  }

  /** Emit a compressed bale down the output chute. */
  emitBale(): void {
    const b = this.bales.find((x) => !x.active);
    if (!b) return;
    b.active = true;
    b.t = 0;
    b.spin = (Math.random() - 0.5) * 2;
    b.mesh.visible = true;
  }

  /** Called per sold unit; bales come out at a bounded rate. */
  onSold(index: number): void {
    this.machinePulse = 1;
    if (index % 10 === 1) this.emitBale();
  }

  update(dt: number, feel: DepotFeel): void {
    this.time += dt;
    const rm = feel.reducedMotion ? 0.4 : 1;
    // Gear + piston run while processing, idle slowly otherwise.
    this.gearSpeed += ((feel.processing ? 5.5 : 0.35) - this.gearSpeed) * damp(4, dt);
    this.gear.rotation.z -= this.gearSpeed * dt;
    const twin = this.gear.userData.twin as THREE.Mesh;
    twin.rotation.z += this.gearSpeed * dt * 1.55;
    this.pistonT += dt * (feel.processing ? 7 : 0.8);
    const stroke = feel.processing ? Math.abs(Math.sin(this.pistonT)) : 0.2 + 0.05 * Math.sin(this.pistonT);
    this.piston.position.y = 1.12 + 0.05 + stroke * 0.18;
    this.machinePulse = Math.max(0, this.machinePulse - dt * 4);
    const pulse = 1 + this.machinePulse * 0.035 * rm;
    this.machineGroup.scale.set(pulse, 1 + this.machinePulse * 0.05 * rm, pulse);
    this.lampMat.emissiveIntensity = feel.processing ? 0.6 + 0.6 * (Math.sin(this.time * 14) > 0 ? 1 : 0) : 0.25;

    // Pad attention glow (full bin) and upgrade stand glow (near depot).
    const glowTarget = feel.attention ? 0.55 + 0.35 * Math.sin(this.time * 4) : 0;
    this.padGlowMat.opacity += (glowTarget - this.padGlowMat.opacity) * damp(6, dt);
    this.shedGlowMat.opacity += ((feel.nearUpgrade ? 0.45 : 0) - this.shedGlowMat.opacity) * damp(5, dt);

    // Gate arm lifts when the next area unlocks.
    const armTarget = feel.gateOpen ? 1.35 : 0;
    this.armAngle += (armTarget - this.armAngle) * damp(4, dt);
    this.gateArm.rotation.z = this.armAngle;
    this.gateLampMat.color.set(feel.gateOpen ? PALETTE.green : PALETTE.coral);
    this.gateLampMat.emissive.set(feel.gateOpen ? PALETTE.green : PALETTE.coral);
    this.gateLampMat.emissiveIntensity = feel.gateOpen ? 0.5 + 0.4 * Math.sin(this.time * 5) : 0.3;

    // Bales slide down the chute, rest, then shrink away.
    for (const b of this.bales) {
      if (!b.active) continue;
      b.t += dt;
      const slide = Math.min(1, b.t / 0.45);
      const e = easeOutCubic(slide);
      const p = b.mesh.position.lerpVectors(this.chuteTop, this.chuteBottom, e);
      if (b.t > 0.45) p.x += Math.min(0.5, (b.t - 0.45) * 1.2);
      b.mesh.rotation.set(0, b.spin * b.t, slide < 1 ? -0.55 : 0);
      const fade = b.t > 1.4 ? Math.max(0, 1 - (b.t - 1.4) / 0.3) : 1;
      b.mesh.scale.setScalar(fade);
      if (fade <= 0) {
        b.active = false;
        b.mesh.visible = false;
      }
    }
  }
}
