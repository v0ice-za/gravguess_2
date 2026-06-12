// Builds the published daily payload: ranked survivors -> variety check ->
// authoritative run -> par. The web client consumes these as static JSON;
// it NEVER generates or validates the daily itself.

import { simulate, type MapDef, type Vec2 } from "@gravguess/sim";
import { generateRanked, type ArchetypeName, type DailyMap } from "@gravguess/gen";

/** The contract between the pipeline and the client. */
export interface DailyPayload {
  version: 1;
  date: string; // YYYY-MM-DD (UTC)
  seed: string; // the seed that actually built the map (after mutation)
  archetype: ArchetypeName;
  map: MapDef;
  /** Authoritative landing point, computed at publish time. */
  landing: Vec2;
  /** Golden digest of the authoritative run — clients can verify determinism. */
  digest: string;
  ticks: number;
  /** Par: median distance between the perturbed landings and the authoritative
   * landing — the irreducible read uncertainty. Beat it and you out-read the map. */
  parPx: number;
  funScore: number;
}

interface Fingerprint {
  archetype: ArchetypeName;
  landingThird: number; // 0 | 1 | 2 — left/mid/right region of the landing
}

function fingerprint(d: DailyMap): Fingerprint {
  return {
    archetype: d.archetype,
    landingThird: Math.min(2, Math.floor((d.validation.metrics.landing.x / 1280) * 3)),
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Pick the day's map from ranked survivors, avoiding a repeat of yesterday's
 * fingerprint (two near-identical days reads as "the game ran out of content").
 */
export function buildDaily(date: string, previous?: Fingerprint | undefined): DailyPayload | null {
  const survivors = generateRanked(date);
  if (survivors.length === 0) return null;

  // Freshness beats fun score: a slightly less spectacular map that FEELS new
  // is worth more to a daily ritual than the same archetype two days running.
  let chosen = survivors[0]!;
  if (previous) {
    const newArchetype = survivors.find((s) => fingerprint(s).archetype !== previous.archetype);
    const newRegion = survivors.find(
      (s) => fingerprint(s).landingThird !== previous.landingThird,
    );
    chosen = newArchetype ?? newRegion ?? chosen;
  }

  // The authoritative run, recorded at publish time.
  const run = simulate(chosen.map);
  const landings = chosen.validation.landings;
  // Floor of one ball-width: perfectly re-converged perturbations would
  // otherwise publish an unbeatable par of 0.
  const parPx = Math.max(
    median(landings.map((l) => Math.hypot(l.x - run.landing.x, l.y - run.landing.y))),
    chosen.map.ballRadius * 2,
  );

  return {
    version: 1,
    date,
    seed: chosen.seedUsed,
    archetype: chosen.archetype,
    map: chosen.map,
    landing: run.landing,
    digest: run.digest,
    ticks: run.ticks,
    parPx,
    funScore: chosen.funScore,
  };
}

export function dailyFingerprint(p: DailyPayload): Fingerprint {
  return {
    archetype: p.archetype,
    landingThird: Math.min(2, Math.floor((p.landing.x / 1280) * 3)),
  };
}
