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
// A cannon is a quick, punchy ballistic spectacle (a launched arc, like the loop's
// ride): its appeal is the readable shot, not a long winding run, so it clears a
// gentler run-length floor — the same reasoning that gives loop/pod their overrides.
const MIN_RUN_TICKS_CANNON = 2.0 * TICK_RATE;
// A circuit is a teleporter contraption (a tour through two stages); its appeal is
// the routing, not a marathon, so it clears a slightly gentler run-length floor.
const MIN_RUN_TICKS_CIRCUIT = 3.0 * TICK_RATE;
// v1's calibration learning: completed runs measure ~1.6-2.0x travel; gates above
// what the generator actually produces exhaust the search and ship fallbacks.
// Stairs maps trade horizontal distance for turn density (v1 did the same
// per-style override for mid-bowl: 1.25x vs 1.75x). Kicker trades distance for
// its dramatic single kick + return ramp — a short band by design — so it gets
// the same kind of override.
// Lowered: a BUSY map (the ball caroming off many modifiers) covers less net path
// than a clean sweep — the bounces partly cancel — but the journey is longer in
// TIME and interactions, which is the actual "send it around the map" feel. So we
// lean on the run-time + modifier-count gates and relax raw path length.
const MIN_TRAVEL_RATIO = 1.25; // path length vs canvas width
const MIN_TRAVEL_RATIO_STAIRS = 1.05;
const MIN_TRAVEL_RATIO_KICKER = 1.1;
const MIN_TRAVEL_RATIO_POD = 1.15; // a pod ends the run early (no floor slide), so less path
// A cannon is mostly ONE big airborne arc — huge span, but the net path is short
// (no winding band, no long floor slide), so it earns the most lenient travel bar.
const MIN_TRAVEL_RATIO_CANNON = 0.8;
const MIN_HORIZONTAL_RANGE = 0.45;
const MIN_VERTICAL_RANGE = 0.6;
const MIN_REVERSALS = 3;
const MIN_RAMP_TOUCHES = 3;
// The interest guarantee: every shipped map must put the ball through at least
// this many DISTINCT modifiers that measurably changed its motion — a fired
// pad, a live bumper kick, a variant surface (ice/trampoline/conveyor) it rode,
// a turbo ring, a teleport. Plain ramps/walls/basins never count. Raised from 3:
// sparse maps (a couple of lonely modifiers) are the core "boring" complaint, so
// every shipped map must be genuinely BUSY — the ball caroms through a real chain.
const MIN_TANGIBLE_MODIFIERS = 5;
const VARIANT_KINDS = new Set(["ice", "trampoline", "conveyor"]);
const LANDING_MARGIN = 0.05; // landing must be in the central 90% of width
const MIN_SPREAD_RATIO = 0.03; // perturbation spread: skill-readable…
// The READ must be a skill, not a gamble: a small change in the drop must not
// fling the ball to a totally different place. Tightened from 0.55 — high spread
// is the "luck" feeling we're designing AWAY from. Interest comes from
// misdirection (below), not from outcome variance.
const MAX_SPREAD_RATIO = 0.42;
// Misdirection — the heart of the fun. We run the map twice: once for real, once
// with every force/energy gimmick neutered (pads/turbos/fields/wind/belts removed,
// ice & trampoline & conveyor surfaces made plain, bumpers made inert). The
// distance between the two landings is how much the gimmicks REDIRECT the ball
// from where a naive "just ramps + gravity" read would send it. A good map has a
// big gap (a real "ohh, the boost pad carried it over" twist) — so we both GATE on
// a minimum and REWARD it in funScore. This is what makes a map clever instead of
// obvious, without making it random.
const MIN_MISDIRECTION = 0.12; // landing must move ≥12% of width vs the naive read
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
  /**
   * How far the real landing sits from a naive "just ramps + gravity" read, as a
   * fraction of width. The gimmicks' redirect — the map's cleverness. High = a
   * real "ohh, I didn't see that coming but it makes sense" twist; ~0 = obvious.
   */
  misdirection: number;
  landings: Vec2[];
}

/**
 * A copy of the map with every FORCE/ENERGY gimmick removed but all GEOMETRY kept,
 * so a sim of it traces what a naive player reading "ramps + gravity" would expect.
 * Comparing this landing to the real one measures how much the gimmicks misdirect
 * the ball (see Validation.misdirection). Pads/turbos/fields/wind/teleporters are
 * dropped; ice/conveyor/trampoline surfaces become plain ramps; bumpers go inert.
 */
function neuter(map: MapDef): MapDef {
  const out: MapDef = {
    ...map,
    surfaces: map.surfaces.map((s) => {
      if (s.kind === "ice" || s.kind === "conveyor") {
        const { belt: _belt, ...rest } = s;
        return { ...rest, kind: "ramp", friction: 0.3 };
      }
      if (s.kind === "trampoline") return { ...s, kind: "ramp", restitution: 0.25 };
      return s;
    }),
    bumpers: map.bumpers.map((b) => ({ ...b, kick: 0, maxHits: 0 })),
    pads: [],
    turbos: [],
    teleporters: [],
    fields: [],
  };
  delete out.wind;
  return out;
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
  const minRunTicks =
    archetype === "cannon" ? MIN_RUN_TICKS_CANNON : archetype === "circuit" ? MIN_RUN_TICKS_CIRCUIT : MIN_RUN_TICKS;
  if (base.ticks < minRunTicks) {
    failures.push(`run too quick: ${(base.ticks / TICK_RATE).toFixed(1)}s < ${(minRunTicks / TICK_RATE).toFixed(1)}s`);
  }
  const minTravel = archetype === "cannon"
    ? MIN_TRAVEL_RATIO_CANNON // a cannon stays short even if it ends in a pod
    : settledInPod
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
  // gentler span requirement. Elevated pods get the same gentler vertical span. A
  // cannon's arc is vertical-dominant (up and over), so it gets loop's gentler
  // horizontal-span bar; its big vertical span clears the standard one easily.
  const minSpanX = archetype === "loop" || archetype === "cannon" ? 0.4 : MIN_HORIZONTAL_RANGE;
  const minSpanY = archetype === "loop" ? 0.42 : settledInPod ? 0.3 : MIN_VERTICAL_RANGE;
  if (base.spanX < minSpanX * W) {
    failures.push(`horizontal span ${(base.spanX / W * 100).toFixed(0)}% < ${minSpanX * 100}%`);
  }
  if (base.spanY < minSpanY * H) {
    failures.push(`vertical span ${(base.spanY / H * 100).toFixed(0)}% < ${minSpanY * 100}%`);
  }
  // Cannon (a clean arc) is EXEMPT from the reversal gate; a circuit's signature
  // direction change is the WARP itself (left → right across the canvas), so one
  // physical reversal in its descent is plenty. Pods (an early stop) get a gentle 2.
  // The rest must zig-zag (3). Same spirit as loop being exempt from misdirection.
  const minReversals =
    archetype === "cannon" ? 0 : archetype === "circuit" ? 1 : settledInPod ? 2 : MIN_REVERSALS;
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
  // Bands must be BUSY (≥5 — many modifiers); loop is a self-contained spectacle
  // (the ride is the interest) so it keeps the original gentler floor. Cannon's
  // launch pad + the rings/bumpers studded along its arc make it busy, but the arc
  // has less room than a full descent — a middle floor between loop and the bands.
  const minMods = archetype === "loop" || archetype === "cannon" ? 3 : MIN_TANGIBLE_MODIFIERS;
  if (base.tangibleModifiers < minMods) {
    failures.push(
      `only ${base.tangibleModifiers} tangible modifier(s) [${base.modifierKinds.join(", ") || "none"}] < ${minMods}`,
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
  // A circuit is EXEMPT from the min-spread floor: its teleporter erases the spawn
  // perturbation by construction (every nudge re-emerges at the same exit), so it is
  // a fully deterministic contraption — the read is tracing the elaborate path, not
  // judging uncertainty (the same spirit as loop's exemptions). The MAX still applies.
  if (spread < MIN_SPREAD_RATIO && archetype !== "circuit") {
    failures.push(`spread ${(spread * 100).toFixed(1)}% too deterministic`);
  }
  if (spread > MAX_SPREAD_RATIO) failures.push(`spread ${(spread * 100).toFixed(1)}% is unreadable luck`);

  const xs = landings.map((l) => l.x).sort((a, b) => a - b);
  let clusters = 1;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i]! - xs[i - 1]! > CLUSTER_GAP) clusters++;
  }

  // Misdirection: where does the ball go with the gimmicks NEUTERED (the naive
  // "ramps + gravity" read)? The distance from that to the real landing is how
  // much the map's features actually trick you — its cleverness. A map whose
  // gimmicks barely change the outcome is "obvious"; reject it.
  const naive = measureRun(neuter(map));
  const mdx = base.landing.x - naive.landing.x;
  const mdy = base.landing.y - naive.landing.y;
  const misdirection = Math.sqrt(mdx * mdx + mdy * mdy) / W;
  // Loop is exempt: its appeal is the SPECTACLE of riding the loop, not tricking
  // the eye — and neutering removes the turbo so the naive ball can't complete it,
  // which would read as artificial misdirection anyway. Every other archetype must
  // earn a real twist (no obvious trickle-down-to-the-basin maps).
  if (archetype !== "loop" && misdirection < MIN_MISDIRECTION) {
    failures.push(`misdirection ${(misdirection * 100).toFixed(1)}% < ${MIN_MISDIRECTION * 100}% (too obvious)`);
  }

  return { pass: failures.length === 0, failures, metrics: base, spread, clusters, misdirection, landings };
}
