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
// per-style override for mid-bowl: 1.25x vs 1.75x). Kicker trades distance for
// its dramatic single kick + return ramp — a short band by design — so it gets
// the same kind of override.
const MIN_TRAVEL_RATIO = 1.55; // path length vs canvas width
const MIN_TRAVEL_RATIO_STAIRS = 1.3;
const MIN_TRAVEL_RATIO_KICKER = 1.35;
const MIN_TRAVEL_RATIO_POD = 1.15; // a pod ends the run early (no floor slide), so less path
const MIN_HORIZONTAL_RANGE = 0.45;
const MIN_VERTICAL_RANGE = 0.6;
const MIN_REVERSALS = 3;
const MIN_RAMP_TOUCHES = 3;
// The interest guarantee: every shipped map must put the ball through at least
// this many DISTINCT modifiers that measurably changed its motion — a fired
// pad, a live bumper kick, a variant surface (ice/trampoline/conveyor) it rode,
// a turbo ring, a teleport. Plain ramps/walls/basins never count. A map that
// can't clear this is rejected, so "randomly generated" never means "boring".
const MIN_TANGIBLE_MODIFIERS = 3;
const VARIANT_KINDS = new Set(["ice", "trampoline", "conveyor"]);
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
  /** Count of DISTINCT modifiers that measurably acted on the ball. */
  tangibleModifiers: number;
  /** Human-readable kinds of those modifiers (for the maker report). */
  modifierKinds: string[];
  /** Ids of force fields the ball dwelt in long enough to be deflected. */
  dweltFieldIds: string[];
}

const FIELD_DWELL_TICKS = 6; // ticks inside a field that count as a real deflection

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

  // Distinct modifiers that measurably acted on the ball.
  const firedPads = new Set<string>();
  const liveBumpers = new Set<string>();
  const turboFires = new Set<string>();
  const teleports = new Set<string>();
  const fields = map.fields ?? [];
  const fieldDwell = fields.map(() => 0);

  let prevX = s.px;
  let prevY = s.py;
  while (!s.done) {
    const events = step(s);
    travel += Math.sqrt((s.px - prevX) * (s.px - prevX) + (s.py - prevY) * (s.py - prevY));
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      if (Math.abs(s.px - f.pos.x) <= f.halfW && Math.abs(s.py - f.pos.y) <= f.halfH) fieldDwell[i]!++;
    }
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
        liveBumpers.add(e.bumperId);
        dramaTicks.push(e.tick);
      } else if (e.type === "air" && e.ticks > maxAirTicks) {
        maxAirTicks = e.ticks;
      } else if (e.type === "pad") {
        firedPads.add(e.padId);
      } else if (e.type === "turbo") {
        turboFires.add(e.turboId);
      } else if (e.type === "teleport") {
        teleports.add(e.teleporterId);
      }
    }
  }

  // Variant traversal surfaces the ball actually rode (sliding/bouncing/carried
  // IS the effect, so any contact counts).
  const variantSurfaces = new Set<string>();
  for (const surf of map.surfaces) {
    if (VARIANT_KINDS.has(surf.kind) && s.touched.has(surf.id)) variantSurfaces.add(surf.kind);
  }

  // A completed loop-the-loop: touching most of a loop's `loopseg-` segments
  // means the ball rode all the way around — unmistakably a tangible interaction.
  let loopSegsOnMap = 0;
  let loopSegsTouched = 0;
  for (const surf of map.surfaces) {
    if (surf.id.startsWith("loopseg-")) {
      loopSegsOnMap++;
      if (s.touched.has(surf.id)) loopSegsTouched++;
    }
  }
  const didLoop = loopSegsOnMap > 0 && loopSegsTouched >= Math.ceil(loopSegsOnMap * 0.6);

  // Settling in an elevated pod (raised destination) is a tangible interaction in
  // its own right — and it replaces the finale bumper the early stop orphaned.
  const restedInPod =
    map.surfaces.some((su) => su.id === "pod-floor" && s.touched.has(su.id)) && s.py < LOGICAL_HEIGHT - 110;

  const dweltFieldIds: string[] = [];
  const dweltFieldKinds = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    if (fieldDwell[i]! >= FIELD_DWELL_TICKS) {
      dweltFieldIds.push(fields[i]!.id);
      dweltFieldKinds.add(fields[i]!.kind);
    }
  }

  const modifierKinds: string[] = [];
  if (firedPads.size > 0) modifierKinds.push("boost pad");
  if (liveBumpers.size > 0) modifierKinds.push("bumper");
  for (const k of variantSurfaces) modifierKinds.push(k);
  if (turboFires.size > 0) modifierKinds.push("turbo");
  if (teleports.size > 0) modifierKinds.push("teleporter");
  for (const k of dweltFieldKinds) modifierKinds.push(k);
  if (didLoop) modifierKinds.push("loop");
  if (restedInPod) modifierKinds.push("elevated pod");
  const tangibleModifiers =
    firedPads.size +
    liveBumpers.size +
    variantSurfaces.size +
    turboFires.size +
    teleports.size +
    dweltFieldKinds.size +
    (didLoop ? 1 : 0) +
    (restedInPod ? 1 : 0);

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
    tangibleModifiers,
    modifierKinds,
    dweltFieldIds,
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

  // An elevated-pod ending stops the ball HIGH on purpose (the Y-axis variety the
  // game wanted), which necessarily cuts the long floor slide — so a pod map earns
  // gentler travel / reversal / vertical-span bars (the way stairs/kicker get a
  // gentler travel one). The pod itself is gated to settle by construction.
  const settledInPod =
    map.surfaces.some((s) => s.id === "pod-floor") && base.landing.y < H - 110;

  if (!base.settled) failures.push("did not settle (timeout)");
  if (base.ticks < MIN_RUN_TICKS) {
    failures.push(`run too quick: ${(base.ticks / TICK_RATE).toFixed(1)}s < ${(MIN_RUN_TICKS / TICK_RATE).toFixed(1)}s`);
  }
  const minTravel = settledInPod
    ? MIN_TRAVEL_RATIO_POD
    : archetype === "stairs"
      ? MIN_TRAVEL_RATIO_STAIRS
      : archetype === "kicker"
        ? MIN_TRAVEL_RATIO_KICKER
        : MIN_TRAVEL_RATIO;
  if (base.travel < minTravel * W) {
    failures.push(`travel too short: ${(base.travel / W).toFixed(2)}x width < ${minTravel}x`);
  }
  // A loop is a compact spectacle: the ball's "distance" is the ~2pi*R it travels
  // AROUND the loop (gated by travel above), not canvas coverage — so it gets a
  // gentler span requirement. Elevated pods get the same gentler vertical span.
  const minSpanX = archetype === "loop" ? 0.4 : MIN_HORIZONTAL_RANGE;
  const minSpanY = archetype === "loop" ? 0.42 : settledInPod ? 0.3 : MIN_VERTICAL_RANGE;
  if (base.spanX < minSpanX * W) {
    failures.push(`horizontal span ${(base.spanX / W * 100).toFixed(0)}% < ${minSpanX * 100}%`);
  }
  if (base.spanY < minSpanY * H) {
    failures.push(`vertical span ${(base.spanY / H * 100).toFixed(0)}% < ${minSpanY * 100}%`);
  }
  const minReversals = settledInPod ? 2 : MIN_REVERSALS;
  if (base.reversals < minReversals) {
    failures.push(`reversals ${base.reversals} < ${minReversals}`);
  }
  // A curved ramp is a polyline of segments ided `ramp-2#0`, `ramp-2#1`, …; a
  // straight ramp is a single `ramp-2`. Count DISTINCT LOGICAL ramps (the part
  // before `#`) so a curve's seams don't inflate the touch count — the gate's
  // intent is "the ball traversed N different ramps", not N segments.
  const logicalRamp = (id: string) => id.split("#")[0]!;
  const rampGroups = new Set(rampIds.map(logicalRamp));
  const touchedGroups = new Set<string>();
  for (const id of rampIds) {
    if (base.touched.has(id)) touchedGroups.add(logicalRamp(id));
  }
  const rampTouches = touchedGroups.size;
  const requiredRamps = Math.min(MIN_RAMP_TOUCHES, rampGroups.size);
  if (rampTouches < requiredRamps) {
    failures.push(`ramp touches ${rampTouches}/${rampGroups.size} < ${requiredRamps}`);
  }
  if (base.tangibleModifiers < MIN_TANGIBLE_MODIFIERS) {
    failures.push(
      `only ${base.tangibleModifiers} tangible modifier(s) [${base.modifierKinds.join(", ") || "none"}] < ${MIN_TANGIBLE_MODIFIERS}`,
    );
  }
  for (const b of map.bumpers) {
    if (!base.touched.has(b.id)) failures.push(`bumper ${b.id} never touched`);
  }
  for (const p of map.pads ?? []) {
    if (!base.touched.has(p.id)) failures.push(`pad ${p.id} never touched`);
  }
  for (const tr of map.turbos ?? []) {
    if (!base.touched.has(tr.id)) failures.push(`turbo ${tr.id} never touched`);
  }
  for (const tp of map.teleporters ?? []) {
    if (!base.touched.has(tp.id)) failures.push(`teleporter ${tp.id} never entered`);
  }
  for (const f of map.fields ?? []) {
    if (!base.dweltFieldIds.includes(f.id)) failures.push(`field ${f.id} (${f.kind}) never entered`);
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
