# Harvest Circuit

A mobile-portrait, active-to-idle harvesting game. Hold the field to drive your harvesters
around a serpentine loop; they cut ripe crops their header can reach, fill their crates and
sell automatically when they pass the silo. Spend on more machines, merges, irrigation, speed,
storage, Auto Drive, field expansion — and a second field (Corn).

Built with **Vite + vanilla TypeScript + Three.js**. Everything in the play area is a real
WebGL scene built procedurally from primitives (no image, model, font or audio assets; no CDN),
so the game works offline once loaded. UI is HTML/CSS on top.

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (portrait; desktop shows a centred phone frame)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the build
npm run typecheck  # tsc --noEmit
npm test           # simulation tests (vitest)
npm run balance    # scripted players → pacing timeline for the current config
```

`devices.html` (dev server only, not part of the build) shows the game side by side at
390×844 and 360×740 in iframes with separate save slots (`?s=<name>`). Adding `?slot=<name>`
to the game URL uses a separate save as well.

## Controls

- **Hold** anywhere on the field (touch or mouse) or hold **Space** to drive every harvester.
  A tap gives a ~0.5 s push. More fingers never go faster — speed is capped.
- Buttons never drive the harvesters (they live outside the field element).
- After **AUTO** is bought the machines drive on their own at base speed; holding boosts them
  to 1.75×.
- **?** — one-screen help + mute. **⚙** — sound, volume, reset progress (two-step confirm).
- **FARMS** / the field chip — both fields with their real income, switching, unlocking Corn.

## What is implemented

- **Simulation is the source of truth** (`src/economy.ts`): fixed 1/30 s steps through an
  accumulator (`src/clock.ts`), frame delta clamped to 0.25 s. Income never depends on frame
  rate, particle count or mesh positions. The 3D scene only reads state + an event queue.
- **Field geometry** (`src/field.ts`): horizontal corridors joined by U-turns into one closed
  loop with a return road and a silo. Each corridor has crop rows on both sides of its lane:
  strip 1 (near), strip 2, strip 3 (deep, locked until the second Expand). Tier 1 reaches
  strip 1, Tier 2 strips 1–2, Tier 3 strips 1–3 — the header crossing a patch column is what
  cuts it, and the header's 3D width matches that reach. Flags at row ends show which tier
  reaches a row. 24 near patches on the starting Wheat field.
- **Crops**: each patch has its own regrowth timer (25 s base, ±10 % jitter). Stages empty
  (stubble) → sprout → young → ripe are separate instanced models; cutting folds the stalks
  toward the header in sweep order and throws 2–4 chaff bits. Only ripe patches are cut.
- **Crates**: 1 unit per patch, capacity 8 (+4 per STORAGE level, ×2.25 for T2, ×5 for T3).
  Full crates keep driving but leave crops standing. Visible crate contents + `x/cap` pill.
- **Silo**: selling happens only when a harvester passes it with cargo — exactly once; empty
  passes pay nothing. Crop pieces fly from the moving crate into the hopper, the silo bounces,
  `+$` floats at the silo's projected screen position, small confetti.
- **Upgrades** (all numbers in `src/config.ts`): ADD (limit 4, +1 per Expand), MERGE (two of
  the same tier, closest pair; never mixes tiers; cargo carried over — tier capacity is sized
  so nothing can be lost, and any overflow would be sold, not dropped), AUTO (after 3 sales),
  WATER (−15 % grow time per level, min 8 s), SPEED (+12 %), STORAGE (+4), EXPAND (2 → 4
  corridors, then deep rows). Buttons show next price and effect (`25s → 21s`, `8 → 12`) and
  stay readable when unaffordable.
- **Real bottleneck indicator** from simulation metrics: crates full, needs more harvesters,
  waiting for crops, deeper rows need a higher tier — with a dot on the matching button.
- **Real income/min** from a 60 s ledger of actual silo sales.
- **Two fields**: Wheat and Corn have separate patches, harvesters, cargo, upgrades, Auto
  Drive, sales and missions; money and lifetime earnings are global. Corn opens once Wheat has
  Auto Drive and lifetime earnings reach $2,200 (costs $1,400). Corn: taller 3D stalks with
  cobs, reddish soil, pumpkins, $10/unit, 34 s regrowth. The field that isn't on screen keeps
  running in the simulation (only if it has Auto Drive) without being rendered.
- **Offline / hidden tab**: the same rules run with a 0.25 s step for the gap (max 2 h), only
  for fields with Auto Drive — throughput is limited by speed, regrowth, crates and silo trips.
  The wall-clock marker advances *before* simulating, so reload + visibilitychange can't pay
  twice. A "Welcome back" panel shows per-field results.
- **Missions** (one at a time, small rewards): buy another harvester → merge → Auto Drive →
  expand → open Corn Field → Tier 3 → deep rows (Corn has its own list).
- **Onboarding in play**: "Hold to harvest" until you move, silo highlight + "Crops sold!" on
  the first sale.
- **Headers fold** to a narrow transport width on U-turns and the return road and open just
  before a lane (visual only), so big Tier 3 machines stay inside the frame.
- **Juice**: wheel/reel rotation from real distance, body bob and cut kick, crate heap pulse
  when full, merge hop + puff + regrow into the bigger tier, spawn drop-in, upgrade flashes,
  sprinklers that appear per WATER level and spray, wetter soil, wind sway that picks up while
  boosting, button punch with slightly varied timing.
- **Audio** (`src/audio.ts`): procedural Web Audio SFX — snip, full, sale, upgrade, merge,
  spawn, tap, mission, low engine hum while you drive. Starts on first gesture, rate-limited,
  voice-capped, mute + volume saved.
- **Save** (`src/save.ts`): versioned localStorage, autosave every 5 s and on hide/pagehide,
  field-by-field validation with safe defaults; the game runs without storage or audio.
- **Rendering**: orthographic 3/4 camera, frustum fitted to the field + silo for whatever size
  the canvas has (recomputed on resize, smooth zoom-out on Expand), pixel ratio ≤ 2, one
  directional shadow + hemisphere light, instanced crops, ≤ 96 particle instances, merged
  vertex-coloured models, disposal when the field scene is replaced, rendering stops while the
  tab is hidden.

## Balancing

All prices, curves, rates, geometry and mission rewards: **`src/config.ts`**.
`npm run balance` plays the real simulation with a scripted player (holding the whole time
and buying greedily) plus an idle continuation and a merge comparison, and prints a timeline.
Current result for a new active player: first sale 0:10, first ADD 0:20, MERGE 0:25,
AUTO 0:30, first EXPAND ≈ 5:20, Corn Field ≈ 6:20; income keeps growing after 10 minutes.
A real-time browser session with a scripted player clicking the actual buttons matched this
(ADD 0:21, MERGE 0:26, AUTO 0:32, EXPAND 5:28, Corn 6:21).

## Project layout

```
src/config.ts    balancing & geometry constants
src/types.ts     shared types
src/field.ts     layout: corridors, patches, loop path, silo
src/path.ts      arc-length path (lines + arcs)
src/economy.ts   simulation, upgrades, missions, offline
src/clock.ts     fixed-step accumulator
src/save.ts      persistence
src/models.ts    procedural low-poly models
src/scene3d.ts   Three.js scene, camera fitting, crop/harvester visuals
src/effects.ts   particles + HTML overlay anchored to the scene
src/input.ts     hold/tap/Space input
src/audio.ts     Web Audio SFX
src/ui.ts        HUD, buttons, sheets
src/main.ts      boot, loop, events, autosave, visibility
tests/           vitest logic tests
scripts/         balance script
```

## Verification & known limits

- `npm run typecheck`, `npm test` (19 logic tests: only ripe patches are cut, full crates stop
  cutting without losing crops, the silo pays once and never for an empty crate, merge keeps
  cargo and really widens reach, Auto Drive earns with no input for 2 min, Wheat earns while
  Corn is on screen with exact money accounting, frame-rate independence, save round-trip and
  corrupt-save fallback, offline needs Auto Drive / is capped at 2 h / never pays twice,
  expand, safe spacing, bottleneck detection, header width ↔ reach) and `npm run build` pass.
- Checked in desktop Chrome through `devices.html` at 390×844 and 360×740 and at desktop size:
  first sale, ADD, MERGE, AUTO, Expand (corridors and deep rows), Corn unlock, field
  switching, FARMS/Help/Settings/reset, offline panel, reload persistence, Space, multi-touch
  cap, blur release, no console errors, no geometry leak when switching fields, no external
  network requests in the production build.
- Not verified on a physical phone or iOS Safari; safe-area insets are handled in CSS but were
  not exercised (they are 0 on desktop). Sound was exercised without errors but not listened to.
- The automated browser window was mostly in the background, where the game correctly pauses;
  several checks therefore stepped frames with the dev hook `__hc.tick(seconds)`, which runs
  the same update code as `requestAnimationFrame`.
- Offline catch-up uses a 0.25 s step instead of 1/30 s, so results can differ slightly from
  what the same time would have produced live.
- Two fields, no prestige/end state; the JS bundle is ~660 KB (~175 KB gzip), mostly Three.js.
