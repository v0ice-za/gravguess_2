// Generate-and-reject loop: mutate the seed until candidates pass every gate.
// Attempts are milliseconds; hundreds per day is fine.
//
// Two modes:
//  - generateDaily: best passing candidate PER ARCHETYPE, then a funScore-weighted
//    pick among them (practice/dev — keeps the full archetype variety on screen).
//  - generateRanked: collect several passing candidates, score them on the fun
//    bar, ship the best. The order of operations is fixed by the spec: validity
//    gates, then fun score, then (in the publisher) the variety check — and the
//    daily is picked from the TOP of the ranked survivors, never the first one
//    that limped through.

import { prngFromSeed, type MapDef } from "@gravguess/sim";
import { ARCHETYPE_NAMES, buildMap, type ArchetypeName } from "./generate.ts";
import { validate, type Validation } from "./validate.ts";

export interface DailyMap {
  map: MapDef;
  archetype: ArchetypeName;
  seed: string;
  seedUsed: string;
  attempts: number;
  validation: Validation;
  funScore: number;
}

/**
 * Fun-bar score for a VALID candidate. Rewards what makes a guess feel like a
 * read instead of a measurement:
 *  - 2-3 distinct landing clusters (decision ambiguity is the puzzle)
 *  - late drama (a reversal/kick in the final quarter — the signature moment)
 *  - spread in the readable-but-uncertain band (~15-35% of width)
 *  - longer runs (the run is the show), saturating at ~12s
 */
export function funScore(v: Validation): number {
  let score = 0;
  // MISDIRECTION is the star: the bigger the gap between the naive "ramps +
  // gravity" read and where the ball actually lands, the bigger the "ohh, I
  // didn't see that — but it makes sense" payoff. This is what makes a map a
  // clever read instead of an obvious one. Saturates at ~40% of width (+5).
  score += Math.min(v.misdirection / 0.4, 1) * 5;
  // A late twist (a reversal or bumper hit in the final quarter) is the signature
  // dramatic moment — the misdirection landing the punch right before it settles.
  if (v.metrics.lateDrama) score += 2;
  // Skill, not luck: reward TIGHT outcomes. The read should be reliably solvable,
  // so a lower perturbation spread scores better (the opposite of the old design,
  // which rewarded ambiguity). Best near the deterministic floor, fading out by
  // the readability cap.
  if (v.spread <= 0.18) score += 2;
  else if (v.spread <= 0.3) score += 1;
  // A couple of distinct candidate landing zones makes the read a real decision
  // (which one does the physics actually pick?) without tipping into luck.
  if (v.clusters === 2 || v.clusters === 3) score += 1.5;
  // BUSY beats sparse: reward maps where the ball caroms through many modifiers
  // (the "send it around the map a bunch" feel). Saturates around 8 modifiers.
  score += Math.min(v.metrics.tangibleModifiers / 8, 1) * 3;
  score += Math.min(v.metrics.ticks / 120, 12) / 8; // up to +1.5 for run length
  if (v.metrics.maxAirTicks >= 48) score += 1; // a real flight moment (0.4s+)
  return score;
}

function candidateAt(seed: string, attempt: number, forceArch?: ArchetypeName): DailyMap {
  const seedUsed = attempt === 0 ? seed : `${seed}#${attempt}`;
  const gen = buildMap(seedUsed, forceArch);
  const validation = validate(gen.map, gen.rampIds, gen.archetype);
  return {
    map: gen.map,
    archetype: gen.archetype,
    seed,
    seedUsed,
    attempts: attempt + 1,
    validation,
    funScore: validation.pass ? funScore(validation) : 0,
  };
}

/**
 * Best-of passing candidate for a seed — used by practice maps and the Map Maker
 * preview. Searches EACH archetype separately for its best passing candidate, then
 * picks among those representatives weighted by funScore.
 *
 * Why per-archetype and not "first N survivors": the archetypes pass at WILDLY
 * different raw rates (cannon/loop pass often, the switchback bands rarely). A flat
 * survivor pool fills up with the easy passers before a band ever appears, so
 * practice collapses to two or three shapes — exactly the "always the same
 * archetypes" complaint. Forcing each archetype its OWN search budget guarantees
 * every shape that can pass at all is in the running, so practice shows the full
 * variety. (The published daily uses generateRanked, which has its own per-archetype
 * cap + rotation — this governs practice/maker only.)
 */
export function generateDaily(seed: string, maxAttempts = 130): DailyMap {
  // Keep the BEST candidate per archetype (deduped). The dedup is the whole trick:
  // cannon/loop pass several times faster than the bands, so a flat "first N
  // survivors" pool fills with them before a band ever appears — practice collapses
  // to two shapes. Keeping one slot per archetype means extra cannon passes just
  // update cannon's slot instead of crowding bands out, so the funScore-weighted
  // pick below has a real spread of shapes to choose from.
  //
  // Early-stop once 4 distinct shapes are gathered — enough for the weighted pick to
  // have real variety without burning the whole budget chasing the rarest archetype.
  // (Practice loads call this off the main thread now, so the wait isn't a UI freeze.)
  const bestByArch = new Map<ArchetypeName, DailyMap>();
  let fallback: DailyMap | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = candidateAt(seed, attempt);
    if (candidate.validation.pass) {
      const cur = bestByArch.get(candidate.archetype);
      if (!cur || candidate.funScore > cur.funScore) bestByArch.set(candidate.archetype, candidate);
      if (bestByArch.size >= 4) break;
    } else if (!fallback || candidate.validation.failures.length < fallback.validation.failures.length) {
      fallback = candidate;
    }
  }
  const reps = [...bestByArch.values()];
  if (reps.length === 0) {
    // Nothing passed: ship the closest candidate, reporting the full attempt spend.
    return { ...fallback!, attempts: maxAttempts };
  }
  // Pick among the archetype representatives weighted by funScore: VARIETY (a real
  // spread of shapes is in the running, not just the easy passers) biased gently
  // toward the cleverer maps. The pick is seed-deterministic, so a given practice
  // seed always renders the same map. (The published daily uses generateRanked.)
  const weights = reps.map((r) => Math.max(0.5, r.funScore)); // floor so a low scorer still appears
  const total = weights.reduce((a, b) => a + b, 0);
  let r = prngFromSeed(`pick-${seed}`)() * total;
  for (let i = 0; i < reps.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return reps[i]!;
  }
  return reps[reps.length - 1]!;
}

/**
 * Collect passing candidates ranked by fun score (best first). Used by the
 * offline publisher; never runs on the client.
 *
 * A per-archetype cap keeps the pool DIVERSE: without it an easy-to-generate
 * archetype (loops pass ~6x more often than the others) floods every survivor
 * slot, leaving the publisher's archetype rotation nothing to rotate to. Capping
 * each archetype guarantees the pool spans the styles that can pass, so the
 * rotation can actually balance the daily mix.
 */
export function generateRanked(seed: string, wanted = 8, maxAttempts = 600, perArchetypeCap = 2): DailyMap[] {
  const survivors: DailyMap[] = [];
  const perArch = new Map<ArchetypeName, number>();
  for (let attempt = 0; attempt < maxAttempts && survivors.length < wanted; attempt++) {
    const candidate = candidateAt(seed, attempt);
    if (!candidate.validation.pass) continue;
    const count = perArch.get(candidate.archetype) ?? 0;
    if (count >= perArchetypeCap) continue; // pool diversity over more of the same
    survivors.push(candidate);
    perArch.set(candidate.archetype, count + 1);
  }
  survivors.sort((a, b) => b.funScore - a.funScore);
  return survivors;
}
