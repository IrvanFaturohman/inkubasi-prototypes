// Shared constants. Everything time-based is measured in fixed simulation ticks.
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

export interface ColourDef {
  name: string;
  hex: number;
  dark: number;
  light: number;
}

export const COLOURS: ColourDef[] = [
  { name: 'Red', hex: 0xff5a5f, dark: 0xb8323a, light: 0xffa3a3 },
  { name: 'Blue', hex: 0x3f8cff, dark: 0x2456b3, light: 0x9cc4ff },
  { name: 'Yellow', hex: 0xffc53d, dark: 0xc58a12, light: 0xffe49a },
  { name: 'Green', hex: 0x34d17c, dark: 0x1d8c50, light: 0x9cf0c2 },
  { name: 'Purple', hex: 0xb26bff, dark: 0x7638c2, light: 0xdcb8ff },
];

/** Tiles of one colour on top of a stack needed to morph into a ball. */
export const CLEAR_AT = 10;

// Board animation schedule (ticks). The board resolves instantly in the model,
// the schedule only tells the view when each event plays and blocks input meanwhile.
export const T_PLACE = 10;
export const T_MOVE_BASE = 14;
export const T_MOVE_PER = 3;
/** Part of the morph that keeps the board busy (tiles compressing into a lump). */
export const T_COMPRESS = 24;

// Ball transit: morph -> roll to pipe inlet -> pipe -> plunger.
export const T_MORPH = 34;
export const T_ROLL = 20;
export const T_PIPE = 34;
export const T_PLUNGE = 16;
/** Minimum gap between two launches so balls never stack in the plunger lane. */
export const LAUNCH_GAP = 28;
/** Beam from a cleared band down to a locked cell. */
export const T_BEAM = 42;

export const TRAY_SIZE = 3;
