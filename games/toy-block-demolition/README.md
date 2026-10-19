# Toy Block Demolition (prototype)

A colorful portrait arcade prototype for the browser. Drive a small orange demolition truck through a dense field of low, smooth toy blocks. The front drum crushes them, the pieces fly into a clear bin on the back, and you sell the load at the depot. The coins buy upgrades you can see on the truck: a wider roller, a bigger bin, more crushing power and more speed. There are three handcrafted/procedural yards, then a free-play mode.

*Toy Block Demolition* is a temporary working title and has not been cleared as a brand name. All art, geometry, icons, sound effects and music are generated in code. There are no external assets, studded bricks, logos or copied designs.

| Harvest | Full bin | Unload | Upgrades |
|---|---|---|---|
| ![](docs/screenshots/01-harvest.png) | ![](docs/screenshots/02-full-bin.png) | ![](docs/screenshots/03-unloading.png) | ![](docs/screenshots/04-upgrade-panel.png) |
| **Layer Works** | **Block Carnival, wide roller** | **Last blocks** | **Run complete** |
| ![](docs/screenshots/06-layer-works.png) | ![](docs/screenshots/07-block-carnival-wide-roller.png) | ![](docs/screenshots/05-last-blocks.png) | ![](docs/screenshots/08-completion.png) |

## Run it

You need Node.js 20 or newer. It was built and tested with Node 25.9 and npm 11.12.

```bash
npm install
npm run dev        # prints a local URL (default :5173); add ?debug for an FPS/state overlay
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
npm test           # invariant, no-trap and pacing tests (Vitest, headless)
npm run typecheck
```

`dist/` is a static site with no backend and no runtime CDN. You can serve it from any static host, or from a sub-path (`base: './'`).

## Controls

| | |
|---|---|
| **Touch** | Put your finger anywhere on the play area and drag. A floating joystick appears under your thumb. Push further to drive faster. Let go to stop. |
| **Mouse** | Click and drag, the same way as touch. |
| **Keyboard** | WASD or the arrow keys, relative to the screen. Pressing two opposite keys cancels them out. Esc closes panels. |
| **Crushing** | Automatic. The drum is powered while you drive. There is no attack button. |
| **Selling** | Park on the **SELL** pad and hold still for a moment. |
| **Upgrades** | The **UPGRADE** button appears next to the cargo bar when you're near the depot. |
| **Next area** | Clear the yard and sell your cargo. The striped gate at the bottom-left of the depot then opens. Drive through it. |

If the bin is full and you're wedged in a pocket, keep steering toward where you want to go. The truck makes a K-turn or backs out along its own track by itself.

## What's in the prototype

**Core loop:** crush, fly-in pickup, visible cargo fill, full-bin cue, return to the depot, unload (tipping bin, cascade into the hopper, coins counted per unit), upgrade, return. Cleared blocks stay cleared.

**Economy:** three materials: normal (4 coins), reinforced (6 coins, 2.8 HP, thick light rim) and bonus (8 coins, embossed star). Four upgrades with 5 levels each, using the price tables from the brief.

**Three areas:**
1. *Color Yard*: 432 layers, single layer, stripes and clusters.
2. *Layer Works*: 832 layers, stepped two-layer plateaus, reinforced and bonus layers.
3. *Block Carnival*: 1,116 layers, diagonal stripes, concentric rings and a checker patch.

Each area has a completion bonus, paid once. The gate opens after you sell your cargo. When fewer than 12 layers are left, markers show where they are.

**End of run:** a completion panel, then **Continue Free Play** (a new seeded yard, upgrades kept) or **New Run** (asks you to confirm).

**Onboarding** uses short hints in context, and they're saved so you only see them once:
1. Drag to drive.
2. The cargo bar is highlighted.
3. When the bin is full, you're pointed to SELL.
4. After your first sale, the upgrade sheet opens with ROLLER highlighted.

**Feel:** acceleration and braking are quick, and the truck pivots near its rear axle so the drum swings and chews. You also get:
- Block squash, and a jiggle on reinforced blocks.
- Shards, chunks flying on curves, and chunks bouncing when they land in the bin.
- Cab lean, bin sway and wheel spin that match the distance driven.
- An elastic pop on the upgraded part, confetti, and a small bounded camera shake.

**Audio** is procedural Web Audio:
- A motor, drum rumble and a grain-based crunch texture that stays controlled.
- Rate-limited break pops and pickup ticks.
- A two-note full-bin cue, rattles, a rising coin arpeggio, an upgrade chord and an area-clear stinger.
- Light background music.

SFX and music have separate buses with a master mute, a voice budget of 14, and a compressor on the output.

**Settings:**
- Sound on/off, effects volume and music volume.
- Reduced motion: turns off camera shake and cuts down confetti and bouncing.
- Vibration, when the device supports it. It's off until you turn it on.
- Graphics: Auto, Low or High. Auto steps down to Low if the frame rate stays low.
- Reset progress, with a confirmation.

**Persistence:** a versioned `localStorage` save, written at most every 2.5 s and right away after important actions or when the tab is hidden. It stores the cleared-layer bitmap, the cargo ledger (pickups still in flight are saved as stored), upgrades, reward flags, stats, tutorial flags and settings.
- If a save is corrupt or out of range, you get a clean new run instead of a broken game.
- If storage isn't available, the game keeps running in memory and shows a one-time notice.

**Robustness:**
- The simulation runs at a fixed 60 Hz step and catches up at most 5 steps per frame.
- Pausing covers modals and hidden tabs.
- UI taps never steer the truck.
- Input is released when a modal opens, the window loses focus or the tab is hidden.
- The camera shakes the world, never the HUD.
- If WebGL can't start, you see a clear message.

**Not included:** the optional bonus chain-break effect. The brief marks it as optional polish, so it was left out to keep the cargo accounting simple.

## Project layout

```
src/
  main.ts                 entry
  game/                   deterministic simulation (no three.js / DOM)
    config.ts             all tuning: palette, grid, vehicle, crusher, depot, upgrades, areas, camera, quality
    GameSim.ts            owns state + systems, emits events, save snapshot/restore
    BlockField.ts         occupancy grid: layers, HP, break-once, bitmap import/export
    LevelGen.ts           seeded area generation (exact ratios via ranked scores)
    CargoLedger.ts        stored/reserved cargo, pickup timing, invariant
    VehicleSim.ts         kinematic truck, circle collision, K-turn, breadcrumb retrace
    CrusherSystem.ts      oriented, swept working region; damage; reserve-then-break
    DepotSystem.ts        depot layout, dwell, per-unit unloading
    Game.ts               state machine, frame loop, events → visuals/audio/HUD, onboarding
    state.ts, util.ts
  render/                 three.js views (instanced field, truck, depot, effects, camera, lights)
  audio/AudioManager.ts   procedural Web Audio
  input/InputManager.ts   floating joystick (pointer capture) + keyboard
  persistence/SaveManager.ts
  ui/                     HUD, panels, inline SVG icons, styles.css
tests/                    invariants, no-trap fuzz, bot pacing playthrough
docs/screenshots/         captured from the production build (headless Chrome)
```

The simulation is the source of truth. Views only read state and consume events. Cosmetic effects never record money, cargo or rewards.

**Cargo invariant:** `stored + reserved ≤ capacity`. A slot is reserved at the moment a layer breaks, before its pickup flight starts, so several breaks in the same step can't overfill the bin.

## Debugging

Add `?debug` to the URL (for example `http://localhost:5173/?debug`) to see an overlay with fps, draw calls, triangle count, the cargo ledger, layers left and the current state. It also exposes `window.__tbd` (`game`, `sim()`) for poking at state from the console.

## What was verified, and what wasn't

**Automated (`npm test`, 44 tests, about 1 s):**
- Every layer breaks exactly once, and a cell loses at most one layer per step.
- `stored + reserved ≤ capacity` holds on every step, including while weaving through the field with many simultaneous breaks. Crushing stops when the bin is full, and no rewards are lost.
- Unloading pays exactly the ledger value, once. Driving off the pad stops the sale at a unit boundary.
- Upgrade purchases are atomic, rapid taps can't overspend, maxed upgrades can't be bought, and the roller width and capacity really change the collider and the ledger.
- Save/load keeps cleared layers, in-flight pickups (saved as stored), upgrades and the completion reward, which is still paid only once. Corrupt or out-of-range saves are rejected.
- **No trapping.** In 9 scenarios, the truck harvests by random-walking until the bin is full, then a route-following driver gets it back to SELL. In 21 more scenarios, retracing the truck's whole track brings it back to the depot. In all 30, the truck's collision circles never go deeper than the solver tolerance (0.06) into an intact block.
- **Pacing.** A bot plays all three areas; see [TUNING.md](TUNING.md).

**In a browser.** This was headless Chrome driven by playwright-core on an Apple M4 Mac, not on a phone.
- Tested at 390×844, 360×800 and 1440×900.
- The whole first loop works with the mouse-drag joystick: first full load at about 30 s, back at the pad in 5.8 s, 96 units sold for exactly 384 coins, the onboarding upgrade sheet opens, and buying the roller takes 384 → 204 coins and 1.45 → 1.95 m.
- Real touch drags (CDP touch events) steer the truck, it stops when you let go, and tapping UI doesn't steer.
- Keyboard driving works.
- Clearing an area pays the bonus once, the gate opens after selling, and driving through it goes to Area 2. Areas 2 and 3 render correctly.
- The completion panel and Free Play work.
- Reloading restores the game state.
- Corrupt saves show the recovery dialog.
- Low graphics and reduced motion both work and are saved.
- The production build loads with no console errors or missing resources.
- The AudioContext starts on the first gesture.
- Frame time: 16.6 ms on average (vsync-locked 60 fps) while harvesting on Auto and on Low, on that Mac only. At the start of each area the scene is about 97 k (Area 1), 165 k (Area 2) and 220 k (Area 3) triangles, with about 175 draw calls.

**Not verified:**
- Real phones (iOS Safari, Android Chrome), including touch feel, performance, safe-area insets on notched screens and the dynamic toolbar.
- How the audio actually sounds. Only the fact that it starts and throws no errors was checked.
- Vibration on a real device.
- Recovering from a lost WebGL context.
- The "storage unavailable" path in a real private-browsing session. It's covered by unit tests only.
