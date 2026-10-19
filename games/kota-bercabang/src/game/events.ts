/** Event yang dipancarkan simulasi/aksi agar render, audio, dan UI bisa bereaksi. */
export type GameEvent =
  | { type: 'produced'; line: number }
  | { type: 'stored' }
  | { type: 'stationFull'; full: boolean }
  | { type: 'pickup'; vehicleId: number; bay: number; amount: number; cargo: number }
  | { type: 'pickupMiss'; vehicleId: number; bay: number; reason: 'empty' | 'full' }
  | {
      type: 'deliver';
      vehicleId: number;
      plot: number;
      amount: number;
      money: number;
      /** Modul [fromModule, toModule) berubah ghost → solid. */
      fromModule: number;
      toModule: number;
    }
  | { type: 'plotComplete'; plot: number }
  | { type: 'rent'; vehicleId: number; plot: number; amount: number }
  | { type: 'streetComplete'; street: number; bonus: number }
  | { type: 'projectComplete'; bonus: number; leftover: number }
  | { type: 'add'; vehicleId: number }
  | { type: 'merge'; keepId: number; removedId: number; level: number; overflowMoney: number }
  | { type: 'expand'; from: number; to: number }
  | { type: 'machine'; line: number }
  | { type: 'upgrade'; level: number }
  | { type: 'nextProject'; levelIndex: number };

export type EventSink = GameEvent[];
