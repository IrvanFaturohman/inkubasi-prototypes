import { step } from '../src/game/sim';
import { createNewGame, createRuntime } from '../src/game/state';
import type { GameEvent } from '../src/game/events';
import type { GameState, Runtime } from '../src/game/types';

export function fresh(): { state: GameState; rt: Runtime } {
  return { state: createNewGame(), rt: createRuntime() };
}

/** Menjalankan simulasi selama `seconds` dengan sub-step `h`, mengumpulkan event. */
export function run(state: GameState, rt: Runtime, seconds: number, h = 1 / 60): GameEvent[] {
  const events: GameEvent[] = [];
  let t = 0;
  while (t < seconds - 1e-9) {
    const dt = Math.min(h, seconds - t);
    step(state, rt, dt, events);
    t += dt;
  }
  return events;
}

export function count(events: GameEvent[], type: GameEvent['type']): number {
  return events.filter((e) => e.type === type).length;
}
