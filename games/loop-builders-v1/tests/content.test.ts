import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/config/levels';
import { getProject } from '../src/config/projects';
import { completedModuleCount } from '../src/game/building';
import { pickupDistance, trackFor } from '../src/game/economy';

describe('proyek bangunan', () => {
  for (const level of LEVELS) {
    const p = getProject(level.projectId);
    it(`${p.name}: biaya modul menjumlah target & tumbuh bertahap`, () => {
      expect(p.costs.reduce((a, b) => a + b, 0)).toBe(p.target);
      expect(Math.min(...p.costs)).toBeGreaterThanOrEqual(1);
      // urutan tahap tidak mundur
      for (let i = 1; i < p.modules.length; i++) expect(p.modules[i].stage).toBeGreaterThanOrEqual(p.modules[i - 1].stage);
      // pengiriman awal kecil (4 unit) sudah mengubah sesuatu yang terlihat
      expect(completedModuleCount(p, 4)).toBeGreaterThanOrEqual(1);
      // rumah tidak "kosong" sampai 50%: pada 25% progres, >= 15% modul sudah solid
      expect(completedModuleCount(p, p.target * 0.25) / p.modules.length).toBeGreaterThan(0.15);
      expect(p.modules.length).toBeGreaterThan(40);
      expect(p.material).toBe(level.material);
    });
  }

  it('material bata hanya dipakai di level kota', () => {
    for (const level of LEVELS) {
      if (level.material === 'brick') expect(level.theme).toBe('city');
      else expect(level.theme).not.toBe('city');
    }
  });
});

describe('tata letak level', () => {
  LEVELS.forEach((level, li) => {
    it(`${level.id}: slot di tepi jalan, urutan bongkar → A → B → C, loop membesar`, () => {
      let prevLen = 0;
      for (let stage = 0; stage < level.trackStages.length; stage++) {
        const track = trackFor(li, stage);
        expect(track.length).toBeGreaterThan(prevLen + 3);
        prevLen = track.length;
        const unlocked = level.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.unlockStage <= stage);
        let prevD = 0;
        for (const { s, i } of unlocked) {
          // penyimpanan tepat di tepi jalan (tidak di atas jalan, tidak terlalu jauh)
          const gap = track.closestDistance({ x: s.storage[0], z: s.storage[1] }).gap;
          expect(gap).toBeGreaterThan(1.1);
          expect(gap).toBeLessThan(1.7);
          // mesin tidak menimpa jalan
          const mg = track.closestDistance({ x: s.machine[0], z: s.machine[1] }).gap;
          expect(mg).toBeGreaterThan(1.3);
          const d = pickupDistance(li, stage, i);
          expect(d).toBeGreaterThan(prevD);
          prevD = d;
        }
      }
    });
  });
});
