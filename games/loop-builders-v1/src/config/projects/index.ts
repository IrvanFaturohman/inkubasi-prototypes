import type { FinalProject, ProjectDefinition } from '../../game/types';
import { finalizeProject } from '../../game/building';
import { buildCabin } from './cabin';
import { buildBigHouse } from './bigHouse';
import { buildBrickHouse } from './brickHouse';

/** Daftar proyek. Tambahkan builder baru di sini lalu rujuk id-nya dari levels.ts. */
const BUILDERS: Record<string, () => ProjectDefinition> = {
  cabin: buildCabin,
  bighouse: buildBigHouse,
  brickhouse: buildBrickHouse,
};

const cache = new Map<string, FinalProject>();

/** Proyek final (biaya modul integer, ambang kumulatif). Di-cache per (id, skala). */
export function getProject(id: string, targetScale = 1): FinalProject {
  const key = `${id}@${targetScale.toFixed(3)}`;
  let p = cache.get(key);
  if (!p) {
    const builder = BUILDERS[id];
    if (!builder) throw new Error(`Proyek tidak dikenal: ${id}`);
    p = finalizeProject(builder(), targetScale);
    cache.set(key, p);
  }
  return p;
}

export function hasProject(id: string): boolean {
  return id in BUILDERS;
}
