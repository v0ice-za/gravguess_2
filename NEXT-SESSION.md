# GravGuess 2.0 — Session Context & Next-Session Itinerary

_Written 2026-06-12 at the end of the first build session. Read this (plus `README.md` and
`REBUILD-PROMPT.md`) before writing any code._

## Guiding principle

**v2 must be a vast improvement over v1, never just parity.** When porting any v1 system,
port the lesson, not the implementation — then add what v1 couldn't do. Every ported
feature must answer: what does the v2 version do that v1's never could?

## What exists (all committed at `3bdc3b7`, all tests green)

| Piece | State |
|---|---|
| `packages/sim` | Deterministic physics: IEEE-safe ops only, 120Hz fixed step, sfc32 PRNG, tick-digest hashing, golden-replay tests. Coulomb impact friction (catch re-convergence depends on it), terminal velocity 1150 px/s (= tunneling guard). Modifiers: boost pads, ice, trampolines, conveyors. Event bus: touch/pad/collide/bumper/reversal/air/settle. |
| `packages/gen` | Probe-based constructive generator (simulates partial map to place each catch — v2's big win over v1's fixed 170px margins). 3 archetypes (sweep/stairs/kicker, v1 ARCH-calibrated). Validator: v1's gate table + every-modifier-touched + perturbation spread 3–55%. Fun score + ranked survivors. Batch tool: `pnpm --filter @gravguess/gen batch 60`. |
| `packages/pipeline` | Offline daily publisher: ranked survivors → archetype-first variety check → authoritative landing + digest + par → static JSON in `apps/web/public/dailies/` (21 days published). `pnpm --filter @gravguess/pipeline publish-dailies <date> <days>` |
| `apps/web` | Menu (Daily/Practice/How-to-play/MapMaker-disabled), legend strip, tutorial overlay, play-once-per-day, streaks, par, spoiler-free share card, countdown, determinism canary (client digest vs published). `?seed=x` = practice, `?seed=first-light` = hand map. |

## Hard-won session lessons (do not re-learn)

1. Catch-ramp re-convergence physically requires impact friction; gate it to impacts
   >100 px/s normal speed or it pins balls on ramps.
2. Fun-score ranking converges on one archetype — freshness must outrank fun in the day
   picker, and per-archetype gate overrides (stairs travel 1.3x) keep pools diverse.
3. Restitution >1 tunnels without the speed cap. Cap is sized so per-tick movement < ball radius.
4. Tune gates ONLY against the batch report, never intuition (v1's law, confirmed twice tonight).

## Next-session itinerary (in order)

1. **Read the user's BMAD docs** — `../gravguess/_bmad-output/` (project-context.md,
   brainstorming session) + whatever else they share. Mine for unbuilt ideas.
2. **Slice 4 — juice pass** on the existing event bus. Port v1's tuned FX (GameCanvas.tsx
   ~lines 180–300): per-mechanic burst colors, bumper = 18 particles + 7-frame shake,
   44-piece settle confetti, trail fade. Add v2-only: photo-finish time dilation
   (render-side tick pacing), 3s map-reveal pan, idle animations, `prefers-reduced-motion`.
3. **Feedback tiers** (v1 share.ts): Perfect ≥99 / Insane ≥95 / Great ≥85 / Solid ≥70 /
   Rough ≥50 / Miss — into result screen + share card.
4. **Modifiers wave 2**: turbo rings + capacitors, then force fields (fan/lift/magnet),
   teleporters, wind (≤5% gravity). Each: sim mechanic + event + generator placement +
   touch gate + visual + legend entry.
5. **Map Maker** (v1 UX spec in ONBOARDING.md: sidebar, Test Level → gate report card,
   saved maps) backed by v2's validator + fun score; export seed to the daily pool.
6. **Elevated destinations** (sky pod, mid-air bowl + settle-zone gate) — biggest variety lever.
7. **Deploy**: static host + nightly publish cron.

Menu polish reference: user shared v1's menu screenshot (logo banner "GRAV" glow +
"PREDICT · FALL · COMPETE", full-width green buttons). Logo asset:
`../gravguess/gravguess-frontend/public/gravguess-logo.svg`. Decide: port style vs restyle
in v2 neon.

## Tuning debt

- Stairs has the lowest raw pass-rate (already has 1.3x travel override).
- Par occasionally 500px+ when perturbations split into far clusters — cap or reject
  par > ~25% width in the publisher.
