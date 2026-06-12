# GravGuess 2.0 — Rebuild Prompt

A copy-pasteable prompt for building a from-scratch successor to GravGuess. It encodes every
hard-won lesson from v1 (see `GAME.md` and the session memory) so a fresh build doesn't
rediscover them, and demands the foundations v1 lacks: shared deterministic dailies, a
server-curated seed pool, replays, and mobile-first polish.

---

You are building **GravGuess 2.0** from scratch: a daily physics-prediction puzzle — "Wordle
for physics." One deterministic marble-run map per day, identical for every player on Earth.
You study the map, place one guess marker anywhere in 2D, drop the ball, and score by how
close the ball settles to your guess. 60 seconds of play, one shareable result, come back
tomorrow.

## Product pillars (in priority order)

1. **The map IS the game.** There is no inventory, no upgrades, no levels to grind — the
   daily map is 100% of the content. A boring map means a boring day, and one boring day
   breaks a daily ritual. Treat the generator the way a studio treats its level designers:
   it is the single most important system in the product, and every other system exists to
   deliver its output. When prioritizing work, generator quality wins ties.
2. **The run is the show.** The ball must take a long, winding, readable journey — rolling,
   swooping, bouncing, riding lifts — never a boring drop. Watching it should be satisfying
   even when you lose.
3. **Same map for everyone.** The daily must be bit-identical across devices, browsers, and
   screen sizes. This is non-negotiable and drives the architecture.
4. **Skill-readable, not deterministic-feeling.** A player who studies the modifiers should
   beat a player who guesses randomly, but nobody should be able to compute the answer
   exactly.
5. **Juice everywhere.** Neon aesthetic, trails, particle bursts per mechanic, screen shake,
   confetti on settle, idle animations on every modifier, animated backdrop. Respect
   `prefers-reduced-motion`.

## Architecture requirements (these fix the v1 mistakes — do not relitigate)

- **Fixed logical resolution** (e.g., 1280×640) with letterboxed scaling. v1 generated maps
  per-viewport, so two players never saw the same map. Never derive gameplay from screen size.
- **Deterministic simulation**: fixed timestep, seeded PRNG, no `Date`/`Math.random` in the
  sim path. If the physics engine can't guarantee cross-platform determinism, record the
  authoritative run server-side (or at generation time) and treat the client sim as visual.
- **Server-curated seed pool**: generation + validation runs OFFLINE in a pipeline, not on
  the client at load. Ship only seeds that passed every gate. `GET /daily` returns the seed,
  the authoritative landing point, and the par score. Client never sees a fallback map.
- **Replay format**: every run is reproducible from (seed, drop). Yesterday's winning ghost
  ball plays on today's menu. Friends' results render as ghosts after you've played.

## The generation algorithm (v1's crown jewel — keep and extend)

Two-layer journey guarantee:

1. **Constructive**: the generator keeps a planned-travel ledger (sum of designed ramp
   lengths, hops, slope, runout) and keeps adding structure until the designed path ≥ 2×
   canvas width.
2. **Enforced**: a headless bot simulates every candidate and rejects any map where the
   measured run doesn't (a) span ≥50% of width and ≥60% of height, (b) travel ≥1.75× width,
   (c) reverse horizontal direction ≥3 times, (d) stay in motion ≥5 seconds, (e) touch EVERY
   modifier type present on the map, and (f) land 10 perturbed spawns within a 4–50% spread
   (too tight = boring, too wide = unreadable luck).

Generate-and-reject with hundreds of candidates per day is fine — attempts are milliseconds.
Tune gates against batch reports (pass-rate per archetype + failure histograms), never by
intuition.

## The fun bar (valid ≠ interesting — gate for BOTH)

The validator above proves a map *works*. It does not prove a map is *worth playing*. v1
learned that a generator tuned only against pass/fail gates converges on the dullest map
that passes — every gate needs a fun-side counterpart, and the pipeline must score and rank
candidates, not just accept the first survivor:

- **Every map needs a signature moment.** One identifiable "oh!" beat per map — a loop, a
  near-miss over a gap, a teleport reversal, a last-second magnet steal. The bot's event log
  makes this checkable: require at least one high-drama event (large velocity change, long
  airtime, direction reversal in the final 25% of the run) and surface it in batch reports.
  A map that is merely traversed is a rejected map.
- **Decision ambiguity is the puzzle.** The best maps present 2–3 *plausible* destinations
  that a thoughtful player must arbitrate between. Use the 10-perturbed-spawns data: if all
  ten land in one tight cluster the answer is obvious (boring); score candidates higher when
  perturbations form 2–3 distinct landing clusters with one dominant. That bimodality is
  what makes a guess feel like a read instead of a measurement.
- **The map must be readable as a story.** A player gets ~60 seconds to study it. The
  intended path should be *suggestible* at a glance (ramps visually flow into each other)
  while the outcome stays uncertain. Penalize visual spaghetti: overlapping structures,
  modifiers that never matter, dead geometry the ball can't reach. Every element on screen
  should either touch the run or bait a misread — decorative clutter is a lie to the player.
- **Difficulty has a rhythm.** Score each candidate's difficulty (perturbation spread,
  modifier count, path length) and curate the *week*, not just the day: Monday gentle,
  midweek spiky, weekend showpieces. Same pipeline, one extra ranking pass over the pool.
- **Variety is enforced, not hoped for.** Fingerprint each shipped map (archetype, modifier
  set, destination type, landing-zone region, path shape histogram) and reject any candidate
  too similar to the last N dailies. Two near-identical days in a row reads as "the game ran
  out of content" — the daily-ritual kiss of death.
- **Watch real runs, in batch.** The pipeline must render candidate runs to a contact-sheet
  (strip of trajectory thumbnails or short clips per batch). Humans are the final fun gate:
  ten seconds of scanning a contact sheet catches "technically valid but lifeless" patterns
  that no metric will. Promote recurring human judgments into new scored metrics over time.

The order of operations is fixed: a candidate must pass validity gates, then score above the
fun bar, then survive the variety check — and the daily is picked from the *top* of the
ranked survivors, never the first one that limped through.

## Hard-won physics design laws (violating these cost v1 weeks)

- Slow balls pin on any surface tilted under ~0.15 rad — every traversal surface keeps real
  tilt; only intended rest spots (bowls, basins, pods) are flat.
- Every ramp-to-ramp handoff needs a generous catch margin in the direction of travel —
  re-convergence comes from catch geometry, never from guard walls or flicks (those become
  rest-pocket traps).
- One speed injection per run segment max; mid-run boosts make handoffs unpredictable.
- Chaos elements (bumpers) go where something downstream re-converges or absorbs them
  (a basin, a bowl), never right before the finale.
- Bumper kicks reflect velocity (preserve flow direction) and cap at ~3 hits per bumper.
- Wind ≤5% of gravity or it dominates all geometry.

## Content

- 8–12 map archetypes with genuinely different switchback rhythms (long sweeps, stair-steps,
  ice glides, all-curves rollercoaster), curved swoop ramps, loops, quarter-pipes, S-shaped
  return legs, and 4+ distinct destinations (floor basin, mid-air bowl, lift-fed sky pod...).
- Modifier roster: boost pads, pop bumpers, deflectors, capacitors, teleporters, magnets,
  gravity lifts, fans, turbo rings, conveyors, trampolines, ice. Every modifier must be
  (a) visually animated, (b) explained in an always-visible legend, and (c) provably touched
  by the bot on every shipped map.
- Daily mutators on the same validator rails (low-gravity day, double-bumper day).

## Meta & retention

- 2D accuracy scoring (distance / canvas diagonal), percentile vs all players, streaks,
  emoji share card with a spoiler-free map silhouette.
- Practice mode on archived seeds; tutorial that teaches by showing the predicted landing.
- Leaderboard by friend code. No accounts required to play; localStorage first, sync later.

## Design backlog — veteran's picks (build AFTER the core loop ships, in roughly this order)

These are the ideas that separate a clever toy from a game people play for 300 days straight.
Each one preserves pillar 3 (prediction purity): nothing here lets a player steer the ball.

### Prediction depth (more skill expression per guess)
- **Confidence wager.** Before dropping, the player sizes their guess ring: tiny ring = high
  score multiplier, wide ring = safe. One slider, zero new UI concepts, and suddenly every
  guess is a bet. Share cards read "Called it with a 28px ring" — that's the brag line.
- **Prop calls.** Optional side-predictions for bonus points: "the ball will complete the
  loop," "it'll touch the teleporter," "it settles left of the slope." Three checkboxes max.
  Veterans read the map deeper; beginners ignore them and lose nothing.
- **Sketch-the-path week.** A special mode where you draw the route you think the ball takes
  (scored against the real trajectory, not just the endpoint). Brutally hard, gloriously
  shareable overlays.

### Spectacle (the run is the show — make it a broadcast)
- **Photo-finish time dilation.** When the ball's speed drops near the settle threshold,
  dilate time 4× and ease the camera in. The last second is the emotional payoff of the
  whole session; spend the drama budget there.
- **The Announcer.** A one-line dynamic caption bar reacting to sim events: "THE LOOP —
  CLEAN!", "bounced THREE times off the bumper…", "she's going for the sky pod!" Costs a
  string table keyed off collision events; buys the game a personality.
- **Cinematic map reveal.** A 3-second camera pan along the *intended* path direction (top to
  destination) before guessing opens. Teaches the map, builds anticipation, skippable on tap.
- **Distance in ball-widths.** Report misses in ball-widths, not pixels ("1.5 ball-widths
  off!"). Humans feel object-relative distance; pixels are for engineers.

### Social & daily ritual (the Wordle muscle)
- **Global guess heatmap.** After you've played, reveal every player's guess as a heatmap
  with the landing point burned in. Instantly answers "was I smart or lucky?" — the single
  strongest retention screen this genre can have, and it's spoiler-proof by construction.
- **Percentile, not just accuracy.** "Top 8% today" beats "91.3%." Score vs the field, and
  let the share card lead with it.
- **Ghost guesses.** Friends' markers appear as faded ghosts on your result screen (never
  before you play). Friend-code follow list, no accounts.
- **Streak insurance.** A missed day costs a "snowday token" (earned every 7-day streak)
  instead of the streak. Loss-aversion retention without dark patterns.

### Modes & live-ops (same validator rails, new rules)
- **Mutator calendar.** Weekday-themed dailies on the same pipeline: Low-Gravity Monday,
  Double-Bumper Wednesday, Mirror Friday (map flips at noon UTC), Fog Sunday (one modifier
  hidden until touched). The validator re-gates every mutated seed — mutators are config,
  not code paths.
- **Duels.** Async 1v1: both players get the same seed; closest guess wins; best of 5 maps.
  Then the spicy variant — after guessing, each player places ONE bumper on the *opponent's*
  map (validator pre-approves legal placements so no softlocks).
- **The Architect's Weekly.** Community-built maps (the map-maker already exists) submitted
  to the validator pipeline; the best one ships as Saturday's daily with the creator's name
  on the share card. UGC with a quality gate is a content firehose you don't have to staff.
- **Seasons.** Monthly rule-shifts (March: heavier ball; April: bouncier world) with a
  season-scoped leaderboard and one cosmetic ball-trail reward. Resets keep the leaderboard
  honest and re-onboard lapsed players.

### Feel & craft details that read as "expensive"
- **Distinct silhouettes per modifier** — colorblind-safe by shape, not hue (a bumper is
  round, a capacitor is a slab, a fan is a slatted column). The legend becomes optional
  after a week of play; that's the goal.
- **Lab notebook.** Auto-collected stamps for witnessed physics moments ("first clean loop,"
  "ball stolen by the magnet at the last second"). Cheap collectibles that double as a
  tutorialization checklist of every mechanic.
- **Haptics on mobile** keyed to the same event bus as particles: tick on bumper, swell on
  lift, thump on settle. One afternoon of work; the game suddenly feels native.

## Engineering bar

- TypeScript, React (UI only — sim is pure and framework-free), full test suite for the
  sim/validator, batch sanity scripts in CI (N seeds must pass 100% before deploy). Batch
  reports include the fun-bar scores (signature-moment rate, cluster bimodality, variety
  distance), not just pass/fail — regressions in map *quality* should fail CI as loudly as
  regressions in map validity.
- Mobile-first touch controls; 60fps on a mid-range phone; level load <300ms perceived.
- Ship vertical slices: (1) deterministic sim + one hand-built map playable end to end,
  (2) generator + validator pipeline, (3) daily loop + share, (4) juice pass, (5) meta.
  Each slice demo-able in the browser before the next starts.

Start by proposing the deterministic-simulation strategy (engine choice and how you'll prove
cross-device determinism with a golden-replay test), then build slice 1.
