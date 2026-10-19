# Tuning notes

All gameplay numbers live in `src/game/config.ts`. Change them there and nothing else needs editing. This page covers the values that most affect pace and feel, and what the implemented loop measured.

## Values with the most effect

| Value | Where | Current | What it controls |
|---|---|---|---|
| Crusher damage | `CRUSHER.baseDamage` | 6 HP/s per contacted layer (× power) | Normal layer (1 HP) breaks in **0.17 s**. Reinforced (2.8 HP) takes 0.47 s at power ×1. |
| Working-region reach | `CRUSHER.regionLead` / `regionBack` | 0.20 / 0.30 | How far ahead of the drum's collider damage starts. A larger lead means less "chewing" hold-up per row. |
| Drum collider | `VEHICLE.rollerColliderRadius`, `rollerEndInset` | 0.22 / 0.06 | What the drum pushes against. Every block it can touch is inside the damage region, so it never snags on a block it can't break. |
| Base speed | `UPGRADES.speed.values[0]` | 1.65 u/s | Harvest rate and travel time. |
| Accel / brake | `VEHICLE.accelTime`, `brakeTime` | 0.14 s / 0.12 s | Responsiveness (the brief's targets are 100–180 ms and 100–160 ms). |
| Turn | `VEHICLE.turnRate`, `turnSharpness`, `pivotZ` | 10.5 rad/s, 15, rear pivot −0.55 | The truck pivots near its rear axle, so the drum swings into blocks and chews a curved path. |
| Capacity | `UPGRADES.cargo.values` | 96 → 384 | Trip length. |
| Roller width | `UPGRADES.roller.values` | 1.45 → 3.75 u | Cut width (about W + 0.58 u of cell centres), and camera zoom-out (`CameraRig.setRollerWidth`). |
| Material values | `MATERIALS` | 4 / 6 / 8 coins | Normal / reinforced / bonus. |
| Unload duration | `DEPOT.unloadBase + units × unloadPerUnit`, clamped to `unloadMin..unloadMax` | 0.85 + 0.0045·n, 1.2–2.0 s | 96 units → 1.28 s, 384 units → 2.0 s. |
| Depot distance | `DEPOT.spawn`, `DEPOT.pad`, field south edge at z = 0 | Pad centre 3.9 u south of the field | Return trip length. |
| Camera | `CAMERA.viewWidth`, `pitchDeg`, `vehicleScreenY` | 8.6 u, 55°, 0.6 | The truck is about 17% of the view width at the start. |

The upgrade price tables are exactly as specified in the brief.

## Measured pacing

These come from `tests/pacing.test.ts`. A bot plays the whole game headlessly at the fixed 60 Hz step:
- It harvests in serpentine lanes as wide as the current roller.
- It drives back along cleared space when the bin is full.
- It waits for the unload, then buys the cheapest upgrade it can afford.
- It mops up stragglers and drives through the gate.

The bot steers more efficiently than a relaxed person, so treat these as **lower bounds**.

| Milestone | Bot result | Brief's target |
|---|---|---|
| First block destroyed | 1.8 s (a player driving straight ahead: ~0.3 s) | 2–5 s |
| First full load (96) | 24.8 s | 20–35 s |
| First sale + first upgrade | 31.5 s | 35–60 s |
| Area 1, Color Yard (432 layers) | 195 s (3.3 min), 4 sell trips | 2–4 min |
| Area 2, Layer Works (832 layers) | 166 s, 5 trips | — |
| Area 3, Block Carnival (1,116 layers) | 146 s, 5 trips | — |
| Whole prototype | **10.5 min** | 10–15 min |
| Upgrade levels bought at the end of areas 1 / 2 / 3 | 6 / 11 / 15 of 16 | visible improvement after the first trip |

In a manual headless-Chrome run of the first loop with the mouse joystick, the first full load took about 30 s and the drive back to the pad took 5.8 s. The brief's target for that drive is 3–7 s.

Areas 2 and 3 are larger but go faster than Area 1. That is by design: the wide roller and extra power upgrades are meant to be felt eating through several columns at once. If a playtest shows the later areas feel too short, raise `AREAS[1|2].doubleRatio` or `reinforcedRatio`, or add rows. Generation hits the ratios exactly because cells are ranked, not rolled.

## Adjustment guide

- **Harvesting feels sticky:** raise `CRUSHER.regionLead` a little (0.2 → 0.3), or `baseDamage`. Don't grow the collider.
- **Runs too short or too long:** capacity and depot distance change the number and length of trips. Material values and prices change how fast upgrades arrive. A normal full load at the start is worth 384 coins, which is enough for the 180-coin roller upgrade the first time you sell.
- **Truck too big or small on screen:** change `CAMERA.viewWidth`. The camera already zooms out 0.85 u per extra metre of roller width.
- **Reinforced blocks too slow:** lower `MATERIALS[2].hp`. Their value is set separately.
- **Performance:** `QUALITY.low` turns off the shadow map, sets the pixel ratio to 1 and lowers the particle, flight, sparkle and confetti limits. The simulation and economy don't depend on the quality level.
