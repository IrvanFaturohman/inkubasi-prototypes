import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { CITIES } from '../src/config/cities';
import {
  addMachine,
  addVehicle,
  canAddMachine,
  canAddVehicle,
  canExpand,
  canUpgrade,
  expandTrack,
  mergeAuto,
  nextProject,
  upgradeDepot,
} from '../src/game/actions';
import { addCost, buildingsDone, expandCost, findMergePair, machineCost, productionRate, trackOf, upgradeCost, vehicleCapacity } from '../src/game/economy';
import { streetsUnlocked } from '../src/game/layout';
import type { GameEvent } from '../src/game/events';
import { step } from '../src/game/sim';
import { createNewGame, createRuntime } from '../src/game/state';
import type { GameState, Runtime } from '../src/game/types';

/**
 * Bot pemain wajar (tanpa boost): selalu merge, lalu beli opsi termurah yang menjawab
 * bottleneck saat itu (angkut vs produksi) atau membuka jalan baru. Untuk menyetel angka.
 */
function decide(state: GameState, rt: Runtime, log: string[], t: number, ev: GameEvent[]): string | null {
  const stamp = `${t.toFixed(0).padStart(4)}s`;
  if (findMergePair(state)) {
    mergeAuto(state, ev);
    log.push(`${stamp} merge → ${state.vehicles.map((v) => v.level).join(',')}`);
    return 'merge';
  }
  const lap = trackOf(state).length / BALANCE.vehicleSpeed;
  const runs = streetsUnlocked(CITIES[state.levelIndex], state.expandStage).length;
  const transport = (state.vehicles.reduce((s, v) => s + vehicleCapacity(v.level), 0) * runs) / lap;
  const production = productionRate(state);
  type Opt = { cost: number; run: () => void; label: string };
  const opts: Opt[] = [];
  if (canAddVehicle(state).ok && transport < production * 1.15) opts.push({ cost: addCost(state), run: () => addVehicle(state, ev), label: 'add' });
  if (production < transport * 1.15) {
    const mc = machineCost(state);
    if (mc !== null && canAddMachine(state).ok) opts.push({ cost: mc, run: () => addMachine(state, ev), label: 'machine' });
    if (canUpgrade(state).ok) opts.push({ cost: upgradeCost(state), run: () => upgradeDepot(state, ev), label: `upgrade→${state.depot.level + 1}` });
  }
  const ec = expandCost(state);
  if (ec !== null && canExpand(state).ok) opts.push({ cost: ec * 0.7, run: () => expandTrack(state, rt, ev), label: `EXPAND→${state.expandStage + 1}` });
  if (!opts.length) return null;
  opts.sort((a, b) => a.cost - b.cost);
  opts[0].run();
  log.push(`${stamp} ${opts[0].label} (uang→${Math.floor(state.money)})`);
  return opts[0].label;
}

function playCity(state: GameState, maxSeconds: number) {
  const rt = createRuntime();
  const log: string[] = [];
  const ev: GameEvent[] = [];
  const firsts: Record<string, number> = {};
  let t = 0;
  let acc = 0;
  let rent = 0;
  let delivered = 0;
  while (!state.completed && t < maxSeconds) {
    ev.length = 0;
    step(state, rt, 1 / 30, ev);
    t += 1 / 30;
    acc += 1 / 30;
    for (const e of ev) {
      if (e.type === 'deliver') {
        delivered += e.money;
        firsts.deliver ??= t;
      }
      if (e.type === 'rent') {
        rent += e.amount;
        firsts.rent ??= t;
      }
      if (e.type === 'plotComplete') firsts.firstHouse ??= t;
      if (e.type === 'streetComplete') log.push(`${t.toFixed(0).padStart(4)}s  ✓ jalan ${e.street} selesai (+${e.bonus})`);
    }
    if (acc >= 0.5) {
      acc = 0;
      const r = decide(state, rt, log, t, ev);
      if (r === 'add') firsts.add ??= t;
      if (r === 'merge') firsts.merge ??= t;
      if (r?.startsWith('EXPAND→1')) firsts.expand1 = t;
      if (r?.startsWith('EXPAND→2')) firsts.expand2 = t;
      if (r?.startsWith('EXPAND→3')) firsts.expand3 = t;
      if (r === 'machine') firsts.machine ??= t;
    }
  }
  return { t, log, firsts, rent, delivered };
}

describe('pacing (bot)', () => {
  it('kedua kota selesai dengan tempo wajar tanpa softlock', () => {
    const state = createNewGame();
    const res = [];
    for (let ci = 0; ci < CITIES.length; ci++) {
      const r = playCity(state, 2400);
      res.push(r);
      const b = buildingsDone(state);
      console.log(`\n=== Kota ${ci + 1} (${CITIES[ci].id}) ${state.completed ? 'selesai' : 'BELUM'} dalam ${(r.t / 60).toFixed(2)} menit — bangunan ${b.done}/${b.total}`);
      console.log(`first: ${JSON.stringify(Object.fromEntries(Object.entries(r.firsts).map(([k, v]) => [k, Math.round(v)])))}`);
      console.log(`uang dari kiriman ${r.delivered}, dari sewa ${r.rent}; kendaraan ${state.vehicles.map((v) => v.level).join(',')} | depot Lv${state.depot.level} ×${state.depot.machines} | uang ${Math.floor(state.money)}`);
      console.log(r.log.join('\n'));
      expect(state.completed).toBe(true);
      nextProject(state, []);
    }
    const [c1, c2] = res;
    expect(c1.firsts.deliver).toBeLessThan(5);
    expect(c1.firsts.firstHouse).toBeLessThan(40);
    expect(c1.firsts.add).toBeLessThan(40);
    expect(c1.firsts.expand1).toBeLessThan(150);
    expect(c1.t).toBeGreaterThan(180);
    expect(c1.t).toBeLessThan(600);
    expect(c2.t).toBeLessThan(900);
  });
});
