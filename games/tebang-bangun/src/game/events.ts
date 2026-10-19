import type { Cargo, Resource } from './types';

/** Event yang dipancarkan simulasi/aksi agar render, audio, dan UI bisa bereaksi. */
export type GameEvent =
  | { type: 'cut'; cell: number; wagon: number; res: Resource | null; amount: number; money: number }
  | { type: 'plotReady'; plot: number }
  | {
      type: 'deliver';
      plot: number;
      amount: number;
      /** Modul [fromModule, toModule) berubah ghost → solid. */
      fromModule: number;
      toModule: number;
    }
  | { type: 'plotComplete'; plot: number }
  | { type: 'rent'; plot: number; amount: number }
  | { type: 'sell'; money: number; cargo: Cargo; kept: number }
  | { type: 'streetComplete'; street: number; bonus: number }
  | { type: 'projectComplete'; bonus: number; leftover: number }
  | { type: 'add'; index: number }
  | { type: 'merge'; a: number; b: number; level: number }
  | { type: 'speed'; level: number }
  | { type: 'capacity'; level: number }
  | { type: 'expand'; from: number; to: number; cleared: number[] }
  | { type: 'nextProject'; levelIndex: number };

export type EventSink = GameEvent[];
