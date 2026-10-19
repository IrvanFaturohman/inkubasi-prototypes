import { describe, expect, it } from 'vitest';
import { getBuilding } from '../src/config/buildings';
import { LEVELS } from '../src/config/levels';
import { completedModuleCount } from '../src/game/building';
import { plotDistance, plotsOf, trackFor } from '../src/game/economy';
import { LOT_D, LOT_W, stageCount } from '../src/game/layout';
import { fieldFor, initialBlocks } from '../src/game/worldgen';

function lotRect(p: ReturnType<typeof plotsOf>[number]) {
  const alongX = Math.abs(p.facing.z) > 0.5;
  const hx = (alongX ? LOT_W : LOT_D) / 2;
  const hz = (alongX ? LOT_D : LOT_W) / 2;
  return { minX: p.pos.x - hx, maxX: p.pos.x + hx, minZ: p.pos.z - hz, maxZ: p.pos.z + hz };
}

describe('tata letak & hutan', () => {
  LEVELS.forEach((level, li) => {
    it(`${level.id}: loop valid & makin panjang tiap rel baru`, () => {
      let prev = 0;
      for (let s = 0; s < stageCount(level); s++) {
        const t = trackFor(li, s);
        expect(t.clockwise).toBe(true);
        expect(t.length).toBeGreaterThan(prev + 5);
        prev = t.length;
      }
    });

    it(`${level.id}: kavling tidak menimpa rel maupun kavling lain`, () => {
      const plots = plotsOf(li);
      const full = trackFor(li, stageCount(level) - 1);
      const lots = plots.map(lotRect);
      const pt = { x: 0, z: 0 };
      for (let d = 0; d < full.length; d += 0.1) {
        full.pointAt(d, pt);
        for (const r of lots) expect(pt.x > r.minX - 0.7 && pt.x < r.maxX + 0.7 && pt.z > r.minZ - 0.7 && pt.z < r.maxZ + 0.7).toBe(false);
      }
      for (let i = 0; i < lots.length; i++)
        for (let j = i + 1; j < lots.length; j++) {
          const a = lots[i];
          const b = lots[j];
          expect(a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ, `kavling ${i} & ${j}`).toBe(false);
        }
    });

    it(`${level.id}: jangkar kavling di rel & urut sesuai arah kereta`, () => {
      for (let s = 0; s < stageCount(level); s++) {
        const t = trackFor(li, s);
        const open = plotsOf(li).filter((p) => level.streets[p.street].unlockStage <= s);
        for (const p of open) expect(t.closestDistance(p.anchor).gap).toBeLessThan(0.02);
        for (const si of new Set(open.map((p) => p.street))) {
          const ds = open.filter((p) => p.street === si).map((p) => plotDistance(li, s, p.index));
          for (let k = 1; k < ds.length; k++) expect(ds[k]).toBeGreaterThan(ds[k - 1]);
        }
      }
    });

    it(`${level.id}: hutan menutupi kavling, rel tahap 0 & lapangan stasiun bersih`, () => {
      const f = fieldFor(li);
      const hp = initialBlocks(li);
      for (const cells of f.plotCells) {
        expect(cells.length).toBeGreaterThanOrEqual(2);
        for (const c of cells) expect(hp[c]).toBeGreaterThan(0);
      }
      const t = trackFor(li, 0);
      const p = { x: 0, z: 0 };
      for (let d = 0; d < t.length; d += 0.3) {
        t.pointAt(d, p);
        const i = Math.floor(p.x + f.half);
        const j = Math.floor(p.z + f.half);
        expect(hp[j * f.cols + i]).toBe(-1);
      }
      const center = Math.floor(f.half) * f.cols + Math.floor(f.half);
      expect(hp[center]).toBe(-1);
    });

    it(`${level.id}: bangunan langsung tumbuh dari kiriman kecil`, () => {
      for (const p of plotsOf(li)) {
        const proj = getBuilding(p.def.building, p.def.variant, p.def.target);
        expect(proj.costs.reduce((a, b) => a + b, 0)).toBe(proj.target);
        expect(completedModuleCount(proj, 4)).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
