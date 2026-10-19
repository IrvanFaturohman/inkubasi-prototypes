// npm run validate: headless checks on the exact model the browser runs, driven by fixed steps.
import { CELL_COUNT, GRID, boardHash, freeCells, resolvePlacement, topColour, topRunLength, type Board } from '../src/core/board';
import { CLEAR_AT, T_BEAM, T_MORPH, T_PIPE, T_PLUNGE, T_ROLL } from '../src/core/config';
import { Game, type GameEvent } from '../src/core/game';
import { LEVELS } from '../src/core/levels';
import { Rng } from '../src/core/rng';
import { LANE_TOP, LANE_X, Table } from '../src/core/table';
import { greedyMove, runBot } from '../src/core/bot';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}
const emptyBoard = (): Board => ({ stacks: GRID.map(() => []), locked: GRID.map(() => false) });
/** Proper 3-colouring of the hex grid: neighbours never share a colour. */
const tri = (i: number) => (((GRID[i].q - GRID[i].r) % 3) + 3) % 3;
const stepUntil = (g: Game, pred: () => boolean, max = 20000) => {
  for (let i = 0; i < max && !pred(); i++) g.step(1);
  return pred();
};

// ------------------------------------------------------------------ board rules
section('Board rules (integer graph)');
{
  const sym = GRID.every((c, i) => c.nbr.every((j) => GRID[j].nbr.includes(i)));
  check('radius-2 grid has 19 cells with symmetric neighbours', CELL_COUNT === 19 && sym);
  check('centre has 6 neighbours, corners 3', GRID[9].nbr.length === 6 && GRID[0].nbr.length === 3);

  const b = emptyBoard();
  b.stacks[9] = [1, 0, 0];
  const r = resolvePlacement(b, 8, [2, 0]);
  check('placed stack gathers the matching top run of a neighbour', r.board.stacks[8].join() === '2,0,0,0' && r.board.stacks[9].join() === '1');

  const c = emptyBoard();
  c.stacks[9] = [1, 0];
  c.stacks[10] = [1];
  const rc = resolvePlacement(c, 8, [0]);
  const moves = rc.events.filter((e) => e.kind === 'move');
  check('a revealed colour chains into its own neighbours', moves.length === 2 && rc.board.stacks[9].join() === '1,1' && rc.board.stacks[10].length === 0);

  const d = emptyBoard();
  d.stacks[9] = [2, 0, 0, 0, 0, 0, 0];
  d.stacks[8] = [0, 0, 0];
  const rd = resolvePlacement(d, 4, [0]);
  const clr = rd.events.find((e) => e.kind === 'clear');
  check(
    `${CLEAR_AT} same-colour tiles on top leave the board as one clear`,
    !!clr && clr.kind === 'clear' && clr.count === 10 && clr.colour === 0 && rd.board.stacks[4].length === 0 && rd.board.stacks[9].join() === '2',
  );

  // fuzz: boards grown by real placements must always settle into a stable state
  const rng = new Rng(77);
  let stable = true;
  let same = true;
  let fb = emptyBoard();
  for (let n = 0; n < 400; n++) {
    let free = freeCells(fb);
    if (!free.length) {
      fb = emptyBoard();
      free = freeCells(fb);
    }
    const cell = free[rng.int(free.length)];
    const st = Array.from({ length: 1 + rng.int(5) }, () => rng.int(4));
    const a = resolvePlacement(fb, cell, st);
    const a2 = resolvePlacement(fb, cell, st);
    if (boardHash(a.board) !== boardHash(a2.board) || JSON.stringify(a.events) !== JSON.stringify(a2.events)) same = false;
    for (let i = 0; i < CELL_COUNT; i++) {
      const t = topColour(a.board.stacks[i]);
      if (t >= 0 && topRunLength(a.board.stacks[i]) >= CLEAR_AT) stable = false;
      for (const j of GRID[i].nbr) if (t >= 0 && topColour(a.board.stacks[j]) === t) stable = false;
    }
    fb = a.board;
  }
  check('400 random resolves end stable (no matching neighbours, no 10+ top run)', stable);
  check('400 random resolves are bit-identical when repeated', same);
}

// ------------------------------------------------------------------ acceptance tests
section('Acceptance tests from the brief');

// A1 determinism
{
  const play = (seed: number) => {
    const g = new Game(1, { seed, log: false });
    const hashes: string[] = [];
    for (let n = 0; n < 25 && g.status === 'playing'; n++) {
      stepUntil(g, () => g.canPlace());
      const mv = greedyMove(g);
      if (!mv) break;
      g.place(mv[0], mv[1]);
      hashes.push(boardHash(g.board) + '#' + JSON.stringify(g.tray));
      g.step(20);
    }
    g.step(600);
    return { hashes, snap: JSON.stringify(g.snapshot()) };
  };
  const a = play(4242);
  const b = play(4242);
  const c = play(4243);
  check('A1 board is 100% deterministic: same seed + same placements = identical boards', a.hashes.join() === b.hashes.join() && a.hashes.length >= 20);
  check('A1 fixed-step pinball replays identically (full snapshot after 600 extra ticks)', a.snap === b.snap);
  check('A1 a different seed gives a different run', a.hashes.join() !== c.hashes.join());
}

// A2 + A3 morph -> ball -> pipe -> plunger
{
  const g = new Game(0, { seed: 9 });
  g.board.stacks[9] = [1, 0, 0, 0, 0, 0, 0];
  g.board.stacks[8] = [0, 0, 0];
  g.tray[0] = [0];
  const tilesBefore = g.board.stacks.reduce((a, s) => a + s.length, 0);
  const evs = g.place(0, 4) ?? [];
  const tilesAfter = g.board.stacks.reduce((a, s) => a + s.length, 0);
  const tr = g.transits[0];
  check(
    'A2 ten same-colour tiles do not vanish: they become exactly one ball in transit',
    evs.some((e) => e.kind === 'clear') && tilesBefore + 1 - tilesAfter === 10 && g.transits.length === 1 && tr.colour === 0 && tr.count === 10,
  );
  check(
    'A3 the ball takes the full morph + roll + pipe + plunger path before it is shot',
    !!tr && tr.launchAt - tr.start >= T_MORPH + T_ROLL + T_PIPE + T_PLUNGE && g.table.balls.length === 0,
  );
  g.events.length = 0;
  stepUntil(g, () => g.table.balls.length > 0);
  const ball = g.table.balls[0];
  check('A3 at launch the ball sits in the plunger lane moving up', !!ball && ball.colour === 0 && ball.x > LANE_X && ball.vy < 0 && g.transits.length === 0);
  g.step(90);
  check('A3 the plunger shoots it out of the lane onto the table', !!ball && ball.leftLane && (g.table.balls.includes(ball) ? ball.x < LANE_X || ball.y < LANE_TOP : true));
}

// A4 colour-only damage
{
  const L = LEVELS[0];
  const t = new Table(L.bands, new Rng(5));
  const red = t.targets.find((x) => x.colour === 0)!;
  const hp0 = t.bandHp[red.band];
  t.spawnAt(1, red.x, red.y - 40, 0, 300); // blue ball onto a red target
  for (let i = 0; i < 20; i++) t.step();
  const wrongHit = t.events.find((e) => e.kind === 'hit' && e.target === red.id);
  check('A4 a ball of another colour bounces off but deals no damage', !!wrongHit && wrongHit.kind === 'hit' && !wrongHit.same && t.bandHp[red.band] === hp0);
  t.balls.length = 0;
  t.events.length = 0;
  t.spawnAt(0, red.x, red.y - 40, 0, 300);
  for (let i = 0; i < 20; i++) t.step();
  check('A4 a ball of the same colour damages that band', t.bandHp[red.band] < hp0);

  // invariant over many launches: every HP drop is a same-colour hit
  const t2 = new Table(LEVELS[1].bands, new Rng(11));
  let ok = true;
  let hits = 0;
  for (let n = 0; n < 60; n++) {
    t2.launch(n % 4);
    while (t2.balls.length) {
      const before = t2.bandHp.slice();
      t2.step();
      const ballColour = new Map(t2.balls.map((b) => [b.id, b.colour]));
      for (const e of t2.events) if (e.kind === 'hit' && e.same) hits++;
      t2.bandHp.forEach((hp, i) => {
        if (hp < before[i]) {
          const legit = t2.events.some((e) => e.kind === 'hit' && e.same && e.band === i && e.colour === t2.bands[i].colour);
          if (!legit) ok = false;
        }
      });
      for (const e of t2.events) if (e.kind === 'hit' && e.same && ballColour.has(e.ball) && ballColour.get(e.ball) !== t2.bands[e.band].colour) ok = false;
      t2.events.length = 0;
      if (t2.bandAlive.every((a) => !a)) break;
    }
  }
  check('A4 over 60 launches every HP loss comes from a same-colour hit', ok && hits > 0, `${hits} damaging hits`);
}

// A5 cleared group -> beam -> unlock
{
  const g = new Game(0, { seed: 3 });
  const band = 2;
  g.table.bandHp[band] = 1;
  const tg = g.table.targets.find((t) => t.band === band)!;
  const lockedBefore = g.board.locked.filter(Boolean).length;
  const freeBefore = g.free().length;
  const expect = g.level.locked[0];
  g.table.spawnAt(tg.colour, tg.x, tg.y - 40, 0, 300);
  stepUntil(g, () => g.beams.length > 0, 60);
  const bm = g.beams[0];
  check('A5 emptying a band sends a beam toward the next locked cell', !!bm && bm.band === band && bm.cell === expect);
  g.step(T_BEAM + 1);
  const ev = g.drainEvents().find((e: GameEvent) => e.kind === 'unlock');
  check(
    'A5 the beam lands and that locked cell opens (+1 free cell)',
    !!ev && !g.board.locked[expect] && g.board.locked.filter(Boolean).length === lockedBefore - 1 && g.free().length === freeBefore + 1,
  );
}

// A6 starting board
{
  const ok = LEVELS.every((_, i) => {
    const g = new Game(i);
    const usable = g.board.locked.filter((l) => !l).length;
    return usable === 14 && g.board.locked.filter(Boolean).length === 5 && g.table.bandAlive.length === 5;
  });
  check('A6 every level starts with 14 usable cells + 5 locked, and 5 target bands', ok);
}

// A7 colours the table does not need
{
  const g = new Game(1, { seed: 21 }); // level 2: no yellow targets
  check('A7 level 2 offers yellow tiles but has no yellow targets', g.level.tileColours.includes(2) && !g.neededColours().has(2));
  g.board.stacks[9] = [2, 2, 2, 2, 2, 2];
  g.board.stacks[8] = [2, 2, 2];
  g.tray[0] = [2];
  const evs = g.place(0, 4);
  check('A7 placing a dead colour is legal and still clears into a ball', !!evs && evs.some((e) => e.kind === 'clear') && g.transits[0]?.needed === false);
  const hp0 = g.table.hpLeft();
  stepUntil(g, () => g.table.balls.length > 0);
  stepUntil(g, () => g.table.balls.length === 0, 60 * 40);
  check('A7 the dead-colour ball flies but changes nothing on the table', g.table.hpLeft() === hp0 && g.stats.wasted === 1);
}

// A8 overflow loses, no timer
{
  const idle = new Game(0);
  idle.step(60 * 600);
  check('A8 no timer: 10 idle minutes later the level is still playing', idle.status === 'playing');

  const g = new Game(0, { seed: 8 });
  let guard = 0;
  while (g.free().length && guard++ < 40) {
    stepUntil(g, () => g.canPlace());
    const cell = g.free()[0];
    g.tray[0] = [tri(cell)];
    g.place(0, cell);
  }
  check('A8 a full board with nothing in play and no merges possible is lost', g.free().length === 0 && (g.step(30), g.status === 'lost'));

  const w = new Game(0, { seed: 8 });
  guard = 0;
  while (w.free().length && guard++ < 40) {
    stepUntil(w, () => w.canPlace());
    const cell = w.free()[0];
    w.tray[0] = [tri(cell)];
    w.place(0, cell);
  }
  w.injectBall(3); // green: level 1 has no green band, so this ball can never open a cell
  w.step(30);
  const waited = w.status === 'playing' && w.waitingOnTable();
  stepUntil(w, () => w.table.balls.length === 0 && w.beams.length === 0, 60 * 40);
  w.step(2);
  check('A8 while a ball is still live the full board waits for the table, then loses', waited && w.status === 'lost');
  check('A8 placing while the board animates is refused', (() => {
    const q = new Game(0, { seed: 1 });
    q.place(0, 9);
    return q.place(1, 10) === null;
  })());
}

// A9 bots
{
  const N = 16;
  const rows: string[] = [];
  const rate: number[][] = [];
  LEVELS.forEach((lv, li) => {
    const res = (['greedy', 'random'] as const).map((kind) => {
      let w = 0;
      let pl = 0;
      let balls = 0;
      for (let s = 0; s < N; s++) {
        const r = runBot(li, 5000 + s * 31, kind);
        if (r.won) {
          w++;
          pl += r.placements;
          balls += r.balls;
        }
      }
      return { w, pl: w ? pl / w : 0, balls: w ? balls / w : 0 };
    });
    rate.push(res.map((r) => r.w / N));
    rows.push(
      `    L${lv.id} ${lv.name.padEnd(12)} greedy ${res[0].w}/${N} (~${res[0].pl.toFixed(0)} placements, ${res[0].balls.toFixed(0)} balls)   random ${res[1].w}/${N}`,
    );
  });
  console.log(rows.join('\n'));
  check('A9 every level is winnable by the simple greedy bot (>= 80% of seeds)', rate.every((r) => r[0] >= 0.8));
  check('A9 placements can be wrong: random placement wins clearly less on levels 2 and 3', rate[1][1] < rate[1][0] - 0.25 && rate[2][1] < rate[2][0] - 0.5);
}

// ------------------------------------------------------------------ finding from the notes (measured, not asserted)
section('Finding from the notes: level length is set by the board, not the targets (info)');
{
  const N = 24;
  LEVELS.forEach((lv, li) => {
    const measure = (scale: number) => {
      const base = lv.bands.map((b) => b.hp);
      lv.bands.forEach((b, i) => (b.hp = Math.round(base[i] * scale)));
      const hp = lv.bands.reduce((a, b) => a + b.hp, 0);
      let balls = 0;
      let pl = 0;
      for (let s = 0; s < N; s++) {
        const r = runBot(li, 7000 + s * 13, 'greedy');
        balls += r.balls;
        pl += r.placements;
      }
      lv.bands.forEach((b, i) => (b.hp = base[i]));
      return { hp, balls: balls / N, pl: pl / N };
    };
    const a = measure(1);
    const b = measure(41 / 34);
    console.log(
      `    L${lv.id}: ${a.hp} -> ${b.hp} HP adds ${(b.balls - a.balls).toFixed(1)} balls and ${(b.pl - a.pl).toFixed(1)} placements` +
        `  (${a.balls.toFixed(1)} balls / ${a.pl.toFixed(0)} placements at base HP)`,
    );
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
