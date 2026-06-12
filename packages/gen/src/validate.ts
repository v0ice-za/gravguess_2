// The headless bot + gate table. Thresholds ported from v1's validator.ts
// (calibrated over thousands of candidate maps — see GAME.md in the v1 repo).
// A candidate must pass EVERY gate; the pipeline rejects and retries with a
// mutated seed. Gates are tuned against batch reports, never by intuition.

import {
  createRun,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  step,
  TICK_RATE,
  type MapDef,
  type Vec2,
} from "@gravguess/sim";

const W = LOGICAL_WIDTH;
const H = LOGICAL_HEIGHT;

// Gate thresholds (v1-calibrated where the unit transfers).
const MIN_RUN_TICKS = 3.5 * TICK_RATE; // ≥3.5s of motion
// v1's calibration learning: completed runs measure ~1.6-2.0x travel; gates above
// what the generator actually produces exhaust the search and ship fallbacks.
// Stairs maps trade horizontal distance for turn density (v1 did the same
// per-style override for mid-bowl: 1.25x vs 1.75x).
const MIN_TRAVEL_RATIO = 1.55; // path length vs canvas width
const MIN_TRAVEL_RATIO_STAIRS = 1.3;
const MIN_HORIZONTAL_RANGE = 0.45;
const MIN_VERTICAL_RANGE = 0.6;
const MIN_REVERSALS = 3;
const MIN_RAMP_TOUCHES = 3;
const LANDING_MARGIN = 0.05; // landing must be in the central 90% of width
const MIN_SPREAD_RATIO = 0.03; // perturbation spread: skill-readable…
const MAX_SPREAD_RATIO = 0.55; // …but not unreadable luck
const PERTURB_OFFSETS = [-20, -15, -10, -6, -2, 2, 6, 10, 15, 20];
const CLUSTER_GAP = 60; // px gap in landing-x that separates two clusters

export interface RunMetrics {
  settled: boolean;
  ticks: number;
  travel: number;
  spanX: number;
  spanY: number;
  reversals: number;
  landing: Vec2;
  touched: Set<string>;
  bumperHits: number;
  maxAirTicks: number;
  lateDrama: boolean; // reversal or bumper hit in the final 25% of the run
}

export function measureRun(map: MapDef, spawn?: Vec2): RunMetrics {
  const s = createRun(map, spawn);
  let travel = 0;
  let minX = s.px;
  let maxX = s.px;
  let minY = s.py;
  let maxY = s.py;
  let reversals = 0;
  let bumperHits = 0;
  let maxAirTicks = 0;
  const dramaTicks: number[] = [];

  let prevX = s.px;
  let prevY = s.py;
  while (!s.done) {
    const events = step(s);
    travel += Math.sqrt((s.px - prevX) * (s.px - prevX) + (s.py - prevY) * (s.py - prevY));
    prevX = s.px;
    prevY = s.py;
    if (s.px < minX) minX = s.px;
    if (s.px > maxX) maxX = s.px;
    if (s.py < minY) minY = s.py;
    if (s.py > maxY) maxY = s.py;
    for (const e of events) {
      if (e.type === "reversal") {
        reversals++;
        dramaTicks.push(e.tick);
      } else if (e.type === "bumper" && e.live) {
        bumperHits++;
        dramaTicks.push(e.tick);
      } else if (e.type === "air" && e.ticks > maxAirTicks) {
        maxAirTicks = e.ticks;
      }
    }
  }

  const settled = s.events[s.events.length - 1]?.type === "settle";
  return {
    settled,
    ticks: s.tick,
    travel,
    spanX: maxX - minX,
    spanY: maxY - minY,
    reversals,
    landing: { x: s.px, y: s.py },
    touched: s.touched,
    bumperHits,
    maxAirTicks,
    lateDrama: dramaTicks.some((t) => t > s.tick * 0.75),
  };
}

export interface Validation {
  pass: boolean;
  failures: string[];
  metrics: RunMetrics;
  /** Max pairwise distance between perturbed landings, as a fraction of width. */
  spread: number;
  /** Landing clusters across perturbed spawns (2–3 with one dominant = good puzzle). */
  clusters: number;
  landings: Vec2[];
}

export function validate(map: MapDef, rampIds: string[], archetype?: string): Validation {
  const base = measureRun(map);
  const failures: string[] = [];

  if (!base.settled) failures.push("did not settle (timeout)");
  if (base.ticks < MIN_RUN_TICKS) {
    failures.push(`run too quick: ${(base.ticks / TICK_RATE).toFixed(1)}s < ${(MIN_RUN_TICKS / TICK_RATE).toFixed(1)}s`);
  }
  const minTravel = archetype === "stairs" ? MIN_TRAVEL_RATIO_STAIRS : MIN_TRAVEL_RATIO;
  if (base.travel < minTravel * W) {
    failures.push(`travel too short: ${(base.travel / W).toFixed(2)}x width < ${minTravel}x`);
  }
  if (base.spanX < MIN_HORIZONTAL_RANGE * W) {
    failures.push(`horizontal span ${(base.spanX / W * 100).toFixed(0)}% < ${MIN_HORIZONTAL_RANGE * 100}%`);
  }
  if (base.spanY < MIN_VERTICAL_RANGE * H) {
    failures.push(`vertical span ${(base.spanY / H * 100).toFixed(0)}% < ${MIN_VERTICAL_RANGE * 100}%`);
  }
  if (base.reversals < MIN_REVERSALS) {
    failures.push(`reversals ${base.reversals} < ${MIN_REVERSALS}`);
  }
  const rampTouches = rampIds.filter((id) => base.touched.has(id)).length;
  const requiredRamps = Math.min(MIN_RAMP_TOUCHES, rampIds.length);
  if (rampTouches < requiredRamps) {
    failures.push(`ramp touches ${rampTouches}/${rampIds.length} < ${requiredRamps}`);
  }
  for (const b of map.bumpers) {
    if (!base.touched.has(b.id)) failures.push(`bumper ${b.id} never touched`);
  }
  for (const p of map.pads ?? []) {
    if (!base.touched.has(p.id)) failures.push(`pad ${p.id} never touched`);
  }
  if (base.landing.x < W * LANDING_MARGIN || base.landing.x > W * (1 - LANDING_MARGIN)) {
    failures.push(`landing x=${base.landing.x.toFixed(0)} outside central ${(1 - 2 * LANDING_MARGIN) * 100}%`);
  }

  // Perturbation: 10 offset spawns. Spread gates readability; clusters score ambiguity.
  const landings = PERTURB_OFFSETS.map(
    (o) => measureRun(map, { x: map.spawn.x + o, y: map.spawn.y }).landing,
  );
  let spreadPx = 0;
  for (let i = 0; i < landings.length; i++) {
    for (let j = i + 1; j < landings.length; j++) {
      const dx = landings[i]!.x - landings[j]!.x;
      const dy = landings[i]!.y - landings[j]!.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > spreadPx) spreadPx = d;
    }
  }
  const spread = spreadPx / W;
  if (spread < MIN_SPREAD_RATIO) failures.push(`spread ${(spread * 100).toFixed(1)}% too deterministic`);
  if (spread > MAX_SPREAD_RATIO) failures.push(`spread ${(spread * 100).toFixed(1)}% is unreadable luck`);

  const xs = landings.map((l) => l.x).sort((a, b) => a - b);
  let clusters = 1;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i]! - xs[i - 1]! > CLUSTER_GAP) clusters++;
  }

  return { pass: failures.length === 0, failures, metrics: base, spread, clusters, landings };
}
