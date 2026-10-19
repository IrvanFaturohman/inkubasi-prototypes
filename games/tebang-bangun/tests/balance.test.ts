import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/config/levels';
import {
  addWagon,
  canAddWagon,
  canExpand,
  canMerge,
  canUpgradeCapacity,
  canUpgradeSpeed,
  expandTrack,
  mergeWagons,
  nextProject,
  upgradeCapacity,
  upgradeSpeed,
} from '../src/game/actions';
import { addCost, buildingsDone, capacityCost, expandCost, forestCleared, isPlotComplete, isPlotUnlocked, mergeCost, speedCost } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { step } from '../src/game/sim';
import { createNewGame, createRuntime } from '../src/game/state';
import type { GameState, Runtime } from '../src/game/types';

/**
 * Bot pemain wajar (tanpa boost): beli opsi termurah yang masuk akal saat itu.
 * Kapasitas diprioritaskan bila gergaji sering berhenti karena penuh; rel baru dibeli
 * saat semua bangunan di cabang terbuka sudah jadi (atau jauh lebih murah dari opsi lain);
 * selama menunggu rel baru, bot menabung dan hanya membeli upgrade yang murah.
 */
function decide(state: GameState, rt: Runtime, fullRatio: number): string | null {
  type Opt = { cost: number; run: () => void; label: string };
  const opts: Opt[] = [];
  if (canMerge(state).ok) opts.push({ cost: mergeCost(state) * 0.8, run: () => mergeWagons(state, []), label: 'merge' });
  if (canAddWagon(state).ok) opts.push({ cost: addCost(state), run: () => addWagon(state, []), label: 'add' });
  const sc = speedCost(state);
  if (sc !== null && canUpgradeSpeed(state).ok) opts.push({ cost: sc * 1.1, run: () => upgradeSpeed(state, []), label: 'speed' });
  const cc = capacityCost(state);
  if (cc !== null && canUpgradeCapacity(state).ok) opts.push({ cost: cc * (fullRatio > 0.3 ? 0.6 : 1.3), run: () => upgradeCapacity(state, []), label: 'capacity' });
  const ec = expandCost(state);
  const openDone = state.plots.every((_, i) => !isPlotUnlocked(state, i) || isPlotComplete(state, i));
  if (ec !== null && canExpand(state).ok) opts.push({ cost: openDone ? 0 : ec * 0.9, run: () => expandTrack(state, rt, []), label: `EXPAND→${state.expandStage + 1}` });
  if (!opts.length) return null;
  opts.sort((a, b) => a.cost - b.cost);
  // Cabang terbuka sudah jadi semua → menabung untuk rel baru, hanya belanja yang murah.
  if (openDone && ec !== null && opts[0].cost > ec * 0.3) return null;
  opts[0].run();
  return opts[0].label;
}

function playLevel(state: GameState, maxSeconds: number) {
  const rt = createRuntime();
  const ev: GameEvent[] = [];
  const firsts: Record<string, number> = {};
  const log: string[] = [];
  const buys: Record<string, number> = {};
  let t = 0;
  let acc = 0;
  let full = 0;
  let sampled = 0;
  let rent = 0;
  let sold = 0;
  while (!state.completed && t < maxSeconds) {
    ev.length = 0;
    step(state, rt, 1 / 30, ev);
    t += 1 / 30;
    acc += 1 / 30;
    sampled++;
    if (rt.fullTime > 0) full++;
    for (const e of ev) {
      if (e.type === 'cut') firsts.cut ??= t;
      if (e.type === 'sell') {
        sold += e.money;
        firsts.sell ??= t;
      }
      if (e.type === 'plotReady') firsts.plotReady ??= t;
      if (e.type === 'plotComplete') firsts.house ??= t;
      if (e.type === 'rent') rent += e.amount;
      if (e.type === 'streetComplete') log.push(`${t.toFixed(0).padStart(4)}s ✓ jalur ${e.street} lengkap`);
    }
    if (acc >= 1) {
      acc = 0;
      const label = decide(state, rt, full / Math.max(1, sampled));
      full = 0;
      sampled = 0;
      if (label) {
        buys[label.startsWith('EXPAND') ? 'expand' : label] = (buys[label.startsWith('EXPAND') ? 'expand' : label] ?? 0) + 1;
        if (label.startsWith('EXPAND')) log.push(`${t.toFixed(0).padStart(4)}s ${label} (bangunan ${buildingsDone(state).done})`);
        firsts[label] ??= t;
      }
    }
  }
  return { t, firsts, log, buys, rent, sold };
}

describe('pacing (bot)', () => {
  it('kedua level selesai dengan tempo wajar tanpa softlock', () => {
    const state = createNewGame();
    const results = [];
    for (let li = 0; li < LEVELS.length; li++) {
      const r = playLevel(state, 3600);
      results.push(r);
      const b = buildingsDone(state);
      console.log(`\n=== Level ${li + 1} ${LEVELS[li].id}: ${state.completed ? 'selesai' : 'BELUM'} ${(r.t / 60).toFixed(2)} menit — bangunan ${b.done}/${b.total}, hutan ${(forestCleared(state) * 100).toFixed(0)}%`);
      console.log(`first: ${JSON.stringify(Object.fromEntries(Object.entries(r.firsts).map(([k, v]) => [k, Math.round(v)])))}`);
      console.log(`beli: ${JSON.stringify(r.buys)} | uang jual ${Math.round(r.sold)} sewa ${r.rent} | gerbong ${state.train.wagons.join(',')} spd${state.speedLevel} cap${state.capacityLevel} | uang ${Math.floor(state.money)}`);
      console.log(r.log.join('\n'));
      expect(state.completed).toBe(true);
      nextProject(state, []);
    }
    const [l1, l2] = results;
    expect(l1.firsts.cut).toBeLessThan(3);
    expect(l1.firsts.sell).toBeLessThan(20);
    expect(l1.firsts.house).toBeLessThan(120);
    expect(l1.t).toBeGreaterThan(180);
    expect(l1.t).toBeLessThan(900);
    expect(l2.t).toBeLessThan(1200);
  });
});
