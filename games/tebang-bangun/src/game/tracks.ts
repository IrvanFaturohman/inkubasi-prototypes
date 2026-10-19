import { LEVELS } from '../config/levels';
import { plotsOfLevel, pickupPoints, stageDef } from './layout';
import { buildStageMapping, TrackPath, type StageMapping } from './track';

/** Cache lintasan per (level, tahap) & peta antar tahap (dipakai logika dan render). */
const trackCache = new Map<string, TrackPath>();

export function trackFor(levelIndex: number, stage: number): TrackPath {
  const key = `${levelIndex}:${stage}`;
  let t = trackCache.get(key);
  if (!t) {
    t = new TrackPath(stageDef(LEVELS[levelIndex], stage));
    trackCache.set(key, t);
  }
  return t;
}

const mappingCache = new Map<string, StageMapping>();

/** Peta jarak lintasan tahap `from` → `to`. Titik kunci bersama: sisi stasiun & kavling lama. */
export function stageMapping(levelIndex: number, from: number, to: number): StageMapping {
  const key = `${levelIndex}:${from}:${to}`;
  let m = mappingCache.get(key);
  if (!m) {
    const level = LEVELS[levelIndex];
    const lo = Math.min(from, to);
    const shared = [...pickupPoints(level), ...plotsOfLevel(levelIndex).filter((p) => level.streets[p.street].unlockStage <= lo).map((p) => p.anchor)];
    m = buildStageMapping(trackFor(levelIndex, from), trackFor(levelIndex, to), shared);
    mappingCache.set(key, m);
  }
  return m;
}
