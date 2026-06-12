# GravGuess 2.0

Daily physics-prediction puzzle — "Wordle for physics." One deterministic marble-run map per
day, identical for every player. Study the map, place one guess for where the ball settles,
drop it, score by distance. See `REBUILD-PROMPT.md` for the full product spec.

## Workspace

| Package | Purpose |
|---|---|
| `packages/sim` | Pure deterministic physics sim. Zero dependencies, framework-free, runs identically in Node and every browser. |
| `packages/gen` | Generator (probe-based constructive switchbacks) + validator (v1-calibrated gates) + generate-and-reject + fun-bar ranking. |
| `packages/pipeline` | Offline daily publisher: ranked survivors → variety check → authoritative run + par → static JSON in `apps/web/public/dailies/`. |
| `apps/web` | Vite + React client. UI shell only — fetches the published daily, never generates it. |

## Determinism strategy

The sim is bit-identical across platforms because it only uses IEEE 754 operations that are
exactly specified (`+ - * /`, `Math.sqrt`) — never `Math.sin/cos/pow/exp` (implementation-
defined), `Math.random`, or `Date`. Fixed 120Hz timestep, fixed 1280×640 logical resolution,
seeded sfc32 PRNG. Every tick folds the ball state's raw float bits into a digest; the
golden-replay test (`packages/sim/test/golden.test.ts`) pins the digest of the hand-built
map. CI must run that test on Node + browsers — any cross-platform divergence, even one
mantissa bit, fails loudly.

## Commands

```bash
pnpm install
pnpm dev          # play today's daily at http://localhost:5173
                  #   ?seed=anything for practice maps, ?seed=first-light for the hand-built map
pnpm test         # all suites incl. golden replay
pnpm typecheck
pnpm --filter @gravguess/sim trace      # print a run's trajectory + event log
pnpm --filter @gravguess/gen batch 60   # generator health report (THE tuning tool)
pnpm --filter @gravguess/pipeline publish-dailies 2026-06-12 21   # publish daily JSONs
```

## Slice plan (from REBUILD-PROMPT.md)

1. ✅ Deterministic sim + hand-built map playable end to end
2. ✅ Generator + validator pipeline (3 archetypes; probe-based construction; v1-calibrated gates)
3. ✅ Daily loop: offline publisher (ranked + variety-checked seed pool), play-once-per-day,
   streaks, par, spoiler-free share card, countdown; client verifies the published digest
   (live determinism canary)
3.5 ✅ v1 parity wave 1: modifiers (boost pads, ice, trampolines, conveyors) through the
   whole stack; menu screen, per-map legend, how-to-play overlay; terminal-velocity cap
   (doubles as the tunneling guard)
4. Juice pass (particles, screen shake, settle confetti, time dilation, map-reveal pan)
5. Meta (percentiles, ghosts, leaderboards) + remaining v1 modifiers (teleporters, magnets,
   gravity lifts, fans, turbo rings, capacitors, wind), more archetypes & destinations,
   map-maker, contact-sheet rendering for human review
