import { describe, expect, it } from 'vitest';
import { FIELDS, GEOMETRY, SIM_DT, TIERS } from '../src/config';
import { FixedClock } from '../src/clock';
import { Game, defaultState } from '../src/economy';
import { deserialize, serialize } from '../src/save';
import type { GameState } from '../src/types';

const run = (g: Game, seconds: number, dt = SIM_DT) => {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) g.step(dt);
};

const fresh = (): Game => new Game(defaultState(0));

/** Put a harvester just before lane 0 (header behind the first column), past the silo. */
const placeAtStart = (g: Game) => {
  const L = g.rt[g.state.current].layout.path.length;
  g.current.harvesters[0].s = L - 0.3;
};

describe('harvesting', () => {
  it('cuts only mature patches within Tier 1 reach', () => {
    const g = fresh();
    placeAtStart(g);
    const f = g.current;
    const L = g.rt.wheat.layout;
    // Make every second near patch in corridor 0 unripe.
    const near0 = L.patches.filter((p) => p.corridor === 0 && p.strip === 1);
    near0.forEach((p, i) => (f.growth[p.idx] = i % 2 === 0 ? 1 : 0.6));
    const ripeBefore = near0.filter((p) => f.growth[p.idx] >= 1).length; // 6
    g.holding = true;
    // Drive just the length of lane 0 (6.6 units) — stay short of silo.
    const v = g.speed(f) * 1.75;
    run(g, 7.2 / v + 0.5);
    g.holding = false;
    run(g, 1);
    const h = f.harvesters[0];
    expect(h.cargo).toBe(ripeBefore);
    // The unripe ones were not cut (only grew a bit).
    near0.forEach((p, i) => {
      if (i % 2 === 1) expect(f.growth[p.idx]).toBeGreaterThan(0.6);
      else expect(f.growth[p.idx]).toBeLessThan(0.5);
    });
    // Strip 2 is out of Tier 1 reach and stays ripe.
    const strip2 = L.patches.filter((p) => p.corridor === 0 && p.strip === 2);
    strip2.forEach((p) => expect(f.growth[p.idx]).toBe(1));
  });

  it('full storage stops cutting without discarding crops', () => {
    const g = fresh();
    placeAtStart(g);
    const f = g.current;
    g.holding = true;
    run(g, 5);
    const h = f.harvesters[0];
    const cap = g.capacity(f, 1);
    expect(h.cargo).toBe(cap);
    const L = g.rt.wheat.layout;
    const near0 = L.patches.filter((p) => p.corridor === 0 && p.strip === 1);
    const cut = near0.filter((p) => f.growth[p.idx] < 0.5).length;
    expect(cut).toBe(cap); // 12 near patches on lane 0, only 8 fit
    expect(near0.filter((p) => f.growth[p.idx] >= 1).length).toBe(near0.length - cap);
    expect(g.state.money).toBe(0); // nothing sold before the silo
  });

  it('sells at the silo exactly once per pass and nothing for an empty crate', () => {
    const g = fresh();
    const f = g.current;
    const L = g.rt.wheat.layout;
    const h = f.harvesters[0];
    for (let i = 0; i < f.growth.length; i++) f.growth[i] = 0; // nothing to pick up after the silo
    h.s = L.siloS - 1;
    h.cargo = 5;
    g.holding = true;
    run(g, 1.2);
    expect(g.state.money).toBe(5 * FIELDS.wheat.unitValue);
    expect(h.cargo).toBe(0);
    expect(f.sales).toBe(1);
    // Keep driving a moment past the silo: no second payment.
    run(g, 0.5);
    expect(g.state.money).toBe(20);
    // Empty pass: no money, no sale counted.
    h.s = L.siloS - 0.5;
    for (let i = 0; i < f.growth.length; i++) f.growth[i] = 0;
    run(g, 1);
    expect(g.state.money).toBe(20);
    expect(f.sales).toBe(1);
    const sellEvents = g.drainEvents().filter((e) => e.type === 'sell');
    expect(sellEvents.length).toBe(1);
  });

  it('crop regrows through its stages and becomes harvestable again', () => {
    const g = fresh();
    const f = g.current;
    f.growth[0] = 0;
    const gt = g.growTime(f);
    run(g, gt * 0.3);
    expect(f.growth[0]).toBeGreaterThan(0.2);
    expect(f.growth[0]).toBeLessThan(0.45);
    run(g, gt * 0.9);
    expect(f.growth[0]).toBe(1);
  });
});

describe('merge', () => {
  it('keeps all cargo and really widens the reach', () => {
    const g = fresh();
    g.state.money = 10_000;
    const f = g.current;
    expect(g.buy('add')).toBe(true);
    f.harvesters[0].cargo = 7;
    f.harvesters[1].cargo = 8;
    expect(g.offer('merge').state).toBe('ok');
    expect(g.buy('merge')).toBe(true);
    expect(f.harvesters.length).toBe(1);
    const h = f.harvesters[0];
    expect(h.tier).toBe(2);
    expect(h.cargo).toBe(15);
    expect(g.capacity(f, 2)).toBeGreaterThanOrEqual(2 * g.capacity(f, 1));

    // Tier 2 now cuts strip 2 on lane 0.
    h.cargo = 0;
    placeAtStart(g);
    g.holding = true;
    const v = g.speed(f) * 1.75;
    run(g, 7.2 / v + 0.5);
    const L = g.rt.wheat.layout;
    const strip2 = L.patches.filter((p) => p.corridor === 0 && p.strip === 2);
    // Columns hold 2 near + 2 deep patches; the 18-unit crate fills after 4.5 columns.
    const deepCut = strip2.filter((p) => f.growth[p.idx] < 0.5).length;
    expect(deepCut).toBeGreaterThanOrEqual(8);
    expect(h.cargo).toBe(18);
  });

  it('refuses when no two harvesters share a tier', () => {
    const g = fresh();
    g.state.money = 10_000;
    expect(g.offer('merge').state).toBe('locked');
    g.buy('add');
    g.buy('merge');
    g.buy('add');
    // one T2 + one T1 → no valid pair
    expect(g.offer('merge').state).toBe('locked');
    expect(g.buy('merge')).toBe(false);
    expect(g.current.harvesters.map((h) => h.tier).sort()).toEqual([1, 2]);
  });
});

describe('automation & fields', () => {
  it('Auto Drive harvests and sells for 2 minutes without any input', () => {
    const g = fresh();
    const f = g.current;
    f.auto = true;
    run(g, 120);
    expect(f.sales).toBeGreaterThanOrEqual(5);
    expect(g.state.money).toBeGreaterThan(100);
  });

  it('without Auto Drive nothing moves when there is no input', () => {
    const g = fresh();
    run(g, 60);
    expect(g.state.money).toBe(0);
  });

  it('Wheat keeps producing while Corn is on screen, with no double counting', () => {
    const g = fresh();
    const st = g.state;
    st.fields.wheat.auto = true;
    st.lifetime = 1e6;
    st.money = 1e6;
    expect(g.unlockField('corn')).toBe(true);
    expect(st.current).toBe('corn');
    const wheatBefore = st.fields.wheat.earned;
    const moneyBefore = st.money;
    run(g, 90);
    const wheatGain = st.fields.wheat.earned - wheatBefore;
    const cornGain = st.fields.corn.earned;
    expect(wheatGain).toBeGreaterThan(0);
    expect(cornGain).toBe(0); // corn has no auto and nobody is holding
    // Money moved by exactly what the fields earned plus mission rewards.
    const rewards = g.drainEvents().filter((e) => e.type === 'mission').reduce((a, e) => a + (e.type === 'mission' ? e.reward : 0), 0);
    expect(st.money - moneyBefore).toBeCloseTo(wheatGain + rewards, 6);
  });

  it('income does not depend on frame rate', () => {
    const a = fresh();
    const b = fresh();
    a.current.auto = true;
    b.current.auto = true;
    const ca = new FixedClock();
    const cb = new FixedClock();
    for (let t = 0; t < 60; t += 1 / 144) ca.advance(1 / 144, (dt) => a.step(dt));
    for (let t = 0; t < 60; t += 1 / 24) cb.advance(1 / 24, (dt) => b.step(dt));
    expect(Math.abs(a.state.time - b.state.time)).toBeLessThan(0.05);
    expect(Math.abs(a.state.money - b.state.money)).toBeLessThanOrEqual(FIELDS.wheat.unitValue * 8);
  });
});

describe('save & offline', () => {
  it('round-trips progress through the save format', () => {
    const g = fresh();
    g.state.money = 500;
    g.buy('add');
    g.current.harvesters[0].cargo = 3;
    g.current.growth[4] = 0.37;
    g.current.water = 2;
    const json = serialize(g.state);
    const { state, fresh: isFresh } = deserialize(json, 0);
    expect(isFresh).toBe(false);
    expect(state.money).toBe(g.state.money);
    expect(state.fields.wheat.harvesters).toEqual(g.current.harvesters);
    expect(state.fields.wheat.growth[4]).toBeCloseTo(0.37, 3);
    expect(state.fields.wheat.water).toBe(2);
  });

  it('corrupt saves fall back to a fresh game', () => {
    expect(deserialize('{nope', 0).fresh).toBe(true);
    expect(deserialize(JSON.stringify({ version: 999 }), 0).fresh).toBe(true);
    const partial = deserialize(JSON.stringify({ version: 1, money: 'x', fields: { wheat: { harvesters: 'bad', growth: [1, 2] } } }), 0);
    expect(partial.state.money).toBe(0);
    expect(partial.state.fields.wheat.harvesters.length).toBe(1);
  });

  it('offline uses real throughput, needs Auto Drive, and never pays twice', () => {
    const base: GameState = defaultState(0);
    const g = new Game(base);
    // No auto → no offline production.
    const none = g.catchUp(600_000);
    expect(none?.[0].earned).toBe(0);

    const g2 = new Game(defaultState(0));
    g2.current.auto = true;
    const res = g2.catchUp(3_600_000)!;
    const earned = res[0].earned;
    expect(earned).toBeGreaterThan(0);
    // Bounded by crate size × loops: one T1 can't sell more than 8 units per lap.
    const L = g2.rt.wheat.layout.path.length;
    const laps = (g2.speed(g2.current) * 3600) / L;
    expect(res[0].units).toBeLessThanOrEqual(Math.ceil(laps) * 8);
    // Same moment again (e.g. visibilitychange right before reload) → nothing.
    const again = g2.catchUp(3_600_000);
    expect(again).toBeNull();
    // Reload with the saved clock → nothing either.
    const reloaded = new Game(deserialize(serialize(g2.state), 3_600_000).state);
    expect(reloaded.catchUp(3_600_000)).toBeNull();
  });

  it('caps offline time at two hours', () => {
    const g = new Game(defaultState(0));
    g.current.auto = true;
    const res = g.catchUp(10 * 3600 * 1000)!;
    expect(res[0].seconds).toBe(7200);
  });
});

describe('expand', () => {
  it('adds corridors, keeps existing crops and remaps harvesters onto the new loop', () => {
    const g = fresh();
    g.state.money = 1e6;
    const f = g.current;
    f.growth[3] = 0.25;
    const before = g.rt.wheat.layout.patches.length;
    expect(g.buy('expand')).toBe(true);
    const L = g.rt.wheat.layout;
    expect(L.corridors).toBe(4);
    expect(L.patches.length).toBe(before * 2);
    expect(f.growth[3]).toBeCloseTo(0.25, 5);
    expect(f.harvesters[0].s).toBeGreaterThanOrEqual(0);
    expect(f.harvesters[0].s).toBeLessThan(L.path.length);
    expect(g.harvesterLimit(f)).toBe(5);
    // Second expand opens the deep strip.
    expect(g.buy('expand')).toBe(true);
    expect(g.rt.wheat.layout.patches.some((p) => p.strip === 3 && !p.locked)).toBe(true);
  });
});

describe('bottlenecks, spacing and reach geometry', () => {
  it('reports "storage" for a lone capacity-bound harvester and "idle" when stopped', () => {
    const g = fresh();
    expect(g.bottleneck().kind).toBe('idle');
    g.holding = true;
    run(g, 40);
    expect(g.bottleneck().kind).toBe('storage');
    expect(g.bottleneck().hint).toBe('storage');
  });

  it('reports "crops" when harvesters outpace regrowth', () => {
    const g = fresh();
    g.state.money = 1e6;
    for (let i = 0; i < 3; i++) g.buy('add');
    g.buy('storage');
    g.buy('storage');
    g.holding = true;
    run(g, 120);
    expect(g.bottleneck().kind).toBe('crops');
  });

  it('keeps a safe gap between harvesters on the shared loop', () => {
    const g = fresh();
    g.state.money = 1e6;
    for (let i = 0; i < 3; i++) g.buy('add');
    const f = g.current;
    const L = g.rt.wheat.layout.path;
    // Squeeze two machines together to check they separate instead of overlapping.
    f.harvesters[1].s = L.wrap(f.harvesters[0].s + 0.5);
    let minSeen = Infinity;
    g.holding = true;
    for (let i = 0; i < 60 * 30; i++) {
      g.step(SIM_DT);
      const ss = f.harvesters.map((h) => h.s).sort((a, b) => a - b);
      for (let k = 0; k < ss.length; k++) {
        const d = L.wrap(ss[(k + 1) % ss.length] - ss[k]);
        if (i > 30) minSeen = Math.min(minSeen, d);
      }
    }
    expect(minSeen).toBeGreaterThan(0.45);
    const ss = f.harvesters.map((h) => h.s).sort((a, b) => a - b);
    const gaps = ss.map((s, k) => L.wrap(ss[(k + 1) % ss.length] - s));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2.2 - 1e-6);
  });

  it('header widths cover exactly the rows each tier reaches', () => {
    for (const t of TIERS) {
      const half = t.headerWidth / 2;
      const reachEdge = GEOMETRY.stripOffsets[t.reach - 1] + GEOMETRY.bedDepth / 2;
      expect(half).toBeGreaterThanOrEqual(reachEdge - 0.05);
      if (t.reach < 3) expect(half).toBeLessThan(GEOMETRY.stripOffsets[t.reach]);
    }
  });
});
