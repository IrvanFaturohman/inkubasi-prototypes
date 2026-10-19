// Every feel / balance number lives here. The tuning panel (press D) edits this
// object live; the sim reads it every fixed step, so most changes apply at once.
// Values marked (next round) are only read when a round starts.

export interface RoundConfig {
  name: string;
  colours: number;        // how many ball colours / machines (next round)
  quota: number;          // balls to deliver to clear the round
  slots: number;          // cups on the loop conveyor (next round)
  beltSpeed: number;      // px/s along the loop
  spawnStart: number;     // seconds between new balls at round start
  spawnEnd: number;       // seconds between new balls after the ramp
  rampTime: number;       // seconds for spawnStart -> spawnEnd
  prefill: number;        // 0..1 share of cups filled when the round starts (next round)
  capacity: number;       // max balls the magnet can hold
  sameColourChance: number; // chance the next ball repeats the previous colour (makes runs)
}

export const COLOURS = [
  { name: 'RED', hex: 0xff5b4f, dark: 0xb3322b },
  { name: 'BLUE', hex: 0x3fa7ff, dark: 0x1f63a8 },
  { name: 'YELLOW', hex: 0xffc93a, dark: 0xb3861a },
  { name: 'GREEN', hex: 0x4fd47a, dark: 0x258a46 },
];

export const GameConfig = {
  seed: 7,

  view: {
    width: 540,
    height: 960,
    renderScale: 2,        // canvas is drawn at 2x for crisp phones
  },

  magnet: {
    radius: 22,
    followStiffness: 520,  // spring-follow k (1/s^2)
    followDamping: 27,     // spring-follow c (1/s); < 2*sqrt(k) = slight overshoot
    maxSpeed: 2600,        // px/s
    touchOffsetY: -70,     // magnet sits above the finger on touch
    pullRadius: 120,       // R
    pullStrength: 7000,    // pull = strength * (1 - d/R)^2, px/s^2
    attachSlack: 5,        // px of contact tolerance before a ball sticks
    minY: 96,
    maxY: 936,
  },

  cluster: {
    stiffness: 240,        // spring pulling stuck balls to the puck
    damping: 5,            // low = wobbly cluster
    restPadding: 0,
    carry: 0.85,           // share of the puck's acceleration stuck balls inherit (1 = rigid, lower = more lag/wobble)
    frictionAir: 0.008,
    breakDistance: 140,    // a stuck ball this far away falls off
  },

  belt: {
    centerX: 270,
    centerY: 330,
    halfStraight: 125,
    radius: 115,
    width: 46,
    gripStiffness: 130,    // how hard a cup holds its ball
    gripDamping: 14,
    breakDistance: 14,     // ball leaves the cup past this offset
    inletAt: 0.3,          // where the hopper drops, as fraction of the top run
    speedScale: 1,
  },

  ball: {
    radius: 13,            // (next round)
    frictionAir: 0.03,
    restitution: 0.15,
    maxSpeed: 1800,
    returnDelay: 0.3,      // s without pull before a loose ball homes to the belt
    homingStiffness: 60,
    homingDamping: 10,
    seatDistance: 10,
  },

  hopper: {
    capacity: 4,           // queue that can wait in the chute; one more = OVERFLOW
    dropTime: 0.22,
  },

  machine: {
    y: 905,                // floor line of the machines
    height: 170,
    intakeRadius: 74,      // magnet within this of the mouth = feeding
    suckInterval: 0.13,    // s between balls, one by one
    flightBase: 0.2,
    flightPerPx: 1 / 1400,
    flightGravity: 2600,   // px/s^2, the arc into the mouth
    feedGap: 0.45,         // s outside the intake before the feed combo resets
  },

  reject: {
    x: 270,
    y: 330,
    radius: 54,            // trigger radius around the REJECT pad
    interval: 0.14,
    penalty: 5,            // score per rejected ball
    flightTime: 0.45,      // arc back onto the belt (or the hopper if the belt is full)
  },

  overdrive: {
    count: 6,              // 6 of one colour in one feed = OVERDRIVE
    duration: 3.2,         // s of x2 score on that machine
    scoreMult: 2,
    bonus: 100,
    purgeMax: 5,           // balls of that colour vacuumed off the belt
    purgeInterval: 0.09,
    purgeFlight: 0.45,
  },

  score: {
    base: 10,              // per ball, times feed combo
  },

  phases: {
    introTime: 1.4,
    clearTime: 2.8,
    celebrateInterval: 0.05,
  },

  juice: {
    hitstopMs: 90,         // on every ball delivered
    hitstopOverdriveMs: 160,
    hitstopPurgeMs: 0,
    shakeBase: 0.0022,
    shakePerCombo: 0.0012,
    shakeMs: 110,
    shakeOverdrive: 0.012,
    shakeFail: 0.02,
    squashAttach: 0.32,
    squashLand: 0.4,
    squashStiffness: 260,
    squashDamping: 11,
    stretchPerSpeed: 1 / 2600,
    stretchMax: 0.38,
    particles: 10,
    particlesPerCombo: 2,
    volume: 0.55,
    haptics: true,
    pitchProgressSteps: 5, // pentatonic steps the feed note climbs over a round
  },

  rounds: [
    { name: 'Warm-up', colours: 2, quota: 20, slots: 22, beltSpeed: 70, spawnStart: 1.5, spawnEnd: 0.9, rampTime: 30, prefill: 0.45, capacity: 8, sameColourChance: 0.5 },
    { name: 'Third line', colours: 3, quota: 26, slots: 24, beltSpeed: 80, spawnStart: 1.2, spawnEnd: 0.7, rampTime: 30, prefill: 0.5, capacity: 8, sameColourChance: 0.45 },
    { name: 'Rush hour', colours: 3, quota: 34, slots: 24, beltSpeed: 95, spawnStart: 1.0, spawnEnd: 0.5, rampTime: 30, prefill: 0.55, capacity: 8, sameColourChance: 0.42 },
    { name: 'Four lines', colours: 4, quota: 44, slots: 26, beltSpeed: 105, spawnStart: 0.8, spawnEnd: 0.4, rampTime: 30, prefill: 0.55, capacity: 8, sameColourChance: 0.4 },
    { name: 'Night shift', colours: 4, quota: 56, slots: 28, beltSpeed: 120, spawnStart: 0.7, spawnEnd: 0.32, rampTime: 30, prefill: 0.6, capacity: 8, sameColourChance: 0.38 },
  ] as RoundConfig[],
};

export type GameConfigType = typeof GameConfig;
