// Layout + tuning. Logical canvas is 720x1280 (9:16), scaled to fit.
export const W = 720;
export const H = 1280;

// Fixed simulation step. Everything gameplay-relevant runs on this tick so
// window.__tfs.step(n) is deterministic and independent of rAF throttling.
export const TICK = 1 / 60;
export const TICK_MS = 1000 / 60;
export const GRAVITY = 2600;

// Parts (one toy piece each)
export const PART_W = 64;
export const PART_H = 48;

// Main line (top belt, runs left -> right, machines hang underneath it)
export const MAIN_Y = 560; // belt surface
export const MAIN_RIDE = MAIN_Y - PART_H / 2; // centre y of a riding part
export const MAIN_X0 = 20;
export const MAIN_X1 = 670; // parts drop off the end down the chute
export const MAIN_SPEED = 200;

// Return line (bottom belt, runs right -> left back to the lift)
export const RET_Y = 884;
export const RET_RIDE = RET_Y - PART_H / 2;
export const RET_X0 = 20;
export const RET_X1 = 716;
export const RET_SPEED = 420;

// Lift on the left: carries returned parts up and tips them onto the main line
export const LIFT_X = 40;
export const LIFT_ENTER_X = 56;
export const LIFT_TOP = MAIN_RIDE - 64;
export const LIFT_SPEED = 640;

// Bins (trays) along the top. Front part sits at the bottom, by the gate.
export const TRAY_X = [150, 290, 440, 590];
export const TRAY_W = 128;
export const TRAY_TOP = 116;
export const TRAY_MOUTH = 472;
export const TRAY_PITCH = 50;
export const TRAY_VISIBLE = 6;
export const FRONT_Y = TRAY_MOUTH - 28;
export const TRAY_COOLDOWN = 0.25; // gate re-arm time, also keeps drops from stacking

// Assembly machines
export const MACHINE_X = [290, 440, 590];
export const MACHINE_W = 140;
export const MACHINE_TOP = 576;
export const MACHINE_H = 236;
export const SLOT_Y = [138, 92, 46]; // base, body, head (relative to MACHINE_TOP)
export const SLOT_SCALE = 0.86;
export const ASSEMBLED_PITCH = 34; // slot pitch once the press squeezes the stack
export const INTAKE_HALF = 16; // horizontal intake window around the hatch
export const INTAKE_T = 0.24;
export const LOCK_T = 1.0; // machine locked while assembling
export const SWITCH_T = 0.4; // flipping to the next work order

// Dispatch rack
export const SHELF_Y = [1066, 1226];
export const SHELF_X0 = 110;
export const SHELF_DX = 100;
export const SHELF_COLS = 6;
export const SHELF_SCALE = 0.7;
export const TOY_FLIGHT = 0.8;

// Juice tuning
export const HITSTOP_TICKS = 5; // ~90 ms freeze on a finished toy
export const COMBO_WINDOW = 2.6;

// Colour = toy family. Shape also encodes the family, so it reads without colour.
export const COLORS = [0xe5483f, 0x3d7be0, 0xf4c531, 0x4cb85a, 0x9a5ae0, 0xf27fb2];
export const TOY_NAMES = ['ROBOT', 'CAR', 'DUCK', 'FROG', 'ROCKET', 'BEAR'];
export const OUT = 0x2a2238;
export const FONT = '"Arial Black", "Arial Rounded MT Bold", "Helvetica Neue", Arial, sans-serif';
