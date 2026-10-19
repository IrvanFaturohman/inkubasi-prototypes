/**
 * Pacing check: a scripted player runs the real simulation and reports when key moments
 * happen. `npm run balance` — tweak src/config.ts and re-run.
 *
 * Scenario A: brand-new game, the player holds the field the whole time and buys greedily.
 * Scenario B: continue from A's 3-minute state with NO input at all (Auto Drive only).
 */
import { FIELDS, SIM_DT } from '../src/config';
import { Game, defaultState } from '../src/economy';
import type { FieldId, UpgradeKind } from '../src/types';

type Log = { t: number; msg: string }[];

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function botBuy(g: Game, log: Log, t: number): void {
  const id: FieldId = g.state.current;
  const f = g.state.fields[id];
  const tryBuy = (k: UpgradeKind, why: string) => {
    if (g.buy(k, id)) {
      log.push({ t, msg: `${id}: buy ${k.toUpperCase()} (${why}) → $${Math.round(g.state.money)} left` });
      return true;
    }
    return false;
  };
  // Corn when possible.
  if (!g.state.fields.corn.unlocked && g.unlockInfo('corn').canBuy) {
    g.unlockField('corn');
    log.push({ t, msg: `OPEN CORN FIELD → $${Math.round(g.state.money)} left` });
    return;
  }
  // Mission first.
  const mis = g.mission(id);
  if (mis?.kind === 'unlockCorn') {
    const info = g.unlockInfo('corn');
    // Save up once the requirements are met; keep upgrading while they aren't.
    if (!info.needsAuto && g.state.lifetime >= info.lifetimeNeeded) return;
  }
  if (mis) {
    const map: Record<string, UpgradeKind | undefined> = { add: 'add', merge: 'merge', auto: 'auto', expand: 'expand', deepRows: 'expand' };
    const k = map[mis.kind];
    if (k && tryBuy(k, 'mission')) return;
    // Don't spend below the mission price when it's close.
    if (k) {
      const o = g.offer(k, id);
      if (o.state === 'poor' && o.cost < g.state.money * 1.6 && o.cost > 0) return;
    }
  }
  // Bottleneck hint.
  const b = g.bottleneck(id);
  if (b.hint && tryBuy(b.hint, `hint:${b.kind}`)) return;
  // Otherwise the cheapest useful thing.
  const opts: UpgradeKind[] = ['add', 'merge', 'storage', 'water', 'speed'];
  if (!f.auto) opts.push('auto');
  const offers = opts.map((k) => g.offer(k, id)).filter((o) => o.state === 'ok').sort((a, b) => a.cost - b.cost);
  if (offers.length) tryBuy(offers[0].kind, 'cheapest');
}

function play(g: Game, seconds: number, hold: boolean, log: Log, startT = 0): void {
  const steps = Math.round(seconds / SIM_DT);
  let firstSale = false;
  let nextMinute = startT + 60;
  for (let i = 0; i < steps; i++) {
    g.holding = hold;
    g.step(SIM_DT);
    const t = startT + (i + 1) * SIM_DT;
    for (const e of g.drainEvents()) {
      if (e.type === 'sell' && !firstSale && startT === 0) {
        firstSale = true;
        log.push({ t, msg: `first sale: ${e.units} ${FIELDS[e.field].cropName} → $${e.amount}` });
      }
      if (e.type === 'mission') log.push({ t, msg: `mission done: ${e.text} (+$${e.reward})` });
    }
    if (i % 15 === 0) botBuy(g, log, t);
    if (t >= nextMinute - 1e-9) {
      const w = g.state.fields.wheat;
      const c = g.state.fields.corn;
      const hs = (id: FieldId) => g.state.fields[id].harvesters.map((h) => `T${h.tier}`).join(' ');
      log.push({
        t,
        msg:
          `── ${fmt(t)} money $${Math.round(g.state.money)} lifetime $${Math.round(g.state.lifetime)} ` +
          `| wheat $${Math.round(g.incomePerMin('wheat'))}/min [${hs('wheat')}] W${w.water} S${w.speed} St${w.storage} E${w.expand} ` +
          `bottleneck=${g.bottleneck('wheat').kind}` +
          (c.unlocked ? ` | corn $${Math.round(g.incomePerMin('corn'))}/min [${hs('corn')}] auto=${c.auto}` : ''),
      });
      nextMinute += 60;
    }
  }
}

const logA: Log = [];
const g = new Game(defaultState(0));
play(g, 180, true, logA);
const snapshot = JSON.parse(JSON.stringify(g.state));
play(g, 420, true, logA, 180);
console.log('\n=== Scenario A: new game, active player (hold), 10 minutes ===');
for (const l of logA) console.log(`${fmt(l.t).padStart(5)}  ${l.msg}`);

const logB: Log = [];
const g2 = new Game(snapshot);
g2.state.current = 'wheat';
play(g2, 300, false, logB, 180);
console.log('\n=== Scenario B: from 3:00 state, no input at all for 5 minutes (Auto Drive only) ===');
for (const l of logB) console.log(`${fmt(l.t).padStart(5)}  ${l.msg}`);

// Merge value check: 2×T1 vs 1×T2 at the same upgrades, auto only, 3 minutes.
const compare = (tiers: number[], water: number, hold: boolean) => {
  const st = defaultState(0);
  const gg = new Game(st);
  const f = gg.state.fields.wheat;
  f.auto = true;
  f.water = water;
  f.harvesters = [];
  const L = gg.rt.wheat.layout.path.length;
  tiers.forEach((t, i) => f.harvesters.push({ id: i + 1, tier: t as 1 | 2 | 3, s: (i * L) / tiers.length, cargo: 0 }));
  gg.holding = hold;
  const steps = Math.round(180 / SIM_DT);
  for (let i = 0; i < steps; i++) gg.step(SIM_DT);
  return Math.round(gg.state.money / 3);
};
console.log('\n=== Merge check ($/min over 3 min) ===');
for (const water of [0, 4]) {
  for (const hold of [false, true]) {
    console.log(
      `water ${water} ${hold ? 'hold' : 'auto'}:  2×T1 $${compare([1, 1], water, hold)}  |  1×T2 $${compare([2], water, hold)}  |  T2+T1 $${compare([2, 1], water, hold)}  |  4×T1 $${compare([1, 1, 1, 1], water, hold)}  |  2×T2 $${compare([2, 2], water, hold)}`,
    );
  }
}
