// Generate-and-reject loop: mutate the seed until candidates pass every gate.
// Attempts are milliseconds; hundreds per day is fine.
//
// Two modes:
//  - generateDaily: first passing candidate (fast path for practice/dev).
//  - generateRanked: collect several passing candidates, score them on the fun
//    bar, ship the best. The order of operations is fixed by the spec: validity
//    gates, then fun score, then (in the publisher) the variety check — and the
//    daily is picked from the TOP of the ranked survivors, never the first one
//    that limped through.

import type { MapDef } from "@gravguess/sim";
import { buildMap, type ArchetypeName } from "./generate.ts";
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
  if (v.clusters === 2 || v.clusters === 3) score += 3;
  else if (v.clusters > 3) score += 1;
  if (v.metrics.lateDrama) score += 2;
  if (v.spread >= 0.15 && v.spread <= 0.35) score += 2;
  else if (v.spread >= 0.08) score += 1;
  score += Math.min(v.metrics.ticks / 120, 12) / 6; // up to +2 for run length
  if (v.metrics.bumperHits > 0) score += 1;
  if (v.metrics.bumperHits >= 2) score += 1.5; // a pinball ricochet — the signature journey
  if (v.metrics.tangibleModifiers >= 4) score += 1; // a busy, eventful map beats a sparse one
  if (v.metrics.maxAirTicks >= 48) score += 1; // a real flight moment (0.4s+)
  return score;
}

function candidateAt(seed: string, attempt: number): DailyMap {
  const seedUsed = attempt === 0 ? seed : `${seed}#${attempt}`;
  const gen = buildMap(seedUsed);
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
 * preview. Collects a handful of valid candidates and returns the most fun, so
 * what you see matches the curation the daily publisher applies (it never ships
 * the first map that merely limped through the gates).
 */
export function generateDaily(seed: string, maxAttempts = 150, collect = 6): DailyMap {
  const survivors: DailyMap[] = [];
  let best: DailyMap | null = null;
  for (let attempt = 0; attempt < maxAttempts && survivors.length < collect; attempt++) {
    const candidate = candidateAt(seed, attempt);
    if (candidate.validation.pass) survivors.push(candidate);
    else if (!best || candidate.validation.failures.length < best.validation.failures.length) {
      best = candidate;
    }
  }
  if (survivors.length > 0) {
    survivors.sort((a, b) => b.funScore - a.funScore);
    return survivors[0]!;
  }
  // Nothing passed: ship the closest candidate, reporting the full attempt spend.
  return { ...best!, attempts: maxAttempts };
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
