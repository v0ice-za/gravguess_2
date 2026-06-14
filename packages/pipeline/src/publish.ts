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

// Par above this fraction of width reads as luck, not skill: the perturbed
// landings split into far-apart clusters, so even a perfect read can miss by a
// quarter-screen. Prefer survivors under the cap; fall back to the lowest par.
const PAR_CAP_RATIO = 0.25;

/** Par for a survivor, measured against its own base-run landing. */
function survivorPar(d: DailyMap): number {
  const ref = d.validation.metrics.landing;
  const par = median(d.validation.landings.map((l) => Math.hypot(l.x - ref.x, l.y - ref.y)));
  return Math.max(par, d.map.ballRadius * 2);
}

/**
 * Pick the day's map from ranked survivors, rotating through archetypes so the
 * daily feels fresh. `recent` is the last few days' fingerprints (most recent
 * first): we prefer the best survivor whose archetype HASN'T shipped in that
 * window, which both stops one easy-to-generate archetype (e.g. loops) from
 * dominating and guarantees the rarer ones get their turn.
 */
export function buildDaily(date: string, recent: Fingerprint[] = []): DailyPayload | null {
  const all = generateRanked(date);
  if (all.length === 0) return null;

  // Drop "luck" maps (par above the cap). If every survivor is over the cap,
  // keep them all and let the lowest-par one win below rather than publish
  // nothing — but prefer the readable ones whenever they exist.
  const underCap = all.filter((s) => survivorPar(s) <= PAR_CAP_RATIO * 1280);
  const survivors = underCap.length > 0 ? underCap : all;

  // Freshness beats fun score: a slightly less spectacular map that FEELS new
  // is worth more to a daily ritual than the same archetype run after run.
  let chosen = survivors[0]!;
  const recentArchetypes = new Set(recent.map((f) => f.archetype));
  const unseen = survivors.find((s) => !recentArchetypes.has(fingerprint(s).archetype));
  if (unseen) {
    chosen = unseen; // an archetype not used in the recent window — best variety
  } else if (recent.length > 0) {
    // Every archetype shipped recently; at least don't repeat yesterday's, and
    // failing that move the landing to a different third of the floor.
    const prev = recent[0]!;
    chosen =
      survivors.find((s) => fingerprint(s).archetype !== prev.archetype) ??
      survivors.find((s) => fingerprint(s).landingThird !== prev.landingThird) ??
      chosen;
  }
  // If we had to fall back to over-cap maps, pick the most readable one.
  if (underCap.length === 0) {
    chosen = [...all].sort((a, b) => survivorPar(a) - survivorPar(b))[0]!;
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
