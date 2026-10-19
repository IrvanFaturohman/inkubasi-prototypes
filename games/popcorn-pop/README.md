# Popcorn Pop! 🍿

A mobile-portrait 3D idle game prototype. A popcorn machine runs by itself: the hopper
drops kernels into the pot, kernels pop onto the tray, a fan packs popcorn into cups,
and customers buy full cups. You tap upgrades (FEED / HEAT / PACK), optionally SHAKE
the pot, and open a second kiosk.

Built with **Vite + vanilla TypeScript + Three.js**. Everything (models, textures,
sounds) is procedural — no external assets, no backend.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on your LAN for phone testing)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

To test on a phone: run `npm run dev`, then open the "Network" URL Vite prints on a phone
connected to the same Wi‑Fi.

To preview a phone size on desktop, add `?frame=WIDTHxHEIGHT`, e.g.
`http://localhost:5173/?frame=390x844`.

## How to play

- The machine works on its own from the first second — first sale after ~8 s.
- **FEED** — more kernels per second (hopper spins faster, more kernels in the hopper).
- **HEAT** — faster popping (more/taller flames, knob turns, kernels jiggle harder).
- **PACK** — faster fan; PACK Lv5 unlocks a 2nd cup, Lv9 a 3rd cup (parallel sales).
- **SHAKE** (button or tap the pot) — popping ×1.8 for 2 s, 6 s cooldown. Optional.
- Nothing is thrown away: when the pot is full the feeder pauses (red **POT FULL** tag),
  when the tray is full popping pauses (**TRAY FULL**), and packing waits while a cup is
  being picked up. The **SLOWEST** badge marks the current bottleneck upgrade.
- **Kiosks** (top-left): Fairground unlocks at 600 lifetime earnings and costs 300.
  Every kiosk keeps earning in the background; income per kiosk is listed there.
- Progress saves to `localStorage` every 5 s and when the tab is hidden/closed.
  Offline earnings (max 2 h) are shown when you come back.
- **Menu → Reset progress** asks twice before wiping the save.

## Code layout

| File | Responsibility |
| --- | --- |
| `src/config.ts` | **All balancing numbers and formulas** (rates, costs, caps, unlocks) |
| `src/economy.ts` | Game state + fixed-step simulation (no rendering), rates, offline income |
| `src/missions.ts` | 3 story missions, then an endless "sell N cups" objective |
| `src/save.ts` | localStorage load/save with validation (game still works without storage) |
| `src/audio.ts` | Procedural Web Audio SFX (pop, sale, upgrade, click, shake, fanfare) |
| `src/scene/stage.ts` | Renderer, orthographic camera + frustum fitting, tap-to-shake picking |
| `src/scene/machine.ts` | Hopper, pot, burner, tray, fan, cups; visualises stock and events |
| `src/scene/customer.ts` | Low-poly customers (two per cup slot, alternating) |
| `src/scene/theme.ts` | Cinema and Fairground set dressing |
| `src/scene/particles.ts` | Pooled InstancedMesh particles |
| `src/ui/ui.ts` | HTML/CSS HUD, upgrade buttons, tags, floaters, modals |
| `src/main.ts` | Bootstrap, main loop, visibility/offline handling |

The economy runs in fixed 1/60 s steps and never depends on frame rate or on how many
pieces are drawn. The 3D scene only reacts to simulation events and reconciles the
visible piles with the real stock (`visible = stock − pieces still in the air`).
Kiosks that are not on screen are simulated the same way, without a second 3D scene.

## Balancing parameters (`src/config.ts`)

| Parameter | Value |
| --- | --- |
| Start money | 40 |
| Feed / pop / pack interval at Lv1 | 0.85 s / 1.10 s / 1.25 s (pack is per cup lane) |
| Speed per upgrade level | ×1.18 |
| Pot cap / tray cap / cup size | 20 raw / 25 popped / 5 pieces |
| Cup price | Cinema 30, Fairground 45 |
| Customer pick-up time | 0.8 s |
| Base upgrade cost | FEED 20, HEAT 25, PACK 25 (Fairground ×1.6) |
| Cost growth per purchase | ×1.55, rounded to readable numbers |
| Extra cups | PACK Lv5 and Lv9 |
| SHAKE | ×1.8 popping, 2 s, 6 s cooldown |
| Fairground | unlock at 600 lifetime earnings, costs 300 |
| Mission rewards | 60 / 120 / 250, then ≈20 s of income per repeat objective |
| Offline cap | 2 h |

Steady-state income per kiosk = `min(feedRate, popRate, packRate) / cupSize × cupPrice`,
where `packRate = lanes × 5 / (5 × packInterval + 0.8)`. This is used for the income/s
display, the kiosk list and offline earnings.

## Debug helpers

In the browser console: `popcorn.give(1000)` adds money, `popcorn.advance(10)` fast-forwards
10 s of simulation + visuals, `popcorn.state` is the live game state.
