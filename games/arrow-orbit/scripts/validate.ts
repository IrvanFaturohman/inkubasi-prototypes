// npm run validate: headless checks on the real sim (same code the browser runs).
import { initPhysics, Sim, SimEvent } from '../src/sim';
import { buildCourse } from '../src/course';
import { Game, WINDUP_STEPS } from '../src/game';
import { SAVE_KEY, loadSave, memoryStorage, writeSave, defaultSave, KV } from '../src/save';
import {
  COURSE_SEED, Levels, UPGRADES, UPGRADE_IDS, segmentCount, coinsForDistance, coinsForSmash, upgradeCost,
  launchSpeed, meterAt, MAX_RUN_STEPS,
} from '../src/config';

declare const process: { exit(code: number): never };

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL  ${msg}`);
  }
}
function section(name: string): void {
  console.log(`\n# ${name}`);
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

async function main() {
  const t0 = performance.now();
  await initPhysics();
  const course = buildCourse(COURSE_SEED);
  const run = (lv: Levels, m: number) => {
    const s = new Sim(course, lv);
    s.launch(m, m >= 0.93);
    const r = s.runToEnd()!;
    const out = { r, kills: s.guardKills, maxStep: s.maxStepMs };
    s.dispose();
    return out;
  };

  section('config + economy');
  for (let l = 1; l <= 8; l++) ok(segmentCount(l) === l + 2, `LENGTH Lv${l} = ${l + 2} segments`);
  ok(UPGRADES.length.max === 8, 'LENGTH caps at Lv8');
  ok(coinsForDistance(400) < 2 * coinsForDistance(200), 'distance payout is sublinear');
  ok(coinsForDistance(300) > coinsForDistance(200), 'distance payout still grows');
  ok(coinsForSmash(5) > coinsForSmash(1), 'combo escalates smash coins');
  for (const id of UPGRADE_IDS) ok(upgradeCost(id, 2) > upgradeCost(id, 1), `${id} cost rises per level`);
  ok(launchSpeed(5, 1, false) > launchSpeed(1, 1, false), 'POWER raises launch speed');
  ok(launchSpeed(1, 1, true) > launchSpeed(1, 1, false), 'perfect clicker release adds speed');
  ok(launchSpeed(1, 0.5, false) < launchSpeed(1, 0.9, false), 'gauge position matters');
  let mn = 1;
  let mx = 0;
  for (let t = 0; t < 5; t += 0.01) {
    mn = Math.min(mn, meterAt(t));
    mx = Math.max(mx, meterAt(t));
  }
  ok(mn >= 0 && mx <= 1 && mx > 0.98, 'clicker gauge sweeps 0..1');

  section('LENGTH adds real rigid bodies + colliders');
  let prevCols = -1;
  for (let l = 1; l <= 8; l++) {
    const s = new Sim(course, { power: 1, bounce: 1, length: l });
    const before = s.world.colliders.len();
    const bodiesBefore = s.world.bodies.len();
    s.launch(0.8, false);
    const added = s.world.colliders.len() - before;
    ok(s.arrow.length === l + 2, `Lv${l}: ${l + 2} arrow bodies`);
    ok(s.arrowColliderCount() === l + 2 && added === l + 2, `Lv${l}: ${l + 2} arrow colliders in the world`);
    ok(s.world.bodies.len() - bodiesBefore === l + 2, `Lv${l}: world body count grows by ${l + 2}`);
    ok(s.world.impulseJoints.len() === l + 1, `Lv${l}: ${l + 1} spherical joints`);
    if (prevCols >= 0) ok(s.world.colliders.len() === prevCols + 1, `Lv${l}: exactly one more collider than Lv${l - 1}`);
    prevCols = s.world.colliders.len();
    s.dispose();
  }

  section('stability: 40 launches, varied power and LENGTH');
  let worstStep = 0;
  let kills = 0;
  let nonFinite = 0;
  let worstZ = 0;
  let worstBend = 0;
  const reasons: Record<string, number> = {};
  for (let i = 0; i < 40; i++) {
    const lv = { power: 1 + ((i * 7) % 10), bounce: 1 + ((i * 3) % 10), length: 1 + (i % 8) };
    const m = 0.35 + ((i * 0.37) % 0.65);
    const s = new Sim(course, lv);
    s.launch(m, m >= 0.93);
    let n = 0;
    while (s.phase === 'flying' && n++ < MAX_RUN_STEPS + 60) {
      s.step();
      for (const b of s.arrow) {
        const p = b.translation();
        const v = b.linvel();
        if (![p.x, p.y, p.z, v.x, v.y].every(Number.isFinite)) nonFinite++;
      }
      for (let k = 0; k < s.arrow.length - 1; k++) {
        const a = 2 * Math.atan2(s.arrow[k].rotation().z, s.arrow[k].rotation().w);
        const b = 2 * Math.atan2(s.arrow[k + 1].rotation().z, s.arrow[k + 1].rotation().w);
        let d = Math.abs(b - a) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        worstBend = Math.max(worstBend, d);
      }
    }
    for (const o of s.objs) {
      if (!o.alive) continue;
      const p = o.body.translation();
      if (![p.x, p.y, p.z].every(Number.isFinite)) nonFinite++;
    }
    reasons[s.result?.reason ?? 'none'] = (reasons[s.result?.reason ?? 'none'] ?? 0) + 1;
    worstStep = Math.max(worstStep, s.maxStepMs);
    worstZ = Math.max(worstZ, s.maxAbsZ);
    kills += s.guardKills;
    ok(s.phase === 'done' && !!s.result && Number.isFinite(s.result.distance) && s.result.distance > 0, `run ${i + 1} (P${lv.power} B${lv.bounce} L${lv.length} m=${m.toFixed(2)}) ends with a finite distance`);
    s.dispose();
  }
  ok(nonFinite === 0, `no NaN/Infinity in any body (${nonFinite})`);
  ok(kills === 0, `no divergence: zero guard kills in normal play (${kills})`);
  ok(!reasons.oob, 'no run ended out of bounds');
  ok(worstZ < 0.05, `bodies stay on the z = 0 plane (max |z| ${worstZ.toExponential(1)})`);
  ok(worstBend < (95 * Math.PI) / 180, `shaft never folds (worst joint bend ${((worstBend * 180) / Math.PI).toFixed(0)} deg)`);
  ok(worstStep < 40, `worst single physics step ${worstStep.toFixed(2)} ms < 40 ms`);
  console.log(`  ends: ${JSON.stringify(reasons)}`);

  section('out-of-bounds guard');
  {
    const s = new Sim(course, { power: 3, bounce: 3, length: 3 });
    s.launch(0.8, false);
    for (let i = 0; i < 10; i++) s.step();
    const o = s.objs[0];
    o.body.setTranslation({ x: 1e7, y: 1e7, z: 0 }, true);
    const t = performance.now();
    s.step();
    s.step();
    const ms = performance.now() - t;
    ok(!o.alive, 'crate thrown to 1e7 is removed');
    ok(s.guardKills === 1, 'guard counted one kill');
    ok(ms < 50, `no broad-phase blow-up after the kill (${ms.toFixed(1)} ms for 2 steps)`);
    const o2 = s.objs[1];
    o2.body.setLinvel({ x: 5000, y: 0, z: 0 }, true);
    s.step();
    ok(!o2.alive, 'body faster than the speed cap is removed');
    s.arrow[0].setLinvel({ x: 1e6, y: 1e6, z: 0 }, true);
    s.step();
    s.step();
    ok(!s.arrowAlive && s.phase === 'done', 'runaway arrow is killed and the run ends');
    ok(s.result?.reason === 'oob' && Number.isFinite(s.result.distance), 'run result is oob with a sane distance');
    ok(s.drainEvents().some((e: SimEvent) => e.t === 'oob'), 'oob event emitted');
    for (let i = 0; i < 30; i++) s.step();
    ok(s.objs.filter((x) => x.alive).every((x) => Number.isFinite(x.body.translation().x)), 'world keeps stepping after the kill');
    s.dispose();
  }

  section('coins = distance + destruction');
  {
    let sawDestruction = false;
    for (const m of [0.6, 0.8, 1]) {
      const s = new Sim(course, { power: 5, bounce: 5, length: 6 });
      s.launch(m, m >= 0.93);
      let smashCoins = 0;
      let smashes = 0;
      while (s.phase === 'flying') {
        s.step();
        for (const e of s.drainEvents()) if (e.t === 'smash') {
          smashCoins += e.coins;
          smashes++;
        }
      }
      const r = s.result!;
      ok(r.coinsDistance === coinsForDistance(r.distance), `m=${m}: distance coins follow the formula`);
      ok(r.coinsDestruction === smashCoins && r.smashed === smashes, `m=${m}: destruction coins = sum of smash events`);
      ok(r.total === r.coinsDistance + r.coinsDestruction, `m=${m}: total = distance + destruction`);
      if (r.coinsDestruction > 0) sawDestruction = true;
      s.dispose();
    }
    ok(sawDestruction, 'smashing crates pays coins');
  }

  section('upgrades raise average distance (11 launches per band)');
  const meters = Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.05);
  const band = (lv: Levels) => {
    const rs = meters.map((m) => run(lv, m).r);
    return { d: mean(rs.map((r) => r.distance)), c: mean(rs.map((r) => r.coinsDestruction)) };
  };
  const b1 = band({ power: 1, bounce: 1, length: 1 });
  const b3 = band({ power: 3, bounce: 3, length: 3 });
  const b5 = band({ power: 5, bounce: 5, length: 5 });
  const b8 = band({ power: 8, bounce: 8, length: 7 });
  console.log(`  band means: Lv1 ${b1.d.toFixed(0)} m, Lv3 ${b3.d.toFixed(0)} m, Lv5 ${b5.d.toFixed(0)} m, Lv8 ${b8.d.toFixed(0)} m`);
  ok(b3.d > b1.d * 1.1, 'Lv3 band beats Lv1 band by >10%');
  ok(b5.d > b3.d * 1.1, 'Lv5 band beats Lv3 band by >10%');
  ok(b8.d > b5.d * 1.1, 'Lv8 band beats Lv5 band by >10%');
  const base = { power: 3, bounce: 3, length: 3 };
  for (const id of UPGRADE_IDS) {
    const up = band({ ...base, [id]: 7 });
    console.log(`  ${id} 3 -> 7: ${b3.d.toFixed(0)} -> ${up.d.toFixed(0)} m, destruction coins ${b3.c.toFixed(0)} -> ${up.c.toFixed(0)}`);
    const need = id === 'power' ? 1.3 : id === 'bounce' ? 1.08 : 1.03;
    ok(up.d > b3.d * need, `${id.toUpperCase()} alone raises mean distance by >${Math.round((need - 1) * 100)}%`);
    if (id === 'length') ok(up.c > b3.c * 1.15, 'LENGTH raises mean destruction coins by >15% (heavier shaft sweeps stacks)');
  }

  section('determinism (hitstop/slow-mo never touch the sim)');
  {
    const trace = () => {
      const s = new Sim(course, { power: 4, bounce: 4, length: 4 });
      s.launch(0.87, false);
      const ev: string[] = [];
      while (s.phase === 'flying') {
        s.step();
        for (const e of s.drainEvents()) ev.push(`${s.stepCount}:${e.t}`);
      }
      const r = s.result!;
      s.dispose();
      return `${r.distance}|${r.smashed}|${ev.join(',')}`;
    };
    const a = trace();
    ok(a === trace(), 'same launch gives the same distance, smashes and event timeline');
    ok(a.includes('impact'), 'impact events fire (they drive hitstop)');
  }

  section('save state (versioned localStorage, safe)');
  {
    const kv = memoryStorage();
    const sv = defaultSave();
    sv.coins = 123;
    sv.levels.length = 4;
    sv.best = 77;
    ok(writeSave(kv, sv), 'write succeeds');
    ok(SAVE_KEY.endsWith('.v1') && kv.data.has(SAVE_KEY), `versioned key ${SAVE_KEY}`);
    const back = loadSave(kv);
    ok(back.coins === 123 && back.levels.length === 4 && back.best === 77, 'round trip');
    kv.setItem(SAVE_KEY, '{nope');
    ok(loadSave(kv).coins === 0, 'corrupt JSON falls back to defaults');
    kv.setItem(SAVE_KEY, JSON.stringify({ v: 99, coins: 5 }));
    ok(loadSave(kv).coins === 0, 'unknown version falls back to defaults');
    kv.setItem(SAVE_KEY, JSON.stringify({ v: 1, coins: -5, levels: { power: 99, bounce: 'x', length: 0 }, best: 10 }));
    const cl = loadSave(kv);
    ok(cl.coins === 0 && cl.levels.power === 10 && cl.levels.bounce === 1 && cl.levels.length === 1, 'bad values are clamped');
    const broken: KV = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    let threw = false;
    try {
      loadSave(broken);
      writeSave(broken, sv);
      new Game(broken);
      new Game(null);
    } catch {
      threw = true;
    }
    ok(!threw, 'throwing or missing storage never crashes the game');
  }

  section('game flow (what window.__ao drives)');
  {
    const kv = memoryStorage();
    const g = new Game(kv);
    ok(g.phase === 'aim', 'starts aiming');
    ok(!g.buy('power'), 'cannot buy with 0 coins');
    for (let i = 0; i < 40; i++) g.tick();
    ok(g.tap() && g.phase === 'windup', 'tap locks the gauge and starts the 110 ms windup');
    for (let i = 0; i < WINDUP_STEPS; i++) g.tick();
    ok(g.phase === 'flight', `release after ${WINDUP_STEPS} steps`);
    let n = 0;
    while (g.phase === 'flight' && n++ < 2000) g.tick();
    ok(g.phase === 'result' && !!g.lastResult, 'flight ends in a result');
    ok(g.save.coins === g.lastResult!.total && g.save.coins > 0, 'coins paid at the result');
    ok(loadSave(kv).coins === g.save.coins && loadSave(kv).runs === 1, 'result is saved right away');
    ok(!g.tap(), 'early tap on the scorecard is ignored');
    for (let i = 0; i < 30; i++) g.tick();
    ok(g.tap() && g.phase === 'aim', 'tap collects and re-aims');
    g.grant(100000);
    const segBefore = g.sim.nSeg;
    ok(g.buy('length') && g.save.levels.length === 2, 'buying LENGTH levels up');
    ok(g.sim.nSeg === segBefore + 1, 'new sim has one more segment');
    while (g.buy('length'));
    ok(g.save.levels.length === 8 && !g.buy('length'), 'LENGTH stops at Lv8');
    ok(loadSave(kv).levels.length === 8, 'upgrade persisted');
    g.launchNow(0.9);
    n = 0;
    while (g.phase === 'flight' && n++ < 2000) g.tick();
    ok(g.state().arrowColliders === 10 && g.state().segments === 10, 'Lv8 run used 10 colliders');
  }

  console.log(`\n${pass} passed, ${fail} failed  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(fail ? 1 : 0);
}

main();
