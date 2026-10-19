/** Event yang dipancarkan simulasi/aksi agar render, audio, dan UI bisa bereaksi. */
export type GameEvent =
  | { type: 'produced'; slot: number }
  | { type: 'stored'; slot: number }
  | { type: 'stationFull'; slot: number; full: boolean }
  | { type: 'pickup'; vehicleId: number; slot: number; amount: number; cargo: number }
  | { type: 'pickupMiss'; vehicleId: number; slot: number; reason: 'empty' | 'full' }
  | {
      type: 'unload';
      vehicleId: number;
      /** Seluruh muatan yang dibongkar. */
      amount: number;
      /** Bagian yang masuk ke progres (sisanya kelebihan setelah target). */
      used: number;
      money: number;
      /** Modul [fromModule, toModule) berubah ghost → solid. */
      fromModule: number;
      toModule: number;
    }
  | { type: 'unloadEmpty'; vehicleId: number }
  | { type: 'stageComplete'; stage: number; bonus: number }
  | { type: 'projectComplete'; bonus: number; leftover: number }
  | { type: 'add'; vehicleId: number }
  | { type: 'merge'; keepId: number; removedId: number; level: number; overflowMoney: number }
  | { type: 'expand'; from: number; to: number }
  | { type: 'build'; slot: number }
  | { type: 'upgrade'; slot: number; level: number }
  | { type: 'nextProject'; levelIndex: number }
  | { type: 'denied'; reason: string };

export type EventSink = GameEvent[];
