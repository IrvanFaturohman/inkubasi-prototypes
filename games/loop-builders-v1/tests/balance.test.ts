import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/config/levels';
import {
  addVehicle,
  buildStation,
  canAddVehicle,
  canBuild,
  canExpand,
  canUpgrade,
  expandTrack,
  mergeAuto,
  nextProject,
  upgradeStation,
} from '../src/game/actions';
import { addCost, buildCost, expandCost, findMergePair, productionRate, trackOf, upgradeCost, vehicleCapacity } from '../src/game/economy';
import { BALANCE } from '../src/config/balance';
import type { GameEvent } from '../src/game/events';
import { step } from '../src/game/sim';
import { createNewGame, createRuntime } from '../src/game/state';
import type { GameState } from '../src/game/types';

/**
 * Bot sederhana yang meniru pemain wajar: selalu merge bila bisa, bangun mesin baru,
 * lalu membeli opsi termurah yang menjawab bottleneck saat itu (angkut vs produksi).
 * Tidak memakai boost → estimasi konservatif. Dipakai untuk menyetel angka di config.
 */
function botDecide(state: GameState, rt: ReturnType<typeof createRuntime>, log: string[], t: number, ev: GameEvent[]): void {
  const stamp = `${t.toFixed(0).padStart(4)}s`;
  if (findMergePair(state)) {
    mergeAuto(state, ev);
    log.push(`${stamp} merge → ${state.vehicles.map((v) => v.level).join(',')}`);
    return;
  }
  for (const st of state.stations) {
    if (!st.built && canBuild(state, st.slot).ok) {
      const c = buildCost(state, st.slot);
      buildStation(state, st.slot, ev);
      log.push(`${stamp} build slot ${st.slot} (${c})`);
      return;
    }
  }
  const L = trackOf(state).length;
  const loopTime = L / BALANCE.vehicleSpeed;
  const transport = state.vehicles.reduce((s, v) => s + vehicleCapacity(v.level), 0) / loopTime;
  const built = state.stations.filter((s) => s.built);
  const production = built.reduce((s, st) => s + productionRate(state, st), 0);

  type Opt = { cost: number; run: () => void; label: string };
  const opts: Opt[] = [];
  if (canAddVehicle(state).ok && (transport < production * 1.1 || state.vehicles.length < 2)) {
    opts.push({ cost: addCost(state), run: () => addVehicle(state, ev), label: 'add' });
  }
  const cheapestSt = [...built].sort((a, b) => upgradeCost(state, a) - upgradeCost(state, b))[0];
  if (cheapestSt && canUpgrade(state, cheapestSt.slot).ok && production < transport * 1.1) {
    opts.push({ cost: upgradeCost(state, cheapestSt), run: () => upgradeStation(state, cheapestSt.slot, ev), label: `upgrade ${cheapestSt.slot}→${cheapestSt.level + 1}` });
  }
  const ec = expandCost(state);
  if (ec !== null && canExpand(state).ok) {
    opts.push({
      cost: ec,
      run: () => {
        expandTrack(state, rt, ev);
      },
      label: `EXPAND → ${state.expandStage + 1}`,
    });
  }
  if (!opts.length) return;
  opts.sort((a, b) => a.cost - b.cost);
  const o = opts[0];
  o.run();
  log.push(`${stamp} ${o.label} (${o.cost}) money→${Math.floor(state.money)}`);
}

function playLevel(state: GameState, maxSeconds: number) {
  const rt = createRuntime();
  const log: string[] = [];
  const ev: GameEvent[] = [];
  let t = 0;
  let decide = 0;
  const h = 1 / 30;
  const firsts: Record<string, number> = {};
  while (!state.completed && t < maxSeconds) {
    ev.length = 0;
    step(state, rt, h, ev);
    t += h;
    decide += h;
    for (const e of ev) {
      if (e.type === 'unload' && firsts.firstUnload === undefined) firsts.firstUnload = t;
      if (e.type === 'stageComplete') log.push(`${t.toFixed(0).padStart(4)}s  ✓ tahap ${e.stage} selesai (+${e.bonus})`);
    }
    if (decide >= 0.5) {
      decide = 0;
      const before = log.length;
      botDecide(state, rt, log, t, ev);
      for (const line of log.slice(before)) {
        if (line.includes('add') && firsts.add === undefined) firsts.add = t;
        if (line.includes('merge') && firsts.merge === undefined) firsts.merge = t;
        if (line.includes('EXPAND → 1')) firsts.expand1 = t;
        if (line.includes('EXPAND → 2')) firsts.expand2 = t;
        if (line.includes('upgrade') && firsts.upgrade === undefined) firsts.upgrade = t;
      }
    }
  }
  return { t, log, firsts, vehicles: state.vehicles.map((v) => v.level), stations: state.stations.map((s) => (s.built ? s.level : 0)) };
}

describe('pacing (bot)', () => {
  it('ketiga level bisa diselesaikan dengan tempo yang wajar tanpa softlock', () => {
    const state = createNewGame();
    const results = [];
    for (let li = 0; li < LEVELS.length; li++) {
      const r = playLevel(state, 1800);
      results.push(r);
      console.log(`\n=== Level ${li + 1} (${LEVELS[li].id}) selesai dalam ${(r.t / 60).toFixed(2)} menit ===`);
      console.log(`first: ${JSON.stringify(Object.fromEntries(Object.entries(r.firsts).map(([k, v]) => [k, Math.round(v)])))}`);
      console.log(`akhir: kendaraan ${r.vehicles.join(',')} | stasiun ${r.stations.join(',')} | uang ${Math.floor(state.money)}`);
      console.log(r.log.join('\n'));
      expect(state.completed).toBe(true);
      nextProject(state, []);
    }
    const [l1, l2, l3] = results;
    expect(l1.t).toBeGreaterThan(120);
    expect(l1.t).toBeLessThan(420);
    expect(l1.firsts.firstUnload).toBeLessThan(6);
    expect(l1.firsts.add).toBeLessThan(40);
    expect(l1.firsts.merge).toBeLessThan(120);
    expect(l1.firsts.expand1).toBeLessThan(150);
    expect(l1.firsts.expand2).toBeDefined();
    expect(l2.t).toBeLessThan(900);
    expect(l3.t).toBeLessThan(1200);
  });
});
