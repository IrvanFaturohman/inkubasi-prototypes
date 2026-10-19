// Simple bots for the validator. The greedy bot looks one placement ahead using the
// pure board rules; the random bot places anywhere. Neither ever touches the table.
import { CELL_COUNT, resolvePlacement, runCount, topRunLength } from './board';
import { Game } from './game';
import { Rng } from './rng';

export function scorePlacement(g: Game, slot: number, cell: number): number {
  const stack = g.tray[slot];
  if (!stack) return -Infinity;
  const { board, events } = resolvePlacement(g.board, cell, stack);
  const needed = g.neededColours();
  let s = 0;
  for (const e of events) {
    if (e.kind === 'clear') s += needed.has(e.colour) ? 80 : 30;
    else if (e.kind === 'move') s += e.count * 2;
  }
  let free = 0;
  let runs = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (board.locked[i]) continue;
    const st = board.stacks[i];
    if (!st.length) {
      free++;
      continue;
    }
    runs += runCount(st);
    // reward tall runs of colours the table still wants on top
    const top = topRunLength(st);
    if (needed.has(st[st.length - 1])) s += top * top * 0.25;
  }
  return s + free * 6 - runs * 3;
}

export function greedyMove(g: Game): [number, number] | null {
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  const free = g.free();
  for (let slot = 0; slot < g.tray.length; slot++) {
    if (!g.tray[slot]) continue;
    for (const cell of free) {
      const sc = scorePlacement(g, slot, cell);
      if (sc > bestScore) {
        bestScore = sc;
        best = [slot, cell];
      }
    }
  }
  return best;
}

export function randomMove(g: Game, rng: Rng): [number, number] | null {
  const slots = g.tray.flatMap((s, i) => (s ? [i] : []));
  const free = g.free();
  if (!slots.length || !free.length) return null;
  return [slots[rng.int(slots.length)], free[rng.int(free.length)]];
}

export interface BotResult {
  won: boolean;
  placements: number;
  seconds: number;
  balls: number;
  wasted: number;
}

/** Plays a whole level. `think` = ticks the bot waits between placements (a human pace). */
export function runBot(levelIndex: number, seed: number, kind: 'greedy' | 'random', think = 40): BotResult {
  const g = new Game(levelIndex, { seed, log: false });
  const rng = new Rng(seed * 7 + 3);
  let guard = 0;
  while (g.status === 'playing' && guard++ < 400000) {
    if (!g.canPlace()) {
      g.step(Math.max(1, g.busyUntil - g.tick));
      continue;
    }
    const mv = kind === 'greedy' ? greedyMove(g) : randomMove(g, rng);
    if (!mv) {
      g.step(1);
      continue;
    }
    g.place(mv[0], mv[1]);
    g.step(think);
  }
  return {
    won: g.status === 'won',
    placements: g.stats.placements,
    seconds: g.tick / 60,
    balls: g.stats.balls,
    wasted: g.stats.wasted,
  };
}
