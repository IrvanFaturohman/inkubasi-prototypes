import { describe, expect, it } from 'vitest';
import { getBuilding } from '../src/config/buildings';
import { CITIES } from '../src/config/cities';
import { completedModuleCount } from '../src/game/building';
import { pickupDistance, plotDistance, plotsOf, trackFor } from '../src/game/economy';
import { LOT_D, LOT_W, pickupPoints, stageCount } from '../src/game/layout';

/** Kotak kavling (sumbu-sejajar karena semua jalan lurus sejajar sumbu). */
function lotRect(p: ReturnType<typeof plotsOf>[number]) {
  const alongX = Math.abs(p.facing.z) > 0.5; // menghadap ±z → lebar kavling di sumbu x
  const hx = (alongX ? LOT_W : LOT_D) / 2;
  const hz = (alongX ? LOT_D : LOT_W) / 2;
  return { minX: p.pos.x - hx, maxX: p.pos.x + hx, minZ: p.pos.z - hz, maxZ: p.pos.z + hz };
}

describe('tata letak kota', () => {
  CITIES.forEach((city, ci) => {
    it(`${city.id}: loop tertutup valid & makin panjang tiap jalan baru`, () => {
      let prev = 0;
      for (let s = 0; s < stageCount(city); s++) {
        const t = trackFor(ci, s);
        expect(t.clockwise).toBe(true);
        expect(t.length).toBeGreaterThan(prev + 5);
        prev = t.length;
      }
    });

    it(`${city.id}: kavling tidak menimpa jalan maupun kavling lain`, () => {
      const plots = plotsOf(ci);
      const full = trackFor(ci, stageCount(city) - 1);
      const lots = plots.map(lotRect);
      // jalan (garis tengah + setengah lebar jalan & kerb) tidak masuk kavling
      const margin = 0.8;
      const pt = { x: 0, z: 0 };
      for (let d = 0; d < full.length; d += 0.1) {
        full.pointAt(d, pt);
        for (const r of lots) {
          const inside = pt.x > r.minX - margin && pt.x < r.maxX + margin && pt.z > r.minZ - margin && pt.z < r.maxZ + margin;
          expect(inside).toBe(false);
        }
      }
      for (let i = 0; i < lots.length; i++) {
        for (let j = i + 1; j < lots.length; j++) {
          const a = lots[i];
          const b = lots[j];
          const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
          expect(overlap, `kavling ${i} & ${j}`).toBe(false);
        }
      }
    });

    it(`${city.id}: titik jangkar kavling & pickup tepat di lintasan, urut sesuai arah truk`, () => {
      for (let s = 0; s < stageCount(city); s++) {
        const t = trackFor(ci, s);
        for (const p of pickupPoints(city)) expect(t.closestDistance(p).gap).toBeLessThan(0.45);
        const open = plotsOf(ci).filter((p) => city.streets[p.street].unlockStage <= s);
        for (const p of open) expect(t.closestDistance(p.anchor).gap).toBeLessThan(0.02);
        // urutan dalam satu jalan: berangkat → ujung → pulang, dan pickup sisi jalan itu di depannya
        for (const si of new Set(open.map((p) => p.street))) {
          const ds = open.filter((p) => p.street === si).map((p) => plotDistance(ci, s, p.index));
          const side = ['N', 'E', 'S', 'W'].indexOf(city.streets[si].side);
          const pd = pickupDistance(ci, s, side);
          const rel = ds.map((d) => (d - pd + t.length) % t.length);
          for (let k = 1; k < rel.length; k++) expect(rel[k]).toBeGreaterThan(rel[k - 1]);
        }
      }
    });

    it(`${city.id}: bangunan pertama langsung tumbuh dari kiriman kecil`, () => {
      for (const p of plotsOf(ci)) {
        const proj = getBuilding(p.def.building, p.def.variant, p.def.target);
        expect(proj.costs.reduce((a, b) => a + b, 0)).toBe(proj.target);
        expect(proj.modules.length).toBeGreaterThan(8);
        expect(completedModuleCount(proj, 4)).toBeGreaterThanOrEqual(1);
        expect(proj.material).toBe(city.material);
      }
    });
  });

  it('material bata hanya di kota, kayu tidak di kota', () => {
    for (const c of CITIES) expect(c.material === 'brick').toBe(c.theme === 'city');
  });
});
