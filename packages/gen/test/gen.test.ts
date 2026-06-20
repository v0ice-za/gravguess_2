import { describe, expect, it } from "vitest";
import { buildMap } from "../src/generate.ts";
import { validate } from "../src/validate.ts";
import { generateDaily } from "../src/pipeline.ts";

describe("generator", () => {
  it("is deterministic: same seed, identical map", () => {
    const a = buildMap("2026-06-12");
    const b = buildMap("2026-06-12");
    expect(JSON.stringify(a.map)).toBe(JSON.stringify(b.map));
    expect(a.archetype).toBe(b.archetype);
  });

  it("different seeds give different maps", () => {
    const a = buildMap("2026-06-12");
    const b = buildMap("2026-06-13");
    expect(JSON.stringify(a.map)).not.toBe(JSON.stringify(b.map));
  });

  it("respects design laws: traversal ramps tilted, only basins/floor flat", () => {
    for (const seed of ["law-1", "law-2", "law-3"]) {
      const { map } = buildMap(seed);
      for (const s of map.surfaces) {
        // Loop-the-loop segments (`loopseg-`) are a circle — their top/bottom
        // arcs are legitimately near-horizontal; the no-flat-trap law is about
        // traversal ramps the ball could rest on, not a track it races around.
        if (s.kind === "ramp" && !s.id.startsWith("loopseg-")) {
          const tilt = Math.abs(s.b.y - s.a.y) / Math.abs(s.b.x - s.a.x);
          expect(tilt).toBeGreaterThanOrEqual(0.15);
        }
      }
    }
  });

  it("pipeline ships passing maps for typical seeds", () => {
    let passed = 0;
    for (const seed of ["t-0", "t-1", "t-2", "t-3", "t-4"]) {
      const d = generateDaily(seed);
      expect(d.map.surfaces.length).toBeGreaterThan(4);
      if (d.validation.pass) passed++;
    }
    expect(passed).toBeGreaterThanOrEqual(4);
  }, 30000); // per-archetype search across 6 archetypes — reject loops take longer

  it("guarantees every SHIPPED map is interesting: modifiers + misdirection + min travel", () => {
    // The production promise: a passing daily always settles, touches real
    // modifiers, travels a real distance, AND isn't obvious — the gimmicks must
    // redirect the ball meaningfully from the naive read (the misdirection gate).
    for (let i = 0; i < 12; i++) {
      const d = generateDaily(`promise-${i}`); // validity holds for any passing candidate
      if (!d.validation.pass) continue; // fallback candidate — not shipped as a daily
      const m = d.validation.metrics;
      expect(m.settled).toBe(true);
      expect(m.tangibleModifiers).toBeGreaterThanOrEqual(3);
      // Every map must be non-obvious — except loop, whose appeal is the spectacle,
      // not misdirection (it's exempt from the gate in validate.ts).
      if (d.archetype !== "loop") {
        expect(d.validation.misdirection).toBeGreaterThanOrEqual(0.12);
      }
      // 1.15x is the most relaxed travel gate for a grounded run (an elevated-pod
      // ending stops the ball early, before the floor slide). A cannon is one big
      // airborne arc — huge span, short net path — so it clears a lower 0.8x bar.
      const minTravelX = d.archetype === "cannon" ? 0.8 : 1.15;
      expect(m.travel).toBeGreaterThanOrEqual(minTravelX * 1280);
    }
  }, 60000); // curved maps carry ~2x the segments, so 24 reject-loops take longer

  it("validation is reproducible for a given map", () => {
    const gen = buildMap("repro");
    const v1 = validate(gen.map, gen.rampIds);
    const v2 = validate(gen.map, gen.rampIds);
    expect(v1.pass).toBe(v2.pass);
    expect(v1.spread).toBe(v2.spread);
    expect(v1.metrics.ticks).toBe(v2.metrics.ticks);
  });
});
