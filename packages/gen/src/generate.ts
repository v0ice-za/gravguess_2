
// Constructive map generator — the marble-run switchback band, ported from v1's
// design (see ../gravguess GAME.md) with one major v2 upgrade: construction by
// simulation. v1 placed catch ramps using a fixed 170px margin tuned to Matter's
// speeds; our sim is cheap enough to PROBE the partial map after every ramp and
// place the next high end exactly where the measured ball lands (plus slack).
// Catches are guaranteed by construction, not estimated.
//
// v1 invariants still honored:
//   - NO turn guards — re-convergence comes from catch geometry only.
//   - Every traversal surface tilted >= ~0.15 rad; only basins are flat.
//   - Planned-travel ledger: keep adding structure until designed path is long enough.
//   - One chaos element (bumper), placed where downstream geometry re-converges it.
// Validity is still NOT guaranteed — the validator gates every candidate.

import {
  createRun,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  prngFromSeed,
  step,
  type BoostPad,
  type Bumper,
  type ForceField,
  type MapDef,
  type Surface,
  type Teleporter,
  type TurboRing,
  type Vec2,
} from "@gravguess/sim";

export type ArchetypeName =
  | "sweep"
  | "stairs"
  | "kicker"
  | "pinball"
  | "loop"
  | "cannon"
  | "circuit"
  | "funnel";

interface Archetype {
  name: ArchetypeName;
  /** Ramp horizontal extent as a fraction of canvas width [min, max]. */
  rampLen: [number, number];
  /** Vertical drop from a lip to the next ramp's high end, px. */
  hop: [number, number];
  /** Surface tilt (dy/dx). */
  tilt: [number, number];
  /** Maximum switchback ramps (the travel ledger decides when to stop). */
  maxRamps: number;
  /** Per-ramp probability of surface variants (non-first ramps only). */
  iceP: number;
  trampP: number;
  conveyP: number;
  /**
   * Tilt swing of each (non-first) catch ramp: the fraction by which the slope
   * rises above / falls below the ramp's average tilt, steep at the catch end
   * and gentler at the lip. Turns the straight switchback band into concave
   * catch-bowl curves — the #1 fix for "too many straight lines" — while every
   * segment stays >= MIN_SEG_TILT (no flat trap, the project's law).
   */
  curve: [number, number];
}

// Personalities adapted from v1's ARCH table (incl. its surface-variant odds).
// Tilts/hops sized so enough switchbacks fit the 640px vertical budget to
// clear the reversals gate. Trampolines stay rare — bouncing down a switchback
// is fun once, but the catch margins can't contain more than that.
const ARCHETYPES: Archetype[] = [
  { name: "sweep", rampLen: [0.36, 0.5], hop: [40, 50], tilt: [0.16, 0.19], maxRamps: 8, iceP: 0.22, trampP: 0.05, conveyP: 0.14, curve: [0.9, 1.5] },
  { name: "stairs", rampLen: [0.22, 0.3], hop: [42, 52], tilt: [0.19, 0.23], maxRamps: 10, iceP: 0.2, trampP: 0.1, conveyP: 0.16, curve: [0.6, 1.0] },
  { name: "kicker", rampLen: [0.32, 0.46], hop: [40, 50], tilt: [0.16, 0.2], maxRamps: 8, iceP: 0.2, trampP: 0.08, conveyP: 0.12, curve: [0.45, 0.85] },
  // Pinball: a wide, gentle switchback band (slow, long journey) studded with a
  // bumper on EVERY hop — the ball pings off a bumper, the catch ramp below
  // re-converges the kick, ping again. Built by the normal switchback loop; the
  // per-hop bumper is added there (PINBALL_HOP_KICK). Bigger hops give the kicked
  // ball room to ricochet before the catch grabs it.
  { name: "pinball", rampLen: [0.34, 0.48], hop: [42, 54], tilt: [0.16, 0.19], maxRamps: 9, iceP: 0.16, trampP: 0.06, conveyP: 0.12, curve: [0.5, 0.9] },
  // Loop is built by a dedicated path (the switchback loop is a no-op via
  // maxRamps 0): a steep feeder + tangent run-up + turbo flings the ball around a
  // trackmania-style vertical loop, then it drops out the lower-left to a basin.
  { name: "loop", rampLen: [0, 0], hop: [0, 0], tilt: [0, 0], maxRamps: 0, iceP: 0, trampP: 0, conveyP: 0, curve: [0, 0] },
  // Cannon is the FIRST skeleton that isn't a top->bottom descent: the ball drops
  // from a LOW left spawn onto a mid-air boost pad that FLINGS it up and across the
  // canvas in a deterministic ballistic arc, then lands on the far side (dedicated
  // branch below; the switchback loop is a no-op via maxRamps 0). Like the loop, it
  // is a readable SPECTACLE rather than a winding journey, so it earns relaxed
  // run-length / travel / reversal gates in validate.ts. The direct antidote to
  // "always starts at the top, lands at the bottom": the ball starts LOW and the
  // journey goes UP and over.
  { name: "cannon", rampLen: [0, 0], hop: [0, 0], tilt: [0, 0], maxRamps: 0, iceP: 0, trampP: 0, conveyP: 0, curve: [0, 0] },
  // Circuit is a MULTI-STAGE tour: stage 1 guides the ball into a TELEPORTER that
  // warps it to a fresh region, then the switchback loop winds stage 2 down to the
  // basin (so these are stage-2's catch-band params). The teleporter both tours the
  // canvas (the ball vanishes here, reappears across there) AND resets the
  // perturbation spread, so a chained map stays a deterministic skill read. Built in
  // the circuit block below, BEFORE the loop. See [[cannon-archetype]] sibling notes.
  { name: "circuit", rampLen: [0.24, 0.36], hop: [40, 52], tilt: [0.16, 0.2], maxRamps: 5, iceP: 0.16, trampP: 0.05, conveyP: 0.12, curve: [0.4, 0.8] },
  // STRUCTURALLY DIFFERENT skeleton still to come: funnel (converging chutes). In
  // the ArchetypeName union, not yet in the rotation. (Plinko was tried and pulled:
  // a peg field is a GAMBLING read, not the readable-misdirection skill read this
  // game wants — see the misdirection objective in validate.ts/pipeline.ts.)
];

/** Every buildable archetype, for the practice picker to search one-by-one. */
export const ARCHETYPE_NAMES: ArchetypeName[] = ARCHETYPES.map((a) => a.name);

// Density tuning (tuned against the batch). EVERY band map (not just pinball) gets
// modifiers sprinkled along its COMPLETED flight arcs so the ball caroms through a
// BUSY journey instead of a quiet slide — the whole point of the game. Each is
// kept only if it stays a bounded, still-settling perturbation (final landing
// moves < DENSIFY_MAX_DEFLECT and the ball doesn't get trapped) so the proven
// band's travel/readable-spread survive, with the ricochets added on top.
const PINBALL_HOP_KICK: [number, number] = [260, 420];
const DENSIFY_MAX_DEFLECT = 230; // px the final landing may move before we keep a modifier
// Many descent fractions to space modifiers across the WHOLE journey (top to floor
// approach), so the ball interacts with something at nearly every altitude.
const DENSIFY_BANDS = [0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.72, 0.82];

// Segments per curved ramp: enough that the polyline reads as a smooth arc when
// rendered (each Surface draws as one line), few enough to keep sim cost down.
const RAMP_ARC_SEGS = 7;
// The traversal-tilt floor (the project's "no flat trap" law). Curved ramps must
// keep EVERY segment at least this steep, so the curve never introduces a slow
// spot the ball can stall on. A small margin above the validator's 0.15.
const MIN_SEG_TILT = 0.155;

/**
 * Build a curved catch ramp as a polyline whose tilt eases smoothly from
 * `tiltHi` at the high (catch) end to `tiltLo` at the low (lip) end — a concave
 * "catch bowl": steep where it grabs the ball, shallower where it releases it.
 * Because the tilt is interpolated (never a fixed perpendicular bow) every
 * segment stays >= MIN_SEG_TILT, so the curve is fair (no flat trap) yet visibly
 * non-straight. Returns `segs+1` points; the last is exactly `lo` so the catch
 * geometry the loop planned is preserved. `dir` is the horizontal travel sign.
 */
function curvedRampPoints(
  hi: Vec2,
  lo: Vec2,
  dir: 1 | -1,
  tiltHi: number,
  tiltLo: number,
  segs: number,
): Vec2[] {
  const span = Math.abs(lo.x - hi.x);
  const dx = (dir * span) / segs;
  // Tilt is linear in horizontal progress; integrating it gives the polyline.
  // We scale the raw integral so the curve lands exactly on lo.y, absorbing any
  // float drift and keeping the planned drop regardless of the tilt profile.
  const rawY: number[] = [0];
  for (let k = 1; k <= segs; k++) {
    const tMid = (k - 0.5) / segs; // tilt at the middle of this step
    const tilt = tiltHi + (tiltLo - tiltHi) * tMid;
    rawY.push(rawY[k - 1]! + tilt * Math.abs(dx));
  }
  const drop = lo.y - hi.y;
  const scale = rawY[segs]! === 0 ? 0 : drop / rawY[segs]!;
  const pts: Vec2[] = [];
  for (let k = 0; k <= segs; k++) {
    pts.push({ x: hi.x + dx * k, y: hi.y + rawY[k]! * scale });
  }
  pts[segs] = { x: lo.x, y: lo.y };
  return pts;
}

// Loop-the-loop tuning (verified on the sim: a fed ball completes R=82-108 loops
// with margin). The circle is drawn from phi=0 (bottom, where the ball enters
// moving right) around to LOOP_ARC_DEG, leaving the lower-left open as the exit.
// Friction is near-zero so the ball keeps the speed it needs to stay on the
// inside track; a turbo on the tangent run-up gives the entry-speed margin so
// EVERY perturbed spawn completes too (else the spread gate would reject it).
const LOOP_RADIUS: [number, number] = [82, 106];
const LOOP_ARC_DEG = 290; // bottom -> right -> top -> left, leaving the lower-left open to exit
const LOOP_FRICTION = 0.015;
const LOOP_REST = 0.25;
const LOOP_TURBO: [number, number] = [1.7, 2.0];

/**
 * Segments of a vertical loop centred at (cx,cy), radius R, swept from phi=0
 * (bottom) to phiEndDeg. point(phi) = (cx + R sin phi, cy + R cos phi): phi
 * increases bottom -> right -> top -> left, so the ball entering the bottom
 * moving +x rides up the right side and over. Ids are `loopseg-i` (distinct from
 * the `loop-feed`/`loop-run` approach) so the validator can spot a ridden loop.
 */
function loopSegments(cx: number, cy: number, R: number, phiEndDeg: number, n: number): Surface[] {
  const segs: Surface[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = ((phiEndDeg * i) / n) * (Math.PI / 180);
    const p2 = ((phiEndDeg * (i + 1)) / n) * (Math.PI / 180);
    segs.push({
      id: `loopseg-${i}`,
      a: { x: cx + R * Math.sin(p1), y: cy + R * Math.cos(p1) },
      b: { x: cx + R * Math.sin(p2), y: cy + R * Math.cos(p2) },
      restitution: LOOP_REST,
      friction: LOOP_FRICTION,
      kind: "ramp",
    });
  }
  return segs;
}

const W = LOGICAL_WIDTH;
const H = LOGICAL_HEIGHT;
const SIDE_MARGIN = 40;
const FLOOR_Y = 632;
const PLANNED_TRAVEL_TARGET = 3.2 * W;
// High end extends this far past the MEASURED landing point: room for the
// landing bounce plus the post-impact uphill roll before the ball turns back.
const CATCH_SLACK = 160;
const RAMP = { restitution: 0.25, friction: 0.3 };

export interface GeneratedMap {
  map: MapDef;
  archetype: ArchetypeName;
  plannedTravel: number;
  rampIds: string[];
}

interface ProbeSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Simulate the partial map and return the per-tick trajectory. */
function probe(
  surfaces: Surface[],
  bumpers: Bumper[],
  pads: BoostPad[],
  spawn: Vec2,
  wind?: number,
  turbos?: TurboRing[],
  fields?: ForceField[],
  teleporters?: Teleporter[],
): ProbeSample[] {
  const map: MapDef = { id: "probe", spawn, ballRadius: 10, surfaces, bumpers, pads };
  if (wind !== undefined) map.wind = wind;
  if (turbos && turbos.length > 0) map.turbos = turbos;
  if (fields && fields.length > 0) map.fields = fields;
  if (teleporters && teleporters.length > 0) map.teleporters = teleporters;
  const s = createRun(map);
  const samples: ProbeSample[] = [];
  while (!s.done) {
    step(s);
    samples.push({ x: s.px, y: s.py, vx: s.vx, vy: s.vy });
  }
  return samples;
}

/**
 * Find where the ball, after passing the lip travelling in `dir`, first crosses
 * `altitude` while moving down. Returns null if it never does (e.g. stuck).
 */
function findCrossing(
  samples: ProbeSample[],
  lipX: number,
  dir: 1 | -1,
  altitude: number,
): ProbeSample | null {
  let pastLip = false;
  for (const p of samples) {
    if (!pastLip && (p.x - lipX) * dir > 2) pastLip = true;
    if (pastLip && p.vy > 0 && p.y >= altitude) return p;
  }
  return null;
}

export function buildMap(seed: string, forceArch?: ArchetypeName): GeneratedMap {
  const rng = prngFromSeed(seed);
  const pick = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const pickInt = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  // Always consume the archetype roll so the rest of the RNG stream (and thus the
  // whole map) is identical whether or not we force the archetype — forcing simply
  // overrides which personality the SAME geometry rolls are built with. This lets
  // the practice picker search each archetype on a seed without skewing toward the
  // ones that happen to pass most often (see generateDaily).
  const archRoll = Math.floor(rng() * ARCHETYPES.length);
  const arch = (forceArch ? ARCHETYPES.find((a) => a.name === forceArch) : undefined) ?? ARCHETYPES[archRoll]!;

  // Wind decided up front so EVERY construction probe accounts for it — the
  // catch ramps are built for the windy trajectory, not retrofitted. Kept well
  // under 5% of gravity (2200) so it nudges flight without dominating it.
  // Roll order is fixed here to keep seeds reproducible as features are added.
  const windRoll = rng();
  const windDir = rng() < 0.5 ? -1 : 1;
  const windMag = pick(45, 95);
  const wind = windRoll < 0.28 ? windDir * windMag : undefined;
  const turbos: TurboRing[] = [];
  const fields: ForceField[] = [];
  const teleporters: Teleporter[] = [];

  const surfaces: Surface[] = [
    { id: "wall-left", a: { x: 12, y: 0 }, b: { x: 12, y: H }, restitution: 0.4, friction: 0.1, kind: "wall" },
    { id: "wall-right", a: { x: W - 12, y: 0 }, b: { x: W - 12, y: H }, restitution: 0.4, friction: 0.1, kind: "wall" },
    // Slipperier than first-light's floor: the long end-of-run slide is part of
    // the journey (travel + span) and lets landing positions scatter readably.
    { id: "floor", a: { x: 0, y: FLOOR_Y }, b: { x: W, y: FLOOR_Y }, restitution: 0.15, friction: 0.9, kind: "basin" },
  ];
  const bumpers: Bumper[] = [];
  const pads: BoostPad[] = [];
  const rampIds: string[] = [];
  let logicalRamps = 0; // distinct ramps (a curved ramp's segments count once)

  /** Surface physics per variant kind. */
  const variantFor = (roll: number): { kind: "ramp" | "ice" | "trampoline" | "conveyor"; restitution: number; friction: number } => {
    if (roll < arch.conveyP) return { kind: "conveyor", restitution: 0.2, friction: 0.5 };
    if (roll < arch.conveyP + arch.iceP) return { kind: "ice", restitution: 0.2, friction: 0.02 };
    if (roll < arch.conveyP + arch.iceP + arch.trampP) return { kind: "trampoline", restitution: 1.1, friction: 0.3 };
    return { kind: "ramp", ...RAMP };
  };

  // Loop spawns on the left so the feeder runs left->right into the loop bottom
  // (the ball must enter moving +x to ride up the right side). Funnel spawns
  // CENTERED above the chute throat; cannon spawns LOW on one side so the launch
  // ramp can fling it up and across.
  const spawnX =
    arch.name === "loop"
      ? W * pick(0.1, 0.26)
      : arch.name === "funnel"
        ? W * pick(0.44, 0.56)
        : arch.name === "cannon"
          ? W * pick(0.12, 0.2)
          : arch.name === "circuit"
            ? W * pick(0.08, 0.14) // entrance FAR left; the teleporter warps to the right
            : W * pick(0.18, 0.82);
  // Spawn height is varied, not pinned to the ceiling. A constant y=40 made the
  // dashed spawn marker land in the same spot on every map — the single most
  // templated element. It still starts safely above the first ramp's high end
  // (pick(100,130)) so the ball drops onto it; loop's ice feeder catches higher
  // (~72-104), so loop spawns nearer the top.
  // Cannon spawns LOW (mid-left), not at the ceiling: it drops a short way onto a
  // ramp and is launched up-and-across, so its drop marker is visibly NOT at the
  // top — part of breaking the "always starts at the top" sameness.
  const spawnY = arch.name === "loop" ? pick(34, 54) : arch.name === "cannon" ? pick(150, 210) : pick(40, 80);
  const spawn = { x: spawnX, y: spawnY };
  let dir: 1 | -1 = spawnX < W / 2 ? 1 : -1;

  // The boost pad rides ONE straight ramp. It used to always be ramp 0, whose
  // high end sits near the top every map — so the pad was pinned to a narrow top
  // band. Instead choose which of the first few ramps hosts it, so the pad's
  // height varies map-to-map. That ramp is forced straight + plain so the pad
  // sits on a predictable slope (v1 law) and its push aligns with the chord.
  // Circuit's stage-2 band can be short (the warp drops the ball partway down), so a
  // pad assigned to a late ramp may go untouched — pin it to ramp 0 (always reached)
  // via the fallback below by disabling in-loop placement.
  const padRamp = arch.name === "circuit" ? -1 : pickInt(0, 2);

  // Drop one gentle booster onto a straight, plain ramp segment (hi -> lo): a
  // mid-run speed injection that makes hop drift unpredictable (v1 law). The push
  // follows the chord so it shoves the ball down the slope.
  let padPlaced = false;
  const placePad = (hi: Vec2, lo: Vec2): void => {
    const t = pick(0.35, 0.6);
    // Math.sqrt (not Math.hypot): sqrt is correctly-rounded so it's bit-identical
    // across JS engines, but Math.hypot is not — and a ULP difference here shifts
    // the pad push, which the chaotic sim amplifies until a candidate that passes
    // in the Node publisher fails in the browser (or vice-versa). Keep the whole
    // generator on the same +-*/ √ discipline the sim follows (see sim/vec.ts).
    const dpx = lo.x - hi.x;
    const dpy = lo.y - hi.y;
    const segLen = Math.sqrt(dpx * dpx + dpy * dpy) || 1;
    const strength = pick(220, 340);
    pads.push({
      id: "pad-boost",
      // On the surface point: radius 22 vs the ball center 10px above the surface
      // guarantees the rolling ball enters the zone.
      pos: { x: hi.x + (lo.x - hi.x) * t, y: hi.y + (lo.y - hi.y) * t },
      radius: 22,
      push: { x: ((lo.x - hi.x) / segLen) * strength, y: ((lo.y - hi.y) / segLen) * strength },
    });
    padPlaced = true;
  };

  // First ramp: high end slightly behind the spawn so the drop lands near the top.
  let highX = spawnX - dir * 40;
  let highY = pick(100, 130);
  let plannedTravel = highY;
  let lipX = highX;
  let lipY = highY;
  // Ramp 0's chord, kept as the guaranteed pad host: if the band ends before
  // reaching the chosen padRamp (a short band), the pad falls back to ramp 0.
  let ramp0Geom: { hi: Vec2; lo: Vec2 } | null = null;
  // Left bound for the switchback loop. Default is the side wall, but circuit's
  // stage-2 band is confined to the RIGHT half so it can't wind back over stage 1
  // and the teleporter entrance (which would re-warp the ball into a loop).
  let leftBound = SIDE_MARGIN;

  // ---- Cannon: a straight-drop ballistic launch ----
  // The ball falls from the (low, left) spawn straight onto a mid-air boost pad that
  // FIRES it up and across the canvas in a tall arc, then it comes down on the far
  // side. The biggest break from "always starts at the top, lands at the bottom":
  // the ball starts LOW and the journey goes UP and over.
  //   - Dropping STRAIGHT (no roll-in ramp) makes the launch velocity the pad's
  //     FIXED push, independent of the ±20px perturbation — so the arc is
  //     deterministic (a skill read, low spread), not a ballistic gamble. (A roll-in
  //     ramp made the launch speed depend on the drop point and the spread blew up.)
  //   - Neutered (no pad), the naive ball just drops straight to the floor below the
  //     spawn; the launch redirects it clear across the canvas — high misdirection.
  // The densify pass studs the arc with turbo rings the shot flies through (bumpers
  // would reflect it off course); the basin catches the landing. It is EXEMPT from
  // the reversal gate in validate.ts (a ballistic shot doesn't zig-zag).
  if (arch.name === "cannon") {
    const dropDist = pick(116, 150);
    const padY = spawnY + dropDist;
    pads.push({
      id: "pad-boost",
      pos: { x: spawnX, y: padY },
      radius: 26,
      // UP-and-RIGHT, chosen directly (no trig) for cross-engine bit-identity (the
      // sim vec.ts +-*/√ discipline). pushY must exceed the fall speed
      // (~√(2·g·dropDist) ≈ 700–800) to send the ball upward; pushX carries it far
      // across (a wide arc → big horizontal span, lands clear of the right wall).
      // Tuned tall+wide so the flight is consistently long enough (run length +
      // travel) without overshooting onto the far wall.
      push: { x: pick(510, 600), y: -pick(1460, 1600) },
    });
    padPlaced = true;
    plannedTravel += 1.6 * W; // the airborne arc + slide; the validator measures the real path
    lipX = spawnX;
    lipY = padY;
    dir = 1;
    // The densify pass (turbos only for cannon — see below) studs the arc with rings
    // the shot flies through, and the basin catches the landing.
  }

  // ---- Circuit: a multi-stage TELEPORTER tour ----
  // Stage 1 (LEFT): the ball drops onto a ramp that guides it down-right onto a
  // TELEPORTER. The warp sends it to a fresh region (upper-right) — the ball vanishes
  // here and reappears across the canvas — AND collapses the perturbation spread
  // (every nudge re-emerges at ~the exit), so the chained map stays a deterministic
  // skill read rather than a gamble. Stage 2: the switchback loop below catches the
  // post-warp descent and winds it to the basin, confined to the RIGHT half
  // (leftBound) so it can't wind back onto the entrance and re-warp into a cycle.
  if (arch.name === "circuit") {
    // Stage 1: the ball drops STRAIGHT into a teleporter entrance just below the
    // spawn. A straight drop is a fixed entry (every ±20px perturbation still falls
    // into the disc), and the warp re-emits them all at ~the exit moving straight
    // DOWN — so the spread is RESET and stage 2 is a clean top-drop descent in a
    // fresh region, no matter what. The ball vanishes top-left, reappears across the
    // canvas top-right, and winds all the way down: the teleporter IS the tour.
    const enX = spawnX;
    const enY = spawnY + pick(48, 66); // a visible drop into the portal (clears the disc reach)
    const exX = W * pick(0.58, 0.72);
    const exY = pick(80, 120);
    teleporters.push({ id: "tp-0", a: { x: enX, y: enY }, b: { x: exX, y: exY }, radius: 22 });
    plannedTravel += exX - enX; // the warp leap, for the ledger

    // Stage 2 = a normal switchback descent from the warp EXIT (a fresh upper-right
    // "drop point"): ramp 0's high end sits just behind the exit so the straight-down
    // ball lands on it, exactly like the top-drop the band loop is built for.
    highX = Math.min(exX + 40, W - SIDE_MARGIN);
    highY = exY + 55;
    dir = -1;
    lipX = highX;
    lipY = highY;
    // A CONTAINMENT WALL boxes stage 2 into a fresh region on the right: the ball
    // can't escape left toward the entrance (no re-warp) or fly off into the open
    // (the source of the spread/chaos). It also GUARANTEES the misdirection — the
    // real ball is boxed on the right, while the neutered (no-warp) ball drops
    // straight to the floor on the far LEFT, outside the box.
    leftBound = enX + 150;
    surfaces.push({
      id: "circuit-wall",
      a: { x: leftBound, y: FLOOR_Y },
      b: { x: leftBound, y: Math.min(exY - 10, 90) },
      restitution: 0.4,
      friction: 0.1,
      kind: "wall",
    });
  }

  for (let i = 0; i < arch.maxRamps; i++) {
    const avgTilt = pick(arch.tilt[0], arch.tilt[1]);
    let endX = highX + dir * W * pick(arch.rampLen[0], arch.rampLen[1]);
    endX = Math.max(leftBound, Math.min(W - SIDE_MARGIN, endX));
    const span = Math.abs(endX - highX);
    if (span < 150) break;

    // Tilt profile: a steep catch wall at the high end easing to a gentle lip —
    // a concave catch bowl/scoop. `curve` is the EXTRA steepness at the catch
    // end (the lip keeps the base tilt), so the bowl is visibly curved while the
    // lip — where the ball rolls back up — never drops below the base tilt and
    // the catch wall grabs hard. The pad's host ramp stays straight (swing 0) so
    // the boost pad sits on a predictable slope (v1 law); every other ramp curves.
    // endY is derived from the profile's true mean so the polyline lands on it.
    const swing = i === padRamp ? 0 : pick(arch.curve[0], arch.curve[1]);
    const tiltHi = Math.min(avgTilt * (1 + swing), 0.5);
    const tiltLo = Math.max(avgTilt, MIN_SEG_TILT);
    const endY = highY + span * ((tiltHi + tiltLo) / 2);
    if (endY > FLOOR_Y - 110) break;

    const id = `ramp-${i}`;
    // The pad's host ramp — and ramp 0, kept clean as the fallback host — stay
    // plain (v1 law: the boost pad assumes a predictable surface, no
    // ice/tramp/conveyor under it). Other ramps roll the archetype's variant
    // odds. Conveyor belts always push downhill (a->b is high->low here).
    const variant = i === padRamp || i === 0 ? { kind: "ramp" as const, ...RAMP } : variantFor(rng());
    const belt = variant.kind === "conveyor" ? pick(240, 360) : undefined;
    // Curved ramps render as a polyline of segments; the catch geometry the loop
    // planned (high end -> lip) is preserved, and the probe re-measures the real
    // trajectory after each ramp so the curve never breaks the catch guarantee.
    const pts =
      swing === 0
        ? [{ x: highX, y: highY }, { x: endX, y: endY }]
        : curvedRampPoints({ x: highX, y: highY }, { x: endX, y: endY }, dir, tiltHi, tiltLo, RAMP_ARC_SEGS);
    for (let k = 0; k < pts.length - 1; k++) {
      const segId = pts.length === 2 ? id : `${id}#${k}`;
      const surf: Surface = {
        id: segId,
        a: pts[k]!,
        b: pts[k + 1]!,
        restitution: variant.restitution,
        friction: variant.friction,
        kind: variant.kind,
      };
      if (belt !== undefined) surf.belt = belt;
      surfaces.push(surf);
      rampIds.push(segId);
    }
    logicalRamps++;

    if (i === 0) ramp0Geom = { hi: { x: highX, y: highY }, lo: { x: endX, y: endY } };
    if (i === padRamp) placePad({ x: highX, y: highY }, { x: endX, y: endY });

    lipX = endX;
    lipY = endY;
    plannedTravel += span;

    if (plannedTravel >= PLANNED_TRAVEL_TARGET && i >= 2) break;
    if (i === arch.maxRamps - 1) break;

    const hop = pick(arch.hop[0], arch.hop[1]);
    const altitude = lipY + hop;
    if (altitude > FLOOR_Y - 150) break;

    // Probe the partial map: where does the ball actually come down a hop below
    // this lip? The next ramp's high end goes CATCH_SLACK beyond that point.
    const landing = findCrossing(probe(surfaces, bumpers, pads, spawn, wind, turbos, fields, teleporters), lipX, dir, altitude);
    if (!landing) break; // ball never makes it off this lip cleanly — validator's problem

    let nextHighX = landing.x + dir * CATCH_SLACK;
    nextHighX = Math.max(leftBound, Math.min(W - SIDE_MARGIN, nextHighX));
    // The catch must reach back past the lip, or the band geometry is broken.
    if ((nextHighX - lipX) * dir < 40) break;
    highX = nextHighX;
    highY = altitude;
    plannedTravel += hop + Math.abs(landing.x - lipX);
    dir = dir === 1 ? -1 : 1;
  }

  // Guarantee the boost pad (one of every map's always-present trio): if the band
  // ended before reaching its chosen host ramp, fall back to ramp 0 — always built
  // and kept straight-or-gently-curved AND plain for exactly this purpose. Loop
  // archetype has no switchback ramps, so it intentionally has no pad.
  if (!padPlaced && ramp0Geom) placePad(ramp0Geom.hi, ramp0Geom.lo);

  // ---- Densify: make EVERY band map a busy caroming journey ----
  // The band above is a proven, deterministic descent. Now pack it: at many evenly
  // spaced altitudes, find the ball's flight point and drop a modifier there
  // (mostly bumpers for the ricochet, occasionally a turbo for a speed surge) so
  // the ball pings off something at nearly every level instead of quietly sliding
  // down. Each is re-probed and KEPT ONLY IF the ball still settles and the final
  // landing stays bounded (< DENSIFY_MAX_DEFLECT, not trapped) — so the map stays
  // readable (a skill guess), just far busier. This is what turns "a few lonely
  // ramps" into "the ball goes all over the place". Runs for every band archetype;
  // loop builds its own path below.
  if (
    arch.name === "sweep" ||
    arch.name === "stairs" ||
    arch.name === "kicker" ||
    arch.name === "pinball" ||
    arch.name === "cannon" ||
    arch.name === "circuit"
  ) {
    let placed = 0;
    for (const frac of DENSIFY_BANDS) {
      const targetY = spawn.y + (FLOOR_Y - spawn.y) * frac;
      const path = probe(surfaces, bumpers, pads, spawn, wind, turbos, fields, teleporters);
      const cleanEndX = path[path.length - 1]!.x;
      // The descending flight point nearest this band's target altitude.
      let cand: ProbeSample | null = null;
      let bestD = Infinity;
      for (const p of path) {
        if (p.vy < 40) continue; // a descending flight moment, not a roll
        if (p.y > FLOOR_Y - 120) continue; // leave the floor approach to the basin
        if (p.x < SIDE_MARGIN + 50 || p.x > W - SIDE_MARGIN - 50) continue;
        const d = Math.abs(p.y - targetY);
        if (d < bestD) {
          bestD = d;
          cand = p;
        }
      }
      if (!cand || bestD > 120) continue;
      // Mostly bumpers; every third placement is a turbo surge for variety. Cannon
      // is turbos ONLY: a bumper reflects its fast arc off course (the bounded check
      // would reject it anyway), but a turbo preserves direction — a speed ring the
      // shot rips through, deterministic, no spread cost.
      const asTurbo = arch.name === "cannon" ? true : placed % 3 === 2;
      if (asTurbo) {
        // Cannon: a GENTLE ring (small boost) so the bounded check below keeps it —
        // a strong multiplier would fling the fast arc past the deflection cap and
        // get rejected, leaving the shot ring-less. Bands keep the punchy surge.
        const mult = arch.name === "cannon" ? pick(1.08, 1.18) : pick(1.3, 1.55);
        turbos.push({ id: `turbo-d${placed}`, pos: { x: cand.x, y: cand.y + 8 }, radius: 24, mult });
      } else {
        bumpers.push({
          id: `bumper-d${placed}`,
          pos: { x: cand.x, y: cand.y + 30 }, // top graze, just under the arc
          radius: pickInt(20, 26),
          // Cannon's arc is fast — a full hop-kick flings it off course (the bumper
          // gets rejected by the bounded check below). A gentle nudge survives, so
          // the shot still caroms off a ringer or two on its way down.
          kick: arch.name === "cannon" ? pick(170, 260) : pick(PINBALL_HOP_KICK[0], PINBALL_HOP_KICK[1]),
          maxHits: 3,
        });
      }
      const test = probe(surfaces, bumpers, pads, spawn, wind, turbos, fields, teleporters);
      const tEnd = test[test.length - 1]!;
      const bounded = Math.abs(tEnd.x - cleanEndX) < DENSIFY_MAX_DEFLECT;
      const settling = tEnd.y > FLOOR_Y - 60; // still reached the floor region
      const notTrapped = test.length < path.length * 1.9; // no endless bounce loop
      if (bounded && settling && notTrapped) placed++;
      else if (asTurbo) turbos.pop();
      else bumpers.pop(); // breaks fairness — drop it, try the next band
    }
  }

  // ---- Loop-the-loop ----
  // A steep ice feeder + a tangent run-up + a turbo fling the ball around a
  // vertical loop, then it drops out the lower-left and falls to the basin. The
  // turbo gives entry-speed MARGIN so every perturbed spawn completes the loop
  // too — the spread gate rejects any build where some perturbations fall off.
  if (arch.name === "loop") {
    const R = pick(LOOP_RADIUS[0], LOOP_RADIUS[1]);
    const cx = W * pick(0.5, 0.62);
    const cy = pick(232, 292); // bottom in [~318,398]: clears ceiling, room to fall after
    const bottomY = cy + R;
    const runStartX = cx - R - pick(60, 100);
    const feedHighY = pick(72, 104);
    // Steep ice feeder + a flat tangent run-up to the loop bottom (same height as
    // the loop's inner floor so the ball enters cleanly, no drop/chatter that
    // bleeds its speed). The feeder's high end sits LEFT of the spawn so the ball
    // lands mid-ramp and slides — dropping exactly onto the end vertex stalls it.
    const feedHighX = Math.max(SIDE_MARGIN, spawnX - 80);
    surfaces.push({ id: "loop-feed", a: { x: feedHighX, y: feedHighY }, b: { x: runStartX, y: bottomY }, restitution: 0.2, friction: 0.03, kind: "ice" });
    surfaces.push({ id: "loop-run", a: { x: runStartX, y: bottomY }, b: { x: cx, y: bottomY }, restitution: 0.2, friction: 0.012, kind: "ice" });
    rampIds.push("loop-feed", "loop-run");
    turbos.push({ id: "turbo-loop", pos: { x: cx - R - 12, y: bottomY - 2 }, radius: 26, mult: pick(LOOP_TURBO[0], LOOP_TURBO[1]) });
    const lsegs = loopSegments(cx, cy, R, LOOP_ARC_DEG, Math.round(R * 0.5));
    for (const sg of lsegs) {
      surfaces.push(sg);
      rampIds.push(sg.id);
    }
    // Bookkeeping for the basin tail: the ball exits the lower-left moving down.
    lipX = cx - R * 0.7;
    lipY = bottomY;
    dir = -1;
    plannedTravel += 2 * Math.PI * R + (bottomY - feedHighY);
  }

  // ---- Finale ----
  let basinFeedDir = dir;

  if (arch.name === "sweep" || arch.name === "stairs" || arch.name === "pinball") {
    // v1 law: every map carries one guaranteed chaos element. Non-kicker maps
    // put bumpers on the final flight off the band, where the only thing
    // downstream is the basin — which absorbs the kick. (Putting them in an
    // early hop doesn't work: the probe-built catches re-converge the kick
    // perfectly and the perturbation spread collapses below the gate.)
    //
    // Re-probe before each placement so a second bumper sits on the ACTUAL
    // post-kick path — that turns the finale into a genuine pinball ricochet
    // (ping off one, fall, ping off the next) instead of a single bounce.
    const placeOnFlight = (id: string, minY: number, kickLo: number, kickHi: number): number | null => {
      const flight = probe(surfaces, bumpers, pads, spawn, wind, turbos, fields, teleporters);
      let pastLip = false;
      for (const p of flight) {
        if (!pastLip && (p.x - lipX) * dir > 2) pastLip = true;
        if (pastLip && p.vy > 0 && p.y >= minY && p.x > SIDE_MARGIN + 30 && p.x < W - SIDE_MARGIN - 30) {
          bumpers.push({
            id,
            pos: { x: p.x, y: p.y + 34 }, // just under the path: a top graze, not a wall
            radius: pickInt(22, 26),
            kick: pick(kickLo, kickHi),
            maxHits: 3,
          });
          return p.y;
        }
      }
      return null;
    };
    const firstY = placeOnFlight("bumper-ambient", lipY + (FLOOR_Y - lipY) * pick(0.3, 0.45), 620, 760);
    // ~55% of the time, a softer second bumper lower down for the ricochet.
    if (firstY !== null && firstY < FLOOR_Y - 150 && rng() < 0.55) {
      placeOnFlight("bumper-pinball", firstY + pick(70, 120), 480, 640);
    }
  }

  if (arch.name === "kicker" && logicalRamps >= 2) {
    // First-light pattern: probe the flight off the last lip, put the bumper on
    // the measured path at ball height, and hang a long return ramp beneath it.
    const flight = probe(surfaces, bumpers, pads, spawn, wind, turbos, fields, teleporters);
    const bx = lipX + dir * 88;
    let ballYAtBx: number | null = null;
    let pastLip = false;
    for (const p of flight) {
      if (!pastLip && (p.x - lipX) * dir > 2) pastLip = true;
      if (pastLip && (p.x - bx) * dir >= 0) {
        ballYAtBx = p.y;
        break;
      }
    }
    if (ballYAtBx !== null && bx > SIDE_MARGIN && bx < W - SIDE_MARGIN) {
      const radius = pickInt(24, 28);
      bumpers.push({
        id: "bumper-kick",
        pos: { x: bx, y: ballYAtBx + 2 },
        radius,
        kick: pick(840, 980),
        maxHits: 3,
      });
      const retTilt = pick(0.16, 0.19);
      const retHighX = bx - dir * 40;
      const retHighY = ballYAtBx + 42;
      let retEndX = retHighX - dir * W * pick(0.45, 0.58);
      retEndX = Math.max(SIDE_MARGIN, Math.min(W - SIDE_MARGIN, retEndX));
      let retSpan = Math.abs(retEndX - retHighX);
      // Shorten the span — never flatten the tilt — if the ramp would reach the
      // floor. A near-flat return ramp is exactly the slow-ball trap the laws ban.
      const maxSpan = (FLOOR_Y - 16 - retHighY) / retTilt;
      if (retSpan > maxSpan) {
        retSpan = maxSpan;
        retEndX = retHighX - dir * retSpan;
      }
      const retEndY = retHighY + retSpan * retTilt;
      surfaces.push({
        id: "ramp-return",
        a: { x: retEndX, y: retEndY },
        b: { x: retHighX, y: retHighY },
        ...RAMP,
        kind: "ramp",
      });
      rampIds.push("ramp-return");
      logicalRamps++;
      plannedTravel += retSpan;
      basinFeedDir = (dir * -1) as 1 | -1;
    }
  }

  // Wildcard force field: a deflection (fan) or loft (lift) on the ball's flight.
  // This is the main difficulty lever — it forces the player to JUDGE a push
  // instead of tracing a fixed path, while staying fair (the zone + arrow are
  // visible). Placed on the field-free measured path so the touch gate clears;
  // the basin re-probes afterward so it adapts to the deflected trajectory.
  if (rng() < 0.34) {
    const path = probe(surfaces, bumpers, pads, spawn, wind, turbos, fields, teleporters);
    for (let k = Math.floor(path.length * 0.28); k < Math.floor(path.length * 0.6); k++) {
      const p = path[k]!;
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      // Want a real flight moment (descending, in open air, clear of walls/floor).
      if (speed > 220 && p.vy > 60 && p.x > SIDE_MARGIN + 130 && p.x < W - SIDE_MARGIN - 130 && p.y > 120 && p.y < FLOOR_Y - 170) {
        if (rng() < 0.62) {
          // Fan: push toward mid-screen so the ball can't sail straight off the edge.
          const fdir: 1 | -1 = p.x < W / 2 ? 1 : -1;
          fields.push({
            id: "field-0",
            kind: "fan",
            pos: { x: p.x, y: p.y },
            halfW: 100,
            halfH: 120,
            strength: pick(950, 1500),
            dir: { x: fdir, y: 0 },
          });
        } else {
          fields.push({
            id: "field-0",
            kind: "lift",
            pos: { x: p.x, y: p.y + 40 },
            halfW: 110,
            halfH: 150,
            strength: pick(1700, 2300),
          });
        }
        break;
      }
    }
  }

  // Variety guarantee: every map must carry at least one tangible modifier
  // beyond the always-present pad + bumper, so the validator's tangible-modifier
  // gate (>=3) reliably clears. A rolled variant surface, a placed field, or a
  // turbo all qualify; if none landed, we MUST force a turbo ring.
  const VARIANT_KINDS = new Set(["ice", "trampoline", "conveyor"]);
  const hasVariant = surfaces.some((s) => VARIANT_KINDS.has(s.kind) && rampIds.includes(s.id));
  const hasExtra = hasVariant || fields.length > 0;
  const wantTurbo = !hasExtra || rng() < 0.3;
  if (wantTurbo) {
    const path = probe(surfaces, bumpers, pads, spawn, wind, turbos, fields, teleporters);
    // Open-air point with real speed in the mid-run. When the turbo is the
    // GUARANTEED third modifier we relax the speed bar so placement rarely fails.
    const minSpeed = hasExtra ? 260 : 140;
    for (let k = Math.floor(path.length * 0.3); k < Math.floor(path.length * 0.7); k++) {
      const p = path[k]!;
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (speed > minSpeed && p.x > SIDE_MARGIN + 40 && p.x < W - SIDE_MARGIN - 40 && p.y < FLOOR_Y - 120) {
        turbos.push({ id: "turbo-0", pos: { x: p.x, y: p.y }, radius: 24, mult: pick(1.3, 1.5) });
        break;
      }
    }
  }

  // Elevated destination: a raised pod that catches the ball HIGH or MID instead
  // of always on the floor — the biggest Y-axis variety lever. Built only if a
  // re-probe confirms the ball actually settles in it (a deep bowl it drops into
  // and can't bounce out of); otherwise it's removed and the floor basin below
  // catches the ball as usual. Skipped for loop (already its own structure) and for
  // cannon (its trampoline rebound is the signature landing; a pod intercepting the
  // arc early would steal the rebound and leave the shot a bare, reversal-less arc).
  let podSettleY: number | null = null;
  if (arch.name !== "loop" && arch.name !== "cannon" && rng() < 0.55) {
    const path = probe(surfaces, bumpers, pads, spawn, wind, turbos, fields, teleporters);
    // Catch the ball LATE — after it has finished its band journey (and its finale
    // bumper) — at whatever raised height it's descending through, so the run
    // still earns its travel/reversals and just rests higher than the floor.
    // (Catching it early would cut the journey short.) Want a steeply-descending,
    // open-air point above the floor: more vertical than horizontal so it drops in.
    let entry: ProbeSample | null = null;
    for (let k = Math.floor(path.length * 0.62); k < path.length; k++) {
      const p = path[k]!;
      if (p.vy > 70 && p.vy > Math.abs(p.vx) && p.y > 225 && p.y < FLOOR_Y - 130 && p.x > SIDE_MARGIN + 95 && p.x < W - SIDE_MARGIN - 95) {
        entry = p;
        break;
      }
    }
    if (entry) {
      const px = entry.x;
      const podY = entry.y + pick(62, 92); // floor below the entry point
      const PW = pick(58, 80);
      const PH = podY - (entry.y - 22); // walls reach ~22px above the entry point
      surfaces.push({ id: "pod-floor", a: { x: px - PW, y: podY }, b: { x: px + PW, y: podY }, restitution: 0.18, friction: 0.6, kind: "basin" });
      surfaces.push({ id: "pod-wall-l", a: { x: px - PW, y: podY }, b: { x: px - PW, y: podY - PH }, restitution: 0.22, friction: 0.3, kind: "lip" });
      surfaces.push({ id: "pod-wall-r", a: { x: px + PW, y: podY }, b: { x: px + PW, y: podY - PH }, restitution: 0.22, friction: 0.3, kind: "lip" });
      // Verify the ball comes to rest INSIDE the pod; if not, tear it back out.
      const test = probe(surfaces, bumpers, pads, spawn, wind, turbos, fields, teleporters);
      const end = test[test.length - 1]!;
      if (Math.abs(end.y - (podY - 10)) < 46 && Math.abs(end.x - px) < PW + 12) {
        podSettleY = podY;
        // The pod ends the run early, so a finale bumper aimed at the floor flight
        // is now orphaned. Re-run and drop any bumper the ball no longer reaches
        // (the pod itself stands in as the map's interest — see validate.ts).
        const podMap: MapDef = { id: "podcheck", spawn, ballRadius: 10, surfaces, bumpers, pads };
        if (turbos.length > 0) podMap.turbos = turbos;
        if (fields.length > 0) podMap.fields = fields;
        if (teleporters.length > 0) podMap.teleporters = teleporters;
        if (wind !== undefined) podMap.wind = wind;
        const rs = createRun(podMap);
        while (!rs.done) step(rs);
        for (let bi = bumpers.length - 1; bi >= 0; bi--) {
          if (!rs.touched.has(bumpers[bi]!.id)) bumpers.splice(bi, 1);
        }
      } else {
        surfaces.splice(surfaces.length - 3, 3); // remove pod, fall through to the floor
      }
    }
  }
  void podSettleY;

  // Cleanup: drop any bumper/turbo the ball doesn't actually touch in the FINAL
  // map. The density pass places modifiers one at a time, but a later placement
  // can divert the ball off an earlier one — leaving an untouched modifier that
  // both fails validation ("never touched") and is dead weight. Remove orphans so
  // every modifier on the map is one the ball really hits.
  {
    const cleanMap: MapDef = { id: "cleancheck", spawn, ballRadius: 10, surfaces, bumpers, pads };
    if (turbos.length > 0) cleanMap.turbos = turbos;
    if (fields.length > 0) cleanMap.fields = fields;
    if (teleporters.length > 0) cleanMap.teleporters = teleporters;
    if (wind !== undefined) cleanMap.wind = wind;
    const cs = createRun(cleanMap);
    while (!cs.done) step(cs);
    for (let bi = bumpers.length - 1; bi >= 0; bi--) {
      if (!cs.touched.has(bumpers[bi]!.id)) bumpers.splice(bi, 1);
    }
    for (let ti = turbos.length - 1; ti >= 0; ti--) {
      if (!cs.touched.has(turbos[ti]!.id)) turbos.splice(ti, 1);
    }
  }

  // Basin: probe the now-complete structure to find where the ball first meets
  // the floor, then build the basin around that point — near curb behind it,
  // tall far lip ahead of the slide direction.
  const finale = probe(surfaces, bumpers, pads, spawn, wind, turbos, fields, teleporters);
  let floorHit: ProbeSample | null = null;
  for (const p of finale) {
    if (p.y >= FLOOR_Y - 11) {
      floorHit = p;
      break;
    }
  }
  if (floorHit) {
    const slideDir: 1 | -1 = floorHit.vx >= 0 ? 1 : -1;
    let farX = floorHit.x + slideDir * pick(220, 340);
    farX = Math.max(26, Math.min(W - 26, farX));
    let nearX = floorHit.x - slideDir * pick(80, 120);
    nearX = Math.max(26, Math.min(W - 26, nearX));
    surfaces.push({
      id: "basin-lip-far",
      a: { x: farX, y: FLOOR_Y },
      b: { x: farX, y: FLOOR_Y - 72 },
      restitution: 0.3,
      friction: 0.2,
      kind: "lip",
    });
    surfaces.push({
      id: "basin-curb-near",
      a: { x: nearX, y: FLOOR_Y },
      b: { x: nearX, y: FLOOR_Y - 14 },
      restitution: 0.3,
      friction: 0.2,
      kind: "lip",
    });
    plannedTravel += Math.abs(farX - floorHit.x) + (FLOOR_Y - lipY);
  }
  void basinFeedDir; // direction bookkeeping kept for future destination types

  const map: MapDef = { id: `gen-${seed}`, spawn, ballRadius: 10, surfaces, bumpers, pads };
  if (turbos.length > 0) map.turbos = turbos;
  if (fields.length > 0) map.fields = fields;
  if (teleporters.length > 0) map.teleporters = teleporters;
  if (wind !== undefined) map.wind = wind;

  return {
    map,
    archetype: arch.name,
    plannedTravel,
    rampIds,
  };
}
