// Hexa Sort board as a pure integer graph. No floats, no randomness: 100% deterministic.
import { CLEAR_AT } from './config';

export interface HexCell {
  q: number;
  r: number;
  nbr: number[];
}

export function makeGrid(radius: number): HexCell[] {
  const cells: HexCell[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.abs(-q - r) > radius) continue;
      cells.push({ q, r, nbr: [] });
    }
  }
  const idx = new Map(cells.map((c, i) => [`${c.q},${c.r}`, i]));
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  for (const c of cells) {
    for (const [dq, dr] of dirs) {
      const j = idx.get(`${c.q + dq},${c.r + dr}`);
      if (j !== undefined) c.nbr.push(j);
    }
    c.nbr.sort((a, b) => a - b);
  }
  return cells;
}

/** Radius-2 hexagon: 19 cells. Index order is row by row, top to bottom. */
export const GRID = makeGrid(2);
export const CELL_COUNT = GRID.length;

export interface Board {
  stacks: number[][]; // bottom -> top colour ids
  locked: boolean[];
}

export type BoardEvent =
  | { kind: 'place'; cell: number; stack: number[] }
  | { kind: 'move'; from: number; to: number; colour: number; count: number; chain: number }
  | { kind: 'clear'; cell: number; colour: number; count: number; chain: number };

export const cloneBoard = (b: Board): Board => ({
  stacks: b.stacks.map((s) => s.slice()),
  locked: b.locked.slice(),
});

export const topColour = (s: number[]): number => (s.length ? s[s.length - 1] : -1);

export function topRunLength(s: number[]): number {
  if (!s.length) return 0;
  const c = s[s.length - 1];
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === c; i--) n++;
  return n;
}

export function runCount(s: number[]): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (i === 0 || s[i] !== s[i - 1]) n++;
  return n;
}

export const isFree = (b: Board, i: number): boolean => !b.locked[i] && b.stacks[i].length === 0;

export function freeCells(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < CELL_COUNT; i++) if (isFree(b, i)) out.push(i);
  return out;
}

export function boardHash(b: Board): string {
  return b.stacks.map((s, i) => (b.locked[i] ? 'L' : s.join(''))).join('|');
}

/**
 * Place a stack and resolve every merge and clear.
 * Rule: tiles always flow INTO the stack being resolved. The placed cell resolves first,
 * gathering the top run of every neighbour whose top colour matches (ascending cell index).
 * A neighbour that reveals a new top colour is queued and resolves the same way (chain).
 * A top run of CLEAR_AT or more leaves the board as one ball, then the cell resolves again.
 * Each move merges two runs into one, so the total run count strictly falls: it terminates.
 */
export function resolvePlacement(
  src: Board,
  cell: number,
  stack: number[],
): { board: Board; events: BoardEvent[] } {
  const b = cloneBoard(src);
  b.stacks[cell] = stack.slice();
  const events: BoardEvent[] = [{ kind: 'place', cell, stack: stack.slice() }];
  const queue = [cell];
  const queued = new Set([cell]);
  let chain = 0;
  let guard = 0;
  while (queue.length && guard < 4000) {
    const c = queue.shift()!;
    queued.delete(c);
    for (;;) {
      if (++guard > 4000) break;
      const col = topColour(b.stacks[c]);
      if (col < 0) break;
      for (const n of GRID[c].nbr) {
        if (b.locked[n] || topColour(b.stacks[n]) !== col) continue;
        const k = topRunLength(b.stacks[n]);
        const moved = b.stacks[n].splice(b.stacks[n].length - k, k);
        b.stacks[c].push(...moved);
        events.push({ kind: 'move', from: n, to: c, colour: col, count: k, chain: chain++ });
        if (b.stacks[n].length && !queued.has(n)) {
          queue.push(n);
          queued.add(n);
        }
      }
      const run = topRunLength(b.stacks[c]);
      if (run >= CLEAR_AT) {
        b.stacks[c].splice(b.stacks[c].length - run, run);
        events.push({ kind: 'clear', cell: c, colour: col, count: run, chain: chain++ });
        continue; // a new top colour may match neighbours
      }
      break;
    }
  }
  return { board: b, events };
}
